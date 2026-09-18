import express from "express";
import { z } from "zod";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { searchLeads } from "../services/ai.js";

const router = express.Router();
router.use(requireAuth);

/** Insert leads, skipping any that already exist for this org. */
async function insertLeads(orgId, userId, items, origin) {
  const inserted = [];
  for (const it of items) {
    try {
      const { rows } = await query(
        `INSERT INTO leads (org_id, name, category, location, email, website, description,
                            source_url, origin, fit_score, fit_reason, owner_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (org_id, lower(name), coalesce(lower(website),'')) DO NOTHING
         RETURNING *`,
        [
          orgId,
          it.name,
          it.category || null,
          it.location || null,
          it.email || null,
          it.website || null,
          it.description || null,
          it.source_url || null,
          origin,
          it.fit_score ?? null,
          it.fit_reason || null,
          userId,
        ]
      );
      if (rows[0]) inserted.push(rows[0]);
    } catch (err) {
      console.error("lead insert skipped:", err.message);
    }
  }
  return inserted;
}

/** AI web search for new prospects. */
router.post("/search", async (req, res) => {
  const schema = z.object({
    icp: z.string().min(3).max(1000),
    location: z.string().min(2).max(200).default("United States"),
    count: z.number().int().min(1).max(25).default(10),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const found = await searchLeads({
      ...parsed.data,
      orgId: req.user.org_id,
      userId: req.user.id,
    });
    const inserted = await insertLeads(req.user.org_id, req.user.id, found, "search");
    res.json({
      found: found.length,
      added: inserted.length,
      duplicates: found.length - inserted.length,
      leads: inserted,
    });
  } catch (err) {
    console.error("lead search failed:", err);
    res.status(502).json({ error: `Search failed: ${err.message}` });
  }
});

/** Bulk import from a CSV the frontend has already parsed. */
router.post("/import", async (req, res) => {
  const schema = z.object({
    rows: z.array(z.record(z.any())).min(1).max(5000),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid rows payload" });

  // Map loosely-named CSV headers onto our columns.
  const pick = (row, names) => {
    const key = Object.keys(row).find((k) => names.some((n) => new RegExp(n, "i").test(k)));
    return key ? String(row[key]).trim() : "";
  };

  const items = parsed.data.rows
    .map((r) => ({
      name: pick(r, ["^name$", "company", "business", "organisation", "organization"]),
      category: pick(r, ["category", "industry", "type"]),
      location: pick(r, ["location", "city", "state", "address", "region"]),
      email: pick(r, ["email", "e-mail"]),
      website: pick(r, ["website", "url", "site", "domain"]),
      description: pick(r, ["description", "notes", "about"]),
    }))
    .filter((r) => r.name);

  if (!items.length) {
    return res.status(400).json({ error: "No usable rows — the file needs a name or company column" });
  }

  const inserted = await insertLeads(req.user.org_id, req.user.id, items, "csv");
  res.json({ found: items.length, added: inserted.length, duplicates: items.length - inserted.length });
});

/** List with filters. */
router.get("/", async (req, res) => {
  const { status, q, hasEmail, minScore, limit = 200, offset = 0 } = req.query;
  const where = ["l.org_id = $1"];
  const params = [req.user.org_id];

  if (status) {
    params.push(status);
    where.push(`l.status = $${params.length}`);
  }
  if (hasEmail === "true") where.push(`l.email IS NOT NULL AND l.email <> ''`);
  if (minScore) {
    params.push(Number(minScore));
    where.push(`l.fit_score >= $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(
      `(l.name ILIKE $${params.length} OR l.category ILIKE $${params.length}
        OR l.location ILIKE $${params.length} OR l.description ILIKE $${params.length})`
    );
  }
  params.push(Math.min(Number(limit), 500), Number(offset));

  const { rows } = await query(
    `SELECT l.*,
            EXISTS (SELECT 1 FROM suppressions s
                     WHERE s.org_id = l.org_id AND lower(s.email) = lower(l.email)) AS suppressed
       FROM leads l
      WHERE ${where.join(" AND ")}
      ORDER BY l.fit_score DESC NULLS LAST, l.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const { rows: counts } = await query(
    `SELECT status, count(*)::int AS n FROM leads WHERE org_id=$1 GROUP BY status`,
    [req.user.org_id]
  );

  res.json({ leads: rows, counts });
});

router.patch("/:id", async (req, res) => {
  const { status, email, owner_id } = req.body || {};
  const { rows } = await query(
    `UPDATE leads SET status = COALESCE($3, status),
                      email = COALESCE($4, email),
                      owner_id = COALESCE($5, owner_id),
                      updated_at = now()
      WHERE id = $1 AND org_id = $2 RETURNING *`,
    [req.params.id, req.user.org_id, status || null, email || null, owner_id || null]
  );
  if (!rows.length) return res.status(404).json({ error: "Lead not found" });
  res.json(rows[0]);
});

router.delete("/:id", async (req, res) => {
  await query(`DELETE FROM leads WHERE id=$1 AND org_id=$2`, [req.params.id, req.user.org_id]);
  res.json({ ok: true });
});

export default router;
