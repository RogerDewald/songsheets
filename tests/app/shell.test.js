'use strict';
// Guards for the static shell: every script/stylesheet index.html loads exists and is cached by the
// service worker, and the version numbers agree. A missing entry would break offline use silently.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('index.html assets exist and are cached by sw.js', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"#?]+)"/g)].map((m) => m[1])
    .filter((r) => !/^https?:/.test(r));
  assert.ok(refs.length > 30, 'parsed ' + refs.length + ' references');
  const sw = read('sw.js');
  const assets = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]);
  assert.ok(assets.length > 30);
  for (const r of refs) {
    assert.ok(fs.existsSync(path.join(root, r)), r + ' is missing');
    assert.ok(assets.includes(r), r + ' is not in the service worker cache list');
  }
  for (const a of assets) if (a) assert.ok(fs.existsSync(path.join(root, a)), 'sw.js caches missing file ' + a);
});

test('versions agree', () => {
  const pkg = JSON.parse(read('package.json')).version;
  assert.match(read('sw.js'), new RegExp("var VERSION = '" + pkg.replace(/\./g, '\\.') + "';"));
  assert.match(read('js/app/main.js'), new RegExp("var APP_VERSION = '" + pkg.replace(/\./g, '\\.') + "';"));
});

test('manifest is valid JSON with icons that exist', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.display, 'standalone');
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(root, i.src)), i.src);
});
