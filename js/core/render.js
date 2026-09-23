/* Songsheets — renders a Sheet to a small virtual DOM, then to real DOM or an escaped HTML string.
 * Emits songbase's structure and class names, so the songbase CSS technique applies:
 *   <div class="line"><span class="chord-word"><span class="chord" data-uncopyable-text="G"></span>Alpha</span> …</div>
 * The chord span is empty and zero-width; its label is drawn by CSS ::after { content: attr(...) },
 * so chords sit exactly over their syllable, never push lyrics, and are left out of copy/paste.
 * Browser: window.SongSheets.render   Node: require('./render.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;

  function h(tag, attrs) {
    var children = [];
    for (var i = 2; i < arguments.length; i++) pushChild(children, arguments[i]);
    return { tag: tag, attrs: attrs || {}, children: children };
  }

  function pushChild(list, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { pushChild(list, x); }); return; }
    if (typeof c === 'number') c = String(c);
    if (typeof c === 'string') {
      if (c === '') return;
      var last = list[list.length - 1];
      if (typeof last === 'string') { list[list.length - 1] = last + c; return; }
    }
    list.push(c);
  }

  // ---- line rendering -------------------------------------------------------------------------

  function runNode(run) {
    if (run.tie) return h('span', { 'class': 'musical-tie' }, run.text);
    var node = run.text;
    if (run.italic) node = h('i', null, node);
    if (run.bold) node = h('b', null, node);
    return node;
  }

  function chordNode(chord, opts) {
    if (opts.uncopyableChords) return h('span', { 'class': 'chord', 'data-uncopyable-text': chord });
    return h('span', { 'class': 'chord' }, chord);
  }

  /** Line segments -> atoms (chord | text piece) -> words; words with chords become span.chord-word. */
  function renderLineContent(line, opts) {
    var atoms = [];
    line.segments.forEach(function (seg) {
      if (seg.chord !== null && seg.chord !== undefined) atoms.push({ chord: seg.chord });
      var runs = seg.runs && seg.runs.length ? seg.runs : (seg.text ? [{ text: seg.text }] : []);
      runs.forEach(function (run) {
        run.text.split(/(\s+)/).forEach(function (piece) {
          if (piece === '') return;
          var r = {};
          for (var k in run) r[k] = run[k];
          r.text = piece;
          atoms.push({ run: r, space: /^\s+$/.test(piece) });
        });
      });
    });

    var out = [];
    var word = [];
    function flush() {
      if (!word.length) return;
      var hasChord = word.some(function (a) { return a.chord !== undefined; });
      var nodes = word.map(function (a) { return a.chord !== undefined ? chordNode(a.chord, opts) : runNode(a.run); });
      if (hasChord) out.push(h('span', { 'class': 'chord-word' }, nodes));
      else nodes.forEach(function (n) { out.push(n); });
      word = [];
    }
    atoms.forEach(function (a) {
      if (a.space) { flush(); out.push(a.run.text); }
      else word.push(a);
    });
    flush();
    return out;
  }

  function renderLine(line, opts, inChorus) {
    var prefix = inChorus ? '\t' + ' '.repeat(Math.max(0, line.indent || 0)) : '';
    return h('div', { 'class': 'line' }, prefix, renderLineContent(line, opts));
  }

  function renderRuns(runs) {
    return runs.map(runNode);
  }

  /** opts = { uncopyableChords: true, fontScale: 1, showComments: true, interactiveCapo: true, className: '' } */
  function render(sheet, opts) {
    opts = Object.assign({ uncopyableChords: true, fontScale: 1, showComments: true, interactiveCapo: true, className: '' }, opts || {});
    var children = [];
    sheet.blocks.forEach(function (b) {
      if (b.kind === 'blank') {
        children.push(h('br'));
      } else if (b.kind === 'stanza') {
        var num = null;
        if (b.number) {
          var withChords = b.lines.length > 0 && b.lines[0].hasChords;
          var cls = 'stanza-number' + (withChords ? ' with-chords' : '');
          num = opts.uncopyableChords
            ? h('div', { 'class': cls, 'data-uncopyable-text': b.number })
            : h('div', { 'class': cls }, b.number);
        }
        children.push(h('div', { 'class': 'stanza' }, num, b.lines.map(function (l) { return renderLine(l, opts, false); })));
      } else if (b.kind === 'chorus') {
        children.push(h('div', { 'class': 'chorus' }, b.lines.map(function (l) { return renderLine(l, opts, true); })));
      } else if (b.kind === 'comment') {
        if (opts.showComments) children.push(h('div', { 'class': 'comment' }, renderRuns(b.runs)));
      } else if (b.kind === 'capo') {
        var attrs = { 'class': 'transpose-preset comment' + (b.active ? ' active' : ''), 'data-capo': String(b.n) };
        if (opts.interactiveCapo) {
          attrs.role = 'button';
          attrs.tabindex = '0';
          attrs.title = b.active ? 'Show chords as written' : 'Show sounding chords (transpose +' + b.n + ')';
          attrs['aria-pressed'] = b.active ? 'true' : 'false';
        }
        children.push(h('div', attrs, b.text));
      } else if (b.kind === 'key') {
        if (opts.showComments) children.push(h('div', { 'class': 'comment key-comment' }, b.text));
      }
    });
    var cls = 'lyrics' + (sheet.hasChords ? '' : ' no-chords') + (opts.className ? ' ' + opts.className : '');
    var attrs = { 'class': cls };
    if (opts.fontScale && opts.fontScale !== 1) attrs.style = 'font-size:' + Number(opts.fontScale).toFixed(2) + 'em';
    return h('div', attrs, children);
  }

  // ---- output ---------------------------------------------------------------------------------

  var VOID = { br: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1 };

  function escapeText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) {
    return escapeText(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toHTML(node) {
    if (typeof node === 'string') return escapeText(node);
    var s = '<' + node.tag;
    Object.keys(node.attrs).forEach(function (k) {
      var v = node.attrs[k];
      if (v === null || v === undefined || v === false) return;
      s += ' ' + k + '="' + escapeAttr(v) + '"';
    });
    s += '>';
    if (VOID[node.tag]) return s;
    node.children.forEach(function (c) { s += toHTML(c); });
    return s + '</' + node.tag + '>';
  }

  function toDOM(node, doc) {
    doc = doc || root.document;
    if (typeof node === 'string') return doc.createTextNode(node);
    var el = doc.createElement(node.tag);
    Object.keys(node.attrs).forEach(function (k) {
      var v = node.attrs[k];
      if (v === null || v === undefined || v === false) return;
      el.setAttribute(k, String(v));
    });
    node.children.forEach(function (c) { el.appendChild(toDOM(c, doc)); });
    return el;
  }

  /** Convenience for exporters: a sheet's lyrics as an escaped HTML string. */
  function renderSheetHtml(sheet, opts) {
    return toHTML(render(sheet, Object.assign({ interactiveCapo: false }, opts || {})));
  }

  var api = {
    h: h,
    render: render,
    renderLineContent: renderLineContent,
    toHTML: toHTML,
    toDOM: toDOM,
    renderSheetHtml: renderSheetHtml,
    escapeText: escapeText,
    escapeAttr: escapeAttr
  };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.render = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
