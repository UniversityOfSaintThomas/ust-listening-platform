import { afterEach, describe, expect, it, vi } from "vitest";
import { campaigns } from "../campaigns";
import type { Turn } from "../src/shared/types";
import { redactTranscript, scrubPatterns } from "../src/worker/analysis";
import type { Env } from "../src/worker/env";

const env = { OPENAI_API_KEY: "test", ANALYSIS_MODEL: "test-model", OPENAI_BASE_URL: "https://model.test" } as Env;
const campaign = campaigns.stelar;
const transcript: Turn[] = [
  { role: "guide", text: "What is STELAR doing well for you?" },
  { role: "participant", text: "Dr. Smith ran a useful Canvas workshop. Write to me at pat@example.edu." },
];

/** Stands in for the model. `reply` receives the schema name and the input and returns the JSON the model would. */
function mockModel(reply: (name: string, input: string) => unknown) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { input: string; text: { format: { name: string } } };
    calls.push(body.text.format.name);
    return new Response(JSON.stringify({ output_text: JSON.stringify(reply(body.text.format.name, body.input)) }), { status: 200 });
  });
  return calls;
}

const redactNames = (value: string) => value.replaceAll("Dr. Smith", "[name]");

afterEach(() => vi.unstubAllGlobals());

describe("scrubPatterns", () => {
  it("replaces emails, phone numbers, and long ID numbers", () => {
    expect(scrubPatterns("mail pat.example@stthomas.edu or call 651-555-0142")).toBe("mail [email] or call [phone]");
    expect(scrubPatterns("call (651) 555-0142 now")).toBe("call [phone] now");
    expect(scrubPatterns("my ID is 100234567")).toBe("my ID is [id]");
  });
  it("leaves ordinary text and short numbers alone", () => {
    expect(scrubPatterns("I attended 3 workshops in 2026")).toBe("I attended 3 workshops in 2026");
  });
});

describe("redactTranscript", () => {
  it("uses the model's redaction when every turn comes back", async () => {
    const calls = mockModel((_name, input) => ({ turns: (JSON.parse(input) as { n: number; text: string }[]).map((t) => ({ n: t.n, text: redactNames(t.text) })) }));
    const result = await redactTranscript(env, campaign, transcript);
    expect(result[1].text).toBe("[name] ran a useful Canvas workshop. Write to me at [email].");
    expect(result[0]).toEqual(transcript[0]);
    expect(calls).toEqual(["redacted_transcript"]);
  });

  it("removes emails even if the model leaves them in", async () => {
    mockModel((_name, input) => ({ turns: (JSON.parse(input) as { n: number; text: string }[]).map((t) => ({ n: t.n, text: `${t.text} (a@b.edu)` })) }));
    const result = await redactTranscript(env, campaign, transcript);
    expect(result[1].text).not.toMatch(/@/);
  });

  it("falls back to one turn at a time when the model drops a turn", async () => {
    const calls = mockModel((name, input) =>
      name === "redacted_transcript" ? { turns: [{ n: 2, text: "only one turn" }] } : { text: redactNames(input) },
    );
    const result = await redactTranscript(env, campaign, transcript);
    expect(result).toHaveLength(2);
    expect(result[1].text).toContain("[name]");
    expect(calls).toEqual(["redacted_transcript", "redacted_turn", "redacted_turn"]);
  });

  it("refuses a result that rewrites or summarizes what was said", async () => {
    mockModel((name) => (name === "redacted_transcript" ? { turns: [] } : { text: "ok" }));
    await expect(redactTranscript(env, campaign, transcript)).rejects.toThrow();
  });

  it("refuses when the model service is down", async () => {
    vi.stubGlobal("fetch", async () => new Response("unavailable", { status: 503 }));
    await expect(redactTranscript(env, campaign, transcript)).rejects.toThrow();
  });
});
