"""Draws the start and end pictures of some scenes again (after you changed their states or the studio's picture rules) and puts each new picture in use.
usage: MONOFILM_KEY=... python3 scripts/redraw-frames.py <production id> <scene slug,scene slug,...>
Each picture is made from the one before it, so scenes are done in the order given. Costs one credit per picture, more if the checker asks for a redraw."""
import json, os, sys, urllib.request

KEY, HOST = os.environ["MONOFILM_KEY"], os.environ.get("MONOFILM_HOST", "monofilm.monoes.me")
ID, SCENES = sys.argv[1], sys.argv[2].split(",")


def call(path, body=None):
    req = urllib.request.Request(f"https://{HOST}/api/p/{ID}{path}", data=json.dumps(body).encode() if body is not None else None,
                                 headers={"authorization": "Bearer " + KEY, "x-mf": "1", "content-type": "application/json", "user-agent": "redraw-frames"}, method="POST" if body is not None else "GET")
    try:
        return json.load(urllib.request.urlopen(req, timeout=600))
    except urllib.error.HTTPError as e:
        return {"error": e.read().decode()[:300]}


for slug in SCENES:
    clips = len(call(f"/artifacts/scene:{slug}")["data"]["clips"])
    for clip, which in [(1, "start")] + [(k, "end") for k in range(1, clips + 1)]:
        r = call("/wizard/frame", {"scene": slug, "clip": clip, "which": which}); c = r.get("check", {})
        print(slug, clip, which, "ok" if c.get("ok") else "NOT OK", c.get("kind") or "", (c.get("problem") or c.get("seen") or r.get("error") or "")[:140], "redrew" if c.get("redrew") else "", flush=True)
        if r.get("asset"):
            ref = f"keyframe:{slug}-c{clip}-{which}"; a = call("/artifacts/" + ref); data = a["data"]; data["chosen"] = r["asset"]["id"]
            call("/propose", {"ref": ref, "data": data, "parent": a.get("parent") or None, "deps": [x for x in (a.get("deps") or []) if x != a.get("parent")], "auto_approve": True, "rationale": "Redrawn and put in use", "base_version": a["version"]})
