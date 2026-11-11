export type Question = {
  id: string;
  /** The question as the guide should ask it. */
  ask: string;
  /** What a useful answer contains. Tells the guide what to probe for. */
  listenFor: string;
};

export type Campaign = {
  slug: string;
  status: "open" | "closed";
  /** Short unit name, used in speech and headings. */
  unit: string;
  /** How the guide should pronounce the unit name. */
  unitSpoken: string;
  unitFullName: string;
  headline: string;
  invitation: string;
  /** Plain-language notice shown before the conversation starts. */
  notice: string[];
  whoSeesResponses: string;
  contextPrompt: string;
  contextOptions: string[];
  roles: string[];
  questions: Question[];
  /** Fixed list so themes can be counted across responses. */
  themes: string[];
  /** Terms the transcriber should expect. */
  vocabulary: string[];
  maxMinutes: number;
  retentionDays: number;
  dailySessionCap: number;
};

/** The subset of a campaign that is safe to send to the browser. */
export type PublicCampaign = Omit<Campaign, "dailySessionCap" | "vocabulary"> & {
  turnstileSiteKey: string;
};

export type Turn = { role: "participant" | "guide"; text: string };

export type Mode = "voice" | "text";

export type AnalysisItem = { theme: string; point: string; quote: string };

export type Analysis = {
  summary: string;
  sentiment: "positive" | "mixed" | "negative" | "neutral";
  strengths: AnalysisItem[];
  frictions: AnalysisItem[];
  suggestions: AnalysisItem[];
  /** True when the response raises something that needs a person to follow up. */
  needsAttention: boolean;
  attentionNote: string;
};

export type ReviewSubmission = {
  id: string;
  createdAt: number;
  mode: Mode;
  role: string;
  name: string;
  context: string[];
  ease: number | null;
  transcript: Turn[];
  analysis: Analysis | null;
  analysisStatus: "pending" | "done" | "failed";
};

export type Synthesis = {
  createdAt: number;
  responseCount: number;
  overview: string;
  strengths: string[];
  frictions: string[];
  priorities: string[];
};

export type ReviewData = {
  campaign: { slug: string; unit: string; themes: string[]; retentionDays: number };
  submissions: ReviewSubmission[];
  synthesis: Synthesis | null;
};
