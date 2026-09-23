/* Songsheets — chord-symbol grammar.
 * Splits the text inside a [bracket] into chord symbols, separators and plain text,
 * so that only real chords get transposed ("N.C.", "x2", "Chorus" stay as written).
 * Browser: window.SongSheets.chords   Node: require('./chords.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;

  var ACC = '(?:#|b|♯|♭)';                // # b ♯ ♭
  var ROOT = '[A-G]' + ACC + '?';
  // Suffix units. Order only sets preference; the regex backtracks to find a full match.
  var UNIT = [
    'maj', 'Maj', 'MAJ', 'M', 'ma', 'Ma',
    'min', 'mi', 'm',
    'dim', 'aug', 'sus', 'add', 'alt', 'dom', 'omit', 'no',
    '°', 'ø', 'Δ', '\\+',           // ° ø Δ +
    '1[13]', '[2-9]',
    ACC + '(?:1[13]|[59])'                            // b5 #5 b9 #9 #11 b13
  ].join('|');
  var PAREN = '\\((?:' + UNIT + '|[,/])+\\)';        // (add9) (b5) (#11,b9)
  var SUFFIX = '(?:' + UNIT + '|' + PAREN + ')*';
  var CHORD = '(' + ROOT + ')(' + SUFFIX + ')(?:/(' + ROOT + '))?';
  var SEPCHARS = '\\s\\-,|()/';
  var BOUND = '(?=$|[' + SEPCHARS + '])';
  var TOKEN = new RegExp('(?:' + CHORD + BOUND + ')|([' + SEPCHARS + ']+)|([^' + SEPCHARS + ']+)', 'y');

  /** Parse bracket content into parts.
   *  Part = {kind:'chord', root, suffix, bass|null, text} | {kind:'sep', text} | {kind:'text', text}
   *  parts.map(p => p.text).join('') === inner, always. */
  function parseChordToken(inner) {
    var s = String(inner == null ? '' : inner);
    var parts = [];
    var pos = 0;
    while (pos < s.length) {
      TOKEN.lastIndex = pos;
      var m = TOKEN.exec(s);
      if (!m || m[0] === '') {                        // cannot happen, but never loop forever
        parts.push({ kind: 'text', text: s.slice(pos) });
        break;
      }
      if (m[1] !== undefined) {
        parts.push({ kind: 'chord', root: m[1], suffix: m[2] || '', bass: m[3] === undefined ? null : m[3], text: m[0] });
      } else if (m[4] !== undefined) {
        parts.push({ kind: 'sep', text: m[4] });
      } else {
        parts.push({ kind: 'text', text: m[5] });
      }
      pos = TOKEN.lastIndex;
    }
    return parts;
  }

  function serializeParts(parts) {
    return parts.map(function (p) { return p.text; }).join('');
  }

  function isChordToken(inner) {
    return parseChordToken(inner).some(function (p) { return p.kind === 'chord'; });
  }

  /** 'm' not followed by 'a'/'A' (so maj7, Maj7, M7, ma7 are major; m7, min, mMaj7 are minor). */
  function isMinorSuffix(suffix) {
    return /^m(?![aA])/.test(suffix || '');
  }

  /** First chord symbol in the bracket, or null. */
  function firstChord(inner) {
    var parts = parseChordToken(inner);
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].kind === 'chord') {
        return { root: parts[i].root, suffix: parts[i].suffix, bass: parts[i].bass, minor: isMinorSuffix(parts[i].suffix) };
      }
    }
    return null;
  }

  var api = {
    parseChordToken: parseChordToken,
    serializeParts: serializeParts,
    isChordToken: isChordToken,
    isMinorSuffix: isMinorSuffix,
    firstChord: firstChord
  };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.chords = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
