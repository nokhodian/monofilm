// Click any picture to see it large. Next and previous through the pictures on the page, click to zoom in on the detail, drag to look around, download, and
// (in the studio) "Give feedback on this", which opens the same margin card as clicking the picture's card used to. Standalone: no imports, so the landing page uses it too.
const MIN = 48; // smaller things are icons, not pictures
// A picture inside one of these keeps its own job: the margin card's pin picture, the drawing tool, the stage floor plan, links and buttons.
const OWN = '.zv, #apmodal, #mkmodal, .pinpad, [data-nozoom], .apwrap, button, a, label, select, summary, video, #wzs-plan';
const isPic = (el) => (el.tagName === 'IMG' || (el.tagName === 'CANVAS' && el.matches('[data-lay], #wzs-cv'))) && !el.closest(OWN) && el.offsetParent !== null && el.getBoundingClientRect().width >= MIN;
let V = null; // the open viewer: { items, i, root, back, zoomed }

function itemOf(el) {
  const card = el.closest('[data-ref]'), fig = el.closest('figure'), cap = el.dataset.cap || el.getAttribute('aria-label') || el.alt || (fig && fig.querySelector('figcaption') && fig.querySelector('figcaption').textContent) || (card && card.dataset.name) || '';
  return { el, src: el.tagName === 'CANVAS' ? '' : el.dataset.src || el.currentSrc || el.src, caption: String(cap).replace(/\s+/g, ' ').trim().slice(0, 160), card };
}
// Everything zoomable in the same part of the page, in reading order, so the arrows go through the faces or the candidates you were just looking at.
function collect(from) { const root = from.closest('[data-zoomgroup]') || from.closest('.wz') || from.closest('main') || document.body; return [...root.querySelectorAll('img, canvas[data-lay], canvas#wzs-cv')].filter(isPic); }

function open(items, i, back) {
  close(); V = { items, i: Math.max(0, Math.min(i, items.length - 1)), back: back || document.activeElement, zoomed: false };
  const d = document.createElement('div'); d.className = 'zv'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', 'Picture viewer');
  d.innerHTML = `<div class="zv-top"><span class="zv-count" aria-live="polite"></span><span class="zv-cap"></span><span class="zv-sp"></span><button type="button" class="zv-b" data-z="fb">Give feedback on this</button><button type="button" class="zv-b" data-z="draw">Draw on this</button><a class="zv-b" data-z="dl" download>Download</a><a class="zv-b" data-z="tab" target="_blank" rel="noopener">Open in a new tab</a><button type="button" class="zv-b" data-z="zoom">Zoom in</button><button type="button" class="zv-b zv-x" data-z="close" aria-label="Close">×</button></div>
  <button type="button" class="zv-nav zv-prev" data-z="prev" aria-label="Previous picture">‹</button><div class="zv-stage"><img class="zv-img" alt=""></div><button type="button" class="zv-nav zv-next" data-z="next" aria-label="Next picture">›</button>
  <div class="zv-hint">Click the picture to zoom in · drag to look around · ← → to browse · Esc to close</div>`;
  document.body.appendChild(d); document.body.classList.add('zv-open'); V.root = d; show(); d.querySelector('[data-z="close"]').focus();
}
// A browser will not open a data: address in a new tab, so a picture drawn on a canvas only offers Download.
function show() {
  const { root, items } = V, it = items[V.i], img = root.querySelector('.zv-img'), many = items.length > 1;
  const src = it.src || (it.el && it.el.toDataURL ? it.el.toDataURL('image/png') : ''); V.zoomed = false; root.classList.remove('zoomed'); img.removeAttribute('style'); img.src = src; img.alt = it.caption;
  root.querySelector('.zv-count').textContent = many ? `${V.i + 1} / ${items.length}` : ''; root.querySelector('.zv-cap').textContent = it.caption;
  root.querySelector('.zv-prev').hidden = root.querySelector('.zv-next').hidden = !many;
  const fb = root.querySelector('[data-z="fb"]'), dr = root.querySelector('[data-z="draw"]'), dl = root.querySelector('[data-z="dl"]'), tab = root.querySelector('[data-z="tab"]');
  fb.hidden = !it.card; dr.hidden = !it.ref; dl.href = tab.href = src; dl.hidden = false; tab.hidden = src.startsWith('data:'); dl.setAttribute('download', (it.caption || 'picture').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '.png');
  root.querySelector('[data-z="zoom"]').textContent = 'Zoom in';
}
function step(n) { if (!V || V.items.length < 2) return; V.i = (V.i + n + V.items.length) % V.items.length; show(); }
function zoom(on, at) {
  if (!V) return; const { root } = V, img = root.querySelector('.zv-img'), stage = root.querySelector('.zv-stage'); on = on === undefined ? !V.zoomed : on; if (on === V.zoomed) return;
  if (on) { const fit = img.getBoundingClientRect(), w = Math.max(img.naturalWidth || fit.width, fit.width * 2.2); img.style.width = `${w}px`; img.style.maxWidth = 'none'; img.style.maxHeight = 'none'; root.classList.add('zoomed');
    const fx = at ? (at.x - fit.left) / fit.width : 0.5, fy = at ? (at.y - fit.top) / fit.height : 0.5; stage.scrollLeft = Math.max(0, fx * w - stage.clientWidth / 2); stage.scrollTop = Math.max(0, fy * (w * fit.height / fit.width) - stage.clientHeight / 2); }
  else { img.removeAttribute('style'); root.classList.remove('zoomed'); }
  V.zoomed = on; root.querySelector('[data-z="zoom"]').textContent = on ? 'Fit to screen' : 'Zoom in';
}
function close() { if (!V) return; const { root, back } = V; V = null; root.remove(); document.body.classList.remove('zv-open'); if (back && back.focus && document.contains(back)) try { back.focus(); } catch { /* the thing is gone */ } }
const view = (items, i) => open(items.map((x) => (x.card !== undefined ? x : { ...x, card: null })), i);
document.addEventListener('mf-view', (e) => view(e.detail.items, e.detail.index || 0)); // lightbox(src, caption) in core.js sends this

// A plain click on a picture (not Shift/Ctrl/Cmd, which select several things) opens the viewer. Runs first, so the card around the picture does not also react.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button || e.shiftKey || e.ctrlKey || e.metaKey || !(e.target instanceof Element)) return;
  const el = e.target.closest('img, canvas'); if (!el || !isPic(el)) return;
  e.preventDefault(); e.stopPropagation(); const all = collect(el), i = all.indexOf(el); open(all.map(itemOf), Math.max(0, i), el);
}, true);

document.addEventListener('click', (e) => {
  if (!V || !(e.target instanceof Element)) return; const b = e.target.closest('[data-z]'), stage = e.target.closest('.zv-stage');
  if (b) { const z = b.dataset.z, it = V.items[V.i];
    if (z === 'close') close(); else if (z === 'prev') step(-1); else if (z === 'next') step(1); else if (z === 'zoom') zoom();
    else if (z === 'fb') { const card = it.card; close(); if (card) card.click(); } // the card's own click opens the margin card for this picture
    else if (z === 'draw') { const src = it.src; close(); document.dispatchEvent(new CustomEvent('mf-markup', { detail: { mode: 'sketch', base: src, ref: it.ref, context: it.context } })); }
    return; }
  if (e.target.closest('.zv-img')) { if (!drag.moved) zoom(undefined, { x: e.clientX, y: e.clientY }); } else if (stage || e.target.classList.contains('zv')) close();
});
// Drag to look around when zoomed in.
const drag = { on: false, x: 0, y: 0, moved: false };
document.addEventListener('pointerdown', (e) => { if (V && V.zoomed && e.target.closest('.zv-stage')) { const s = e.target.closest('.zv-stage'); Object.assign(drag, { on: true, x: e.clientX, y: e.clientY, sl: s.scrollLeft, st: s.scrollTop, moved: false, s }); } });
document.addEventListener('pointermove', (e) => { if (!drag.on) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; drag.s.scrollLeft = drag.sl - dx; drag.s.scrollTop = drag.st - dy; });
document.addEventListener('pointerup', () => { if (drag.on) { drag.on = false; setTimeout(() => { drag.moved = false; }, 0); } });
document.addEventListener('keydown', (e) => {
  if (!V) return; const k = e.key;
  if (k === 'Escape') { e.preventDefault(); close(); } else if (k === 'ArrowRight') { e.preventDefault(); step(1); } else if (k === 'ArrowLeft') { e.preventDefault(); step(-1); }
  else if (k === '+' || k === '=') zoom(true); else if (k === '-' || k === '0') zoom(false);
  else if (k === 'Tab') { const f = [...V.root.querySelectorAll('button:not([hidden]), a:not([hidden])')]; if (!f.length) return; const i = f.indexOf(document.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); }
});
export { view as openViewer };
