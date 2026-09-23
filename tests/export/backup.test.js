'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../../js/core/sheetModel.js');
const B = require('../../js/export/backup.js');
const H = require('../../js/export/htmlExport.js');
const CP = require('../../js/export/chordpro.js');

const fx = (f) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'export', f), 'utf8');
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

const song = (over) => Object.assign({
  id: 's1', title: 'Amazing Grace', author: 'John Newton', tags: ['hymn'], lyrics: '1\n[G]Amazing [C]grace',
  notes: 'slowly', transpose: 2, accidentals: 'flat', tuneIndex: 0, favourite: true,
  createdAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-02-01T10:00:00.000Z', origin: null
}, over);
const setRec = { id: 'set1', name: 'Sunday', items: [{ songId: 's1', transpose: 3, capo: 2, tuneIndex: null }], createdAt: '2026-03-01T10:00:00.000Z', updatedAt: '2026-03-02T10:00:00.000Z' };

test('backup document shape; maps and arrays both accepted', () => {
  const text = B.exportJsonBackup({ songs: { s1: song() }, sets: [setRec], settings: { theme: 'night' } });
  const doc = JSON.parse(text);
  assert.equal(doc.format, 'songsheets-backup');
  assert.equal(doc.version, 1);
  assert.equal(doc.app, 'songsheets/1.0.0');
  assert.match(doc.exportedAt, ISO);
  assert.deepEqual(doc.songs, [song()]);
  assert.deepEqual(doc.sets, [setRec]);
  assert.deepEqual(doc.settings, { theme: 'night' });
  assert.equal(JSON.parse(B.exportJsonBackup({})).settings, null);
});

test('backup round trip is lossless', () => {
  const r = B.importAny(B.exportJsonBackup({ songs: [song()], sets: { set1: setRec }, settings: { pageSize: 'Letter' } }), 'songsheets-backup.json');
  assert.equal(r.kind, 'backup');
  assert.deepEqual(r.songs, [song()]);
  assert.deepEqual(r.sets, [setRec]);
  assert.deepEqual(r.settings, { pageSize: 'Letter' });
  assert.deepEqual(r.warnings, []);
});

test('imported records are fully populated and normalised', () => {
  const doc = { format: 'songsheets-backup', version: 1, songs: [{ title: '  Two   words ', lyrics: '\ufeff\r\n\r\ncafe\u0301\r\n', transpose: -1, __proto__x: 1 }], sets: [{ name: 'S', items: [{ songId: 'x', capo: 0 }, { nope: 1 }] }] };
  const r = B.importAny(JSON.stringify(doc), 'b.json');
  const s = r.songs[0];
  assert.deepEqual(Object.keys(s).sort(), ['accidentals', 'author', 'createdAt', 'favourite', 'id', 'lyrics', 'notes', 'origin', 'tags', 'title', 'transpose', 'tuneIndex', 'updatedAt']);
  assert.equal(s.title, 'Two words');
  assert.equal(s.lyrics, 'caf\u00e9');
  assert.equal(s.transpose, 11);
  assert.equal(s.author, null);
  assert.match(s.id, /^[0-9a-f-]{36}$/);
  assert.match(s.createdAt, ISO);
  assert.equal(s.updatedAt, s.createdAt);
  assert.deepEqual(r.sets[0].items, [{ songId: 'x', transpose: null, capo: null, tuneIndex: null }]);
});

test('a newer backup format warns but still imports', () => {
  const r = B.importAny(JSON.stringify({ format: 'songsheets-backup', version: 9, songs: [song()], sets: [] }), 'b.json');
  assert.equal(r.songs.length, 1);
  assert.match(r.warnings[0], /newer version/);
});

test('songbase API data: songs, tags, origin, a book as an ordered set', () => {
  const r = B.importAny(fx('songbase-api.json'), 'app_data.json');
  assert.equal(r.kind, 'songbase-api');
  assert.deepEqual(r.songs.map((s) => [s.id, s.title, s.tags]), [
    ['songbase-1246', 'Grace Upon Grace', ['english']],
    ['songbase-77', 'Canci\u00f3n', ['espa\u00f1ol']]
  ]);
  assert.equal(r.songs[0].lyrics, '1\n[G]Grace upon [C]grace,\nMercy an[D]ew\n\n  [C]Holy, [G]holy');
  assert.equal(r.songs[1].lyrics, '# Capo 2\n\n1\n[A]\u00c9l es [D]mi can_ci\u00f3n');
  assert.deepEqual(r.songs[0].origin, { source: 'songbase', id: 1246, lang: 'english', language_links: [4784, 2509], importedAt: r.songs[0].createdAt });
  assert.equal(r.sets.length, 1);
  assert.equal(r.sets[0].id, 'songbase-book-3');
  assert.equal(r.sets[0].name, 'Evening Book');
  assert.deepEqual(r.sets[0].items.map((i) => i.songId), ['songbase-77', 'songbase-1246']);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /Evening Book.*1 song is not in this file.*999/);
});

test('songbase import is idempotent: the same data gives the same ids', () => {
  const a = B.importAny(fx('songbase-api.json'), 'a.json');
  const b = B.importAny(fx('songbase-api.json'), 'a.json');
  assert.deepEqual(a.songs.map((s) => s.id), b.songs.map((s) => s.id));
  assert.deepEqual(a.sets.map((s) => s.id), b.sets.map((s) => s.id));
  const bare = B.importAny(JSON.stringify(JSON.parse(fx('songbase-api.json')).songs), 'songs.json');
  assert.equal(bare.kind, 'songbase-songs');
  assert.deepEqual(bare.songs.map((s) => s.id), a.songs.map((s) => s.id));
});

test('detectImport recognises every kind', () => {
  const sheet = M.buildSheet({ id: 'x', title: 'T', lyrics: '[G]Hi' });
  const cases = [
    [B.exportJsonBackup({ songs: [song()] }), 'b.json', 'backup'],
    [JSON.stringify(H.buildEmbed([sheet], {})), 'embed.json', 'backup'],
    [H.exportHtml([sheet], {}), 'T.html', 'html-embed'],
    [fx('songbase-api.json'), 'x.json', 'songbase-api'],
    ['[{"id":1,"title":"A","lyrics":"x"}]', 'x.json', 'songbase-songs'],
    [CP.exportChordPro([sheet]), 'T.cho', 'chordpro'],
    ['{title: T}\n[G]x', 'T.txt', 'chordpro'],
    ['no directives at all', 'song.chopro', 'chordpro'],
    ['G     C\nHello there\n', 'song.txt', 'two-line'],
    ['1\n[G]Hello [C]there', 'song.txt', 'songbase-text'],
    ['Just some lyrics\nwith no chords', 'song.txt', 'songbase-text'],
    ['', 'empty.txt', 'unknown'],
    ['{"hello": 1}', 'x.json', 'unknown'],
    ['not json', 'x.json', 'unknown'],
    ['<html><body>other page</body></html>', 'x.html', 'unknown'],
    ['%PDF-1.3\n\u0000\u0001binary', 'x.pdf', 'unknown'],
    ['PK\u0003\u0004\ufffd\ufffd', 'x.docx', 'unknown']
  ];
  for (const [text, name, kind] of cases) assert.equal(B.detectImport(text, name), kind, name + ': ' + JSON.stringify(text.slice(0, 40)));
});

test('text imports take the title from the file name', () => {
  const r = B.importAny('G     C\nHello there\n', 'C:\\songs\\Hello There.txt');
  assert.equal(r.kind, 'two-line');
  assert.equal(r.songs[0].title, 'Hello There');
  assert.equal(r.songs[0].lyrics, '[G]Hello [C]there');
  assert.equal(B.importAny('[G]x', 'My Song.songbase.txt').songs[0].title, 'My Song');
  const cho = B.importAny('{title: From Directive}\n[G]x\n{tempo: 90}', 'file.cho');
  assert.equal(cho.songs[0].title, 'From Directive');
  assert.match(cho.warnings[0], /^From Directive: Ignored 1 ChordPro directive: tempo$/);
});

test('an unreadable file becomes a warning, never an exception', () => {
  const r = B.importAny('%PDF-1.3\u0000', 'scan.pdf');
  assert.equal(r.kind, 'unknown');
  assert.deepEqual(r.songs, []);
  assert.match(r.warnings[0], /^scan\.pdf: not a file Songsheets can import/);
  const bad = B.importAny('<!doctype html><script type="text/plain" id="songsheets-source">{not json</script>', 'x.html');
  assert.equal(bad.kind, 'html-embed');
  assert.match(bad.warnings[0], /damaged/);
});

test('importFiles concatenates files and reports per-file problems', async () => {
  const file = (name, text) => ({ name, text: () => Promise.resolve(text) });
  const broken = { name: 'gone.txt', text: () => Promise.reject(new Error('permission denied')) };
  const r = await B.importFiles([
    file('a.json', B.exportJsonBackup({ songs: [song()], sets: [setRec], settings: { theme: 'night' } })),
    file('b.cho', '{title: B}\n[G]b'),
    broken,
    file('c.pdf', '%PDF\u0000')
  ]);
  assert.equal(r.kind, 'mixed');
  assert.deepEqual(r.songs.map((s) => s.title), ['Amazing Grace', 'B']);
  assert.equal(r.sets.length, 1);
  assert.deepEqual(r.settings, { theme: 'night' });
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings[0], /^gone\.txt: could not be read \(permission denied\)/);
  assert.match(r.warnings[1], /^c\.pdf: not a file/);
  const one = await B.importFiles([file('x.cho', '{title: X}\n[G]x')]);
  assert.equal(one.kind, 'chordpro');
});
