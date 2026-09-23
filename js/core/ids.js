/* Songsheets — id and timestamp helpers.
 * Browser: window.SongSheets.ids   Node: require('./ids.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;

  function newId() {
    var c = root.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    var b = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function nowIso() { return new Date().toISOString(); }

  var api = { newId: newId, nowIso: nowIso };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.ids = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
