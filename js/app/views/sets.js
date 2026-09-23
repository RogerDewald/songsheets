/* Songsheets — Set lists: overview (#/sets), editor (#/set/:id) and play mode (#/set/:id/play/:index). */
(function (root) {
  'use strict';
  var S = root.SongSheets;
  var D = S.dom;
  var h = D.h;
  var T = S.transpose;

  function setList(st) {
    return Object.keys(st.sets).map(function (k) { return st.sets[k]; })
      .sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
  }

  S.views = S.views || {};

  // ---- overview -------------------------------------------------------------------------------
  S.views.sets = function (ctx) {
    var list = h('ul', { class: 'set-list', role: 'list' });
    var body = h('div');
    function newSet() {
      ctx.ui.prompt({ title: 'New set list', label: 'Name', value: 'Set ' + new Date().toLocaleDateString(), okLabel: 'Create' }).then(function (name) {
        if (!name) return;
        var id = ctx.actions.createSet(name);
        ctx.router.navigate('/set/' + encodeURIComponent(id));
      });
    }
    var el = h('section', { class: 'view view-sets' },
      h('div', { class: 'toolbar' }, h('div', { class: 'toolbar-row' },
        h('h1', { class: 'view-title' }, 'Set lists'),
        h('span', { class: 'spacer' }),
        D.button('New set list', newSet, { primary: true, icon: 'plus' }))),
      body);

    function render() {
      var st = ctx.store.get();
      var sets = setList(st);
      D.clear(body);
      if (!sets.length) {
        body.appendChild(h('div', { class: 'empty-state' },
          h('h2', null, 'No set lists yet'),
          h('p', null, 'A set list is an ordered group of songs, each in the key you want, that you can play through and export as one document.'),
          D.button('Create a set list', newSet, { primary: true, icon: 'plus' })));
        return;
      }
      D.clear(list);
      sets.forEach(function (s) {
        var titles = s.items.map(function (it) { return st.songs[it.songId] && st.songs[it.songId].title; }).filter(Boolean);
        list.appendChild(h('li', { class: 'set-row' },
          h('a', { class: 'set-link', href: '#/set/' + encodeURIComponent(s.id) },
            h('span', { class: 'song-title' }, s.name),
            h('span', { class: 'song-meta' }, titles.length + ' song' + (titles.length === 1 ? '' : 's') + (titles.length ? ': ' + titles.slice(0, 4).join(', ') + (titles.length > 4 ? '…' : '') : ''))),
          h('span', { class: 'song-date muted small' }, D.formatDate(s.updatedAt)),
          titles.length ? h('a', { class: 'btn btn-icon', href: '#/set/' + encodeURIComponent(s.id) + '/play/0', title: 'Play', 'aria-label': 'Play ' + s.name }, D.icon('play')) : null));
      });
      body.appendChild(list);
    }
    render();
    var unsub = ctx.store.subscribe(function (st, p) { if (p.sets || p.songs) D.keepFocus(el, render); });
    return { el: el, title: 'Set lists', destroy: unsub };
  };

  // ---- set editor -----------------------------------------------------------------------------
  S.views.set = function (ctx, route) {
    var id = route.params.id;
    function set() { return ctx.store.get().sets[id]; }
    if (!set()) return S.views.notFound(ctx, 'That set list does not exist.');

    var titleEl = h('h1', { class: 'view-title' });
    var itemsEl = h('ol', { class: 'set-items' });
    var addInput = h('input', { class: 'input', type: 'search', placeholder: 'Add a song: type to search your library', 'aria-label': 'Add a song to this set', autocomplete: 'off' });
    var results = h('ul', { class: 'typeahead', role: 'listbox', hidden: true });
    var dragFrom = null;

    function updateItems(fn) {
      var s = set();
      var items = s.items.map(function (it) { return Object.assign({}, it); });
      items = fn(items) || items;
      ctx.actions.updateSet(id, { items: items });
    }

    function addSong(songId) {
      updateItems(function (items) { items.push({ songId: songId, transpose: null, capo: null, tuneIndex: null }); });
      addInput.value = '';
      renderResults();
      addInput.focus();
      ctx.ui.toast('Added “' + ctx.store.get().songs[songId].title + '”', { type: 'ok', duration: 2000 });
    }

    function renderResults() {
      var q = addInput.value;
      D.clear(results);
      if (!q.trim()) { results.hidden = true; return; }
      var st = ctx.store.get();
      var songs = Object.keys(st.songs).map(function (k) { return st.songs[k]; });
      var found = S.search.searchSongs(songs, q, { limit: 8 });
      if (!found.length) {
        results.appendChild(h('li', { class: 'typeahead-empty muted' }, 'No songs match.'));
      }
      found.forEach(function (r, i) {
        results.appendChild(h('li', { role: 'option' },
          h('button', { type: 'button', class: 'typeahead-item', dataset: { index: i }, on: { click: function () { addSong(r.song.id); } } },
            r.song.title, r.song.author ? h('span', { class: 'muted small' }, ' · ' + r.song.author) : null)));
      });
      results.hidden = false;
    }
    addInput.addEventListener('input', renderResults);
    addInput.addEventListener('keydown', function (e) {
      var btns = results.querySelectorAll('.typeahead-item');
      if (e.key === 'ArrowDown' && btns.length) { e.preventDefault(); btns[0].focus(); }
      if (e.key === 'Enter' && btns.length) { e.preventDefault(); btns[0].click(); }
      if (e.key === 'Escape') { addInput.value = ''; renderResults(); }
    });
    results.addEventListener('keydown', function (e) {
      var btns = Array.prototype.slice.call(results.querySelectorAll('.typeahead-item'));
      var i = btns.indexOf(root.document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (btns[i + 1] || btns[i]).focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0) addInput.focus(); else btns[i - 1].focus(); }
      if (e.key === 'Escape') { addInput.focus(); }
    });

    function move(from, to) {
      updateItems(function (items) {
        if (to < 0 || to >= items.length) return items;
        var it = items.splice(from, 1)[0];
        items.splice(to, 0, it);
        return items;
      });
    }

    function itemRow(item, index, st) {
      var song = st.songs[item.songId];
      if (!song) return null;
      var base = S.sheetModel.buildSheet(song, { tuneIndex: item.tuneIndex === null ? song.tuneIndex : item.tuneIndex, transpose: 0, showChords: true });
      var effTranspose = item.transpose === null ? (song.transpose || 0) : item.transpose;
      var sheet = S.sheetModel.buildSheet(song, {
        tuneIndex: item.tuneIndex === null ? song.tuneIndex : item.tuneIndex,
        transpose: effTranspose, capoOverride: item.capo, showChords: true,
        accidentals: song.accidentals || st.settings.accidentals
      });
      function setItem(patch) {
        updateItems(function (items) { Object.assign(items[index], patch); });
      }
      var controls = [];
      if (base.sourceHasChords) {
        var keyOpts = [{ value: 'song', label: 'Song’s key (' + (T.keyLabel(base.key, song.transpose || 0) || '?') + ')' }]
          .concat(T.keyChoices(base.key).map(function (c) { return { value: c.semitones, label: c.label }; }));
        controls.push(h('label', { class: 'mini-field' }, h('span', null, 'Key'),
          D.select(keyOpts, item.transpose === null ? 'song' : item.transpose, function (v) {
            setItem({ transpose: v === 'song' ? null : parseInt(v, 10) });
          }, { 'aria-label': 'Key for ' + song.title })));
        var capoOpts = [{ value: '', label: 'No capo' }];
        for (var c = 1; c <= 9; c++) capoOpts.push({ value: c, label: 'Capo ' + c });
        controls.push(h('label', { class: 'mini-field' }, h('span', null, 'Capo'),
          D.select(capoOpts, item.capo === null ? '' : item.capo, function (v) {
            setItem({ capo: v === '' ? null : parseInt(v, 10) });
          }, { 'aria-label': 'Capo for ' + song.title })));
      }
      if (base.tuneCount > 1) {
        controls.push(h('label', { class: 'mini-field' }, h('span', null, 'Tune'),
          D.select([{ value: '', label: 'Song’s tune' }].concat(base.tuneTitles.map(function (t, i) { return { value: i, label: t }; })),
            item.tuneIndex === null ? '' : item.tuneIndex, function (v) { setItem({ tuneIndex: v === '' ? null : parseInt(v, 10) }); },
            { 'aria-label': 'Tune for ' + song.title })));
      }
      var shapes = sheet.capo && sheet.capo.source === 'override'
        ? 'Sounds in ' + (T.keyLabel(base.key, effTranspose) || '?') + ', play ' + (sheet.targetKeyLabel || '?') + ' shapes'
        : null;
      var li = h('li', { class: 'set-item', draggable: 'true', dataset: { index: index } },
        h('span', { class: 'drag-handle', title: 'Drag to reorder', 'aria-hidden': 'true' }, D.icon('grip', { size: 18 })),
        h('span', { class: 'set-num' }, String(index + 1)),
        h('div', { class: 'set-item-main' },
          h('a', { class: 'set-item-title', href: '#/set/' + encodeURIComponent(id) + '/play/' + index }, song.title),
          shapes ? h('span', { class: 'muted small' }, shapes) : null,
          h('div', { class: 'set-item-controls' }, controls)),
        h('div', { class: 'set-item-actions' },
          D.iconButton('up', 'Move up', function () { move(index, index - 1); }, { disabled: index === 0 }),
          D.iconButton('down', 'Move down', function () { move(index, index + 1); }, { disabled: index === set().items.length - 1 }),
          D.iconButton('close', 'Remove from set', function () { updateItems(function (items) { items.splice(index, 1); }); })));
      li.addEventListener('dragstart', function (e) {
        dragFrom = index;
        li.classList.add('dragging');
        try { e.dataTransfer.setData('text/plain', String(index)); e.dataTransfer.effectAllowed = 'move'; } catch (err) { /* ignore */ }
      });
      li.addEventListener('dragend', function () { li.classList.remove('dragging'); dragFrom = null; });
      li.addEventListener('dragover', function (e) { if (dragFrom !== null) { e.preventDefault(); li.classList.add('drag-over'); } });
      li.addEventListener('dragleave', function () { li.classList.remove('drag-over'); });
      li.addEventListener('drop', function (e) {
        e.preventDefault();
        li.classList.remove('drag-over');
        if (dragFrom !== null && dragFrom !== index) move(dragFrom, index);
        dragFrom = null;
      });
      return li;
    }

    function render() {
      var st = ctx.store.get();
      var s = set();
      if (!s) return;
      titleEl.textContent = s.name;
      D.clear(itemsEl);
      s.items.forEach(function (it, i) { var r = itemRow(it, i, st); if (r) itemsEl.appendChild(r); });
      emptyNote.hidden = s.items.length > 0;
      playBtn.hidden = s.items.length === 0;
      exportBtn.disabled = s.items.length === 0;
    }

    function sheets() {
      var st = ctx.store.get();
      return S.sheetModel.buildSetSheets(set(), function (sid) { return st.songs[sid]; }, st.settings);
    }

    var emptyNote = h('p', { class: 'muted empty-results' }, 'This set is empty. Search above to add songs.');
    var playBtn = h('a', { class: 'btn btn-primary', href: '#/set/' + encodeURIComponent(id) + '/play/0' }, D.icon('play'), h('span', null, 'Play'));
    var exportBtn = D.button('Export', function () {
      var st = ctx.store.get();
      var s = set();
      ctx.ui.menu(exportBtn, ctx.actions.exportMenuItems('set', sheets, {
        songs: s.items.map(function (it) { return st.songs[it.songId]; }).filter(Boolean),
        set: s,
        filenameBase: s.name
      }));
    }, { icon: 'download', title: 'Export the whole set as one document' });
    exportBtn.setAttribute('aria-haspopup', 'menu');

    var el = h('section', { class: 'view view-set' },
      h('div', { class: 'view-nav' }, h('a', { class: 'btn btn-ghost back-link', href: '#/sets' }, D.icon('back', { size: 18 }), 'Set lists')),
      h('div', { class: 'toolbar' }, h('div', { class: 'toolbar-row' },
        titleEl,
        D.iconButton('edit', 'Rename set', function () {
          ctx.ui.prompt({ title: 'Rename set list', label: 'Name', value: set().name, okLabel: 'Rename' }).then(function (name) {
            if (name) ctx.actions.updateSet(id, { name: name });
          });
        }),
        h('span', { class: 'spacer' }),
        playBtn,
        exportBtn,
        D.iconButton('trash', 'Delete set list', function () {
          ctx.ui.confirm({ title: 'Delete this set list?', message: 'The songs stay in your library.', okLabel: 'Delete', danger: true }).then(function (yes) {
            if (!yes) return;
            ctx.actions.deleteSet(id);
            ctx.router.navigate('/sets');
          });
        }, { class: 'btn-danger-icon' }))),
      h('div', { class: 'typeahead-wrap' }, h('div', { class: 'search-wrap' }, D.icon('search', { size: 18 }), addInput), results),
      emptyNote,
      itemsEl,
      h('p', { class: 'muted small' }, 'Key changes here apply only in this set. “Capo” shows the chord shapes to play with a capo, while the set still sounds in the chosen key.'));

    render();
    var unsub = ctx.store.subscribe(function (st, p) {
      if (!st.sets[id]) { ctx.router.navigate('/sets', { replace: true }); return; }
      if (p.sets || p.songs || p.settings) D.keepFocus(el, render);
    });
    return { el: el, title: set().name, destroy: unsub, focus: function () { if (!set().items.length) addInput.focus(); } };
  };

  // ---- play mode ------------------------------------------------------------------------------
  S.views.play = function (ctx, route) {
    var id = route.params.id;
    var index = parseInt(route.params.index, 10) || 0;
    function set() { return ctx.store.get().sets[id]; }
    function items() {
      var st = ctx.store.get();
      return (set() ? set().items : []).filter(function (it) { return !!st.songs[it.songId]; });
    }
    if (!set()) return S.views.notFound(ctx, 'That set list does not exist.');
    if (!items().length) return S.views.notFound(ctx, 'This set list has no songs yet.');
    index = Math.max(0, Math.min(items().length - 1, index));

    function item() { return items()[index]; }
    function realIndex() { return set().items.indexOf(item()); }
    function go(i) {
      var n = items().length;
      if (i < 0 || i >= n) return;
      ctx.router.navigate('/set/' + encodeURIComponent(id) + '/play/' + i);
    }

    var counter = h('span', { class: 'set-counter' }, (index + 1) + ' / ' + items().length);
    var prev = D.iconButton('back', 'Previous song ([)', function () { go(index - 1); }, { disabled: index === 0 });
    var next = D.iconButton('next', 'Next song (])', function () { go(index + 1); }, { disabled: index >= items().length - 1 });
    var exportBtn = D.iconButton('download', 'Export this song', function () {
      var st = ctx.store.get();
      ctx.ui.menu(exportBtn, ctx.actions.exportMenuItems('song', function () { return [view.getSheet()]; }, { songs: [st.songs[item().songId]], set: null, filenameBase: st.songs[item().songId].title }));
    });

    var view = S.sheetView.create(ctx, {
      getSong: function () { var it = item(); return it && ctx.store.get().songs[it.songId]; },
      getPrefs: function () {
        var it = item();
        var song = ctx.store.get().songs[it.songId];
        return {
          transpose: it.transpose === null ? song.transpose || 0 : it.transpose,
          accidentals: song.accidentals || null,
          tuneIndex: it.tuneIndex === null ? song.tuneIndex || 0 : it.tuneIndex,
          capoOverride: it.capo
        };
      },
      setPrefs: function (patch) {
        if ('accidentals' in patch) ctx.actions.updateSong(item().songId, { accidentals: patch.accidentals }, { touch: false });
        var itemPatch = {};
        if ('transpose' in patch) itemPatch.transpose = patch.transpose;
        if ('tuneIndex' in patch) itemPatch.tuneIndex = patch.tuneIndex;
        if (Object.keys(itemPatch).length) {
          var ri = realIndex();
          var list = set().items.map(function (it) { return Object.assign({}, it); });
          Object.assign(list[ri], itemPatch);
          ctx.actions.updateSet(id, { items: list }, { touch: false });
        }
      },
      extraControls: [exportBtn],
      setContext: { setId: id, setName: set().name, index: index, count: items().length }
    });

    var el = h('section', { class: 'view view-play' },
      h('div', { class: 'view-nav play-nav' },
        h('a', { class: 'btn btn-ghost back-link', href: '#/set/' + encodeURIComponent(id) }, D.icon('back', { size: 18 }), set().name),
        h('span', { class: 'spacer' }),
        prev, counter, next),
      view.el,
      h('div', { class: 'play-footer' },
        index > 0 ? h('a', { class: 'btn', href: '#/set/' + encodeURIComponent(id) + '/play/' + (index - 1) }, D.icon('back', { size: 18 }), ctx.store.get().songs[items()[index - 1].songId].title) : h('span'),
        index < items().length - 1 ? h('a', { class: 'btn', href: '#/set/' + encodeURIComponent(id) + '/play/' + (index + 1) }, ctx.store.get().songs[items()[index + 1].songId].title, D.icon('next', { size: 18 })) : h('span')));

    // swipe left/right on touch screens
    var touchX = null;
    el.addEventListener('touchstart', function (e) { touchX = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
    el.addEventListener('touchend', function (e) {
      if (touchX === null || !e.changedTouches.length) return;
      var dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      if (Math.abs(dx) > 80) go(index + (dx < 0 ? 1 : -1));
    });

    return {
      el: el,
      title: ctx.store.get().songs[item().songId].title + ' – ' + set().name,
      onKey: function (e) {
        if (view.onKey(e)) return true;
        if (D.isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return false;
        if (e.key === ']' || e.key === 'ArrowRight') { go(index + 1); return true; }
        if (e.key === '[' || e.key === 'ArrowLeft') { go(index - 1); return true; }
        if (e.key === 'Escape') { ctx.router.navigate('/set/' + encodeURIComponent(id)); return true; }
        return false;
      },
      destroy: function () { view.destroy(); }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
