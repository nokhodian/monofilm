"""Chooses the best take of every clip and writes the plan that scripts/assemble-film.mjs builds the film from.
usage: python3 scripts/film-plan.py <folder with clips, state.json and reviews.json> [size WxH]
A take with no measured size fault beats one with a fault; of two with faults, the one that is good for longer wins; then the take the pairwise judge preferred (state.json best); a clip is cut
before its first size fault (good_until) and before its frozen tail. reviews.json comes from scripts/review-clips.py."""
import json, os, sys

folder = sys.argv[1]
size = sys.argv[2] if len(sys.argv) > 2 else "1280x720"
state = json.load(open(os.path.join(folder, "state.json")))
reviews = json.load(open(os.path.join(folder, "reviews.json"))) if os.path.exists(os.path.join(folder, "reviews.json")) else {}
plan = {"size": size, "fps": 24, "clips": []}
# how the generator's frames are shown: clay and handmade films keep every real frame twice (stop motion is shot on twos); a photographic film gets the missing frames made by interpolation (PACE=twos or interpolate)
plan["paceMode"] = os.environ.get("PACE", "interpolate")
if os.environ.get("MUSIC"): plan["music"] = os.path.abspath(os.environ["MUSIC"])  # a music bed file: the assembly lays it under the film and ducks it under the clips' own sound
# The takes are chosen together, not one clip at a time: a clip that is long and clean is worth little if the next clip starts with the character at another size. For every take: how long it is kept (up to 5.5 s)
# and, at every join, how far the size of each character at the end of one take is from its size at the start of the next (a join inside a scene weighs most; a scene change goes through black).
def first_cost(key, t):
    r = reviews.get(key, {}).get(str(t["attempt"]), {}); rec = state[key]; secs, hold = t["measure"]["seconds"], t["measure"]["hold"]
    keep = secs - hold + 0.3 if hold >= 1 else secs
    if r.get("good_until") is not None: keep = min(keep, r["good_until"])
    trim = max(2 if (key.endswith(":2") or not key.endswith(":1")) else 0, round(max(0, (r.get("settle") or 0) - 0.2) * 24)) / 24
    return -min(keep - trim, 5.5) + (0.3 if t["attempt"] != rec.get("best") else 0) + (0.2 if not r.get("ok") else 0), keep, trim, r.get("sizes") or {}, secs
import math
def join_cost(keyA, a, keyB, b):
    _, keepA, _, szA, secA = a; _, _, trimB, szB, secB = b; cont = keyB.endswith(":2") or not keyB.endswith(":1"); total = 0.0
    for name in szA:
        if name in szB and szA[name] and szB[name]:
            va = szA[name][min(len(szA[name]) - 1, int(keepA / secA * len(szA[name])))]; vb = szB[name][min(len(szB[name]) - 1, int(trimB / secB * len(szB[name])))]
            if va > 0.02 and vb > 0.02: total += abs(math.log(vb / va))
    return total * (8.0 if cont else 1.5)
keys = list(state.keys()); cand = [[(t, first_cost(k, t)) for t in state[k]["takes"]] for k in keys]
dp = []  # dp[i][j] = (the lowest cost of the clips up to i when clip i uses its take j, the take of clip i-1 that gives it)
for i, k in enumerate(keys):
    row = []
    for t, fc in cand[i]:
        if i == 0: row.append((fc[0], None)); continue
        cost, prev = min((dp[i - 1][q][0] + join_cost(keys[i - 1], cand[i - 1][q][1], k, fc), q) for q in range(len(cand[i - 1])))
        row.append((cost + fc[0], prev))
    dp.append(row)
j = min(range(len(dp[-1])), key=lambda x: dp[-1][x][0]); chosen = {}
for i in range(len(keys) - 1, -1, -1):
    chosen[keys[i]] = cand[i][j][0]; j = dp[i][j][1] if dp[i][j][1] is not None else 0
for key, rec in state.items():
    rv = reviews.get(key, {})
    def rank(t):
        r = rv.get(str(t["attempt"]), {})
        faults = r.get("size_faults") or []
        until = r.get("good_until")
        return (1 if (faults or until is not None) else 0, -(until if until is not None else 99), 0 if t["attempt"] == rec.get("best") else 1, 0 if r.get("ok") else 1, t["measure"]["hold"])
    take = chosen[key]
    r = rv.get(str(take["attempt"]), {})
    seconds, hold = take["measure"]["seconds"], take["measure"]["hold"]
    keep = seconds - hold + 0.3 if hold >= 1 else seconds
    if r.get("good_until") is not None:
        keep = min(keep, r["good_until"])
    settle = r.get("settle") or 0  # the generator draws the first half second at another size than the rest: that part is cut away
    trim = max(2 if (key.endswith(":2") or not key.endswith(":1")) else 0, round(max(0, settle - 0.2) * 24))
    plan["clips"].append({"file": os.path.basename(take["file"].replace("\\", "/")), "hold": hold, "keep": round(keep, 2), "trim_start_frames": trim, "continues": key.endswith(":2") or not key.endswith(":1"), "_push": rec.get("push") or 0, "_at": rec.get("push_at")})
    print(f"{key}: take {take['attempt']}  keep {keep:.1f}s of {seconds}s" + (f"  (size fault from {r['good_until'] + 0.2:.1f} s)" if r.get("good_until") is not None else ""))
# a scene chain (a clip and the clips that continue it) pushes in once: state.json push is its total, and each clip gets the share of its length (push_from to push)
chains = []
for c in plan["clips"]:
    if c["continues"] and chains: chains[-1].append(c)
    else: chains.append([c])
for chain in chains:
    total, seconds, done = max(c["_push"] for c in chain), sum(c["keep"] for c in chain) or 1, 0.0
    at = next((c["_at"] for c in chain if c["_at"]), None)
    for c in chain:
        if total:
            c["push_from"], c["push"] = round(total * done / seconds, 4), round(total * (done + c["keep"]) / seconds, 4)
            if at: c["push_at"] = at
        done += c["keep"]
for c in plan["clips"]: c.pop("_push"), c.pop("_at")
# a clip kept for less than MIN_KEEP seconds is a gap in the film: say which clips need a new take (and why), and write the list into the plan
MIN_KEEP = float(os.environ.get("MIN_KEEP", "2.5"))
retake = []
for key, c in zip(state.keys(), plan["clips"]):
    if c["keep"] - c["trim_start_frames"] / 24 < MIN_KEEP:
        rec = state[key]; r = reviews.get(key, {}).get(str(next(t["attempt"] for t in rec["takes"] if os.path.basename(t["file"].replace("\\", "/")) == c["file"])), {})
        retake.append({"clip": key, "kept": round(c["keep"] - c["trim_start_frames"] / 24, 1), "why": (r.get("size_faults") or [{}])[0].get("kind") or ((r.get("issues") or [{}])[0].get("problem", "") or "cut early")[:80]})
# the size of the first character at the end of one clip and the start of the next (the 12 measured frames of each take): a scene change between two sizes shows as a character that shrinks or grows
sizes_at = []
def series(key, c):
    rec = state[key]; t = next(t for t in rec["takes"] if os.path.basename(t["file"].replace("\\", "/")) == c["file"]); r = reviews.get(key, {}).get(str(t["attempt"]), {})
    sz = r.get("sizes") or {}; name = next(iter(sz), None); return (sz.get(name) or [], t["measure"]["seconds"], name)
keys = list(state.keys())
for i in range(len(keys) - 1):
    (a, sa, na), (b, sb, nb) = series(keys[i], plan["clips"][i]), series(keys[i + 1], plan["clips"][i + 1])
    if a and b and na == nb:
        end = a[min(len(a) - 1, max(0, int(plan["clips"][i]["keep"] / sa * len(a))))]; start = b[min(len(b) - 1, int(plan["clips"][i + 1]["trim_start_frames"] / 24 / (sb / len(b))))]  # the first frame that is shown, after the settling is cut away
        if end > 0.02 and start > 0.02:
            q = start / end; sizes_at.append({"join": keys[i] + " -> " + keys[i + 1], "name": na, "ratio": round(q, 2)})
            if q < 0.85 or q > 1.18: print("  size change at the join %s -> %s: %s is %d%% of its size" % (keys[i], keys[i + 1], na, round(q * 100)))
# a cut to a closer framing for a clip that continues another: framed on the characters (the box around them in the kept frames), as close as fits them, at most 1.45 times
for key, c in zip(state.keys(), plan["clips"]):
    if not c["continues"]: continue
    t = next(t for t in state[key]["takes"] if os.path.basename(t["file"].replace("\\", "/")) == c["file"]); r = reviews.get(key, {}).get(str(t["attempt"]), {}); b = [x for x in (r.get("bounds") or []) if x]
    secs = t["measure"]["seconds"]; n = len(r.get("bounds") or []) or 12
    kept = [x for i, x in enumerate(r.get("bounds") or []) if x and c["trim_start_frames"] / 24 <= (i + 0.5) * secs / n <= c["keep"]] or b
    if not kept: continue
    x1, y1, x2, y2 = (min(v[0] for v in kept), min(v[1] for v in kept), max(v[2] for v in kept), max(v[3] for v in kept))
    k = max(1.2, min(1.45, 1 / max(0.05, (x2 - x1) * 1.12), 1 / max(0.05, (y2 - y1) * 1.2))); cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    clamp = lambda v: max(0.0, min(1.0, v))
    c["cut_in"] = {"zoom": round(k - 1, 3), "at": [round(clamp((cx * k - 0.5) / (k - 1)), 3), round(clamp((cy * k - 0.5) / (k - 1)), 3)]}
plan["join_sizes"] = sizes_at
plan["retake"] = retake
planned = sum(max(0.0, t["measure"]["seconds"]) for t in [state[k]["takes"][0] for k in state])
achieved = sum(c["keep"] - c["trim_start_frames"] / 24 for c in plan["clips"])
print("film length: %.1f s kept of %.1f s generated (%d clips)" % (achieved, planned, len(plan["clips"])))
if retake: print("make again: ONLY=%s ./scripts/generators/minimax-h3-comfyui/run.sh" % ",".join(x["clip"] for x in retake))
if retake:
    print("NEEDS A NEW TAKE (kept less than %.1f s):" % MIN_KEEP)
    for x in retake: print("  %s  kept %.1f s  (%s)" % (x["clip"], x["kept"], x["why"]))
json.dump(plan, open(os.path.join(folder, "plan.json"), "w"), indent=1)
print("wrote", os.path.join(folder, "plan.json"))
