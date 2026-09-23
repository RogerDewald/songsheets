'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../../js/core/sheetModel.js');
const T = require('../../js/export/pdfText.js');
const L = require('../../js/export/pdfLayout.js');
const PE = require('../../js/export/pdfExport.js');

// a monospace stand-in for font metrics: every character is 0.6 em wide
const measure = (text, font) => Array.from(text).length * font.size * 0.6;
const CHORD = '#1f45ff';
const sheet = (lyrics, opts, extra) => M.buildSheet(Object.assign({ id: 's', title: 'Song', lyrics }, extra), opts);
const cfg = L.resolveConfig({});
const X0 = cfg.x0;
const LYRIC_W = 11 * 0.6;
const texts = (page) => page.ops.filter((o) => o.type === 'text');
const chords = (page) => texts(page).filter((o) => o.color === CHORD);
const lyricOp = (layout, text) => {
  for (let p = 0; p < layout.pages.length; p++) {
    const op = texts(layout.pages[p]).find((o) => o.text === text);
    if (op) return Object.assign({ page: p }, op);
  }
  return null;
};
const close = (a, b) => Math.abs(a - b) < 1e-6;

test('toWinAnsi keeps WinAnsi, maps what it can, counts what it drops', () => {
  assert.deepEqual(T.toWinAnsi('que‿en café ♯ 歌'), { text: 'que_en café # ?', dropped: 1 });
  assert.deepEqual(T.toWinAnsi('cafe\u0301 “quoted” – € … •'), { text: 'café “quoted” – € … •', dropped: 0 });
  assert.equal(T.toWinAnsi('Việt ř ő Ł').text, 'Viêt r o L');
  assert.deepEqual(T.toWinAnsi('Αλληλούια 😀'), { text: '????????? ?', dropped: 10 });
  assert.equal(T.toWinAnsi('a\u200bb\u00a0c\td').text, 'ab\u00a0c d');
  assert.equal(T.toWinAnsi('a‿b', { tieChar: '~' }).text, 'a~b');
  assert.equal(T.toWinAnsi('B♭m7 F♯').text, 'Bbm7 F#');
  for (const cp of T.WINANSI_EXTRA) assert.ok(T.isWinAnsi(cp));
  assert.ok(!T.isWinAnsi(0x80) && !T.isWinAnsi(0x9f) && !T.isWinAnsi(0x203f));
});

test('a chord is drawn at the x of its syllable', () => {
  const layout = L.layoutPdf([sheet('[G]Amazing grace, how [C]sweet\nThe bleeding Sacri[D]fice\n[G][D]stacked')], {}, measure);
  const cs = chords(layout.pages[0]);
  assert.deepEqual(cs.map((c) => c.text), ['G', 'C', 'D', 'G', 'D']);
  assert.ok(close(cs[0].x, X0));
  assert.ok(close(cs[1].x, X0 + 19 * LYRIC_W), 'C over "sweet"');
  assert.ok(close(cs[2].x, X0 + 18 * LYRIC_W), 'D over "fice"');
  assert.ok(close(cs[3].x, X0) && close(cs[4].x, X0), 'adjacent chords overlap, as in songbase');
  assert.ok(close(lyricOp(layout, 'Amazing grace, how sweet').x, X0));
  const spread = chords(L.layoutPdf([sheet('[G][D]stacked')], { avoidChordOverlap: true }, measure).pages[0]);
  assert.ok(close(spread[1].x, X0 + 2 * 10 * 0.6), 'avoidChordOverlap moves only the chord');
});

test('chords sit on a band above their lyric; lines without chords get no band', () => {
  const layout = L.layoutPdf([sheet('[G]One\nTwo\n[C]Three')], {}, measure);
  const one = lyricOp(layout, 'One');
  const two = lyricOp(layout, 'Two');
  const three = lyricOp(layout, 'Three');
  const [g, c] = chords(layout.pages[0]);
  assert.ok(g.y < one.y && one.y - g.y < cfg.chordH + cfg.lineH);
  assert.ok(close(two.y - one.y, cfg.lineH), 'no chord band on "Two"');
  assert.ok(close(three.y - two.y, cfg.lineH + cfg.chordH));
  assert.ok(c.y > two.y && c.y < three.y);
});

test('wrapping moves a word together with its chord; the new row starts at the margin', () => {
  const word = 'wordwordw';                                   // 9 characters; 8 words need 79 columns, a row holds 72
  const text = Array.from({ length: 7 }, (_, i) => word.slice(0, 8) + i).join(' ') + ' [E]' + word + ' [A]end';
  const layout = L.layoutPdf([sheet(text)], {}, measure);
  const cs = chords(layout.pages[0]);
  const rows = texts(layout.pages[0]).filter((o) => o.color === '#000000' && o.font.size === 11);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].text, word + ' end');
  assert.ok(close(rows[1].x, X0), 'no hanging indent');
  const e = cs.find((c) => c.text === 'E');
  const a = cs.find((c) => c.text === 'A');
  assert.ok(close(e.x, X0), 'the chord moved with its word');
  assert.ok(close(a.x, X0 + 10 * LYRIC_W));
  assert.ok(e.y > rows[0].y && e.y < rows[1].y, 'on the second row\'s chord band');
  const long = L.layoutPdf([sheet('x'.repeat(100))], {}, measure);
  assert.equal(long.warnings.length, 1, 'an unbreakable word is split and reported');
});

test('stanza numbers hang in the gutter on the first lyric row; choruses are indented', () => {
  const layout = L.layoutPdf([sheet('1\n[G]First\nSecond\n\n  Chorus\n   deeper')], {}, measure);
  const num = lyricOp(layout, '1');
  assert.ok(close(num.x, cfg.margin.left));
  assert.ok(close(num.y, lyricOp(layout, 'First').y));
  assert.ok(close(lyricOp(layout, 'Chorus').x, X0 + cfg.chorusIndent));
  assert.ok(close(lyricOp(layout, 'deeper').x, X0 + cfg.chorusIndent + LYRIC_W));
});

function stanza(prefix, n) {
  return Array.from({ length: n }, (_, i) => prefix + (i + 1)).join('\n');
}
function linesPerPage(layout, prefix) {
  return layout.pages.map((p) => texts(p).filter((o) => new RegExp('^' + prefix + '\\d+$').test(o.text)).length);
}

test('a stanza that fits on a page is moved whole to the next page', () => {
  const layout = L.layoutPdf([sheet(stanza('A', 40) + '\n\n' + stanza('B', 10))], {}, measure);
  assert.deepEqual(linesPerPage(layout, 'A'), [40, 0]);
  assert.deepEqual(linesPerPage(layout, 'B'), [0, 10]);
  const firstB = lyricOp(layout, 'B1');
  assert.ok(close(firstB.y - cfg.fs * 0.95, cfg.margin.top), 'no gap at the top of the new page');
});

test('a stanza taller than a page splits with at least two lines on each side', () => {
  for (let before = 0; before <= 52; before += 1) {
    const text = (before ? stanza('A', before) + '\n\n' : '') + stanza('L', 70);
    const layout = L.layoutPdf([sheet(text)], {}, measure);
    const counts = linesPerPage(layout, 'L').filter((n) => n > 0);
    assert.equal(counts.reduce((a, b) => a + b, 0), 70);
    counts.forEach((n) => assert.ok(n >= 2, 'before=' + before + ' counts=' + counts));
  }
  // the natural split would leave one line over: it leaves two
  const probe = linesPerPage(L.layoutPdf([sheet(stanza('L', 200))], {}, measure), 'L');
  const fit = probe[0];
  const tight = linesPerPage(L.layoutPdf([sheet(stanza('L', fit + 1))], {}, measure), 'L');
  assert.deepEqual(tight, [fit - 1, 2]);
});

test('a comment is kept with the stanza after it', () => {
  const probe = linesPerPage(L.layoutPdf([sheet(stanza('A', 200))], {}, measure), 'A')[0];
  const layout = L.layoutPdf([sheet(stanza('A', probe - 2) + '\n# Chorus follows\n  C1\n  C2')], {}, measure);
  const comment = lyricOp(layout, 'Chorus follows');
  assert.equal(comment.page, lyricOp(layout, 'C1').page);
  assert.equal(comment.page, 1);
});

test('set list: contents page with page numbers and links, a new page per song, footers, outline', () => {
  const songs = [
    { id: 'a', title: 'Alpha', lyrics: stanza('A', 70) },
    { id: 'b', title: 'Beta', lyrics: '# Capo 2\n[G]Beta' },
    { id: 'c', title: 'Gamma', lyrics: '[A]Gamma' }
  ];
  const set = { id: 'set', name: 'Evening', items: songs.map((s) => ({ songId: s.id })) };
  const sheets = M.buildSetSheets(set, (id) => songs.find((s) => s.id === id));
  const layout = L.layoutPdf(sheets, {}, measure);
  const n = layout.pages.length;
  assert.deepEqual(layout.songs.map((s) => [s.title, s.firstPage]), [['Alpha', 2], ['Beta', 4], ['Gamma', 5]]);
  assert.equal(n, 5);
  const toc = layout.pages[0];
  const links = toc.ops.filter((o) => o.type === 'link');
  assert.deepEqual(links.map((l) => l.page), [2, 4, 5]);
  const tocText = texts(toc).map((o) => o.text);
  assert.ok(['Evening', '1.', 'Alpha', '2', '2.', 'Beta', 'G · Capo 2', '4', '3.', 'Gamma', 'A', '5'].every((t) => tocText.includes(t)), tocText.join('|'));
  links.forEach((l, i) => {
    const num = texts(toc).find((o) => o.text === String(layout.songs[i].firstPage) && o.y > l.y && o.y < l.y + l.h);
    assert.ok(num, 'the page number sits inside its link');
  });
  layout.pages.forEach((p, i) => assert.ok(texts(p).some((o) => o.text === (i + 1) + ' / ' + n), 'footer on page ' + (i + 1)));
  assert.ok(texts(layout.pages[3]).some((o) => o.text === 'Beta'), 'Beta starts its own page');
  assert.ok(texts(layout.pages[2]).some((o) => o.text === 'Evening · Alpha'), 'footer names the song');
  assert.deepEqual(layout.outline, [{ title: 'Alpha', page: 2 }, { title: 'Beta', page: 4 }, { title: 'Gamma', page: 5 }]);
  const noToc = L.layoutPdf(sheets, { includeContents: false }, measure);
  assert.equal(noToc.songs[0].firstPage, 1);
});

test('a single one-page song has no footer and no outline', () => {
  const layout = L.layoutPdf([sheet('[G]Hi')], {}, measure);
  assert.equal(layout.pages.length, 1);
  assert.ok(!texts(layout.pages[0]).some((o) => / \/ /.test(o.text)));
  assert.deepEqual(layout.outline, []);
});

test('page sizes, font scale and colours', () => {
  const letter = L.layoutPdf([sheet('[G]Hi')], { pageSize: 'Letter', fontScale: 1.5, chordColor: '#ff0000' }, measure);
  assert.deepEqual(letter.pageSize, { name: 'Letter', w: 612, h: 792 });
  const g = texts(letter.pages[0]).find((o) => o.text === 'G');
  assert.deepEqual([g.color, g.font.size, lyricOp(letter, 'Hi').font.size], ['#ff0000', 15, 16.5]);
  const bw = L.layoutPdf([sheet('[G]Hi')], { bw: true }, measure);
  const chord = texts(bw.pages[0]).find((o) => o.text === 'G');
  assert.deepEqual([chord.color, chord.font.style], ['#000000', 'bold']);
  const normal = texts(L.layoutPdf([sheet('[G]Hi')], {}, measure).pages[0]).find((o) => o.text === 'G');
  assert.deepEqual([normal.color, normal.font.style], [CHORD, 'normal']);
});

test('unencodable characters are counted, never passed to the PDF', () => {
  const layout = L.layoutPdf([sheet('[G]Κύριε ελέησον', {}, { title: 'Kyrie ψ' })], {}, measure);
  assert.ok(layout.dropped > 10);
  layout.pages.forEach((p) => texts(p).forEach((o) => {
    for (const ch of o.text) assert.ok(T.isWinAnsi(ch.codePointAt(0)), JSON.stringify(o.text));
  }));
});

// ---- with the real jsPDF ------------------------------------------------------------------------

const jspdfPath = path.join(__dirname, '..', '..', 'vendor', 'jspdf.umd.min.js');
const fixture = (f) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', f), 'utf8');

test('jsPDF integration: a real PDF whose page count matches the layout', { skip: !fs.existsSync(jspdfPath) }, () => {
  const jspdf = require(jspdfPath);
  const songs = [
    { id: 'a', title: 'Example', lyrics: fixture('example.txt') },
    { id: 'b', title: 'Morning light', lyrics: fixture('multitune.txt') },
    { id: 'c', title: 'Long', lyrics: fixture(path.join('export', 'long.txt')) }
  ];
  const set = { id: 'x', name: 'Test set', items: songs.map((s) => ({ songId: s.id })) };
  const sheets = M.buildSetSheets(set, (id) => songs.find((s) => s.id === id));
  const { doc, layout } = PE.buildPdf(sheets, { pageSize: 'A4' }, jspdf);
  const bytes = Buffer.from(doc.output('arraybuffer'));
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal(doc.getNumberOfPages(), layout.pages.length);
  assert.ok(layout.pages.length >= 5);
  const raw = bytes.toString('latin1');
  assert.equal((raw.match(/\/Subtype \/Link/g) || []).length, 3, 'one link per contents entry');
  assert.match(raw, /\/Outlines/);
  assert.match(raw, /\/Title \(Test set\)/);
  assert.deepEqual(layout.warnings, []);
  assert.equal(layout.dropped, 0);
});

test('jsPDF integration: sanitised text is written as plain single-byte strings', { skip: !fs.existsSync(jspdfPath) }, () => {
  const jspdf = require(jspdfPath);
  const doc = new jspdf.jsPDF({ unit: 'pt', format: 'a4', compress: false });
  const layout = L.layoutPdf([sheet('with an under_score, [G]like_this ψ', {}, { title: 'Tie' })], {}, PE.createMeasure(doc));
  PE.renderPdf(layout, doc);
  const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  assert.match(raw, /\(with an under_score, like_this \?\) Tj/);
  assert.ok(!raw.includes('\u0000'), 'no UTF-16 (NUL-prefixed) text');
  assert.equal(layout.dropped, 1);
});

test('measured widths come from jsPDF and match what it draws', { skip: !fs.existsSync(jspdfPath) }, () => {
  const jspdf = require(jspdfPath);
  const doc = new jspdf.jsPDF({ unit: 'pt', format: 'a4' });
  const m = PE.createMeasure(doc);
  const f = { family: 'helvetica', style: 'normal', size: 11 };
  const whole = m('Amazing grace', f);
  assert.ok(Math.abs(whole - (m('Amazing ', f) + m('grace', f))) < 1e-9, 'widths are additive (no kerning)');
  assert.ok(Math.abs(whole - 72.82) < 0.01);
  assert.ok(m('Amazing grace', { family: 'helvetica', style: 'bold', size: 11 }) > whole);
});
