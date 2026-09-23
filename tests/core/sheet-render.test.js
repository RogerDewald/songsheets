'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../../js/core/sheetModel.js');
const R = require('../../js/core/render.js');
const S = require('../../js/core/search.js');

const fixture = (f) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', f), 'utf8');
const html = (lyrics, opts = {}, renderOpts = {}) => R.toHTML(R.render(M.buildSheet({ id: 's1', title: 'T', lyrics }, opts), renderOpts));

test('songbase line structure', () => {
  assert.equal(
    html('[G]Alpha [C]beta and gamma'),
    '<div class="lyrics"><div class="stanza"><div class="line"><span class="chord-word"><span class="chord" data-uncopyable-text="G"></span>Alpha</span> <span class="chord-word"><span class="chord" data-uncopyable-text="C"></span>beta</span> and gamma</div></div></div>'
  );
});

test('chord-word grouping follows songbase', () => {
  const out = html('Word end[A7].\n[G][D]stacked\nex[F]act\n[G]   [D]');
  assert.match(out, /Word <span class="chord-word">end<span class="chord" data-uncopyable-text="A7"><\/span>\.<\/span>/);
  assert.match(out, /<span class="chord-word"><span class="chord" data-uncopyable-text="G"><\/span><span class="chord" data-uncopyable-text="D"><\/span>stacked<\/span>/);
  assert.match(out, /<span class="chord-word">ex<span class="chord" data-uncopyable-text="F"><\/span>act<\/span>/);
  assert.match(out, /<span class="chord-word"><span class="chord" data-uncopyable-text="G"><\/span><\/span>   <span class="chord-word"><span class="chord" data-uncopyable-text="D"><\/span><\/span>/);
});

test('stanza numbers, chorus tab, comments and capo preset', () => {
  const out = html('# Capo 2\n\n1\n[G]Line\n\n  [C]Chorus');
  assert.match(out, /^<div class="lyrics"><div class="transpose-preset comment" data-capo="2" role="button" tabindex="0"/);
  assert.match(out, /<div class="stanza"><div class="stanza-number with-chords" data-uncopyable-text="1"><\/div>/);
  assert.match(out, /<div class="chorus"><div class="line">\t<span class="chord-word">/);
  assert.match(out, /<br>/);
});

test('user text is escaped everywhere', () => {
  const out = html('# <img src=x onerror=alert(1)>\n<b>"hi"</b> & [x\' onmouseover=\'y]z');
  assert.ok(!out.includes('<img'));
  assert.ok(!out.includes('<b>"hi"'));
  assert.ok(out.includes('&lt;b&gt;&quot;hi&quot;') || out.includes('&lt;b&gt;"hi"'));
  assert.ok(out.includes('data-uncopyable-text="x&#39; onmouseover=&#39;y"'));
});

test('capo preset toggles to sounding chords', () => {
  const sheet = M.buildSheet({ lyrics: '# Capo 3\n[G]One [C]two [G]three' }, { transpose: 3 });
  assert.equal(sheet.capo.active, true);
  assert.equal(sheet.blocks[0].active, true);
  assert.equal(sheet.blocks[1].lines[0].segments[0].chord, 'Bb');
  assert.equal(sheet.targetKeyLabel, 'Bb');
});

test('set-list capo override shows shapes', () => {
  const sheet = M.buildSheet({ lyrics: '[A]One [D]two [A]three' }, { transpose: 0, capoOverride: 2 });
  assert.equal(sheet.capo.source, 'override');
  assert.equal(sheet.displayTranspose, 10);
  assert.deepEqual(M.sheetChords(sheet), ['G', 'C']);
  assert.equal(sheet.targetKeyLabel, 'G');
});

test('hidden chords remove music but keep lyrics', () => {
  const sheet = M.buildSheet({ lyrics: '# Capo 2\n\n# Original tune\n# Intro: [G] [C]\n1\n[G]   [D]\n[G]Alpha [C]beta' }, { showChords: false });
  assert.deepEqual(sheet.blocks.map((b) => b.kind), ['comment', 'stanza']);
  assert.equal(sheet.blocks[0].text, 'Intro:  ');
  assert.equal(sheet.blocks[1].lines.length, 1);
  assert.equal(sheet.blocks[1].lines[0].segments[0].text, 'Alpha beta');
  const out = R.toHTML(R.render(sheet));
  assert.ok(!out.includes('chord-word'));
  assert.ok(out.includes('class="lyrics no-chords"'));
});

test('comment chords are transposed and key comments follow the target key', () => {
  const sheet = M.buildSheet({ lyrics: '# Key: G\n# Intro: [G] [C]\n[G]Hi [D]there [G]now' }, { transpose: 2 });
  assert.equal(sheet.blocks[0].text, 'Key: A');
  assert.equal(sheet.blocks[1].text, 'Intro: [A] [D]');
});

test('uncopyableChords:false emits real text', () => {
  const out = html('1\n[G]Hi', {}, { uncopyableChords: false });
  assert.ok(out.includes('<span class="chord">G</span>'));
  assert.ok(out.includes('<div class="stanza-number with-chords">1</div>'));
});

test('tunes: selection, titles, source text', () => {
  const song = { lyrics: fixture('multitune.txt') };
  const t0 = M.buildSheet(song);
  const t1 = M.buildSheet(song, { tuneIndex: 1 });
  assert.equal(t0.tuneCount, 2);
  assert.deepEqual(t0.tuneTitles, ['Original tune', 'Second tune']);
  assert.equal(t1.tuneTitle, 'Second tune');
  assert.equal(t1.key.major, 'D');
  assert.ok(t1.source.text.startsWith('1\n[D]Morning'));
  assert.equal(M.buildSheet(song, { tuneIndex: 9 }).tuneIndex, 1);
});

test('toPlainLyrics', () => {
  const sheet = M.buildSheet({ lyrics: '# c\n1\n[G]Alpha [D]beta\n\n  [C]Chorus\n   deep' });
  assert.equal(M.toPlainLyrics(sheet), '1\nAlpha beta\n\n  Chorus\n   deep');
});

test('transposeText rewrites only bracket contents', () => {
  const src = fixture('multitune.txt').replace(/\n/g, '\r\n') + '\r\n\r\n';
  assert.equal(M.transposeText(src, { semitones: 0 }), src);
  const up = M.transposeText(src, { semitones: 1 });
  assert.equal(up.replace(/\[[^\]]*\]/g, '[]'), src.replace(/\[[^\]]*\]/g, '[]'));
  assert.ok(up.includes('[Ab]Morning light is [Db]on the [Ab]hill,'));
  assert.ok(up.includes('[Eb]Morning light is [Ab]on the [Eb]hill,'));
  const onlySecond = M.transposeText(src, { semitones: 1, tuneIndex: 1 });
  assert.ok(onlySecond.includes('[G]Morning light is [C]on'));
  assert.ok(onlySecond.includes('[Eb]Morning'));
  const keyed = M.transposeText('# Key: G\n[G]a [C]b', { semitones: 2, updateKeyComment: true });
  assert.equal(keyed, '# Key: A\n[A]a [D]b');
});

test('example fixture golden HTML', () => {
  const golden = path.join(__dirname, '..', 'fixtures', 'example.golden.html');
  const out = R.toHTML(R.render(M.buildSheet({ lyrics: fixture('example.txt') })));
  if (process.env.UPDATE_GOLDENS || !fs.existsSync(golden)) fs.writeFileSync(golden, out + '\n');
  assert.equal(out + '\n', fs.readFileSync(golden, 'utf8'));
});

test('search normalisation and ranking', () => {
  assert.equal(S.normalizeForSearch('Él [G]dijo: “¡Sí!” — pa_ra'), 'EL DIJO ¡SI PA RA');
  const songs = [
    { id: 'a', title: 'Grace upon grace', lyrics: 'x' },
    { id: 'b', title: 'Amazing grace', lyrics: 'y' },
    { id: 'c', title: 'Other', lyrics: 'full of gr[G]ace' },
    { id: 'd', title: 'None', lyrics: 'nothing' }
  ];
  assert.deepEqual(S.searchSongs(songs, 'grace').map((r) => r.song.id), ['a', 'b', 'c']);
  assert.doesNotThrow(() => S.searchSongs(songs, 'a+b ( [ *'));
  assert.deepEqual(S.searchSongs(songs, '').map((r) => r.song.id), ['b', 'a', 'd', 'c']);
});

test('source files contain no raw invisible characters', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
  const root = path.join(__dirname, '..', '..');
  const files = walk(path.join(root, 'js')).concat(walk(path.join(root, 'tests')), walk(path.join(root, 'tools')));
  assert.ok(files.length > 5);
  const bad = /[\u2028\u2029\ufeff\u00a0\u200b-\u200d\u0300-\u036f]/;
  for (const f of files) assert.ok(!bad.test(fs.readFileSync(f, 'utf8')), f + ' has a raw invisible character; run python tools/fix-escapes.py');
});
