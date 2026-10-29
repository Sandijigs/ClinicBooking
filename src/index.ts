import "dotenv/config";
import express from "express";
import path from "path";
import { Pool } from "pg";

const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.get("/health", async (_req, res) => {
  const result = await pool.query("SELECT now() AS time");
  res.json({ ok: true, dbTime: result.rows[0].time });
});

// Serve the built React app (production)
const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`API running on http://localhost:${port}`));