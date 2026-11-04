#!/usr/bin/env bash
# Stops what e2e-up.sh started. Usage: scripts/e2e-down.sh [state folder]
STATE="${1:-/tmp/monofilm-e2e}"
for p in standin wrangler; do [ -f "$STATE/$p.pid" ] && kill "$(cat "$STATE/$p.pid")" 2>/dev/null; done
fuser -k 8790/tcp 9099/tcp 2>/dev/null || true
echo down
