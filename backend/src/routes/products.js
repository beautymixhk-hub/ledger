import express from "express";
import { z } from "zod";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const { rows } = await query(`SELECT * FROM products WHERE org_id=$1 ORDER BY created_at`, [
    req.user.org_id,
  ]);
  res.json(rows);
});

const productSchema = z.object({
  name: z.string().min(1).max(300),
  tagline: z.string().max(500).optional().default(""),
  summary: z.string().max(4000).optional().default(""),
  specs: z
    .array(z.object({ label: z.string().max(120), value: z.string().max(600) }))
    .max(30)
    .optional()
    .default([]),
});

router.post("/", async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const d = parsed.data;
  const { rows } = await query(
    `INSERT INTO products (org_id, name, tagline, summary, specs)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.org_id, d.name, d.tagline, d.summary, JSON.stringify(d.specs)]
  );
  res.json(rows[0]);
});

router.put("/:id", async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const d = parsed.data;
  const { rows } = await query(
    `UPDATE products SET name=$3, tagline=$4, summary=$5, specs=$6, updated_at=now()
      WHERE id=$1 AND org_id=$2 RETURNING *`,
    [req.params.id, req.user.org_id, d.name, d.tagline, d.summary, JSON.stringify(d.specs)]
  );
  if (!rows.length) return res.status(404).json({ error: "Product not found" });
  res.json(rows[0]);
});

export default router;
