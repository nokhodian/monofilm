"""A contact sheet of a production's pictures, so a person can look at the whole film's keyframes at once.
usage: MONOFILM_KEY=... python3 scripts/film-sheet.py <production id> <out folder> [scene slug,scene slug,...]
Writes <out>/all.jpg: the cast faces and views first, then one row per scene (start, end of each clip). Needs ffmpeg. MONOFILM_HOST defaults to monofilm.monoes.me."""
import json, os, subprocess, sys, urllib.request

KEY, HOST = os.environ["MONOFILM_KEY"], os.environ.get("MONOFILM_HOST", "monofilm.monoes.me")
ID, OUT = sys.argv[1], sys.argv[2]
only = sys.argv[3].split(",") if len(sys.argv) > 3 else None


def get(path, raw=False):
    req = urllib.request.Request(f"https://{HOST}/api/p/{ID}{path}", headers={"authorization": "Bearer " + KEY, "x-mf": "1", "user-agent": "film-sheet"})
    data = urllib.request.urlopen(req, timeout=120).read()
    return data if raw else json.loads(data)


def row(files, name, height=240):
    cmd = ["ffmpeg", "-v", "error", "-y"] + sum([["-i", f] for f in files], [])
    cmd += ["-filter_complex", "".join(f"[{i}]scale=-1:{height}[s{i}];" for i in range(len(files))) + "".join(f"[s{i}]" for i in range(len(files))) + f"hstack={len(files)}", f"{OUT}/{name}.png"]
    subprocess.run(cmd, check=True)
    return f"{OUT}/{name}.png"


def save(asset, name):
    path = f"{OUT}/{name}.png"
    open(path, "wb").write(get("/media/" + asset["uri"].split("/")[-1], True))
    return path


os.makedirs(OUT, exist_ok=True)
rows, faces = [], []
for cast in get("/artifacts?kind=canon.cast&data=1"):
    d, assets = cast["data"], get("/artifacts/" + cast["ref"])["assets"]
    for pid in [d.get("anchor")] + [v["id"] for v in d.get("views", [])]:
        hit = [a for a in assets if a["id"] == pid]
        if hit:
            faces.append(save(hit[0], f"cast_{cast['ref'].split(':')[1]}_{pid}"))
if faces:
    rows.append(row(faces, "cast"))
scenes = sorted(get("/artifacts?kind=scene&data=1"), key=lambda s: (s["data"]["n"], s["created"]))
for s in scenes:
    slug = s["ref"].split(":")[1]
    if only and slug not in only:
        continue
    files = []
    for clip in range(1, len(s["data"]["clips"]) + 1):
        for which in (["start"] if clip == 1 else []) + ["end"]:
            frame = get(f"/artifacts/keyframe:{slug}-c{clip}-{which}")
            chosen = [a for a in frame["assets"] if a["id"] == frame["data"].get("chosen")] or frame["assets"][-1:]
            if chosen:
                files.append(save(chosen[0], f"{slug}_c{clip}-{which}"))
    if files:
        rows.append(row(files, slug))
if not rows:
    sys.exit("nothing to show")
widest = max(int(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "stream=width", "-of", "csv=p=0", r]).split()[0]) for r in rows)
subprocess.run(["ffmpeg", "-v", "error", "-y"] + sum([["-i", r] for r in rows], []) + ["-filter_complex", "".join(f"[{i}]pad={widest}:240[p{i}];" for i in range(len(rows))) + "".join(f"[p{i}]" for i in range(len(rows))) + f"vstack={len(rows)}", f"{OUT}/all.jpg"], check=True)
print(f"{OUT}/all.jpg")
