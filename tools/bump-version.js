#!/usr/bin/env node
/* Sets the app version in sw.js (cache name), js/app/main.js and package.json.
 * Usage: node tools/bump-version.js 1.0.1   (no argument: bump the patch number) */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
let next = process.argv[2];
if (!next) {
  const [a, b, c] = pkg.version.split('.').map(Number);
  next = [a, b, c + 1].join('.');
}
if (!/^\d+\.\d+\.\d+$/.test(next)) { console.error('Version must look like 1.2.3'); process.exit(1); }
function patch(file, re, replacement) {
  const p = path.join(root, file);
  const s = fs.readFileSync(p, 'utf8');
  if (!re.test(s)) { console.error('Version marker not found in ' + file); process.exit(1); }
  fs.writeFileSync(p, s.replace(re, replacement));
}
patch('sw.js', /var VERSION = '[^']*';/, `var VERSION = '${next}';`);
patch('js/app/main.js', /var APP_VERSION = '[^']*';/, `var APP_VERSION = '${next}';`);
pkg.version = next;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log('version ' + next);
