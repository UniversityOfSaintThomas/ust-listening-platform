import type { Campaign, Category, Design, HeadingSize, Question } from "./types";

/**
 * Pure helpers for campaign configuration: defaults, cleaning and checking what an
 * admin saves, and the standard participant notice. Used by the Worker and the admin page.
 */

export const DEFAULT_DESIGN: Design = { accent: "#510c76", action: "#18563a", highlight: "#dce65b", headingSize: "standard" };

export const DEFAULT_CATEGORIES: Category[] = [
  { id: "strengths", label: "What is working", description: "Something the participant says is working well or that they value." },
  { id: "frictions", label: "Where there is friction", description: "A problem, delay, gap, or need that was not met." },
  { id: "suggestions", label: "What people ask for", description: "A change, request, or idea the participant puts forward." },
];

/** The AI disclosure every participant must tick. The same for every campaign. */
export const CONSENT_LABEL = "I understand that I will be talking with an AI guide, and that AI tools will be used to analyze responses and report findings.";

const HEX = /^#[0-9a-f]{6}$/;

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio between two #rrggbb colors. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Problems with a color set, in plain words. Empty when it meets WCAG AA for normal text. */
export function designProblems(design: Design): string[] {
  const problems: string[] = [];
  for (const key of ["accent", "action", "highlight"] as const) if (!HEX.test(design[key])) problems.push(`The ${key} color must be a six-digit hex value such as #510c76.`);
  if (problems.length) return problems;
  if (contrast(design.accent, "#ffffff") < 4.5) problems.push("The main color is too light for white text on it. Choose a darker color.");
  if (contrast(design.action, "#ffffff") < 4.5) problems.push("The button color is too light for white text on it. Choose a darker color.");
  if (contrast(design.highlight, design.accent) < 4.5) problems.push("The highlight color is too close to the main color to read. Choose a lighter highlight.");
  return problems;
}

const str = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const para = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max) : "");
const int = (value: unknown, min: number, max: number, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback);

function list(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const clean = str(item, maxLength);
    if (clean && !seen.has(clean.toLowerCase())) {
      seen.add(clean.toLowerCase());
      out.push(clean);
    }
    if (out.length >= maxItems) break;
  }
  return out;
}

export const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const keyify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);

/** Addresses the site uses for its own pages. */
const RESERVED = new Set(["api", "review", "admin", "c", "assets", "new"]);

/** A blank campaign with sensible defaults, for the "new campaign" form. */
export function blankCampaign(): Campaign {
  return {
    slug: "",
    status: "closed",
    title: "",
    unit: "",
    unitSpoken: "",
    unitFullName: "",
    mastheadDetail: "INTERNAL LISTENING PROJECT",
    heroWord: "LISTEN",
    headline: "",
    invitation: "",
    introHeading: "Your perspective matters here.",
    purpose: "",
    readers: "",
    extraNotice: [],
    contextPrompt: "",
    contextOptions: [],
    roles: ["Faculty", "Staff", "Student", "Other", "Prefer not to say"],
    goal: "",
    background: "",
    questions: [{ id: "q1", ask: "", listenFor: "" }],
    categories: DEFAULT_CATEGORIES.map((category) => ({ ...category })),
    themes: ["Other"],
    vocabulary: ["St. Thomas", "Tommie"],
    thanksMessage: "",
    maxMinutes: 12,
    retentionDays: 365,
    dailySessionCap: 300,
    design: { ...DEFAULT_DESIGN },
  };
}

/**
 * Cleans whatever was submitted into a well-formed campaign. Never throws. Fields the
 * input lacks fall back to defaults, so campaigns saved by an older version still load.
 */
export function cleanCampaign(input: unknown): Campaign {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const base = blankCampaign();
  const unit = str(raw.unit, 60);

  const questions: Question[] = [];
  const questionIds = new Set<string>();
  for (const item of Array.isArray(raw.questions) ? raw.questions.slice(0, 8) : []) {
    const record = (item || {}) as Record<string, unknown>;
    const ask = str(record.ask, 400);
    if (!ask) continue;
    let id = keyify(str(record.id, 30)) || `q${questions.length + 1}`;
    while (questionIds.has(id)) id = `${id}_${questions.length + 1}`;
    questionIds.add(id);
    questions.push({ id, ask, listenFor: str(record.listenFor, 500) });
  }

  const categories: Category[] = [];
  const categoryIds = new Set<string>();
  for (const item of Array.isArray(raw.categories) ? raw.categories.slice(0, 4) : []) {
    const record = (item || {}) as Record<string, unknown>;
    const label = str(record.label, 60);
    if (!label) continue;
    let id = keyify(str(record.id, 30)) || keyify(label) || `category_${categories.length + 1}`;
    while (categoryIds.has(id)) id = `${id}_${categories.length + 1}`;
    categoryIds.add(id);
    categories.push({ id, label, description: str(record.description, 300) });
  }

  const themes = list(raw.themes, 20, 60).filter((theme) => theme.toLowerCase() !== "other");
  themes.push("Other");

  const rawDesign = (raw.design && typeof raw.design === "object" ? raw.design : {}) as Record<string, unknown>;
  const color = (value: unknown, fallback: string) => (typeof value === "string" && HEX.test(value.trim().toLowerCase()) ? value.trim().toLowerCase() : fallback);
  const sizes: HeadingSize[] = ["compact", "standard", "large"];

  return {
    slug: slugify(str(raw.slug, 60)),
    status: raw.status === "open" ? "open" : "closed",
    title: str(raw.title, 90) || unit,
    unit,
    unitSpoken: str(raw.unitSpoken, 60) || unit,
    unitFullName: str(raw.unitFullName, 140),
    mastheadDetail: str(raw.mastheadDetail, 50),
    heroWord: str(raw.heroWord, 9).toUpperCase(),
    headline: str(raw.headline, 90),
    invitation: str(raw.invitation, 400),
    introHeading: str(raw.introHeading, 80) || base.introHeading,
    purpose: str(raw.purpose, 500),
    readers: str(raw.readers, 80) || (unit ? `${unit} leadership` : ""),
    extraNotice: list(raw.extraNotice, 4, 400),
    contextPrompt: str(raw.contextPrompt, 160),
    contextOptions: list(raw.contextOptions, 14, 60),
    roles: list(raw.roles, 8, 40),
    goal: str(raw.goal, 500),
    background: para(raw.background, 3000),
    questions,
    categories: categories.length ? categories : base.categories,
    themes,
    vocabulary: list(raw.vocabulary, 30, 40),
    thanksMessage: str(raw.thanksMessage, 300),
    maxMinutes: int(raw.maxMinutes, 5, 20, base.maxMinutes),
    retentionDays: int(raw.retentionDays, 30, 1095, base.retentionDays),
    dailySessionCap: int(raw.dailySessionCap, 10, 2000, base.dailySessionCap),
    design: {
      accent: color(rawDesign.accent, DEFAULT_DESIGN.accent),
      action: color(rawDesign.action, DEFAULT_DESIGN.action),
      highlight: color(rawDesign.highlight, DEFAULT_DESIGN.highlight),
      headingSize: sizes.includes(rawDesign.headingSize as HeadingSize) ? (rawDesign.headingSize as HeadingSize) : "standard",
    },
  };
}

/** What stops a cleaned campaign from being saved, in plain words. Empty when it can be saved. */
export function campaignProblems(campaign: Campaign): string[] {
  const problems: string[] = [];
  if (campaign.slug.length < 2) problems.push("Give the campaign a web address of at least two letters.");
  else if (RESERVED.has(campaign.slug)) problems.push(`"${campaign.slug}" is used by the site itself. Choose a different web address.`);
  if (!campaign.unit) problems.push("Add the short name of the unit or project.");
  if (!campaign.headline) problems.push("Add a headline.");
  if (campaign.invitation.length < 20) problems.push("Add an invitation of a sentence or two.");
  if (campaign.purpose.length < 20) problems.push("Add a purpose statement of a sentence or two. Participants read it before they start.");
  if (campaign.goal.length < 20) problems.push("Describe what the conversation is trying to learn. The guide works from it.");
  if (!campaign.questions.length) problems.push("Add at least one question.");
  if (campaign.categories.length < 2) problems.push("Add at least two analysis categories.");
  if (campaign.contextOptions.length > 0 && !campaign.contextPrompt) problems.push("Add the question shown above the context options, or remove the options.");
  problems.push(...designProblems(campaign.design));
  return problems;
}

function retentionPhrase(days: number): string {
  if (days % 365 === 0) return days === 365 ? "12 months" : `${days / 365} years`;
  if (days % 30 === 0) return `${days / 30} months`;
  return `${days} days`;
}

/**
 * The notice participants read. The data-handling lines are the same for every campaign
 * so they stay true to what the system does. A campaign can only add lines.
 */
export function buildNotice(campaign: Campaign): string[] {
  return [
    "Taking part is voluntary. You can skip any question, stop at any time, or discard everything at the end. Nothing is saved until you review the transcript and choose to submit.",
    "Your response is collected anonymously. There is no sign-in, and we do not ask for or store your name, email, or IP address.",
    "You will talk with an AI guide, not a person. Your audio is processed by OpenAI to run the conversation and is not stored by this site. OpenAI does not use it to train its models and may keep safety logs for up to 30 days.",
    "Before a transcript is saved, an automated step replaces names, contact details, and similar identifying details with placeholders such as [name]. It can miss things, so please describe services and processes instead of naming people, and leave out details that would identify you.",
    `AI tools analyze the saved transcripts and draft the summaries that ${campaign.readers} reads. People review those summaries before acting on them.`,
    "This is not a channel for urgent problems or formal complaints. Those should go to the IT help desk, your supervisor, or Human Resources.",
    ...campaign.extraNotice,
  ];
}

export function whoSeesResponses(campaign: Campaign): string {
  return `${campaign.readers} reads the themes, summaries, and de-identified transcripts. Transcripts are deleted after ${retentionPhrase(campaign.retentionDays)}.`;
}
