// The wizard's steps. Each file calls registerStep(key, {...}) from w-core.js when it loads. To add a step, create its file and add ONE import line below
// (static imports only: a missing file would be a 404 in the console).
import './w-start.js'; // steps 1 Start and 2 Understand
import './w-revise.js'; // Fix it on the reading, people, places and the look
import './w-look.js';    // 3 Look
import './w-people.js';  // 4 People
import './w-places.js';  // 5 Places
import './w-scenes.js';  // 6 Scenes: routes to the sub-pages below (each registers itself with registerSub)
import './w-brief.js';   // scene list, Brief and Sound
import './w-stage.js';   // Stage and Pictures
import './w-pack.js';    // Pack
import './w-ship.js';    // 7 Ship
import './w-auto.js';    // Roll camera: the AI does every step and approves it
import './w-credits.js'; // Credits (not a step): #/w/credits
import './w-connect.js'; // Connect an AI agent (not a step): #/w/connect
import './w-accounts.js'; // Accounts (not a step, for the studio owner): #/w/accounts
