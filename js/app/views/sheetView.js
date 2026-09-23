/* Songsheets — a rendered song sheet with its controls (chords, transpose, key, accidentals,
 * tune, font size, capo presets). Used by the song viewer and by set-list play mode.
 *
 * S.sheetView.create(ctx, {
 *   getSong(): song record,
 *   getPrefs(): {transpose, accidentals, tuneIndex, capoOverride},
 *   setPrefs(patch),
 *   extraControls: Node[] (right side of the toolbar),
 *   headerExtra: Node|null (shown under the title),
 *   setContext
 * }) -> {el, refresh(), getSheet(), onKey(e), destroy()}
 */
(function (root) {
  'use strict';
  var S = root.SongSheets;
  var D = S.dom;
  var h = D.h;
  var T = S.transpose;

  var MIN_SCALE = 0.7;
  var MAX_SCALE = 2.2;

  function metaLine(sheet) {
    var parts = [];
    if (sheet.author) parts.push(sheet.author);
    if (sheet.showChords && sheet.targetKeyLabel) parts.push('Key ' + sheet.targetKeyLabel);
    if (sheet.showChords && sheet.capo && (sheet.capo.source === 'override' || !sheet.capo.active)) parts.push('Capo ' + sheet.capo.n);
    if (sheet.tuneTitle) parts.push(sheet.tuneTitle);
    return parts.join(' · ');
  }

  function create(ctx, opts) {
    var sheet = null;
    var toolbar = h('div', { class: 'sheet-toolbar', role: 'toolbar', 'aria-label': 'Sheet controls' });
    var titleEl = h('h1', { class: 'sheet-title' });
    var metaEl = h('p', { class: 'sheet-meta' });
    var column = h('div', { class: 'sheet-column' });
    var page = h('article', { class: 'sheet-page' },
      h('header', { class: 'sheet-header' }, titleEl, metaEl, opts.headerExtra || null),
      column);
    var el = h('div', { class: 'sheet-view' }, toolbar, page);

    function settings() { return ctx.store.get().settings; }

    function build() {
      var song = opts.getSong();
      if (!song) return null;
      var prefs = opts.getPrefs();
      var st = settings();
      return S.sheetModel.buildSheet(song, {
        tuneIndex: prefs.tuneIndex,
        transpose: prefs.transpose,
        accidentals: prefs.accidentals || st.accidentals,
        showChords: st.showChords,
        capoOverride: prefs.capoOverride,
        setContext: opts.setContext || null
      });
    }

    function setTranspose(s) {
      opts.setPrefs({ transpose: T.mod(s, 12) });
    }

    function renderToolbar() {
      var st = settings();
      var prefs = opts.getPrefs();
      var active = root.document.activeElement;
      var refocus = active && toolbar.contains(active) ? active.getAttribute('aria-label') || active.getAttribute('title') : null;
      D.clear(toolbar);
      var groups = [];
      root.setTimeout(function () {
        if (!refocus) return;
        var again = Array.prototype.filter.call(toolbar.querySelectorAll('button, select'), function (n) {
          return (n.getAttribute('aria-label') || n.getAttribute('title')) === refocus && !n.disabled;
        })[0];
        if (again) again.focus();
      }, 0);

      if (sheet.sourceHasChords) {
        groups.push(h('div', { class: 'ctl-group' },
          h('button', {
            type: 'button', class: ['btn', 'btn-toggle', st.showChords ? 'is-on' : null], 'aria-pressed': String(st.showChords),
            title: (st.showChords ? 'Hide' : 'Show') + ' chords (C)',
            on: { click: function () { ctx.actions.updateSettings({ showChords: !st.showChords }); } }
          }, D.icon('music', { size: 18 }), h('span', { class: 'btn-label' }, 'Chords'))));
      }

      if (sheet.sourceHasChords && st.showChords) {
        var choices = T.keyChoices(sheet.key);
        var keySel = D.select(choices.map(function (c) {
          var signed = c.semitones > 6 ? c.semitones - 12 : c.semitones;
          var off = signed === 0 ? '' : ' (' + (signed > 0 ? '+' : '−') + Math.abs(signed) + ')';
          return { value: c.semitones, label: c.label + off };
        }), sheet.transpose, function (v) { setTranspose(parseInt(v, 10)); }, { 'aria-label': 'Key', title: 'Choose a key' });
        groups.push(h('div', { class: 'ctl-group transpose-group' },
          D.iconButton('minus', 'Transpose down (−)', function () { setTranspose(sheet.transpose - 1); }),
          keySel,
          D.iconButton('plus', 'Transpose up (+)', function () { setTranspose(sheet.transpose + 1); }),
          sheet.transpose !== 0
            ? h('button', { type: 'button', class: 'btn btn-small btn-ghost', title: 'Back to the written key (0)', on: { click: function () { setTranspose(0); } } }, 'Reset')
            : null));
        groups.push(h('div', { class: 'ctl-group' },
          D.select([
            { value: '', label: 'Auto ♯/♭' },
            { value: 'sharp', label: 'Sharps ♯' },
            { value: 'flat', label: 'Flats ♭' }
          ], prefs.accidentals || '', function (v) { opts.setPrefs({ accidentals: v || null }); }, { 'aria-label': 'Sharps or flats', title: 'Spell chords with sharps or flats' })));
      }

      if (sheet.tuneCount > 1) {
        groups.push(h('div', { class: 'ctl-group' },
          D.select(sheet.tuneTitles.map(function (t, i) { return { value: i, label: t }; }), sheet.tuneIndex, function (v) {
            opts.setPrefs({ tuneIndex: parseInt(v, 10), transpose: 0 });     // songbase resets transpose on tune change
          }, { 'aria-label': 'Tune', title: 'Choose a tune' })));
      }

      groups.push(h('div', { class: 'ctl-group' },
        h('button', { type: 'button', class: 'btn btn-icon', title: 'Smaller text', 'aria-label': 'Smaller text', disabled: st.fontScale <= MIN_SCALE, on: { click: function () { bumpFont(-0.1); } } }, h('span', { class: 'font-glyph small-a' }, 'A')),
        h('button', { type: 'button', class: 'btn btn-icon', title: 'Larger text', 'aria-label': 'Larger text', disabled: st.fontScale >= MAX_SCALE, on: { click: function () { bumpFont(0.1); } } }, h('span', { class: 'font-glyph big-a' }, 'A'))));

      groups.forEach(function (g) { toolbar.appendChild(g); });
      if (opts.extraControls && opts.extraControls.length) {
        toolbar.appendChild(h('div', { class: 'ctl-group ctl-extra' }, opts.extraControls));
      }
    }

    function bumpFont(delta) {
      var s = Math.round((settings().fontScale + delta) * 10) / 10;
      ctx.actions.updateSettings({ fontScale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, s)) });
    }

    function renderSheet() {
      titleEl.textContent = sheet.title;
      var meta = metaLine(sheet);
      metaEl.textContent = meta;
      metaEl.hidden = !meta;
      var vnode = S.render.render(sheet, { fontScale: settings().fontScale });
      D.replaceChildren(column, S.render.toDOM(vnode, root.document));
      if (!sheet.blocks.length) {
        column.appendChild(h('p', { class: 'muted' }, 'This song has no words yet.'));
      }
    }

    function refresh() {
      sheet = build();
      if (!sheet) return;
      renderToolbar();
      renderSheet();
    }

    // capo presets: click, Enter or Space toggles between +n and 0 (songbase behaviour)
    function capoToggle(target) {
      var n = parseInt(target.getAttribute('data-capo'), 10);
      if (!n) return;
      setTranspose(sheet.transpose === n ? 0 : n);
    }
    var offClick = D.delegate(column, 'click', '.transpose-preset', function (e, t) { capoToggle(t); });
    var offKey = D.delegate(column, 'keydown', '.transpose-preset', function (e, t) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); capoToggle(t); }
    });

    var unsub = ctx.store.subscribe(function (st, patch) {
      if (patch.songs || patch.settings || patch.sets) refresh();
    });

    refresh();

    return {
      el: el,
      refresh: refresh,
      getSheet: function () { return sheet; },
      onKey: function (e) {
        if (D.isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || !sheet) return false;
        var st = settings();
        if ((e.key === '+' || e.key === '=') && sheet.sourceHasChords && st.showChords) { setTranspose(sheet.transpose + 1); return true; }
        if ((e.key === '-' || e.key === '_') && sheet.sourceHasChords && st.showChords) { setTranspose(sheet.transpose - 1); return true; }
        if (e.key === '0' && sheet.sourceHasChords) { setTranspose(0); return true; }
        if ((e.key === 'c' || e.key === 'C') && sheet.sourceHasChords) { ctx.actions.updateSettings({ showChords: !st.showChords }); return true; }
        return false;
      },
      destroy: function () { unsub(); offClick(); offKey(); }
    };
  }

  S.sheetView = { create: create, metaLine: metaLine };
})(typeof globalThis !== 'undefined' ? globalThis : this);
