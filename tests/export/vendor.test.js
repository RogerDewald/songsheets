'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Must match vendor/README.md. A changed file fails here rather than shipping unreviewed code.
const VENDORED = [
  { file: 'jspdf.umd.min.js', size: 420165, sha256: 'e6551fcdc32f09d6853b2c5126d18d01d9447e0da618a41a11ebeee0f6c20d54', header: 'Version 4.2.1 Built on 2026-03-17T11:11:27.056Z' },
  { file: 'docx.umd.js', size: 1127374, sha256: '6fa7146965cc9bc2e5d53b73516c6ed8b070285c9f24f8d84fde24b5f212bf54', header: 'global.docx = {}' }
];
const dir = path.join(__dirname, '..', '..', 'vendor');

for (const v of VENDORED) {
  test('vendor/' + v.file + ' is the pinned build', () => {
    const buf = fs.readFileSync(path.join(dir, v.file));
    assert.equal(buf.length, v.size);
    assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), v.sha256);
    assert.ok(buf.toString('utf8').includes(v.header));
  });
}

test('licences are vendored and the README records the same hashes', () => {
  assert.match(fs.readFileSync(path.join(dir, 'LICENSES', 'jspdf-LICENSE.txt'), 'utf8'), /James Hall/);
  assert.match(fs.readFileSync(path.join(dir, 'LICENSES', 'docx-LICENSE.txt'), 'utf8'), /MIT License/);
  const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  for (const v of VENDORED) assert.ok(readme.includes(v.sha256) && readme.includes(v.size.toLocaleString('en-US')), v.file);
});

test('both bundles load in Node and expose what the exporters use', () => {
  const jspdf = require(path.join(dir, 'jspdf.umd.min.js'));
  const docx = require(path.join(dir, 'docx.umd.js'));
  assert.equal(typeof jspdf.jsPDF, 'function');
  ['Document', 'Packer', 'Paragraph', 'TextRun', 'Tab', 'Footer', 'Bookmark', 'InternalHyperlink'].forEach((k) => assert.equal(typeof docx[k], 'function', k));
  assert.ok(docx.PageNumber.CURRENT && docx.PageNumber.TOTAL_PAGES && docx.TabStopType.LEFT && docx.AlignmentType.CENTER);
});
