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
json.dump(plan, open(os.path.join(folder, "plan.json"), "w"), indent=1)
print("wrote", os.path.join(folder, "plan.json"))
