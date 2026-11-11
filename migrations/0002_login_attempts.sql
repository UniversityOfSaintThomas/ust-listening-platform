-- Failed dashboard sign-in attempts, for rate limiting. Holds the same daily-rotating
-- IP hash as the sessions table. Rows are purged after 48 hours.
CREATE TABLE IF NOT EXISTS login_attempts (
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_ip ON login_attempts (ip_hash, created_at);
