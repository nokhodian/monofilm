#!/usr/bin/env bash
# Local studio for driving the UI end to end: stand-in Meta on :9099, studio on :8790, admin key "e2e-admin", invite code "e2e-invite". State lives in $1 (default a temp folder).
# Set PORT=8791 to run a second studio, and STANDIN=0 to reuse a stand-in that is already running.
# Usage: scripts/e2e-up.sh /path/to/state   then   curl -H 'authorization: Bearer e2e-admin' localhost:8790/api/me   Stop with scripts/e2e-down.sh
set -e
cd "$(dirname "$0")/.."
STATE="${1:-/tmp/monofilm-e2e}"; mkdir -p "$STATE"
PORT="${PORT:-8790}"
[ "${STANDIN:-1}" = 1 ] && { node scripts/standin-meta.mjs 9099 > "$STATE/standin.log" 2>&1 & echo $! > "$STATE/standin.pid"; }
npx wrangler d1 execute artistic-intelligence-studio --local --persist-to "$STATE/wr" --file=schema.sql > "$STATE/schema.log" 2>&1
npx wrangler dev --local --port $PORT --persist-to "$STATE/wr" --var ADMIN_KEY:e2e-admin --var MODEL_API_KEY:LLM_standin --var META_BASE:http://localhost:9099/v1 --var SIGNUP_CODE:e2e-invite > "$STATE/wrangler.log" 2>&1 & echo $! > "$STATE/wrangler.pid"
for i in $(seq 1 40); do curl -s -o /dev/null -H 'authorization: Bearer e2e-admin' localhost:$PORT/api/me && break; sleep 1; done
echo "up: http://localhost:$PORT  (key e2e-admin, invite code e2e-invite)"
