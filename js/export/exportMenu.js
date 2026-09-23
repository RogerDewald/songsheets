/* Songsheets — the one entry point the app calls for every export.
 *
 * list(scope 'song'|'set') -> [{id, label, hint}]   ids: print pdf docx txt cho songbase html json
 * run(id, sheets, ctx) -> Promise<{ok, message}>    never rejects; message '' means "nothing to say"
 *   ctx = {settings, songs: [songRecord], set: setRecord|null, filenameBase, action:'download'|'copy'|'share', toast(msg, {type})}
 *   settings read: pageSize, fontScale, chordColor, printBw
 * canCopy(id) -> boolean (text formats);  canShare() -> boolean (files can go to the share sheet)
 * jsPDF and docx are loaded on first use through vendorLoader.
 * Browser: window.SongSheets.export.exportMenu   Node: require('./exportMenu.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  function mod(file, name) { return isNode ? require('./' + file) : root.SongSheets.export[name]; }
  var U = mod('util.js', 'util');
  var TX = mod('textExport.js', 'textExport');
  var SB = mod('songbaseText.js', 'songbaseText');
  var CP = mod('chordpro.js', 'chordpro');
  var B = mod('backup.js', 'backup');
  var H = mod('htmlExport.js', 'htmlExport');
  var PE = mod('pdfExport.js', 'pdfExport');
  var DX = mod('docxExport.js', 'docxExport');
  var D = mod('download.js', 'download');
  var V = mod('vendorLoader.js', 'vendorLoader');
  var PR = mod('printRoute.js', 'printRoute');

  var ITEMS = [
    { id: 'print', label: 'Print / Save as PDF', ext: null, song: 'Print, or save as PDF from the print dialog (any language)', set: 'Contents page, then each song on its own page' },
    { id: 'pdf', label: 'PDF', ext: 'pdf', song: 'PDF file with the chords over the lyrics', set: 'One PDF: numbered contents page, each song on a new page' },
    { id: 'docx', label: 'Word document', ext: 'docx', song: 'Editable .docx; chords stay aligned in a monospace font', set: 'One .docx with a linked contents list' },
    { id: 'txt', label: 'Chord chart (text)', ext: 'txt', song: 'Plain text with chords above the lyrics', set: 'All songs in one text file' },
    { id: 'cho', label: 'ChordPro', ext: 'cho', song: '.cho file for OnSong, SongBook and other chord apps', set: 'All songs in one .cho file' },
    { id: 'songbase', label: 'Songbase text', ext: 'songbase.txt', song: 'The song text with [chords] in brackets, as displayed', set: 'All songs, one after another' },
    { id: 'html', label: 'Web page', ext: 'html', song: 'One .html file that opens anywhere and imports back', set: 'One .html file with all the songs' },
    { id: 'json', label: 'Songsheets backup', ext: 'json', song: 'This song as a Songsheets .json file', set: 'This set list and its songs as a .json file' }
  ];
  var BY_ID = {};
  ITEMS.forEach(function (it) { BY_ID[it.id] = it; });
  var TEXT_FORMATS = { txt: true, cho: true, songbase: true, html: true, json: true };
  var MIME_BY_ID = { pdf: U.MIME.pdf, docx: U.MIME.docx, txt: U.MIME.txt, cho: U.MIME.cho, songbase: U.MIME.txt, html: U.MIME.html, json: U.MIME.json };

  function list(scope) {
    var key = scope === 'set' ? 'set' : 'song';
    return ITEMS.map(function (it) { return { id: it.id, label: it.label, hint: it[key] }; });
  }

  function canCopy(id) {
    return TEXT_FORMATS[id] === true;
  }

  function canShare() {
    return D.canShareFiles();
  }

  /** The records behind the sheets, once each (a set may use a song twice). */
  function uniqueRecords(list) {
    var seen = {};
    return (Array.isArray(list) ? list : []).filter(function (r) {
      if (!r || typeof r !== 'object') return false;
      var key = r.id == null ? null : String(r.id);
      if (key === null) return true;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function exportOptions(sheets, ctx) {
    var s = ctx.settings || {};
    var set = ctx.set || null;
    return {
      pageSize: s.pageSize === 'Letter' ? 'Letter' : 'A4',
      fontScale: U.clampScale(s.fontScale),
      bw: s.printBw === true,
      chordColor: U.validColor(s.chordColor),
      setName: set && set.name ? String(set.name) : undefined,
      songs: uniqueRecords(ctx.songs),
      set: set,
      includeContents: true
    };
  }

  function baseName(sheets, ctx, opts) {
    if (ctx.filenameBase) return String(ctx.filenameBase);
    return U.isSet(sheets) ? U.setName(sheets, opts) : String(sheets[0].title);
  }

  function deliver(data, filename, mime, action, what) {
    if (action === 'copy') {
      return D.copyText(data).then(function (ok) {
        return ok ? { ok: true, message: 'Copied ' + what + ' to the clipboard' }
          : { ok: false, message: 'Could not copy to the clipboard. Try Download instead.' };
      });
    }
    if (action === 'share') {
      return D.shareOrDownload(data, filename, mime, { title: filename }).then(function (how) {
        if (how === 'shared') return { ok: true, message: 'Shared ' + filename };
        if (how === 'cancelled') return { ok: true, message: '' };
        return { ok: true, message: 'Downloaded ' + filename };
      });
    }
    D.download(data, filename, mime);
    return Promise.resolve({ ok: true, message: 'Downloaded ' + filename });
  }

  function warn(ctx, message) {
    if (typeof ctx.toast === 'function') ctx.toast(message, { type: 'warning', duration: 12000 });
  }

  function records(sheets, opts) {
    return opts.songs.length ? opts.songs : sheets.map(U.recordFromSheet);
  }

  function produce(id, sheets, opts, ctx) {
    switch (id) {
      case 'txt': return TX.exportText(sheets, opts);
      case 'cho': return CP.exportChordPro(sheets, opts);
      case 'songbase': return SB.exportSongbaseText(sheets, opts);
      case 'html': return H.exportHtml(sheets, opts);
      case 'json': return B.exportJsonBackup({ songs: records(sheets, opts), sets: opts.set ? [opts.set] : [], settings: null });
      case 'pdf':
        return V.loadVendor('jspdf').then(function (lib) { return PE.exportPdf(sheets, opts, lib); }).then(function (r) {
          if (r.dropped > 0) {
            warn(ctx, r.dropped + ' character' + (r.dropped === 1 ? '' : 's') + ' could not be drawn with the PDF’s built-in fonts and show as “?”. ' +
              'For Greek, Cyrillic, Chinese, Korean or Arabic lyrics use Print / Save as PDF instead.');
          }
          return r.blob;
        });
      case 'docx':
        return V.loadVendor('docx').then(function (lib) { return DX.exportDocx(sheets, opts, lib); }).then(function (r) { return r.blob; });
    }
    throw new Error('No exporter for "' + id + '".');
  }

  function runUnchecked(id, sheets, ctx) {
    var item = BY_ID[id];
    if (!item) return { ok: false, message: 'Unknown export "' + id + '".' };
    if (!Array.isArray(sheets) || !sheets.length || !sheets.every(function (s) { return s && Array.isArray(s.blocks); })) {
      return { ok: false, message: 'Nothing to export.' };
    }
    var action = ctx.action || 'download';
    if (action !== 'download' && action !== 'copy' && action !== 'share') return { ok: false, message: 'Unknown export action "' + action + '".' };
    if (action === 'copy' && !canCopy(id)) return { ok: false, message: item.label + ' cannot be copied; download it instead.' };
    var opts = exportOptions(sheets, ctx);
    var base = baseName(sheets, ctx, opts);
    opts.title = base;
    if (id === 'print') {
      return PR.printSheets(sheets, opts).then(function () { return { ok: true, message: '' }; });
    }
    var filename = U.buildFilename(base, item.ext, U.isSet(sheets) ? 'set-list' : 'song');
    return Promise.resolve(produce(id, sheets, opts, ctx)).then(function (data) {
      return deliver(data, filename, MIME_BY_ID[id], action, item.label);
    });
  }

  function run(id, sheets, ctx) {
    ctx = ctx || {};
    return Promise.resolve().then(function () { return runUnchecked(id, sheets, ctx); }).then(null, function (err) {
      var label = BY_ID[id] ? BY_ID[id].label : 'Export';
      if (root.console && typeof root.console.error === 'function') root.console.error('Songsheets: ' + label + ' export failed', err);
      return { ok: false, message: label + ' export failed: ' + (err && err.message ? err.message : String(err)) };
    });
  }

  var api = {
    list: list,
    run: run,
    canCopy: canCopy,
    canShare: canShare
  };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.export = root.SongSheets.export || {};
  root.SongSheets.export.exportMenu = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
