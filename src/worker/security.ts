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

/**
 * Returns the signed-in reviewer, or null. Accepts the shared-password cookie, or a
 * Cloudflare Access token when Access is configured. DEV_REVIEWER_EMAIL works only on localhost.
 */
export const SHARED_REVIEWER = "shared-password";
const REVIEW_COOKIE = "review_session";
const REVIEW_HOURS = 12;

/** Compares a submitted password to the configured one without leaking length or timing. */
export async function passwordMatches(candidate: string, env: Env): Promise<boolean> {
  if (!env.DASHBOARD_PASSWORD || !candidate) return false;
  const [a, b] = await Promise.all([hmac(env.SESSION_SECRET, `pw|${candidate}`), hmac(env.SESSION_SECRET, `pw|${env.DASHBOARD_PASSWORD}`)]);
  return safeEqual(a, b);
}

/** A signed, expiring cookie. Changing the password signs everyone out. */
export async function reviewCookie(env: Env): Promise<string> {
  const expires = Date.now() + REVIEW_HOURS * 60 * 60 * 1000;
  const signature = await hmac(env.SESSION_SECRET, `review|${expires}|${env.DASHBOARD_PASSWORD}`);
  return `${REVIEW_COOKIE}=${expires}.${signature}; Path=/api/review; Max-Age=${REVIEW_HOURS * 3600}; HttpOnly; Secure; SameSite=Strict`;
}

export const clearedReviewCookie = `${REVIEW_COOKIE}=; Path=/api/review; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

async function hasReviewCookie(request: Request, env: Env): Promise<boolean> {
  if (!env.DASHBOARD_PASSWORD) return false;
  const match = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${REVIEW_COOKIE}=(\\d+)\\.([A-Za-z0-9_-]+)`));
  if (!match || Number(match[1]) < Date.now()) return false;
  return safeEqual(match[2], await hmac(env.SESSION_SECRET, `review|${match[1]}|${env.DASHBOARD_PASSWORD}`));
}

export async function reviewerEmail(request: Request, env: Env): Promise<string | null> {
  if (await hasReviewCookie(request, env)) return SHARED_REVIEWER;
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

/** Campaign slugs this reviewer may open, from the REVIEWERS variable. */
export function reviewerCampaigns(email: string, env: Env, allSlugs: string[]): string[] {
  if (email === SHARED_REVIEWER) return allSlugs; // The shared password opens every campaign.
  let map: Record<string, string[]> = {};
  try {
    map = JSON.parse(env.REVIEWERS || "{}") as Record<string, string[]>;
  } catch {
    return [];
  }
  const has = (list: unknown) => Array.isArray(list) && list.some((item) => typeof item === "string" && item.toLowerCase() === email);
  if (has(map["*"])) return allSlugs;
  return allSlugs.filter((slug) => has(map[slug]));
}
