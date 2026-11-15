"""Makes ONE clip with MiniMax H3 on the local ComfyUI from a start picture and a prompt, with no studio involved: to see how a look will move before a film is made in it.
usage (on the PC): python test_clip.py <start picture> <prompt file> <seconds> <seed> <out mp4> [end picture]
The ComfyUI helpers come from ../momo like in gen_clips.py. 1024 x 576, like the film clips."""
import os, shutil, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "momo"))
from lib import post, upload, wait, out_files, h3_graph  # ComfyUI helpers (read-only import)

pic, prompt_file, seconds, seed, out = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
end = sys.argv[6] if len(sys.argv) > 6 else None
W, H = 1024, 576
g = h3_graph(open(prompt_file, encoding="utf-8").read().strip(), "x", W, H, seconds, seed, prefix="testclip/" + os.path.basename(out)[:-4])
g["20"]["inputs"]["image"] = upload(pic)
if end:
    g["30"] = {"class_type": "LoadImage", "inputs": {"image": upload(end)}}
    g["31"] = {"class_type": "ImageScale", "inputs": {"image": ["30", 0], "upscale_method": "lanczos", "width": W, "height": H, "crop": "center"}}
    g["6"]["inputs"]["last_frame"] = ["31", 0]
result, t = wait(post("/prompt", {"prompt": g})["prompt_id"], poll=5)
shutil.copy(out_files(result)[0], out); print("made", out, "in", round(t), "s")
