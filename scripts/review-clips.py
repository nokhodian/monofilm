"""Reviews finished clips with the studio's clip review (sizes measured by SAM, a judge's checklist) without making anything new.
usage: MONOFILM_KEY=<agent key> python3 scripts/review-clips.py <production id> <folder with clips and state.json> [scene:clip,scene:clip]
For each take in state.json it takes 12 frames, asks the studio (review_take), prints what was found and until when each take is good (good_until, in seconds), and writes the answers to <folder>/reviews.json. Needs ffmpeg."""
import base64, json, os, subprocess, sys, tempfile, urllib.request

KEY, HOST = os.environ["MONOFILM_KEY"], os.environ.get("MONOFILM_HOST", "monofilm.monoes.me")
PROD, FOLDER = sys.argv[1], sys.argv[2]
ONLY = set(sys.argv[3].split(",")) if len(sys.argv) > 3 else None


def mcp(tool, args):
    req = urllib.request.Request(f"https://{HOST}/mcp", json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": args}}).encode(),
                                 {"Authorization": "Bearer " + KEY, "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "review-clips"})
    r = json.load(urllib.request.urlopen(req, timeout=300))["result"]
    if r.get("isError"):
        raise RuntimeError(json.dumps(r)[:300])
    return r["structuredContent"]


def frames_of(path, seconds, count=12):
    out, tmp = [], tempfile.mkdtemp()
    for i in range(count):
        t = max(0.05, (i + 0.5) * seconds / count - 0.1); jpg = os.path.join(tmp, f"f{i}.jpg")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", path, "-frames:v", "1", "-vf", "scale=384:-1", "-q:v", "4", jpg], check=True)
        out.append(base64.b64encode(open(jpg, "rb").read()).decode())
    return out


state = json.load(open(os.path.join(FOLDER, "state.json"))); results = {}
for key, rec in state.items():
    if ONLY and key not in ONLY:
        continue
    scene, clip = key.rsplit(":", 1)
    for take in rec["takes"]:
        path = os.path.join(FOLDER, os.path.basename(take["file"].replace("\\", "/")))
        secs = take["measure"]["seconds"]
        r = mcp("review_take", {"production": PROD, "scene": scene, "clip": int(clip), "frames": frames_of(path, secs)})
        faults = r.get("size_faults") or []
        print(f"{key} a{take['attempt']}  ok={r.get('ok')}  good_until={r.get('good_until')}  size faults: " + ("; ".join(f"{f['kind']} {f['name']} {f['ratio']}x at {f['at']} s" for f in faults[:5]) or "none"), flush=True)
        results.setdefault(key, {})[take["attempt"]] = {"ok": r.get("ok"), "good_until": r.get("good_until"), "size_faults": faults, "settle": r.get("settle"), "sizes": r.get("sizes"), "issues": r.get("issues"), "scores": r.get("scores")}
        json.dump(results, open(os.path.join(FOLDER, "reviews.json"), "w"), indent=1)
        print("    sizes:", {k: [round(x, 2) for x in v] for k, v in (r.get("sizes") or {}).items()}, flush=True)
