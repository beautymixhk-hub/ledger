import express from "express";
import { query } from "../db.js";
import { suppress } from "../services/email.js";

const router = express.Router();

/**
 * Public unsubscribe endpoint. Linked in every email and in the
 * List-Unsubscribe header. No auth — the recipient must be able to use it.
 * Handles GET (link click) and POST (Gmail/Yahoo one-click).
 */
async function handleUnsubscribe(req, res) {
  const email = req.query.e || req.body?.e;
  const orgId = req.query.o || req.body?.o;

  if (!email || !orgId) return res.status(400).send("Invalid unsubscribe link.");

  try {
    await suppress(orgId, email, "unsubscribe");
    await query(
      `UPDATE leads SET status='unsubscribed', updated_at=now()
        WHERE org_id=$1 AND lower(email)=lower($2)`,
      [orgId, email]
    );
  } catch (err) {
    console.error("unsubscribe failed:", err.message);
  }

  // Always confirm, even on error — never leave someone unsure whether it worked.
  res.status(200).send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Unsubscribed</title></head>
<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f4f4f1;margin:0;padding:60px 20px;">
  <div style="max-width:440px;margin:0 auto;background:#fff;border-radius:4px;padding:32px;text-align:center;">
    <h1 style="font-size:20px;margin:0 0 10px;color:#1e241c;">You're unsubscribed</h1>
    <p style="color:#55604f;font-size:14px;line-height:1.6;margin:0;">
      We've removed <strong>${String(email).replace(/[<>&]/g, "")}</strong> from our list.
      You won't receive further messages from us.
    </p>
  </div>
</body></html>`);
}

router.get("/unsubscribe", handleUnsubscribe);
router.post("/unsubscribe", handleUnsubscribe);

/**
 * Resend webhook — delivery, open, click, bounce and complaint events.
 * Configure this URL in the Resend dashboard.
 */
router.post("/webhooks/resend", async (req, res) => {
  const event = req.body;
  const type = event?.type || "";
  const messageId = event?.data?.email_id;

  if (!messageId) return res.json({ ok: true });

  const typeMap = {
    "email.delivered": "delivered",
    "email.opened": "opened",
    "email.clicked": "clicked",
    "email.bounced": "bounced",
    "email.complained": "complained",
  };
  const mapped = typeMap[type];
  if (!mapped) return res.json({ ok: true });

  try {
    const { rows } = await query(`SELECT id, org_id, to_email, lead_id FROM emails WHERE provider_id=$1`, [
      messageId,
    ]);
    if (!rows.length) return res.json({ ok: true });
    const email = rows[0];

    await query(`INSERT INTO email_events (email_id, type, payload) VALUES ($1,$2,$3)`, [
      email.id,
      mapped,
      JSON.stringify(event.data || {}),
    ]);

    // A hard bounce or spam complaint means we stop contacting this address.
    if (mapped === "bounced" || mapped === "complained") {
      await suppress(email.org_id, email.to_email, mapped === "bounced" ? "bounce" : "complaint");
      await query(`UPDATE emails SET status='bounced' WHERE id=$1`, [email.id]);
      await query(`UPDATE leads SET status=$2, updated_at=now() WHERE id=$1`, [
        email.lead_id,
        mapped === "bounced" ? "bounced" : "unsubscribed",
      ]);
    }
  } catch (err) {
    console.error("webhook handling failed:", err.message);
  }

  res.json({ ok: true });
});

export default router;
