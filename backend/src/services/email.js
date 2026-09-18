import { Resend } from "resend";
import { query } from "../db.js";

// Created lazily (only when actually sending) so the app can start, and every
// other feature (auth, lead search, drafting) still work, even before
// RESEND_API_KEY is configured.
let _resend = null;
function getResend() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not set. Add it in your environment variables before sending email.");
  }
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

const SEND_DELAY_MS = Number(process.env.SEND_DELAY_MS || 1200);
const MAX_PER_CAMPAIGN = Number(process.env.MAX_EMAILS_PER_CAMPAIGN || 200);
const MAX_PER_DAY = Number(process.env.MAX_EMAILS_PER_DAY_PER_ORG || 500);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function esc(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Assemble the full email. The spec sheet, signature, postal address and
 * unsubscribe link are appended here rather than written by the model, so
 * every outgoing message is consistent and CAN-SPAM compliant.
 */
export function composeEmail({ draft, product, org, sender, unsubscribeUrl }) {
  const specLines = (product.specs || []).map((s) => `${s.label}: ${s.value}`);

  const textParts = [
    draft.body.trim(),
    "----------------------------------------",
    `PRODUCT SPECIFICATION — ${product.name}`,
    product.tagline || "",
    product.summary || "",
    specLines.map((l) => `  • ${l}`).join("\n"),
    "----------------------------------------",
    [sender.name, sender.company, sender.email].filter(Boolean).join("\n"),
    org.postal_address || "",
    `You received this message as a business enquiry. To stop receiving these, unsubscribe here: ${unsubscribeUrl}`,
  ].filter(Boolean);

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f1;">
<div style="max-width:600px;margin:0 auto;padding:28px 24px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1e241c;background:#ffffff;">
  <div style="white-space:pre-wrap;">${esc(draft.body.trim())}</div>

  <hr style="border:none;border-top:1px solid #d8d8d0;margin:26px 0;">

  <div style="font-size:13px;">
    <div style="font-weight:600;font-size:15px;margin-bottom:2px;">${esc(product.name)}</div>
    ${product.tagline ? `<div style="color:#5b6156;margin-bottom:10px;">${esc(product.tagline)}</div>` : ""}
    ${product.summary ? `<div style="margin-bottom:12px;">${esc(product.summary)}</div>` : ""}
    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      ${specLines
        .map(
          (l) => {
            const [label, ...rest] = l.split(":");
            return `<tr>
              <td style="padding:5px 10px 5px 0;color:#5b6156;white-space:nowrap;vertical-align:top;">${esc(label)}</td>
              <td style="padding:5px 0;">${esc(rest.join(":").trim())}</td>
            </tr>`;
          }
        )
        .join("")}
    </table>
  </div>

  <hr style="border:none;border-top:1px solid #d8d8d0;margin:26px 0;">

  <div style="font-size:13px;color:#5b6156;white-space:pre-wrap;">${esc(
    [sender.name, sender.company, sender.email].filter(Boolean).join("\n")
  )}</div>

  <div style="font-size:11px;color:#8a8f86;margin-top:18px;line-height:1.5;">
    ${org.postal_address ? `${esc(org.postal_address)}<br><br>` : ""}
    You received this message as a business enquiry.
    <a href="${unsubscribeUrl}" style="color:#5B3A5C;">Unsubscribe</a> to stop receiving these.
  </div>
</div>
</body></html>`;

  return { text: textParts.join("\n\n"), html };
}

/** True if this address has opted out, bounced, or complained. */
export async function isSuppressed(orgId, email) {
  const { rows } = await query(
    `SELECT 1 FROM suppressions WHERE org_id = $1 AND lower(email) = lower($2) LIMIT 1`,
    [orgId, email]
  );
  return rows.length > 0;
}

export async function suppress(orgId, email, reason) {
  await query(
    `INSERT INTO suppressions (org_id, email, reason) VALUES ($1,$2,$3)
     ON CONFLICT (org_id, lower(email)) DO NOTHING`,
    [orgId, email, reason]
  );
}

/** How many emails this org has already sent today. */
async function sentToday(orgId) {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM emails
     WHERE org_id = $1 AND status = 'sent' AND sent_at > now() - interval '24 hours'`,
    [orgId]
  );
  return rows[0].n;
}

/**
 * Send every approved email in a campaign, one at a time with a delay.
 * Skips suppressed addresses. Enforces hard daily and per-campaign caps.
 */
export async function sendCampaign({ campaignId, orgId, org, sender, product, onProgress }) {
  const { rows: pending } = await query(
    `SELECT e.*, l.name AS lead_name
       FROM emails e
       JOIN leads l ON l.id = e.lead_id
      WHERE e.campaign_id = $1 AND e.status = 'approved'
      ORDER BY e.created_at`,
    [campaignId]
  );

  if (pending.length > MAX_PER_CAMPAIGN) {
    throw new Error(`Campaign has ${pending.length} emails, over the ${MAX_PER_CAMPAIGN} cap.`);
  }

  const alreadySent = await sentToday(orgId);
  const budget = Math.max(0, MAX_PER_DAY - alreadySent);
  if (budget === 0) {
    throw new Error(`Daily sending cap of ${MAX_PER_DAY} reached. Try again tomorrow.`);
  }

  const results = { sent: 0, skipped: 0, failed: 0, details: [] };

  for (const email of pending.slice(0, budget)) {
    if (await isSuppressed(orgId, email.to_email)) {
      await query(`UPDATE emails SET status='failed', error='suppressed' WHERE id=$1`, [email.id]);
      results.skipped++;
      results.details.push({ lead: email.lead_name, result: "skipped (unsubscribed or bounced)" });
      continue;
    }

    const unsubscribeUrl = `${process.env.API_URL}/api/unsubscribe?e=${encodeURIComponent(
      email.to_email
    )}&o=${orgId}`;

    const { text, html } = composeEmail({
      draft: { body: email.body },
      product,
      org,
      sender,
      unsubscribeUrl,
    });

    try {
      await query(`UPDATE emails SET status='sending' WHERE id=$1`, [email.id]);

      const res = await getResend().emails.send({
        from: `${process.env.MAIL_FROM_NAME} <${process.env.MAIL_FROM_EMAIL}>`,
        to: email.to_email,
        replyTo: org.reply_to_email || sender.email,
        subject: email.subject,
        text,
        html,
        headers: {
          // One-click unsubscribe. Gmail and Yahoo require this for bulk senders.
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });

      if (res.error) throw new Error(res.error.message || "provider rejected the message");

      await query(
        `UPDATE emails SET status='sent', provider_id=$2, sent_at=now(), error=NULL WHERE id=$1`,
        [email.id, res.data?.id || null]
      );
      await query(`UPDATE leads SET status='contacted', updated_at=now() WHERE id=$1`, [email.lead_id]);

      results.sent++;
      results.details.push({ lead: email.lead_name, result: "sent" });
    } catch (err) {
      await query(`UPDATE emails SET status='failed', error=$2 WHERE id=$1`, [email.id, err.message]);
      results.failed++;
      results.details.push({ lead: email.lead_name, result: `failed: ${err.message}` });
    }

    onProgress?.(results);
    await sleep(SEND_DELAY_MS);
  }

  const leftover = pending.length - Math.min(pending.length, budget);
  if (leftover > 0) {
    results.details.push({ lead: "—", result: `${leftover} held back by the daily cap` });
  }

  await query(`UPDATE campaigns SET status='sent' WHERE id=$1`, [campaignId]);
  return results;
}
