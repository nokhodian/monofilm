---
model: runway-gen-4.5
maker: Runway
kind: video
updated: 2026-11-08
---
## Controls
- First-frame image plus motion prompt (1-1000 chars), 2 to 10 s (5, 8, 10 in the API), 720p-class, 24-25 fps; text-to-video exists in 4.5. [cin-002] [pm-025] [cin-005]
- referenceImages with tags mentionable by at-syntax in the API. [pm-007]
- Gen-4 and Turbo need an image and cannot start from text. [cin-005]
- Aleph 2 edits footage up to 30 s with up to 5 keyframes; original Aleph uses 5 s. [pm-021] [pm-030]

## Prompt dialect
- Image-to-video: describe only change; subject motion and camera separately; explicit camera terms and pacing words; say what holds still. [cin-002]
- Negation can backfire; use positive phrasing. [pm-029]
- One shot per generation; change one variable at a time. [cin-005]

## Known weaknesses
- Motion that the frame cannot show, or off-frame elements, fail. [cin-002]
- Aleph (Gen-4) can deform characters on complex camera moves. [pm-021]
- Fixed seed is similar, not identical. [cin-005]

## Consistency tools
- First frame carries identity; the image should match the aspect ratio. [pm-025]
- Reference tags in the API. [pm-007]

## Cost and limits
- Credits per second: Gen-4 12, Turbo 5, Gen-4.5 12 (single third-party). [cin-005]
