import { campaigns, defaultCampaign } from "../../campaigns";
import type { Analysis, Campaign, Mode, PublicCampaign, ReviewData, ReviewSubmission, Synthesis, Turn } from "../shared/types";
import { analyzeSubmission, synthesize } from "./analysis";
import type { Env } from "./env";
import { buildGuideInstructions, transcriptionPrompt } from "./prompt";
import { clearedReviewCookie, ipHash, issueSubmitToken, passwordMatches, readSubmitToken, reviewCookie, reviewerCampaigns, reviewerEmail, SHARED_REVIEWER, verifyTurnstile } from "./security";

const SESSIONS_PER_IP_PER_HOUR = 6;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function publicCampaign(campaign: Campaign, env: Env): PublicCampaign {
  const { dailySessionCap: _cap, vocabulary: _vocabulary, ...rest } = campaign;
  return { ...rest, turnstileSiteKey: env.TURNSTILE_SITE_KEY || "" };
}

function cleanContext(value: unknown, campaign: Campaign): string[] {
  return Array.isArray(value) ? campaign.contextOptions.filter((option) => value.includes(option)) : [];
}

/** Starts a conversation: checks limits, then mints a short-lived OpenAI client secret. */
async function startSession(request: Request, env: Env): Promise<Response> {
  if (!env.OPENAI_API_KEY || !env.SESSION_SECRET) return json({ error: "The listening guide is not configured yet." }, 503);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const campaign = campaigns[text(body?.slug, 60)];
  if (!campaign) return json({ error: "That feedback page was not found." }, 404);
  if (campaign.status !== "open") return json({ error: "This feedback page is closed." }, 403);
  if (!(await verifyTurnstile(body?.turnstileToken, request, env))) return json({ error: "We could not confirm your browser. Please reload the page and try again." }, 403);

  const now = Math.floor(Date.now() / 1000);
  const hash = await ipHash(request, env);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE ip_hash = ? AND created_at > ?").bind(hash, now - 3600).first<{ n: number }>();
  if ((recent?.n || 0) >= SESSIONS_PER_IP_PER_HOUR) return json({ error: "Too many conversations were started from this network in the past hour. Please try again later." }, 429);
  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE campaign = ? AND created_at > ?").bind(campaign.slug, now - 86400).first<{ n: number }>();
  if ((today?.n || 0) >= campaign.dailySessionCap) return json({ error: "This feedback page has reached its daily limit. Please try again tomorrow." }, 429);

  const mode: Mode = body?.mode === "text" ? "text" : "voice";
  const context = cleanContext(body?.context, campaign);
  const upstream = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 120 },
      session: {
        type: "realtime",
        model: env.REALTIME_MODEL,
        instructions: buildGuideInstructions(campaign, context, mode),
        output_modalities: ["audio"],
        audio: {
          input: {
            transcription: { model: env.TRANSCRIBE_MODEL, language: "en", prompt: transcriptionPrompt(campaign) },
            noise_reduction: { type: "near_field" },
            // Semantic turn detection waits for a finished thought instead of a fixed silence gap.
            turn_detection: { type: "semantic_vad", eagerness: "low", create_response: true, interrupt_response: true },
          },
          output: { voice: env.GUIDE_VOICE },
        },
        tools: [
          {
            type: "function",
            name: "finish_conversation",
            description: "End the interview and move the participant to the review screen. Call only after the closing steps, or when the participant asks to stop.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        ],
        tool_choice: "auto",
      },
    }),
  }).catch(() => null);
  const secret = upstream ? ((await upstream.json().catch(() => null)) as { value?: string; expires_at?: number; error?: { message?: string; type?: string; code?: string; param?: string } } | null) : null;
  if (!upstream?.ok || !secret?.value) {
    // The provider's error describes the request, never the key. Logged for the site owner only.
    console.error("Client secret request failed", JSON.stringify({ status: upstream?.status ?? "network error", model: env.REALTIME_MODEL, error: secret?.error ?? null }));
    return json({ error: "The listening guide is unavailable right now. Please try again shortly." }, 502);
  }

  const sessionId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO sessions (id, campaign, created_at, ip_hash) VALUES (?, ?, ?, ?)").bind(sessionId, campaign.slug, now, hash).run();
  return json({ clientSecret: secret.value, submitToken: await issueSubmitToken(sessionId, campaign.slug, env) });
}

function cleanTranscript(value: unknown): Turn[] {
  if (!Array.isArray(value)) return [];
  const turns: Turn[] = [];
  for (const item of value.slice(0, 120)) {
    const record = item as Record<string, unknown> | null;
    const role = record?.role === "guide" ? "guide" : record?.role === "participant" ? "participant" : null;
    const body = text(record?.text, 6000);
    if (role && body) turns.push({ role, text: body });
  }
  return turns;
}

async function submit(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const campaign = campaigns[text(body?.slug, 60)];
  if (!campaign) return json({ error: "That feedback page was not found." }, 404);
  const sessionId = await readSubmitToken(body?.submitToken, campaign.slug, env);
  if (!sessionId) return json({ error: "This conversation has expired. Please start again." }, 403);

  const transcript = cleanTranscript(body?.transcript);
  if (!transcript.some((turn) => turn.role === "participant")) return json({ error: "There is nothing to submit yet. Add at least one response." }, 400);
  if (JSON.stringify(transcript).length > 120_000) return json({ error: "That transcript is too long to submit." }, 413);

  // Single use: the first submit for a session wins, repeats are rejected.
  const claimed = await env.DB.prepare("UPDATE sessions SET used = 1 WHERE id = ? AND used = 0").bind(sessionId).run();
  if (!claimed.meta.changes) return json({ error: "This conversation was already submitted." }, 409);

  const context = cleanContext(body?.context, campaign);
  const role = campaign.roles.includes(text(body?.role, 60)) ? text(body?.role, 60) : "";
  const ease = typeof body?.ease === "number" && Number.isInteger(body.ease) && body.ease >= 1 && body.ease <= 5 ? body.ease : null;
  const id = crypto.randomUUID();
  const hour = Math.floor(Date.now() / 3_600_000) * 3600;
  await env.DB.prepare("INSERT INTO submissions (id, campaign, created_at, mode, role, name, context, transcript, ease) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, campaign.slug, hour, body?.mode === "text" ? "text" : "voice", role || null, text(body?.name, 120) || null, JSON.stringify(context), JSON.stringify(transcript), ease)
    .run();

  ctx.waitUntil(runAnalysis(env, campaign, id, transcript, context));
  return json({ ok: true });
}

async function runAnalysis(env: Env, campaign: Campaign, id: string, transcript: Turn[], context: string[]): Promise<void> {
  try {
    if (!env.OPENAI_API_KEY) throw new Error("No API key");
    const analysis = await analyzeSubmission(env, campaign, transcript, context);
    await env.DB.prepare("UPDATE submissions SET analysis = ?, analysis_status = 'done' WHERE id = ?").bind(JSON.stringify(analysis), id).run();
  } catch (error) {
    console.error("Analysis failed", error instanceof Error ? error.message : "unknown");
    await env.DB.prepare("UPDATE submissions SET analysis_status = 'failed' WHERE id = ?").bind(id).run();
  }
}

type Row = Record<string, unknown>;

function toSubmission(row: Row): ReviewSubmission {
  return {
    id: String(row.id),
    createdAt: Number(row.created_at) || 0,
    mode: row.mode === "text" ? "text" : "voice",
    role: text(row.role, 60),
    name: text(row.name, 120),
    context: parseJson<string[]>(row.context, []),
    ease: typeof row.ease === "number" ? row.ease : null,
    transcript: parseJson<Turn[]>(row.transcript, []),
    analysis: parseJson<Analysis | null>(row.analysis, null),
    analysisStatus: row.analysis_status === "done" ? "done" : row.analysis_status === "failed" ? "failed" : "pending",
  };
}

async function loadSubmissions(env: Env, slug: string): Promise<ReviewSubmission[]> {
  const result = await env.DB.prepare("SELECT * FROM submissions WHERE campaign = ? ORDER BY created_at DESC LIMIT 2000").bind(slug).all<Row>();
  return (result.results || []).map(toSubmission);
}

function csvCell(value: string | number | null): string {
  let cell = value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`; // Prevent spreadsheet formula injection.
  return `"${cell.replace(/"/g, '""')}"`;
}

function toCsv(rows: ReviewSubmission[]): string {
  const items = (list?: { theme: string; point: string }[]) => (list || []).map((item) => `[${item.theme}] ${item.point}`).join(" | ");
  const header = ["date", "mode", "role", "name", "ease", "services_used", "sentiment", "summary", "strengths", "frictions", "suggestions", "needs_attention", "participant_words"];
  const lines = rows.map((row) =>
    [
      new Date(row.createdAt * 1000).toISOString().slice(0, 10),
      row.mode,
      row.role,
      row.name,
      row.ease,
      row.context.join("; "),
      row.analysis?.sentiment || "",
      row.analysis?.summary || "",
      items(row.analysis?.strengths),
      items(row.analysis?.frictions),
      items(row.analysis?.suggestions),
      row.analysis?.needsAttention ? row.analysis.attentionNote : "",
      row.transcript.filter((turn) => turn.role === "participant").map((turn) => turn.text).join("\n\n"),
    ].map(csvCell).join(","),
  );
  return [header.join(","), ...lines].join("\r\n");
}

const LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60;

async function login(request: Request, env: Env): Promise<Response> {
  if (!env.DASHBOARD_PASSWORD || !env.SESSION_SECRET) return json({ error: "The review password has not been set up yet." }, 503);
  const now = Math.floor(Date.now() / 1000);
  const hash = await ipHash(request, env);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE ip_hash = ? AND created_at > ?").bind(hash, now - LOGIN_WINDOW_SECONDS).first<{ n: number }>();
  if ((recent?.n || 0) >= LOGIN_ATTEMPTS) return json({ error: "Too many attempts. Please wait 15 minutes and try again." }, 429);
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  if (!(await passwordMatches(text(body?.password, 200), env))) {
    await env.DB.prepare("INSERT INTO login_attempts (ip_hash, created_at) VALUES (?, ?)").bind(hash, now).run();
    return json({ error: "That password is not correct." }, 401);
  }
  const response = json({ ok: true });
  response.headers.append("set-cookie", await reviewCookie(env));
  return response;
}

async function review(request: Request, env: Env, ctx: ExecutionContext, path: string[]): Promise<Response> {
  if (path[0] === "login" && request.method === "POST") return login(request, env);
  if (path[0] === "logout" && request.method === "POST") {
    const response = json({ ok: true });
    response.headers.append("set-cookie", clearedReviewCookie);
    return response;
  }
  const email = await reviewerEmail(request, env);
  if (!email) return json({ error: "Enter the review password to open this page." }, 401);
  const allowed = reviewerCampaigns(email, env, Object.keys(campaigns));
  if (path[0] === "me" && request.method === "GET") {
    return json({ email: email === SHARED_REVIEWER ? "" : email, campaigns: allowed.map((slug) => ({ slug, unit: campaigns[slug].unit })) });
  }

  const campaign = campaigns[path[0]];
  if (!campaign || !allowed.includes(campaign.slug)) return json({ error: "You do not have access to this campaign." }, 403);

  if (path.length === 1 && request.method === "GET") {
    const stored = await env.DB.prepare("SELECT created_at, response_count, body FROM syntheses WHERE campaign = ?").bind(campaign.slug).first<Row>();
    const synthesis: Synthesis | null = stored
      ? { createdAt: Number(stored.created_at), responseCount: Number(stored.response_count), ...parseJson(stored.body, { overview: "", strengths: [], frictions: [], priorities: [] }) }
      : null;
    const data: ReviewData = {
      campaign: { slug: campaign.slug, unit: campaign.unit, themes: campaign.themes, retentionDays: campaign.retentionDays },
      submissions: await loadSubmissions(env, campaign.slug),
      synthesis,
    };
    return json(data);
  }

  if (path[1] === "export.csv" && request.method === "GET") {
    return new Response(`﻿${toCsv(await loadSubmissions(env, campaign.slug))}`, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${campaign.slug}-feedback.csv"`, "cache-control": "no-store" },
    });
  }

  if (path[1] === "synthesis" && request.method === "POST") {
    if (!env.OPENAI_API_KEY) return json({ error: "Analysis is not configured." }, 503);
    const analyses = (await loadSubmissions(env, campaign.slug)).map((row) => row.analysis).filter((a): a is Analysis => Boolean(a));
    if (!analyses.length) return json({ error: "There are no analyzed responses to synthesize yet." }, 400);
    try {
      const body = await synthesize(env, campaign, analyses.slice(0, 400));
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare("INSERT INTO syntheses (campaign, created_at, response_count, body) VALUES (?, ?, ?, ?) ON CONFLICT(campaign) DO UPDATE SET created_at = excluded.created_at, response_count = excluded.response_count, body = excluded.body")
        .bind(campaign.slug, now, analyses.length, JSON.stringify(body))
        .run();
      return json({ createdAt: now, responseCount: analyses.length, ...body } satisfies Synthesis);
    } catch {
      return json({ error: "The synthesis could not be generated. Please try again." }, 502);
    }
  }

  if (path[1] === "submissions" && path[2]) {
    if (request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM submissions WHERE id = ? AND campaign = ?").bind(path[2], campaign.slug).run();
      return json({ ok: true });
    }
    if (path[3] === "analyze" && request.method === "POST") {
      const row = await env.DB.prepare("SELECT * FROM submissions WHERE id = ? AND campaign = ?").bind(path[2], campaign.slug).first<Row>();
      if (!row) return json({ error: "Response not found." }, 404);
      const submission = toSubmission(row);
      ctx.waitUntil(runAnalysis(env, campaign, submission.id, submission.transcript, submission.context));
      return json({ ok: true });
    }
  }
  return json({ error: "Not found." }, 404);
}

/** Daily: delete transcripts past each campaign's retention period, and old rate-limit rows. */
async function cleanup(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("DELETE FROM sessions WHERE created_at < ?").bind(now - 2 * 86400).run();
  await env.DB.prepare("DELETE FROM login_attempts WHERE created_at < ?").bind(now - 2 * 86400).run();
  for (const campaign of Object.values(campaigns)) {
    await env.DB.prepare("DELETE FROM submissions WHERE campaign = ? AND created_at < ?").bind(campaign.slug, now - campaign.retentionDays * 86400).run();
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.split("/").filter(Boolean);
    if (path[0] !== "api") return env.ASSETS.fetch(request);

    // State-changing requests must come from this site.
    if (request.method !== "GET") {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin && !origin.startsWith("http://localhost:")) return json({ error: "Cross-site requests are not allowed." }, 403);
    }

    try {
      if (path[1] === "campaigns" && request.method === "GET") {
        const campaign = campaigns[path[2] || defaultCampaign];
        return campaign ? json(publicCampaign(campaign, env)) : json({ error: "That feedback page was not found." }, 404);
      }
      if (path[1] === "sessions" && request.method === "POST") return await startSession(request, env);
      if (path[1] === "submissions" && request.method === "POST") return await submit(request, env, ctx);
      if (path[1] === "review") return await review(request, env, ctx, path.slice(2));
      return json({ error: "Not found." }, 404);
    } catch (error) {
      console.error("Unhandled error", error instanceof Error ? error.message : "unknown");
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(cleanup(env));
  },
} satisfies ExportedHandler<Env>;
