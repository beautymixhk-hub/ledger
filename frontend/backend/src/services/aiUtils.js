import { query } from "../db.js";

/** Record token spend so an org can see what the AI costs, per provider. */
export async function recordUsage({ orgId, userId, operation, provider, usage }) {
  if (!orgId || !usage) return;
  try {
    await query(
      `INSERT INTO ai_usage (org_id, user_id, operation, provider, input_tokens, output_tokens)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [orgId, userId || null, operation, provider, usage.input_tokens || 0, usage.output_tokens || 0]
    );
  } catch (err) {
    console.error("usage log failed:", err.message);
  }
}

/** Models sometimes wrap JSON in prose or markdown fences. Pull the JSON out safely. */
export function extractJson(raw, expect = "array") {
  let s = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  const open = expect === "array" ? "[" : "{";
  const close = expect === "array" ? "]" : "}";
  const a = s.indexOf(open);
  const b = s.lastIndexOf(close);
  if (a === -1 || b === -1) throw new Error("No JSON found in model response");
  return JSON.parse(s.slice(a, b + 1));
}
