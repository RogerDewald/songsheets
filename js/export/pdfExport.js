/* Songsheets — draws a pdfLayout with jsPDF (vendor/jspdf.umd.min.js, loaded by exportMenu through
 * vendorLoader: this file never loads it, because it is listed before vendorLoader.js).
 *
 * exportPdf(sheets, opts, jspdf) -> Promise<{blob, dropped, pages, warnings}>   jspdf = the UMD global
 * buildPdf(sheets, opts, jspdf) -> {doc, layout}      (sync; used by tests and exportPdf)
 * renderPdf(layout, doc) -> doc;  createMeasure(doc) -> measure(text, font)
 * Browser: window.SongSheets.export.pdfExport   Node: require('./pdfExport.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var L = isNode ? require('./pdfLayout.js') : root.SongSheets.export.pdfLayout;
  var U = isNode ? require('./util.js') : root.SongSheets.export.util;

  /** Widths from jsPDF's own font metrics; jsPDF draws without kerning, so measured == drawn. */
  function createMeasure(doc) {
    var cache = new Map();
    return function measure(text, font) {
      var key = font.family + '|' + font.style + '|' + font.size + '|' + text;
      var w = cache.get(key);
      if (w === undefined) {
        doc.setFont(font.family, font.style);
        doc.setFontSize(font.size);
        w = doc.getTextWidth(text);
        cache.set(key, w);
      }
      return w;
    };
  }

  function newDoc(jspdf, opts) {
    var Ctor = jspdf && (jspdf.jsPDF || jspdf.default);
    if (typeof Ctor !== 'function') throw new Error('jsPDF did not load (vendor/jspdf.umd.min.js).');
    return new Ctor({ unit: 'pt', format: opts.pageSize === 'Letter' ? 'letter' : 'a4', orientation: 'portrait', compress: true });
  }

  function renderPdf(layout, doc) {
    if (!layout.pages.length) throw new Error('Nothing to put in the PDF.');
    layout.pages.forEach(function (page, i) {
      if (i > 0) doc.addPage();
      doc.setPage(i + 1);
      page.ops.forEach(function (op) {
        if (op.type === 'text') {
          doc.setFont(op.font.family, op.font.style);
          doc.setFontSize(op.font.size);
          doc.setTextColor(op.color || '#000000');
          doc.text(op.text, op.x, op.y);
        } else if (op.type === 'link') {
          doc.link(op.x, op.y, op.w, op.h, { pageNumber: op.page });
        }
      });
    });
    layout.outline.forEach(function (o) { doc.outline.add(null, o.title, { pageNumber: o.page }); });
    return doc;
  }

  function buildPdf(sheets, opts, jspdf) {
    opts = opts || {};
    var doc = newDoc(jspdf, opts);
    var layout = L.layoutPdf(sheets, opts, createMeasure(doc));
    renderPdf(layout, doc);
    var props = { title: opts.title || (U.isSet(sheets) ? U.setName(sheets, opts) : sheets[0].title), creator: U.APP_ID };
    if (!U.isSet(sheets) && sheets[0].author) props.author = String(sheets[0].author);
    doc.setProperties(props);
    return { doc: doc, layout: layout };
  }

  function exportPdf(sheets, opts, jspdf) {
    return Promise.resolve().then(function () {
      var r = buildPdf(sheets, opts, jspdf);
      return { blob: r.doc.output('blob'), dropped: r.layout.dropped, pages: r.layout.pages.length, warnings: r.layout.warnings };
    });
  }

  var api = {
    exportPdf: exportPdf,
    buildPdf: buildPdf,
    renderPdf: renderPdf,
    createMeasure: createMeasure
  };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.export = root.SongSheets.export || {};
  root.SongSheets.export.pdfExport = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
