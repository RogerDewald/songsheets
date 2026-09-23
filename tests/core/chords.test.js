'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../js/core/chords.js');

const kinds = (s) => C.parseChordToken(s).map((p) => p.kind + ':' + p.text);

test('single chord symbols parse as one chord', () => {
  const chords = ['A', 'Am', 'F#m7', 'Bm7b5', 'Cmaj7', 'CMaj7', 'CM7', 'Dsus4', 'Csus', 'Csus2', 'A2', 'Aadd9',
    'E7#9', 'Bdim', 'Bdim7', 'Caug', 'C+', 'Gm(add9)', 'G(add9)', 'Ebmaj7', 'A7sus4', 'D13', 'C11', 'Cmin7',
    'C°7', 'Cb', 'E#', 'Bbm7b5', 'CmMaj7', 'F♯', 'B♭m', 'C6', 'G7'];
  for (const c of chords) {
    const parts = C.parseChordToken(c);
    assert.equal(parts.length, 1, c + ' -> ' + JSON.stringify(parts));
    assert.equal(parts[0].kind, 'chord', c);
  }
});

test('slash chords keep their bass', () => {
  assert.deepEqual(C.parseChordToken('G/B')[0], { kind: 'chord', root: 'G', suffix: '', bass: 'B', text: 'G/B' });
  assert.deepEqual(C.parseChordToken('D/F#')[0], { kind: 'chord', root: 'D', suffix: '', bass: 'F#', text: 'D/F#' });
  assert.equal(C.parseChordToken('Am/G')[0].bass, 'G');
  assert.equal(C.parseChordToken('G7/B')[0].suffix, '7');
});

test('sequences keep their separators', () => {
  assert.deepEqual(kinds('F#m  Bm'), ['chord:F#m', 'sep:  ', 'chord:Bm']);
  assert.deepEqual(kinds('G-C-G'), ['chord:G', 'sep:-', 'chord:C', 'sep:-', 'chord:G']);
  assert.deepEqual(kinds('D - D7'), ['chord:D', 'sep: - ', 'chord:D7']);
  assert.deepEqual(kinds('(G)'), ['sep:(', 'chord:G', 'sep:)']);
  assert.deepEqual(kinds('G x2'), ['chord:G', 'sep: ', 'text:x2']);
  assert.deepEqual(kinds('C6/9'), ['chord:C6', 'sep:/', 'text:9']);
  assert.deepEqual(kinds('- C - D'), ['sep:- ', 'chord:C', 'sep: - ', 'chord:D']);
});

test('words that are not chords stay text', () => {
  for (const w of ['Chorus', 'N.C.', 'x2', 'Riff', 'Intro', 'Bridge', 'Coda', 'Do', 'Amen', 'Bass', 'Ending', 'Fine', 'Ebb', 'Gx2', 'Add']) {
    assert.equal(C.isChordToken(w), false, w);
  }
  assert.equal(C.isChordToken('Capo 2'), false);
  assert.deepEqual(C.parseChordToken(''), []);
});

test('serializeParts is byte-identical', () => {
  const samples = ['', 'G', 'F#m  Bm', ' G', 'x2', 'N.C.', 'C-CM7-C-CM7', '(G)', 'D/F#', 'Gm(add9)', 'a b  c', '--', '|G|C|'];
  for (let i = 0; i < 300; i++) {
    const alphabet = 'ABCDEFGabm#/-() 79xsu.';
    let s = '';
    const len = (i * 7) % 12;
    for (let j = 0; j < len; j++) s += alphabet[(i * 31 + j * 17) % alphabet.length];
    samples.push(s);
  }
  for (const s of samples) assert.equal(C.serializeParts(C.parseChordToken(s)), s, JSON.stringify(s));
});

test('minor detection', () => {
  assert.equal(C.isMinorSuffix('m7'), true);
  assert.equal(C.isMinorSuffix('min'), true);
  assert.equal(C.isMinorSuffix('mMaj7'), true);
  assert.equal(C.isMinorSuffix('maj7'), false);
  assert.equal(C.isMinorSuffix('Maj7'), false);
  assert.equal(C.isMinorSuffix('M7'), false);
  assert.equal(C.firstChord('x2'), null);
  assert.deepEqual(C.firstChord('Am7-D'), { root: 'A', suffix: 'm7', bass: null, minor: true });
});
