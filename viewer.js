// Oxford Talks deck viewer. Link: https://deck.oxfordtalks.io/d/<code>
// Opens a view through the deck API, renders the PDF with self-hosted pdf.js, watermarks every page with the
// recipient's name, and reports seconds read per page (only while the tab is visible).
import * as pdfjs from '/pdfjs/pdf.min.mjs';

const API = 'https://gdwzfpouocjvmpfghrzj.supabase.co/functions/v1/deck';
pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';

const $ = (id) => document.getElementById(id);
const code = (location.pathname.match(/^\/(?:d\/)?([A-Za-z0-9]{8,32})\/?$/) || [])[1];
const msg = (text, err) => { const m = $('msg'); m.textContent = text; m.className = 'msg' + (err ? ' err' : ''); };

// A random id kept in this browser, so the CRM can tell when a link is opened on a second device.
function visitorId() {
  try {
    let v = localStorage.getItem('ot-visitor');
    if (!v) { v = crypto.randomUUID(); localStorage.setItem('ot-visitor', v); }
    return v;
  } catch { return ''; }
}

let doc = null, page = 1, viewId = null, wm = '';
let acc = {}, tick = null;

function flushTime() {
  if (!tick) return;
  if (document.visibilityState === 'visible') acc[tick.page] = (acc[tick.page] || 0) + (Date.now() - tick.at) / 1000;
  tick = { page: tick.page, at: Date.now() };
}
function send(beacon) {
  flushTime();
  if (!viewId || !Object.keys(acc).length) return;
  const body = JSON.stringify({ code, viewId, pages: acc, pageCount: doc ? doc.numPages : undefined });
  acc = {};
  if (beacon && navigator.sendBeacon) navigator.sendBeacon(API, new Blob([body], { type: 'text/plain' }));
  else fetch(API, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
}

async function render() {
  if (!doc) return;
  const p = await doc.getPage(page);
  const stage = $('stage'); const box = stage.getBoundingClientRect();
  const base = p.getViewport({ scale: 1 });
  const pad = innerWidth < 640 ? 12 : 40;
  const scale = Math.min((box.width - pad * 2) / base.width, (box.height - pad * 2) / base.height);
  const dpr = Math.min(devicePixelRatio || 1, 3);
  const vp = p.getViewport({ scale: scale * dpr });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width; canvas.height = vp.height;
  canvas.style.width = vp.width / dpr + 'px'; canvas.style.height = vp.height / dpr + 'px';
  await p.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  const wrap = document.createElement('div'); wrap.className = 'page'; wrap.appendChild(canvas);
  if (wm) {
    const w = document.createElement('div'); w.className = 'wm';
    const s = document.createElement('span'); s.textContent = wm; w.appendChild(s);
    const sm = document.createElement('small'); sm.textContent = wm; w.appendChild(sm);
    wrap.appendChild(w);
  }
  const prev = document.createElement('div'); prev.className = 'hit prev'; prev.onclick = () => go(-1);
  const next = document.createElement('div'); next.className = 'hit next'; next.onclick = () => go(1);
  stage.replaceChildren(wrap, prev, next);
  $('count').textContent = `${page} / ${doc.numPages}`;
  $('bar').style.width = `${(page / doc.numPages) * 100}%`;
  $('prev').disabled = page <= 1; $('next').disabled = page >= doc.numPages;
  if (page < doc.numPages) doc.getPage(page + 1); // warm the next page
}

function go(d) {
  if (!doc) return;
  const n = Math.min(Math.max(1, page + d), doc.numPages);
  if (n === page) return;
  flushTime(); page = n; tick = { page, at: Date.now() }; render();
}

async function main() {
  if (!code) { msg('This link is not complete. Please check the address.', true); return; }
  try {
    const r = await fetch(`${API}?code=${encodeURIComponent(code)}&visitor=${encodeURIComponent(visitorId())}`);
    const open = await r.json();
    if (!r.ok) { msg(open.error || 'This link is not available.', true); return; }
    viewId = open.viewId;
    wm = open.watermark || (open.firstName ? `Prepared for ${open.firstName}` : '');
    $('title').innerHTML = '';
    $('title').append(document.createTextNode(open.deck || 'Oxford Talks'));
    if (open.firstName) { const s = document.createElement('span'); s.textContent = ` · prepared for ${open.firstName}`; $('title').append(s); }
    document.title = `${open.deck} · Oxford Talks`;
    doc = await pdfjs.getDocument({ url: open.pdf, disableAutoFetch: true, rangeChunkSize: 262144 }).promise;
    tick = { page, at: Date.now() };
    await render();
  } catch (e) {
    msg('This deck could not be opened. Please try again in a moment.', true);
  }
}

addEventListener('resize', () => render());
addEventListener('keydown', (e) => {
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'j'].includes(e.key)) { e.preventDefault(); go(1); }
  if (['ArrowLeft', 'ArrowUp', 'PageUp', 'k'].includes(e.key)) { e.preventDefault(); go(-1); }
  if ((e.metaKey || e.ctrlKey) && ['s', 'p'].includes(e.key.toLowerCase())) e.preventDefault(); // no save or print
});
let touchX = null;
$('stage').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
$('stage').addEventListener('touchend', (e) => { if (touchX === null) return; const dx = e.changedTouches[0].clientX - touchX; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); touchX = null; });
$('prev').onclick = () => go(-1); $('next').onclick = () => go(1);
setInterval(() => send(false), 10000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') send(true); else if (tick) tick.at = Date.now(); });
addEventListener('pagehide', () => send(true));
main();
