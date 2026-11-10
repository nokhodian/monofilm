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
if os.environ.get("MUSIC"): plan["music"] = os.path.abspath(os.environ["MUSIC"])  # a music bed file: the assembly lays it under the film and ducks it under the clips' own sound
for key, rec in state.items():
    rv = reviews.get(key, {})
    def rank(t):
        r = rv.get(str(t["attempt"]), {})
        faults = r.get("size_faults") or []
        until = r.get("good_until")
        return (1 if (faults or until is not None) else 0, -(until if until is not None else 99), 0 if t["attempt"] == rec.get("best") else 1, 0 if r.get("ok") else 1, t["measure"]["hold"])
    take = sorted(rec["takes"], key=rank)[0]
    r = rv.get(str(take["attempt"]), {})
    seconds, hold = take["measure"]["seconds"], take["measure"]["hold"]
    keep = seconds - hold + 0.3 if hold >= 1 else seconds
    if r.get("good_until") is not None:
        keep = min(keep, r["good_until"])
    plan["clips"].append({"file": os.path.basename(take["file"].replace("\\", "/")), "hold": hold, "keep": round(keep, 2), "continues": key.endswith(":2") or not key.endswith(":1"), "_push": rec.get("push") or 0, "_at": rec.get("push_at")})
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
    if c["keep"] < MIN_KEEP:
        rec = state[key]; r = reviews.get(key, {}).get(str(next(t["attempt"] for t in rec["takes"] if os.path.basename(t["file"].replace("\\", "/")) == c["file"])), {})
        retake.append({"clip": key, "kept": c["keep"], "why": (r.get("size_faults") or [{}])[0].get("kind") or ((r.get("issues") or [{}])[0].get("problem", "") or "cut early")[:80]})
# the size of the first character at the end of one clip and the start of the next (the 12 measured frames of each take): a scene change between two sizes shows as a character that shrinks or grows
sizes_at = []
def series(key, c):
    rec = state[key]; t = next(t for t in rec["takes"] if os.path.basename(t["file"].replace("\\", "/")) == c["file"]); r = reviews.get(key, {}).get(str(t["attempt"]), {})
    sz = r.get("sizes") or {}; name = next(iter(sz), None); return (sz.get(name) or [], t["measure"]["seconds"], name)
keys = list(state.keys())
for i in range(len(keys) - 1):
    (a, sa, na), (b, sb, nb) = series(keys[i], plan["clips"][i]), series(keys[i + 1], plan["clips"][i + 1])
    if a and b and na == nb:
        end = a[min(len(a) - 1, max(0, int(plan["clips"][i]["keep"] / sa * len(a))))]; start = b[0]
        if end > 0.02 and start > 0.02:
            q = start / end; sizes_at.append({"join": keys[i] + " -> " + keys[i + 1], "name": na, "ratio": round(q, 2)})
            if q < 0.85 or q > 1.18: print("  size change at the join %s -> %s: %s is %d%% of its size" % (keys[i], keys[i + 1], na, round(q * 100)))
plan["join_sizes"] = sizes_at
plan["retake"] = retake
if retake:
    print("NEEDS A NEW TAKE (kept less than %.1f s):" % MIN_KEEP)
    for x in retake: print("  %s  kept %.1f s  (%s)" % (x["clip"], x["kept"], x["why"]))
json.dump(plan, open(os.path.join(folder, "plan.json"), "w"), indent=1)
print("wrote", os.path.join(folder, "plan.json"))
