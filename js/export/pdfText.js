/* Songsheets — text sanitiser for jsPDF's built-in fonts (Helvetica etc.), which only encode WinAnsi
 * (Windows-1252). One character outside it makes jsPDF write the WHOLE string as UTF-16 against a
 * single-byte font, garbling every character of that string, so this is applied to every string
 * before it is measured or drawn.
 *   kept: printable ASCII, Latin-1 (U+00A0-U+00FF) and the 27 WinAnsi extras (€ ‚ ƒ „ … † ‡ ˆ ‰ Š ‹ Œ Ž ‘ ’ “ ” • – — ˜ ™ š › œ ž Ÿ)
 *   mapped: ‿ -> opts.tieChar ('_'), ♯ -> #, ♭ -> b, primes, dashes, odd spaces, letters such as Ł ł đ ı
 *   accents: a letter with marks keeps the nearest WinAnsi form (ệ -> ê, ř -> r)
 *   anything else (Greek, Cyrillic, CJK, Arabic, emoji…) -> '?' and counted in `dropped`
 * toWinAnsi(str, {tieChar}) -> {text, dropped};  isWinAnsi(cp) -> boolean
 * Browser: window.SongSheets.export.pdfText   Node: require('./pdfText.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var U = isNode ? require('./util.js') : root.SongSheets.export.util;

  var WINANSI_EXTRA = [
    0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d,
    0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178
  ];
  var EXTRA = {};
  WINANSI_EXTRA.forEach(function (cp) { EXTRA[cp] = true; });

  // replacements (by code point) for characters outside WinAnsi; '' removes the character
  var FALLBACKS = {
    0x266f: '#', 0x266d: 'b', 0x266e: '',
    0x2032: "'", 0x2033: '"', 0x2035: "'", 0x201b: "'", 0x201f: '"', 0x02bc: "'", 0x02b9: "'",
    0x2010: '-', 0x2011: '-', 0x2012: '-', 0x2015: '—', 0x2212: '-', 0x2043: '-', 0x2044: '/', 0x2215: '/',
    0x2000: ' ', 0x2001: ' ', 0x2002: ' ', 0x2003: ' ', 0x2004: ' ', 0x2005: ' ', 0x2006: ' ', 0x2007: ' ',
    0x2008: ' ', 0x2009: ' ', 0x200a: ' ', 0x202f: ' ', 0x205f: ' ', 0x3000: ' ',
    0x200b: '', 0x200c: '', 0x200d: '', 0x2060: '', 0xfeff: '', 0x00ad: '',
    0x2024: '.', 0x2027: '·', 0x2219: '·', 0x22c5: '·',
    0x0141: 'L', 0x0142: 'l', 0x0110: 'D', 0x0111: 'd', 0x0131: 'i', 0x017f: 's', 0x0126: 'H', 0x0127: 'h',
    0x0166: 'T', 0x0167: 't', 0x0132: 'IJ', 0x0133: 'ij', 0x013f: 'L', 0x0140: 'l', 0x0149: "'n",
    0x014a: 'N', 0x014b: 'n', 0x0138: 'k', 0x0259: 'e', 0x018f: 'E', 0x1e9e: 'SS', 0x2116: 'No'
  };

  function isWinAnsi(cp) {
    return cp >= 0x20 && cp <= 0x7e || cp >= 0xa0 && cp <= 0xff || EXTRA[cp] === true;
  }

  function allWinAnsi(s) {
    for (var i = 0; i < s.length; i++) if (!isWinAnsi(s.charCodeAt(i))) return false;
    return true;
  }

  function isMark(cp) {
    return cp >= 0x0300 && cp <= 0x036f || cp >= 0x1ab0 && cp <= 0x1aff || cp >= 0x1dc0 && cp <= 0x1dff ||
      cp >= 0x20d0 && cp <= 0x20ff || cp >= 0xfe20 && cp <= 0xfe2f;
  }

  /** A letter with marks that has no WinAnsi form: drop one mark (ệ -> ê), else all of them (ř -> r). */
  function dropMarks(cluster) {
    var cps = Array.from(cluster.normalize('NFD'));
    var base = [];
    var marks = [];
    cps.forEach(function (c) { (isMark(c.codePointAt(0)) ? marks : base).push(c); });
    if (!base.length) return null;
    for (var i = 0; i < marks.length; i++) {
      var keep = base.concat(marks.slice(0, i), marks.slice(i + 1)).join('').normalize('NFC');
      if (allWinAnsi(keep)) return keep;
    }
    var bare = base.join('').normalize('NFC');
    return allWinAnsi(bare) ? bare : null;
  }

  function toWinAnsi(str, opts) {
    var tie = opts && typeof opts.tieChar === 'string' ? opts.tieChar : '_';
    var s = U.nfc(str).replace(/\t/g, ' ').replace(/\r\n?|\n/g, ' ');
    var out = '';
    var dropped = 0;
    U.graphemes(s).forEach(function (g) {
      if (allWinAnsi(g)) { out += g; return; }
      var cp = g.codePointAt(0);
      if (cp === 0x203f) { out += tie; return; }
      if (g.length === String.fromCodePoint(cp).length && Object.prototype.hasOwnProperty.call(FALLBACKS, cp)) { out += FALLBACKS[cp]; return; }
      if (cp < 0x20 || cp === 0x7f || cp >= 0x80 && cp <= 0x9f) return;          // control characters
      var stripped = dropMarks(g);
      if (stripped !== null) { out += stripped; return; }
      out += '?';
      dropped++;
    });
    return { text: out, dropped: dropped };
  }

  var api = {
    toWinAnsi: toWinAnsi,
    isWinAnsi: isWinAnsi,
    WINANSI_EXTRA: WINANSI_EXTRA,
    FALLBACKS: FALLBACKS
  };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.export = root.SongSheets.export || {};
  root.SongSheets.export.pdfText = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
