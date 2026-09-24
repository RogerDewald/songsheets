/* Songsheets — service worker: cache-first app shell so the app works offline once visited.
 * Bump VERSION (tools/bump-version.js) whenever any cached file changes. */
'use strict';
var VERSION = '1.1.0';
var CACHE = 'songsheets-' + VERSION;
var ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './css/themes.css',
  './css/sheet.css',
  './css/app.css',
  './css/print.css',
  './js/core/normalize.js',
  './js/core/ids.js',
  './js/core/chords.js',
  './js/core/transpose.js',
  './js/core/parser.js',
  './js/core/sheetModel.js',
  './js/core/render.js',
  './js/core/search.js',
  './js/export/util.js',
  './js/export/cssStrings.js',
  './js/export/textExport.js',
  './js/export/songbaseText.js',
  './js/export/chordpro.js',
  './js/export/backup.js',
  './js/export/htmlExport.js',
  './js/export/pdfText.js',
  './js/export/pdfLayout.js',
  './js/export/pdfExport.js',
  './js/export/docxModel.js',
  './js/export/docxExport.js',
  './js/export/download.js',
  './js/export/vendorLoader.js',
  './js/export/printRoute.js',
  './js/export/exportMenu.js',
  './js/app/dom.js',
  './js/app/store.js',
  './js/app/storage.js',
  './js/app/router.js',
  './js/app/ui.js',
  './js/app/example.js',
  './js/app/views/sheetView.js',
  './js/app/views/library.js',
  './js/app/views/viewer.js',
  './js/app/views/editor.js',
  './js/app/views/sets.js',
  './js/app/views/settings.js',
  './js/app/main.js',
  './vendor/jspdf.umd.min.js',
  './vendor/docx.umd.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.addAll(ASSETS); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('songsheets-') === 0 && k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).catch(function () {
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
