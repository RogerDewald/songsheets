'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../../js/core/sheetModel.js');
const U = require('../../js/export/util.js');
const CSS = require('../../js/export/cssStrings.js');

test('sanitizeFilename', () => {
  assert.equal(U.sanitizeFilename('Amazing Grace? (G) <live>'), 'Amazing Grace (G) live');
  assert.equal(U.sanitizeFilename('   '), 'song');
  assert.equal(U.sanitizeFilename(null, 'set-list'), 'set-list');
  assert.equal(U.sanitizeFilename('CON'), 'CON-');
  assert.equal(U.sanitizeFilename('nul.txt'), 'nul-.txt');
  assert.equal(U.sanitizeFilename('Console'), 'Console');
  assert.equal(U.sanitizeFilename('a/b\\c:d'), 'abcd');
  assert.equal(U.sanitizeFilename('..hidden.. '), 'hidden');
  assert.equal(U.sanitizeFilename('tab\there\nnew\x07'), 'tab here new');
  assert.equal(U.sanitizeFilename('cafe\u0301'), 'caf\u00e9');
  const long = U.sanitizeFilename('x'.repeat(119) + '😀tail');
  assert.equal(Array.from(long).length, 120);
  assert.ok(long.endsWith('😀'), 'never splits a surrogate pair');
  assert.equal(U.buildFilename('Night: set', 'songbase.txt'), 'Night set.songbase.txt');
});

test('titleFromFilename', () => {
  assert.equal(U.titleFromFilename('C:\\a\\b\\Amazing Grace.cho'), 'Amazing Grace');
  assert.equal(U.titleFromFilename('/x/My Song.songbase.txt'), 'My Song');
  assert.equal(U.titleFromFilename('notes.md'), 'notes');
  assert.equal(U.titleFromFilename('Version 2.0'), 'Version 2');
  assert.equal(U.titleFromFilename(''), 'Untitled');
});

test('grapheme and column counting', () => {
  assert.deepEqual(U.graphemes('e\u0301a'), ['e\u0301', 'a']);
  assert.equal(U.cells('ab'), 2);
  assert.equal(U.cells('歌'), 2);
  assert.equal(U.cells('한국'), 4);
  assert.equal(U.cells('a\u200bb'), 2);
  assert.equal(U.padEnd('歌', 4), '歌  ');
});

test('effective capo and the meta line', () => {
  assert.equal(U.effectiveCapo(M.buildSheet({ lyrics: '# Capo 3\n[G]x' })), 3);
  assert.equal(U.effectiveCapo(M.buildSheet({ lyrics: '# Capo 3\n[G]x' }, { transpose: 3 })), null);
  assert.equal(U.effectiveCapo(M.buildSheet({ lyrics: '[A]x' }, { capoOverride: 2 })), 2);
  assert.equal(U.effectiveCapo(M.buildSheet({ lyrics: '[A]x' })), null);
  assert.equal(U.metaLine(M.buildSheet({ author: 'Ann', lyrics: '# Capo 3\n[G]x' })), 'Key: G · Capo 3 · Ann');
  assert.equal(U.metaLine(M.buildSheet({ author: 'Ann', lyrics: '# Capo 3\n[G]x' }, { showChords: false })), 'Ann');
  assert.equal(U.metaLine(M.buildSheet({ lyrics: 'no chords' })), '');
  assert.equal(U.tocMeta(M.buildSheet({ lyrics: '# Capo 3\n[G]x' }), ', '), 'G, Capo 3');
});

test('validColor and clampScale', () => {
  assert.equal(U.validColor('#ABCDEF'), '#abcdef');
  assert.equal(U.validColor('#abc'), '#aabbcc');
  assert.equal(U.validColor('red; background:url(x)'), '#1f45ff');
  assert.equal(U.validColor(undefined), '#1f45ff');
  assert.equal(U.clampScale(undefined), 1);
  assert.equal(U.clampScale(9), 3);
  assert.equal(U.clampScale(0.1), 0.5);
  assert.equal(U.clampScale('x'), 1);
});

test('cssStrings equal the CSS files', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', 'css', f), 'utf8').replace(/\r\n?/g, '\n');
  assert.equal(CSS.SHEET_CSS, read('sheet.css'), 'run: node tools/sync-css.js');
  assert.equal(CSS.THEMES_CSS, read('themes.css'), 'run: node tools/sync-css.js');
  assert.equal(CSS.PRINT_CSS, read('print.css'), 'run: node tools/sync-css.js');
  assert.ok(CSS.SHEET_CSS.length > 500 && CSS.THEMES_CSS.length > 500 && CSS.PRINT_CSS.length > 500);
});
