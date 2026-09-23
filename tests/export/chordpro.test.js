'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../js/core/sheetModel.js');
const N = require('../../js/core/normalize.js');
const CP = require('../../js/export/chordpro.js');

const sheet = (title, lyrics, opts, extra) => M.buildSheet(Object.assign({ id: title, title, lyrics }, extra), opts);

const ROUND_TRIP = [
  '# Key: G',
  '# Capo 2',
  '',
  '# Sing gently',
  '',
  '1',
  '[G]Amazing grace, how [C]sweet the [G]sound',
  'That saved a wretch like [D]me;',
  '',
  '  [C]Praise [G]God, from whom',
  '   all bless_ings [D]flow',
  '',
  'An unnumbered [Em]stanza',
  '[G]   [D]',
  '',
  '2',
  'Through many dangers'
].join('\n');

test('export maps the model to ChordPro directives', () => {
  const out = CP.exportChordPro([sheet('Amazing Grace', ROUND_TRIP, {}, { author: 'John Newton' })]);
  assert.equal(out, [
    '{title: Amazing Grace}',
    '{artist: John Newton}',
    '{key: G}',
    '{capo: 2}',
    '',
    '{comment: Sing gently}',
    '',
    '{start_of_verse: label="1"}',
    '[G]Amazing grace, how [C]sweet the [G]sound',
    'That saved a wretch like [D]me;',
    '{end_of_verse}',
    '',
    '{start_of_chorus}',
    '[C]Praise [G]God, from whom',
    ' all bless‿ings [D]flow',
    '{end_of_chorus}',
    '',
    'An unnumbered [Em]stanza',
    '[G]   [D]',
    '',
    '{start_of_verse: label="2"}',
    'Through many dangers',
    '{end_of_verse}',
    ''
  ].join('\n'));
});

test('round trip: import(export(song)) gives the song text back', () => {
  const cho = CP.exportChordPro([sheet('Amazing Grace', ROUND_TRIP, {}, { author: 'John Newton' })]);
  const back = CP.importChordPro(cho, { filename: 'x.cho' });
  assert.equal(back.length, 1);
  assert.equal(back[0].title, 'Amazing Grace');
  assert.equal(back[0].author, 'John Newton');
  assert.deepEqual(back[0].warnings, []);
  assert.equal(back[0].lyrics, N.normalizeText(ROUND_TRIP));
});

test('a detected key comes back as a "# Key:" line; bold/italic markers are not kept', () => {
  const src = '[G]One **bold** *it* [C]two [G]three';
  const back = CP.importChordPro(CP.exportChordPro([sheet('S', src)]))[0];
  assert.equal(back.lyrics, '# Key: G\n\n[G]One bold it [C]two [G]three');
});

test('tunes, transposed chords, lyrics only and set lists', () => {
  const multi = '### Original\n[G]La [C]la\n### Second\n[D]La [G]la';
  const t1 = CP.exportChordPro([sheet('M', multi, { tuneIndex: 1, transpose: 2 })]);
  assert.match(t1, /\{subtitle: Second\}\n\{x_songsheets_tune: Second\}\n\{key: E\}\n\n\[E\]La \[A\]la\n$/);
  assert.equal(CP.importChordPro(t1)[0].lyrics, '### Second\n# Key: E\n\n[E]La [A]la');
  const plain = CP.exportChordPro([sheet('P', '# Capo 3\n[G]La [C]la', { showChords: false })]);
  assert.equal(plain, '{title: P}\n\nLa la\n');
  const set = CP.exportChordPro([sheet('A', '[G]a'), sheet('B', '[C]b')], { setName: 'Evening' });
  assert.equal(set, '# Evening\n{title: A}\n{key: G}\n\n[G]a\n\n{new_song}\n{title: B}\n{key: C}\n\n[C]b\n');
  const two = CP.importChordPro(set, { filename: 'evening.cho' });
  assert.deepEqual(two.map((s) => s.title), ['A', 'B']);
});

test('an active capo preset is not exported as a capo; a set-list capo is', () => {
  assert.ok(!/capo/i.test(CP.exportChordPro([sheet('S', '# Capo 2\n[G]One', { transpose: 2 })])));
  assert.match(CP.exportChordPro([sheet('S', '[A]One', { capoOverride: 2 })]), /\{key: G\}\n\{capo: 2\}/);
});

test('import: directive forms, labels, sections and ignored directives', () => {
  const cho = [
    '# a ChordPro source comment, not shown',
    '{t: Song}',
    '{st: Some Writer}',
    '{key: Em}',
    '{tempo: 120}',
    '{define: G base-fret 1 frets 3 2 0 0 0 3}',
    '{c: Intro [Em] [C]}',
    '{sov: label="Verse 2"}',
    '[Em]Line one',
    '{eov}',
    '{start_of_verse Bridge}',
    'Bridge line',
    '{end_of_verse}',
    '{soc}',
    '    [C]Chorus one',
    '      deeper',
    '{eoc}',
    '{chorus}',
    '{sot}',
    'e|---0---|',
    '{eot}',
    '{comment-guitar: selector form}',
    '{x_custom: whatever}'
  ].join('\n');
  const [s] = CP.importChordPro(cho, { filename: 'fallback.cho' });
  assert.equal(s.title, 'Song');
  assert.equal(s.author, 'Some Writer');
  assert.equal(s.lyrics, [
    '# Key: Em',
    '# Intro [Em] [C]',
    '',
    '2',
    '[Em]Line one',
    '',
    '# Bridge',
    'Bridge line',
    '',
    '  [C]Chorus one',
    '    deeper',
    '',
    '# Chorus',
    '',
    '# e|---0---|',
    '',
    '# selector form'
  ].join('\n'));
  assert.equal(s.warnings.length, 1);
  assert.match(s.warnings[0], /^Ignored 3 ChordPro directives: tempo, define, x_custom$/);
});

test('import: untitled songs take the file name; {new_song} splits', () => {
  const songs = CP.importChordPro('[G]one\n{ns}\n[C]two\n', { filename: 'C:\\songs\\My Set.cho' });
  assert.deepEqual(songs.map((s) => [s.title, s.lyrics]), [['My Set 1', '[G]one'], ['My Set 2', '[C]two']]);
  assert.equal(CP.importChordPro('[G]x', {})[0].title, 'Untitled');
});

test('parseDirective', () => {
  assert.deepEqual(CP.parseDirective('{title: Hello: world}'), { name: 'title', arg: 'Hello: world', attrs: {} });
  assert.deepEqual(CP.parseDirective('  { start_of_verse: label="Verse 1" }  '), { name: 'start_of_verse', arg: 'label="Verse 1"', attrs: { label: 'Verse 1' } });
  assert.deepEqual(CP.parseDirective('{soc}'), { name: 'soc', arg: '', attrs: {} });
  assert.equal(CP.parseDirective('not {a} directive'), null);
  assert.equal(CP.parseDirective('[G]lyric'), null);
});

test('isChordLine', () => {
  ['G   C/G  Am7', '| D | Em |', 'N.C.  G', 'Gsus4 D/F# Em7b5 A7(b9)', '(G) x2'].forEach((l) => assert.ok(CP.isChordLine(l, null), l));
  assert.ok(CP.isChordLine('N.C.', 'Silent line'));
  ['Amen', 'A mighty fortress', 'Am I the one', '[G]Already inline', '| | |', ''].forEach((l) => assert.ok(!CP.isChordLine(l, 'lyric follows'), l));
  assert.ok(CP.isChordLine('A', 'Amazing grace'), 'a single chord needs a lyric below');
  assert.ok(!CP.isChordLine('A', ''));
  assert.ok(!CP.isChordLine('Am', null));
});

test('twoLineToInline merges chords into the lyric by column', () => {
  const text = [
    'G          C/G    G',
    'Amazing grace how sweet',
    '',
    'G\tD',
    'Tab\tbed line',
    'Am            Em   D',
    'Short',
    '| D | Em |',
    '',
    '  C',
    '  Chorus line',
    'A',
    'Amen'
  ].join('\n');
  assert.equal(CP.twoLineToInline(text), [
    '[G]Amazing gra[C/G]ce how [G]sweet',
    '',
    '[G]Tab     [D]bed line',
    '[Am]Short' + ' '.repeat(9) + '[Em]' + ' '.repeat(5) + '[D]',
    '| [D] | [Em] |',
    '',
    '  [C]Chorus line',
    '[A]Amen'
  ].join('\n'));
  // common indentation is removed, relative indentation (a chorus) is kept
  assert.equal(CP.twoLineToInline('    G\n    Hello\n      C\n      Chorus'), '[G]Hello\n  [C]Chorus');
});

test('ChordPro without brackets is read as chords over lyrics', () => {
  const [s] = CP.importChordPro('{title: T}\n{soc}\nG      C\nPraise him\n{eoc}\n');
  assert.equal(s.lyrics, '  [G]Praise [C]him');
});
