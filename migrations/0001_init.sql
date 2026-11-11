-- Rate-limit and single-use submit log. Holds a salted, daily-rotating hash of the
-- caller's IP, never the IP itself. Rows are purged after 48 hours. Nothing in this
-- table is linked to a submission.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  campaign TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sessions_ip ON sessions (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS sessions_campaign ON sessions (campaign, created_at);

-- One row per submitted conversation. created_at is rounded down to the hour.
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  campaign TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  mode TEXT NOT NULL,
  role TEXT,
  name TEXT,
  context TEXT NOT NULL,
  transcript TEXT NOT NULL,
  ease INTEGER,
  analysis TEXT,
  analysis_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS submissions_campaign ON submissions (campaign, created_at);

-- Latest campaign-level synthesis, generated on request by a reviewer.
CREATE TABLE IF NOT EXISTS syntheses (
  campaign TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  response_count INTEGER NOT NULL,
  body TEXT NOT NULL
);
