-- Run once on an existing database: npx wrangler d1 execute artistic-intelligence-studio --remote --file=migrations/0001_accounts.sql
-- (a new database gets all of this from schema.sql)
ALTER TABLE productions ADD COLUMN owner TEXT;
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, pw TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS login_attempts (email TEXT NOT NULL, ip TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS attempts_email ON login_attempts (email, ts);
CREATE INDEX IF NOT EXISTS attempts_ip ON login_attempts (ip, ts);
