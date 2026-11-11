import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import path from "path";
import { Pool } from "pg";

const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const API_KEY = process.env.API_KEY ?? "";

// ---------- Helpers ----------

// A fingerprint of the request body, used to spot "same key, different body"
function hashBody(body: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toIso(date: Date): string {
  return date.toISOString().replace(".000Z", "Z");
}

function formatBooking(row: any) {
  return {
    id: row.id,
    slot_id: row.slot_id,
    name: row.name,
    email: row.email,
    status: row.status,
    created_at: row.created_at.toISOString(),
  };
}

// Compare two strings in constant time, so an attacker can't guess the key
// character by character by measuring how long the comparison takes.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- Middleware: API key (Level 2) ----------

function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const key = req.header("X-API-Key");
  if (!API_KEY || !key || !safeEqual(key, API_KEY)) {
    return res.status(401).json({ error: "invalid or missing API key" });
  }
  next();
}

// ---------- Web page bridge: /api/... (used by the React page) ----------
// The browser can't hold the API key safely, so the page calls /api/...
// and the server adds the key itself before handing the request on.
// Only the routes the page needs are allowed; /reset is never reachable this way.

const PAGE_ROUTES: Array<[string, RegExp]> = [
  ["GET", /^\/slots$/],
  ["GET", /^\/bookings$/],
  ["POST", /^\/bookings$/],
  ["GET", /^\/bookings\/[^/]+$/],
  ["DELETE", /^\/bookings\/[^/]+$/],
];

app.use((req, res, next) => {
  if (req.path !== "/api" && !req.path.startsWith("/api/")) return next();

  const routePath = req.path.slice("/api".length); // /api/slots -> /slots
  const allowed = PAGE_ROUTES.some(([method, pattern]) => req.method === method && pattern.test(routePath));
  if (!allowed) {
    return res.status(404).json({ error: "not found" });
  }
  req.headers["x-api-key"] = API_KEY;
  req.url = req.url.slice("/api".length); // keeps the ?query part too
  next();
});

// ---------- Public route ----------

app.get("/health", async (_req, res) => {
  const result = await pool.query("SELECT now() AS time");
  res.json({ ok: true, dbTime: result.rows[0].time });
});

// Everything below this line needs a valid API key
app.use(["/reset", "/slots", "/bookings"], requireApiKey);

// ---------- POST /reset ----------

app.post("/reset", async (req, res) => {
  const slots = req.body?.slots;
  if (!Array.isArray(slots)) {
    return res.status(400).json({ error: "slots must be an array" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM bookings");
    await client.query("DELETE FROM slots");
    await client.query("DELETE FROM idempotency_keys");
    await client.query("DELETE FROM rate_limit_attempts");
    for (const slot of slots) {
      await client.query(
        "INSERT INTO slots (id, provider, start_at, end_at) VALUES ($1, $2, $3, $4)",
        [slot.id, slot.provider, slot.start, slot.end]
      );
    }
    await client.query("COMMIT");
    res.status(200).json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// ---------- GET /slots ----------

app.get("/slots", async (req, res) => {
  const provider = req.query.provider;

  let sql = `
    SELECT s.id, s.provider, s.start_at, s.end_at,
           NOT EXISTS (
             SELECT 1 FROM bookings b
             WHERE b.slot_id = s.id AND b.status = 'confirmed'
           ) AS available
    FROM slots s`;
  const params: string[] = [];

  if (typeof provider === "string") {
    sql += " WHERE s.provider = $1";
    params.push(provider);
  }
  sql += " ORDER BY s.start_at ASC, s.id ASC";

  const result = await pool.query(sql, params);
  res.json({
    slots: result.rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      start: toIso(row.start_at),
      end: toIso(row.end_at),
      available: row.available,
    })),
  });
});

// ---------- POST /bookings ----------

type Outcome = { status: number; body: unknown };

// The booking logic from Levels 1-3, returning an outcome instead of sending it
async function createBooking(body: any): Promise<Outcome> {
  body = body ?? {};
  const slotId = typeof body.slot_id === "string" ? body.slot_id.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!slotId) return { status: 400, body: { error: "slot_id is required" } };
  if (!name) return { status: 400, body: { error: "name is required" } };
  if (!email) return { status: 400, body: { error: "email is required" } };
  if (!EMAIL_PATTERN.test(email)) return { status: 400, body: { error: "email is not valid" } };

  const slotResult = await pool.query(
    "SELECT start_at <= now() AS started FROM slots WHERE id = $1",
    [slotId]
  );
  if (slotResult.rows.length === 0) return { status: 404, body: { error: "slot not found" } };
  if (slotResult.rows[0].started) return { status: 400, body: { error: "slot has already started" } };

  try {
    const result = await pool.query(
      `INSERT INTO bookings (slot_id, name, email) VALUES ($1, $2, $3) RETURNING *`,
      [slotId, name, email]
    );
    return { status: 201, body: formatBooking(result.rows[0]) };
  } catch (err: any) {
    if (err.code === "23503") return { status: 404, body: { error: "slot not found" } };
    if (err.code === "23505") return { status: 409, body: { error: "slot already booked" } };
    throw err;
  }
}

// ---------- Rate limiting (Level 5) ----------

const RATE_LIMIT = 5;

type RateLimitResult = { allowed: true } | { allowed: false; retryAfter: number };

// Allows at most 5 attempts per email in any 60-second window
async function checkRateLimit(email: string): Promise<RateLimitResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // One request per email at a time, so simultaneous requests can't all slip through
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [email]);

    // Forget attempts older than one minute
    await client.query(
      "DELETE FROM rate_limit_attempts WHERE email = $1 AND attempted_at <= now() - interval '1 minute'",
      [email]
    );

    const recent = await client.query(
      `SELECT count(*)::int AS attempts,
              CEIL(EXTRACT(EPOCH FROM (min(attempted_at) + interval '1 minute' - now())))::int AS retry_after
       FROM rate_limit_attempts WHERE email = $1`,
      [email]
    );
    const { attempts, retry_after } = recent.rows[0];

    if (attempts >= RATE_LIMIT) {
      await client.query("COMMIT");
      return { allowed: false, retryAfter: Math.max(1, retry_after) };
    }

    await client.query("INSERT INTO rate_limit_attempts (email) VALUES ($1)", [email]);
    await client.query("COMMIT");
    return { allowed: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

app.post("/bookings", async (req, res) => {
  // Level 5: count this attempt before anything else, so failed attempts count too
  const attemptEmail =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (attemptEmail) {
    const limit = await checkRateLimit(attemptEmail);
    if (!limit.allowed) {
      res.set("Retry-After", String(limit.retryAfter));
      return res.status(429).json({ error: "too many booking attempts for this email, try again later" });
    }
  }

  const key = req.header("Idempotency-Key");

  // No key: just book (Levels 1-3 behaviour)
  if (!key) {
    const outcome = await createBooking(req.body);
    return res.status(outcome.status).json(outcome.body);
  }

  const requestHash = hashBody(req.body);

  // Try to claim the key. Only one request can insert it.
  const claim = await pool.query(
    `INSERT INTO idempotency_keys (key, request_hash) VALUES ($1, $2)
     ON CONFLICT (key) DO NOTHING
     RETURNING key`,
    [key, requestHash]
  );

  if (claim.rows.length === 1) {
    // We own the key: do the real work, then record the response
    try {
      const outcome = await createBooking(req.body);
      await pool.query(
        "UPDATE idempotency_keys SET response_status = $2, response_body = $3 WHERE key = $1",
        [key, outcome.status, JSON.stringify(outcome.body)]
      );
      return res.status(outcome.status).json(outcome.body);
    } catch (err) {
      // Something unexpected broke: release the key so a retry can try again
      await pool.query("DELETE FROM idempotency_keys WHERE key = $1", [key]);
      throw err;
    }
  }

  // The key was already used: replay the stored response (waiting if it's still in progress)
  for (let attempt = 0; attempt < 50; attempt++) {
    const stored = await pool.query(
      "SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE key = $1",
      [key]
    );
    const row = stored.rows[0];

    if (!row) break; // the first request failed and released the key
    if (row.request_hash !== requestHash) {
      return res.status(422).json({ error: "Idempotency-Key was already used with a different request body" });
    }
    if (row.response_status !== null) {
      // Send the stored text exactly as it was first sent
      return res.status(row.response_status).type("application/json").send(row.response_body);
    }
    await sleep(100); // first request still working: wait and check again
  }

  return res.status(409).json({ error: "a request with this Idempotency-Key is still being processed" });
});

// ---------- GET /bookings: a person's bookings, paginated (Level 4) ----------

app.get("/bookings", async (req, res) => {
  const email = typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : "";
  if (!email) return res.status(400).json({ error: "email is required" });

  // limit: whole number from 1 to 50, default 10
  let limit = 10;
  if (req.query.limit !== undefined) {
    const raw = String(req.query.limit);
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 50) {
      return res.status(400).json({ error: "limit must be a whole number from 1 to 50" });
    }
    limit = Number(raw);
  }

  const params: unknown[] = [email];
  let sql = "SELECT * FROM bookings WHERE email = $1";

  // cursor: the id of the last booking on the previous page
  const cursor = req.query.cursor;
  if (cursor !== undefined) {
    if (typeof cursor !== "string" || !UUID_PATTERN.test(cursor)) {
      return res.status(400).json({ error: "cursor is not valid" });
    }
    const anchor = await pool.query(
      "SELECT 1 FROM bookings WHERE id = $1 AND email = $2",
      [cursor, email]
    );
    if (anchor.rows.length === 0) {
      return res.status(400).json({ error: "cursor is not valid" });
    }
    params.push(cursor);
    sql += ` AND (created_at, id) > (SELECT created_at, id FROM bookings WHERE id = $${params.length})`;
  }

  params.push(limit + 1);
  sql += ` ORDER BY created_at ASC, id ASC LIMIT $${params.length}`;

  const result = await pool.query(sql, params);
  const hasMore = result.rows.length > limit;
  const page = result.rows.slice(0, limit);

  res.json({
    bookings: page.map(formatBooking),
    next_cursor: hasMore ? page[page.length - 1].id : null,
  });
});

// ---------- GET /bookings/:id ----------

app.get("/bookings/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_PATTERN.test(id)) {
    return res.status(404).json({ error: "booking not found" });
  }

  const result = await pool.query("SELECT * FROM bookings WHERE id = $1", [id]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "booking not found" });
  }
  res.json(formatBooking(result.rows[0]));
});

// ---------- DELETE /bookings/:id (Level 3) ----------

app.delete("/bookings/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_PATTERN.test(id)) {
    return res.status(404).json({ error: "booking not found" });
  }

  // Cancel only if it's currently confirmed (one atomic step)
  const result = await pool.query(
    `UPDATE bookings SET status = 'cancelled'
     WHERE id = $1 AND status = 'confirmed'
     RETURNING *`,
    [id]
  );

  if (result.rows.length > 0) {
    return res.status(200).json(formatBooking(result.rows[0]));
  }

  // Nothing was updated: find out why
  const existing = await pool.query("SELECT status FROM bookings WHERE id = $1", [id]);
  if (existing.rows.length === 0) {
    return res.status(404).json({ error: "booking not found" });
  }
  return res.status(409).json({ error: "booking already cancelled" });
});

// ---------- React app (production) ----------

const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));

// ---------- Error handler: every error becomes {"error": "..."} ----------

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "request body is not valid JSON" });
  }
  console.error(err);
  res.status(500).json({ error: "internal server error" });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`API running on http://localhost:${port}`));