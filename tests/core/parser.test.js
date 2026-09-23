'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../../js/core/parser.js');

// compact view of a line: [chord|text] pairs
const segs = (line) => line.segments.map((s) => [s.chord, s.text]);
const blocksOf = (text, tune = 0) => P.parse(text).tunes[tune].blocks;

test('chords inside words', () => {
  const b = blocksOf('You can enter [C]chords in [Am]the ex[F]act place');
  assert.equal(b.length, 1);
  assert.equal(b[0].kind, 'stanza');
  assert.equal(b[0].number, null);
  assert.deepEqual(segs(b[0].lines[0]), [[null, 'You can enter '], ['C', 'chords in '], ['Am', 'the ex'], ['F', 'act place']]);
  assert.equal(b[0].lines[0].hasChords, true);
});

test('stanza numbers, chorus, capo and comments', () => {
  const b = blocksOf('1\n[G]Alpha [D]beta\nGamma\n\n  Chorus [C]line\n   deeper\n\n# Capo 2\n#no space comment');
  assert.deepEqual(b.map((x) => x.kind), ['stanza', 'blank', 'chorus', 'blank', 'capo', 'comment']);
  assert.equal(b[0].number, '1');
  assert.deepEqual(segs(b[0].lines[0]), [['G', 'Alpha '], ['D', 'beta']]);
  assert.deepEqual(segs(b[0].lines[1]), [[null, 'Gamma']]);
  assert.equal(b[2].lines[0].indent, 0);
  assert.equal(b[2].lines[1].indent, 1);
  assert.deepEqual(segs(b[2].lines[1]), [[null, 'deeper']]);
  assert.equal(b[4].n, 2);
  assert.equal(b[4].text, 'Capo 2');
  assert.equal(b[5].text, 'no space comment');
});

test('a digit line inside a stanza run starts a new numbered stanza', () => {
  const b = blocksOf('Line A\n2\nLine B');
  assert.deepEqual(b.map((x) => [x.kind, x.number]), [['stanza', null], ['stanza', '2']]);
});

test('hash in chorus, single space, tab', () => {
  const b = blocksOf('  # hash in chorus\n Single space\n\tTabbed');
  assert.equal(b[0].kind, 'chorus');
  assert.deepEqual(segs(b[0].lines[0]), [[null, '# hash in chorus']]);
  assert.equal(b[1].kind, 'stanza');
  assert.deepEqual(segs(b[1].lines[0]), [[null, ' Single space']]);
  assert.deepEqual(segs(b[1].lines[1]), [[null, '\tTabbed']]);
});

test('adjacent chords, trailing chord, spacer chord', () => {
  const b = blocksOf('[G][D]word end[C]\n[]  [Em]');
  assert.deepEqual(segs(b[0].lines[0]), [['G', ''], ['D', 'word end'], ['C', '']]);
  assert.deepEqual(segs(b[0].lines[1]), [['', '  '], ['Em', '']]);
  assert.equal(b[0].lines[1].hasChords, true);
});

test('tunes', () => {
  const song = P.parse('First tune text\n### Second tune\n[G]La\n####\n###');
  assert.deepEqual(song.tunes.map((t) => [t.title, t.explicitTitle]), [['Tune 1', false], ['Second tune', true], ['Tune 3', true]]);
  assert.deepEqual(song.tunes[1].blocks.map((b) => b.kind), ['stanza', 'comment']);
  assert.equal(song.tunes[1].blocks[1].text, '###');
  assert.equal(song.tunes[2].blocks.length, 0);
  assert.equal(song.hasChords, true);
  const first = P.parse('### Original\n\n1\nText');
  assert.equal(first.tunes.length, 1);
  assert.equal(first.tunes[0].title, 'Original');
  assert.equal(first.tunes[0].blocks[0].kind, 'stanza');
});

test('inline marks on lyric text only', () => {
  const b = blocksOf('**Bo[G]ld** and *it* a_b\n# **Loud** note');
  const line = b[0].lines[0];
  assert.deepEqual(segs(line), [[null, 'Bo'], ['G', 'ld and it a‿b']]);
  assert.deepEqual(line.segments[0].runs, [{ text: 'Bo', bold: true }]);
  assert.deepEqual(line.segments[1].runs, [
    { text: 'ld', bold: true }, { text: ' and ' }, { text: 'it', italic: true }, { text: ' a' }, { text: '‿', tie: true }, { text: 'b' }
  ]);
  assert.deepEqual(b[1].runs, [{ text: 'Loud', bold: true }, { text: ' note' }]);
  assert.deepEqual(segs(blocksOf('a * b')[0].lines[0]), [[null, 'a * b']]);
});

test('key override, capo variants and trailing whitespace', () => {
  const b = blocksOf('# Key: Em\n\n\n3 \n');
  assert.deepEqual(b.map((x) => x.kind), ['key', 'blank', 'blank', 'stanza']);
  assert.equal(b[0].key, 'Em');
  assert.equal(b[3].number, '3');
  for (const c of ['#Capo1', '# capo 4', '# Capo: 2', '# CAPO 3']) assert.equal(blocksOf(c)[0].kind, 'capo', c);
  const long = blocksOf('# Capo 3 (original key D)')[0];
  assert.equal(long.kind, 'capo');
  assert.equal(long.text, 'Capo 3 (original key D)');
  assert.equal(blocksOf('# Capo 0')[0].kind, 'comment');
  assert.equal(blocksOf('put the capo 2 frets up')[0].kind, 'stanza');   // songbase turned this into a control
  assert.equal(blocksOf('# Key: F# minor')[0].key, 'F#m');
  assert.equal(blocksOf('# Key: Bb major')[0].key, 'Bb');
  assert.equal(blocksOf('# New tune:')[0].hidesWithChords, true);
});

test('empty input and CRLF', () => {
  const empty = P.parse('');
  assert.equal(empty.tunes.length, 1);
  assert.equal(empty.tunes[0].blocks.length, 0);
  const crlf = P.parse('1\r\n[G]A\r\n\r\n  B');
  assert.deepEqual(crlf.tunes[0].blocks.map((b) => b.kind), ['stanza', 'blank', 'chorus']);
  assert.deepEqual(P.parse(null).tunes.length, 1);
});

test('fixtures parse without losing lines', () => {
  for (const f of ['example.txt', 'multitune.txt']) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'fixtures', f), 'utf8');
    const song = P.parse(text);
    const src = text.replace(/\r\n/g, '\n').split('\n');
    for (const t of song.tunes) {
      for (const b of t.blocks) {
        for (const l of b.lines || []) assert.equal(l.raw, src[l.line]);
      }
    }
    assert.ok(song.hasChords);
  }
  const multi = P.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'multitune.txt'), 'utf8'));
  assert.equal(multi.tunes.length, 2);
});
