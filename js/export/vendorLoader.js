/* Songsheets — loads a vendored library on first use (jsPDF 420 KB, docx 1.1 MB), so they cost
 * nothing until someone exports a PDF or Word file. A classic <script src="vendor/…"> is injected:
 * that works from file:// (no fetch, no modules) and from any sub-path on GitHub Pages.
 * loadVendor('jspdf'|'docx') -> Promise<window.jspdf | window.docx>   (Node: the required UMD)
 * Browser: window.SongSheets.export.vendorLoader   Node: require('./vendorLoader.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;

  var LIBS = {
    jspdf: { file: 'jspdf.umd.min.js', global: 'jspdf', check: function (g) { return g && typeof g.jsPDF === 'function'; } },
    docx: { file: 'docx.umd.js', global: 'docx', check: function (g) { return g && typeof g.Document === 'function' && !!g.Packer; } }
  };
  var pending = {};

  function loadVendor(name, opts) {
    var lib = LIBS[name];
    if (!lib) return Promise.reject(new Error('Unknown library "' + name + '".'));
    if (isNode) {
      return new Promise(function (resolve) { resolve(require('../../vendor/' + lib.file)); });
    }
    if (lib.check(root[lib.global])) return Promise.resolve(root[lib.global]);
    if (pending[name]) return pending[name];
    var doc = root.document;
    var base = opts && opts.base != null ? opts.base : 'vendor/';
    pending[name] = new Promise(function (resolve, reject) {
      var s = doc.createElement('script');
      s.src = base + lib.file;
      s.async = true;
      function fail(message) {
        delete pending[name];                        // allow a retry (e.g. after a flaky connection)
        s.remove();
        reject(new Error(message));
      }
      s.onload = function () {
        if (lib.check(root[lib.global])) resolve(root[lib.global]);
        else fail(s.src + ' loaded but did not define window.' + lib.global + '.');
      };
      s.onerror = function () { fail('Could not load ' + s.src + '. Is the vendor folder next to index.html?'); };
      doc.head.appendChild(s);
    });
    return pending[name];
  }

  var api = { loadVendor: loadVendor, LIBS: LIBS };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.export = root.SongSheets.export || {};
  root.SongSheets.export.vendorLoader = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
