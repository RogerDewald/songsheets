'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../js/core/sheetModel.js');
const D = require('../../js/export/download.js');
const E = require('../../js/export/exportMenu.js');
const TX = require('../../js/export/textExport.js');
const B = require('../../js/export/backup.js');

const record = { id: 'r1', title: 'Amazing: Grace', author: null, tags: [], lyrics: '1\n[G]Amazing [C]grace', notes: '', transpose: 0, accidentals: null, tuneIndex: 0, favourite: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', origin: null };
const sheets = () => [M.buildSheet(record)];

/** Replace the delivery functions for one test; the real ones need a browser. */
function stubDelivery(t) {
  const calls = [];
  const saved = { download: D.download, copyText: D.copyText, shareOrDownload: D.shareOrDownload };
  D.download = (data, filename, mime) => { calls.push({ how: 'download', data, filename, mime }); };
  D.copyText = (text) => { calls.push({ how: 'copy', data: text }); return Promise.resolve(true); };
  D.shareOrDownload = (data, filename, mime) => { calls.push({ how: 'share', data, filename, mime }); return Promise.resolve('cancelled'); };
  t.after(() => Object.assign(D, saved));
  return calls;
}

test('list: the eight exports in order, with hints per scope', () => {
  const song = E.list('song');
  assert.deepEqual(song.map((x) => x.id), ['print', 'pdf', 'docx', 'txt', 'cho', 'songbase', 'html', 'json']);
  song.forEach((x) => assert.ok(x.label && x.hint, x.id));
  assert.notEqual(E.list('set')[0].hint, song[0].hint);
  assert.deepEqual(song.map((x) => E.canCopy(x.id)), [false, false, false, true, true, true, true, true]);
  assert.equal(E.canShare(), false, 'no share sheet in Node');
});

test('download: the right bytes, file name and type', async (t) => {
  const calls = stubDelivery(t);
  const r = await E.run('txt', sheets(), { filenameBase: 'Amazing: Grace', action: 'download' });
  assert.deepEqual(r, { ok: true, message: 'Downloaded Amazing Grace.txt' });
  assert.equal(calls[0].filename, 'Amazing Grace.txt');
  assert.equal(calls[0].mime, 'text/plain;charset=utf-8');
  assert.equal(calls[0].data, TX.exportText(sheets()));
  const sb = await E.run('songbase', sheets(), {});
  assert.equal(sb.message, 'Downloaded Amazing Grace.songbase.txt', 'falls back to the song title');
});

test('copy for text formats only', async (t) => {
  const calls = stubDelivery(t);
  const r = await E.run('cho', sheets(), { action: 'copy' });
  assert.deepEqual(r, { ok: true, message: 'Copied ChordPro to the clipboard' });
  assert.match(calls[0].data, /^\{title: Amazing: Grace\}/);
  const pdf = await E.run('pdf', sheets(), { action: 'copy' });
  assert.equal(pdf.ok, false);
  assert.equal(calls.length, 1, 'nothing produced for a refused copy');
  D.copyText = () => Promise.resolve(false);
  const failed = await E.run('txt', sheets(), { action: 'copy' });
  assert.deepEqual(failed, { ok: false, message: 'Could not copy to the clipboard. Try Download instead.' });
});

test('share: a cancelled share sheet is not an error and says nothing', async (t) => {
  const calls = stubDelivery(t);
  const r = await E.run('html', sheets(), { action: 'share', songs: [record] });
  assert.deepEqual(r, { ok: true, message: '' });
  assert.equal(calls[0].how, 'share');
  assert.equal(calls[0].mime, 'text/html;charset=utf-8');
  assert.deepEqual(B.importAny(calls[0].data, calls[0].filename).songs, [record], 'the shared page re-imports');
});

test('json: the song records and the set, no settings', async (t) => {
  const calls = stubDelivery(t);
  const set = { id: 'set1', name: 'Sunday', items: [{ songId: 'r1', transpose: null, capo: null, tuneIndex: null }], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
  const r = await E.run('json', M.buildSetSheets(set, () => record), { songs: [record], set });
  assert.equal(r.message, 'Downloaded Sunday.json');
  const doc = JSON.parse(calls[0].data);
  assert.deepEqual([doc.format, doc.songs, doc.sets, doc.settings], ['songsheets-backup', [record], [set], null]);
  // a set that uses a song twice passes its record twice: it is written once
  await E.run('json', M.buildSetSheets(set, () => record), { songs: [record, record, null], set });
  assert.deepEqual(JSON.parse(calls[1].data).songs, [record]);
});

test('pdf and docx load their library and deliver a real file', async (t) => {
  const calls = stubDelivery(t);
  const toasts = [];
  const pdf = await E.run('pdf', [M.buildSheet({ title: 'Kyrie', lyrics: '[G]Κύριε ελέησον' })], { settings: { pageSize: 'Letter' }, toast: (m, o) => toasts.push([m, o.type]) });
  assert.deepEqual(pdf, { ok: true, message: 'Downloaded Kyrie.pdf' });
  const pdfBytes = Buffer.from(await calls[0].data.arrayBuffer());
  assert.equal(pdfBytes.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.match(pdfBytes.toString('latin1'), /\/MediaBox \[0 0 612/, 'Letter from settings');
  assert.equal(toasts.length, 1);
  assert.match(toasts[0][0], /^12 characters could not be drawn .* Print \/ Save as PDF/);
  assert.equal(toasts[0][1], 'warning');
  const docx = await E.run('docx', sheets(), {});
  assert.deepEqual(docx, { ok: true, message: 'Downloaded Amazing Grace.docx' });
  const docxBytes = Buffer.from(await calls[1].data.arrayBuffer());
  assert.equal(docxBytes.subarray(0, 2).toString('latin1'), 'PK');
});

test('run never rejects: bad input and failures come back as {ok:false, message}', async (t) => {
  stubDelivery(t);
  const quiet = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a);
  t.after(() => { console.error = quiet; });
  assert.deepEqual(await E.run('bogus', sheets(), {}), { ok: false, message: 'Unknown export "bogus".' });
  assert.deepEqual(await E.run('txt', [], {}), { ok: false, message: 'Nothing to export.' });
  assert.deepEqual(await E.run('txt', null), { ok: false, message: 'Nothing to export.' });
  assert.deepEqual(await E.run('txt', sheets(), { action: 'fax' }), { ok: false, message: 'Unknown export action "fax".' });
  D.download = () => { throw new Error('disk full'); };
  assert.deepEqual(await E.run('txt', sheets(), {}), { ok: false, message: 'Chord chart (text) export failed: disk full' });
  const print = await E.run('print', sheets(), {});
  assert.deepEqual(print, { ok: false, message: 'Print / Save as PDF export failed: Printing needs a browser window.' });
  assert.equal(logged.length, 2, 'failures are logged with their error');
});
