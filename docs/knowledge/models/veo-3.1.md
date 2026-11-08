---
model: veo-3.1
maker: Google
kind: video
updated: 2026-11-08
---
## Controls
- Text, image, first and last frame, up to three reference images ('ingredients'); 4, 6 or 8 s per call at 1080p in 16:9 or 9:16; native audio. [pm-017]
- Negative prompt is a separate field. [phy-023]
- Status: the Veo 3.1 preview models in the Gemini API were shut down on 22 Oct 2026; Google points to Gemini Omni Flash (3-15 s, text/image/video input, up to 6 reference images, native audio). [pm-001]

## Prompt dialect
- Parts: subject, action, scene, camera angle and movement, lens, lighting/mood/style, pacing; all optional. [phy-023]
- Audio in separate sentences from visuals. [phy-023]
- Timestamp segments such as [00:00-00:02] direct several shots in one 8 s call; repeat subject and scene details in each. [pm-017]
- Negative field: nouns, not 'no X'. [phy-023]

## Known weaknesses
- Advanced angles and lenses are not all supported. [phy-023]
- Last frame is only a guide, looser on 8 s than 4 s. [pm-017]
- Extreme close-up faces can show artifacts. [pm-017]
- Horror and policy-edge content is filtered. [phy-023]

## Consistency tools
- Reference images (about three) keep a character or setting; one character plus one setting is usually enough. [pm-017]

## Cost and limits
- Per-second pricing, chaining 8 s clips for longer films, SynthID watermark (single third-party source). [pm-017]
