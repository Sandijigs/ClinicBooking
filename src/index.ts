import "dotenv/config";
import express from "express";
import path from "path";
import { Pool } from "pg";

const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------- Helpers ----------

// Turn a database Date into "2026-12-10T09:00:00Z" (the spec's format, no milliseconds)
function toIso(date: Date): string {
  return date.toISOString().replace(".000Z", "Z");
}

// Shape a booking row from the database into the JSON the spec wants
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

// ---------- Routes ----------

app.get("/health", async (_req, res) => {
  const result = await pool.query("SELECT now() AS time");
  res.json({ ok: true, dbTime: result.rows[0].time });
});

// POST /reset: delete all bookings and replace all slots (NEW)
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

// GET /slots: every slot, earliest first, with "available" (NEW)
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

// POST /bookings: book a slot (NEW, Level 1 version)
app.post("/bookings", async (req, res) => {
  const { slot_id, name, email } = req.body ?? {};

  try {
    const result = await pool.query(
      `INSERT INTO bookings (slot_id, name, email)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [slot_id, name, email]
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

// GET /bookings/:id: look up one booking (NEW)
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`API running on http://localhost:${port}`));