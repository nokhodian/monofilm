---
model: wan-2.2
maker: Alibaba
kind: video
updated: 2026-11-08
---
## Controls
- T2V-A14B, I2V-A14B (480P/720P), TI2V-5B (720P 24 fps, 1280x704), S2V-14B, Animate-14B; open weights. [pm-004]
- Hosted: max 5 s, last-frame conditioning, 24 fps (16 for drafts). [pm-024]

## Prompt dialect
- Subject + scene + movement, plus aesthetic control and stylization. [pm-020]
- 80-120 words, shot order, avoid contradictions; negative prompt supported. [pm-024]
- Prompt extension recommended; I2V can run with empty prompt. [pm-004]

## Known weaknesses
- Overloaded or conflicting prompts hurt. [pm-024]
- A14B needs about 80GB VRAM; 5B fits 24GB. [pm-004]

## Consistency tools
- I2V keeps the image aspect ratio; S2V is audio-driven. [pm-004]

## Cost and limits
- Open weights; local compute. [pm-004]
