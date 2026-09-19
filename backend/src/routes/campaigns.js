import express from "express";
import { z } from "zod";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { draftEmail } from "../services/ai.js";
import { sendCampaign, isSuppressed } from "../services/email.js";

const router = express.Router();
router.use(requireAuth);

async function getProduct(orgId, productId) {
  const { rows } = await query(
    productId
      ? `SELECT * FROM products WHERE org_id=$1 AND id=$2`
      : `SELECT * FROM products WHERE org_id=$1 ORDER BY created_at LIMIT 1`,
    productId ? [orgId, productId] : [orgId]
  );
  return rows[0];
}

/** Create a campaign and draft one email per selected lead. */
router.post("/", async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(200),
    leadIds: z.array(z.string().uuid()).min(1).max(200),
    productId: z.string().uuid().optional(),
    tone: z.string().default("Professional & concise"),
    useCompetitorContext: z.boolean().default(false),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  const { name, leadIds, productId, tone, useCompetitorContext } = parsed.data;
  const orgId = req.user.org_id;

  const product = await getProduct(orgId, productId);
  if (!product) return res.status(400).json({ error: "Set up a product first" });

  const { rows: orgRows } = await query(`SELECT * FROM orgs WHERE id=$1`, [orgId]);
  const org = orgRows[0];

  let competitorContext = "";
  if (useCompetitorContext) {
    const { rows } = await query(
      `SELECT name, positioning, price_point FROM competitors WHERE org_id=$1 LIMIT 5`,
      [orgId]
    );
    competitorContext = rows
      .map((c) => `${c.name}: ${c.positioning || "?"}${c.price_point ? ` (${c.price_point})` : ""}`)
      .join("\n");
  }

  const { rows: campaignRows } = await query(
    `INSERT INTO campaigns (org_id, product_id, created_by, name, tone)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [orgId, product.id, req.user.id, name, tone]
  );
  const campaign = campaignRows[0];

  const { rows: leads } = await query(
    `SELECT * FROM leads WHERE org_id=$1 AND id = ANY($2::uuid[])`,
    [orgId, leadIds]
  );

  const drafted = [];
  const skipped = [];

  for (const lead of leads) {
    if (!lead.email) {
      skipped.push({ lead: lead.name, reason: "no email address on file" });
      continue;
    }
    if (await isSuppressed(orgId, lead.email)) {
      skipped.push({ lead: lead.name, reason: "unsubscribed or previously bounced" });
      continue;
    }

    try {
      const draft = await draftEmail({
        lead,
        product: { ...product, specs: product.specs || [] },
        tone,
        sender: { name: req.user.name, company: org.name, email: org.reply_to_email || req.user.email },
        competitorContext,
        orgId,
        userId: req.user.id,
      });

      const { rows } = await query(
        `INSERT INTO emails (org_id, campaign_id, lead_id, to_email, subject, body)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (campaign_id, lead_id) DO NOTHING
         RETURNING *`,
        [orgId, campaign.id, lead.id, lead.email, draft.subject, draft.body]
      );
      if (rows[0]) {
        drafted.push({ ...rows[0], lead_name: lead.name });
        await query(`UPDATE leads SET status='queued', updated_at=now() WHERE id=$1`, [lead.id]);
      }
    } catch (err) {
      skipped.push({ lead: lead.name, reason: `draft failed: ${err.message}` });
    }
  }

  res.json({ campaign, drafted, skipped });
});

router.get("/", async (req, res) => {
  const { rows } = await query(
    `SELECT c.*,
            u.name AS created_by_name,
            count(e.id)::int AS total,
            count(e.id) FILTER (WHERE e.status='sent')::int AS sent,
            count(e.id) FILTER (WHERE e.status='approved')::int AS approved,
            count(e.id) FILTER (WHERE e.status='failed')::int AS failed
       FROM campaigns c
       LEFT JOIN emails e ON e.campaign_id = c.id
       LEFT JOIN users u ON u.id = c.created_by
      WHERE c.org_id = $1
      GROUP BY c.id, u.name
      ORDER BY c.created_at DESC`,
    [req.user.org_id]
  );
  res.json(rows);
});

router.get("/:id", async (req, res) => {
  const { rows: campaigns } = await query(`SELECT * FROM campaigns WHERE id=$1 AND org_id=$2`, [
    req.params.id,
    req.user.org_id,
  ]);
  if (!campaigns.length) return res.status(404).json({ error: "Campaign not found" });

  const { rows: emails } = await query(
    `SELECT e.*, l.name AS lead_name, l.website AS lead_website, l.location AS lead_location,
            (SELECT count(*)::int FROM email_events ev WHERE ev.email_id=e.id AND ev.type='opened') AS opens,
            (SELECT count(*)::int FROM email_events ev WHERE ev.email_id=e.id AND ev.type='clicked') AS clicks
       FROM emails e JOIN leads l ON l.id = e.lead_id
      WHERE e.campaign_id = $1
      ORDER BY e.created_at`,
    [req.params.id]
  );

  res.json({ campaign: campaigns[0], emails });
});

/** Edit a draft before it goes out. */
router.patch("/emails/:emailId", async (req, res) => {
  const { subject, body, status } = req.body || {};
  if (status && !["draft", "approved"].includes(status)) {
    return res.status(400).json({ error: "You can only move an email between draft and approved" });
  }

  const { rows } = await query(
    `UPDATE emails
        SET subject = COALESCE($3, subject),
            body = COALESCE($4, body),
            status = COALESCE($5, status),
            approved_by = CASE WHEN $5 = 'approved' THEN $6 ELSE approved_by END
      WHERE id=$1 AND org_id=$2 AND status IN ('draft','approved')
      RETURNING *`,
    [req.params.emailId, req.user.org_id, subject || null, body || null, status || null, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Draft not found, or it has already been sent" });
  res.json(rows[0]);
});

/** Approve every draft in one go. */
router.post("/:id/approve-all", async (req, res) => {
  const { rows } = await query(
    `UPDATE emails SET status='approved', approved_by=$3
      WHERE campaign_id=$1 AND org_id=$2 AND status='draft' RETURNING id`,
    [req.params.id, req.user.org_id, req.user.id]
  );
  res.json({ approved: rows.length });
});

/** Actually send. Requires a postal address on file. */
router.post("/:id/send", async (req, res) => {
  const orgId = req.user.org_id;
  const { rows: orgRows } = await query(`SELECT * FROM orgs WHERE id=$1`, [orgId]);
  const org = orgRows[0];

  if (!org.postal_address) {
    return res.status(400).json({
      error:
        "Add your physical mailing address in Settings first. US CAN-SPAM law requires it in every commercial email.",
    });
  }

  const { rows: campaigns } = await query(`SELECT * FROM campaigns WHERE id=$1 AND org_id=$2`, [
    req.params.id,
    orgId,
  ]);
  if (!campaigns.length) return res.status(404).json({ error: "Campaign not found" });

  const product = await getProduct(orgId, campaigns[0].product_id);

  try {
    await query(`UPDATE campaigns SET status='sending' WHERE id=$1`, [req.params.id]);
    const results = await sendCampaign({
      campaignId: req.params.id,
      orgId,
      org,
      product: { ...product, specs: product.specs || [] },
      sender: { name: req.user.name, company: org.name, email: org.reply_to_email || req.user.email },
    });
    res.json(results);
  } catch (err) {
    await query(`UPDATE campaigns SET status='paused' WHERE id=$1`, [req.params.id]);
    res.status(400).json({ error: err.message });
  }
});

/** Delete a campaign entirely, along with its drafted/sent emails.
 *  Blocked while a send is actively in progress, so a background send
 *  never ends up writing results for a campaign that no longer exists. */
router.delete("/:id", async (req, res) => {
  const orgId = req.user.org_id;
  const { rows } = await query(`SELECT status FROM campaigns WHERE id=$1 AND org_id=$2`, [
    req.params.id,
    orgId,
  ]);
  if (!rows.length) return res.status(404).json({ error: "Campaign not found" });
  if (rows[0].status === "sending") {
    return res.status(400).json({ error: "This campaign is actively sending — wait for it to finish before deleting." });
  }

  await query(`DELETE FROM campaigns WHERE id=$1 AND org_id=$2`, [req.params.id, orgId]);
  res.json({ ok: true });
});

export default router;
