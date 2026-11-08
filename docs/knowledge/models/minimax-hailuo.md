---
model: minimax-hailuo
maker: MiniMax
kind: video
updated: 2026-11-08
---
## Controls
- Hailuo 02: text, image, later start/end frame; 768p at 6 or 10 s, 1080p at 6 s. [pm-011]
- Hailuo 2.3: prompts capped at 2000 chars; Fast variants are image-to-video only; input under 20MB, ratio 2:5 to 5:2. [pm-012]
- Newer MiniMax H3 is the current flagship per one source (Monofilm uses it locally). [pm-011]

## Prompt dialect
- Camera first, then subject, one action, setting and light. [pm-012]
- 15 bracketed camera commands; one bracket = simultaneous (max three), separate brackets = sequence. [pm-012]
- Optimizer on by default; turn off for exact prompts. [pm-012]

## Known weaknesses
- Stacking emotions or stunts; vague mood words. [pm-012]
- Monofilm's own notes for H3: no negative input, cuts on multi-shot prompts, weak natural walking, drew poured water as a flat disc (repo notes, unverified here).

## Consistency tools
- Start and end frame (02); image-to-video with change-only prompt. [pm-011] [pm-012]

## Cost and limits
- Fast tier for tests, Pro for finals. [pm-012]
