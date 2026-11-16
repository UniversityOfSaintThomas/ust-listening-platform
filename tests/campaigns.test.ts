import { describe, expect, it } from "vitest";
import { defaultCampaign, seedCampaigns } from "../campaigns";
import { blankCampaign, buildNotice, campaignProblems, cleanCampaign, CONSENT_LABEL, contrast, designProblems, whoSeesResponses } from "../src/shared/campaign";
import type { Campaign } from "../src/shared/types";
import { normalizeAnalysis, normalizeSynthesis } from "../src/worker/analysis";
import { toCsv } from "../src/worker/format";
import { buildGuideInstructions, transcriptionPrompt } from "../src/worker/prompt";

const stelar = seedCampaigns.find((campaign) => campaign.slug === defaultCampaign) as Campaign;

/** A campaign that is nothing like service feedback, to prove nothing is tied to STELAR. */
const summer = cleanCampaign({
  slug: "Summer Plans!",
  status: "open",
  title: "Summer plans check-in",
  unit: "STELAR",
  headline: "What are you building this summer?",
  invitation: "Tell us what you plan to work on this summer and where a hand would help. About five minutes.",
  purpose: "This helps STELAR plan summer support. It is not an evaluation of any individual.",
  goal: "Learn what faculty plan to work on this summer and what help they want from STELAR before fall.",
  questions: [{ ask: "What are you hoping to work on this summer?", listenFor: "A specific project." }, { ask: "", listenFor: "dropped" }, { ask: "Where would help make the biggest difference?", listenFor: "One kind of help." }],
  categories: [{ label: "Plans", description: "What they intend to do." }, { label: "Help needed", description: "Support they want." }],
  themes: ["Course redesign", "AI in teaching", "other"],
  design: { accent: "#0B3D91", action: "#18563a", highlight: "#ffd966", headingSize: "compact" },
});

describe("starter campaigns", () => {
  it("has a default campaign that exists", () => {
    expect(stelar).toBeDefined();
  });

  for (const campaign of seedCampaigns) {
    describe(campaign.slug, () => {
      it("can be saved as it stands, and survives cleaning unchanged", () => {
        expect(campaignProblems(campaign)).toEqual([]);
        expect(cleanCampaign(campaign)).toEqual(campaign);
      });
      it("has a purpose and a notice that names AI, anonymity, and its readers", () => {
        expect(campaign.purpose.length).toBeGreaterThan(20);
        expect(CONSENT_LABEL).toMatch(/AI/);
        const notice = buildNotice(campaign).join(" ");
        expect(notice).toMatch(/voluntary/i);
        expect(notice).toMatch(/anonymously/);
        expect(notice).toContain(campaign.readers);
        expect(whoSeesResponses(campaign)).toMatch(/deleted after 12 months/);
      });
      it("has questions, categories, and themes ending in Other", () => {
        expect(campaign.questions.length).toBeGreaterThan(0);
        expect(new Set(campaign.questions.map((q) => q.id)).size).toBe(campaign.questions.length);
        expect(campaign.categories.length).toBeGreaterThanOrEqual(2);
        expect(campaign.themes).toContain("Other");
      });
    });
  }
});

describe("cleaning what an admin saves", () => {
  it("normalizes the address, drops empty questions, and gives every question and category a unique key", () => {
    expect(summer.slug).toBe("summer-plans");
    expect(summer.questions.map((q) => q.ask)).toEqual(["What are you hoping to work on this summer?", "Where would help make the biggest difference?"]);
    expect(new Set(summer.questions.map((q) => q.id)).size).toBe(2);
    expect(summer.categories.map((c) => c.id)).toEqual(["plans", "help_needed"]);
    expect(summer.themes).toEqual(["Course redesign", "AI in teaching", "Other"]);
    expect(summer.readers).toBe("STELAR leadership");
    expect(summer.design.accent).toBe("#0b3d91");
    expect(campaignProblems(summer)).toEqual([]);
  });
  it("never throws on junk and reports what is missing", () => {
    for (const junk of [null, 42, "x", [], { questions: "no", design: 7, themes: [1, {}] }]) expect(() => cleanCampaign(junk)).not.toThrow();
    const problems = campaignProblems(cleanCampaign({}));
    expect(problems.length).toBeGreaterThan(3);
    expect(campaignProblems(cleanCampaign(blankCampaign())).join(" ")).toMatch(/question/);
  });
  it("refuses addresses the site uses itself", () => {
    expect(campaignProblems({ ...summer, slug: "review" }).join(" ")).toMatch(/used by the site/);
    expect(campaignProblems({ ...summer, slug: "admin" }).length).toBe(1);
  });
  it("keeps limits within bounds", () => {
    const wild = cleanCampaign({ ...summer, maxMinutes: 500, retentionDays: 1, dailySessionCap: 1e9 });
    expect([wild.maxMinutes, wild.retentionDays, wild.dailySessionCap]).toEqual([20, 30, 2000]);
  });
  it("cannot remove or alter the standard notice", () => {
    const sneaky = cleanCampaign({ ...summer, notice: ["We record everything."], consentLabel: "ok", extraNotice: ["Results are shared in August."] });
    const notice = buildNotice(sneaky);
    expect(notice.slice(0, 6)).toEqual(buildNotice(summer).slice(0, 6));
    expect(notice[6]).toBe("Results are shared in August.");
    expect(notice.join(" ")).not.toMatch(/record everything/);
  });
});

describe("colors", () => {
  it("computes WCAG contrast", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrast("#777777", "#ffffff")).toBeLessThan(4.5);
  });
  it("accepts the default colors and rejects ones that fail AA", () => {
    expect(designProblems(stelar.design)).toEqual([]);
    expect(designProblems({ ...stelar.design, accent: "#ffcc00" }).join(" ")).toMatch(/too light/);
    expect(designProblems({ ...stelar.design, highlight: "#5a1080" }).join(" ")).toMatch(/highlight/);
    expect(designProblems({ ...stelar.design, action: "green" }).join(" ")).toMatch(/hex/);
    expect(campaignProblems({ ...summer, design: { ...summer.design, accent: "#ffee00" } }).length).toBeGreaterThan(0);
  });
});

describe("results in any campaign's categories", () => {
  it("reads analyses and syntheses saved before categories were editable", () => {
    const old = normalizeAnalysis({ summary: "s", sentiment: "mixed", strengths: [{ theme: "AI support", point: "p1", quote: "q" }], frictions: [], suggestions: [{ theme: "Other", point: "p2", quote: "" }], needsAttention: false, attentionNote: "" });
    expect(old?.points.map((p) => [p.category, p.point])).toEqual([["strengths", "p1"], ["suggestions", "p2"]]);
    expect(normalizeAnalysis(null)).toBeNull();
    expect(normalizeSynthesis({ overview: "o", strengths: ["a"], frictions: [], priorities: ["c"] }).sections).toEqual([{ category: "strengths", items: ["a"] }, { category: "frictions", items: [] }, { category: "suggestions", items: ["c"] }]);
    expect(normalizeSynthesis({ overview: "o", sections: [{ category: "plans", items: ["x"] }] }).sections[0].items).toEqual(["x"]);
  });
  it("exports one column per category", () => {
    const csv = toCsv([{ id: "1", createdAt: 1794787200, mode: "voice", role: "Faculty", context: [], ease: 4, transcript: [{ role: "guide", text: "Hi" }, { role: "participant", text: "=SUM(1)" }], analysis: { summary: "s", sentiment: "positive", points: [{ category: "plans", theme: "Course redesign", point: "Rebuild a course", quote: "" }], needsAttention: false, attentionNote: "" }, analysisStatus: "done" }], summer.categories);
    const [header, row] = csv.split("\r\n");
    expect(header).toContain("Plans,Help needed");
    expect(row).toContain("[Course redesign] Rebuild a course");
    expect(row).toContain("\"'=SUM(1)\"");
  });
});

describe("guide instructions", () => {
  const campaign = stelar;
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
  it("works from the campaign's own goal, question count, and background", () => {
    const other = buildGuideInstructions(summer, [], "voice");
    expect(other).toContain(summer.goal);
    expect(other).toMatch(/there are two questions/);
    expect(other).toContain("Where would help make the biggest difference?");
    expect(other).not.toMatch(/# Background/);
    expect(other).toMatch(/has not been asked anything/);
    expect(buildGuideInstructions({ ...summer, background: "Pilot runs in June." }, [], "voice")).toMatch(/# Background[\s\S]*Pilot runs in June\./);
  });
  it("gives the transcriber the campaign vocabulary", () => {
    expect(transcriptionPrompt(campaign)).toContain("STELAR");
  });
});
