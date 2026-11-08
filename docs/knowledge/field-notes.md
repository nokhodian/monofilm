# Field notes

What we learned by running Monofilm ourselves (2026-11-05 to 2026-11-09), with the MiniMax H3 model on a local GPU and Meta's Muse Image and Muse Spark in the studio. These are our own observations, not sources: nothing here is cited as evidence in `practices/`. Each note says what happened, the cause we found, what we changed and where it lives. Add new notes at the end, newest last.

| # | What happened | Cause | What we did |
|---|---|---|---|
| 1 | A cartoon penguin came out as a photographed man holding a toy; every later picture and clip followed it | The face prompt said "portrait photograph of one person" for every character | Prompts follow the film's medium and the kind of being (`mediumOf`, `beingOf`, `src/wizard.js` makeFace) |
| 2 | A bunny changed clothes inside one clip (pink scarf, blue overalls, pink scarf) | The words described blue overalls while the start picture showed something else; the generator flipped between them | With a start picture the words never describe a character again (`composeClip`, `film.pictures`) |
| 3 | Bubbles, a plant, a human hand and a bottle appeared in clips | The prompt named them: a generic physics line mentioned bubbles, water and hands, and the scene listed props that were not in view yet | Name only what is in view (`propsInClip`); never name what is hidden or not there yet; the physics line names no substance |
| 4 | One seed became several, or vanished | The plan had a tiny seed picked up and dropped on screen, which no generator shows | A tiny object is never handled on screen: it lies in place and the large action around it is shown |
| 5 | A plant appeared in the soil before the seed was planted | Pictures were drawn from action sentences, so an end picture could show the middle of the action | Scenes are written as states (one frozen picture per clip boundary) with fixed prop looks and counts; a continuity review corrects skipped stages |
| 6 | The scene reshaped between clips | Each end picture was drawn separately from the start picture | An end picture is drawn from the picture before it |
| 7 | Roll camera stopped with "model not found" once, and with a content-filter refusal on an innocent prompt | Meta's API is flaky for a moment; the "never show" list contained the word "guns" | Retry a one-off "model not found"; keep weapon words out of image prompts; retry a refusal without the clause, then with shortened sentences |
| 8 | A film got two sets of scenes | The Roll camera lease (150 s) was shorter than the scene draft (two model calls), so a second runner started | The lease outlasts the longest step; the draft checks for existing scenes inside every try |
| 9 | Retries stopped after one try | The attempt counter included takes made before the scene was changed | Takes older than the scene's last change do not count |
| 10 | A picture judge said "yes" to a bear drawn for a snail | A judge that is told what to expect agrees; fine details and kinds of animals are weak points | The kind of every named character is compared in code, after a blind description; a failing picture gets a second look |
| 11 | Scene pictures ignored the character references for many rounds | A comment I added on the same line as a loop swallowed the loop (a `//` comment followed by code on one line) | Fixed; a test asserts the reference reaches the image model. Never put code after a `//` comment |
| 12 | Snail and beetle were drawn as two bears | The names Moss and Pip are common words and pull an image model toward moss and a seed | Image prompts never use a character's name; they use its kind and look (`expandNames`, `plainDesc`) |
| 13 | Pictures came out portrait in a landscape film | The image edit endpoint takes its size from the first reference picture, and that was a portrait face | An empty frame of the film's shape goes first (`blankFrame`) |
| 14 | A clip review marked good clips as failed | A checklist question was phrased so that "no" was the good answer, and the code read "no" as a fault | Every question is phrased so that "yes" is good |
| 15 | The generation script was lost when a scratch folder was cleaned | It lived only in a temporary folder and on the PC | The scripts live in `scripts/generators/minimax-h3-comfyui/` |
| 16 | A character was half its size in the last picture of a scene, and a hill reshaped between pictures | The image model ignores a size written in words, and the plan said "slow push-in" while the video generator held its camera still | Each scene has a size line per character (`sizes`); a static camera is the default; a generator that cannot take camera moves (`static_camera`, named in the film's format as `generator`) gets a static camera in every scene |
| 17 | A vision judge did not see a character change size | A judge is poor at proportions | SAM measures each character's box in the new and the previous picture; below 65% or above 150% of the previous size is a fault (`sizeProblem`). Ask SAM for a plain kind word ("snail"), not a long description: it found nothing for "very small grey-green clay snail" |
| 18 | A snail was drawn rearing up in the first picture and lying flat in the later ones | The first state did not name a posture | Every state names each character's posture |
| 19 | An empty place picture came out with little clay animals on it | A handmade clay look invites figurines | The place prompt asks for nothing living or figure-like |

## MiniMax H3 (local, 8-step turbo): what we saw

- Poured water is drawn as a flat blue disc or ring; the words "bubbles" make bubbles appear.
- Cuts and framing jumps appear when a prompt lists several shots; a "slow push-in" sometimes pushes in then jumps back wide.
- The clip often reaches its end picture early and then stands still for 1 to 4 seconds. The assembly script trims it.
- A clip of 6 to 8 seconds is the useful length; a second take is needed for about half the clips; walking is weak, gliding and turning are fine.
- Voices do not persist between clips; a silent clip still sometimes gets speech unless the prompt describes quiet room tone and closed mouths.

## Results, in order

| film | what it was | cuts (takes) | what was wrong |
|---|---|---|---|
| The Pattern at 3:07 (2 min, lighthouse) | first run | 10 of 30 | the prompt itself asked for cuts; closed bottle; frozen tails |
| Pip and the Blue Button v2 (40 s) | cartoon, wordless | 0 of 6 | characters right after the picture fix; no joins tested |
| Mimi and the Carrot Seed (2 min) | cartoon with joins | 3 of 24 | outfit and detail drift between clips; water drawn as a disc |
| Moss and Pip (36 s) | clay stop-motion, two characters | 0 of 16 | right characters and light story; a few physics slips (a snail tipping over), duplicate Moss in one take, frozen tails |

The Moss and Pip film was the first made after the fixes in notes 1 to 14. Its characters, place and light stayed right from the first picture to the last.

| film | what it was | cuts (takes) | average biggest jump between frames (best takes) | what was wrong |
|---|---|---|---|---|
| Moss and Pip v1 (36 s) | stop-motion, before sizes and static camera | 0 of 16 | 5.7 | framing changed inside clips, character sizes drifted between pictures |
| Moss and Pip v2 (35 s) | same story, with sizes, static camera, measured sizes | 0 of 15 | 2.5 | the generator does little of the slow motion it is asked for (a snail that barely glides), end holds of 1 to 4 seconds, one clip with a possible second snail |
