/* Songsheets — the print document and the standalone HTML export.
 *
 * printDocumentNode(sheets, opts) -> VNode   (contents list for sets + one <article> per sheet)
 * renderPrintDocument(sheets, opts) -> string   (escaped HTML of the same; printRoute re-exports it)
 * pageRule(opts) -> '@page {…}'
 * exportHtml(sheets, opts) -> string   one static file, no JavaScript: inlined CSS, the print document,
 *   and the source records in <script type="text/plain" id="songsheets-source"> so it re-imports.
 * buildEmbed(sheets, opts) -> {format:'songsheets-html-embed', version, exportedAt, app, songs, set}
 * opts = {fontScale, bw, chordColor, pageSize, includeContents, setName, title, songs: [records], set: record|null}
 * Browser: window.SongSheets.export.htmlExport   Node: require('./htmlExport.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var R = isNode ? require('../core/render.js') : root.SongSheets.render;
  var U = isNode ? require('./util.js') : root.SongSheets.export.util;
  var CSS = isNode ? require('./cssStrings.js') : root.SongSheets.export.cssStrings;
  var ids = isNode ? require('../core/ids.js') : root.SongSheets.ids;

  var h = R.h;
  var BASE_PT = 11;
  var MARGINS_MM = { top: 16, right: 16, bottom: 18, left: 16 };

  var STANDALONE_CSS = [
    'body.standalone { margin: 0; padding: 24px 16px 64px; background: var(--background, #fff); color: var(--text, #333); }',
    '.standalone .print-document { max-width: 46em; margin: 0 auto; }',
    '@media screen {',
    '  .standalone .print-document { font-size: calc(15px * var(--ss-scale, 1)); }',
    '  .standalone .print-toc { margin: 0 0 2.5em; }',
    '  .standalone .print-toc a { color: var(--accent, #1f45ff); }',
    '  .standalone .print-sheet { margin: 0 0 3em; }',
    '  .standalone .print-sheet + .print-sheet { border-top: 1px solid var(--border, #d9d9de); padding-top: 2em; }',
    '}'
  ].join('\n');

  function pageRule(opts) {
    opts = opts || {};
    var m = MARGINS_MM;
    return '@page { size: ' + (opts.pageSize === 'Letter' ? 'letter' : 'A4') + ' portrait; margin: ' +
      m.top + 'mm ' + m.right + 'mm ' + m.bottom + 'mm ' + m.left + 'mm; }';
  }

  function headerNode(sheet) {
    var meta = U.metaLine(sheet);
    return h('header', { 'class': 'print-header' },
      h('h1', { 'class': 'print-title' }, String(sheet.title)),
      meta ? h('p', { 'class': 'print-meta' }, meta) : null,
      sheet.tuneTitle ? h('p', { 'class': 'print-tune' }, String(sheet.tuneTitle)) : null);
  }

  // Rough heights, in em of the print font, of lyric lines (print.css: line-height 1.4, chord band 1.2143em).
  var LINE_EM = 1.4;
  var CHORD_LINE_EM = 2.65;
  var PAGE_MM = { A4: 297, Letter: 279.4 };

  function blockEm(block) {
    var em = 0;
    block.lines.forEach(function (l) { em += l.hasChords ? CHORD_LINE_EM : LINE_EM; });
    return em;
  }

  /** A stanza or chorus taller than a page cannot be kept on one page; left with break-inside: avoid,
   *  browsers push it to a new page first and leave the previous page mostly empty. Mark those so
   *  print.css lets them split (still keeping two lines together at each end). */
  function markSplittable(lyrics, sheet, opts, scale) {
    var mm = (PAGE_MM[opts.pageSize === 'Letter' ? 'Letter' : 'A4']) - MARGINS_MM.top - MARGINS_MM.bottom;
    var pageEm = mm * (72 / 25.4) / (BASE_PT * scale);
    var blocks = sheet.blocks.filter(function (b) { return b.kind === 'stanza' || b.kind === 'chorus'; });
    var k = 0;
    lyrics.children.forEach(function (child) {
      if (typeof child === 'string') return;
      var cls = child.attrs['class'];
      if (cls !== 'stanza' && cls !== 'chorus') return;
      var b = blocks[k++];
      if (b && blockEm(b) > pageEm * 0.9) child.attrs['class'] = cls + ' print-splittable';
    });
    return lyrics;
  }

  function tocNode(sheets, opts) {
    return h('section', { 'class': 'print-toc' },
      h('h1', { 'class': 'print-toc-title' }, U.setName(sheets, opts)),
      h('ol', null, sheets.map(function (s, i) {
        var meta = U.tocMeta(s);
        return h('li', null, h('a', { href: '#ps-' + (i + 1) },
          h('span', { 'class': 'toc-title' }, String(s.title)),
          meta ? [' ', h('span', { 'class': 'toc-meta' }, meta)] : null));
      })));
  }

  function printDocumentNode(sheets, opts) {
    opts = opts || {};
    var scale = U.clampScale(opts.fontScale);
    var style = '--print-font-size:' + (BASE_PT * scale).toFixed(2) + 'pt;--ss-scale:' + scale +
      ';--print-chord-color:' + U.validColor(opts.chordColor);
    var showToc = U.isSet(sheets) && opts.includeContents !== false;
    return h('div', { 'class': 'print-document' + (opts.bw ? ' print-bw' : ''), style: style },
      showToc ? tocNode(sheets, opts) : null,
      sheets.map(function (s, i) {
        return h('article', { 'class': 'print-sheet', id: 'ps-' + (i + 1) },
          headerNode(s),
          markSplittable(R.render(s, { interactiveCapo: false }), s, opts, scale));
      }));
  }

  function renderPrintDocument(sheets, opts) {
    return R.toHTML(printDocumentNode(sheets, opts));
  }

  function documentTitle(sheets, opts) {
    if (opts && opts.title) return String(opts.title);
    return U.isSet(sheets) ? U.setName(sheets, opts) : sheets[0] ? String(sheets[0].title) : 'Songsheets';
  }

  function buildEmbed(sheets, opts) {
    opts = opts || {};
    var songs = opts.songs && opts.songs.length ? opts.songs : sheets.map(U.recordFromSheet);
    return {
      format: U.EMBED_FORMAT,
      version: 1,
      exportedAt: ids.nowIso(),
      app: U.APP_ID,
      songs: songs,
      set: opts.set || null
    };
  }

  /** JSON that cannot end its <script> element: every "<" is written as a JSON escape. */
  function embedJson(obj) {
    return JSON.stringify(obj).replace(/</g, '\\u003c');
  }

  function exportHtml(sheets, opts) {
    opts = opts || {};
    return [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<meta name="generator" content="' + U.escapeHtml(U.APP_ID) + '">',
      '<title>' + U.escapeHtml(documentTitle(sheets, opts)) + '</title>',
      '<style>',
      CSS.THEMES_CSS, CSS.SHEET_CSS, CSS.PRINT_CSS, STANDALONE_CSS, pageRule(opts),
      '</style>',
      '</head>',
      '<body class="standalone">',
      '<main>',
      renderPrintDocument(sheets, opts),
      '</main>',
      '<script type="text/plain" id="songsheets-source" data-format="songsheets-json">' + embedJson(buildEmbed(sheets, opts)) + '</script>',
      '</body>',
      '</html>',
      ''
    ].join('\n');
  }

  var api = {
    printDocumentNode: printDocumentNode,
    renderPrintDocument: renderPrintDocument,
    pageRule: pageRule,
    documentTitle: documentTitle,
    buildEmbed: buildEmbed,
    embedJson: embedJson,
    exportHtml: exportHtml,
    STANDALONE_CSS: STANDALONE_CSS
  };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.export = root.SongSheets.export || {};
  root.SongSheets.export.htmlExport = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
