'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../../js/core/sheetModel.js');
const T = require('../../js/export/textExport.js');
const U = require('../../js/export/util.js');

const fx = (f) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'export', f), 'utf8');
const sheet = (title, lyrics, opts) => M.buildSheet({ id: title, title, lyrics }, opts);
const line = (lyrics) => M.buildSheet({ lyrics }).blocks[0].lines[0];

test('worked example 1: stanza number, mid-word chord, chorus', () => {
  assert.equal(T.exportText([sheet('Amazing Grace', fx('amazing.txt'))]), fx('amazing.expected.txt'));
});

test('worked example 2: capo, adjacent chords, chords before spaces and at the end', () => {
  assert.equal(T.exportText([sheet('Glory', fx('glory.txt'))]), fx('glory.expected.txt'));
});

test('worked example 3: a chord wider than its syllable pushes the next one right', () => {
  assert.equal(T.exportText([sheet('Amen', fx('amen.txt'))]), fx('amen.expected.txt'));
});

test('lyrics only when chords are hidden', () => {
  assert.equal(T.exportText([sheet('Amazing Grace', fx('amazing.txt'), { showChords: false })]), fx('amazing.lyrics.expected.txt'));
});

test('CRLF on request', () => {
  const out = T.exportText([sheet('Amen', fx('amen.txt'))], { lineEnding: 'CRLF' });
  assert.equal(out, fx('amen.expected.txt').replace(/\n/g, '\r\n'));
});

test('columns count grapheme clusters, not code units', () => {
  // "cafe" + combining acute is 5 code units but 4 columns (and comes out NFC); the tie is one column
  const r = T.layoutTextLine(line('cafe\u0301 [G]x under_s[D]core'));
  assert.equal(r.lyricRow, 'café x under‿score');
  assert.equal(r.chordRow, '     G        D');
  assert.equal(U.glen('cafe\u0301'), 4);
  assert.equal(U.glen('‿'), 1);
  assert.equal(U.glen('👍🏽'), 1);
});

test('wide characters take two columns', () => {
  const r = T.layoutTextLine(line('主[G]啊 [C]我'));
  assert.equal(r.lyricRow, '主啊 我');
  assert.equal(r.chordRow, '  G  C');
});

test('chords never overlap: one space between, cascading', () => {
  assert.equal(T.layoutTextLine(line('[Am7]a[D]men')).chordRow, 'Am7 D');
  assert.equal(T.layoutTextLine(line('[C]a[G]b[D]c')).chordRow, 'C G D');
  assert.equal(T.layoutTextLine(line('[G]   [D]')).chordRow, 'G  D');
  assert.equal(T.layoutTextLine(line('no chords here')).chordRow, null);
  assert.equal(T.layoutTextLine(line('[]  [Em]x')).chordRow, '  Em', 'an empty spacer chord takes no room');
});

test('comments, capo presets and key lines', () => {
  const out = T.exportText([sheet('S', '# Key: G\n# Intro: **[G]** [C]\n\n[G]One')]);
  assert.match(out, /^S\nKey: G\n\n {4}\(Key: G\)\n {4}\(Intro: \[G\] \[C\]\)\n\n {4}G\n {4}One\n$/);
  // an active capo preset means the chords sound as shown: no capo line, no capo in the header
  const active = T.exportText([sheet('S', '# Capo 2\n[G]One', { transpose: 2 })]);
  assert.ok(!/Capo/.test(active), active);
  assert.match(active, /Key: A/);
});

test('a set gets a contents list and separators', () => {
  const set = { id: 'x', name: 'Sunday', items: [{ songId: 'a' }, { songId: 'b', capo: 2 }] };
  const songs = { a: { id: 'a', title: 'Amen', lyrics: fx('amen.txt') }, b: { id: 'b', title: 'Glory', lyrics: '[A]Glory [D]be' } };
  const sheets = M.buildSetSheets(set, (id) => songs[id]);
  const out = T.exportText(sheets);
  const lines = out.split('\n');
  assert.deepEqual(lines.slice(0, 4), ['Sunday', 'Contents', '  1. Amen (G)', '  2. Glory (G, Capo 2)']);
  assert.equal(out.split('-'.repeat(40)).length, 3);
  assert.ok(out.includes('\n\n' + '-'.repeat(40) + '\n\nGlory\nKey: G · Capo 2\n\n    G     C\n    Glory be\n'));
});

test('wide stanza numbers widen the gutter', () => {
  const out = T.exportText([sheet('S', '1234\n[G]One\n\n5\nTwo')]);
  assert.ok(out.includes('     G\n1234 One\n'), out);
  assert.ok(out.includes('\n5    Two\n'), out);
});

test('wrapTextLine breaks between words and keeps each chord with its word', () => {
  const rows = T.wrapTextLine(line('[G]Amazing grace, how [C]sweet the [G]sound that [D]saved a wretch'), 20).map(T.layoutTextLine);
  assert.deepEqual(rows.map((r) => [r.chordRow, r.lyricRow]), [
    ['G', 'Amazing grace, how'],
    ['C         G', 'sweet the sound that'],
    ['D', 'saved a wretch']
  ]);
  rows.forEach((r) => assert.ok(Math.max(U.cells(r.chordRow || ''), U.cells(r.lyricRow)) <= 20));
  // a line that fits is returned untouched; a chord on the break space stays on the first row
  const l = line('short [C]line');
  assert.deepEqual(T.wrapTextLine(l, 40), [l]);
  const end = T.wrapTextLine(line('word[C] next word here'), 8).map(T.layoutTextLine);
  assert.deepEqual(end[0], { chordRow: '    C', lyricRow: 'word', lyricRuns: [{ text: 'word', bold: false, italic: false }] });
  // a trailing chord after the last break is not lost
  const trail = T.wrapTextLine(line('Sing it again and    [C]'), 12).map(T.layoutTextLine);
  assert.equal(trail[trail.length - 1].chordRow, 'C');
});
