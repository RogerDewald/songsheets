/* Songsheets — parser for songbase-format song text.
 *
 * Format (songbase compatible):
 *   [G]chords go right before the syllable, mid-word is fine: ex[F]act
 *   stanza   = run of normal lines;  chorus = lines starting with two spaces
 *   1        = a line with only digits is the number of the stanza below it
 *   # text   = comment;  # Capo 2 = capo preset;  # Key: Em = key override
 *   ### Name = starts an alternative tune
 *   **bold**, *italic*, and _ becomes a musical tie
 *
 * parse(text) -> Song (never throws)
 *   Song    = { tunes: Tune[], hasChords }
 *   Tune    = { index, title, explicitTitle, titleLine, lineStart, lineEnd, blocks: Block[], hasChords }
 *   Block   = {kind:'stanza', number:string|null, lines:Line[]} | {kind:'chorus', lines:Line[]}
 *           | {kind:'comment', text, runs:Run[], hidesWithChords, line} | {kind:'capo', n, text, line}
 *           | {kind:'key', key, text, line} | {kind:'blank', line}
 *   Line    = { indent, segments: Segment[], hasChords, raw, line }
 *   Segment = { chord: string|null, text: string, runs: Run[] }   (text === runs' text joined)
 *   Run     = { text, bold?, italic?, tie? }
 * Browser: window.SongSheets.parser   Node: require('./parser.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var N = isNode ? require('./normalize.js') : root.SongSheets.normalize;

  var TIE = '‿';                              // ‿
  var CHORD_RE = /\[([^\]]*)\]/g;
  var TUNE_RE = /^###(?!#)\s*(.*)$/;
  var CAPO_RE = /\bcapo\s*:?\s*(\d{1,2})\b/i;
  var CAPO_ONLY_RE = /^capo\s*:?\s*\d{1,2}$/i;
  var KEY_RE = /^[Kk][Ee][Yy]\s*[:=]?\s*([A-G])(#|b|♯|♭)?\s*(m|min|minor|Min|Minor|maj|major|Maj|Major)?\.?$/;

  // ---- inline marks ---------------------------------------------------------------------------

  /** Content string -> atoms: {ch} for each character, {chord} for each [bracket]. */
  function toAtoms(content, withChords) {
    var atoms = [];
    function pushText(t) {
      for (var i = 0; i < t.length; i++) atoms.push({ ch: t[i] });
    }
    if (!withChords) { pushText(content); return atoms; }
    var last = 0;
    var m;
    CHORD_RE.lastIndex = 0;
    while ((m = CHORD_RE.exec(content))) {
      pushText(content.slice(last, m.index));
      atoms.push({ chord: m[1] });
      last = CHORD_RE.lastIndex;
    }
    pushText(content.slice(last));
    return atoms;
  }

  /** Apply **bold**, *italic* and _ ties to character atoms (chords are skipped over). */
  function applyMarks(atoms) {
    function charView() {
      var idx = [];
      var s = '';
      atoms.forEach(function (a, i) {
        if (a.ch !== undefined && !a.removed) { idx.push(i); s += a.ch; }
      });
      return { idx: idx, s: s };
    }
    function mark(re, flag, markerLen) {
      var v = charView();
      var m;
      re.lastIndex = 0;
      while ((m = re.exec(v.s))) {
        var start = m.index;
        var end = m.index + m[0].length;
        for (var k = start; k < end; k++) {
          var atom = atoms[v.idx[k]];
          if (k < start + markerLen || k >= end - markerLen) atom.removed = true;
          else atom[flag] = true;
        }
      }
    }
    mark(/\*\*(.+?)\*\*/g, 'bold', 2);
    mark(/\*(.+?)\*/g, 'italic', 1);
    atoms.forEach(function (a) {
      if (a.ch === '_' && !a.removed) { a.ch = TIE; a.tie = true; }
    });
    return atoms.filter(function (a) { return !a.removed; });
  }

  function sameFlags(run, a) {
    return !!run.bold === !!a.bold && !!run.italic === !!a.italic && !!run.tie === !!a.tie && !run.tie;
  }

  function newRun(a) {
    var r = { text: a.ch };
    if (a.bold) r.bold = true;
    if (a.italic) r.italic = true;
    if (a.tie) r.tie = true;
    return r;
  }

  function atomsToRuns(atoms) {
    var runs = [];
    atoms.forEach(function (a) {
      var last = runs[runs.length - 1];
      if (last && sameFlags(last, a)) last.text += a.ch;
      else runs.push(newRun(a));
    });
    return runs;
  }

  function finishSegment(seg) {
    seg.text = seg.runs.map(function (r) { return r.text; }).join('');
    return seg;
  }

  /** Content with chords -> segments. */
  function parseSegments(content) {
    var atoms = applyMarks(toAtoms(content, true));
    var segs = [];
    var cur = { chord: null, runs: [] };
    atoms.forEach(function (a) {
      if (a.chord !== undefined) {
        segs.push(finishSegment(cur));
        cur = { chord: a.chord, runs: [] };
        return;
      }
      var last = cur.runs[cur.runs.length - 1];
      if (last && sameFlags(last, a)) last.text += a.ch;
      else cur.runs.push(newRun(a));
    });
    segs.push(finishSegment(cur));
    if (segs.length > 1 && segs[0].chord === null && segs[0].text === '') segs.shift();
    return segs;
  }

  function parseInline(text) {
    return atomsToRuns(applyMarks(toAtoms(text, false)));
  }

  function makeLine(content, indent, raw, lineNo) {
    var segments = parseSegments(content);
    return {
      indent: indent,
      segments: segments,
      hasChords: segments.some(function (s) { return s.chord !== null; }),
      raw: raw,
      line: lineNo
    };
  }

  // ---- blocks ---------------------------------------------------------------------------------

  function classifyComment(L, lineNo) {
    var text = L.replace(/^#\s?/, '');
    var capo = CAPO_RE.exec(text);
    if (capo) {
      var n = parseInt(capo[1], 10);
      if (n >= 1 && n <= 11) {
        return { kind: 'capo', n: n, text: CAPO_ONLY_RE.test(text.trim()) ? 'Capo ' + n : text, line: lineNo };
      }
    }
    var key = KEY_RE.exec(text.trim());
    if (key) {
      var acc = (key[2] || '').replace('♯', '#').replace('♭', 'b');
      var minor = !!key[3] && /^m(in)?/i.test(key[3]) && !/^maj/i.test(key[3]) && key[3] !== 'M';
      return { kind: 'key', key: key[1] + acc + (minor ? 'm' : ''), text: text, line: lineNo };
    }
    return { kind: 'comment', text: text, runs: parseInline(text), hidesWithChords: /\btune\b/i.test(text), line: lineNo };
  }

  function newTune(index, title, explicit, titleLine, lineStart) {
    return { index: index, title: title, explicitTitle: explicit, titleLine: titleLine, lineStart: lineStart, lineEnd: lineStart, blocks: [], hasChords: false };
  }

  function parse(text) {
    var lines = N.splitLines(text == null ? '' : String(text));
    var tunes = [];
    var tune = newTune(0, 'Tune 1', false, null, 0);
    tunes.push(tune);
    var open = null;                              // the stanza or chorus block lines are added to

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var L = N.trimLineEnd(raw);

      if (L === '') {
        tune.blocks.push({ kind: 'blank', line: i });
        open = null;
        continue;
      }

      var t = TUNE_RE.exec(L);
      if (t) {
        var title = t[1].trim();
        var onlyBlanks = tune.blocks.every(function (b) { return b.kind === 'blank'; });
        tune.lineEnd = i;
        if (tunes.length === 1 && !tune.explicitTitle && onlyBlanks) {
          tune.title = title || 'Tune 1';
          tune.explicitTitle = true;
          tune.titleLine = i;
          tune.lineStart = i + 1;
          tune.blocks = [];
        } else {
          tune = newTune(tunes.length, title || 'Tune ' + (tunes.length + 1), true, i, i + 1);
          tunes.push(tune);
        }
        open = null;
        continue;
      }

      if (L.charAt(0) === '#') {
        tune.blocks.push(classifyComment(L, i));
        open = null;
        continue;
      }

      if (/^ {2}/.test(L)) {
        var spaces = /^ */.exec(L)[0].length;
        if (!open || open.kind !== 'chorus') {
          open = { kind: 'chorus', lines: [] };
          tune.blocks.push(open);
        }
        open.lines.push(makeLine(L.slice(spaces), spaces - 2, raw, i));
        continue;
      }

      if (/^\d+$/.test(L)) {
        open = { kind: 'stanza', number: L, lines: [] };
        tune.blocks.push(open);
        continue;
      }

      if (!open || open.kind !== 'stanza') {
        open = { kind: 'stanza', number: null, lines: [] };
        tune.blocks.push(open);
      }
      open.lines.push(makeLine(L, 0, raw, i));
    }
    tune.lineEnd = lines.length;

    tunes.forEach(function (tn) {
      while (tn.blocks.length && tn.blocks[0].kind === 'blank') tn.blocks.shift();
      while (tn.blocks.length && tn.blocks[tn.blocks.length - 1].kind === 'blank') tn.blocks.pop();
      tn.hasChords = tn.blocks.some(function (b) {
        return b.lines && b.lines.some(function (l) { return l.hasChords; });
      });
    });

    return {
      tunes: tunes,
      hasChords: tunes.some(function (tn) { return tn.hasChords; })
    };
  }

  /** Every chord string in a tune's lyric lines, in order (spacer [] chords excluded). */
  function tuneChords(tune) {
    var out = [];
    tune.blocks.forEach(function (b) {
      if (!b.lines) return;
      b.lines.forEach(function (l) {
        l.segments.forEach(function (s) { if (s.chord) out.push(s.chord); });
      });
    });
    return out;
  }

  /** The "# Key: X" override of a tune, or null. */
  function tuneKeyOverride(tune) {
    for (var i = 0; i < tune.blocks.length; i++) if (tune.blocks[i].kind === 'key') return tune.blocks[i].key;
    return null;
  }

  var api = {
    TIE: TIE,
    parse: parse,
    parseInline: parseInline,
    parseSegments: parseSegments,
    tuneChords: tuneChords,
    tuneKeyOverride: tuneKeyOverride
  };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.parser = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
