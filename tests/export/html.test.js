'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../../js/core/sheetModel.js');
const H = require('../../js/export/htmlExport.js');
const PR = require('../../js/export/printRoute.js');
const B = require('../../js/export/backup.js');
const CSS = require('../../js/export/cssStrings.js');

const EVIL_TITLE = '<img src=x onerror=alert(1)>';
const EVIL_LYRIC = '</script><script>alert(1)</script> [G]x <!-- y';
const record = { id: 'evil', title: EVIL_TITLE, author: '"quote" & <b>', tags: [], lyrics: EVIL_LYRIC, notes: '', transpose: 0, accidentals: null, tuneIndex: 0, favourite: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', origin: null };
const count = (s, sub) => s.split(sub).length - 1;

test('standalone HTML: every user string is escaped and the embed cannot break out', () => {
  const sheet = M.buildSheet(record);
  const html = H.exportHtml([sheet], { songs: [record] });
  assert.ok(!html.includes('<img'), 'title markup escaped');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('<title>&lt;img src=x onerror=alert(1)&gt;</title>'));
  assert.ok(html.includes('"quote" &amp; &lt;b&gt;'), 'author escaped in the meta line (quotes are inert in text)');
  assert.equal(count(html, '<script'), 1, 'only the embed is a script element');
  assert.equal(count(html.toLowerCase(), '</script'), 1, 'only the embed closes a script element');
  assert.equal(count(html, '<!--'), 0);
  const embedText = /<script type="text\/plain" id="songsheets-source" data-format="songsheets-json">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(!embedText.includes('<'), 'no "<" inside the embed');
  assert.ok(!/<[a-z][^>]*\son\w+\s*=/i.test(html), 'no tag carries an event handler');
  assert.ok(!/<script(?![^>]*type="text\/plain")/.test(html), 'no executable script');
});

test('embed round trip through backup.importAny', () => {
  const set = { id: 'set9', name: 'Night & day', items: [{ songId: 'evil', transpose: 2, capo: null, tuneIndex: null }], createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' };
  const sheets = M.buildSetSheets(set, () => record);
  const html = H.exportHtml(sheets, { songs: [record], set });
  const embed = B.parseHtmlEmbed(html);
  assert.equal(embed.format, 'songsheets-html-embed');
  assert.equal(embed.version, 1);
  assert.equal(embed.app, 'songsheets/1.0.0');
  assert.deepEqual(embed.songs, [record]);
  assert.deepEqual(embed.set, set);
  const r = B.importAny(html, 'Night.html');
  assert.equal(r.kind, 'html-embed');
  assert.deepEqual(r.songs, [record]);
  assert.deepEqual(r.sets, [set]);
  assert.equal(r.settings, null);
});

test('without records the embed is rebuilt from the sheets', () => {
  const sheet = M.buildSheet({ id: 'q', title: 'Q', lyrics: '[G]Hi', transpose: 3 });
  const embed = H.buildEmbed([sheet], {});
  assert.equal(embed.songs[0].id, 'q');
  assert.equal(embed.songs[0].lyrics, '[G]Hi');
  assert.equal(embed.songs[0].transpose, 3);
});

test('the standalone file inlines the CSS and has no script or external resource', () => {
  const html = H.exportHtml([M.buildSheet({ title: 'T', lyrics: '[G]Hi' })], { pageSize: 'Letter' });
  assert.ok(html.startsWith('<!doctype html>\n<html lang="en">'));
  assert.ok(html.includes(CSS.SHEET_CSS) && html.includes(CSS.THEMES_CSS) && html.includes(CSS.PRINT_CSS));
  assert.ok(html.includes('@page { size: letter portrait;'));
  assert.ok(!/<link\b|\bsrc=|@import/.test(html));
  [CSS.SHEET_CSS, CSS.THEMES_CSS, CSS.PRINT_CSS, H.STANDALONE_CSS].forEach((c) => assert.ok(!c.includes('</'), 'CSS cannot end the style element'));
});

test('print document: contents for sets, one article per song, header meta', () => {
  const songs = {
    a: { id: 'a', title: 'Alpha', author: 'Ann', lyrics: '# Capo 2\n[G]One' },
    b: { id: 'b', title: 'Beta', lyrics: '### Other tune\n[A]Two' }
  };
  const set = { id: 's', name: 'Sunday', items: [{ songId: 'a' }, { songId: 'b', capo: 2 }] };
  const doc = PR.renderPrintDocument(M.buildSetSheets(set, (id) => songs[id]), { fontScale: 1.2, chordColor: 'red;}', bw: true });
  assert.match(doc, /^<div class="print-document print-bw" style="--print-font-size:13\.20pt;--ss-scale:1\.2;--print-chord-color:#1f45ff">/);
  assert.match(doc, /<section class="print-toc"><h1 class="print-toc-title">Sunday<\/h1><ol><li><a href="#ps-1"><span class="toc-title">Alpha<\/span> <span class="toc-meta">G · Capo 2<\/span><\/a><\/li><li><a href="#ps-2">/);
  assert.equal(count(doc, '<article class="print-sheet"'), 2);
  assert.match(doc, /<article class="print-sheet" id="ps-1"><header class="print-header"><h1 class="print-title">Alpha<\/h1><p class="print-meta">Key: G · Capo 2 · Ann<\/p><\/header><div class="lyrics">/);
  assert.match(doc, /<p class="print-meta">Key: G · Capo 2<\/p><p class="print-tune">Other tune<\/p>/);
  assert.ok(!doc.includes('role="button"'), 'capo presets are not interactive in print');
  const single = PR.renderPrintDocument([M.buildSheet({ title: 'Solo', lyrics: 'x' })], {});
  assert.ok(!single.includes('print-toc'));
  assert.ok(!single.includes('print-bw'));
  assert.equal(PR.renderPrintDocument, H.renderPrintDocument);
});

test('a stanza or chorus taller than a page is marked splittable; shorter blocks are not', () => {
  const NL = '\n';
  const lines = (n, chords, prefix = '') => Array.from({ length: n }, (_, i) => prefix + (chords ? '[G]' : '') + 'line ' + i).join(NL);
  const text = ['1', lines(8, true), '', '2', lines(30, true), '', lines(60, false, '  '), '', lines(40, false)].join(NL);
  const doc = PR.renderPrintDocument([M.buildSheet({ title: 'T', lyrics: text })], {});
  const classes = [...doc.matchAll(/<div class="(stanza|chorus)( print-splittable)?">/g)].map((m) => m[0].slice(12, -2));
  assert.deepEqual(classes, ['stanza', 'stanza print-splittable', 'chorus print-splittable', 'stanza']);
  const big = PR.renderPrintDocument([M.buildSheet({ title: 'T', lyrics: lines(30, true) })], { fontScale: 0.6 });
  assert.ok(!big.includes('print-splittable'), 'a smaller print font fits more on a page');
});

test('print.css carries the rules printing depends on', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'print.css'), 'utf8');
  const printBlock = css.slice(css.indexOf('@media print'));
  assert.ok(css.indexOf('@media print') > 0, 'has a print block');
  [
    /html\.ss-printing #app \{ display: none !important; \}/,
    /html\.ss-printing #print-root \{ display: block !important; \}/,
    /\.app-header, \.toolbar, \[role="toolbar"\], \.toast-region, \.skip-link, dialog, \.no-print \{\s*display: none !important;/,
    /\.print-sheet \+ \.print-sheet \{\s*break-before: page;/,
    /\.print-toc \{\s*break-after: page;/,
    /\.stanza, \.chorus, \.line, \.comment \{\s*break-inside: avoid;/,
    /print-color-adjust: exact;/,
    /\.print-document \.lyrics \.chord-word \.chord \{\s*color: var\(--print-chord-color, #1f45ff\);/,
    /\.print-document\.print-bw \.lyrics \.chord-word \.chord \{\s*color: #000;\s*font-weight: bold;/,
    /\.print-document \.print-splittable \{\s*break-inside: auto;/,
    /\.print-splittable > \.line:first-child,\s*\.print-splittable > \.stanza-number \+ \.line,\s*\.print-splittable > \.line:nth-last-child\(2\) \{\s*break-after: avoid;/
  ].forEach((re) => assert.match(printBlock, re));
  assert.match(css, /\.print-document \{\s*font-family: [^;]+;\s*line-height: 1\.4;\s*text-align: left;/, 'the host page cannot restyle the print document');
  assert.match(css.slice(0, css.indexOf('@media print')), /@media screen \{\s*#print-root \{ display: none; \}/);
  assert.ok(!/box-sizing/.test(css), 'print.css leaves box-sizing to sheet.css');
});

test('pageRule', () => {
  assert.equal(H.pageRule({ pageSize: 'A4' }), '@page { size: A4 portrait; margin: 16mm 16mm 18mm 16mm; }');
  assert.equal(H.pageRule({ pageSize: 'Letter' }), '@page { size: letter portrait; margin: 16mm 16mm 18mm 16mm; }');
});
