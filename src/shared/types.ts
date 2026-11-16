export type Question = {
  id: string;
  /** The question as the guide should ask it. */
  ask: string;
  /** What a useful answer contains. Tells the guide what to probe for. */
  listenFor: string;
};

/** One bucket that coded points are sorted into, for example "What is working". */
export type Category = {
  /** Stable key, lowercase letters, digits, and underscores. */
  id: string;
  /** Heading shown on the results page. */
  label: string;
  /** One sentence telling the coder what belongs here. */
  description: string;
};

export type HeadingSize = "compact" | "standard" | "large";

export type Design = {
  /** Main brand color: banner background, headings, links. */
  accent: string;
  /** Buttons and confirmations. */
  action: string;
  /** Small highlights on the banner. */
  highlight: string;
  headingSize: HeadingSize;
};

export type Campaign = {
  slug: string;
  status: "open" | "closed";
  /** Name of the campaign, shown to reviewers and in the browser tab. */
  title: string;
  /** Short name of the unit or project, used in speech and headings. */
  unit: string;
  /** How the guide should pronounce the unit name. */
  unitSpoken: string;
  /** Small line above the headline. Optional. */
  unitFullName: string;
  /** Small label at the top right of the page. */
  mastheadDetail: string;
  /** One word inside the circle on the banner. */
  heroWord: string;
  headline: string;
  invitation: string;
  introHeading: string;
  /** One or two sentences on why this is collected. Shown to participants. */
  purpose: string;
  /** Who reads the results, for example "STELAR leadership". Used in the notice. */
  readers: string;
  /** Extra notice lines for this campaign, shown after the standard ones. */
  extraNotice: string[];
  contextPrompt: string;
  /** Multiple-choice options shown before the conversation. Empty to skip. */
  contextOptions: string[];
  roles: string[];
  /** What the conversation is trying to learn. Given to the guide and the coder. */
  goal: string;
  /** Background the guide should know. Never shown to participants. */
  background: string;
  questions: Question[];
  categories: Category[];
  /** Fixed list so themes can be counted across responses. */
  themes: string[];
  /** Terms the transcriber should expect. */
  vocabulary: string[];
  thanksMessage: string;
  maxMinutes: number;
  retentionDays: number;
  dailySessionCap: number;
  design: Design;
};

/** What the browser receives for a participant page. */
export type PublicCampaign = Omit<Campaign, "dailySessionCap" | "vocabulary" | "background" | "goal" | "questions" | "categories" | "themes" | "extraNotice" | "readers"> & {
  consentLabel: string;
  notice: string[];
  whoSeesResponses: string;
  questionCount: number;
  turnstileSiteKey: string;
  /** True when a closed campaign is opened through its preview link. */
  preview: boolean;
};

export type Turn = { role: "participant" | "guide"; text: string };

export type Mode = "voice" | "text";

export type Point = { category: string; theme: string; point: string; quote: string };

export type Analysis = {
  summary: string;
  sentiment: "positive" | "mixed" | "negative" | "neutral";
  points: Point[];
  /** True when the response raises something that needs a person to follow up. */
  needsAttention: boolean;
  attentionNote: string;
};

export type ReviewSubmission = {
  id: string;
  createdAt: number;
  mode: Mode;
  role: string;
  context: string[];
  ease: number | null;
  transcript: Turn[];
  analysis: Analysis | null;
  analysisStatus: "pending" | "done" | "failed";
};

export type SynthesisBody = {
  overview: string;
  sections: { category: string; items: string[] }[];
};

export type Synthesis = SynthesisBody & { createdAt: number; responseCount: number };

export type ReviewData = {
  campaign: { slug: string; title: string; unit: string; status: Campaign["status"]; categories: Category[]; themes: string[]; contextPrompt: string; retentionDays: number };
  submissions: ReviewSubmission[];
  synthesis: Synthesis | null;
};

export type CampaignSummary = { slug: string; title: string; unit: string; status: Campaign["status"]; responses: number };

export type Me = { role: "admin" | "reviewer"; email: string; campaigns: CampaignSummary[] };

/** What the admin page receives for each campaign. */
export type AdminCampaign = { config: Campaign; responses: number; hasPassword: boolean; previewToken: string; updatedAt: number };
