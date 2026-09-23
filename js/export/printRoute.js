/* Songsheets — Print / Save as PDF through the browser.
 * printSheets builds the print document into #print-root (hidden on screen by css/print.css), sets
 * html.ss-printing so print.css hides the app and shows only that document, injects the @page rule
 * (page size and margins cannot come from CSS variables), sets document.title (Chrome's default
 * "Save as PDF" file name), waits for fonts and a frame, then calls window.print(). Everything is
 * undone on afterprint.
 *
 * printSheets(sheets, opts) -> Promise<void>   opts = {pageSize, fontScale, bw, chordColor, title, includeContents, setName}
 * renderPrintDocument(sheets, opts) -> string   (the same document as HTML; built in htmlExport.js)
 * Browser: window.SongSheets.export.printRoute   Node: require('./printRoute.js') (renderPrintDocument only)
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var R = isNode ? require('../core/render.js') : root.SongSheets.render;
  var H = isNode ? require('./htmlExport.js') : root.SongSheets.export.htmlExport;

  var FONT_WAIT_MS = 2000;

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /** Resolves when fonts are loaded, or after FONT_WAIT_MS; a failed font load still prints
   *  (with fallback fonts) rather than blocking the print. */
  function fontsReady(doc) {
    if (!doc.fonts || !doc.fonts.ready) return Promise.resolve();
    var ready = Promise.resolve(doc.fonts.ready).then(null, function () { return undefined; });
    return Promise.race([ready, wait(FONT_WAIT_MS)]);
  }

  function nextFrame() {
    if (typeof root.requestAnimationFrame !== 'function') return wait(0);
    return Promise.race([
      new Promise(function (resolve) { root.requestAnimationFrame(function () { resolve(); }); }),
      wait(200)
    ]);
  }

  function printSheets(sheets, opts) {
    opts = opts || {};
    var doc = root.document;
    if (!doc || typeof root.print !== 'function') return Promise.reject(new Error('Printing needs a browser window.'));
    if (!sheets || !sheets.length) return Promise.reject(new Error('Nothing to print.'));

    var host = doc.getElementById('print-root');
    if (!host) {
      host = doc.createElement('div');
      host.id = 'print-root';
      doc.body.appendChild(host);
    }
    host.textContent = '';
    host.appendChild(R.toDOM(H.printDocumentNode(sheets, opts), doc));

    var pageStyle = doc.getElementById('ss-print-page');
    if (!pageStyle) {
      pageStyle = doc.createElement('style');
      pageStyle.id = 'ss-print-page';
      doc.head.appendChild(pageStyle);
    }
    pageStyle.textContent = H.pageRule(opts);

    var html = doc.documentElement;
    var previousTitle = doc.title;
    html.classList.add('ss-printing');
    if (opts.title) doc.title = String(opts.title);

    var done = false;
    function cleanup() {
      if (done) return;
      done = true;
      root.removeEventListener('afterprint', cleanup);
      html.classList.remove('ss-printing');
      host.textContent = '';
      doc.title = previousTitle;
    }
    root.addEventListener('afterprint', cleanup);

    return fontsReady(doc).then(nextFrame).then(function () {
      try {
        root.print();
      } catch (e) {
        cleanup();
        throw e;
      }
    });
  }

  var api = {
    printSheets: printSheets,
    renderPrintDocument: H.renderPrintDocument
  };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.export = root.SongSheets.export || {};
  root.SongSheets.export.printRoute = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
