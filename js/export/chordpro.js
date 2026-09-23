/* Songsheets — ChordPro export and import, and "chords over lyrics" text conversion.
 *
 * exportChordPro(sheets, opts) -> string
 *   {title} {artist} {subtitle}+{x_songsheets_tune} (tune) {key} {capo}, numbered stanzas as
 *   {start_of_verse: label="N"}…{end_of_verse}, choruses as {start_of_chorus}…{end_of_chorus},
 *   comments as {comment: …}, songs of a set separated by {new_song}. Bold/italic markers are
 *   dropped (ChordPro has no portable markup); the tie ‿ is kept.
 * importChordPro(text, {filename}) -> [{title, author, lyrics, warnings}]   (songbase text, one per song)
 * twoLineToInline(text) -> text with chord rows merged into the lyric below as [brackets]
 * isChordLine(line, nextLine) -> boolean;  parseDirective(line) -> {name, arg, attrs}|null
 * Browser: window.SongSheets.export.chordpro   Node: require('./chordpro.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var U = isNode ? require('./util.js') : root.SongSheets.export.util;
  var C = isNode ? require('../core/chords.js') : root.SongSheets.chords;
  var N = isNode ? require('../core/normalize.js') : root.SongSheets.normalize;

  var TIE = '‿';
  var TUNE_DIRECTIVE = 'x_songsheets_tune';

  // ---- export ---------------------------------------------------------------------------------

  function directive(name, value) {
    return '{' + name + ': ' + String(value).replace(/[\r\n]+/g, ' ').trim() + '}';
  }

  function inlineLine(line) {
    return line.segments.map(function (s) {
      return (s.chord !== null && s.chord !== undefined ? '[' + s.chord + ']' : '') + s.text;
    }).join('').replace(/\s+$/, '');
  }

  function songLines(sheet) {
    var out = [directive('title', sheet.title)];
    if (sheet.author) out.push(directive('artist', sheet.author));
    if (sheet.tuneTitle) {
      out.push(directive('subtitle', sheet.tuneTitle));
      out.push(directive(TUNE_DIRECTIVE, sheet.tuneTitle));
    }
    if (sheet.showChords !== false && sheet.targetKeyLabel) out.push(directive('key', sheet.targetKeyLabel));
    var capo = U.effectiveCapo(sheet);
    if (capo) out.push(directive('capo', capo));
    out.push('');
    sheet.blocks.forEach(function (b) {
      if (b.kind === 'blank') {
        out.push('');
      } else if (b.kind === 'stanza') {
        var body = b.lines.map(inlineLine);
        if (b.number) out.push('{start_of_verse: label="' + b.number + '"}');
        out = out.concat(body);
        if (b.number) out.push('{end_of_verse}');
      } else if (b.kind === 'chorus') {
        out.push('{start_of_chorus}');
        b.lines.forEach(function (l) {
          var text = U.spaces(Math.max(0, l.indent || 0)) + inlineLine(l);
          // a line starting with # is a ChordPro source comment; one space keeps it a lyric
          out.push(/^#/.test(text) ? ' ' + text : text);
        });
        out.push('{end_of_chorus}');
      } else if (b.kind === 'comment') {
        var t = U.blockText(b).trim();
        if (t) out.push(directive('comment', t));
      } else if (b.kind === 'capo') {
        // the effective capo is already in the header; keep only wording that says more than "Capo N"
        if (!b.active && !(b.n === capo && /^capo\s*:?\s*\d{1,2}$/i.test(String(b.text).trim()))) {
          out.push(directive('comment', b.text));
        }
      }
      // key blocks: represented by {key} in the header
    });
    // skipped capo/key blocks leave their blank lines behind: collapse runs
    out = out.filter(function (l, i) { return l !== '' || out[i - 1] !== ''; });
    while (out.length && out[out.length - 1] === '') out.pop();
    return out;
  }

  function exportChordPro(sheets, opts) {
    opts = opts || {};
    var songs = sheets.map(function (s) { return songLines(s).join('\n'); });
    var text = songs.join('\n\n{new_song}\n');
    if (U.isSet(sheets)) text = '# ' + U.setName(sheets, opts) + '\n' + text;
    return U.eol(text + '\n', opts.lineEnding);
  }

  // ---- directives -----------------------------------------------------------------------------

  var DIRECTIVE_RE = /^\s*\{\s*([A-Za-z_][\w-]*)\s*(?::\s*([\s\S]*?)|\s+([\s\S]*?))?\s*\}\s*$/;
  var ATTR_RE = /([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;

  function parseDirective(line) {
    var m = DIRECTIVE_RE.exec(String(line));
    if (!m) return null;
    var name = m[1].toLowerCase();
    var arg = (m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : '').trim();
    var attrs = {};
    if (/^[A-Za-z_][\w-]*\s*=/.test(arg)) {
      var a;
      ATTR_RE.lastIndex = 0;
      while ((a = ATTR_RE.exec(arg))) attrs[a[1].toLowerCase()] = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4];
    }
    // ChordPro 6 selectors ({comment-guitar: …}) apply the directive; the selector is dropped
    var dash = name.indexOf('-');
    return { name: dash > 0 ? name.slice(0, dash) : name, arg: arg, attrs: attrs };
  }

  var ALIASES = {
    t: 'title', st: 'subtitle', c: 'comment', ci: 'comment', cb: 'comment', comment_italic: 'comment',
    comment_box: 'comment', comment_bold: 'comment', highlight: 'comment', gc: 'comment', guitar_comment: 'comment',
    soc: 'start_of_chorus', eoc: 'end_of_chorus', sov: 'start_of_verse', eov: 'end_of_verse',
    sob: 'start_of_bridge', eob: 'end_of_bridge', sot: 'start_of_tab', eot: 'end_of_tab',
    sog: 'start_of_grid', eog: 'end_of_grid', ns: 'new_song', np: 'new_page', npp: 'new_physical_page',
    colb: 'column_break', composer: 'artist', lyricist: 'artist'
  };

  // ---- two-line ("chords over lyrics") --------------------------------------------------------

  var FILLER_RE = /^(?:\|+|:?\|\|?:?|-+|–|\/+|%|\*+|x\d+|\(x\d+\)|\.{2,}|,)$/i;
  var NC_RE = /^\(?N\.?C\.?\)?$/i;

  function isChordToken(tok) {
    if (NC_RE.test(tok)) return true;
    var parts = C.parseChordToken(tok);
    var chords = 0;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].kind === 'chord') chords++;
      else if (parts[i].kind !== 'sep') return false;
    }
    return chords > 0;
  }

  function tokensOf(line) {
    var t = String(line).trim();
    return t ? t.split(/\s+/) : [];
  }

  /** Every token is a chord or filler, and at least one is a chord. */
  function chordCandidate(line) {
    if (/[[\]]/.test(line)) return false;
    var toks = tokensOf(line);
    if (!toks.length) return false;
    var chords = 0;
    for (var i = 0; i < toks.length; i++) {
      if (isChordToken(toks[i])) chords++;
      else if (!FILLER_RE.test(toks[i])) return false;
    }
    return chords > 0;
  }

  /** A single token ("A", "Am") only counts as chords when a lyric line follows. */
  function isChordLine(line, nextLine) {
    if (!chordCandidate(line)) return false;
    if (tokensOf(line).length >= 2) return true;
    return nextLine != null && String(nextLine).trim() !== '' && !chordCandidate(nextLine);
  }

  function expandTabs8(s) {
    var out = '';
    var col = 0;
    U.graphemes(s).forEach(function (g) {
      if (g === '\t') { var n = 8 - (col % 8); out += U.spaces(n); col += n; }
      else { out += g; col += U.clusterWidth(g); }
    });
    return out;
  }

  /** Put each chord of chordLine into lyric at the same display column. */
  function mergeChordLine(chordLine, lyric) {
    var cl = expandTabs8(chordLine);
    var gs = U.graphemes(expandTabs8(lyric));
    var starts = [];
    var col = 0;
    gs.forEach(function (g) { starts.push(col); col += U.clusterWidth(g); });
    var toks = [];
    var re = /\S+/g;
    var m;
    while ((m = re.exec(cl))) toks.push({ col: U.cells(cl.slice(0, m.index)), text: m[0] });
    if (!toks.length) return gs.join('');
    // chords past the end of the lyric keep their column: pad the lyric out to the last one
    for (var last = toks[toks.length - 1].col; col < last; col++) { starts.push(col); gs.push(' '); }
    // insert right to left, so the grapheme indexes still to be used are not shifted
    for (var i = toks.length - 1; i >= 0; i--) {
      var at = 0;
      while (at < starts.length && starts[at] < toks[i].col) at++;
      gs.splice(at, 0, '[' + toks[i].text + ']');
    }
    return gs.join('');
  }

  function dedent(lines) {
    var min = Infinity;
    lines.forEach(function (l) {
      if (l.trim()) min = Math.min(min, /^ */.exec(l)[0].length);
    });
    if (!isFinite(min) || min === 0) return lines;
    return lines.map(function (l) { return l.slice(Math.min(min, /^ */.exec(l)[0].length)); });
  }

  /** Whole-text conversion: common indentation removed, relative indentation (choruses) kept. */
  function twoLineToInline(text) {
    var lines = N.splitLines(text).map(function (l) { return expandTabs8(N.trimLineEnd(l)); });
    return twoLineMerge(dedent(lines)).join('\n');
  }

  // ---- import ---------------------------------------------------------------------------------

  function verseLabel(d) {
    var label = (d.attrs.label !== undefined ? d.attrs.label : d.arg).trim();
    if (!label) return { number: null, comment: null };
    var m = /^(?:[^\d]*?\s)?(\d{1,3})\.?$/.exec(label);
    if (m) return { number: m[1], comment: null };
    return { number: null, comment: label };
  }

  function splitSongs(lines) {
    var songs = [[]];
    lines.forEach(function (l) {
      var d = /^\s*\{/.test(l) ? parseDirective(l) : null;
      if (d && (ALIASES[d.name] || d.name) === 'new_song') songs.push([]);
      else songs[songs.length - 1].push(l);
    });
    return songs.filter(function (s) { return s.some(function (l) { return l.trim() !== ''; }); });
  }

  /** One ChordPro song (lines) -> {title, author, lyrics, warnings}. */
  function importSong(lines) {
    var meta = { title: null, authors: [], subtitle: null, tune: null };
    var ignored = {};
    var events = [];                            // {t:'lyric', text, sect, id} | {t:'out', text}
    var sect = 'none';
    var sectId = 0;
    var pendingNumber = null;

    function out(text) { events.push({ t: 'out', text: text }); }
    function blank() { events.push({ t: 'out', text: '' }); }
    function open(kind) { sect = kind; sectId++; }
    function close() { sect = 'none'; sectId++; blank(); }

    lines.forEach(function (raw) {
      var line = N.trimLineEnd(raw);
      if (/^#/.test(line)) return;                                // ChordPro source comment
      var d = /^\s*\{/.test(line) ? parseDirective(line) : null;
      if (!d) {
        if (sect === 'tab') { if (line.trim()) out('# ' + line); return; }
        if (!line.trim()) { blank(); sectId++; return; }
        if (pendingNumber) { out(pendingNumber); pendingNumber = null; }
        events.push({ t: 'lyric', text: line, sect: sect, id: sectId });
        return;
      }
      var name = ALIASES[d.name] || d.name;
      if (name === 'meta') {
        var mm = /^(\S+)\s+([\s\S]*)$/.exec(d.arg);
        if (!mm) { ignored.meta = (ignored.meta || 0) + 1; return; }
        name = ALIASES[mm[1].toLowerCase()] || mm[1].toLowerCase();
        d = { name: name, arg: mm[2].trim(), attrs: {} };
        if (['title', 'subtitle', 'artist', 'key', 'capo'].indexOf(name) < 0) { ignored['meta ' + name] = (ignored['meta ' + name] || 0) + 1; return; }
      }
      switch (name) {
        case 'title': if (meta.title === null && d.arg) meta.title = d.arg; break;
        case 'subtitle': if (meta.subtitle === null && d.arg) meta.subtitle = d.arg; break;
        case TUNE_DIRECTIVE: if (d.arg) meta.tune = d.arg; break;
        case 'artist': if (d.arg && meta.authors.indexOf(d.arg) < 0) meta.authors.push(d.arg); break;
        case 'key': if (d.arg) out('# Key: ' + d.arg); break;
        case 'capo': if (d.arg) out('# Capo ' + d.arg); break;
        case 'comment': if (d.arg) out('# ' + d.arg); break;
        case 'chorus': out('# ' + (d.attrs.label || d.arg || 'Chorus')); break;
        case 'start_of_chorus': {
          blank();
          var cl = (d.attrs.label !== undefined ? d.attrs.label : d.arg).trim();
          if (cl && !/^chorus$/i.test(cl)) out('# ' + cl);
          open('chorus');
          break;
        }
        case 'start_of_verse': {
          blank();
          var v = verseLabel(d);
          if (v.comment) out('# ' + v.comment);
          pendingNumber = v.number;
          open('verse');
          break;
        }
        case 'start_of_bridge': {
          blank();
          out('# ' + ((d.attrs.label !== undefined ? d.attrs.label : d.arg).trim() || 'Bridge'));
          open('verse');
          break;
        }
        case 'start_of_tab': case 'start_of_grid': blank(); open('tab'); break;
        case 'end_of_chorus': case 'end_of_verse': case 'end_of_bridge': case 'end_of_tab': case 'end_of_grid':
          if (pendingNumber) { out(pendingNumber); pendingNumber = null; }
          close();
          break;
        case 'new_page': case 'new_physical_page': case 'column_break': blank(); break;
        default:
          if (/^start_of_/.test(name)) { blank(); open('tab'); ignored[name] = (ignored[name] || 0) + 1; }
          else if (/^end_of_/.test(name)) close();
          else ignored[name] = (ignored[name] || 0) + 1;
      }
    });

    // chords written above the lyrics instead of inline
    var anyBracket = events.some(function (e) { return e.t === 'lyric' && /\[[^\]]*\]/.test(e.text); });
    if (!anyBracket) events = mergeTwoLineRuns(events);

    var outLines = [];
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.t === 'out') { outLines.push(e.text); continue; }
      var run = [];
      var j = i;
      while (j < events.length && events[j].t === 'lyric' && events[j].id === e.id) { run.push(events[j].text); j++; }
      if (e.sect === 'chorus') {
        dedent(run).forEach(function (l) { outLines.push('  ' + l); });
      } else {
        run.forEach(function (l) { outLines.push(l.replace(/^\s+/, '')); });
      }
      i = j - 1;
    }

    var header = [];
    if (meta.tune) header.push('### ' + meta.tune);
    var authors = meta.authors.slice();
    if (meta.subtitle && !meta.tune) {
      if (!authors.length) authors.push(meta.subtitle);
      else header.push('# ' + meta.subtitle);
    }
    var lyrics = N.normalizeText(header.concat(outLines).join('\n').replace(/\n[ \t]*(?:\n[ \t]*)+\n/g, '\n\n'));
    lyrics = lyrics.split(TIE).join('_');
    var warnings = [];
    var names = Object.keys(ignored);
    if (names.length) {
      var count = names.reduce(function (n, k) { return n + ignored[k]; }, 0);
      warnings.push('Ignored ' + count + ' ChordPro directive' + (count === 1 ? '' : 's') + ': ' + names.join(', '));
    }
    return { title: meta.title, author: authors.length ? authors.join(', ') : null, lyrics: lyrics, warnings: warnings };
  }

  /** Merge chord rows into the lyric row below, within each run of lyric lines of one section. */
  function mergeTwoLineRuns(events) {
    var out = [];
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.t !== 'lyric') { out.push(e); continue; }
      var run = [];
      var j = i;
      while (j < events.length && events[j].t === 'lyric' && events[j].id === e.id) { run.push(events[j].text); j++; }
      var merged = twoLineMerge(run);
      merged.forEach(function (text) { out.push({ t: 'lyric', text: text, sect: e.sect, id: e.id }); });
      i = j - 1;
    }
    return out;
  }

  /** Chord row + lyric row -> one inline line; a chord row with no lyric below becomes
   *  an instrumental line "[G]  | [C]" (chords bracketed, bar lines and repeats left as text). */
  function twoLineMerge(lines) {
    var ls = lines.map(expandTabs8);
    var out = [];
    for (var i = 0; i < ls.length; i++) {
      var next = i + 1 < ls.length ? ls[i + 1] : null;
      if (isChordLine(ls[i], next)) {
        if (next !== null && next.trim() !== '' && !chordCandidate(next)) { out.push(mergeChordLine(ls[i], next)); i++; }
        else out.push(ls[i].trim().replace(/\S+/g, function (t) { return isChordToken(t) ? '[' + t + ']' : t; }));
      } else {
        out.push(ls[i]);
      }
    }
    return out;
  }

  function importChordPro(text, opts) {
    opts = opts || {};
    var lines = N.splitLines(String(text == null ? '' : text).replace(/^\ufeff/, ''));
    var fallback = U.titleFromFilename(opts.filename, 'Untitled');
    var songs = splitSongs(lines).map(importSong);
    songs.forEach(function (s, i) {
      if (!s.title) s.title = songs.length > 1 ? fallback + ' ' + (i + 1) : fallback;
    });
    return songs;
  }

  var api = {
    exportChordPro: exportChordPro,
    importChordPro: importChordPro,
    parseDirective: parseDirective,
    isChordLine: isChordLine,
    isChordToken: isChordToken,
    twoLineToInline: twoLineToInline,
    mergeChordLine: mergeChordLine,
    TUNE_DIRECTIVE: TUNE_DIRECTIVE
  };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.export = root.SongSheets.export || {};
  root.SongSheets.export.chordpro = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
