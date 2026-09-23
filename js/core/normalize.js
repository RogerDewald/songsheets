/* Songsheets — text normalisation helpers.
 * Browser: window.SongSheets.normalize   Node: require('./normalize.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;

  /** Convert every line-ending flavour (CRLF, CR, U+2028, U+2029) to LF.
   *  songbase deletes these characters; we convert them so lines never merge. */
  function normalizeLineEndings(text) {
    return String(text == null ? '' : text).replace(/\r\n|\r|\u2028|\u2029/g, '\n');
  }

  /** Remove trailing whitespace from one line. */
  function trimLineEnd(line) {
    return String(line).replace(/\s+$/, '');
  }

  /** Save-time normalisation of song text.
   *  LF line endings, no BOM, NFC, no leading blank lines, no trailing whitespace at the end.
   *  Leading spaces of the first line are kept, so a song that starts with a chorus stays a chorus. */
  function normalizeText(text) {
    var t = normalizeLineEndings(text);
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
    t = t.normalize('NFC');
    var lines = t.split('\n');
    while (lines.length && trimLineEnd(lines[0]) === '') lines.shift();
    return lines.join('\n').replace(/\s+$/, '');
  }

  function splitLines(text) {
    return normalizeLineEndings(text).split('\n');
  }

  /** Remove every [bracket] token. */
  function stripChords(text) {
    return String(text == null ? '' : text).replace(/\[[^\]]*\]/g, '');
  }

  function slugify(s, fallback) {
    var out = String(s == null ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      .slice(0, 60).replace(/-+$/, '');
    return out || (fallback == null ? 'untitled' : fallback);
  }

  var api = {
    normalizeLineEndings: normalizeLineEndings,
    trimLineEnd: trimLineEnd,
    normalizeText: normalizeText,
    splitLines: splitLines,
    stripChords: stripChords,
    slugify: slugify
  };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.normalize = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
