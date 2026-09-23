/* Songsheets — hash router. Hash routes work on file:// and on GitHub Pages (no server rewrites).
 * Browser: window.SongSheets.router   Node: require('./router.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;

  var ROUTES = [
    { name: 'library', pattern: '/library' },
    { name: 'song', pattern: '/song/:id' },
    { name: 'edit', pattern: '/edit/:id' },
    { name: 'new', pattern: '/new' },
    { name: 'sets', pattern: '/sets' },
    { name: 'set', pattern: '/set/:id' },
    { name: 'play', pattern: '/set/:id/play/:index' },
    { name: 'settings', pattern: '/settings' },
    { name: 'help', pattern: '/help' }
  ];

  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  /** '#/song/abc?tune=1' -> {path:'/song/abc', query:{tune:'1'}} */
  function parseHash(hash) {
    var h = String(hash || '').replace(/^#/, '');
    var qi = h.indexOf('?');
    var path = qi >= 0 ? h.slice(0, qi) : h;
    var query = {};
    if (qi >= 0) {
      h.slice(qi + 1).split('&').forEach(function (pair) {
        if (!pair) return;
        var eq = pair.indexOf('=');
        var k = safeDecode((eq >= 0 ? pair.slice(0, eq) : pair).replace(/\+/g, ' '));
        var v = eq >= 0 ? safeDecode(pair.slice(eq + 1).replace(/\+/g, ' ')) : '';
        query[k] = v;
      });
    }
    if (path === '' || path === '/') path = '/library';
    if (path.charAt(0) !== '/') path = '/' + path;
    return { path: path.replace(/\/+$/, '') || '/library', query: query };
  }

  function matchRoute(path, routes) {
    routes = routes || ROUTES;
    var parts = path.split('/').filter(Boolean);
    for (var i = 0; i < routes.length; i++) {
      var pp = routes[i].pattern.split('/').filter(Boolean);
      if (pp.length !== parts.length) continue;
      var params = {};
      var ok = pp.every(function (seg, j) {
        if (seg.charAt(0) === ':') { params[seg.slice(1)] = safeDecode(parts[j]); return true; }
        return seg === parts[j];
      });
      if (ok) return { name: routes[i].name, params: params };
    }
    return null;
  }

  function buildHash(path, query) {
    var q = Object.keys(query || {}).filter(function (k) { return query[k] !== undefined && query[k] !== null && query[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]); }).join('&');
    return '#' + path + (q ? '?' + q : '');
  }

  /** Browser router: onChange({name, params, query, path}) on every hash change. */
  function createRouter(onChange, routes) {
    routes = routes || ROUTES;
    var guard = null;             // function(nextRoute) -> boolean (false blocks)
    var lastHash = null;
    function current() {
      var p = parseHash(root.location.hash);
      var m = matchRoute(p.path, routes) || { name: 'notfound', params: {} };
      return { name: m.name, params: m.params, query: p.query, path: p.path };
    }
    function dispatch() {
      var r = current();
      if (guard && lastHash !== null && guard(r) === false) {
        // restore the previous hash without dispatching again
        root.history.replaceState(null, '', lastHash);
        return;
      }
      lastHash = root.location.hash || '#/library';
      onChange(r);
    }
    root.addEventListener('hashchange', dispatch);
    return {
      start: function () { dispatch(); },
      current: current,
      navigate: function (path, opts) {
        var hash = path.charAt(0) === '#' ? path : '#' + path;
        if (opts && opts.replace) {
          root.history.replaceState(null, '', hash);
          dispatch();
        } else if (root.location.hash === hash) {
          dispatch();
        } else {
          root.location.hash = hash;
        }
      },
      setGuard: function (fn) { guard = fn; }
    };
  }

  var api = { ROUTES: ROUTES, parseHash: parseHash, matchRoute: matchRoute, buildHash: buildHash, createRouter: createRouter };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.router = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
