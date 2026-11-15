// Imports anchor sets made outside the studio into a production's cast.
// Usage: MONOFILM_KEY=<admin key> [MONOFILM_HOST=monofilm.monoes.me] node scripts/import-anchors.mjs <production id> <manifest.json>
// The manifest is a list of { id, name, role, desc, offscreen?, images: [{ kind: face|body|profile|sheet, file, label? }] }; file paths are relative to the manifest.
import { readFileSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';

const [pid, manifest] = process.argv.slice(2), KEY = process.env.MONOFILM_KEY, HOST = process.env.MONOFILM_HOST || 'monofilm.monoes.me';
if (!pid || !manifest || !KEY) { console.error('usage: MONOFILM_KEY=… node scripts/import-anchors.mjs <production id> <manifest.json>'); process.exit(2); }
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
for (const c of JSON.parse(readFileSync(manifest, 'utf8'))) {
  const images = c.images.map((im) => ({ kind: im.kind, label: im.label, mime: MIME[extname(im.file).toLowerCase()], data: readFileSync(resolve(dirname(manifest), im.file)).toString('base64') }));
  const r = await fetch(`https://${HOST}/api/p/${pid}/wizard/import`, { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: c.id, name: c.name, role: c.role, desc: c.desc, offscreen: c.offscreen, images }) });
  console.log(c.name, r.status, (await r.text()).slice(0, 200));
}
