import { seedCampaigns } from "../../campaigns";
import { cleanCampaign } from "../shared/campaign";
import type { Campaign } from "../shared/types";
import type { Env } from "./env";

export type CampaignRow = { campaign: Campaign; passwordHash: string; updatedAt: number };

type Raw = { slug: string; status: string; config: string; review_password_hash: string | null; updated_at: number };

let seeded = false;

/** Copies the starter campaigns into the database the first time the site runs. Never overwrites. */
async function ensureSeeded(env: Env): Promise<void> {
  if (seeded) return;
  const now = Math.floor(Date.now() / 1000);
  for (const campaign of seedCampaigns) {
    await env.DB.prepare("INSERT OR IGNORE INTO campaigns (slug, status, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(campaign.slug, campaign.status, JSON.stringify(campaign), now, now)
      .run();
  }
  seeded = true;
}

function toRow(raw: Raw): CampaignRow {
  let config: unknown = {};
  try {
    config = JSON.parse(raw.config);
  } catch {
    config = {};
  }
  // The slug and status columns are authoritative. Cleaning fills in fields added since the campaign was saved.
  const campaign = cleanCampaign({ ...(config as object), slug: raw.slug, status: raw.status });
  return { campaign, passwordHash: raw.review_password_hash || "", updatedAt: Number(raw.updated_at) || 0 };
}

export async function listCampaigns(env: Env): Promise<CampaignRow[]> {
  await ensureSeeded(env);
  const result = await env.DB.prepare("SELECT slug, status, config, review_password_hash, updated_at FROM campaigns ORDER BY created_at, slug").all<Raw>();
  return (result.results || []).map(toRow);
}

export async function getCampaign(env: Env, slug: string): Promise<CampaignRow | null> {
  if (!slug) return null;
  await ensureSeeded(env);
  const raw = await env.DB.prepare("SELECT slug, status, config, review_password_hash, updated_at FROM campaigns WHERE slug = ?").bind(slug).first<Raw>();
  return raw ? toRow(raw) : null;
}

/** Creates a campaign. Returns false if the address is already taken. */
export async function createCampaign(env: Env, campaign: Campaign): Promise<boolean> {
  await ensureSeeded(env);
  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare("INSERT OR IGNORE INTO campaigns (slug, status, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(campaign.slug, campaign.status, JSON.stringify(campaign), now, now)
    .run();
  return Boolean(result.meta.changes);
}

export async function saveCampaign(env: Env, campaign: Campaign): Promise<void> {
  await env.DB.prepare("UPDATE campaigns SET status = ?, config = ?, updated_at = ? WHERE slug = ?")
    .bind(campaign.status, JSON.stringify(campaign), Math.floor(Date.now() / 1000), campaign.slug)
    .run();
}

export async function setCampaignPassword(env: Env, slug: string, hash: string | null): Promise<void> {
  await env.DB.prepare("UPDATE campaigns SET review_password_hash = ?, updated_at = ? WHERE slug = ?").bind(hash, Math.floor(Date.now() / 1000), slug).run();
}

export async function deleteCampaign(env: Env, slug: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM syntheses WHERE campaign = ?").bind(slug),
    env.DB.prepare("DELETE FROM campaigns WHERE slug = ?").bind(slug),
  ]);
}

export async function responseCounts(env: Env): Promise<Map<string, number>> {
  const result = await env.DB.prepare("SELECT campaign, COUNT(*) AS n FROM submissions GROUP BY campaign").all<{ campaign: string; n: number }>();
  return new Map((result.results || []).map((row) => [row.campaign, Number(row.n) || 0]));
}
