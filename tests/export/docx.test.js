'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../../js/core/sheetModel.js');
const DM = require('../../js/export/docxModel.js');
const DX = require('../../js/export/docxExport.js');
const readZipEntry = require('./zip.js');

const fx = (f) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'export', f), 'utf8');
const sheet = (title, lyrics, opts) => M.buildSheet({ id: title, title, lyrics }, opts);
const docxPath = path.join(__dirname, '..', '..', 'vendor', 'docx.umd.js');

test('paragraph pairs share the text export columns; keepNext holds chords and blocks together', () => {
  const model = DM.buildDocxModel([sheet('Amazing Grace', fx('amazing.txt'))]);
  const ps = model.songs[0].paragraphs;
  assert.deepEqual(ps.map((p) => p.kind), ['chord', 'lyric', 'chord', 'lyric', 'blank', 'chord', 'lyric']);
  assert.deepEqual(ps.map((p) => p.keepNext), [true, true, true, false, false, true, false]);
  assert.deepEqual(ps.map((p) => p.number || null), [null, '1', null, null, null, null, null]);
  assert.deepEqual(ps.map((p) => p.text), [
    'G                  C         G',
    'Amazing grace, how sweet the sound',
    '                  D',
    'The bleeding Sacrifice',
    '',
    'C      G',
    'Praise God'
  ]);
  assert.deepEqual(ps.map((p) => p.left), [462, 462, 462, 462, 462, 693, 693]);
  assert.equal(model.songs[0].meta, 'Key: G');
  assert.equal(model.toc, null);
  assert.equal(model.songs[0].pageBreakBefore, false);
  assert.deepEqual(model.page, { width: 11906, height: 16838, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134, footer: 567 } });
});

test('comments, capo lines, bold runs, B/W and Letter', () => {
  const model = DM.buildDocxModel([sheet('S', '# Capo 2\n# **Loud** note\n\n[G]One **two**')], { bw: true, pageSize: 'Letter', fontScale: 2 });
  const ps = model.songs[0].paragraphs;
  assert.deepEqual(ps.map((p) => p.kind), ['comment', 'comment', 'blank', 'chord', 'lyric']);
  assert.deepEqual(ps[1].runs, [{ text: 'Loud', bold: true, italic: false }, { text: ' note', bold: false, italic: false }]);
  assert.deepEqual(ps[4].runs, [{ text: 'One ', bold: false, italic: false }, { text: 'two', bold: true, italic: false }]);
  assert.deepEqual([model.colors.chord, model.chordBold, model.page.width, model.sizes.mono], ['000000', true, 12240, 42]);
  const active = DM.buildDocxModel([sheet('S', '# Capo 2\n\n[G]One', { transpose: 2 })]);
  assert.ok(!active.songs[0].paragraphs.some((p) => /Capo/.test(p.text)), 'an active capo preset is not a capo to fit');
  assert.equal(active.songs[0].paragraphs[0].kind, 'chord', 'and leaves no blank behind');
});

test('a block taller than a page holds only its first and last two lines together', () => {
  const lines = Array.from({ length: 60 }, (_, i) => '[G]line ' + i).join('\n');
  const ps = DM.buildDocxModel([sheet('Long', lines)]).songs[0].paragraphs.filter((p) => p.kind === 'lyric');
  assert.equal(ps.length, 60);
  const keeps = ps.map((p, i) => (p.keepNext ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(keeps, [0, 58]);
  const short = DM.buildDocxModel([sheet('Short', Array.from({ length: 10 }, (_, i) => '[G]l' + i).join('\n'))]).songs[0].paragraphs;
  assert.equal(short.filter((p) => p.kind === 'lyric' && p.keepNext).length, 9);
});

test('a line wider than the page is wrapped into aligned pairs, not left for Word to break', () => {
  const long = '[G]' + Array.from({ length: 30 }, (_, i) => 'word' + i).join(' ') + ' [C]end';
  const ps = DM.buildDocxModel([sheet('W', '1\n' + long)]).songs[0].paragraphs;
  const lyrics = ps.filter((p) => p.kind === 'lyric');
  assert.ok(lyrics.length >= 3);
  lyrics.forEach((p) => assert.ok(p.text.length <= 72, p.text.length + ': ' + p.text));
  assert.equal(lyrics.filter((p) => p.number).length, 1, 'the stanza number stays on the first row');
  assert.deepEqual(lyrics.map((p) => p.keepNext), lyrics.map((p, i) => i < lyrics.length - 1));
  assert.equal(lyrics.map((p) => p.text).join(' '), Array.from({ length: 30 }, (_, i) => 'word' + i).join(' ') + ' end');
  const last = ps[ps.length - 2];
  assert.equal(last.kind, 'chord');
  assert.ok(/C$/.test(last.text));
});

test('a set: linked contents, a page break before every song, set name in the footer', () => {
  const songs = { a: { id: 'a', title: 'Alpha', lyrics: '[G]a' }, b: { id: 'b', title: 'Beta', lyrics: '[A]b' } };
  const set = { id: 's', name: 'Evening', items: [{ songId: 'a' }, { songId: 'b', capo: 2 }] };
  const model = DM.buildDocxModel(M.buildSetSheets(set, (id) => songs[id]));
  assert.deepEqual(model.toc, {
    title: 'Evening',
    entries: [
      { title: 'Alpha', meta: 'G', bookmark: 'song_1', number: 1 },
      { title: 'Beta', meta: 'G · Capo 2', bookmark: 'song_2', number: 2 }
    ]
  });
  assert.deepEqual(model.songs.map((s) => s.pageBreakBefore), [true, true]);
  assert.equal(model.footer.text, 'Evening');
  assert.equal(model.title, 'Evening');
});

test('docx integration: a real .docx with the structure the model describes', { skip: !fs.existsSync(docxPath) }, async () => {
  const docx = require(docxPath);
  const songs = { a: { id: 'a', title: 'Amazing Grace', lyrics: fx('amazing.txt') }, b: { id: 'b', title: 'Glory', lyrics: fx('glory.txt') } };
  const set = { id: 's', name: 'Evening & more', items: [{ songId: 'a' }, { songId: 'b' }] };
  const sheets = M.buildSetSheets(set, (id) => songs[id]);
  const buf = await DX.buildDocxBuffer(sheets, {}, docx);
  assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK');
  const xml = readZipEntry(buf, 'word/document.xml');
  assert.ok(xml, 'has word/document.xml');
  const model = DM.buildDocxModel(sheets, {});
  const keepTrue = model.songs.reduce((n, s) => n + s.paragraphs.filter((p) => p.keepNext).length, 0) + model.songs.length;
  assert.equal((xml.match(/<w:keepNext\/>/g) || []).length, keepTrue);
  assert.equal((xml.match(/<w:bookmarkStart /g) || []).length, 2);
  assert.equal((xml.match(/<w:hyperlink [^>]*w:anchor="song_\d"/g) || []).length, 2);
  assert.equal((xml.match(/<w:pageBreakBefore\/>/g) || []).length, 2);
  assert.ok(xml.includes('<w:t xml:space="preserve">Evening &amp; more</w:t>'), 'text is XML-escaped');
  assert.ok(xml.includes('<w:t xml:space="preserve">G                  C         G</w:t>'), 'chord row kept verbatim');
  assert.ok(xml.includes('<w:ind w:left="462" w:hanging="462"/>'), 'stanza number hangs');
  const footer = readZipEntry(buf, 'word/footer1.xml');
  assert.match(footer, /PAGE/);
  assert.match(footer, /NUMPAGES/);
  const styles = readZipEntry(buf, 'word/styles.xml');
  assert.match(styles, /w:styleId="SongMono"[\s\S]*?w:ascii="Consolas"/);
  const blob = (await DX.exportDocx(sheets, {}, docx)).blob;
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.ok(blob.size > 5000);
});
