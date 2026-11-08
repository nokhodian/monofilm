---
model: luma-ray-2
maker: Luma AI
kind: video
updated: 2026-11-08
---
## Controls
- Models ray-2, ray-flash-2; resolutions 540p to 4k; 5 s example; loop flag; first and last frame via keyframes; extend forward or backward; interpolate between two generations. [pm-002]
- Camera motion in the prompt; supported strings from an API list. [pm-002]

## Prompt dialect
- Camera moves written in the prompt text, close variations of listed strings may work. [pm-002]

## Known weaknesses
- No prompt guide was opened in this pass; weaknesses unknown.

## Consistency tools
- Image keyframes (own CDN URL) at start and end; extend from a completed generation. [pm-002]

## Cost and limits
- Asynchronous with callbacks; retried up to 3 times on non-200. [pm-002]
