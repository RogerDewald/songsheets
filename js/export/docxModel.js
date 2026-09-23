/* Songsheets — a plain description of the Word document, built from sheets (no docx library).
 * Chords and lyrics are monospace paragraph pairs laid out with the text export's column algorithm
 * (textExport.layoutTextLine), so columns line up in Word, LibreOffice and Google Docs whatever
 * monospace font they substitute. Stanza numbers hang in a gutter (hanging indent + tab), choruses
 * are indented, a chord row is kept with its lyric row and every line of a block with the next
 * (keepNext), each song after the first starts a page, and a set gets a linked contents list.
 *
 * buildDocxModel(sheets, opts) -> {page, fonts, sizes, colors, chordBold, indent, footer, toc, songs}
 *   song = {bookmark, title, meta, tune, pageBreakBefore, paragraphs}
 *   paragraph = {kind:'chord'|'lyric'|'comment'|'blank', text, runs:[{text,bold,italic}], left (twips),
 *                number?: string, keepNext}
 * opts = {pageSize:'A4'|'Letter', fontScale, bw, chordColor, includeContents, setName}
 * Browser: window.SongSheets.export.docxModel   Node: require('./docxModel.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var U = isNode ? require('./util.js') : root.SongSheets.export.util;
  var TX = isNode ? require('./textExport.js') : root.SongSheets.export.textExport;

  var PAGES = { A4: { width: 11906, height: 16838 }, Letter: { width: 12240, height: 15840 } };   // twips
  var MARGIN = 1134;                          // 2 cm
  var CONSOLAS_ADVANCE = 0.5498;              // em; any monospace substitute keeps the columns
  var COURIER_ADVANCE = 0.6;                  // Courier New / Liberation Mono, the widest usual stand-ins

  function halfPoints(pt, scale) {
    return Math.max(8, Math.round(pt * 2 * scale));
  }

  function hexNoHash(c) {
    return c.replace('#', '').toUpperCase();
  }

  /** keepNext for line i of n. A block that fits a page is chained whole (Word moves it to the next
   *  page instead of splitting it). A taller one would drag the whole chain onto a fresh page and
   *  still split, so only its first two and last two lines are held together. */
  function keepLine(i, n, tooTall) {
    if (i === n - 1) return false;
    return !tooTall || i === 0 || i === n - 2;
  }

  function songParagraphs(sheet, m) {
    var gutter = TX.gutterWidth(sheet);
    var left = Math.round(gutter * m.charW);
    var chorusLeft = left + Math.round(TX.CHORUS * m.charW);
    var out = [];
    sheet.blocks.forEach(function (b) {
      if (b.kind === 'blank') {
        out.push({ kind: 'blank', text: '', runs: [], left: left, keepNext: false });
      } else if (b.kind === 'stanza' || b.kind === 'chorus') {
        var base = b.kind === 'chorus' ? chorusLeft : left;
        if (b.kind === 'stanza' && b.number && !b.lines.length) {
          out.push({ kind: 'lyric', text: '', runs: [], left: base, number: b.number, keepNext: false });
        }
        // Word would wrap an over-long chord row apart from its lyric: wrap both here instead
        var cols = Math.max(20, Math.floor((m.textWidth - base) / m.safeCharW));
        var laid = b.lines.map(function (line) {
          var indent = b.kind === 'chorus' ? Math.max(0, line.indent || 0) : 0;
          return TX.wrapTextLine(line, cols - indent).map(TX.layoutTextLine);
        });
        var rows = 0;
        laid.forEach(function (parts) { parts.forEach(function (r) { rows += r.chordRow !== null ? 2 : 1; }); });
        var tooTall = rows > m.rowsPerPage;
        b.lines.forEach(function (line, i) {
          var pad = b.kind === 'chorus' ? U.spaces(Math.max(0, line.indent || 0)) : '';
          laid[i].forEach(function (r, j) {
            var lastPart = j === laid[i].length - 1;
            if (r.chordRow !== null) out.push({ kind: 'chord', text: pad + r.chordRow, runs: [{ text: pad + r.chordRow }], left: base, keepNext: true });
            var runs = pad ? [{ text: pad }].concat(r.lyricRuns) : r.lyricRuns;
            var p = { kind: 'lyric', text: pad + r.lyricRow, runs: runs, left: base, keepNext: lastPart ? keepLine(i, b.lines.length, tooTall) : true };
            if (b.kind === 'stanza' && i === 0 && j === 0 && b.number) p.number = b.number;
            out.push(p);
          });
        });
      } else if (b.kind === 'comment' || b.kind === 'key' || b.kind === 'capo') {
        if (b.kind === 'capo' && b.active) return;
        var text = b.kind === 'comment' ? U.blockText(b).trim() : String(b.text || '').trim();
        if (!text) return;
        var runs = b.kind === 'comment' && b.runs && b.runs.length ? b.runs.map(function (r) {
          return { text: r.text, bold: !!r.bold, italic: !!r.italic };
        }) : [{ text: text }];
        out.push({ kind: 'comment', text: text, runs: runs, left: left, keepNext: true });
      }
    });
    // a blank row after a skipped capo/key line would double a gap
    return out.filter(function (p, i) { return p.kind !== 'blank' || (i > 0 && out[i - 1].kind !== 'blank' && i < out.length - 1); });
  }

  function buildDocxModel(sheets, opts) {
    opts = opts || {};
    var scale = U.clampScale(opts.fontScale);
    var sizes = {
      mono: halfPoints(10.5, scale),
      title: halfPoints(16, scale),
      meta: halfPoints(10, scale),
      comment: halfPoints(9, scale),
      toc: halfPoints(11, scale),
      footer: 16
    };
    var page = PAGES[opts.pageSize === 'Letter' ? 'Letter' : 'A4'];
    var metrics = {
      charW: CONSOLAS_ADVANCE * (sizes.mono / 2) * 20,              // twips per column (indents)
      safeCharW: COURIER_ADVANCE * (sizes.mono / 2) * 20,           // widest common substitute (line length)
      textWidth: page.width - 2 * MARGIN,
      // single-spaced monospace rows that fit below a song header (Word's line ≈ 1.17 × font size)
      rowsPerPage: Math.floor((page.height - 2 * MARGIN - 1400) / (sizes.mono / 2 * 1.17 * 20))
    };
    var isSet = U.isSet(sheets);
    var setName = isSet ? U.setName(sheets, opts) : null;
    var withToc = isSet && opts.includeContents !== false;
    var songs = sheets.map(function (s, i) {
      return {
        bookmark: 'song_' + (i + 1),
        title: String(s.title),
        meta: U.metaLine(s),
        tune: s.tuneTitle ? String(s.tuneTitle) : null,
        pageBreakBefore: i > 0 || withToc,
        paragraphs: songParagraphs(s, metrics)
      };
    });
    return {
      page: {
        width: page.width,
        height: page.height,
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN, footer: 567 }
      },
      fonts: { mono: 'Consolas', text: 'Arial' },
      sizes: sizes,
      colors: { chord: opts.bw ? '000000' : hexNoHash(U.validColor(opts.chordColor)), meta: '666666', comment: '808080', footer: '777777' },
      chordBold: !!opts.bw,
      footer: { text: setName },
      toc: withToc ? {
        title: setName,
        entries: sheets.map(function (s, i) { return { title: String(s.title), meta: U.tocMeta(s), bookmark: songs[i].bookmark, number: i + 1 }; })
      } : null,
      songs: songs,
      title: opts.title || (isSet ? setName : songs[0] ? songs[0].title : 'Songsheets'),
      author: !isSet && sheets[0] && sheets[0].author ? String(sheets[0].author) : null
    };
  }

  var api = { buildDocxModel: buildDocxModel, PAGES: PAGES };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.export = root.SongSheets.export || {};
  root.SongSheets.export.docxModel = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
