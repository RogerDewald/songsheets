/* Songsheets — Library view: search, sort, tags, favourites, import, new song. */
(function (root) {
  'use strict';
  var S = root.SongSheets;
  var D = S.dom;
  var h = D.h;

  function keyOf(song) {
    try {
      var sheet = S.sheetModel.buildSheet(song, { showChords: true });
      return sheet.key ? sheet.targetKeyLabel : null;
    } catch (e) { return null; }
  }

  S.views = S.views || {};
  S.views.library = function (ctx, route) {
    var state = ctx.store.get();
    var query = route.query.q || '';
    var activeTags = route.query.tags ? route.query.tags.split(',').filter(Boolean) : [];
    var favOnly = route.query.fav === '1';
    var keyCache = new Map();

    var search = h('input', {
      class: 'input search-input', type: 'search', placeholder: 'Search titles, lyrics, authors, tags', value: query,
      'aria-label': 'Search songs', autocomplete: 'off', spellcheck: 'false',
      on: { input: function () { query = search.value; renderList(); syncUrl(); } }
    });
    var sortSel = D.select([
      { value: 'title', label: 'Title A–Z' },
      { value: 'updated', label: 'Recently edited' },
      { value: 'created', label: 'Recently added' }
    ], state.settings.librarySort, function (v) { ctx.actions.updateSettings({ librarySort: v }); }, { 'aria-label': 'Sort songs' });

    var fileInput = h('input', {
      type: 'file', multiple: true, class: 'visually-hidden', tabindex: '-1',
      accept: '.json,.txt,.cho,.chopro,.chordpro,.crd,.pro,.html,.htm,.song',
      on: { change: function () { if (fileInput.files.length) ctx.actions.importFiles(fileInput.files); fileInput.value = ''; } }
    });

    var tagsRow = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Filter by tag' });
    var list = h('ul', { class: 'song-list', role: 'list' });
    var countEl = h('p', { class: 'muted small list-count', 'aria-live': 'polite' });
    var body = h('div', { class: 'library-body' });

    var el = h('section', { class: 'view view-library' },
      h('div', { class: 'toolbar' },
        h('div', { class: 'toolbar-row' },
          h('div', { class: 'search-wrap' }, D.icon('search', { size: 18 }), search),
          sortSel),
        h('div', { class: 'toolbar-row toolbar-actions' },
          D.button('New song', function () { ctx.router.navigate('/new'); }, { primary: true, icon: 'plus', title: 'New song (N)' }),
          D.button('Import', function () { fileInput.click(); }, { icon: 'upload', title: 'Import JSON backup, ChordPro, text or exported HTML files' }),
          D.button('Back up', function () { ctx.actions.exportBackup(); }, { icon: 'download', title: 'Download a backup of all songs and sets' }),
          fileInput)),
      tagsRow,
      countEl,
      body);

    function syncUrl() {
      var hash = S.router.buildHash('/library', { q: query || null, tags: activeTags.join(',') || null, fav: favOnly ? '1' : null });
      if (root.location.hash !== hash) root.history.replaceState(null, '', hash);
    }

    function allTags(songs) {
      var counts = {};
      songs.forEach(function (s) { (s.tags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
      return Object.keys(counts).sort(function (a, b) { return a.localeCompare(b); }).map(function (t) { return { tag: t, count: counts[t] }; });
    }

    function renderTags(songs) {
      var tags = allTags(songs);
      D.clear(tagsRow);
      if (!songs.length) return;
      tagsRow.appendChild(h('button', {
        type: 'button', class: ['chip', favOnly ? 'chip-on' : null], 'aria-pressed': String(favOnly),
        on: { click: function () { favOnly = !favOnly; renderAll(); syncUrl(); } }
      }, D.icon('star', { size: 14, filled: favOnly }), 'Favourites'));
      tags.forEach(function (t) {
        var on = activeTags.indexOf(t.tag) >= 0;
        tagsRow.appendChild(h('button', {
          type: 'button', class: ['chip', on ? 'chip-on' : null], 'aria-pressed': String(on),
          on: {
            click: function () {
              activeTags = on ? activeTags.filter(function (x) { return x !== t.tag; }) : activeTags.concat([t.tag]);
              renderAll(); syncUrl();
            }
          }
        }, t.tag, h('span', { class: 'chip-count' }, String(t.count))));
      });
    }

    function sorted(results, sort) {
      if (query.trim()) return results;           // search ranking wins while searching
      var arr = results.slice();
      if (sort === 'updated') arr.sort(function (a, b) { return String(b.song.updatedAt).localeCompare(String(a.song.updatedAt)); });
      if (sort === 'created') arr.sort(function (a, b) { return String(b.song.createdAt).localeCompare(String(a.song.createdAt)); });
      return arr;
    }

    function songKey(song) {
      var stamp = song.updatedAt + '|' + song.transpose + '|' + song.tuneIndex + '|' + song.accidentals;
      var c = keyCache.get(song.id);
      if (!c || c.stamp !== stamp) { c = { stamp: stamp, key: keyOf(song) }; keyCache.set(song.id, c); }
      return c.key;
    }

    function row(song) {
      var key = songKey(song);
      var meta = [song.author, key ? 'Key ' + key : null].filter(Boolean).join(' · ');
      return h('li', { class: 'song-row' },
        h('a', { class: 'song-link', href: '#/song/' + encodeURIComponent(song.id) },
          h('span', { class: 'song-title' }, song.title),
          meta ? h('span', { class: 'song-meta' }, meta) : null,
          song.tags && song.tags.length ? h('span', { class: 'song-tags' }, song.tags.map(function (t) { return h('span', { class: 'tag' }, t); })) : null),
        h('span', { class: 'song-date muted small', title: 'Last edited ' + new Date(song.updatedAt).toLocaleString() }, D.formatDate(song.updatedAt)),
        D.iconButton('star', song.favourite ? 'Remove from favourites' : 'Add to favourites', function () {
          ctx.actions.toggleFavourite(song.id);
        }, { filled: song.favourite, pressed: song.favourite, class: ['fav-btn', song.favourite ? 'is-fav' : null].join(' ') }));
    }

    function emptyState() {
      return h('div', { class: 'empty-state' },
        h('h2', null, 'Your song book is empty'),
        h('p', null, 'Write your own chord sheets with chords in [square brackets], transpose them to any key, and export them as PDF, Word, ChordPro, text or HTML. Everything stays in this browser.'),
        h('div', { class: 'empty-actions' },
          D.button('Load example songs', function () { ctx.actions.loadExamples(); }, { primary: true, icon: 'library' }),
          D.button('Write a new song', function () { ctx.router.navigate('/new'); }, { icon: 'plus' }),
          D.button('Import files', function () { fileInput.click(); }, { icon: 'upload' })),
        h('p', { class: 'muted small' }, 'You can also drop .json, .cho, .txt or exported .html files anywhere on this page.'));
    }

    function renderList() {
      var st = ctx.store.get();
      var songs = Object.keys(st.songs).map(function (k) { return st.songs[k]; });
      D.clear(body);
      if (!songs.length) { body.appendChild(emptyState()); countEl.textContent = ''; return; }
      var filtered = songs.filter(function (s) {
        if (favOnly && !s.favourite) return false;
        return activeTags.every(function (t) { return (s.tags || []).indexOf(t) >= 0; });
      });
      var results = sorted(S.search.searchSongs(filtered, query), st.settings.librarySort);
      D.clear(list);
      results.slice(0, 500).forEach(function (r) { list.appendChild(row(r.song)); });
      body.appendChild(list);
      if (!results.length) body.appendChild(h('p', { class: 'muted empty-results' }, 'No songs match.'));
      countEl.textContent = results.length === songs.length
        ? songs.length + ' song' + (songs.length === 1 ? '' : 's')
        : results.length + ' of ' + songs.length + ' songs';
    }

    function renderAll() {
      var st = ctx.store.get();
      renderTags(Object.keys(st.songs).map(function (k) { return st.songs[k]; }));
      renderList();
    }

    renderAll();
    var unsub = ctx.store.subscribe(function (st, patch) {
      if (patch.songs || patch.settings) renderAll();
    });

    return {
      el: el,
      title: 'Library',
      focus: function () { if (!('ontouchstart' in root)) search.focus(); },
      onKey: function (e) {
        if (e.key === '/' && !D.isTyping(e)) { e.preventDefault(); search.focus(); search.select(); return true; }
        if (e.key === 'Escape' && e.target === search && search.value) { search.value = ''; query = ''; renderList(); syncUrl(); return true; }
        return false;
      },
      destroy: function () { unsub(); }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
