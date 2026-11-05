-- Monofilm: AI proposes, a human approves. Replaces the legacy projects/kv/presence tables (left untouched in any existing database; see legacy/schema.sql).
CREATE TABLE IF NOT EXISTS actors (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, role TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS productions (id TEXT PRIMARY KEY, name TEXT NOT NULL, format TEXT NOT NULL, budget REAL NOT NULL DEFAULT 0, shot_cap REAL NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL, owner TEXT);
-- One row per artifact; ref is "<kind>:<key>". Current state lives here, every version is kept in artifact_versions.
CREATE TABLE IF NOT EXISTS artifacts (production TEXT NOT NULL, ref TEXT NOT NULL, kind TEXT NOT NULL, parent TEXT, version INTEGER NOT NULL, status TEXT NOT NULL, stale INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, rationale TEXT NOT NULL DEFAULT '', cost REAL NOT NULL DEFAULT 0, author TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (production, ref));
CREATE INDEX IF NOT EXISTS artifacts_status ON artifacts (production, status);
CREATE TABLE IF NOT EXISTS artifact_versions (production TEXT NOT NULL, ref TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, rationale TEXT NOT NULL, cost REAL NOT NULL, author TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (production, ref, version));
-- ref was built from on_ref. Editing on_ref marks ref (and everything built on it) stale.
CREATE TABLE IF NOT EXISTS deps (production TEXT NOT NULL, ref TEXT NOT NULL, on_ref TEXT NOT NULL, PRIMARY KEY (production, ref, on_ref));
CREATE INDEX IF NOT EXISTS deps_on ON deps (production, on_ref);
-- Append-only audit log: propose, approve, request_changes, reject, keep, lock, unlock, budget_request, budget_grant, tool_call.
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, production TEXT NOT NULL, ref TEXT, version INTEGER, action TEXT NOT NULL, actor TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS events_prod ON events (production, id);
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, production TEXT NOT NULL, ref TEXT NOT NULL, uri TEXT NOT NULL, mime TEXT NOT NULL DEFAULT '', bytes INTEGER NOT NULL DEFAULT 0, provenance TEXT NOT NULL DEFAULT '{}', cost REAL NOT NULL DEFAULT 0, author TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS assets_ref ON assets (production, ref);
CREATE TABLE IF NOT EXISTS tools (name TEXT PRIMARY KEY, kind TEXT NOT NULL, transport TEXT NOT NULL, target TEXT NOT NULL DEFAULT '{}', cost_model TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1);
-- scope is the shot a charge counts against (or the artifact itself when it is not under a shot).
CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, production TEXT NOT NULL, ref TEXT NOT NULL, scope TEXT NOT NULL, tool TEXT NOT NULL, credits REAL NOT NULL, actor TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ledger_prod ON ledger (production, scope);
-- Feedback threads. A root comment (parent NULL) is open -> addressed (agent revised) -> resolved (human approved the revision); replies hang off the root.
CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, production TEXT NOT NULL, ref TEXT NOT NULL, version INTEGER, context TEXT, anchor TEXT, verdict TEXT, body TEXT NOT NULL DEFAULT '', author TEXT NOT NULL, author_kind TEXT NOT NULL, parent TEXT, status TEXT NOT NULL, addressed_in INTEGER, created INTEGER NOT NULL, updated INTEGER NOT NULL, attachment TEXT);
CREATE INDEX IF NOT EXISTS comments_ref ON comments (production, ref);
CREATE INDEX IF NOT EXISTS comments_status ON comments (production, status);
-- Who is looking right now (heartbeat from each open page). Same shape as the legacy table, so existing databases keep working.
CREATE TABLE IF NOT EXISTS presence (project TEXT NOT NULL, who TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (project, who));

-- Accounts: email and password. A password is stored only as a salted PBKDF2 hash; a session cookie is stored only as the hash of its token.
-- status: 'pending' until the person who runs the studio approves the sign-up, then 'approved' (or 'rejected'). credits: the allowance for the whole account, shared by all its productions.
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, pw TEXT NOT NULL, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'approved', credits REAL NOT NULL DEFAULT 15, role TEXT NOT NULL DEFAULT 'member');
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
-- Failed and successful sign-in tries, to slow down guessing.
CREATE TABLE IF NOT EXISTS login_attempts (email TEXT NOT NULL, ip TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS attempts_email ON login_attempts (email, ts);
CREATE INDEX IF NOT EXISTS attempts_ip ON login_attempts (ip, ts);

-- Roll camera, run by the server (a cron tick every minute carries it on), so it keeps going when the page is closed. One row per production.
CREATE TABLE IF NOT EXISTS autopilot (production TEXT PRIMARY KEY, status TEXT NOT NULL, actor TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, log TEXT NOT NULL DEFAULT '[]', err TEXT NOT NULL DEFAULT '', cur TEXT, left INTEGER NOT NULL DEFAULT 0, spent0 REAL NOT NULL DEFAULT 0, started INTEGER NOT NULL DEFAULT 0, finished INTEGER NOT NULL DEFAULT 0, lease INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL);
