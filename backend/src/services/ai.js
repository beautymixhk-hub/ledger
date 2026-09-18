import { query } from "../db.js";
import * as claude from "./claude.js";
import * as openai from "./openai.js";

const PROVIDERS = { claude, openai };

/** Look up which AI provider this org has selected. Defaults to claude if unset or invalid. */
async function providerFor(orgId) {
  if (!orgId) return claude;
  try {
    const { rows } = await query(`SELECT ai_provider FROM orgs WHERE id=$1`, [orgId]);
    const name = rows[0]?.ai_provider;
    return PROVIDERS[name] || claude;
  } catch (err) {
    console.error("provider lookup failed, defaulting to claude:", err.message);
    return claude;
  }
}

export async function searchLeads(args) {
  const provider = await providerFor(args.orgId);
  return provider.searchLeads(args);
}

export async function draftEmail(args) {
  const provider = await providerFor(args.orgId);
  return provider.draftEmail(args);
}

export async function classifyReply(args) {
  const provider = await providerFor(args.orgId);
  return provider.classifyReply(args);
}

export async function researchCompetitors(args) {
  const provider = await providerFor(args.orgId);
  return provider.researchCompetitors(args);
}

export async function buildBattlecard(args) {
  const provider = await providerFor(args.orgId);
  return provider.buildBattlecard(args);
}
