export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  OPENAI_API_KEY?: string;
  SESSION_SECRET: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  REALTIME_MODEL: string;
  TRANSCRIBE_MODEL: string;
  ANALYSIS_MODEL: string;
  GUIDE_VOICE: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  REVIEWERS?: string;
  DEV_REVIEWER_EMAIL?: string;
}
