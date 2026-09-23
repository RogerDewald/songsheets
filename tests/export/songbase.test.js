'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../../js/core/sheetModel.js');
const SB = require('../../js/export/songbaseText.js');

const multi = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'multitune.txt'), 'utf8');

test('untransposed: the song text exactly as stored', () => {
  const sheet = M.buildSheet({ title: 'M', lyrics: multi });
  assert.equal(SB.exportSongbaseText([sheet]), multi.replace(/\s+$/, '') + '\n');
});

test('transposed: only the displayed tune changes, key lines follow', () => {
  const sheet = M.buildSheet({ title: 'M', lyrics: '### One\n# Key: G\n[G]a [C]b\n### Two\n[D]c [G]d' }, { transpose: 2 });
  assert.equal(SB.exportSongbaseText([sheet]), '### One\n# Key: A\n[A]a [D]b\n### Two\n[D]c [G]d\n');
  const second = M.buildSheet({ title: 'M', lyrics: '### One\n[G]a\n### Two\n[D]c [G]d' }, { tuneIndex: 1, transpose: 10 });
  assert.equal(SB.exportSongbaseText([second]), '### One\n[G]a\n### Two\n[C]c [F]d\n');
});

test('forced accidentals respell without transposing', () => {
  const sheet = M.buildSheet({ title: 'S', lyrics: '[Bb]a [Eb]b [Bb]c' }, { accidentals: 'sharp' });
  assert.equal(SB.exportSongbaseText([sheet]), '[A#]a [D#]b [A#]c\n');
});

test('a set: title comments, separators, and a set-list capo written out', () => {
  const songs = { a: { id: 'a', title: 'Alpha', lyrics: '[G]One\n' }, b: { id: 'b', title: 'Beta', lyrics: '[A]Two [D]three' } };
  const set = { id: 's', name: 'S', items: [{ songId: 'a' }, { songId: 'b', capo: 2 }] };
  const out = SB.exportSongbaseText(M.buildSetSheets(set, (id) => songs[id]), { lineEnding: 'CRLF' });
  assert.equal(out, '# Alpha\r\n[G]One\r\n\r\n# ----\r\n\r\n# Beta\r\n# Capo 2\r\n[G]Two [C]three\r\n');
});
