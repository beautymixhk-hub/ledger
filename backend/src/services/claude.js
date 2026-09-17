import Anthropic from "@anthropic-ai/sdk";
import { query } from "../db.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

/** Record token spend so an org can see what the AI costs. */
async function recordUsage({ orgId, userId, operation, usage }) {
  if (!orgId || !usage) return;
  try {
    await query(
      `INSERT INTO ai_usage (org_id, user_id, operation, input_tokens, output_tokens)
       VALUES ($1,$2,$3,$4,$5)`,
      [orgId, userId || null, operation, usage.input_tokens || 0, usage.output_tokens || 0]
    );
  } catch (err) {
    console.error("usage log failed:", err.message);
  }
}

function textFrom(message) {
  return (message.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** Claude sometimes wraps JSON in prose or fences. Pull the JSON out safely. */
function extractJson(raw, expect = "array") {
  let s = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  const open = expect === "array" ? "[" : "{";
  const close = expect === "array" ? "]" : "}";
  const a = s.indexOf(open);
  const b = s.lastIndexOf(close);
  if (a === -1 || b === -1) throw new Error("No JSON found in model response");
  return JSON.parse(s.slice(a, b + 1));
}

// ---------------------------------------------------------------- lead search
export async function searchLeads({ icp, location, count, orgId, userId }) {
  const prompt = `Search the web for real, currently-operating businesses in ${location} that match this description:

"${icp}"

Find up to ${count} distinct businesses. Rules:
- Only include businesses you found real evidence for during your search (a live website, directory listing, or article).
- Never invent a business, an email address, or a URL. If you could not verify something, leave it as "".
- Only include organisations and businesses. Do not return private individuals or personal contact details.
- For email, use only a general business address publicly listed on the company's own site (info@, contact@, sales@). Never guess an address pattern.
- Give each a fit_score from 0-100 for how well it matches the description, and one sentence explaining the score.

Respond with ONLY a JSON array, no markdown fences and no commentary. Each item:
{"name","category","location","email","website","description","source","fit_score","fit_reason"}`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 12 }],
  });

  await recordUsage({ orgId, userId, operation: "search_leads", usage: message.usage });

  const parsed = extractJson(textFrom(message), "array");
  if (!Array.isArray(parsed)) throw new Error("Model did not return a list");

  return parsed
    .filter((r) => r && r.name)
    .map((r) => ({
      name: String(r.name).slice(0, 300),
      category: r.category || "",
      location: r.location || "",
      email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email || "") ? r.email : "",
      website: r.website || "",
      description: r.description || "",
      source_url: r.source || "",
      fit_score: Number.isFinite(Number(r.fit_score)) ? Math.max(0, Math.min(100, Number(r.fit_score))) : null,
      fit_reason: r.fit_reason || "",
    }));
}

// ---------------------------------------------------------------- email draft
export async function draftEmail({ lead, product, tone, sender, competitorContext, orgId, userId }) {
  const specLines = (product.specs || []).map((s) => `• ${s.label}: ${s.value}`).join("\n");

  const prompt = `Write one cold B2B outreach email to a prospective business customer in the United States.

WHAT WE SELL
${product.name}
${product.tagline || ""}
${product.summary || ""}
${specLines}

RECIPIENT BUSINESS
Name: ${lead.name}
Category: ${lead.category || "unknown"}
Location: ${lead.location || "unknown"}
Website: ${lead.website || "unknown"}
What we know: ${lead.description || "nothing beyond the above"}

SENDER
${sender.name}${sender.company ? `, ${sender.company}` : ""}
${competitorContext ? `\nCOMPETITIVE CONTEXT (for your framing only, do not name competitors in the email):\n${competitorContext}` : ""}

REQUIREMENTS
- Tone: ${tone}
- Body under 120 words, short paragraphs, plain text.
- Open with something specific and true about THIS business drawn from the data above. If you have nothing specific, open honestly and generally rather than inventing a detail.
- One clear low-pressure ask (e.g. whether they'd like the full spec sheet or a sample unit).
- Do NOT include a greeting line beyond the opener, a signature, a spec list, or an unsubscribe line. Those are appended automatically.
- Do NOT make medical, clinical, or therapeutic efficacy claims, and do not claim regulatory clearance the product may not have.
- Do NOT use fake urgency, false familiarity ("as we discussed"), or misleading subject lines.

Respond with ONLY a JSON object, no fences: {"subject": "...", "body": "..."}`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  await recordUsage({ orgId, userId, operation: "draft_email", usage: message.usage });

  const parsed = extractJson(textFrom(message), "object");
  return {
    subject: String(parsed.subject || "").slice(0, 200),
    body: String(parsed.body || ""),
  };
}

// ---------------------------------------------------------------- reply triage
export async function classifyReply({ replyText, lead, orgId, userId }) {
  const prompt = `A prospect replied to a cold sales email. Classify the reply.

PROSPECT: ${lead?.name || "unknown"}

REPLY:
"""
${replyText.slice(0, 6000)}
"""

Respond with ONLY a JSON object, no fences:
{
  "sentiment": one of "interested" | "not_interested" | "question" | "unsubscribe" | "out_of_office" | "other",
  "summary": one sentence in plain English,
  "suggested_next_step": one short sentence on what the salesperson should do next
}

Important: if the reply asks to stop contact, be removed, or says anything equivalent to opting out, classify it as "unsubscribe".`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
  });

  await recordUsage({ orgId, userId, operation: "classify_reply", usage: message.usage });

  const parsed = extractJson(textFrom(message), "object");
  const allowed = ["interested", "not_interested", "question", "unsubscribe", "out_of_office", "other"];
  return {
    sentiment: allowed.includes(parsed.sentiment) ? parsed.sentiment : "other",
    summary: parsed.summary || "",
    suggested_next_step: parsed.suggested_next_step || "",
  };
}

// ------------------------------------------------------- competitor research
export async function researchCompetitors({ marketDescription, count, orgId, userId }) {
  const prompt = `Search the web for companies that sell products competing in this market:

"${marketDescription}"

Find up to ${count} distinct competitors. Rules:
- Use only publicly available information: their own website, published pricing pages, press coverage, public product listings.
- Never invent a company, a price, or a claim. Leave a field as "" if you could not verify it.
- "positioning" = how they publicly present themselves, in one sentence.
- "price_point" = publicly listed pricing only; "" if they don't publish it.
- "strengths" and "weaknesses" = your assessment based on public information, stated as assessment rather than fact.

Respond with ONLY a JSON array, no fences. Each item:
{"name","website","positioning","price_point","strengths","weaknesses","source"}`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 6000,
    messages: [{ role: "user", content: prompt }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 12 }],
  });

  await recordUsage({ orgId, userId, operation: "competitor_research", usage: message.usage });

  const parsed = extractJson(textFrom(message), "array");
  return parsed
    .filter((c) => c && c.name)
    .map((c) => ({
      name: String(c.name).slice(0, 300),
      website: c.website || "",
      positioning: c.positioning || "",
      price_point: c.price_point || "",
      strengths: c.strengths || "",
      weaknesses: c.weaknesses || "",
      source_url: c.source || "",
    }));
}

// ---------------------------------------------------------------- battlecard
export async function buildBattlecard({ competitor, product, orgId, userId }) {
  const specLines = (product.specs || []).map((s) => `• ${s.label}: ${s.value}`).join("\n");

  const prompt = `Create an internal sales battlecard comparing our product against a competitor.

OUR PRODUCT
${product.name}
${product.tagline || ""}
${product.summary || ""}
${specLines}

COMPETITOR
Name: ${competitor.name}
Website: ${competitor.website || "unknown"}
Positioning: ${competitor.positioning || "unknown"}
Public pricing: ${competitor.price_point || "not published"}
Noted strengths: ${competitor.strengths || "unknown"}
Noted weaknesses: ${competitor.weaknesses || "unknown"}

Write it for our own sales team's internal use. Be honest — where the competitor is genuinely stronger, say so plainly, because a rep who is surprised in a call loses the deal. Do not invent facts about either product. Do not suggest disparaging the competitor or making claims we cannot support.

Respond with ONLY a JSON object, no fences:
{
  "whereWeWin": [up to 4 short strings],
  "whereTheyWin": [up to 4 short strings],
  "objections": [up to 5 objects {"objection": "...", "response": "..."}]
}`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  await recordUsage({ orgId, userId, operation: "battlecard", usage: message.usage });

  const parsed = extractJson(textFrom(message), "object");
  return {
    whereWeWin: Array.isArray(parsed.whereWeWin) ? parsed.whereWeWin.slice(0, 4) : [],
    whereTheyWin: Array.isArray(parsed.whereTheyWin) ? parsed.whereTheyWin.slice(0, 4) : [],
    objections: Array.isArray(parsed.objections) ? parsed.objections.slice(0, 5) : [],
  };
}
