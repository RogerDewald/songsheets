# Vendored libraries

Loaded only when first needed, by `js/export/vendorLoader.js` (a classic `<script>` tag, so it
works from `file://` too). They are not listed in `index.html`. `tests/export/vendor.test.js`
recomputes the hashes below; if a file changes, that test fails.

| Library | Version | File | Global | Size (bytes) | SHA-256 | Licence |
|---|---|---|---|---|---|---|
| jsPDF | 4.2.1 (header: "Version 4.2.1 Built on 2026-03-17T11:11:27.056Z") | `jspdf.umd.min.js` | `window.jspdf` (`jspdf.jsPDF`) | 420,165 | `e6551fcdc32f09d6853b2c5126d18d01d9447e0da618a41a11ebeee0f6c20d54` | MIT, `LICENSES/jspdf-LICENSE.txt` |
| docx | 9.7.2 | `docx.umd.js` | `window.docx` | 1,127,374 | `6fa7146965cc9bc2e5d53b73516c6ed8b070285c9f24f8d84fde24b5f212bf54` | MIT, `LICENSES/docx-LICENSE.txt` |

Downloaded 2026-09-23 from:

- https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js
  (byte-identical copies: https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js,
  https://unpkg.com/jspdf@4.2.1/dist/jspdf.umd.min.js)
- https://cdn.jsdelivr.net/npm/jspdf@4.2.1/LICENSE
- https://cdn.jsdelivr.net/npm/docx@9.7.2/dist/index.umd.cjs, saved as `docx.umd.js` so every
  server sends it as JavaScript (jsDelivr labels `.cjs` as `application/node`)
  (byte-identical copy: https://unpkg.com/docx@9.7.2/dist/index.umd.cjs)
- https://cdn.jsdelivr.net/npm/docx@9.7.2/LICENSE

To re-vendor, download with `curl.exe -L --fail -o <file> <url>`, check the SHA-256
(`Get-FileHash <file> -Algorithm SHA256` or `sha256sum <file>`), then update this table and the
hashes in `tests/export/vendor.test.js` together. Both files are self-contained UMD bundles:
the browser gets a global, and Node can `require()` them (the export integration tests do).
Do not use jsPDF's `jspdf.node.min.js`: it needs an unbundled `fflate`.
