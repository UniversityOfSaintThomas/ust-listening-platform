import { describe, expect, it } from "vitest";
import { campaigns, defaultCampaign } from "../campaigns";
import { buildGuideInstructions, transcriptionPrompt } from "../src/worker/prompt";

describe("campaign configuration", () => {
  it("has a default campaign that exists", () => {
    expect(campaigns[defaultCampaign]).toBeDefined();
  });

  for (const campaign of Object.values(campaigns)) {
    describe(campaign.slug, () => {
      it("is registered under its own slug", () => {
        expect(campaigns[campaign.slug]).toBe(campaign);
        expect(campaign.slug).toMatch(/^[a-z0-9-]+$/);
      });
      it("has a purpose, a consent statement that names AI, and a notice", () => {
        expect(campaign.purpose.length).toBeGreaterThan(20);
        expect(campaign.consentLabel).toMatch(/AI/);
        expect(campaign.notice.length).toBeGreaterThan(2);
        expect(campaign.notice.join(" ")).toMatch(/voluntary/i);
      });
      it("has questions, themes ending in Other, and sensible limits", () => {
        expect(campaign.questions.length).toBeGreaterThan(0);
        expect(new Set(campaign.questions.map((q) => q.id)).size).toBe(campaign.questions.length);
        expect(campaign.themes).toContain("Other");
        expect(campaign.maxMinutes).toBeGreaterThanOrEqual(5);
        expect(campaign.retentionDays).toBeGreaterThan(0);
        expect(campaign.dailySessionCap).toBeGreaterThan(0);
      });
    });
  }
});

describe("guide instructions", () => {
  const campaign = campaigns.stelar;
  const voice = buildGuideInstructions(campaign, ["Training or workshops"], "voice");

  it("includes every core question", () => {
    for (const question of campaign.questions) expect(voice).toContain(question.ask);
  });
  it("discloses that the guide is an AI and protects anonymity", () => {
    expect(voice).toMatch(/You are an AI/);
    expect(voice).toMatch(/anonymous/i);
    expect(voice).toMatch(/Never ask for the participant's name/);
  });
  it("tells the guide how to end and what to do with urgent concerns", () => {
    expect(voice).toContain("finish_conversation");
    expect(voice).toMatch(/Human Resources/);
  });
  it("passes along the services the participant selected", () => {
    expect(voice).toContain("Training or workshops");
    expect(buildGuideInstructions(campaign, [], "voice")).toContain("not stated");
  });
  it("adapts to typed conversations", () => {
    expect(buildGuideInstructions(campaign, [], "text")).toMatch(/participant is typing/);
  });
  it("gives the transcriber the campaign vocabulary", () => {
    expect(transcriptionPrompt(campaign)).toContain("STELAR");
  });
});
