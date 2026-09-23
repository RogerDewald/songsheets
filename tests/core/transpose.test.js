'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../js/core/transpose.js');

const tr = (chord, fromKey, semitones, accidentals) => T.transposeChord(chord, { fromKey, semitones, accidentals });
const key = (chords, override) => T.detectKey(chords, { override });

test('songbase compatibility: a song in G', () => {
  const cases = [['G', 1, 'Ab'], ['C', 1, 'Db'], ['D', 1, 'Eb'], ['Em', 1, 'Fm'], ['F', 1, 'Gb'],
    ['G/B', 2, 'A/C#'], ['D/F#', 2, 'E/G#'], ['C', 6, 'Gb'], ['C', 11, 'Cb'], ['G', 3, 'Bb'],
    ['G', 5, 'C'], ['Em', 4, 'G#m'], ['D/F#', 4, 'F#/A#'], ['G/B', 11, 'Gb/Bb']];
  for (const [c, s, want] of cases) assert.equal(tr(c, 'G', s), want, `${c} +${s}`);
});

test('transpose is normalised mod 12', () => {
  assert.equal(tr('Eb', 'C', 12), 'Eb');
  assert.equal(tr('Eb', 'C', -12), 'Eb');
  assert.equal(tr('Eb', 'C', 13), 'E');
  assert.equal(tr('G', 'G', -1), 'Gb');
  assert.equal(tr('G', 'G', 0), 'G');
});

test('out-of-scale chords keep the author\'s accidental family', () => {
  assert.equal(tr('Bb', 'G', 5), 'Eb');            // songbase gives D#
  assert.equal(tr('D#7', 'A', 2), 'F7');
});

test('non-chords are never transposed', () => {
  for (let s = 1; s < 12; s++) {
    for (const w of ['N.C.', 'Chorus', 'x2', 'Riff', 'Intro', '']) assert.equal(tr(w, 'C', s), w, `${w} +${s}`);
  }
});

test('separators and suffixes are preserved', () => {
  assert.equal(tr('G x2', 'G', 1), 'Ab x2');
  assert.equal(tr('(G)', 'G', 1), '(Ab)');
  assert.equal(tr('G-C-G', 'G', 1), 'Ab-Db-Ab');
  assert.equal(tr('D - D7', 'D', 2), 'E - E7');
  assert.equal(tr('F#m  Bm', 'A', 1), 'Gm  Cm');
  assert.equal(tr('Dsus4-D', 'D', 1), 'Ebsus4-Eb');
  assert.equal(tr('Cmaj7', 'C', 2), 'Dmaj7');
  assert.equal(tr('CMaj7', 'C', 2), 'DMaj7');
  assert.equal(tr('Gm(add9)', 'F', 2), 'Am(add9)');
});

test('unusual roots', () => {
  assert.equal(tr('Cb', 'Gb', 1), 'C');
  assert.equal(tr('E#', 'C', 2), 'G');
  assert.equal(tr('B#', 'C', 1), 'Db');
  assert.equal(tr('Fb', 'C', 2), 'F#');   // Fb sounds as E, degree 3 of C
  assert.equal(T.noteIndex('Cb'), T.noteIndex('B'));
  assert.equal(T.noteIndex('E#'), T.noteIndex('F'));
  assert.equal(T.noteIndex('H'), -1);
});

test('forced accidentals', () => {
  assert.equal(tr('C', 'C', 6, 'sharp'), 'F#');
  assert.equal(tr('Bb', 'G', 5, 'flat'), 'Eb');
  assert.equal(tr('C', 'G', 11, 'sharp'), 'B');
  assert.equal(tr('C', 'G', 11, 'flat'), 'B');
  assert.equal(tr('Bb', 'F', 0, 'sharp'), 'A#');
  assert.equal(tr('Bb', 'F', 0, 'auto'), 'Bb');
});

test('key detection: bookends and relative major', () => {
  assert.equal(key(['G', 'C', 'G']).major, 'G');
  assert.equal(key(['Dm', 'C', 'Dm']).major, 'F');
  assert.equal(key(['Am7', 'G', 'Am7']).major, 'C');
  const fsm = key(['F#m', 'E', 'F#', 'B', 'C#m', 'D#7', 'F#m']);
  assert.equal(fsm.major, 'A');
  assert.equal(fsm.minor, true);
  assert.equal(fsm.label, 'F#m');
  assert.equal(key(['C#m', 'A', 'E', 'B', 'C#m']).major, 'E');
  const cmaj = key(['Cmaj7', 'F', 'G', 'Cmaj7']);
  assert.equal(cmaj.major, 'C');
  assert.equal(cmaj.minor, false);
  const fs = key(['F#', 'B', 'C#', 'F#']);
  assert.equal(fs.major, 'Gb');
  assert.equal(fs.label, 'F#');
});

test('key detection: common chords and ties', () => {
  assert.equal(key(['G', 'C', 'D', 'Em']).major, 'G');
  assert.equal(key(['Am', 'F', 'C', 'G']).major, 'C');
  assert.equal(key(['C', 'G']).major, 'C');
  assert.equal(key(['C', 'G', 'D']).major, 'G');
  assert.equal(key(['x2']), null);
  assert.equal(key([]), null);
});

test('key override from a "# Key:" comment', () => {
  const em = key(['C', 'D'], 'Em');
  assert.equal(em.major, 'G');
  assert.equal(em.label, 'Em');
  assert.equal(em.source, 'override');
  assert.equal(key(['C'], 'F#').major, 'Gb');
});

test('whole songs transpose with correct spelling', () => {
  const song = (chords, s) => {
    const k = key(chords);
    return chords.map((c) => tr(c, k.major, s));
  };
  assert.deepEqual(song(['F#m', 'E', 'F#', 'B', 'C#m', 'D#7', 'F#m'], 2), ['G#m', 'F#', 'G#', 'C#', 'D#m', 'F7', 'G#m']);
  assert.deepEqual(song(['C#m', 'A', 'E', 'B', 'C#m'], 1), ['Dm', 'Bb', 'F', 'C', 'Dm']);
  assert.deepEqual(song(['F#', 'B', 'C#', 'F#'], 1), ['G', 'C', 'D', 'G']);
  assert.deepEqual(song(['Cmaj7', 'F', 'G', 'Cmaj7'], 2), ['Dmaj7', 'G', 'A', 'Dmaj7']);
});

test('key labels', () => {
  const fsm = key(['F#m', 'E', 'F#m']);
  assert.equal(T.keyLabel(fsm, 2), 'G#m');
  assert.equal(T.keyLabel(fsm, 0), 'F#m');
  const c = key(['C', 'F', 'C']);
  assert.equal(T.keyLabel(c, 1), 'Db');
  assert.equal(T.keyLabel(c, 6), 'Gb');
  assert.equal(T.keyLabel(c, 6, 'sharp'), 'F#');
  const choices = T.keyChoices(c);
  assert.equal(choices.length, 12);
  assert.equal(choices[0].label, 'C');
  assert.equal(choices[1].label, 'Db / C#');
});
