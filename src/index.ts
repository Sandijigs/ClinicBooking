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

app.post("/bookings", async (req, res) => {
  const body = req.body ?? {};

  // 1. Every field must be a non-empty string (after trimming)
  const slotId = typeof body.slot_id === "string" ? body.slot_id.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!slotId) return res.status(400).json({ error: "slot_id is required" });
  if (!name) return res.status(400).json({ error: "name is required" });
  if (!email) return res.status(400).json({ error: "email is required" });

  // 2. Email must look like an email
  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: "email is not valid" });
  }

  // 3. The slot must exist and must not have started yet
  const slotResult = await pool.query(
    "SELECT start_at <= now() AS started FROM slots WHERE id = $1",
    [slotId]
  );
  if (slotResult.rows.length === 0) {
    return res.status(404).json({ error: "slot not found" });
  }
  if (slotResult.rows[0].started) {
    return res.status(400).json({ error: "slot has already started" });
  }

  // 4. Create the booking (the unique index still blocks double booking)
  try {
    const result = await pool.query(
      `INSERT INTO bookings (slot_id, name, email)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [slotId, name, email]
    );
    res.status(201).json(formatBooking(result.rows[0]));
  } catch (err: any) {
    if (err.code === "23503") {
      return res.status(404).json({ error: "slot not found" });
    }
    if (err.code === "23505") {
      return res.status(409).json({ error: "slot already booked" });
    }
    throw err;
  }
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