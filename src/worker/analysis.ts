import type { Analysis, Campaign, Synthesis, Turn } from "../shared/types";
import type { Env } from "./env";

/** Calls the OpenAI Responses API and returns parsed JSON that matches the given schema. */
async function structured<T>(env: Env, name: string, instructions: string, input: string, schema: object): Promise<T> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: env.ANALYSIS_MODEL,
      store: false,
      instructions,
      input,
      text: { format: { type: "json_schema", name, strict: true, schema } },
    }),
  });
  if (!response.ok) throw new Error(`Analysis request failed with status ${response.status}`);
  const payload = (await response.json()) as { output_text?: string; output?: { content?: { type?: string; text?: string }[] }[] };
  let text = payload.output_text || "";
  if (!text) {
    for (const item of payload.output || []) for (const part of item.content || []) if (part.type === "output_text" && part.text) text = part.text;
  }
  return JSON.parse(text) as T;
}

const itemList = (themes: string[]) => ({
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["theme", "point", "quote"],
    properties: {
      theme: { type: "string", enum: themes },
      point: { type: "string" },
      quote: { type: "string" },
    },
  },
});

export async function analyzeSubmission(env: Env, campaign: Campaign, transcript: Turn[], context: string[]): Promise<Analysis> {
  const instructions = `You code one feedback interview about ${campaign.unit}, a unit at the University of St. Thomas, for a service-improvement review.

Rules:
- Use only what the participant said. Guide turns are context, not evidence. Do not infer or embellish.
- "point" is one plain sentence stating the strength, friction, or suggestion.
- "quote" is a short verbatim excerpt from the participant that supports the point, under 30 words. Replace any personal name with [name]. Remove details that would identify the participant, such as a course number or job title, replacing them with a bracketed description.
- Pick the closest theme from the allowed list. Use "Other" only when nothing fits.
- Do not soften criticism and do not inflate praise. An empty list is correct when the participant offered nothing in that category.
- "summary" is two or three sentences, with no names.
- Set needsAttention to true only if the participant describes harassment, discrimination, a safety or wellbeing concern, a legal or compliance problem, or a serious allegation about a specific person. Put one neutral sentence in attentionNote. Otherwise use false and an empty string.`;

  const input = `Services the participant has used: ${context.join("; ") || "not stated"}

Transcript:
${transcript.map((turn) => `${turn.role === "guide" ? "Guide" : "Participant"}: ${turn.text}`).join("\n")}`;

  return structured<Analysis>(env, "feedback_analysis", instructions, input, {
    type: "object",
    additionalProperties: false,
    required: ["summary", "sentiment", "strengths", "frictions", "suggestions", "needsAttention", "attentionNote"],
    properties: {
      summary: { type: "string" },
      sentiment: { type: "string", enum: ["positive", "mixed", "negative", "neutral"] },
      strengths: itemList(campaign.themes),
      frictions: itemList(campaign.themes),
      suggestions: itemList(campaign.themes),
      needsAttention: { type: "boolean" },
      attentionNote: { type: "string" },
    },
  });
}

export async function synthesize(env: Env, campaign: Campaign, analyses: Analysis[]): Promise<Omit<Synthesis, "createdAt" | "responseCount">> {
  const instructions = `You write a synthesis of ${analyses.length} coded feedback interviews about ${campaign.unit} for its leadership team.

Rules:
- Base every statement on the coded responses provided. State roughly how many participants raised each point, for example "5 of 14".
- With fewer than five responses, say that patterns are preliminary.
- Plain, direct sentences. No names. No recommendations beyond what participants asked for.
- overview: three or four sentences.
- strengths and frictions: up to five items each, most common first, one sentence each.
- priorities: up to five changes participants asked for, most requested first, one sentence each.`;

  const input = analyses
    .map((a, i) => {
      const list = (label: string, items: Analysis["strengths"]) => items.map((item) => `  ${label} [${item.theme}]: ${item.point}`).join("\n");
      return `Response ${i + 1} (${a.sentiment}): ${a.summary}\n${list("Strength", a.strengths)}\n${list("Friction", a.frictions)}\n${list("Suggestion", a.suggestions)}`;
    })
    .join("\n\n");

  const strings = { type: "array", items: { type: "string" } };
  return structured(env, "campaign_synthesis", instructions, input, {
    type: "object",
    additionalProperties: false,
    required: ["overview", "strengths", "frictions", "priorities"],
    properties: { overview: { type: "string" }, strengths: strings, frictions: strings, priorities: strings },
  });
}
