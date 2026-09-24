#!/usr/bin/env node
/* Captures phone-sized screenshots of the app for the README, using headless Chrome over the
 * DevTools protocol (no dependencies). Needs Node 22+ and Chrome or Edge, and a running server:
 *   python tools/serve.py            (in another terminal)
 *   node tools/screenshots.js [http://localhost:8123/]
 * Writes docs/screenshot-library.png, -song.png, -song-dark.png and -editor.png. */
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const target = (process.argv[2] || 'http://localhost:8123/').replace(/#.*$/, '');
const outDir = path.join(root, 'docs');
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const candidates = [process.env.CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const chrome = candidates.find((c) => fs.existsSync(c));
if (!chrome) { console.error('Chrome not found; set CHROME'); process.exit(2); }
if (typeof WebSocket === 'undefined') { console.error('Needs Node 22+ for WebSocket'); process.exit(2); }

const PORT = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'songsheets-shots-'));
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
let seq = 0;
const pending = new Map();

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
async function waitFor(expr, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await evaluate(expr)) return; await sleep(100); }
  throw new Error('Timed out waiting for: ' + expr);
}
async function shot(name) {
  await evaluate('document.fonts ? document.fonts.ready.then(() => 1) : 1');
  await sleep(400);
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(outDir, 'screenshot-' + name + '.png');
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('wrote', path.relative(root, file));
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
    }
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', PHONE);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  // seed a library: the example songs, no backup reminder, no install hint
  await send('Page.navigate', { url: target + '#/library' });
  await waitFor('!!(window.SongSheets && SongSheets.app)');
  await evaluate(`(() => {
    const A = SongSheets.app.actions;
    A.updateSettings({ theme: 'auto', fontScale: 1, showChords: true, lastBackupAt: new Date().toISOString(), installHintDismissed: true });
    A.loadExamples();
    SongSheets.app.saveNow();
    return 1;
  })()`);
  await send('Page.reload');
  await sleep(300);
  await waitFor("document.querySelectorAll('.song-row').length >= 3");
  await evaluate("document.querySelectorAll('.toast').forEach(t => t.remove()), document.activeElement && document.activeElement.blur(), 1");
  await shot('library');

  const id = await evaluate("Object.values(SongSheets.app.store.get().songs).find(s => s.title === 'Morning Light').id");
  await evaluate('location.hash = ' + JSON.stringify('#/song/' + id) + ', 1');
  await waitFor("!!document.querySelector('.sheet-column .chord-word')");
  await evaluate("window.scrollTo(0, 0), document.querySelectorAll('.toast').forEach(t => t.remove()), 1");
  await shot('song');

  // the same song with the phone in dark mode ("Match my device" theme)
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await waitFor("getComputedStyle(document.body).backgroundColor === 'rgb(0, 0, 0)'");
  await shot('song-dark');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await waitFor("getComputedStyle(document.body).backgroundColor === 'rgb(255, 255, 255)'");

  const ag = await evaluate("Object.values(SongSheets.app.store.get().songs).find(s => s.title === 'Amazing Grace').id");
  await evaluate('location.hash = ' + JSON.stringify('#/edit/' + ag) + ', 1');
  await waitFor("!!document.querySelector('.lyrics-input')");
  await evaluate(`(() => {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const ta = document.querySelector('.lyrics-input');
    ta.blur();
    ta.scrollTop = 0;
    window.scrollTo(0, 0);
    return 1;
  })()`);
  await shot('editor');
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  try { ws && ws.close(); } catch (e) { /* ignore */ }
  proc.kill();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Chrome may still hold files */ }
});
