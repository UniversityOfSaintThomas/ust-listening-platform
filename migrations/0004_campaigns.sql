-- Campaigns move from code files into the database so they can be created and edited
-- from the admin page. config holds the campaign as JSON. review_password_hash is a
-- keyed hash of an optional password that opens only this campaign's results.
CREATE TABLE IF NOT EXISTS campaigns (
  slug TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'closed',
  config TEXT NOT NULL,
  review_password_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
