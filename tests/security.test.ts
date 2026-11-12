import { describe, expect, it } from "vitest";
import type { Env } from "../src/worker/env";
import { issueSubmitToken, passwordMatches, readSubmitToken, reviewCookie, reviewerCampaigns, reviewerEmail, safeEqual, SHARED_REVIEWER } from "../src/worker/security";

const env = { SESSION_SECRET: "test-secret", DASHBOARD_PASSWORD: "correct horse battery" } as Env;

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
    expect((await reviewCookie(env))).toMatch(/HttpOnly; Secure; SameSite=Strict/);
    const request = new Request("https://example.test/api/review/me", { headers: { cookie } });
    expect(await reviewerEmail(request, env)).toBe(SHARED_REVIEWER);
    expect(await reviewerEmail(request, { ...env, DASHBOARD_PASSWORD: "rotated" } as Env)).toBeNull();
  });

  it("rejects a forged or missing cookie", async () => {
    const forged = new Request("https://example.test/api/review/me", { headers: { cookie: "review_session=99999999999999.AAAA" } });
    expect(await reviewerEmail(forged, env)).toBeNull();
    expect(await reviewerEmail(new Request("https://example.test/api/review/me"), env)).toBeNull();
  });

  it("ignores the local development reviewer on any real hostname", async () => {
    const request = new Request("https://listen.example.edu/api/review/me");
    expect(await reviewerEmail(request, { ...env, DASHBOARD_PASSWORD: undefined, DEV_REVIEWER_EMAIL: "dev@example.edu" } as Env)).toBeNull();
  });
});

describe("reviewerCampaigns", () => {
  const slugs = ["stelar", "its"];
  it("opens every campaign for the shared password", () => {
    expect(reviewerCampaigns(SHARED_REVIEWER, env, slugs)).toEqual(slugs);
  });
  it("limits named reviewers to their campaigns", () => {
    const named = { ...env, REVIEWERS: JSON.stringify({ stelar: ["A@Example.edu"], "*": ["all@example.edu"] }) } as Env;
    expect(reviewerCampaigns("a@example.edu", named, slugs)).toEqual(["stelar"]);
    expect(reviewerCampaigns("all@example.edu", named, slugs)).toEqual(slugs);
    expect(reviewerCampaigns("nobody@example.edu", named, slugs)).toEqual([]);
  });
  it("grants nothing when the reviewer list is malformed", () => {
    expect(reviewerCampaigns("a@example.edu", { ...env, REVIEWERS: "{not json" } as Env, slugs)).toEqual([]);
  });
});
