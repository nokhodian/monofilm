---
model: sora-2
maker: OpenAI
kind: video
updated: 2026-11-08
---
## Controls
- Text and an input_reference image as the first frame (must match size; JPEG/PNG/WebP); seconds 4, 8, 12, 16 or 20; 720p standard, sora-2-pro also 1080p. [cin-009] [pm-003]
- Reusable characters from a 2-4 s clip, up to two per video; extensions up to 20 s, six times, 120 s total. [pm-003]
- Status: the API and models were shut down on 24 Sep 2026. [pm-003]

## Prompt dialect
- Describe the shot like a storyboard: framing, action in beats, light, 3-5 colour anchors; one camera move and one action. [cin-009]
- Dialogue in its own block, short lines. [cin-009]
- Short prompts give freedom, long prompts give control but are followed less reliably. [cin-009]

## Known weaknesses
- Long dialogue syncs poorly; repeated runs vary. [cin-009]
- Rejects real people, face images, copyrighted characters/music. [pm-003]

## Consistency tools
- Character upload by name; name must be in the prompt; characters cannot combine with extensions. [pm-003]

## Cost and limits
- Shut down; keep for historical comparison only. [pm-003]
