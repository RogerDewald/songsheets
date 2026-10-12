'use strict';
// "Convert with AI": the prompt must only promise what the parser really does, and the reader of
// the assistant's answer must cope with what assistants really send.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../../js/app/aiConvert.js');
const P = require('../../js/core/parser.js');
const M = require('../../js/core/sheetModel.js');
const CP = require('../../js/export/chordpro.js');
const N = require('../../js/core/normalize.js');
const fs = require('node:fs');
const path = require('node:path');

const fence = (lines) => '```\n' + lines.join('\n') + '\n```';

// ---- the prompt against the parser ----------------------------------------------------------

test('the prompt is a sensible size and carries every rule and the worked example', () => {
  const p = A.PROMPT;
  assert.ok(p.length > 3000 && p.length < 6500, 'prompt is ' + p.length + ' characters');
  for (const needle of [
    'ONE code block', '# Title:', '# Author:', '# Capo', '[square brackets]', 'A[G]mazing', 'ex[F]act',
    '[G  C  D  G]', 'digits only', 'exactly two spaces', '# Chorus', 'Never start a line with ## or ###', '# Check:',
    'EXAMPLE', 'Your whole reply would be', 'attached to this message', 'above the whole verse or chorus'
  ]) assert.ok(p.includes(needle), 'prompt lost: ' + needle);
  // "# Key:" in Songsheets means the key of the chords as written; a sheet with a capo states the sounding key,
  // so asking an assistant for it would mislabel the song. The app finds the key from the chords itself.
  assert.ok(!/# Key:/.test(p), 'the prompt must not ask for a key line');
  assert.ok(p.includes(A.EXAMPLE_SHEET.join('\n')), 'the example sheet is inside the prompt');
  assert.ok(p.includes(A.EXAMPLE_REPLY.join('\n')), 'the example reply is inside the prompt');
  assert.ok(p.endsWith('\n'), 'ends on a fresh line so a sheet can be pasted straight under it');
});

test('the prompt example: the app\'s own converter turns the sheet into the reply\'s lines', () => {
  const s = A.EXAMPLE_SHEET;
  const verse = s.slice(s.indexOf('1.') + 1, s.indexOf('Chorus') - 1);
  const chorus = s.slice(s.indexOf('Chorus') + 1);
  const inline = CP.twoLineToInline(verse.join('\n') + '\n\n' + chorus.join('\n')).split('\n');
  const r = A.EXAMPLE_REPLY;
  const replyVerse = r.slice(r.indexOf('1') + 1, r.indexOf('1') + 3);
  const replyChorus = r.filter((l) => /^ {2}\S/.test(l)).map((l) => l.slice(2));
  assert.deepEqual(inline, replyVerse.concat([''], replyChorus));
});

test('the prompt example parses as promised: capo, comment, numbered stanza, chorus', () => {
  const song = P.parse(A.EXAMPLE_REPLY.filter((l) => !/^# (Title|Author):/.test(l)).join('\n'));
  assert.equal(song.tunes.length, 1);
  const kinds = song.tunes[0].blocks.filter((b) => b.kind !== 'blank').map((b) => b.kind);
  assert.deepEqual(kinds, ['capo', 'comment', 'stanza', 'stanza', 'chorus']);   // the chord-only intro line is a stanza of its own
  const stanza = song.tunes[0].blocks.filter((b) => b.kind === 'stanza');
  assert.equal(stanza[1].number, '1');
  assert.equal(stanza[1].lines.length, 2);
  assert.equal(song.tunes[0].blocks.find((b) => b.kind === 'chorus').lines.length, 2);
});

test('rule 1: a chord sits before its syllable, even mid-word', () => {
  const line = P.parse('A[G]mazing [C]grace\nex[F]act').tunes[0].blocks[0].lines;
  assert.deepEqual(line[0].segments.map((s) => [s.chord, s.text]), [[null, 'A'], ['G', 'mazing '], ['C', 'grace']]);
  assert.deepEqual(line[1].segments.map((s) => [s.chord, s.text]), [[null, 'ex'], ['F', 'act']]);
});

test('rule 3: several chords in one bracket are one label and all of them transpose', () => {
  const line = P.parse('[G  C  D  G]').tunes[0].blocks[0].lines[0];
  assert.equal(line.segments.length, 1);
  assert.equal(line.segments[0].chord, 'G  C  D  G');
  assert.equal(M.transposeText('[G  C  D  G]', { semitones: 2 }), '[A  D  E  A]');
});

test('rule 6: a verse number is digits only; "1." is just a lyric', () => {
  assert.equal(P.parse('1\nA[G]b').tunes[0].blocks[0].number, '1');
  const dotted = P.parse('1.\nA[G]b').tunes[0].blocks[0];
  assert.equal(dotted.number, null);
  assert.equal(dotted.lines[0].segments[0].text, '1.');
});

test('rule 7: exactly the lines that start with two spaces are the chorus, chord lines included', () => {
  const t = P.parse('1\nVerse line\n\n  [C]Chorus line\n  Second').tunes[0].blocks.filter((b) => b.kind !== 'blank');
  assert.deepEqual(t.map((b) => b.kind), ['stanza', 'chorus']);
  assert.equal(t[1].lines.length, 2);
  assert.equal(t[1].lines[0].segments[0].chord, 'C');
});

test('rule 9: # makes a comment, ### in mid-song starts a new tune, and Title lines are plain comments', () => {
  const ok = P.parse('[G]a\n\n# Bridge\n[C]b').tunes[0].blocks.filter((b) => b.kind !== 'blank').map((b) => b.kind);
  assert.deepEqual(ok, ['stanza', 'comment', 'stanza']);
  assert.equal(P.parse('[G]a\n\n### Chorus\n[C]b').tunes.length, 2);
  assert.equal(P.parse('# Title: X').tunes[0].blocks[0].kind, 'comment');
  assert.equal(P.parse('# Capo 3').tunes[0].blocks[0].kind, 'capo');
  assert.equal(P.parse('# Key: Em').tunes[0].blocks[0].kind, 'key');
});

// ---- reading a reply ------------------------------------------------------------------------

test('parseReply: header inside the code block, chatter outside', () => {
  const r = A.parseReply('Sure! Here it is:\n\n' + fence(A.EXAMPLE_REPLY) + '\n\nHope that helps.');
  assert.equal(r.title, 'Morning Light');
  assert.equal(r.author, 'A. Example');
  assert.equal(r.fenced, true);
  assert.ok(r.text.startsWith('# Capo 3'), r.text.slice(0, 20));
  assert.ok(!/Title|Hope|Sure/.test(r.text));
});

test('parseReply: language tags, tildes, Windows line endings, an unclosed fence', () => {
  assert.equal(A.parseReply('```text\n# Title: A\n[G]x\n```').text, '[G]x');
  assert.equal(A.parseReply('~~~\n# Title: A\n[G]x\n~~~').title, 'A');
  assert.equal(A.parseReply('```\r\n# Title: A\r\n[G]x\r\n```\r\n').text, '[G]x');
  const cut = A.parseReply('```\n# Title: A\n[G]x\n[C]y');
  assert.equal(cut.title, 'A');
  assert.equal(cut.text, '[G]x\n[C]y');
});

test('parseReply: the longest block is the song; title and author may sit outside it', () => {
  const r = A.parseReply('**Title:** Amazing Grace\nAuthor: John Newton\n\n```\n[G]one\n[C]two\n[D]three\n```\n\nNotes:\n```\nshort\n```');
  assert.equal(r.text, '[G]one\n[C]two\n[D]three');
  assert.equal(r.title, 'Amazing Grace');
  assert.equal(r.author, 'John Newton');
});

test('parseReply: no fence, header at the top, lowercase and spacing tolerated', () => {
  const r = A.parseReply('#title : Plain Song\n# author: J. Doe\n# Artist: R. Roe\n\n[G]la');
  assert.equal(r.title, 'Plain Song');
  assert.equal(r.author, 'J. Doe, R. Roe');
  assert.equal(r.text.trim(), '[G]la');
  assert.equal(r.fenced, false);
});

test('parseReply: credit comments such as "# Words:" are ordinary comments and stay in the song', () => {
  const song = '# Words: John Newton (1779), public domain\n# Music: traditional\n# Composer: J. Doe\n# By: someone\n\n1\n[G]la';
  const r = A.parseReply(song);
  assert.equal(r.title, null);
  assert.equal(r.author, null);
  assert.equal(r.text, song);
  const both = A.parseReply(fence(['# Title: T', '# Words: W. Riter', '# Author: A. Uthor', '', '[G]la']));
  assert.equal(both.author, 'A. Uthor');
  assert.equal(both.text, '# Words: W. Riter\n\n[G]la');
});

test('parseReply: empty and placeholder headers vanish; real comments and later lines stay', () => {
  const r = A.parseReply(fence(['# Title: Real', '# Author:', '# Key: <only if stated>', '# Capo <number>', '', '[G]la', '# Author: mid-song is a comment']));
  assert.equal(r.title, 'Real');
  assert.equal(r.author, null);
  assert.equal(r.text.trim(), '[G]la\n# Author: mid-song is a comment');
  assert.equal(A.parseReply('# Title: <the song title>\n[G]la').title, null);
  assert.equal(A.parseReply('# Author: Unknown\n[G]la').author, null);
});

test('parseReply: a bare "Music:" or "Words:" at the top of lyrics is not taken for a header', () => {
  const r = A.parseReply('Music: soft and low\n[G]la');
  assert.equal(r.author, null);
  assert.ok(r.text.startsWith('Music: soft'));
});

test('parseReply: never throws on odd input', () => {
  for (const v of [null, undefined, '', '   ', '```', '``````', 42, '\ufeff# Title: A\n[G]b']) assert.doesNotThrow(() => A.parseReply(v));
  assert.equal(A.parseReply('\ufeff# Title: A\n[G]b').title, 'A');
});

// ---- tidying labels -------------------------------------------------------------------------

test('tidyLabels: assistants\' section labels become Songsheets markers', () => {
  const cases = [
    ['[Verse 1]', '1'], ['Verse 2:', '2'], ['**Verse 3**', '3'], ['VERSE 4', '4'], ['## Verse 5', '5'], ['### Verse 6', '6'],
    ['1.', '1'], ['(2)', '2'], ['3)', '3'],
    ['[Chorus]', '# Chorus'], ['Chorus:', '# Chorus'], ['CHORUS', '# Chorus'], ['[Pre-Chorus]', '# Pre-chorus'], ['Bridge', '# Bridge'],
    ['[Bridge 2]', '# Bridge 2'], ['Chorus (x2)', '# Chorus (x2)'], ['[Intro]', '# Intro'], ['Outro', '# Outro'], ['Verse', '# Verse']
  ];
  for (const [from, to] of cases) assert.equal(A.tidyLabels(from).text, to, from);
});

test('tidyLabels: "# Verse 2" above a verse becomes its number, but never doubles one up', () => {
  assert.equal(A.tidyLabels('# Verse 2\n[G]Line').text, '2\n[G]Line');
  assert.equal(A.tidyLabels('# verse 3:\n[G]Line').text, '3\n[G]Line');
  assert.equal(A.tidyLabels('# Verse 2\n\n[G]Line').text, '# Verse 2\n\n[G]Line');         // a blank line would strand the number
  assert.equal(A.tidyLabels('# Verse 2\n2\n[G]Line').text, '# Verse 2\n2\n[G]Line');       // already numbered
  assert.equal(A.tidyLabels('# Verse 2\n# Capo 3\n[G]Line').text, '# Verse 2\n# Capo 3\n[G]Line');
  assert.equal(A.tidyLabels('# Verse 2\n[G]Line').changed, 1);
});

test('parseReply: credit labels are cleaned out of the author', () => {
  const author = (line) => A.parseReply('# Title: T\n# Author: ' + line + '\n[G]x').author;
  assert.equal(author('Words: A. Example · Music: traditional'), 'A. Example, traditional');
  assert.equal(author('Words and Music by J. Sample'), 'J. Sample');
  assert.equal(author('Music by R. Roe; words by J. Doe'), 'R. Roe, J. Doe');
  assert.equal(author('John Newton'), 'John Newton');
  assert.equal(author('Music-Man Productions'), 'Music-Man Productions');     // a hyphen is not a label
  assert.equal(A.parseReply('# Title: T\n# Author: Words:\n[G]x').author, null);
});

test('tidyLabels: leaves real content alone', () => {
  for (const same of [
    '[G]', '[Am]', '[F#m  Bm]', '[N.C.]', '[x2]', '[G]Chorus of angels', 'Verse of the day is short', 'Bridge over troubled water',
    '# Chorus', '# Verse 2', '  [C]indented chorus', '12', '1', 'Intro: G  C  G', '[Intro: G C D]', '[Coda]x', '[A]', '[E]'
  ]) assert.equal(A.tidyLabels(same).text, same, same);
  assert.equal(A.tidyLabels('[G]a\n[Chorus]\n[C]b').changed, 1);
});

// ---- analysing ------------------------------------------------------------------------------

test('analyse: the prompt\'s own example reply comes back complete and warning-free', () => {
  const r = A.analyse(fence(A.EXAMPLE_REPLY));
  assert.equal(r.title, 'Morning Light');
  assert.equal(r.author, 'A. Example');
  assert.equal(r.kind, 'songbase-text');
  assert.deepEqual(r.notes, []);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.stats, { lines: 5, chords: 13, tunes: 1, key: 'G' });
  assert.equal(r.lyrics.split('\n')[0], '# Capo 3');
  assert.ok(!/Title|Author/.test(r.lyrics));
});

test('analyse: chords written above the words are moved into the lines', () => {
  const r = A.analyse(['Verse 1', 'G    C', 'Sing along', '', 'Chorus', 'D', 'Loud'].join('\n'));
  assert.equal(r.kind, 'two-line');
  assert.equal(r.lyrics, '1\n[G]Sing [C]along\n\n# Chorus\n[D]Loud');
  assert.ok(r.notes.some((n) => /above the words/.test(n)));
  assert.ok(r.notes.some((n) => /2 section labels/.test(n)));
  assert.equal(r.stats.chords, 3);
});

test('analyse: ChordPro is converted, with its title, artist and key', () => {
  const r = A.analyse('{title: Test Song}\n{artist: Someone}\n{key: G}\n\n{start_of_chorus}\n[G]La la [C]la\n{end_of_chorus}');
  assert.equal(r.kind, 'chordpro');
  assert.equal(r.title, 'Test Song');
  assert.equal(r.author, 'Someone');
  assert.equal(r.lyrics, '# Key: G\n\n  [G]La la [C]la');
  assert.ok(r.notes.some((n) => /ChordPro/.test(n)));
  assert.equal(A.analyse('# Title: Mine\n{title: Theirs}\n[G]x').title, 'Mine');
});

test('analyse: a lazy answer (no fence, label styles, ### headings) is put right', () => {
  const r = A.analyse('Title: Some Hymn\nAuthor: A. Writer\n\n### Verse 1\n[G]Line one\n[C]Line two\n\nChorus:\n  [D]Sing it\n\n2.\n[G]Line three');
  assert.equal(r.title, 'Some Hymn');
  assert.equal(r.author, 'A. Writer');
  assert.equal(r.lyrics, '1\n[G]Line one\n[C]Line two\n\n# Chorus\n  [D]Sing it\n\n2\n[G]Line three');
  assert.equal(r.stats.tunes, 1);
  assert.deepEqual(r.warnings, []);
});

test('analyse: warnings for the failures worth knowing about', () => {
  const none = A.analyse(fence(['# Title: Plain', '', '1', 'Just words']));
  assert.ok(none.warnings.some((w) => /No chords were found/.test(w)));
  const tunes = A.analyse('[G]a\n\n### Second melody\n[C]b');
  assert.equal(tunes.stats.tunes, 2);
  assert.ok(tunes.warnings.some((w) => /2 tunes/.test(w)));
  const open = A.analyse('[G]fine\n[C oops\nand] more');
  assert.ok(open.warnings.some((w) => /2 lines have a square bracket without a partner/.test(w)), open.warnings.join('|'));
  const loose = A.analyse('[G]one\nG   C   D\n[C]two');
  assert.ok(loose.warnings.some((w) => /still looks like chords written above/.test(w)), loose.warnings.join('|'));
  const many = A.analyse('{title: A}\n[G]x\n{new_song}\n{title: B}\n[C]y');
  assert.equal(many.title, 'A');
  assert.ok(many.warnings.some((w) => /2 songs/.test(w)));
});

test('analyse: empty or unreadable input gives an empty result, never an exception', () => {
  for (const v of [null, '', '  \n ', '```\n```']) {
    const r = A.analyse(v);
    assert.equal(r.kind, 'empty');
    assert.equal(r.lyrics, '');
    assert.deepEqual(r.stats, { lines: 0, chords: 0, tunes: 0, key: null });
  }
  assert.doesNotThrow(() => A.analyse('\u0000\u0001binary?'));
});

test('analyse: a finished song survives a round trip through the reader unchanged', () => {
  const song = ['# Capo 2', '', '1', 'A[G]mazing [C]grace, how [D]sweet', 'That [Em]saved a wretch', '', '  [C]Chorus [G]words'].join('\n');
  const r = A.analyse(fence(['# Title: T', ''].concat(song.split('\n'))));
  assert.equal(r.lyrics, song);
  assert.deepEqual(r.notes, []);
});

// ---- data safety: a valid song pasted into the box must come back unchanged --------------------------------

function everySongInTheRepo() {
  const root = path.join(__dirname, '..', '..');
  const songs = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.txt$/.test(e.name) && !/expected|golden/.test(e.name)) songs.push({ name: path.relative(root, p), text: fs.readFileSync(p, 'utf8') });
  });
  walk(path.join(root, 'tests', 'fixtures'));
  require('../fixtures/sample-songs.js').forEach((s) => songs.push({ name: 'sample: ' + s.title, text: s.lyrics }));
  JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'export', 'songbase-api.json'), 'utf8')).songs
    .forEach((s) => songs.push({ name: 'songbase: ' + s.title, text: s.lyrics }));
  return songs;
}

test('every song in the repo survives the reader unchanged: plain, in a code block, with Windows line endings', () => {
  const songs = everySongInTheRepo();
  assert.ok(songs.length >= 10, 'found ' + songs.length + ' songs');
  for (const s of songs) {
    const want = N.normalizeText(s.text);
    const unix = N.normalizeLineEndings(s.text);
    assert.equal(A.analyse(s.text).lyrics, want, s.name + ' (plain)');
    assert.equal(A.analyse('```\n' + unix + '\n```').lyrics, want, s.name + ' (fenced)');
    assert.equal(A.analyse(unix.replace(/\n/g, '\r\n')).lyrics, want, s.name + ' (CRLF)');
  }
});

test('ordinary lyric lines that look a little like labels are left alone', () => {
  for (const line of ['Bridge over troubled water', 'Verse of the day', 'Chorus of angels sing', 'Intro to the story', 'Solo flights above', '10', '1', '2 by 2']) {
    assert.equal(A.analyse('[G]' + line + '\n' + line).lyrics, '[G]' + line + '\n' + line, line);
  }
});

// ---- what the reader must not lose or guess ----------------------------------------------------------------

test('fence look-alikes inside a pasted song never swallow lyrics', () => {
  const song = '# Capo 2\n\n1\n[G]Line one\n[C]Line two\n\n~~~\n\n2\n[D]Line three\n[G]Line four';
  const r = A.analyse(song);
  assert.deepEqual(r.lyrics.split('\n').filter((l) => l.trim()), song.split('\n').filter((l) => l.trim() && l !== '~~~'));
  assert.equal(r.stats.lines, 4);
  const sep = '[G]Intro\n~~~ Interlude ~~~\n[C]After';
  assert.equal(A.analyse(sep).lyrics, sep);
  const ticks = '[G]before\n```\n[C]after';
  assert.equal(A.analyse(ticks).lyrics, '[G]before\n[C]after');
});

test('a reply that was cut off still works, but only when its fence opens at the top', () => {
  const cut = A.parseReply('Here you go:\n```\n# Title: A\n[G]x\n[C]y');
  assert.equal(cut.title, 'A');
  assert.equal(cut.text, '[G]x\n[C]y');
  const midSong = A.parseReply('[G]one\n[C]two\n[D]three\n```\n[G]four');
  assert.equal(midSong.fenced, false);
  assert.equal(midSong.text, '[G]one\n[C]two\n[D]three\n[G]four');
});

test('several code blocks: the longest is used and the rest are reported, never dropped silently', () => {
  const reply = 'Verse 1:\n```\n1\n[G]One\n[C]Two\n```\nChorus:\n```\n  [D]Sing\n  [G]Loud\n```\nVerse 2:\n```\n2\n[G]Three\n[C]Four\n```';
  const r = A.analyse(reply);
  assert.equal(r.stats.lines, 2);
  assert.ok(r.warnings.some((w) => /2 other code blocks were left out/.test(w)), r.warnings.join('|'));
  // a one-line remark in a second block is not song text: no fuss
  const remark = A.analyse('```\n# Title: T\n[G]a\n[C]b\n```\nNotes:\n```\nbe careful\n```');
  assert.deepEqual(remark.warnings, []);
});

test('chords in the chatter around the block are reported', () => {
  const r = A.analyse('Verse 3 is [G]missing so I added it below:\n```\n[C]song\n[D]text\n```\nExtra: [Em]more [A]chords');
  assert.ok(r.warnings.some((w) => /outside the code block contain chords/.test(w)), r.warnings.join('|'));
  assert.deepEqual(A.analyse(fence(['[C]song', '[D]text'])).warnings, []);
});

test('a copied chat (prompt included) uses the assistant\'s reply, not the prompt\'s worked example', () => {
  const chat = A.PROMPT + '\n```\n# Title: Short\n\n[G]Hi\n```\n';
  const r = A.analyse(chat);
  assert.equal(r.title, 'Short');
  assert.equal(r.lyrics, '[G]Hi');
  assert.deepEqual(r.warnings, [], 'the prompt\'s own bracket examples are not "chords left out"');
  // converting the example song itself (the only block) still works
  assert.equal(A.analyse(fence(A.EXAMPLE_REPLY)).title, 'Morning Light');
});

test('"# Check:" notes are surfaced, and one that mentions a capo does not become a capo setting', () => {
  const r = A.analyse(fence(['# Title: T', '# Check: is the second word "grace" or "graze"?', '1', '[G]Amazing grace', '', '# Check: capo 2 or 3?', '  [C]Chorus']));
  assert.deepEqual(r.flags, ['is the second word "grace" or "graze"?', 'capo number 2 or 3?']);
  const kinds = P.parse(r.lyrics).tunes[0].blocks.map((b) => b.kind);
  assert.ok(!kinds.includes('capo'), kinds.join(','));
  assert.deepEqual(A.analyse(fence(['[G]a'])).flags, []);
});
