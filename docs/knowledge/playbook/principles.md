# Principles for directing an AI-generated film

Distilled from the practices in this knowledge base. Every line points at practice ids (`xxx-p-NNN`); the practice says which sources back it and how strong the evidence is. Where the evidence is only vendor blogs or single users, the practice says so. Update this file when a practice changes; the test suite fails if an id here does not exist.

## 1. Plan before you generate

- Write the film as one sentence, pick the ending first and write backward, and plan every shot before generating anything. [sty-p-001] [sty-p-007] [sty-p-011] Build the story top-down in layers: logline, beats, scenes, clips. [sty-p-015]
- One idea, one action, one camera move per clip, 4 to 8 seconds. [sty-p-002] [cin-p-001] [cin-p-008] [pm-p-005] [pm-p-006]
- Under a minute, one reversal at most; 3 to 8 beats. [sty-p-006] [sty-p-004]
- Plan the joins, not only the clips: transitions are the weakest part of multi-clip films. [sty-p-014]
- Show feeling as something visible, never as a label. [pm-p-016] [sty-p-008]

## 2. The picture is the anchor; the words describe change

- One approved picture per character, plain and neutral, reused in every clip. [chr-p-001] [chr-p-002]
- When a picture carries the character, do not describe the character in words again; words and picture blend and the face shifts. [chr-p-004] [wf-p-014] With no picture, repeat one fixed identity line word for word. [chr-p-005] These two disagree on purpose: the first is for generators that take a picture.
- With a start picture, prompt only the change. [pm-p-001] [cin-p-006] Do not describe what is already in the image. [phy-p-014]
- Judge a finished clip against the start and end pictures, not against the written description. [chr-p-008]
- Give each character a few strong traits and a silhouette; prefer colour-coded identity to clothing. [ani-p-011] [ani-p-012] Make characters in one scene visibly different. [chr-p-014]
- Check every new picture against the reference, garment by garment. [chr-p-007] Name the medium in every prompt, and never leave it unchecked: a photograph in a cartoon is the commonest failure. [ani-p-001] [ani-p-016]

## 3. Continuity is state, not just style

- Track the state of every changing or counted object and name only the objects in view at a boundary. [scn-p-019] [scn-p-020] Split a transformation across clips with visible stages. [sty-p-017]
- Start the next clip from the previous clip's approved end picture; draw an end picture from the picture before it; change one thing between start and end. [scn-p-001] [scn-p-002] [scn-p-004] [scn-p-011]
- Use a cut for a scene change and a hand-off only for the same shot. [scn-p-021] Keep light, time of day and weather in one fixed phrase per scene. [scn-p-016] [cin-p-014]
- Chain drift is error accumulation: anchor a long chain on the first approved picture and cap how long it runs without a fresh keyframe. [res-p-002] [res-p-003] [scn-p-026]
- Open a scene wide, keep screen direction, and cut on motion. [cin-p-017] [cin-p-018] [cin-p-021]

## 4. Write for what the generator can really do

- Say what must stay true in positive words; do not name what must be absent, because naming it makes it appear. [phy-p-002] [phy-p-004] A silent clip is described with concrete sound and closed mouths, not a list of bans. [aud-p-004]
- Fit the words to the model: its length range, its negative-prompt style, its reference cap, its camera words. [pm-p-014] [pm-p-003] [pm-p-011] [pm-p-013] Keep a capability profile per generator, and expect generators to be retired. [pm-p-004] [pm-p-022]
- Avoid what generators draw badly as the point of a shot: liquids, fire and smoke, tiny objects handled on screen, hands in close-up, readable text, mirrors. [phy-p-006] [phy-p-007] [phy-p-008] [phy-p-018] [phy-p-019] Cut away from what the model cannot show. [phy-p-024]
- Every action must be possible at that moment: a container is opened before anyone blows through it. [phy-p-013] Describe weight and consequence, not only the action. [phy-p-012]
- Handmade looks: name the exact material, ask for handmade traces and stepped motion in words. [ani-p-002] [ani-p-003] [ani-p-006]

## 5. Review is part of the pipeline

- Look at several frames in time order, with the approved pictures as ground truth. [qa-p-005] [qa-p-002]
- Do not trust a vision judge on counts and tiny details; look a second time before failing something, and hand the doubtful cases to the person. [qa-p-003] [qa-p-004] [qa-p-015]
- Feed the critic's concrete advice into the next try, change one thing per retry, cap the retries. [qa-p-008] [pm-p-017] [qa-p-007] A critic needs a signal other than the generator's own opinion. [qa-p-009]
- When a filter blocks a harmless prompt, change the prompt, not the dice. [qa-p-016]
- Make several candidates and let a verifier pick; judge candidates against each other where you can. [qa-p-010] [wf-p-007]

## 6. Spend where it counts

- Pictures first, video last; lock references before any shot; human checkpoints before each spend. [wf-p-001] [wf-p-002] [wf-p-015]
- Budget for overgeneration, by shot type: reported discard rates run from about 3 attempts per usable shot to about 300. [wf-p-005] [wf-p-006] [wf-p-008]
- Draft cheap, finish expensive; upscale only the shots that make the cut, then one shared grade. [wf-p-009] [wf-p-020] [wf-p-019]
- Trim a frozen tail instead of keeping it; trim the first frames of a continued clip. [res-p-018] [wf-p-017] [scn-p-014] [cin-p-022]

## 7. Audio and rights

- Do not trust a native voice to persist across clips: plan one voice pass per character. [aud-p-010] [aud-p-011] At most two speakers per clip, short lines. [aud-p-012] [sty-p-013]
- Join clips with a short audio crossfade at one sample rate; duck music under speech. [aud-p-020] [aud-p-019]
- Disclose realistic synthetic content, keep provenance marks, set the made-for-kids flag when it applies, and keep a record of human choices. [qa-p-022] [qa-p-023] [qa-p-021] [qa-p-024] Clone a voice only with the owner's consent. [aud-p-025]

## What Monofilm does not do yet (the strongest open ideas)

`npm run kb:build` writes the current list to `docs/knowledge/index.json` under `todo` (practices with status `none` and at least multi-source evidence). The big ones built after this research: reference views per character [chr-p-003], a voice plan per scene [aud-p-010], a pairwise take judge [qa-p-010], risk-based attempt budgets [wf-p-006], an assembly script [cin-p-022], and a publishing checklist [qa-p-021]. Still open at the time of writing: a voice pass generated inside the studio [aud-p-010], camera vocabularies for generators other than Hailuo [pm-p-013], draft-then-final model tiers [wf-p-009], an upscale and shared-grade step [wf-p-019], a score with ducking [aud-p-019], and reversal counting [sty-p-006].

## Sizes and camera: research round of 2026-11-09

- Size is not obeyed from words or references; set it by construction and measure it. [chr-p-024] [chr-p-025] Hold each picture to the scene's first picture as well as the previous one. [scn-p-028] Match first and last frames in size before a first/last-frame call. [scn-p-029]
- Fix a wrong size by a local rescale and re-check before a full redraw. [res-p-024] Layout, box or depth conditioning is the real size control where the image model offers it. [res-p-025]
- The only measured tolerance found is about plus or minus 20% for plausible relative size; our tighter bands are our own choice. [qa-p-025] Measure with a short-noun-phrase segmenter per frame and distrust a single propagated mask. [qa-p-026]
- Lock the camera with a positive phrase plus invariants; where a generator reshapes on camera moves, keep it static and move the camera in post. [cin-p-030] [cin-p-031] Use a provider's fixed-camera flag too. [pm-p-025]
- Image-to-video under-moves; write a change with a target and distance. [cin-p-032] Seed joins from before the final slowdown. [wf-p-025]
