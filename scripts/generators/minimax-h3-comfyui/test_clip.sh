#!/bin/bash
# One clip from a picture, on the PC, then the PC is put to sleep.   ./test_clip.sh <picture> <prompt file> <seconds> <out mp4> [seed] [end picture]
set -e
HOST=${WIN_HOST:-win-gpu}; HERE=$(cd "$(dirname "$0")" && pwd); PIC=$1; PROMPT=$2; SECS=${3:-6}; OUT=$4; SEED=${5:-12345}; END=$6
up() { ssh -o ConnectTimeout=5 "$HOST" "curl -s -o NUL -w %{http_code} http://127.0.0.1:8188/system_stats" 2>/dev/null | tail -1; }
if [ "$(up)" != "200" ]; then ssh -o ConnectTimeout=8 "$HOST" 'schtasks /run /tn comfy_sys' >/dev/null 2>&1 || true; for i in $(seq 1 36); do [ "$(up)" = "200" ] && break; sleep 10; done; fi
[ "$(up)" = "200" ] || { echo "ComfyUI does not answer on $HOST"; exit 1; }
REMOTE='Desktop/projects/model/video-pipeline/projects/mf_testclip'
ssh "$HOST" "cd /d %USERPROFILE%\\Desktop\\projects\\model\\video-pipeline\\projects && mkdir mf_testclip" >/dev/null 2>&1 || true
scp -q "$HERE/test_clip.py" "$PIC" "$PROMPT" ${END:+"$END"} "$HOST:$REMOTE/"
B=$(basename "$PIC"); P=$(basename "$PROMPT"); E=${END:+$(basename "$END")}
ssh "$HOST" "cd /d %USERPROFILE%\\Desktop\\projects\\model\\video-pipeline\\projects\\mf_testclip && set PYTHONIOENCODING=utf-8&& C:\\ComfyUI\\venv\\Scripts\\python.exe test_clip.py $B $P $SECS $SEED out.mp4 $E"
scp -q "$HOST:$REMOTE/out.mp4" "$OUT"
ssh -o ConnectTimeout=8 "$HOST" 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0' || true
echo "clip is $OUT"
