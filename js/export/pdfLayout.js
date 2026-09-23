/* Songsheets — page layout for the direct PDF export. Pure: text widths come from an injected
 * measure(text, font) -> points, so it runs (and is tested) without jsPDF.
 *
 * layoutPdf(sheets, opts, measure) -> {pageSize:{name,w,h}, pages:[{ops}], outline:[{title,page}],
 *                                     songs:[{title, firstPage, lastPage}], warnings, dropped}
 *   Op = {type:'text', x, y (baseline), text, font:{family,style,size}, color}
 *      | {type:'link', x, y (top), w, h, page}
 *   opts = {pageSize:'A4'|'Letter', fontScale, bw, chordColor, avoidChordOverlap, includeContents,
 *           setName, margins:{top,right,bottom,left} (mm), tieChar}
 *
 * Songbase's look: every chord is drawn at the x of the syllable it belongs to, takes no width and may
 * overlap the next chord (avoidChordOverlap moves chords apart on the chord row only; lyrics never
 * move). Lines wrap between words; a word and its chords move together; a wrapped row starts at
 * the lyric margin (no hanging indent). Stanza numbers hang in a left gutter, choruses are indented.
 * A stanza or chorus is kept on one page when it fits on a page; a longer one is split between lines,
 * with at least two lines on each side. In a set every song starts a new page, contents pages with
 * page numbers and links come first, and pages are numbered "n / N".
 * Every string is passed through pdfText.toWinAnsi (the built-in PDF fonts are WinAnsi only).
 * Browser: window.SongSheets.export.pdfLayout   Node: require('./pdfLayout.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var U = isNode ? require('./util.js') : root.SongSheets.export.util;
  var T = isNode ? require('./pdfText.js') : root.SongSheets.export.pdfText;

  var PAGE_SIZES = { A4: { w: 595.28, h: 841.89 }, Letter: { w: 612, h: 792 } };
  var MM = 72 / 25.4;
  var DEFAULT_MARGINS = { top: 18, right: 16, bottom: 20, left: 16 };
  var EPS = 0.01;

  function font(style, size) {
    return { family: 'helvetica', style: style, size: size };
  }

  function resolveConfig(opts) {
    opts = opts || {};
    var scale = U.clampScale(opts.fontScale);
    var fs = 11 * scale;
    var bw = !!opts.bw;
    var m = Object.assign({}, DEFAULT_MARGINS, opts.margins || {});
    var name = opts.pageSize === 'Letter' ? 'Letter' : 'A4';
    var cfg = {
      pageSize: { name: name, w: PAGE_SIZES[name].w, h: PAGE_SIZES[name].h },
      margin: { top: m.top * MM, right: m.right * MM, bottom: m.bottom * MM, left: m.left * MM },
      fs: fs,
      gutter: 26 * scale,
      chorusIndent: 18 * scale,
      fonts: {
        lyric: font('normal', fs),
        chord: font(bw ? 'bold' : 'normal', fs * 10 / 11),
        comment: font('normal', fs * 9.5 / 11),
        title: font('bold', 16 * scale),
        meta: font('normal', 10 * scale),
        toc: font('normal', fs),
        tocMeta: font('normal', 9.5 * scale),
        footer: font('normal', 8.5)
      },
      colors: {
        text: '#000000',
        chord: bw ? '#000000' : U.validColor(opts.chordColor),
        comment: '#777777',
        meta: '#555555',
        footer: '#777777'
      },
      avoidChordOverlap: !!opts.avoidChordOverlap,
      tieChar: typeof opts.tieChar === 'string' ? opts.tieChar : '_',
      includeContents: opts.includeContents !== false
    };
    cfg.lineH = fs * 1.3;
    cfg.chordH = cfg.fonts.chord.size * 1.25;
    cfg.blankGap = fs * 0.8;
    cfg.commentLineH = cfg.fonts.comment.size * 1.4;
    cfg.x0 = cfg.margin.left + cfg.gutter;
    cfg.right = cfg.pageSize.w - cfg.margin.right;
    cfg.bottom = cfg.pageSize.h - cfg.margin.bottom;
    cfg.overhang = cfg.margin.right * 0.8;
    cfg.tocRowH = fs * 1.7;
    return cfg;
  }

  function makeContext(cfg, measure) {
    var ctx = { cfg: cfg, measure: measure, dropped: 0, warnings: [] };
    ctx.clean = function (s) {
      var r = T.toWinAnsi(s, { tieChar: cfg.tieChar });
      ctx.dropped += r.dropped;
      return r.text;
    };
    return ctx;
  }

  // ---- lines ----------------------------------------------------------------------------------

  function styleOf(run) {
    return run.bold && run.italic ? 'bolditalic' : run.bold ? 'bold' : run.italic ? 'italic' : 'normal';
  }

  function withStyle(base, style) {
    return { family: base.family, style: style, size: base.size };
  }

  function pieces(chars) {
    var out = [];
    chars.forEach(function (ch) {
      var last = out[out.length - 1];
      if (last && last.style === ch.style) last.text += ch.c;
      else out.push({ text: ch.c, style: ch.style });
    });
    return out;
  }

  function widthOf(chars, base, ctx) {
    var w = 0;
    pieces(chars).forEach(function (p) { w += ctx.measure(p.text, withStyle(base, p.style)); });
    return w;
  }

  /** Words and space runs of a line. Each chord is anchored to a word at a character offset; a chord
   *  before a space (or at the end) becomes a zero-width word, as in songbase's chord-word spans. */
  function tokenize(line, ctx) {
    var chars = [];
    var anchorsAt = {};
    (line.segments || []).forEach(function (seg) {
      if (seg.chord !== null && seg.chord !== undefined) {
        (anchorsAt[chars.length] = anchorsAt[chars.length] || []).push(ctx.clean(seg.chord));
      }
      var runs = seg.runs && seg.runs.length ? seg.runs : seg.text ? [{ text: seg.text }] : [];
      runs.forEach(function (run) {
        var t = ctx.clean(String(run.text).replace(/\t/g, '    '));
        var st = styleOf(run);
        for (var i = 0; i < t.length; i++) chars.push({ c: t[i], style: st });
      });
    });
    var tokens = [];
    var cur = null;
    for (var p = 0; p <= chars.length; p++) {
      if (anchorsAt[p]) {
        if (!cur || cur.type !== 'word') { cur = { type: 'word', chars: [], anchors: [] }; tokens.push(cur); }
        anchorsAt[p].forEach(function (text) { cur.anchors.push({ offset: cur.chars.length, text: text }); });
      }
      if (p === chars.length) break;
      var type = chars[p].c === ' ' ? 'space' : 'word';
      if (!cur || cur.type !== type) { cur = { type: type, chars: [], anchors: [] }; tokens.push(cur); }
      cur.chars.push(chars[p]);
    }
    return tokens;
  }

  /** Split a word wider than maxW into pieces that fit (at least one character each). */
  function splitWord(tok, base, ctx, maxW) {
    var parts = [];
    var cur = { type: 'word', chars: [], anchors: [] };
    tok.chars.forEach(function (ch, i) {
      if (cur.chars.length && widthOf(cur.chars.concat([ch]), base, ctx) > maxW + EPS) {
        parts.push(cur);
        cur = { type: 'word', chars: [], anchors: [] };
      }
      tok.anchors.forEach(function (a) { if (a.offset === i) cur.anchors.push({ offset: cur.chars.length, text: a.text }); });
      cur.chars.push(ch);
    });
    tok.anchors.forEach(function (a) { if (a.offset >= tok.chars.length) cur.anchors.push({ offset: cur.chars.length, text: a.text }); });
    parts.push(cur);
    return parts;
  }

  /** Rows of one line: {items:[{text, font, x}], chords:[{text, x}], hasChords}; x from the row start. */
  function breakLineIntoRows(line, ctx, o) {
    o = o || {};
    var cfg = ctx.cfg;
    var base = o.font || cfg.fonts.lyric;
    var chordFont = cfg.fonts.chord;
    var maxW = o.maxWidth;
    var rows = [];
    var row = { chars: [], chords: [], count: 0 };
    var x = 0;
    var pending = null;

    function endRow() {
      rows.push(row);
      row = { chars: [], chords: [], count: 0 };
      x = 0;
      pending = null;
    }

    function place(tok, w) {
      if (pending) { row.chars = row.chars.concat(pending); x += widthOf(pending, base, ctx); pending = null; }
      tok.anchors.forEach(function (a) {
        row.chords.push({ text: a.text, x: x + widthOf(tok.chars.slice(0, a.offset), base, ctx) });
      });
      row.chars = row.chars.concat(tok.chars);
      x += w;
      row.count++;
    }

    tokenize(line, ctx).forEach(function (tok) {
      if (tok.type === 'space') {
        if (row.count === 0 && rows.length > 0) return;          // wrapped rows start at the margin
        pending = (pending || []).concat(tok.chars);
        return;
      }
      var sp = pending ? widthOf(pending, base, ctx) : 0;
      var w = widthOf(tok.chars, base, ctx);
      var chordRight = 0;
      tok.anchors.forEach(function (a) {
        chordRight = Math.max(chordRight, widthOf(tok.chars.slice(0, a.offset), base, ctx) + ctx.measure(a.text, chordFont));
      });
      var fits = x + sp + w <= maxW + EPS && x + sp + chordRight <= maxW + cfg.overhang + EPS;
      if (!fits && row.count > 0) endRow();
      if (w > maxW + EPS) {
        ctx.warnings.push('A word too wide for the page was split: "' + tok.chars.map(function (c) { return c.c; }).join('') + '"');
        splitWord(tok, base, ctx, maxW).forEach(function (part, i) {
          if (i > 0) endRow();
          place(part, widthOf(part.chars, base, ctx));
        });
        return;
      }
      place(tok, w);
    });
    rows.push(row);

    return rows.map(function (r) {
      var items = [];
      var px = 0;
      pieces(r.chars).forEach(function (p) {
        var f = withStyle(base, p.style);
        items.push({ text: p.text, font: f, x: px });
        px += ctx.measure(p.text, f);
      });
      var chords = r.chords;
      if (cfg.avoidChordOverlap) chords = spreadChords(chords, ctx);
      return { items: items, chords: chords, hasChords: r.chords.length > 0 };
    });
  }

  /** Move chords right, on the chord row only, so each ends one space before the next. */
  function spreadChords(chords, ctx) {
    var f = ctx.cfg.fonts.chord;
    var out = chords.map(function (c) { return { text: c.text, x: c.x }; }).sort(function (a, b) { return a.x - b.x; });
    for (var i = 1; i < out.length; i++) {
      var prev = out[i - 1];
      if (!prev.text) continue;
      var min = prev.x + ctx.measure(prev.text, f) + ctx.measure(' ', f);
      if (out[i].x < min) out[i].x = min;
    }
    return out;
  }

  // ---- blocks ---------------------------------------------------------------------------------

  function rowHeight(row, ctx, isComment) {
    var cfg = ctx.cfg;
    if (isComment) return cfg.commentLineH;
    return cfg.lineH + (row.hasChords ? cfg.chordH : 0);
  }

  function textLine(text, runs) {
    return { indent: 0, hasChords: false, segments: [{ chord: null, text: text, runs: runs && runs.length ? runs : [{ text: text }] }] };
  }

  /** A block as units (a unit = one source line with its wrapped rows; the unit of page splitting). */
  function measureBlock(block, ctx) {
    var cfg = ctx.cfg;
    var maxW = cfg.right - cfg.x0;
    if (block.kind === 'blank') return { gap: cfg.blankGap };
    if (block.kind === 'stanza' || block.kind === 'chorus') {
      var units = block.lines.map(function (line) {
        var dx = 0;
        if (block.kind === 'chorus') {
          dx = cfg.chorusIndent + (line.indent > 0 ? ctx.measure(' '.repeat(line.indent), cfg.fonts.lyric) : 0);
        }
        var rows = breakLineIntoRows(line, ctx, { maxWidth: maxW - dx });
        rows.forEach(function (r) { r.h = rowHeight(r, ctx, false); });
        return { rows: rows, dx: dx, h: sum(rows) };
      });
      if (block.kind === 'stanza' && block.number) {
        if (!units.length) {
          var empty = { items: [], chords: [], hasChords: false, h: cfg.lineH };
          units.push({ rows: [empty], dx: 0, h: empty.h });
        }
        units[0].rows[0].number = ctx.clean(block.number);
      }
      return units.length ? { kind: block.kind, units: units } : null;
    }
    var text = null;
    var runs = null;
    if (block.kind === 'comment') { text = U.blockText(block).trim(); runs = block.runs; }
    else if (block.kind === 'key') text = String(block.text || '').trim();
    else if (block.kind === 'capo') text = block.active ? '' : String(block.text || '').trim();
    if (!text) return null;
    var crow = breakLineIntoRows(textLine(text, runs && runs.length ? trimRuns(runs) : null), ctx, { maxWidth: maxW, font: cfg.fonts.comment });
    crow.forEach(function (r) { r.h = rowHeight(r, ctx, true); r.comment = true; });
    return { kind: 'comment', units: [{ rows: crow, dx: 0, h: sum(crow) }], keepWithNext: true };
  }

  function trimRuns(runs) {
    var out = runs.map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; return o; });
    while (out.length && !out[0].text.replace(/^\s+/, '')) out.shift();
    if (out.length) out[0].text = out[0].text.replace(/^\s+/, '');
    while (out.length && !out[out.length - 1].text.replace(/\s+$/, '')) out.pop();
    if (out.length) out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, '');
    return out;
  }

  function sum(list) {
    var t = 0;
    list.forEach(function (x) { t += x.h; });
    return t;
  }

  /** Greedy word wrap of a plain string (titles, meta lines). */
  function wrapText(text, f, maxW, ctx) {
    var words = String(text).split(/ +/).filter(Boolean);
    var lines = [];
    var cur = '';
    words.forEach(function (w) {
      var cand = cur ? cur + ' ' + w : w;
      if (!cur || ctx.measure(cand, f) <= maxW + EPS) { cur = cand; return; }
      lines.push(cur);
      cur = w;
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  /** Shorten text with an ellipsis to fit maxW. */
  function fitText(text, f, maxW, ctx) {
    if (ctx.measure(text, f) <= maxW + EPS) return text;
    var s = text;
    while (s.length > 1 && ctx.measure(s + '…', f) > maxW + EPS) s = s.slice(0, -1);
    return s.replace(/\s+$/, '') + '…';
  }

  // ---- document -------------------------------------------------------------------------------

  function layoutPdf(sheets, opts, measure) {
    if (typeof measure !== 'function') throw new TypeError('layoutPdf needs a measure(text, font) function');
    opts = opts || {};
    var cfg = resolveConfig(opts);
    var ctx = makeContext(cfg, measure);
    var pages = [];
    var pageSong = [];                       // sheet index per page (-1 = contents)
    var songs = [];
    var outline = [];
    var isSet = U.isSet(sheets);
    var setName = ctx.clean(U.setName(sheets, opts));
    var st = { y: cfg.margin.top, placed: 0, song: -1 };

    function op(o) { pages[pages.length - 1].ops.push(o); }
    function text(str, x, y, f, color) {
      if (str) op({ type: 'text', x: x, y: y, text: str, font: f, color: color });
    }
    function newPage(songIndex) {
      pages.push({ ops: [] });
      pageSong.push(songIndex);
      st.y = cfg.margin.top;
      st.placed = 0;
    }

    // contents pages are reserved first: their count is known before the songs are laid out
    var tocPages = 0;
    var tocTitleH = cfg.fonts.title.size * 1.25 + cfg.fs;
    var usable = cfg.bottom - cfg.margin.top;
    var tocFirst = Math.max(1, Math.floor((usable - tocTitleH) / cfg.tocRowH));   // entries on contents page 1
    var tocPer = Math.max(1, Math.floor(usable / cfg.tocRowH));                  // entries on later pages
    if (isSet && cfg.includeContents) {
      tocPages = sheets.length <= tocFirst ? 1 : 1 + Math.ceil((sheets.length - tocFirst) / tocPer);
      for (var t = 0; t < tocPages; t++) newPage(-1);
    }

    sheets.forEach(function (sheet, si) {
      newPage(si);
      var title = ctx.clean(String(sheet.title));
      var startPage = pages.length;
      drawHeader(sheet, title);
      var blocks = sheet.blocks.map(function (b) { return measureBlock(b, ctx); }).filter(Boolean);
      paginate(blocks, title);
      songs.push({ title: title, firstPage: startPage, lastPage: pages.length });
      if (isSet) outline.push({ title: title, page: startPage });
    });

    if (tocPages) fillToc();
    stampFooters();

    return {
      pageSize: { name: cfg.pageSize.name, w: cfg.pageSize.w, h: cfg.pageSize.h },
      pages: pages,
      outline: outline,
      songs: songs,
      warnings: ctx.warnings,
      dropped: ctx.dropped
    };

    function drawHeader(sheet, title) {
      var f = cfg.fonts;
      var contentW = cfg.right - cfg.margin.left;
      var y = cfg.margin.top;
      wrapText(title, f.title, contentW, ctx).forEach(function (line) {
        text(line, cfg.margin.left, y + f.title.size * 0.95, f.title, cfg.colors.text);
        y += f.title.size * 1.25;
      });
      var metaLines = [ctx.clean(U.metaLine(sheet))];
      if (sheet.tuneTitle) metaLines.push(ctx.clean(String(sheet.tuneTitle)));
      metaLines.forEach(function (m) {
        if (!m) return;
        wrapText(m, f.meta, contentW, ctx).forEach(function (line) {
          text(line, cfg.margin.left, y + f.meta.size * 1.05, f.meta, cfg.colors.meta);
          y += f.meta.size * 1.4;
        });
      });
      st.y = y + cfg.fs * 0.9;
    }

    function placeUnit(unit) {
      var f = cfg.fonts;
      var x = cfg.x0 + unit.dx;
      unit.rows.forEach(function (row) {
        var top = st.y;
        if (row.comment) {
          var cb = top + f.comment.size * 1.05;
          row.items.forEach(function (it) { text(it.text, x + it.x, cb, it.font, cfg.colors.comment); });
        } else {
          if (row.hasChords) {
            var chordBase = top + f.chord.size * 0.95;
            row.chords.forEach(function (c) { text(c.text, x + c.x, chordBase, f.chord, cfg.colors.chord); });
          }
          var base = top + (row.hasChords ? cfg.chordH : 0) + cfg.fs * 0.95;
          row.items.forEach(function (it) { text(it.text, x + it.x, base, it.font, cfg.colors.text); });
          if (row.number) text(row.number, cfg.margin.left, base, f.lyric, cfg.colors.text);
        }
        st.y += row.h;
      });
    }

    function placeBlock(b) {
      b.units.forEach(placeUnit);
      st.placed++;
    }

    function leadHeight(blocks, from) {
      // gaps and the first two lines of the next stanza/chorus, which a comment keeps with it
      var h = 0;
      for (var i = from; i < blocks.length; i++) {
        if (blocks[i].gap) { h += blocks[i].gap; continue; }
        var us = blocks[i].units;
        for (var k = 0; k < Math.min(2, us.length); k++) h += us[k].h;
        return h;
      }
      return 0;
    }

    function paginate(blocks, title) {
      var fullH = cfg.bottom - cfg.margin.top;
      for (var bi = 0; bi < blocks.length; bi++) {
        var b = blocks[bi];
        if (b.gap) {
          if (st.placed > 0) st.y += b.gap;
          continue;
        }
        var h = sum(b.units);
        var avail = cfg.bottom - st.y;
        var lead = b.keepWithNext ? leadHeight(blocks, bi + 1) : 0;
        if (h + lead <= avail + EPS) { placeBlock(b); continue; }
        if (st.placed > 0 && h + lead <= fullH + EPS) { newPage(pageSong[pageSong.length - 1]); placeBlock(b); continue; }
        if (h <= avail + EPS) { placeBlock(b); continue; }
        splitBlock(b, title);
      }
    }

    function splitBlock(b, title) {
      var units = b.units;
      var i = 0;
      while (i < units.length) {
        var avail = cfg.bottom - st.y;
        var n = 0;
        var acc = 0;
        while (i + n < units.length && acc + units[i + n].h <= avail + EPS) { acc += units[i + n].h; n++; }
        var rest = units.length - i;
        if (n < rest) {
          if (rest - n === 1 && n >= 3) n--;                    // never carry a single line over
          if (n < 2 && st.placed > 0) { newPage(pageSong[pageSong.length - 1]); continue; }
        }
        if (n === 0) {
          n = 1;
          ctx.warnings.push('A line of "' + title + '" is taller than the page.');
        }
        for (var k = 0; k < n; k++) placeUnit(units[i + k]);
        st.placed++;
        i += n;
        if (i < units.length) newPage(pageSong[pageSong.length - 1]);
      }
    }

    function fillToc() {
      var f = cfg.fonts;
      var left = cfg.margin.left;
      var numW = ctx.measure(String(sheets.length) + '.', f.toc) + f.toc.size * 0.6;
      var page = pages[0];
      function put(o) { page.ops.push(o); }
      put({ type: 'text', x: left, y: cfg.margin.top + f.title.size * 0.95, text: fitText(setName, f.title, cfg.right - left, ctx), font: f.title, color: cfg.colors.text });
      songs.forEach(function (s, i) {
        // the same arithmetic that reserved the contents pages
        var p = i < tocFirst ? 0 : 1 + Math.floor((i - tocFirst) / tocPer);
        var slot = i < tocFirst ? i : (i - tocFirst) % tocPer;
        page = pages[p];
        var y = cfg.margin.top + (p === 0 ? tocTitleH : 0) + slot * cfg.tocRowH;
        var base = y + cfg.tocRowH * 0.65;
        var num = String(s.firstPage);
        var numRight = ctx.measure(num, f.toc);
        var meta = ctx.clean(U.tocMeta(sheets[i]));
        var metaW = meta ? ctx.measure(meta, f.tocMeta) + f.toc.size : 0;
        var titleMax = cfg.right - (left + numW) - numRight - f.toc.size * 1.5 - metaW;
        var title = fitText(s.title, f.toc, Math.max(titleMax, f.toc.size * 3), ctx);
        put({ type: 'text', x: left, y: base, text: (i + 1) + '.', font: f.toc, color: cfg.colors.text });
        put({ type: 'text', x: left + numW, y: base, text: title, font: f.toc, color: cfg.colors.text });
        if (meta) {
          put({ type: 'text', x: left + numW + ctx.measure(title, f.toc) + f.toc.size * 0.8, y: base, text: meta, font: f.tocMeta, color: cfg.colors.meta });
        }
        put({ type: 'text', x: cfg.right - numRight, y: base, text: num, font: f.toc, color: cfg.colors.text });
        put({ type: 'link', x: left, y: y, w: cfg.right - left, h: cfg.tocRowH, page: s.firstPage });
      });
    }

    function stampFooters() {
      var n = pages.length;
      if (n < 2) return;
      var f = cfg.fonts.footer;
      var y = cfg.pageSize.h - cfg.margin.bottom / 2 + f.size / 3;
      pages.forEach(function (page, i) {
        var label = String(i + 1) + ' / ' + n;
        page.ops.push({ type: 'text', x: cfg.right - ctx.measure(label, f), y: y, text: label, font: f, color: cfg.colors.footer });
        var si = pageSong[i];
        var left = isSet ? (si >= 0 ? setName + ' · ' + songs[si].title : setName) : songs[0].title;
        var maxW = cfg.right - cfg.margin.left - ctx.measure(label, f) - f.size * 2;
        page.ops.push({ type: 'text', x: cfg.margin.left, y: y, text: fitText(left, f, maxW, ctx), font: f, color: cfg.colors.footer });
      });
    }
  }

  var api = {
    layoutPdf: layoutPdf,
    breakLineIntoRows: breakLineIntoRows,
    measureBlock: measureBlock,
    resolveConfig: resolveConfig,
    makeContext: makeContext,
    PAGE_SIZES: PAGE_SIZES
  };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.export = root.SongSheets.export || {};
  root.SongSheets.export.pdfLayout = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
