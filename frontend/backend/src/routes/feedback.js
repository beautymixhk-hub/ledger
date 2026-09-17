import express from "express";
import { z } from "zod";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { classifyReply } from "../services/ai.js";
import { suppress } from "../services/email.js";

const router = express.Router();
router.use(requireAuth);

/**
 * Log a reply and have Claude classify it.
 * A salesperson pastes in what the prospect wrote (or an inbox integration posts here).
 */
router.post("/replies", async (req, res) => {
  const schema = z.object({
    leadId: z.string().uuid(),
    emailId: z.string().uuid().optional(),
    text: z.string().min(1).max(20000),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  const orgId = req.user.org_id;
  const { rows: leads } = await query(`SELECT * FROM leads WHERE id=$1 AND org_id=$2`, [
    parsed.data.leadId,
    orgId,
  ]);
  if (!leads.length) return res.status(404).json({ error: "Lead not found" });
  const lead = leads[0];

  let classified = { sentiment: "other", summary: "", suggested_next_step: "" };
  try {
    classified = await classifyReply({
      replyText: parsed.data.text,
      lead,
      orgId,
      userId: req.user.id,
    });
  } catch (err) {
    console.error("classify failed:", err.message);
  }

  const { rows } = await query(
    `INSERT INTO replies (org_id, lead_id, email_id, raw_text, sentiment, summary, suggested_next_step)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      orgId,
      lead.id,
      parsed.data.emailId || null,
      parsed.data.text,
      classified.sentiment,
      classified.summary,
      classified.suggested_next_step,
    ]
  );

  // Move the lead's status to match what they actually said.
  const statusMap = {
    interested: "interested",
    not_interested: "not_interested",
    unsubscribe: "unsubscribed",
    question: "replied",
    out_of_office: "contacted",
    other: "replied",
  };
  await query(`UPDATE leads SET status=$2, updated_at=now() WHERE id=$1`, [
    lead.id,
    statusMap[classified.sentiment] || "replied",
  ]);

  // An opt-out is honoured immediately and permanently.
  if (classified.sentiment === "unsubscribe" && lead.email) {
    await suppress(orgId, lead.email, "unsubscribe");
  }

  res.json({ reply: rows[0], suppressed: classified.sentiment === "unsubscribe" });
});

router.get("/replies", async (req, res) => {
  const { rows } = await query(
    `SELECT r.*, l.name AS lead_name, l.email AS lead_email
       FROM replies r JOIN leads l ON l.id = r.lead_id
      WHERE r.org_id=$1
      ORDER BY r.created_at DESC LIMIT 200`,
    [req.user.org_id]
  );
  res.json(rows);
});

/** Dashboard numbers. */
router.get("/stats", async (req, res) => {
  const orgId = req.user.org_id;

  const [leads, emails, events, replies, usage] = await Promise.all([
    query(`SELECT status, count(*)::int AS n FROM leads WHERE org_id=$1 GROUP BY status`, [orgId]),
    query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status='sent')::int AS sent,
              count(*) FILTER (WHERE status='failed')::int AS failed
         FROM emails WHERE org_id=$1`,
      [orgId]
    ),
    query(
      `SELECT ev.type, count(DISTINCT ev.email_id)::int AS n
         FROM email_events ev JOIN emails e ON e.id = ev.email_id
        WHERE e.org_id=$1 GROUP BY ev.type`,
      [orgId]
    ),
    query(`SELECT sentiment, count(*)::int AS n FROM replies WHERE org_id=$1 GROUP BY sentiment`, [orgId]),
    query(
      `SELECT coalesce(sum(input_tokens),0)::int AS input_tokens,
              coalesce(sum(output_tokens),0)::int AS output_tokens
         FROM ai_usage WHERE org_id=$1 AND created_at > now() - interval '30 days'`,
      [orgId]
    ),
  ]);

  const sent = emails.rows[0]?.sent || 0;
  const opened = events.rows.find((r) => r.type === "opened")?.n || 0;
  const clicked = events.rows.find((r) => r.type === "clicked")?.n || 0;
  const replyCount = replies.rows.reduce((a, r) => a + r.n, 0);

  res.json({
    leads: leads.rows,
    emails: emails.rows[0],
    engagement: {
      sent,
      opened,
      clicked,
      replies: replyCount,
      openRate: sent ? +((opened / sent) * 100).toFixed(1) : 0,
      clickRate: sent ? +((clicked / sent) * 100).toFixed(1) : 0,
      replyRate: sent ? +((replyCount / sent) * 100).toFixed(1) : 0,
    },
    replies: replies.rows,
    aiUsage30d: usage.rows[0],
  });
});

export default router;
