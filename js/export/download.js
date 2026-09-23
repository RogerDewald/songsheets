/* Songsheets — getting an export out of the browser: download, share sheet, clipboard.
 * download(data, filename, mime)                       Blob + <a download>, works on file:// and https
 * shareOrDownload(data, filename, mime, {title}) -> Promise<'shared'|'cancelled'|'downloaded'>
 * copyText(text) -> Promise<boolean>                   Clipboard API, execCommand fallback
 * canShareFiles() -> boolean                           navigator.share with files (never Firefox)
 * Browser: window.SongSheets.export.download   Node: require('./download.js') (for stubbing in tests)
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;

  function toBlob(data, mime) {
    if (typeof Blob !== 'undefined' && data instanceof Blob) return data;
    return new Blob([data], { type: mime });
  }

  function download(data, filename, mime) {
    var doc = root.document;
    if (!doc || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      throw new Error('Downloading needs a browser window.');
    }
    var url = URL.createObjectURL(toBlob(data, mime));
    var a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    doc.body.appendChild(a);                          // Firefox only follows links that are in the page
    try {
      a.click();
    } finally {
      // Safari needs the object URL to outlive the click
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
    }
  }

  function canShareFiles() {
    var nav = root.navigator;
    if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function' || typeof File === 'undefined') return false;
    try {
      return nav.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] });
    } catch (e) {
      return false;                                   // canShare throws on some browsers for files: treat as "no"
    }
  }

  function shareOrDownload(data, filename, mime, meta) {
    var nav = root.navigator;
    var blob = toBlob(data, mime);
    if (canShareFiles()) {
      var file = new File([blob], filename, { type: mime.split(';')[0] });
      if (nav.canShare({ files: [file] })) {
        return nav.share({ files: [file], title: (meta && meta.title) || filename }).then(function () {
          return 'shared';
        }, function (err) {
          if (err && err.name === 'AbortError') return 'cancelled';   // the user closed the share sheet
          download(blob, filename, mime);                             // share failed: still deliver the file
          return 'downloaded';
        });
      }
    }
    return Promise.resolve().then(function () {
      download(blob, filename, mime);
      return 'downloaded';
    });
  }

  function execCommandCopy(text) {
    var doc = root.document;
    if (!doc || typeof doc.execCommand !== 'function') return false;
    var ta = doc.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    doc.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = doc.execCommand('copy'); } finally { ta.remove(); }
    return !!ok;
  }

  function copyText(text) {
    var nav = root.navigator;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      return nav.clipboard.writeText(text).then(function () { return true; }, function () { return execCommandCopy(text); });
    }
    return Promise.resolve().then(function () { return execCommandCopy(text); });
  }

  var api = {
    download: download,
    shareOrDownload: shareOrDownload,
    copyText: copyText,
    canShareFiles: canShareFiles
  };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.export = root.SongSheets.export || {};
  root.SongSheets.export.download = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
