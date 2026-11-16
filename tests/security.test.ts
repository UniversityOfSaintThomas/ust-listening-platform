import { describe, expect, it } from "vitest";
import type { Env } from "../src/worker/env";
import { adminPasswordMatches, campaignPasswordHash, cookieScope, issueSubmitToken, passwordMark, passwordMatches, previewToken, readSubmitToken, resolveReviewer, reviewCookie, reviewerCampaigns, reviewerEmail, safeEqual } from "../src/worker/security";

const env = { SESSION_SECRET: "test-secret", DASHBOARD_PASSWORD: "correct horse battery" } as Env;
const adminEnv = { ...env, ADMIN_PASSWORD: "admin pass phrase" } as Env;

describe("safeEqual", () => {
  it("matches equal strings only", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("submit tokens", () => {
  it("round-trips for the campaign it was issued for", async () => {
    const token = await issueSubmitToken("session-1", "stelar", env);
    expect(await readSubmitToken(token, "stelar", env)).toBe("session-1");
  });

  it("rejects another campaign, a tampered token, an expired token, and junk", async () => {
    const token = await issueSubmitToken("session-1", "stelar", env);
    expect(await readSubmitToken(token, "its", env)).toBeNull();
    expect(await readSubmitToken(token.replace("session-1", "session-2"), "stelar", env)).toBeNull();
    expect(await readSubmitToken(`${token}x`, "stelar", env)).toBeNull();
    expect(await readSubmitToken("a.b.c.d", "stelar", env)).toBeNull();
    expect(await readSubmitToken(undefined, "stelar", env)).toBeNull();
    const [id, slug, , signature] = token.split(".");
    expect(await readSubmitToken(`${id}.${slug}.1.${signature}`, "stelar", env)).toBeNull();
  });

  it("is invalid under a different secret", async () => {
    const token = await issueSubmitToken("session-1", "stelar", env);
    expect(await readSubmitToken(token, "stelar", { ...env, SESSION_SECRET: "other" } as Env)).toBeNull();
  });
});

describe("review password", () => {
  it("accepts only the configured password", async () => {
    expect(await passwordMatches("correct horse battery", env)).toBe(true);
    expect(await passwordMatches("wrong", env)).toBe(false);
    expect(await passwordMatches("", env)).toBe(false);
  });

  it("never matches when no password is configured", async () => {
    expect(await passwordMatches("", { SESSION_SECRET: "s" } as Env)).toBe(false);
    expect(await passwordMatches("anything", { SESSION_SECRET: "s" } as Env)).toBe(false);
  });

  it("issues a cookie that signs the reviewer in, and stops working when the password changes", async () => {
    const cookie = (await reviewCookie(env)).split(";")[0];
    expect(await reviewCookie(env)).toMatch(/HttpOnly; Secure; SameSite=Strict/);
    const request = new Request("https://example.test/api/review/me", { headers: { cookie } });
    expect(await cookieScope(request, env)).toEqual({ kind: "all" });
    expect(await cookieScope(request, { ...env, DASHBOARD_PASSWORD: "rotated" } as Env)).toBeNull();
  });

  it("rejects a forged or missing cookie", async () => {
    const forged = new Request("https://example.test/api/review/me", { headers: { cookie: "review_session=99999999999999.YWRtaW4.AAAA" } });
    expect(await cookieScope(forged, adminEnv)).toBeNull();
    expect(await cookieScope(new Request("https://example.test/api/review/me"), env)).toBeNull();
  });

  it("ignores the local development reviewer on any real hostname", async () => {
    const request = new Request("https://listen.example.edu/api/review/me");
    expect(await reviewerEmail(request, { ...env, DASHBOARD_PASSWORD: undefined, DEV_REVIEWER_EMAIL: "dev@example.edu" } as Env)).toBeNull();
  });
});

describe("levels of access", () => {
  const campaigns = [{ slug: "stelar", mark: "" }, { slug: "vr", mark: "" }];
  const withCookie = async (cookie: string) => new Request("https://example.test/api/review/me", { headers: { cookie: cookie.split(";")[0] } });

  it("keeps the admin, shared, and campaign passwords apart", async () => {
    expect(await adminPasswordMatches("admin pass phrase", adminEnv)).toBe(true);
    expect(await adminPasswordMatches("correct horse battery", adminEnv)).toBe(false);
    expect(await adminPasswordMatches("anything", env)).toBe(false);
  });

  it("makes the admin an admin and the shared password a reviewer of everything", async () => {
    const asAdmin = await resolveReviewer(await withCookie(await reviewCookie(adminEnv, { kind: "admin" })), adminEnv, campaigns);
    expect(asAdmin).toEqual({ role: "admin", email: "", slugs: ["stelar", "vr"] });
    const shared = await resolveReviewer(await withCookie(await reviewCookie(adminEnv)), adminEnv, campaigns);
    expect(shared).toEqual({ role: "reviewer", email: "", slugs: ["stelar", "vr"] });
  });

  it("does not let a reviewer cookie be relabeled as admin", async () => {
    const [expires, , signature] = (await reviewCookie(adminEnv)).split(";")[0].split("=")[1].split(".");
    const relabeled = new Request("https://example.test/api/review/me", { headers: { cookie: `review_session=${expires}.YWRtaW4.${signature}` } });
    expect(await resolveReviewer(relabeled, adminEnv, campaigns)).toBeNull();
  });

  it("signs admins out when the admin password changes or is removed", async () => {
    const request = await withCookie(await reviewCookie(adminEnv, { kind: "admin" }));
    expect(await resolveReviewer(request, { ...adminEnv, ADMIN_PASSWORD: "new" } as Env, campaigns)).toBeNull();
    expect(await resolveReviewer(request, env, campaigns)).toBeNull();
  });

  it("limits a campaign password to its campaign, and ends the session when that password changes", async () => {
    const hash = await campaignPasswordHash("vr project lead", env);
    const mark = passwordMark(hash);
    const request = await withCookie(await reviewCookie(env, { kind: "campaigns", grants: [{ slug: "vr", mark }] }));
    const current = [{ slug: "stelar", mark: passwordMark(await campaignPasswordHash("something else", env)) }, { slug: "vr", mark }];
    expect(await resolveReviewer(request, env, current)).toEqual({ role: "reviewer", email: "", slugs: ["vr"] });
    expect(await resolveReviewer(request, env, [{ slug: "vr", mark: "rotated00000" }])).toBeNull();
    expect(await resolveReviewer(request, env, [{ slug: "vr", mark: "" }])).toBeNull();
  });

  it("gives each campaign a different preview token that depends on the secret", async () => {
    expect(await previewToken("vr", env)).not.toBe(await previewToken("stelar", env));
    expect(await previewToken("vr", env)).not.toBe(await previewToken("vr", { ...env, SESSION_SECRET: "other" } as Env));
  });
});

describe("reviewerCampaigns", () => {
  const slugs = ["stelar", "its"];
  it("limits named reviewers to their campaigns", () => {
    const named = { ...env, REVIEWERS: JSON.stringify({ stelar: ["A@Example.edu"], "*": ["all@example.edu"], admin: ["boss@example.edu"] }) } as Env;
    expect(reviewerCampaigns("a@example.edu", named, slugs)).toEqual(["stelar"]);
    expect(reviewerCampaigns("all@example.edu", named, slugs)).toEqual(slugs);
    expect(reviewerCampaigns("boss@example.edu", named, slugs)).toEqual(slugs);
    expect(reviewerCampaigns("nobody@example.edu", named, slugs)).toEqual([]);
  });
  it("grants nothing when the reviewer list is malformed", () => {
    expect(reviewerCampaigns("a@example.edu", { ...env, REVIEWERS: "{not json" } as Env, slugs)).toEqual([]);
  });
});
