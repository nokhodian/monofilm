-- Run once on an existing database: npx wrangler d1 execute artistic-intelligence-studio --remote --file=migrations/0003_admin_accounts.sql
-- An account is a 'member' unless the studio owner made it an 'admin' (signs in with email and password, and decides on accounts and credits).
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
