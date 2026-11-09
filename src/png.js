// A PNG reader and writer that needs no library and no canvas: a Worker has DecompressionStream and CompressionStream, and that is all PNG needs from the platform.
// Reads 8-bit grey, RGB and RGBA (non-interlaced, which is what Muse Image makes) into RGBA bytes; writes RGB (the studio never needs a transparent picture).
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u) => { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

export async function decodePng(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  if (SIG.some((b, i) => u[i] !== b)) throw new Error('not a PNG');
  let w = 0, h = 0, depth = 0, type = 0, interlace = 0; const idat = [];
  for (let p = 8; p + 8 <= u.length;) {
    const len = dv.getUint32(p), name = String.fromCharCode(...u.subarray(p + 4, p + 8)), body = u.subarray(p + 8, p + 8 + len);
    if (name === 'IHDR') { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); depth = u[p + 16]; type = u[p + 17]; interlace = u[p + 20]; } else if (name === 'IDAT') idat.push(body); else if (name === 'IEND') break;
    p += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 6: 4 }[type]; if (!ch || depth !== 8 || interlace) throw new Error(`PNG kind not supported (type ${type}, depth ${depth}, interlace ${interlace})`);
  const cat = new Uint8Array(idat.reduce((n, b) => n + b.length, 0)); let o = 0; for (const b of idat) { cat.set(b, o); o += b.length; }
  const raw = await pipe(cat, new DecompressionStream('deflate')), stride = w * ch, out = new Uint8Array(w * h * 4), prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0; let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) { const d = (y * w + x) * 4, s = x * ch; out[d] = cur[s]; out[d + 1] = cur[ch === 1 ? s : s + 1]; out[d + 2] = cur[ch === 1 ? s : s + 2]; out[d + 3] = ch === 4 ? cur[s + 3] : 255; }
    prev.set(cur);
  }
  return { w, h, data: out };
}

export async function encodePng({ w, h, data }) {
  const raw = new Uint8Array(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) { const r = y * (w * 3 + 1); raw[r] = 0; for (let x = 0; x < w; x++) { const s = (y * w + x) * 4, d = r + 1 + x * 3; raw[d] = data[s]; raw[d + 1] = data[s + 1]; raw[d + 2] = data[s + 2]; } }
  const z = await pipe(raw, new CompressionStream('deflate')), chunk = (name, body) => { const c = new Uint8Array(12 + body.length), dv = new DataView(c.buffer); dv.setUint32(0, body.length); for (let i = 0; i < 4; i++) c[4 + i] = name.charCodeAt(i); c.set(body, 8); dv.setUint32(8 + body.length, crc32(c.subarray(4, 8 + body.length))); return c; };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [Uint8Array.from(SIG), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))], out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
