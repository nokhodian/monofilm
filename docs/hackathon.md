# Meta hackathon: demo script and submission checklist

Deadline: **Wed 4 Nov 2026, 9:00 PM Eastern** (about 03:00 on 5 Nov in Berlin). Track: Indie Developer. Problem statement: Build for Your World.

## 3 minute demo (record the live site, not slides)

The story is **Ask First**: on a deep-space station the AI that runs everything must ask a human before it acts. It is the same idea as the studio, which makes the story the best way to explain the product. Use the "Use a sample story" button on Start, or paste your own.

Record with a real `MODEL_API_KEY` set and at least 40 credits in a fresh production (about 9 faces, 3 places and 4 to 6 pictures, one credit each), so every Meta call is real. Do the slow clicks (faces, pictures) ahead of time and show the results; speak over the wait.

| Time | On screen | Say |
|---|---|---|
| 0:00 | Start. The sample story fills the page | "AI film tools are fast and unreliable. Monofilm makes the AI work like a crew, and a human decides every step. This story is about exactly that: an AI that asks before it acts." |
| 0:20 | Read my story, then Understand. Click a person: the margin card opens. Press Looks right | "Muse Spark reads the story and sets up people, places and beats. Everything it made is yours to review. Click anything, say what is off, keep what is good." |
| 0:45 | Look, then People: three faces for Ines. Pin the hair, Fix it, pick one | "Muse Image makes the faces. I pin what is wrong on the picture and it makes new ones. The face I choose becomes the anchor for every later picture." |
| 1:15 | Scenes list, then scene 1 Brief | "Each scene is a small production: transcript, a start and an end picture, and every detail a video generator needs. One home for each decision." |
| 1:35 | Stage: move ORCA's light ring and Ines, show Start and End | "I place people and the camera in 3D before anything is generated. This layout feeds the picture model." |
| 1:55 | Pictures: three candidates for start and end. Use one. Show the layout check | "Muse Image gets the layout and the anchor faces. SAM 3.1 checks the result against the plan and says what drifted." |
| 2:20 | Pack: the file list, the prompt, Download this scene | "Meta has no video model, so each scene leaves as a pack for any video generator: prompt, start and end pictures, stage controls, transcript, manifest." |
| 2:40 | Bring the clip back: drop a clip, show the first and last frame match | "I bring the generator's clip back. The studio checks it against my pictures. The AI proposed, I decided, and it is all in one history." |
| 2:55 | Ship: Download the film pack. Title card "Ask first" | "Built with Muse Spark, Muse Image, SAM 3.1 and Muse Voice Transcribe." |

Say plainly that Meta has no video model and that the clip you bring back was made elsewhere. Do not say the studio generated video.

## Before you submit

- [ ] Credits form submitted and credits claimed (each participant claims their own) by 4 Nov 9 PM ET
- [ ] Card added on the Billing page at dev.meta.ai
- [ ] API key created (API keys tab) and set: `npx wrangler secret put MODEL_API_KEY`
- [ ] Muse Image registered (Tools tab) and some credits granted (Credits tab)
- [ ] Repository is **public**, README renders, no secrets (`.dev.vars` is ignored; run a secret scan)
- [ ] Demo video is 3 minutes, shows only what was built during the hackathon, link opens while signed out
- [ ] Everyone who worked on it is listed on the submission page
- [ ] One submission, by the team Representative, at https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit
- [ ] Optional: post the demo on X and submit the post link (Most Viral prize)
