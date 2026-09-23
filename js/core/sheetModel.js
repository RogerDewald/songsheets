/* Songsheets — the display model shared by the screen renderer, print and every exporter.
 *
 * buildSheet(song, opts) -> Sheet
 *   Sheet = { id, songId, title, author, tags,
 *             tuneIndex, tuneTitle, tuneTitles, tuneCount,
 *             key, transpose, transposeSigned, displayTranspose, targetKey, targetKeyLabel, accidentals,
 *             capo: {n, source:'text'|'override', active}|null,
 *             showChords, hasChords, sourceHasChords,
 *             blocks: SheetBlock[], source: {text, fullText, tuneIndex}, setContext }
 *   SheetBlock = {kind:'stanza', number, lines} | {kind:'chorus', lines} | {kind:'comment', text, runs}
 *              | {kind:'capo', n, text, active} | {kind:'key', key, text} | {kind:'blank'}
 *   SheetLine  = {indent, hasChords, segments:[{chord: FINAL display string|null, text, runs}]}
 *
 * Guarantees: chords are final strings (transposed and respelled); exporters never transpose.
 * With showChords false every chord is null and capo/key/"tune" comments are removed (songbase).
 * Browser: window.SongSheets.sheetModel   Node: require('./sheetModel.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var N = isNode ? require('./normalize.js') : root.SongSheets.normalize;
  var T = isNode ? require('./transpose.js') : root.SongSheets.transpose;
  var P = isNode ? require('./parser.js') : root.SongSheets.parser;

  var mod = T.mod;
  var BRACKET_RE = /\[([^\]]*)\]/g;

  function pick(a, b, c) {
    if (a !== undefined && a !== null) return a;
    if (b !== undefined && b !== null) return b;
    return c;
  }

  function tuneKey(tune) {
    return T.detectKey(P.tuneChords(tune), { override: P.tuneKeyOverride(tune) });
  }

  function mapRuns(runs, fn) {
    return runs.map(function (r) {
      var o = {};
      for (var k in r) o[k] = r[k];
      o.text = fn(r.text);
      return o;
    });
  }

  function isBlankText(s) { return /^\s*$/.test(s); }

  /** Build the display model for one song. */
  function buildSheet(song, opts) {
    song = song || {};
    opts = opts || {};
    var ast = opts.ast || P.parse(song.lyrics || '');
    var tuneIndex = pick(opts.tuneIndex, song.tuneIndex, 0);
    tuneIndex = Math.max(0, Math.min(ast.tunes.length - 1, tuneIndex | 0));
    var tune = ast.tunes[tuneIndex];
    var showChords = opts.showChords !== false;
    var accidentals = pick(opts.accidentals, song.accidentals, 'auto');
    var transpose = mod(pick(opts.transpose, song.transpose, 0) | 0, 12);
    var key = tuneKey(tune);

    var textCapo = null;
    tune.blocks.forEach(function (b) { if (b.kind === 'capo' && textCapo === null) textCapo = b.n; });
    var capoOverride = opts.capoOverride;
    var capo = null;
    if (typeof capoOverride === 'number' && capoOverride > 0) {
      capo = { n: capoOverride, source: 'override', active: true };
    } else if (textCapo !== null) {
      capo = { n: textCapo, source: 'text', active: transpose === textCapo };
    }
    var displayTranspose = mod(transpose - (capo && capo.source === 'override' ? capo.n : 0), 12);
    var mapper = T.makeChordMapper({ fromKey: key ? key.major : null, semitones: displayTranspose, accidentals: accidentals });
    var targetKey = key ? T.targetKey(key.major, displayTranspose) : null;
    var targetKeyLabel = key ? T.keyLabel(key, displayTranspose, accidentals) : null;

    function commentText(s) {
      return s.replace(BRACKET_RE, function (m, inner) { return showChords ? '[' + mapper(inner) + ']' : ''; });
    }

    function mapLine(l) {
      var segments = l.segments.map(function (s) {
        return { chord: showChords ? (s.chord === null ? null : mapper(s.chord)) : null, text: s.text, runs: s.runs };
      });
      if (!showChords) {
        // merge chord-less segments into one, so exporters see plain lines
        var runs = [];
        segments.forEach(function (s) { runs = runs.concat(s.runs); });
        segments = [{ chord: null, text: segments.map(function (s) { return s.text; }).join(''), runs: runs }];
      }
      return { indent: l.indent, hasChords: showChords && l.hasChords, segments: segments };
    }

    var blocks = [];
    var skipNextBlank = false;
    tune.blocks.forEach(function (b) {
      if (b.kind === 'blank') {
        if (skipNextBlank) { skipNextBlank = false; return; }
        blocks.push({ kind: 'blank' });
        return;
      }
      skipNextBlank = false;
      if (b.kind === 'stanza' || b.kind === 'chorus') {
        var lines = b.lines.map(mapLine);
        if (!showChords) {
          lines = lines.filter(function (l) { return !isBlankText(l.segments[0].text); });
          if (!lines.length && !b.number) { skipNextBlank = true; return; }
        }
        var out = { kind: b.kind, lines: lines };
        if (b.kind === 'stanza') out.number = b.number;
        blocks.push(out);
      } else if (b.kind === 'comment') {
        if (!showChords && b.hidesWithChords) { skipNextBlank = true; return; }
        var text = commentText(b.text);
        if (isBlankText(text)) { skipNextBlank = true; return; }
        blocks.push({ kind: 'comment', text: text, runs: mapRuns(b.runs, commentText) });
      } else if (b.kind === 'capo') {
        if (!showChords || (capo && capo.source === 'override')) { skipNextBlank = true; return; }
        blocks.push({ kind: 'capo', n: b.n, text: b.text, active: transpose === b.n });
      } else if (b.kind === 'key') {
        if (!showChords) { skipNextBlank = true; return; }
        var ktext = displayTranspose === 0 && accidentals === 'auto' ? b.text : 'Key: ' + targetKeyLabel;
        blocks.push({ kind: 'key', key: targetKeyLabel, text: ktext });
      }
    });
    while (blocks.length && blocks[0].kind === 'blank') blocks.shift();
    while (blocks.length && blocks[blocks.length - 1].kind === 'blank') blocks.pop();

    var srcLines = N.splitLines(song.lyrics || '').slice(tune.lineStart, tune.lineEnd);
    while (srcLines.length && N.trimLineEnd(srcLines[0]) === '') srcLines.shift();
    while (srcLines.length && N.trimLineEnd(srcLines[srcLines.length - 1]) === '') srcLines.pop();

    var signed = transpose > 6 ? transpose - 12 : transpose;
    return {
      id: song.id || null,
      songId: song.id || null,
      title: song.title || 'Untitled',
      author: song.author || null,
      tags: song.tags || [],
      tuneIndex: tuneIndex,
      tuneTitle: ast.tunes.length > 1 || tune.explicitTitle ? tune.title : null,
      tuneTitles: ast.tunes.map(function (t) { return t.title; }),
      tuneCount: ast.tunes.length,
      key: key,
      transpose: transpose,
      transposeSigned: signed,
      displayTranspose: displayTranspose,
      targetKey: targetKey,
      targetKeyLabel: targetKeyLabel,
      accidentals: accidentals,
      capo: showChords ? capo : null,
      showChords: showChords,
      hasChords: showChords && tune.hasChords,
      sourceHasChords: tune.hasChords,
      blocks: blocks,
      source: { text: srcLines.join('\n'), fullText: song.lyrics || '', tuneIndex: tuneIndex },
      setContext: opts.setContext || null
    };
  }

  /** Sheets for a set list, applying each item's overrides.
   *  item = {songId, transpose|null, capo|null, tuneIndex|null}; getSong(id) -> song|undefined */
  function buildSetSheets(set, getSong, settings) {
    settings = settings || {};
    var items = (set && set.items) || [];
    var sheets = [];
    items.forEach(function (item) {
      var song = getSong(item.songId);
      if (!song) return;
      sheets.push(buildSheet(song, {
        tuneIndex: pick(item.tuneIndex, song.tuneIndex, 0),
        transpose: pick(item.transpose, song.transpose, 0),
        accidentals: pick(song.accidentals, settings.accidentals, 'auto'),
        showChords: settings.showChords !== false,
        capoOverride: item.capo,
        setContext: { setId: set.id, setName: set.name, index: sheets.length, count: 0 }
      }));
    });
    sheets.forEach(function (s) { s.setContext.count = sheets.length; });
    return sheets;
  }

  /** Lyrics only, for "Copy lyrics": no chords, no comments; chorus lines indented two spaces. */
  function toPlainLyrics(sheet) {
    var out = [];
    sheet.blocks.forEach(function (b) {
      if (b.kind === 'blank') { out.push(''); return; }
      if (b.kind !== 'stanza' && b.kind !== 'chorus') return;
      if (b.kind === 'stanza' && b.number) out.push(b.number);
      b.lines.forEach(function (l) {
        var text = l.segments.map(function (s) { return s.text; }).join('').replace(/\s+$/, '');
        if (b.kind === 'chorus') text = '  ' + ' '.repeat(l.indent) + text;
        out.push(text);
      });
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /** Unique display chords in order of appearance. */
  function sheetChords(sheet) {
    var seen = new Set();
    var out = [];
    sheet.blocks.forEach(function (b) {
      (b.lines || []).forEach(function (l) {
        l.segments.forEach(function (s) {
          if (s.chord && !seen.has(s.chord)) { seen.add(s.chord); out.push(s.chord); }
        });
      });
    });
    return out;
  }

  /** Transpose raw song text: only the contents of [brackets] change, everything else stays byte-identical.
   *  opts = {semitones, accidentals, tuneIndex (only that tune), updateKeyComment (rewrite "# Key:" lines)} */
  function transposeText(rawText, opts) {
    opts = opts || {};
    var text = String(rawText == null ? '' : rawText);
    var semis = mod(opts.semitones || 0, 12);
    var acc = opts.accidentals || 'auto';
    if (semis === 0 && acc === 'auto') return text;
    var ast = P.parse(text);
    var pieces = text.split(/(\r\n|\r|\n|\u2028|\u2029)/);    // odd indexes are the separators
    var tuneOfLine = [];
    ast.tunes.forEach(function (t) {
      for (var i = t.lineStart; i < t.lineEnd; i++) tuneOfLine[i] = t.index;
      if (t.titleLine !== null) tuneOfLine[t.titleLine] = -1;
    });
    var mappers = ast.tunes.map(function (t) {
      var key = tuneKey(t);
      return {
        key: key,
        map: T.makeChordMapper({ fromKey: key ? key.major : null, semitones: semis, accidentals: acc })
      };
    });
    for (var p = 0, line = 0; p < pieces.length; p += 2, line++) {
      var ti = tuneOfLine[line];
      if (ti === undefined || ti < 0) continue;
      if (typeof opts.tuneIndex === 'number' && opts.tuneIndex !== ti) continue;
      var m = mappers[ti];
      var s = pieces[p];
      if (opts.updateKeyComment && /^#\s?[Kk][Ee][Yy]\b/.test(s) && m.key) {
        pieces[p] = s.replace(/^(#\s?[Kk][Ee][Yy]\s*[:=]?\s*).*$/, '$1' + T.keyLabel(m.key, semis, acc));
        continue;
      }
      pieces[p] = s.replace(BRACKET_RE, function (all, inner) { return '[' + m.map(inner) + ']'; });
    }
    return pieces.join('');
  }

  var api = {
    buildSheet: buildSheet,
    buildSetSheets: buildSetSheets,
    toPlainLyrics: toPlainLyrics,
    sheetChords: sheetChords,
    transposeText: transposeText,
    tuneKey: tuneKey
  };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.sheetModel = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
