import { defaultCampaign } from "../../campaigns";
import { buildNotice, campaignProblems, cleanCampaign, CONSENT_LABEL, whoSeesResponses } from "../shared/campaign";
import type { AdminCampaign, Analysis, Campaign, CampaignSummary, Me, Mode, PublicCampaign, ReviewData, ReviewSubmission, Synthesis, Turn } from "../shared/types";
import { analyzeSubmission, draftCampaign, normalizeAnalysis, normalizeSynthesis, redactTranscript, synthesize } from "./analysis";
import type { Env } from "./env";
import { cleanTranscript, text, toCsv } from "./format";
import { buildGuideInstructions, transcriptionPrompt } from "./prompt";
import { adminPasswordMatches, campaignPasswordHash, clearedReviewCookie, ipHash, issueSubmitToken, passwordMark, passwordMatches, previewToken, readSubmitToken, resolveReviewer, reviewCookie, safeEqual, type Reviewer, type Scope, verifyTurnstile } from "./security";
import { createCampaign, deleteCampaign, getCampaign, listCampaigns, responseCounts, saveCampaign, setCampaignPassword, type CampaignRow } from "./store";

const SESSIONS_PER_IP_PER_HOUR = 6;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });


function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function publicCampaign(campaign: Campaign, env: Env, preview: boolean): PublicCampaign {
  const { dailySessionCap: _cap, vocabulary: _vocabulary, background: _background, goal: _goal, questions, categories: _categories, themes: _themes, extraNotice: _extra, readers: _readers, ...rest } = campaign;
  return {
    ...rest,
    status: preview ? "open" : campaign.status,
    consentLabel: CONSENT_LABEL,
    notice: buildNotice(campaign),
    whoSeesResponses: whoSeesResponses(campaign),
    questionCount: questions.length,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || "",
    preview,
  };
}

/** True when the caller holds the preview link for this campaign. */
async function isPreview(token: unknown, slug: string, env: Env): Promise<boolean> {
  return typeof token === "string" && token.length > 0 && Boolean(env.SESSION_SECRET) && safeEqual(token, await previewToken(slug, env));
}

function cleanContext(value: unknown, campaign: Campaign): string[] {
  return Array.isArray(value) ? campaign.contextOptions.filter((option) => value.includes(option)) : [];
}

/** Starts a conversation: checks limits, then mints a short-lived OpenAI client secret. */
async function startSession(request: Request, env: Env): Promise<Response> {
  if (!env.OPENAI_API_KEY || !env.SESSION_SECRET) return json({ error: "The listening guide is not configured yet." }, 503);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const campaign = (await getCampaign(env, text(body?.slug, 60)))?.campaign;
  if (!campaign) return json({ error: "That page was not found." }, 404);
  if (campaign.status !== "open" && !(await isPreview(body?.preview, campaign.slug, env))) return json({ error: "This page is closed." }, 403);
  if (body?.consent !== true) return json({ error: "Please confirm the notice before starting." }, 400);
  if (!(await verifyTurnstile(body?.turnstileToken, request, env))) return json({ error: "We could not confirm your browser. Please reload the page and try again." }, 403);

  const now = Math.floor(Date.now() / 1000);
  const hash = await ipHash(request, env);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE ip_hash = ? AND created_at > ?").bind(hash, now - 3600).first<{ n: number }>();
  if ((recent?.n || 0) >= SESSIONS_PER_IP_PER_HOUR) return json({ error: "Too many conversations were started from this network in the past hour. Please try again later." }, 429);
  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE campaign = ? AND created_at > ?").bind(campaign.slug, now - 86400).first<{ n: number }>();
  if ((today?.n || 0) >= campaign.dailySessionCap) return json({ error: "This page has reached its daily limit. Please try again tomorrow." }, 429);

  const mode: Mode = body?.mode === "text" ? "text" : "voice";
  const context = cleanContext(body?.context, campaign);
  const upstream = await fetch(`${env.OPENAI_BASE_URL || "https://api.openai.com/v1"}/realtime/client_secrets`, {
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

async function submit(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const campaign = (await getCampaign(env, text(body?.slug, 60)))?.campaign;
  if (!campaign) return json({ error: "That page was not found." }, 404);
  const sessionId = await readSubmitToken(body?.submitToken, campaign.slug, env);
  if (!sessionId) return json({ error: "This conversation has expired. Please start again." }, 403);

  const transcript = cleanTranscript(body?.transcript);
  if (!transcript.some((turn) => turn.role === "participant")) return json({ error: "There is nothing to submit yet. Add at least one response." }, 400);
  if (JSON.stringify(transcript).length > 120_000) return json({ error: "That transcript is too long to submit." }, 413);

  const spent = await env.DB.prepare("SELECT used FROM sessions WHERE id = ?").bind(sessionId).first<{ used: number }>();
  if (spent?.used) return json({ error: "This conversation was already submitted." }, 409);

  // Identifying details are removed before anything is stored. If that step fails,
  // nothing is saved and the participant can press Submit again.
  if (!env.OPENAI_API_KEY) return json({ error: "Responses cannot be saved right now. Please try again shortly." }, 503);
  let redacted: Turn[] | null = null;
  for (let attempt = 0; attempt < 1 && !redacted; attempt += 1) {
    redacted = await redactTranscript(env, campaign, transcript).catch((error: unknown) => {
      console.error("Redaction failed", error instanceof Error ? error.message : "unknown");
      return null;
    });
  }
  if (!redacted) return json({ error: "Your response could not be saved just now. Nothing was stored. Please press Submit again." }, 503);

  // Single use: the first submit for a session wins, repeats are rejected.
  const claimed = await env.DB.prepare("UPDATE sessions SET used = 1 WHERE id = ? AND used = 0").bind(sessionId).run();
  if (!claimed.meta.changes) return json({ error: "This conversation was already submitted." }, 409);

  const context = cleanContext(body?.context, campaign);
  const role = campaign.roles.includes(text(body?.role, 60)) ? text(body?.role, 60) : "";
  const ease = typeof body?.ease === "number" && Number.isInteger(body.ease) && body.ease >= 1 && body.ease <= 5 ? body.ease : null;
  const id = crypto.randomUUID();
  const day = Math.floor(Date.now() / 86_400_000) * 86_400; // Stored to the day, not the minute.
  await env.DB.prepare("INSERT INTO submissions (id, campaign, created_at, mode, role, context, transcript, ease) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, campaign.slug, day, body?.mode === "text" ? "text" : "voice", role || null, JSON.stringify(context), JSON.stringify(redacted), ease)
    .run();

  ctx.waitUntil(runAnalysis(env, campaign, id, redacted, context));
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
    context: parseJson<string[]>(row.context, []),
    ease: typeof row.ease === "number" ? row.ease : null,
    transcript: parseJson<Turn[]>(row.transcript, []),
    analysis: normalizeAnalysis(parseJson<unknown>(row.analysis, null)),
    analysisStatus: row.analysis_status === "done" ? "done" : row.analysis_status === "failed" ? "failed" : "pending",
  };
}

async function loadSubmissions(env: Env, slug: string): Promise<ReviewSubmission[]> {
  const result = await env.DB.prepare("SELECT * FROM submissions WHERE campaign = ? ORDER BY created_at DESC LIMIT 2000").bind(slug).all<Row>();
  return (result.results || []).map(toSubmission);
}

const LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60;

async function login(request: Request, env: Env): Promise<Response> {
  if (!env.SESSION_SECRET) return json({ error: "Sign-in has not been set up yet." }, 503);
  const now = Math.floor(Date.now() / 1000);
  const hash = await ipHash(request, env);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE ip_hash = ? AND created_at > ?").bind(hash, now - LOGIN_WINDOW_SECONDS).first<{ n: number }>();
  if ((recent?.n || 0) >= LOGIN_ATTEMPTS) return json({ error: "Too many attempts. Please wait 15 minutes and try again." }, 429);
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const password = text(body?.password, 200);

  // One password box. The admin password is tried first, then the shared review password, then each campaign's own.
  let scope: Scope | null = null;
  if (await adminPasswordMatches(password, env)) scope = { kind: "admin" };
  else if (await passwordMatches(password, env)) scope = { kind: "all" };
  else if (password) {
    const candidate = await campaignPasswordHash(password, env);
    const grants = (await listCampaigns(env)).filter((row) => row.passwordHash && safeEqual(row.passwordHash, candidate)).map((row) => ({ slug: row.campaign.slug, mark: passwordMark(row.passwordHash) }));
    if (grants.length) scope = { kind: "campaigns", grants };
  }
  if (!scope) {
    await env.DB.prepare("INSERT INTO login_attempts (ip_hash, created_at) VALUES (?, ?)").bind(hash, now).run();
    return json({ error: "That password is not correct." }, 401);
  }
  const response = json({ ok: true });
  response.headers.append("set-cookie", await reviewCookie(env, scope));
  return response;
}

async function toAdminCampaign(row: CampaignRow, env: Env, counts: Map<string, number>): Promise<AdminCampaign> {
  return { config: row.campaign, responses: counts.get(row.campaign.slug) || 0, hasPassword: Boolean(row.passwordHash), previewToken: await previewToken(row.campaign.slug, env), updatedAt: row.updatedAt };
}

/** Campaign management. Admins only. */
async function admin(request: Request, env: Env, path: string[]): Promise<Response> {
  const rows = await listCampaigns(env);
  const counts = await responseCounts(env);

  if (path[0] === "campaigns" && path.length === 1 && request.method === "GET") {
    return json({ campaigns: await Promise.all(rows.map((row) => toAdminCampaign(row, env, counts))) });
  }

  if (path[0] === "draft" && request.method === "POST") {
    if (!env.OPENAI_API_KEY) return json({ error: "Drafting is not configured." }, 503);
    const body = (await request.json().catch(() => null)) as { description?: unknown } | null;
    const description = text(body?.description, 4000);
    if (description.length < 30) return json({ error: "Describe the campaign in a few sentences first." }, 400);
    try {
      return json({ draft: await draftCampaign(env, description) });
    } catch (error) {
      console.error("Draft failed", error instanceof Error ? error.message : "unknown");
      return json({ error: "The draft could not be written. Please try again." }, 502);
    }
  }

  if (path[0] === "campaigns" && path.length === 1 && request.method === "POST") {
    const campaign = cleanCampaign(await request.json().catch(() => null));
    const problems = campaignProblems(campaign);
    if (problems.length) return json({ error: problems[0], problems }, 400);
    if (!(await createCampaign(env, campaign))) return json({ error: `The web address "${campaign.slug}" is already used by another campaign.` }, 409);
    const row = await getCampaign(env, campaign.slug);
    return row ? json(await toAdminCampaign(row, env, counts)) : json({ error: "The campaign could not be saved." }, 500);
  }

  const row = path[0] === "campaigns" ? rows.find((item) => item.campaign.slug === path[1]) : undefined;
  if (!row) return json({ error: "Not found." }, 404);
  const slug = row.campaign.slug;

  if (path.length === 2 && request.method === "PUT") {
    // The web address never changes after creation, so shared links and stored responses stay attached.
    const campaign = cleanCampaign({ ...((await request.json().catch(() => null)) as object | null), slug });
    const problems = campaignProblems(campaign);
    if (problems.length) return json({ error: problems[0], problems }, 400);
    await saveCampaign(env, campaign);
    return json(await toAdminCampaign({ ...row, campaign, updatedAt: Math.floor(Date.now() / 1000) }, env, counts));
  }

  if (path[2] === "password" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
    const password = text(body?.password, 200);
    if (!password) {
      await setCampaignPassword(env, slug, null);
      return json({ ok: true, hasPassword: false });
    }
    if (password.length < 10) return json({ error: "Use at least 10 characters." }, 400);
    if ((await adminPasswordMatches(password, env)) || (await passwordMatches(password, env))) return json({ error: "That password is already used for wider access. Choose a different one." }, 400);
    await setCampaignPassword(env, slug, await campaignPasswordHash(password, env));
    return json({ ok: true, hasPassword: true });
  }

  if (path.length === 2 && request.method === "DELETE") {
    if (counts.get(slug)) return json({ error: "This campaign has responses. Close it instead, or delete its responses first." }, 409);
    await deleteCampaign(env, slug);
    return json({ ok: true });
  }
  return json({ error: "Not found." }, 404);
}

async function review(request: Request, env: Env, path: string[]): Promise<Response> {
  if (path[0] === "login" && request.method === "POST") return login(request, env);
  if (path[0] === "logout" && request.method === "POST") {
    const response = json({ ok: true });
    response.headers.append("set-cookie", clearedReviewCookie);
    return response;
  }
  const rows = await listCampaigns(env);
  const reviewer: Reviewer | null = await resolveReviewer(request, env, rows.map((row) => ({ slug: row.campaign.slug, mark: row.passwordHash ? passwordMark(row.passwordHash) : "" })));
  if (!reviewer) return json({ error: "Enter a review password to open this page." }, 401);

  if (path[0] === "me" && request.method === "GET") {
    const counts = await responseCounts(env);
    const campaigns: CampaignSummary[] = rows
      .filter((row) => reviewer.slugs.includes(row.campaign.slug))
      .map(({ campaign }) => ({ slug: campaign.slug, title: campaign.title, unit: campaign.unit, status: campaign.status, responses: counts.get(campaign.slug) || 0 }));
    return json({ role: reviewer.role, email: reviewer.email, campaigns } satisfies Me);
  }

  if (path[0] === "admin") {
    if (reviewer.role !== "admin") return json({ error: "Sign in with the admin password to manage campaigns." }, 403);
    return admin(request, env, path.slice(1));
  }

  const campaign = rows.find((row) => row.campaign.slug === path[0])?.campaign;
  if (!campaign || !reviewer.slugs.includes(campaign.slug)) return json({ error: "You do not have access to this campaign." }, 403);

  const loadSynthesis = async (): Promise<Synthesis | null> => {
    const stored = await env.DB.prepare("SELECT created_at, response_count, body FROM syntheses WHERE campaign = ?").bind(campaign.slug).first<Row>();
    return stored ? { createdAt: Number(stored.created_at), responseCount: Number(stored.response_count), ...normalizeSynthesis(parseJson<unknown>(stored.body, null)) } : null;
  };
  const reviewData = async (): Promise<ReviewData> => ({
    campaign: { slug: campaign.slug, title: campaign.title, unit: campaign.unit, status: campaign.status, categories: campaign.categories, themes: campaign.themes, contextPrompt: campaign.contextPrompt, retentionDays: campaign.retentionDays },
    submissions: await loadSubmissions(env, campaign.slug),
    synthesis: await loadSynthesis(),
  });

  if (path.length === 1 && request.method === "GET") return json(await reviewData());

  if (path[1] === "export.csv" && request.method === "GET") {
    return new Response(`\uFEFF${toCsv(await loadSubmissions(env, campaign.slug), campaign.categories)}`, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${campaign.slug}-responses.csv"`, "cache-control": "no-store" },
    });
  }

  if (path[1] === "export.json" && request.method === "GET") {
    const data = await reviewData();
    const body = { exportedAt: new Date().toISOString(), campaign: { ...data.campaign, goal: campaign.goal, questions: campaign.questions }, synthesis: data.synthesis, responses: data.submissions };
    return new Response(JSON.stringify(body, null, 2), {
      headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${campaign.slug}-responses.json"`, "cache-control": "no-store" },
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
      // Awaited so the page can re-code many responses one after another and show progress.
      await runAnalysis(env, campaign, submission.id, submission.transcript, submission.context);
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
  for (const { campaign } of await listCampaigns(env)) {
    await env.DB.prepare("DELETE FROM submissions WHERE campaign = ? AND created_at < ?").bind(campaign.slug, now - campaign.retentionDays * 86400).run();
  }
}

/** The campaign for a participant page. With no slug: the default campaign, or the first open one. */
async function findPublicCampaign(env: Env, slug: string): Promise<Campaign | null> {
  if (slug) return (await getCampaign(env, slug))?.campaign || null;
  const preferred = (await getCampaign(env, defaultCampaign))?.campaign;
  if (preferred?.status === "open") return preferred;
  return (await listCampaigns(env)).find((row) => row.campaign.status === "open")?.campaign || preferred || null;
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
        const campaign = await findPublicCampaign(env, text(path[2], 60));
        if (!campaign) return json({ error: "That page was not found." }, 404);
        return json(publicCampaign(campaign, env, campaign.status !== "open" && (await isPreview(url.searchParams.get("preview"), campaign.slug, env))));
      }
      if (path[1] === "sessions" && request.method === "POST") return await startSession(request, env);
      if (path[1] === "submissions" && request.method === "POST") return await submit(request, env, ctx);
      if (path[1] === "review") return await review(request, env, path.slice(2));
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
