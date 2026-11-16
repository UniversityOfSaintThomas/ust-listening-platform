import type { Env } from "./env";

const encoder = new TextEncoder();

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message))));
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A hash of the caller's IP that changes every day and cannot be reversed without the secret. */
export async function ipHash(request: Request, env: Env): Promise<string> {
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const day = new Date().toISOString().slice(0, 10);
  return (await hmac(env.SESSION_SECRET, `${ip}|${day}`)).slice(0, 22);
}

/** Token the browser must present to submit. Bound to one session, valid for two hours. */
export async function issueSubmitToken(sessionId: string, slug: string, env: Env): Promise<string> {
  const expires = Date.now() + 2 * 60 * 60 * 1000;
  const body = `${sessionId}.${slug}.${expires}`;
  return `${body}.${await hmac(env.SESSION_SECRET, body)}`;
}

export async function readSubmitToken(token: unknown, slug: string, env: Env): Promise<string | null> {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [sessionId, tokenSlug, expires, signature] = parts;
  if (tokenSlug !== slug || !/^\d+$/.test(expires) || Number(expires) < Date.now()) return null;
  const expected = await hmac(env.SESSION_SECRET, `${sessionId}.${tokenSlug}.${expires}`);
  return safeEqual(signature, expected) ? sessionId : null;
}

export async function verifyTurnstile(token: unknown, request: Request, env: Env): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return true; // Not configured: local development.
  if (typeof token !== "string" || !token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) form.append("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const result = (await response.json().catch(() => null)) as { success?: boolean } | null;
  return result?.success === true;
}

type Jwk = JsonWebKey & { kid?: string };
let certCache: { fetchedAt: number; keys: Jwk[] } | null = null;

async function accessKeys(teamDomain: string): Promise<Jwk[]> {
  if (certCache && Date.now() - certCache.fetchedAt < 60 * 60 * 1000) return certCache.keys;
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  const body = (await response.json().catch(() => null)) as { keys?: Jwk[] } | null;
  const keys = body?.keys || [];
  if (keys.length) certCache = { fetchedAt: Date.now(), keys };
  return keys;
}

const REVIEW_COOKIE = "review_session";
const REVIEW_HOURS = 12;

/**
 * What a password sign-in opens. "admin" manages campaigns and sees everything, "all"
 * sees every campaign's results, and "campaigns" sees only the listed ones. Each
 * campaign grant carries the start of that campaign's password hash, so changing a
 * campaign's password ends the sessions that used the old one.
 */
export type Scope = { kind: "admin" } | { kind: "all" } | { kind: "campaigns"; grants: { slug: string; mark: string }[] };

async function matches(candidate: string, expected: string | undefined, env: Env): Promise<boolean> {
  if (!expected || !candidate) return false;
  const [a, b] = await Promise.all([hmac(env.SESSION_SECRET, `pw|${candidate}`), hmac(env.SESSION_SECRET, `pw|${expected}`)]);
  return safeEqual(a, b);
}

/** Compares a submitted password to the shared review password without leaking length or timing. */
export const passwordMatches = (candidate: string, env: Env) => matches(candidate, env.DASHBOARD_PASSWORD, env);
export const adminPasswordMatches = (candidate: string, env: Env) => matches(candidate, env.ADMIN_PASSWORD, env);

/** Keyed hash of a campaign's review password. Useless without the site's signing secret. */
export const campaignPasswordHash = (password: string, env: Env) => hmac(env.SESSION_SECRET, `campaign-pw|${password}`);
export const passwordMark = (hash: string) => hash.slice(0, 12);

/** Link token that lets an admin try a campaign before it is open. */
export const previewToken = async (slug: string, env: Env) => (await hmac(env.SESSION_SECRET, `preview|${slug}`)).slice(0, 24);

function encodeScope(scope: Scope): string {
  if (scope.kind !== "campaigns") return scope.kind;
  return `c:${scope.grants.map((grant) => `${grant.slug}~${grant.mark}`).join(",")}`;
}

function decodeScope(value: string): Scope | null {
  if (value === "admin" || value === "all") return { kind: value };
  if (!value.startsWith("c:")) return null;
  const grants = value.slice(2).split(",").map((part) => part.split("~")).filter((pair) => pair.length === 2 && pair[0] && pair[1]).map(([slug, mark]) => ({ slug, mark }));
  return grants.length ? { kind: "campaigns", grants } : null;
}

/** The password a scope's signature is tied to. Changing it signs those sessions out. */
const binding = (scope: Scope, env: Env) => (scope.kind === "admin" ? env.ADMIN_PASSWORD : scope.kind === "all" ? env.DASHBOARD_PASSWORD : "campaign");

/** A signed, expiring cookie. */
export async function reviewCookie(env: Env, scope: Scope = { kind: "all" }): Promise<string> {
  const expires = Date.now() + REVIEW_HOURS * 60 * 60 * 1000;
  const encoded = base64Url(encoder.encode(encodeScope(scope)));
  const signature = await hmac(env.SESSION_SECRET, `review|${expires}|${encoded}|${binding(scope, env)}`);
  return `${REVIEW_COOKIE}=${expires}.${encoded}.${signature}; Path=/api/review; Max-Age=${REVIEW_HOURS * 3600}; HttpOnly; Secure; SameSite=Strict`;
}

export const clearedReviewCookie = `${REVIEW_COOKIE}=; Path=/api/review; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

/** The scope carried by a valid sign-in cookie, or null. */
export async function cookieScope(request: Request, env: Env): Promise<Scope | null> {
  if (!env.SESSION_SECRET) return null;
  const match = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${REVIEW_COOKIE}=(\\d+)\\.([A-Za-z0-9_-]+)\\.([A-Za-z0-9_-]+)`));
  if (!match || Number(match[1]) < Date.now()) return null;
  let scope: Scope | null = null;
  try {
    scope = decodeScope(new TextDecoder().decode(fromBase64Url(match[2])));
  } catch {
    return null;
  }
  if (!scope) return null;
  const bound = binding(scope, env);
  if (!bound) return null;
  return safeEqual(match[3], await hmac(env.SESSION_SECRET, `review|${match[1]}|${match[2]}|${bound}`)) ? scope : null;
}

/**
 * Returns the reviewer signed in through Cloudflare Access, or null. Used only when
 * Access is configured. DEV_REVIEWER_EMAIL works only on localhost.
 */
export async function reviewerEmail(request: Request, env: Env): Promise<string | null> {
  const host = new URL(request.url).hostname;
  if (env.DEV_REVIEWER_EMAIL && (host === "localhost" || host === "127.0.0.1")) return env.DEV_REVIEWER_EMAIL.toLowerCase();
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0]))) as { kid?: string; alg?: string };
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1]))) as { aud?: string[] | string; exp?: number; iss?: string; email?: string };
    if (header.alg !== "RS256") return null;
    const jwk = (await accessKeys(env.ACCESS_TEAM_DOMAIN)).find((key) => key.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromBase64Url(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(env.ACCESS_AUD)) return null;
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
    return payload.email ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

export type Reviewer = { role: "admin" | "reviewer"; email: string; slugs: string[] };

/** Campaign slugs a named reviewer may open, from the REVIEWERS variable. "admin" lists people who manage campaigns. */
export function reviewerCampaigns(email: string, env: Env, allSlugs: string[]): string[] {
  let map: Record<string, string[]> = {};
  try {
    map = JSON.parse(env.REVIEWERS || "{}") as Record<string, string[]>;
  } catch {
    return [];
  }
  const has = (list: unknown) => Array.isArray(list) && list.some((item) => typeof item === "string" && item.toLowerCase() === email);
  if (has(map["*"]) || has(map.admin)) return allSlugs;
  return allSlugs.filter((slug) => has(map[slug]));
}

function isNamedAdmin(email: string, env: Env): boolean {
  try {
    const list = (JSON.parse(env.REVIEWERS || "{}") as Record<string, unknown>).admin;
    return Array.isArray(list) && list.some((item) => typeof item === "string" && item.toLowerCase() === email);
  } catch {
    return false;
  }
}

/**
 * Works out who is asking and which campaigns they may open. `campaigns` lists every
 * campaign with the mark of its current review password.
 */
export async function resolveReviewer(request: Request, env: Env, campaigns: { slug: string; mark: string }[]): Promise<Reviewer | null> {
  const all = campaigns.map((campaign) => campaign.slug);
  const scope = await cookieScope(request, env);
  if (scope?.kind === "admin") return { role: "admin", email: "", slugs: all };
  if (scope?.kind === "all") return { role: "reviewer", email: "", slugs: all };
  if (scope?.kind === "campaigns") {
    const slugs = campaigns.filter((campaign) => campaign.mark && scope.grants.some((grant) => grant.slug === campaign.slug && safeEqual(grant.mark, campaign.mark))).map((campaign) => campaign.slug);
    return slugs.length ? { role: "reviewer", email: "", slugs } : null;
  }
  const email = await reviewerEmail(request, env);
  if (!email) return null;
  return { role: isNamedAdmin(email, env) ? "admin" : "reviewer", email, slugs: reviewerCampaigns(email, env, all) };
}
