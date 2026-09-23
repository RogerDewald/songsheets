#!/usr/bin/env node
/* End-to-end smoke test in headless Chrome, driven over the DevTools protocol (no dependencies).
 * Needs Node 22+ (global WebSocket) and Chrome or Edge.
 *   node tools/smoke.js                 -> opens index.html from file://
 *   node tools/smoke.js http://localhost:8123/
 * Set CHROME=path\to\chrome.exe to choose the browser. */
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const target = process.argv[2] || 'file:///' + path.join(root, 'index.html').replace(/\\/g, '/');
const candidates = [process.env.CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const chrome = candidates.find((c) => fs.existsSync(c));
if (!chrome) { console.error('Chrome not found; set CHROME'); process.exit(2); }
if (typeof WebSocket === 'undefined') { console.error('Needs Node 22+ for WebSocket'); process.exit(2); }

const PORT = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'songsheets-smoke-'));
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
let seq = 0;
const pending = new Map();
const consoleErrors = [];

function send(method, params) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params: params || {} }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('Page error: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result.value;
}
async function waitFor(expr, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await evaluate(expr)) return true; await sleep(100); }
  throw new Error('Timed out waiting for: ' + expr);
}
let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

(async () => {
  let list;
  for (let i = 0; i < 50; i++) {
    try { list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json(); if (list.length) break; } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  const page = list.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails.exception ? msg.params.exceptionDetails.exception.description : msg.params.exceptionDetails.text);
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleErrors.push(msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
    }
  });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: target + '#/library' });
  await waitFor('!!(window.SongSheets && SongSheets.app)');

  check('empty library shows the welcome', await evaluate("!!document.querySelector('.empty-state')"));
  const exportsLoaded = await evaluate("!!(SongSheets.export && SongSheets.export.exportMenu && SongSheets.export.backup)");
  check('export modules loaded', exportsLoaded);

  await evaluate("SongSheets.app.actions.loadExamples(), 1");
  await waitFor("document.querySelectorAll('.song-row').length === 3");
  check('three example songs listed', true);

  const id = await evaluate("Object.values(SongSheets.app.store.get().songs).find(s => s.title === 'Amazing Grace').id");
  await evaluate("location.hash = '#/song/' + " + JSON.stringify(id) + ", 1");
  await waitFor("!!document.querySelector('.sheet-column .chord-word')");
  // the chord for "A[G]mazing" must start where the "m" starts, and sit above the text
  const geo = await evaluate(`(() => {
    const cw = document.querySelector('.sheet-column .chord-word');
    const chord = cw.querySelector('.chord');
    const range = document.createRange();
    let text = chord.nextSibling; while (text && text.nodeType !== 3) text = text.firstChild || text.nextSibling;
    range.setStart(text, 0); range.setEnd(text, 1);
    const letter = range.getBoundingClientRect();
    const c = chord.getBoundingClientRect();
    return { dx: Math.abs(c.left - letter.left), above: c.bottom <= letter.top + 2, label: getComputedStyle(chord, '::after').content, text: text.textContent };
  })()`);
  check('chord starts at its syllable', geo.dx < 1.5, 'dx=' + geo.dx.toFixed(2) + ' over "' + geo.text + '"');
  check('chord sits above the lyric', geo.above);
  check('chord label drawn by CSS', geo.label === '"G"', geo.label);

  await evaluate("document.querySelector('button[aria-label=\"Transpose up (+)\"]').click(), 1");
  await waitFor("document.querySelector('.sheet-column .chord').getAttribute('data-uncopyable-text') === 'Ab'");
  check('transpose up: G -> Ab', true);

  // persistence across a reload
  await evaluate("SongSheets.app.saveNow(), 1");
  await send('Page.reload');
  await sleep(300);
  await waitFor('!!(window.SongSheets && SongSheets.app)');
  await waitFor("!!document.querySelector('.sheet-column .chord')");
  const after = await evaluate("({ songs: Object.keys(SongSheets.app.store.get().songs).length, chord: document.querySelector('.sheet-column .chord').getAttribute('data-uncopyable-text') })");
  check('songs survive a reload', after.songs === 3, after.songs);
  check('per-song key survives a reload', after.chord === 'Ab', after.chord);

  if (exportsLoaded) {
    const txt = await evaluate(`(() => {
      const st = SongSheets.app.store.get();
      const song = st.songs[${JSON.stringify(id)}];
      const sheet = SongSheets.sheetModel.buildSheet(song, {});
      return SongSheets.export.textExport.exportText([sheet], {});
    })()`);
    check('text export works in the page', typeof txt === 'string' && txt.indexOf('Amazing') >= 0 && /Ab/.test(txt));
    const pdf = await evaluate(`(async () => {
      const st = SongSheets.app.store.get();
      const sheets = [SongSheets.sheetModel.buildSheet(st.songs[${JSON.stringify(id)}], {})];
      const r = await SongSheets.export.pdfExport.exportPdf(sheets, { pageSize: 'A4' });
      const blob = r && r.blob ? r.blob : r;
      const head = new TextDecoder().decode(new Uint8Array(await blob.slice(0, 5).arrayBuffer()));
      return { head, size: blob.size, type: blob.type };
    })()`);
    check('PDF export builds a PDF from ' + (target.startsWith('file:') ? 'file://' : 'http'), pdf.head === '%PDF-', JSON.stringify(pdf));
    const docx = await evaluate(`(async () => {
      const st = SongSheets.app.store.get();
      const sheets = [SongSheets.sheetModel.buildSheet(st.songs[${JSON.stringify(id)}], {})];
      const r = await SongSheets.export.docxExport.exportDocx(sheets, { pageSize: 'A4' });
      const blob = r && r.blob ? r.blob : r;
      const head = new TextDecoder().decode(new Uint8Array(await blob.slice(0, 2).arrayBuffer()));
      return { head, size: blob.size };
    })()`);
    check('Word export builds a .docx', docx.head === 'PK', JSON.stringify(docx));
  }

  const relevant = consoleErrors.filter((e) => !/serviceworker|service worker|manifest/i.test(e));
  check('no page errors', relevant.length === 0, relevant.slice(0, 5).join(' | '));
  console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
})().catch((e) => { console.error(e); failures++; }).finally(async () => {
  try { ws && ws.close(); } catch (e) { /* ignore */ }
  proc.kill();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Chrome may still hold files */ }
  process.exit(failures ? 1 : 0);
});
