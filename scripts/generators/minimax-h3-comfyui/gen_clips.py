"""Renders every clip of a Monofilm production with MiniMax H3 on a local ComfyUI, measures and reviews it, and sends it back as a take.
Needs the ComfyUI helpers (post, upload, wait, out_files, h3_graph, FF) from the video-pipeline project: its lib.py is imported from ../momo (see the sys.path line below).
Environment: MONOFILM_KEY (an agent key), PROD (production id), ONLY (optional, comma list of scene:clip). Tries a clip as many times as get_clip allows,
keeps the best take by pairwise comparison (state.json: best), and never stores or prints the key.
"""
import base64, json, os, re, shutil, subprocess, sys, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "momo"))
from lib import post, upload, wait, out_files, h3_graph, FF  # ComfyUI helpers (read-only import)

PROD = os.environ.get("PROD", "4i33145k")
HOST = os.environ.get("MONOFILM_HOST", "monofilm.monoes.me")
KEY = os.environ["MONOFILM_KEY"]
CLIPS, PICS = os.path.join(HERE, "clips"), os.path.join(HERE, "pics")
STATE = os.path.join(HERE, "state.json")
os.makedirs(CLIPS, exist_ok=True); os.makedirs(PICS, exist_ok=True)
W, H = 1024, 576
state = json.load(open(STATE)) if os.path.exists(STATE) else {}

def mcp(tool, args):
    import time
    last = None
    for i in range(8):
        try:
            req = urllib.request.Request(f"https://{HOST}/mcp", json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": args}}).encode(),
                {"Authorization": "Bearer " + KEY, "Content-Type": "application/json", "Accept": "application/json"})
            r = json.load(urllib.request.urlopen(req, timeout=300))["result"]
            if r.get("isError"): raise RuntimeError(f"{tool}: {json.dumps(r)[:400]}")
            return r["structuredContent"]
        except (urllib.error.URLError, ConnectionError, TimeoutError, OSError) as e:  # the network of this PC drops now and then: wait and try again
            last = e; print("  network error, retrying:", str(e)[:120], flush=True); time.sleep(15 * (i + 1))
    raise last

def fetch(pic, name):
    dst = os.path.join(PICS, name)
    if not os.path.exists(dst):
        req = urllib.request.Request(re.sub(r"^https://[^/]+", f"https://{HOST}", pic["url"]), headers={"Authorization": "Bearer " + KEY})
        for i in range(8):
            try: open(dst, "wb").write(urllib.request.urlopen(req, timeout=120).read()); break
            except (urllib.error.URLError, OSError): import time; time.sleep(15 * (i + 1))
    return dst

def last_frame(mp4, png):
    subprocess.run([FF, "-y", "-loglevel", "error", "-sseof", "-0.1", "-i", mp4, "-frames:v", "1", png], check=True)
    return png

def measure(mp4):
    env = dict(os.environ, FFMPEG=FF)
    out = subprocess.run(["node", os.path.join("measure", "scripts", "measure-take.mjs"), mp4], cwd=HERE, env=env, capture_output=True, text=True, check=True).stdout
    return json.loads(out.strip().splitlines()[-1])

def frames_of(mp4, secs, count=12):
    out = []
    for i in range(count):
        t = max(0.05, (i + 0.5) * secs / count - 0.1)
        jpg = mp4[:-4] + f"_f{i}.jpg"
        subprocess.run([FF, "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", mp4, "-frames:v", "1", "-vf", "scale=384:-1", "-q:v", "4", jpg], check=True)
        out.append(base64.b64encode(open(jpg, "rb").read()).decode()); os.remove(jpg)
    return out

def review(sc, n, mp4, secs):
    try:
        return mcp("review_take", {"production": PROD, "scene": sc, "clip": n, "frames": frames_of(mp4, secs)})
    except Exception as e:
        print("  review failed:", str(e)[:200], flush=True); return None

def cut_start(sc, n, d):
    """A clip that continues the one before starts from the frame where that clip is cut (its review says it is good until t), not from the planned start picture: otherwise the film shows
    the end of one clip and the start of the next at two different places (a character that jumps, shrinks or grows at the join). Returns (png, t) or None."""
    if n < 2 or d.get("begins") != "continues" or os.environ.get("CHAIN_FROM_CUT") == "0": return None
    rec = state.get(f"{sc}:{n-1}")
    if not rec or not rec["takes"]: return None
    def rank(t):
        gu = (t.get("review") or {}).get("good_until")
        return (1 if gu is not None else 0, -(gu if gu is not None else 99), 0 if t["attempt"] == rec.get("best") else 1)
    t = sorted(rec["takes"], key=rank)[0]; gu = (t.get("review") or {}).get("good_until")
    if gu is None or gu >= t["measure"]["seconds"] - 0.6: return None
    png = os.path.join(PICS, f"{sc}_{n}_cut.png")
    subprocess.run([FF, "-y", "-loglevel", "error", "-ss", f"{max(0.3, gu - 0.05):.2f}", "-i", os.path.join(HERE, t["file"]), "-frames:v", "1", png], check=True)
    return png, gu

def render(sc, n, d, attempt, prompt, seed, prev_file):
    dst = os.path.join(CLIPS, f"{sc}_{n}_a{attempt}.mp4")
    g = h3_graph(prompt, "x", W, H, d["seconds"], seed, prefix=f"{PROD}/{sc}_{n}_a{attempt}")
    cut = cut_start(sc, n, d)
    if cut:
        first = cut[0]; print(f"  starts from the frame of the clip before at {cut[1]} s (where it is cut)", flush=True)
    elif d["start_picture"]:
        first = fetch(d["start_picture"], f"{sc}_{n}_start.png")
    else:
        first = last_frame(prev_file, os.path.join(PICS, f"{sc}_{n}_cont.png"))
    g["20"]["inputs"]["image"] = upload(first)
    if d["end_picture"]:
        g["30"] = {"class_type": "LoadImage", "inputs": {"image": upload(fetch(d["end_picture"], f"{sc}_{n}_end.png"))}}
        g["31"] = {"class_type": "ImageScale", "inputs": {"image": ["30", 0], "upscale_method": "lanczos", "width": W, "height": H, "crop": "center"}}
        g["6"]["inputs"]["last_frame"] = ["31", 0]
    out, t = wait(post("/prompt", {"prompt": g})["prompt_id"], poll=5)
    shutil.copy(out_files(out)[0], dst)
    return dst, t

def submit(sc, n, f, seed, m, rv=None):
    body = {"production": PROD, "scene": sc, "clip": n, "mime": "video/mp4", "data_base64": base64.b64encode(open(f, "rb").read()).decode(),
            "seed": seed, "hold": m["hold"], "cuts": m["cuts"], "smooth": m["smooth"], "note": "MiniMax H3 local, 8-step turbo, reviewed", **({"review": rv} if rv else {})}
    return mcp("submit_take", body)

clips = mcp("list_clips", {"production": PROD})["items"]
prev_first = None
for c in clips:
    sc, n = c["scene"], c["clip"]
    key = f"{sc}:{n}"
    if os.environ.get("ONLY") and key not in os.environ["ONLY"].split(","): continue
    rec = state.setdefault(key, {"takes": []})
    frames_by = {}  # frames of each take, kept for the pairwise comparison
    for attempt in (1, 2, 3, 4):
        if len(rec["takes"]) >= attempt: continue
        d = mcp("get_clip", {"production": PROD, "scene": sc, "clip": n, "generator": "minimax-h3"})
        r = d["retry"]
        if attempt >= 2 and (not r.get("try_again") or attempt > r.get("max_attempts", 3)): break
        prompt = d["prompt"] + (("\n" + r["add_to_prompt"]) if attempt >= 2 and r.get("add_to_prompt") else "")
        prev = os.path.join(CLIPS, f"{sc}_{n-1}_a1.mp4")
        f, t = render(sc, n, d, attempt, prompt, r["seed"], prev)
        m = measure(f)
        frames_by[attempt] = frames_of(f, m['seconds'])
        rv = review(sc, n, f, m['seconds'])
        if rv: print('  review:', json.dumps({k: rv.get(k) for k in ('ok', 'seen', 'issues', 'advice')})[:600], flush=True)
        print(key, f"attempt {attempt} seed {r['seed']} render {t:.0f}s", json.dumps(m), flush=True)
        res = submit(sc, n, f, r["seed"], m, rv)
        print("  submitted:", json.dumps(res)[:300], flush=True)
        rec["takes"].append({"attempt": attempt, "file": os.path.relpath(f, HERE), "seed": r["seed"], "measure": m, "review": rv, "render_s": round(t),
                             "prompt": prompt, "start_picture_null": d["start_picture"] is None,
                             "try_again_before": r.get("try_again"), "problems": r.get("last_take_problems"), "add_to_prompt": r.get("add_to_prompt")})
        if attempt == 1: rec["best"] = 1
        else:
            try:  # which of the two is better? a judge agrees with people most when it compares
                cmp_ = mcp("compare_takes", {"production": PROD, "scene": sc, "clip": n, "frames_a": frames_by[rec.get("best", 1)], "frames_b": frames_by[attempt]})
                print("  compare:", json.dumps({k: cmp_.get(k) for k in ("winner", "reason")})[:300], flush=True)
                if cmp_.get("winner") == "B": rec["best"] = attempt
            except Exception as e: print("  compare failed:", str(e)[:160], flush=True)
        json.dump(state, open(STATE, "w"), indent=1)
    # after the final take, record what the studio now says
    d = mcp("get_clip", {"production": PROD, "scene": sc, "clip": n, "generator": "minimax-h3"})
    rec["final_retry"] = d["retry"]; rec["seconds"] = d["seconds"]
    if d.get("post_push"): rec["push"] = d["post_push"]
    json.dump(state, open(STATE, "w"), indent=1)
print("ALL_DONE", flush=True)
