#!/bin/bash
# Generates every clip of a production on a Windows PC that runs ComfyUI, then copies the clips and the state back and puts the PC to sleep.
#   WIN_HOST=win-gpu MONOFILM_KEY=... PROD=abc123 NAME=my-film ./run.sh        (ONLY=scene:clip,scene:clip makes only those clips: the plan's retake list says which)
# No motion control: the H3 graph has no motion-amplitude or CFG input (BasicGuider, 8-step turbo). MiniMaxH3SigmaShift (flow shift 12 -> 20, 32) was measured on slow-climb 1: same motion, same frozen tail, so it is not wired in. Steer motion by prompt and by the cut/hold measures.
# The PC needs: ComfyUI on 127.0.0.1:8188 with the MiniMax H3 files, Python with the ComfyUI helper lib (see gen_clips.py), node and the repo's scripts/measure-take.mjs (copied by this script).
set -e
HOST=${WIN_HOST:-win-gpu}; : "${MONOFILM_KEY:?set MONOFILM_KEY}"; : "${PROD:?set PROD}"; NAME=${NAME:-$PROD}; HERE=$(cd "$(dirname "$0")" && pwd); OUT=${OUT:-$HOME/Videos/monofilm/$NAME}; mkdir -p "$OUT"
# ComfyUI does not start by itself after the PC wakes (nobody is logged in on its desktop, so a normal task or an ssh child never runs): the scheduled task comfy_sys, made once on the PC as SYSTEM, starts it
up() { ssh -o ConnectTimeout=5 "$HOST" "curl -s -o NUL -w %{http_code} http://127.0.0.1:8188/system_stats" 2>/dev/null | tail -1; }
if [ "$(up)" != "200" ]; then ssh -o ConnectTimeout=8 "$HOST" 'schtasks /run /tn comfy_sys' >/dev/null 2>&1 || true; for i in $(seq 1 36); do [ "$(up)" = "200" ] && break; sleep 10; done; fi
[ "$(up)" = "200" ] || { echo "ComfyUI does not answer on $HOST (the task comfy_sys makes it start: schtasks /create /tn comfy_sys /ru SYSTEM /rl HIGHEST /tr \"cmd /c cd /d C:\\ComfyUI && C:\\ComfyUI\\venv\\Scripts\\python.exe main.py --listen 127.0.0.1 --port 8188\" /sc once /st 00:00)"; exit 1; }
REMOTE='%USERPROFILE%\Desktop\projects\model\video-pipeline\projects'
ssh "$HOST" "cd /d $REMOTE && mkdir mf_$NAME && xcopy /E /I /Q pip_cartoon\\measure mf_$NAME\\measure" >/dev/null 2>&1 || true
scp -q "$HERE/gen_clips.py" "$HOST:Desktop/projects/model/video-pipeline/projects/mf_$NAME/gen_clips.py"
ssh "$HOST" "cd /d $REMOTE\\mf_$NAME && set MONOFILM_KEY=$MONOFILM_KEY&& set PROD=$PROD&& ${ONLY:+set ONLY=$ONLY&&} set PYTHONIOENCODING=utf-8&& C:\\ComfyUI\\venv\\Scripts\\python.exe gen_clips.py > gen.log 2>&1"
P="Desktop/projects/model/video-pipeline/projects/mf_$NAME"
scp -q "$HOST:$P/state.json" "$OUT/"; scp -q "$HOST:$P/clips/*.mp4" "$OUT/"; scp -q "$HOST:$P/gen.log" "$OUT/"
ssh -o ConnectTimeout=8 "$HOST" 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0' || true
echo "clips are in $OUT; build the film with: npm run assemble"
