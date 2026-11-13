"""Makes the narration of a production with a Persian neural voice (edge-tts) and gives it a heroic, trailer-like sound.
usage: MONOFILM_KEY=<key> EDGE_TTS=<path to the edge-tts program> python3 scripts/narration-edge.py <production id> <out folder> [voice]
For every scene it takes the lines spoken by the narrator, takes the vowel marks off (a neural voice reads the plain text better, and a spelling that makes it say the name right is applied: سهراب becomes سوهراب),
says each sentence with its own speed, pitch and loudness (the first slower and lower, a sentence ending in ! louder and slower, the last one slower), joins them with short pauses and runs the sound through
bass, compression and a light echo. Writes <out>/scene-<n>.mp3 and <out>/narration.json ([{scene, file, seconds, text}]). Needs ffmpeg. The voice is a standard voice with no emotion of its own: a real heroic
performance needs an acting voice (a voice library such as ElevenLabs) or a person."""
import json, os, re, subprocess, sys, tempfile, urllib.request

PID, OUT = sys.argv[1], sys.argv[2]; VOICE = sys.argv[3] if len(sys.argv) > 3 else "fa-IR-FaridNeural"
KEY, HOST, EDGE = os.environ["MONOFILM_KEY"], os.environ.get("MONOFILM_HOST", "monofilm.monoes.me"), os.environ.get("EDGE_TTS", "edge-tts")
os.makedirs(OUT, exist_ok=True)
FIX = [("سهراب", "سوهراب")]
MARKS = re.compile("[ً-ْٰ]")


def get(path):
    req = urllib.request.Request(f"https://{HOST}/api/p/{PID}{path}", headers={"authorization": "Bearer " + KEY, "x-mf": "1", "user-agent": "narration"})
    return json.load(urllib.request.urlopen(req, timeout=120))


def plain(text):
    t = MARKS.sub("", text)
    for a, b in FIX: t = t.replace(a, b)
    return re.sub(r"\s+", " ", t).strip()


def sentences(text):
    parts = [p.strip() for p in re.split(r"(?<=[.!؟?؛])\s+", text) if p.strip()]
    return parts or [text]


def say(text, i, n, path):
    rate, pitch, vol = -4, -6, 15
    if i == 0: rate, pitch = -8, -8
    if i == n - 1 and n > 1: rate, pitch = -6, -8
    if text.rstrip().endswith("!") or len(text) < 14: rate, vol = -12, 30
    elif text.endswith("؛") or text.endswith(";"): rate, vol = rate + 6, 20
    subprocess.run([EDGE, "--voice", VOICE, f"--rate={rate:+d}%", f"--pitch={pitch:+d}Hz", f"--volume=+{vol}%", "--text", text, "--write-media", path], check=True, capture_output=True)


scenes = sorted(get("/artifacts?kind=scene&data=1"), key=lambda s: s["data"]["n"]); result = []
for s in scenes:
    lines = [l["text"] for l in s["data"].get("transcript", []) if re.match(r"(?i)narrator|راوی", str(l.get("who", ""))) and l.get("text")]
    if not lines: continue
    text = plain(" ".join(lines)); sents = sentences(text)
    with tempfile.TemporaryDirectory() as tmp:
        files = []
        for i, t in enumerate(sents):
            f = os.path.join(tmp, f"s{i}.mp3"); say(t, i, len(sents), f); files.append(f)
        cmd = ["ffmpeg", "-v", "error", "-y"] + sum([["-i", f] for f in files], [])
        pads = "".join(f"[{i}]apad=pad_dur={0.35 if sents[i].endswith('!') else 0.3}[p{i}];" for i in range(len(files)))
        chain = "highpass=f=70,equalizer=f=140:t=q:w=1:g=4,equalizer=f=3500:t=q:w=1.2:g=2,acompressor=threshold=-20dB:ratio=4:attack=5:release=80:makeup=4,aecho=0.85:0.6:70|140:0.22|0.12,loudnorm=I=-16:TP=-1.5"
        out = os.path.join(OUT, f"scene-{s['data']['n']}.mp3")
        subprocess.run(cmd + ["-filter_complex", pads + "".join(f"[p{i}]" for i in range(len(files))) + f"concat=n={len(files)}:v=0:a=1,{chain}", "-ar", "48000", out], check=True)
    secs = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).strip())
    result.append({"scene": s["data"]["n"], "ref": s["ref"], "file": out, "seconds": round(secs, 2), "text": text}); print(f"scene {s['data']['n']}: {secs:.1f} s, {len(sents)} sentences")
json.dump(result, open(os.path.join(OUT, "narration.json"), "w"), ensure_ascii=False, indent=1)
