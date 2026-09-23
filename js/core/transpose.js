/* Songsheets — key detection and chord transposition.
 * The key/scale tables are songbase's (ReganRyanNZ/songbase, MIT, SongDisplay.jsx), copied verbatim.
 * Changes from songbase are listed in README.md ("Deliberate deviations").
 * Browser: window.SongSheets.transpose   Node: require('./transpose.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var Chords = isNode ? require('./chords.js') : root.SongSheets.chords;

  // ---- songbase tables (verbatim) -------------------------------------------------------------
  var keys = ['A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab'];
  var guessingScaleSharps = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
  var guessingScaleFlats = ['A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab'];
  var scales = {
    A: ['A', 'B', 'C#', 'D', 'E', 'F#', 'G', 'G#'],
    Bb: ['Bb', 'C', 'D', 'Eb', 'F', 'G', 'Ab', 'A'],
    B: ['B', 'C#', 'D#', 'E', 'F#', 'G#', 'A', 'A#'],
    C: ['C', 'D', 'E', 'F', 'G', 'A', 'Bb', 'B'],
    Db: ['Db', 'Eb', 'F', 'Gb', 'Ab', 'Bb', 'B', 'C'],
    D: ['D', 'E', 'F#', 'G', 'A', 'B', 'C', 'C#'],
    Eb: ['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'Db', 'D'],
    E: ['E', 'F#', 'G#', 'A', 'B', 'C#', 'D', 'D#'],
    F: ['F', 'G', 'A', 'Bb', 'C', 'D', 'Eb', 'E'],
    Gb: ['Gb', 'Ab', 'Bb', 'Cb', 'Db', 'Eb', 'E', 'F'],
    G: ['G', 'A', 'B', 'C', 'D', 'E', 'F', 'F#'],
    Ab: ['Ab', 'Bb', 'C', 'Db', 'Eb', 'F', 'Gb', 'G']
  };
  var keyCommonChords = {
    A: ['A', 'Bm', 'C#m', 'D', 'E', 'F#m'],
    Bb: ['Bb', 'Cm', 'Dm', 'Eb', 'F', 'Gm'],
    B: ['B', 'C#m', 'D#m', 'E', 'F#', 'G#m'],
    C: ['C', 'Dm', 'Em', 'F', 'G', 'Am'],
    Db: ['Db', 'Ebm', 'Fm', 'Gb', 'Ab', 'Bbm'],
    D: ['D', 'Em', 'F#m', 'G', 'A', 'Bm'],
    Eb: ['Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Cm'],
    E: ['E', 'F#m', 'G#m', 'A', 'B', 'C#m'],
    F: ['F', 'Gm', 'Am', 'Bb', 'C', 'Dm'],
    Gb: ['Gb', 'Abm', 'Bbm', 'Cb', 'Db', 'Ebm'],
    G: ['G', 'Am', 'Bm', 'C', 'D', 'Em'],
    Ab: ['Ab', 'Bbm', 'Cm', 'Db', 'Eb', 'Fm']
  };
  var keySharpness = { A: 'sharp', Bb: 'flat', B: 'sharp', C: 'sharp', Db: 'flat', D: 'sharp', Eb: 'flat', E: 'sharp', F: 'flat', Gb: 'flat', G: 'sharp', Ab: 'flat' };
  // ---------------------------------------------------------------------------------------------

  function mod(n, m) { return ((n % m) + m) % m; }

  var NOTE_BASE = { A: 0, B: 2, C: 3, D: 5, E: 7, F: 8, G: 10 };
  var ACC_SHIFT = { '': 0, '#': 1, '♯': 1, '##': 2, 'x': 2, 'b': -1, '♭': -1, 'bb': -2 };

  /** Pitch class counted from A (A=0 ... Ab=11), or -1. Handles Cb, Fb, E#, B#, ♯ and ♭. */
  function noteIndex(name) {
    var m = /^([A-G])(##|x|#|♯|bb|b|♭)?$/.exec(String(name || ''));
    if (!m) return -1;
    return mod(NOTE_BASE[m[1]] + ACC_SHIFT[m[2] || ''], 12);
  }

  function spell(index, pref) {
    return (pref === 'flat' ? guessingScaleFlats : guessingScaleSharps)[mod(index, 12)];
  }

  function accidentalFamily(note) {
    var acc = String(note).slice(1);
    if (/[#♯x]/.test(acc)) return 'sharp';
    if (/[b♭]/.test(acc)) return 'flat';
    return null;
  }

  var SCALE_IDX = {};
  var COMMON_IDX = {};
  keys.forEach(function (k) {
    SCALE_IDX[k] = scales[k].map(noteIndex);
    COMMON_IDX[k] = keyCommonChords[k].map(function (c) {
      var minor = /m$/.test(c);
      return { index: noteIndex(minor ? c.slice(0, -1) : c), minor: minor };
    });
  });

  /** Major key name (from `keys`) whose pitch class is index. */
  function keyByIndex(index) {
    for (var i = 0; i < keys.length; i++) if (noteIndex(keys[i]) === mod(index, 12)) return keys[i];
    return null;
  }

  function targetKey(fromKey, semitones) {
    var i = keys.indexOf(fromKey);
    if (i < 0) return null;
    return keys[mod(i + (semitones || 0), 12)];
  }

  function parseKeyName(name) {
    var m = /^\s*([A-G])(#|b|♯|♭)?\s*(m|min|minor)?\s*$/.exec(String(name || ''));
    if (!m) return null;
    var root = m[1] + (m[2] ? m[2].replace('♯', '#').replace('♭', 'b') : '');
    return { root: root, index: noteIndex(root), minor: !!m[3] };
  }

  function keyInfoFrom(root, index, minor, source, label) {
    var major = keyByIndex(index + (minor ? 3 : 0));        // minor → relative major (songbase's +3 trick)
    return { major: major, tonicIndex: mod(index, 12), minor: minor, label: label || (root + (minor ? 'm' : '')), source: source };
  }

  /** Detect the key of a song from its bracket contents (in order of appearance).
   *  opts.override: a key name such as 'Em' or 'F#' (from a "# Key: Em" comment).
   *  Returns {major, tonicIndex, minor, label, source:'override'|'bookends'|'common'} or null. */
  function detectKey(bracketInners, opts) {
    opts = opts || {};
    if (opts.override) {
      var o = parseKeyName(opts.override);
      if (o && o.index >= 0) return keyInfoFrom(o.root, o.index, o.minor, 'override', o.root + (o.minor ? 'm' : ''));
    }
    var firsts = [];
    (bracketInners || []).forEach(function (inner) {
      var c = Chords.firstChord(inner);
      if (c) {
        var idx = noteIndex(c.root);
        if (idx >= 0) firsts.push({ root: c.root, index: idx, minor: c.minor });
      }
    });
    if (!firsts.length) return null;
    var first = firsts[0];
    var last = firsts[firsts.length - 1];
    if (first.index === last.index && first.minor === last.minor) {
      return keyInfoFrom(first.root, first.index, first.minor, 'bookends');
    }
    var best = -1;
    var bestKey = null;
    keys.forEach(function (k) {
      var count = firsts.filter(function (c) {
        return COMMON_IDX[k].some(function (t) { return t.index === c.index && t.minor === c.minor; });
      }).length;
      if (count > best) { best = count; bestKey = k; }        // ties keep the earliest key (songbase rule)
    });
    return { major: bestKey, tonicIndex: noteIndex(bestKey), minor: false, label: bestKey, source: 'common' };
  }

  /** Transpose the content of one [bracket].
   *  opts = {fromKey: major key name from `keys` (or null), semitones, accidentals:'auto'|'sharp'|'flat'} */
  function transposeChord(inner, opts) {
    opts = opts || {};
    var s = mod(opts.semitones || 0, 12);
    var acc = opts.accidentals || 'auto';
    if (s === 0 && acc === 'auto') return inner;
    var parts = Chords.parseChordToken(inner);
    if (!parts.some(function (p) { return p.kind === 'chord'; })) return inner;
    var fromKey = keys.indexOf(opts.fromKey) >= 0 ? opts.fromKey : null;
    var toKey = fromKey ? targetKey(fromKey, s) : null;

    function note(n) {
      var idx = noteIndex(n);
      if (idx < 0) return n;
      var out = n;
      if (s !== 0) {
        var deg = fromKey ? SCALE_IDX[fromKey].indexOf(idx) : -1;
        if (deg >= 0) {
          out = scales[toKey][deg];                               // songbase: spell by scale degree
        } else {
          var fam = accidentalFamily(n) || (toKey ? keySharpness[toKey] : 'sharp');
          out = spell(idx + s, fam);                               // chromatic fallback
        }
      }
      if (acc === 'sharp' || acc === 'flat') out = spell(noteIndex(out), acc);
      return out;
    }

    return parts.map(function (p) {
      if (p.kind !== 'chord') return p.text;
      return note(p.root) + p.suffix + (p.bass !== null ? '/' + note(p.bass) : '');
    }).join('');
  }

  /** Memoised chord mapper for one sheet. */
  function makeChordMapper(opts) {
    var cache = new Map();
    return function (inner) {
      if (inner == null) return inner;
      if (cache.has(inner)) return cache.get(inner);
      var out = transposeChord(inner, opts);
      cache.set(inner, out);
      return out;
    };
  }

  /** Label of the key after transposing, e.g. an F#m song +2 → 'G#m', a C song +6 → 'Gb' ('F#' with sharps). */
  function keyLabel(keyInfo, semitones, accidentals) {
    if (!keyInfo || !keyInfo.major) return null;
    var s = mod(semitones || 0, 12);
    if (s === 0 && (!accidentals || accidentals === 'auto')) return keyInfo.label;
    var tonic;
    if (s === 0) {
      tonic = keyInfo.label.replace(/m$/, '');
    } else {
      var major = targetKey(keyInfo.major, s);
      tonic = keyInfo.minor ? scales[major][5] : major;            // 6th degree = relative minor
    }
    if (accidentals === 'sharp' || accidentals === 'flat') tonic = spell(noteIndex(tonic), accidentals);
    return tonic + (keyInfo.minor ? 'm' : '');
  }

  /** The 12 choices for a key picker: [{semitones, label}] with black keys shown both ways. */
  function keyChoices(keyInfo) {
    var out = [];
    for (var s = 0; s < 12; s++) {
      var label;
      if (keyInfo && keyInfo.major) {
        var flat = keyLabel(keyInfo, s, 'flat');
        var sharp = keyLabel(keyInfo, s, 'sharp');
        label = flat === sharp ? flat : flat + ' / ' + sharp;
      } else {
        label = (s > 6 ? '−' + (12 - s) : '+' + s);
      }
      out.push({ semitones: s, label: label });
    }
    return out;
  }

  var api = {
    keys: keys,
    scales: scales,
    keyCommonChords: keyCommonChords,
    keySharpness: keySharpness,
    guessingScaleSharps: guessingScaleSharps,
    guessingScaleFlats: guessingScaleFlats,
    mod: mod,
    noteIndex: noteIndex,
    spell: spell,
    keyByIndex: keyByIndex,
    targetKey: targetKey,
    parseKeyName: parseKeyName,
    detectKey: detectKey,
    transposeChord: transposeChord,
    makeChordMapper: makeChordMapper,
    keyLabel: keyLabel,
    keyChoices: keyChoices
  };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.transpose = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
