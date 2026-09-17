import express from "express";
import { z } from "zod";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { researchCompetitors, buildBattlecard } from "../services/ai.js";

const router = express.Router();
router.use(requireAuth);

/** Research competitors from public sources. */
router.post("/research", async (req, res) => {
  const schema = z.object({
    market: z.string().min(3).max(1000),
    count: z.number().int().min(1).max(15).default(6),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const found = await researchCompetitors({
      marketDescription: parsed.data.market,
      count: parsed.data.count,
      orgId: req.user.org_id,
      userId: req.user.id,
    });

    const inserted = [];
    for (const c of found) {
      const { rows } = await query(
        `INSERT INTO competitors (org_id, name, website, positioning, price_point, strengths, weaknesses, source_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.user.org_id, c.name, c.website, c.positioning, c.price_point, c.strengths, c.weaknesses, c.source_url]
      );
      inserted.push(rows[0]);
    }
    res.json({ added: inserted.length, competitors: inserted });
  } catch (err) {
    console.error("competitor research failed:", err);
    res.status(502).json({ error: `Research failed: ${err.message}` });
  }
});

router.get("/", async (req, res) => {
  const { rows } = await query(
    `SELECT c.*,
            (SELECT b.content FROM battlecards b WHERE b.competitor_id = c.id
              ORDER BY b.created_at DESC LIMIT 1) AS battlecard
       FROM competitors c
      WHERE c.org_id=$1
      ORDER BY c.created_at DESC`,
    [req.user.org_id]
  );
  res.json(rows);
});

router.post("/", async (req, res) => {
  const schema = z.object({
    name: z.string().min(1),
    website: z.string().optional(),
    positioning: z.string().optional(),
    price_point: z.string().optional(),
    strengths: z.string().optional(),
    weaknesses: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  const d = parsed.data;
  const { rows } = await query(
    `INSERT INTO competitors (org_id, name, website, positioning, price_point, strengths, weaknesses)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.user.org_id, d.name, d.website || null, d.positioning || null, d.price_point || null,
     d.strengths || null, d.weaknesses || null]
  );
  res.json(rows[0]);
});

/** Generate a sales battlecard against one competitor. */
router.post("/:id/battlecard", async (req, res) => {
  const orgId = req.user.org_id;

  const { rows: comps } = await query(`SELECT * FROM competitors WHERE id=$1 AND org_id=$2`, [
    req.params.id,
    orgId,
  ]);
  if (!comps.length) return res.status(404).json({ error: "Competitor not found" });

  const { rows: products } = await query(
    `SELECT * FROM products WHERE org_id=$1 ORDER BY created_at LIMIT 1`,
    [orgId]
  );
  if (!products.length) return res.status(400).json({ error: "Set up a product first" });

  try {
    const content = await buildBattlecard({
      competitor: comps[0],
      product: { ...products[0], specs: products[0].specs || [] },
      orgId,
      userId: req.user.id,
    });

    const { rows } = await query(
      `INSERT INTO battlecards (org_id, competitor_id, product_id, content)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [orgId, comps[0].id, products[0].id, JSON.stringify(content)]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(502).json({ error: `Battlecard generation failed: ${err.message}` });
  }
});

router.delete("/:id", async (req, res) => {
  await query(`DELETE FROM competitors WHERE id=$1 AND org_id=$2`, [req.params.id, req.user.org_id]);
  res.json({ ok: true });
});

export default router;
