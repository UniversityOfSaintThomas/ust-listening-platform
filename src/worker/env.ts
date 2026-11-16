export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  OPENAI_API_KEY?: string;
  /** Override for testing. Defaults to https://api.openai.com/v1 */
  OPENAI_BASE_URL?: string;
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
  /** Password that creates and edits campaigns and opens every campaign's results. */
  ADMIN_PASSWORD?: string;
  /** Shared password that opens every campaign's results. */
  DASHBOARD_PASSWORD?: string;
}
