/* Songsheets — minimal state store.
 * Browser: window.SongSheets.store   Node: require('./store.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;

  function createStore(initial) {
    var state = initial || {};
    var subs = [];
    return {
      get: function () { return state; },
      set: function (patch) {
        var p = typeof patch === 'function' ? patch(state) : patch;
        if (!p) return state;
        state = Object.assign({}, state, p);
        subs.slice().forEach(function (fn) {
          try { fn(state, p); } catch (e) { if (root.console) root.console.error(e); }
        });
        return state;
      },
      subscribe: function (fn) {
        subs.push(fn);
        return function () { subs = subs.filter(function (f) { return f !== fn; }); };
      }
    };
  }

  var api = { createStore: createStore };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.store = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
