/* Songsheets — raw songbase text export.
 * The whole song text is exported so no alternative tune is lost; only the displayed tune is
 * transposed (bracket contents and "# Key:" lines change, every other byte stays as written).
 * A set list prefixes each song with "# <title>" and separates songs with "# ----".
 * exportSongbaseText(sheets, opts) -> string      opts = {lineEnding}
 * Browser: window.SongSheets.export.songbaseText   Node: require('./songbaseText.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var U = isNode ? require('./util.js') : root.SongSheets.export.util;
  var M = isNode ? require('../core/sheetModel.js') : root.SongSheets.sheetModel;
  var N = isNode ? require('../core/normalize.js') : root.SongSheets.normalize;

  /** The sheet's song text with the displayed tune in the displayed key. */
  function sheetText(sheet) {
    var src = sheet.source || {};
    var text = N.normalizeLineEndings(src.fullText != null ? src.fullText : src.text || '');
    var acc = sheet.accidentals && sheet.accidentals !== 'auto' ? sheet.accidentals : 'auto';
    if ((sheet.displayTranspose || 0) !== 0 || acc !== 'auto') {
      text = M.transposeText(text, {
        semitones: sheet.displayTranspose || 0,
        accidentals: acc,
        tuneIndex: typeof src.tuneIndex === 'number' ? src.tuneIndex : sheet.tuneIndex || 0,
        updateKeyComment: true
      });
    }
    return text.replace(/\s+$/, '');
  }

  function exportSongbaseText(sheets, opts) {
    opts = opts || {};
    var text;
    if (U.isSet(sheets)) {
      text = sheets.map(function (s) {
        var head = ['# ' + String(s.title).replace(/[\r\n]+/g, ' ')];
        // a set-list capo is not in the song text; say so, or the shapes read as concert pitch
        if (s.capo && s.capo.source === 'override') head.push('# Capo ' + s.capo.n);
        return head.join('\n') + '\n' + sheetText(s);
      }).join('\n\n# ----\n\n');
    } else {
      text = sheets.length ? sheetText(sheets[0]) : '';
    }
    return U.eol(text + '\n', opts.lineEnding);
  }

  var api = { exportSongbaseText: exportSongbaseText, sheetText: sheetText };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.export = root.SongSheets.export || {};
  root.SongSheets.export.songbaseText = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
