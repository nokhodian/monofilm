-- Run once on an existing database: npx wrangler d1 execute artistic-intelligence-studio --remote --file=migrations/0002_approval_credits_autopilot.sql
-- (a new database gets all of this from schema.sql)
-- Accounts: new sign-ups wait for approval ('pending'); everyone who already has an account stays 'approved'. credits is the whole account's allowance across all its productions.
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE users ADD COLUMN credits REAL NOT NULL DEFAULT 15;
-- Roll camera runs on the server, so it carries on when the page is closed. One row per production.
CREATE TABLE IF NOT EXISTS autopilot (production TEXT PRIMARY KEY, status TEXT NOT NULL, actor TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, log TEXT NOT NULL DEFAULT '[]', err TEXT NOT NULL DEFAULT '', cur TEXT, left INTEGER NOT NULL DEFAULT 0, spent0 REAL NOT NULL DEFAULT 0, started INTEGER NOT NULL DEFAULT 0, finished INTEGER NOT NULL DEFAULT 0, lease INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL);
