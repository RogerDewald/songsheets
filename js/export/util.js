/* Songsheets — helpers shared by every exporter.
 * Text columns are counted in grapheme clusters; East Asian wide characters (CJK, Hangul, fullwidth
 * forms, emoji) take two columns, as they do in a monospace font.
 * Browser: window.SongSheets.export.util   Node: require('./util.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;

  var APP_ID = 'songsheets/1.0.0';
  var EMBED_FORMAT = 'songsheets-html-embed';
  var BACKUP_FORMAT = 'songsheets-backup';
  var DEFAULT_CHORD_COLOR = '#1f45ff';

  var MIME = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain;charset=utf-8',
    cho: 'text/plain;charset=utf-8',
    html: 'text/html;charset=utf-8',
    json: 'application/json;charset=utf-8'
  };

  function nfc(s) {
    return String(s == null ? '' : s).normalize('NFC');
  }

  var segmenter = null;
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
  }

  /** Grapheme clusters of a string (code points after NFC where Intl.Segmenter is missing). */
  function graphemes(str) {
    var s = String(str == null ? '' : str);
    if (segmenter) {
      var out = [];
      var it = segmenter.segment(s)[Symbol.iterator]();
      for (var r = it.next(); !r.done; r = it.next()) out.push(r.value.segment);
      return out;
    }
    return Array.from(s.normalize('NFC'));
  }

  function glen(str) {
    return graphemes(str).length;
  }

  var WIDE = [
    [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
    [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19],
    [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff],
    [0x20000, 0x3fffd]
  ];

  function isWide(cp) {
    for (var i = 0; i < WIDE.length; i++) if (cp >= WIDE[i][0] && cp <= WIDE[i][1]) return true;
    return false;
  }

  function isZeroWidth(cp) {
    return cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x2060 || cp === 0xfeff || cp < 0x20 && cp !== 0x09;
  }

  /** Display columns of one grapheme cluster: 0, 1 or 2. */
  function clusterWidth(g) {
    var cp = g.codePointAt(0);
    if (cp === undefined || isZeroWidth(cp)) return 0;
    return isWide(cp) ? 2 : 1;
  }

  /** Display columns of a string in a monospace font. */
  function cells(str) {
    var n = 0;
    graphemes(str).forEach(function (g) { n += clusterWidth(g); });
    return n;
  }

  function spaces(n) {
    return n > 0 ? ' '.repeat(n) : '';
  }

  /** Pad with spaces to n display columns. */
  function padEnd(str, n) {
    var s = String(str == null ? '' : str);
    return s + spaces(n - cells(s));
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\.|$)/i;

  /** A name that is safe as a file name on Windows, macOS and Linux. */
  function sanitizeFilename(name, fallback) {
    var fb = fallback == null ? 'song' : fallback;
    var s = nfc(name)
      .replace(/\s+/g, ' ')
      .replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '')
      .replace(/ +/g, ' ')
      .replace(/^[\s.]+|[\s.]+$/g, '')
      .replace(RESERVED, '$1-');
    var cps = Array.from(s);
    if (cps.length > 120) s = cps.slice(0, 120).join('').replace(/[\s.]+$/, '');
    return s || fb;
  }

  /** "Title" + "pdf" -> "Title.pdf". ext may be compound ("songbase.txt"). */
  function buildFilename(base, ext, fallback) {
    return sanitizeFilename(base, fallback) + '.' + ext;
  }

  var KNOWN_EXT = /\.(songbase\.txt|txt|text|cho|chopro|chordpro|crd|pro|json|html?)$/i;

  /** Song title from an imported file name: directory and extension removed. */
  function titleFromFilename(filename, fallback) {
    var base = String(filename == null ? '' : filename).split(/[\\/]/).pop();
    var t = KNOWN_EXT.test(base) ? base.replace(KNOWN_EXT, '') : base.replace(/\.[A-Za-z0-9]{1,5}$/, '');
    t = nfc(t).replace(/\s+/g, ' ').trim();
    return t || (fallback == null ? 'Untitled' : fallback);
  }

  /** The capo a player needs for the chords as displayed, or null.
   *  A capo written in the text stops applying once its preset is active (the chords then sound as shown). */
  function effectiveCapo(sheet) {
    var c = sheet && sheet.capo;
    if (!c || !c.n) return null;
    if (c.source === 'override') return c.n;
    return c.active ? null : c.n;
  }

  /** ["Key: G", "Capo 2", "Author"] as present. */
  function metaParts(sheet, opts) {
    opts = opts || {};
    var parts = [];
    if (sheet.showChords !== false && sheet.targetKeyLabel) parts.push((opts.keyPrefix === false ? '' : 'Key: ') + sheet.targetKeyLabel);
    var capo = effectiveCapo(sheet);
    if (capo) parts.push('Capo ' + capo);
    if (opts.author !== false && sheet.author) parts.push(String(sheet.author));
    return parts;
  }

  /** "Key: G · Capo 2 · John Newton" (empty string when there is nothing to say). */
  function metaLine(sheet) {
    return metaParts(sheet).join(' · ');
  }

  /** Short key/capo summary for contents lists: "G · Capo 2". */
  function tocMeta(sheet, sep) {
    return metaParts(sheet, { keyPrefix: false, author: false }).join(sep == null ? ' · ' : sep);
  }

  function isSet(sheets) {
    return sheets.length > 1 || !!(sheets[0] && sheets[0].setContext);
  }

  function setName(sheets, opts) {
    if (opts && opts.setName) return String(opts.setName);
    var c = sheets[0] && sheets[0].setContext;
    return c && c.setName ? String(c.setName) : 'Set list';
  }

  /** Plain text of a comment block (bold/italic markers already removed by the parser). */
  function blockText(block) {
    if (block.runs && block.runs.length) return block.runs.map(function (r) { return r.text; }).join('');
    return String(block.text == null ? '' : block.text);
  }

  function eol(text, mode) {
    var t = String(text).replace(/\r\n/g, '\n');
    return mode === 'CRLF' ? t.replace(/\n/g, '\r\n') : t;
  }

  function clampScale(x) {
    var n = Number(x);
    if (!isFinite(n) || n <= 0) return 1;
    return Math.min(3, Math.max(0.5, n));
  }

  function validColor(c, fallback) {
    var s = String(c == null ? '' : c).trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
    return fallback === undefined ? DEFAULT_CHORD_COLOR : fallback;
  }

  /** A minimal song record rebuilt from a sheet (used when the caller has no records to embed). */
  function recordFromSheet(sheet) {
    return {
      id: sheet.songId || sheet.id || null,
      title: sheet.title,
      author: sheet.author || null,
      tags: (sheet.tags || []).slice(),
      lyrics: sheet.source ? sheet.source.fullText : '',
      notes: '',
      transpose: sheet.transpose || 0,
      accidentals: sheet.accidentals && sheet.accidentals !== 'auto' ? sheet.accidentals : null,
      tuneIndex: sheet.tuneIndex || 0,
      favourite: false,
      createdAt: null,
      updatedAt: null,
      origin: null
    };
  }

  var api = {
    APP_ID: APP_ID,
    EMBED_FORMAT: EMBED_FORMAT,
    BACKUP_FORMAT: BACKUP_FORMAT,
    DEFAULT_CHORD_COLOR: DEFAULT_CHORD_COLOR,
    MIME: MIME,
    nfc: nfc,
    graphemes: graphemes,
    glen: glen,
    clusterWidth: clusterWidth,
    cells: cells,
    spaces: spaces,
    padEnd: padEnd,
    escapeHtml: escapeHtml,
    sanitizeFilename: sanitizeFilename,
    buildFilename: buildFilename,
    titleFromFilename: titleFromFilename,
    effectiveCapo: effectiveCapo,
    metaParts: metaParts,
    metaLine: metaLine,
    tocMeta: tocMeta,
    isSet: isSet,
    setName: setName,
    blockText: blockText,
    eol: eol,
    clampScale: clampScale,
    validColor: validColor,
    recordFromSheet: recordFromSheet
  };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.export = root.SongSheets.export || {};
  root.SongSheets.export.util = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
