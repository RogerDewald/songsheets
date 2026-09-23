/* Songsheets — plain-text chord chart (chords on their own row above the lyric).
 * Columns are counted on the lyric with chords removed, so a chord sits exactly over the first
 * character of its syllable. A chord moves right only when it would touch the previous chord
 * (one space is kept between chords); lyrics never move. Songbase's own print output measured
 * columns on the bracketed line and drifted right; this does not.
 *
 * exportText(sheets, opts) -> string       opts = {lineEnding:'LF'|'CRLF', setName, includeContents}
 * layoutTextLine(line) -> {chordRow: string|null, lyricRow: string, lyricRuns: [{text,bold,italic}]}
 * Browser: window.SongSheets.export.textExport   Node: require('./textExport.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var U = isNode ? require('./util.js') : root.SongSheets.export.util;

  var GUTTER = 4;           // columns holding stanza numbers
  var CHORUS = 2;           // extra columns for chorus lines
  var TAB = 4;              // tab stops inside a lyric
  var SEPARATOR = '-'.repeat(40);

  /** Expand tabs to spaces, given the display column the text starts at. */
  function expandTabs(text, startCol) {
    if (text.indexOf('\t') < 0) return text;
    var out = '';
    var col = startCol;
    U.graphemes(text).forEach(function (g) {
      if (g === '\t') {
        var n = TAB - (col % TAB);
        out += U.spaces(n);
        col += n;
      } else {
        out += g;
        col += U.clusterWidth(g);
      }
    });
    return out;
  }

  function layoutTextLine(line) {
    var lyric = '';
    var col = 0;
    var cursor = 0;
    var chords = [];
    var runs = [];
    line.segments.forEach(function (seg) {
      if (seg.chord !== null && seg.chord !== undefined) {
        var chord = U.nfc(seg.chord);
        var w = U.cells(chord);
        if (w > 0) {
          var pos = Math.max(col, cursor);
          chords.push({ pos: pos, text: chord });
          cursor = pos + w + 1;
        }
      }
      var segRuns = seg.runs && seg.runs.length ? seg.runs : [{ text: seg.text || '' }];
      segRuns.forEach(function (r) {
        var t = expandTabs(U.nfc(r.text), col);
        if (!t) return;
        lyric += t;
        col += U.cells(t);
        runs.push({ text: t, bold: !!r.bold, italic: !!r.italic });
      });
    });
    var chordRow = null;
    if (chords.length) {
      chordRow = '';
      var at = 0;
      chords.forEach(function (c) {
        chordRow += U.spaces(c.pos - at) + c.text;
        at = c.pos + U.cells(c.text);
      });
      chordRow = chordRow.replace(/\s+$/, '');
    }
    return { chordRow: chordRow, lyricRow: lyric.replace(/\s+$/, ''), lyricRuns: trimRuns(runs) };
  }

  function rowWidth(r) {
    return Math.max(U.cells(r.lyricRow), r.chordRow === null ? 0 : U.cells(r.chordRow));
  }

  /** Split a line into lines of at most maxCols display columns (chord row included), breaking only
   *  at spaces so a word and its chords stay together. Spaces at a break are dropped; a word wider
   *  than maxCols stays whole on its own row. Returns SheetLine objects (the input when it fits). */
  function wrapTextLine(line, maxCols) {
    if (!maxCols || rowWidth(layoutTextLine(line)) <= maxCols) return [line];
    // flatten to graphemes carrying their run flags, with chords anchored before a grapheme index
    var atoms = [];
    var chordsAt = {};
    line.segments.forEach(function (seg) {
      if (seg.chord !== null && seg.chord !== undefined) (chordsAt[atoms.length] = chordsAt[atoms.length] || []).push(seg.chord);
      var runs = seg.runs && seg.runs.length ? seg.runs : [{ text: seg.text || '' }];
      runs.forEach(function (r) {
        U.graphemes(expandTabs(U.nfc(r.text), 0)).forEach(function (g) { atoms.push({ g: g, bold: !!r.bold, italic: !!r.italic }); });
      });
    });

    function slice(from, to) {
      var segs = [];
      var cur = { chord: null, runs: [] };
      function push(a) {
        var last = cur.runs[cur.runs.length - 1];
        if (last && last.bold === a.bold && last.italic === a.italic) last.text += a.g;
        else cur.runs.push({ text: a.g, bold: a.bold, italic: a.italic });
      }
      for (var i = from; i <= to; i++) {
        (chordsAt[i] || []).forEach(function (c) {
          segs.push(cur);
          cur = { chord: c, runs: [] };
        });
        if (i < to) push(atoms[i]);
      }
      segs.push(cur);
      segs = segs.filter(function (s, k) { return k > 0 || s.runs.length || s.chord !== null; });
      segs.forEach(function (s) { s.text = s.runs.map(function (r) { return r.text; }).join(''); });
      return { indent: 0, hasChords: segs.some(function (s) { return s.chord !== null; }), segments: segs.length ? segs : [{ chord: null, text: '', runs: [] }] };
    }

    function isBreak(i) { return atoms[i].g === ' ' && atoms[i - 1].g !== ' '; }   // before a run of spaces

    var out = [];
    var start = 0;
    var n = atoms.length;
    for (;;) {
      var rest = slice(start, n);
      if (rowWidth(layoutTextLine(rest)) <= maxCols) { out.push(rest); break; }
      var best = -1;
      var i;
      for (i = start + 1; i < n; i++) {
        if (!isBreak(i)) continue;
        if (rowWidth(layoutTextLine(slice(start, i))) > maxCols) break;
        best = i;
      }
      if (best < 0) {
        // the first word alone is too wide: keep it whole and break after it
        for (i = start + 1; i < n && best < 0; i++) if (isBreak(i)) best = i;
        if (best < 0) { out.push(rest); break; }
      }
      out.push(slice(start, best));            // a chord sitting on the break space ends this row
      start = best + 1;
      while (start < n && atoms[start].g === ' ' && !chordsAt[start]) start++;
      if (start >= n && !chordsAt[n]) break;
    }
    out.forEach(function (l) { l.indent = line.indent; });
    return out;
  }

  /** Drop trailing whitespace from a run list (mirrors lyricRow). */
  function trimRuns(runs) {
    var out = runs.slice();
    while (out.length) {
      var last = out[out.length - 1];
      var t = last.text.replace(/\s+$/, '');
      if (t) { out[out.length - 1] = { text: t, bold: last.bold, italic: last.italic }; break; }
      out.pop();
    }
    return out;
  }

  /** Columns reserved for stanza numbers: 4, or wider when a number needs it. */
  function gutterWidth(sheet) {
    var g = GUTTER;
    sheet.blocks.forEach(function (b) {
      if (b.kind === 'stanza' && b.number) g = Math.max(g, U.cells(b.number) + 1);
    });
    return g;
  }

  /** Header lines: title, "Key: G · Capo 2 · Author", tune title. */
  function headerLines(sheet) {
    var out = [String(sheet.title)];
    var meta = U.metaLine(sheet);
    if (meta) out.push(meta);
    if (sheet.tuneTitle) out.push(String(sheet.tuneTitle));
    return out;
  }

  function sheetLines(sheet) {
    var out = headerLines(sheet);
    out.push('');
    var gutter = gutterWidth(sheet);
    var pad = U.spaces(gutter);
    sheet.blocks.forEach(function (b) {
      if (b.kind === 'blank') {
        out.push('');
      } else if (b.kind === 'stanza' || b.kind === 'chorus') {
        if (b.kind === 'stanza' && b.number && !b.lines.length) out.push(b.number);
        b.lines.forEach(function (line, i) {
          var r = layoutTextLine(line);
          var prefix = b.kind === 'chorus' ? U.spaces(gutter + CHORUS + Math.max(0, line.indent || 0)) : pad;
          if (r.chordRow !== null) out.push(prefix + r.chordRow);
          var lead = b.kind === 'stanza' && i === 0 && b.number ? U.padEnd(b.number, gutter) : prefix;
          out.push(lead + r.lyricRow);
        });
      } else if (b.kind === 'comment' || b.kind === 'key') {
        var t = U.blockText(b).trim();
        if (t) out.push(pad + '(' + t + ')');
      } else if (b.kind === 'capo') {
        if (!b.active) out.push(pad + '(' + String(b.text).trim() + ')');
      }
    });
    return out.map(function (l) { return l.replace(/\s+$/, ''); });
  }

  function contentsLines(sheets, opts) {
    var out = [U.setName(sheets, opts), 'Contents'];
    var w = String(sheets.length).length;
    sheets.forEach(function (s, i) {
      var meta = U.tocMeta(s, ', ');
      out.push('  ' + String(i + 1).padStart(w) + '. ' + s.title + (meta ? ' (' + meta + ')' : ''));
    });
    return out;
  }

  function exportText(sheets, opts) {
    opts = opts || {};
    var lines = [];
    if (U.isSet(sheets)) {
      if (opts.includeContents !== false) lines = lines.concat(contentsLines(sheets, opts));
      sheets.forEach(function (s) {
        if (lines.length) lines.push('', SEPARATOR, '');
        lines = lines.concat(sheetLines(s));
      });
    } else if (sheets.length) {
      lines = sheetLines(sheets[0]);
    }
    return U.eol(lines.join('\n') + '\n', opts.lineEnding);
  }

  var api = {
    exportText: exportText,
    layoutTextLine: layoutTextLine,
    wrapTextLine: wrapTextLine,
    headerLines: headerLines,
    gutterWidth: gutterWidth,
    expandTabs: expandTabs,
    GUTTER: GUTTER,
    CHORUS: CHORUS
  };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.export = root.SongSheets.export || {};
  root.SongSheets.export.textExport = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
