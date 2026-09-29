/* Songsheets — Library view: search, sort, tags, favourites, add songs (write, convert with AI, import). */
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
      class: 'input search-input', type: 'search', placeholder: 'Search songs', value: query, title: 'Searches titles, lyrics, authors and tags',
      'aria-label': 'Search songs', autocomplete: 'off', spellcheck: 'false',
      on: { input: function () { query = search.value; renderList(); syncUrl(); updateClear(); } }
    });
    var clearBtn = h('button', {
      type: 'button', class: 'search-clear', 'aria-label': 'Clear search', hidden: !query,
      on: { click: function () { search.value = ''; query = ''; renderList(); syncUrl(); updateClear(); search.focus(); } }
    }, D.icon('close', { size: 16 }));
    function updateClear() { clearBtn.hidden = !search.value; }

    var sortSel = D.select([
      { value: 'title', label: 'Title A–Z' },
      { value: 'updated', label: 'Last edited' },
      { value: 'created', label: 'Newest first' }
    ], state.settings.librarySort, function (v) { ctx.actions.updateSettings({ librarySort: v }); }, { 'aria-label': 'Sort songs', class: 'select sort-select' });

    var fileInput = h('input', {
      type: 'file', multiple: true, class: 'visually-hidden', tabindex: '-1',
      accept: '.json,.txt,.cho,.chopro,.chordpro,.crd,.pro,.html,.htm,.song',
      on: { change: function () { if (fileInput.files.length) ctx.actions.importFiles(fileInput.files); fileInput.value = ''; } }
    });

    var tagsRow = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Filter by tag' });
    var list = h('ul', { class: 'song-list', role: 'list' });
    var countEl = h('span', { class: 'list-count-text', 'aria-live': 'polite' });
    var backupLink = h('button', { type: 'button', class: 'btn-link backup-link', title: 'Download a backup of all songs and sets', on: { click: function () { ctx.actions.exportBackup(); } } }, 'Back up');
    var countRow = h('div', { class: 'muted small list-count' }, countEl, backupLink);
    var body = h('div', { class: 'library-body' });
    var hintSlot = h('div');

    function examplesMissing() {
      var have = {};
      var songs = ctx.store.get().songs;
      Object.keys(songs).forEach(function (k) { have[S.search.normalizeForSearch(songs[k].title)] = true; });
      return (S.examples || []).some(function (ex) { return !have[S.search.normalizeForSearch(ex.title)]; });
    }

    /** Every way to get a song into the library, in one place (the + button on phones). */
    function addMenuItems() {
      var items = [
        { label: 'Write a new song', hint: 'Start from a blank page', icon: 'edit', onSelect: function () { ctx.router.navigate('/new'); } },
        { label: 'Convert a music sheet with AI', hint: 'A photo, PDF or text becomes a song', icon: 'sparkle', onSelect: function () { ctx.router.navigate('/convert'); } },
        { label: 'Import files', hint: 'Backup, ChordPro, text or songbase', icon: 'upload', onSelect: function () { fileInput.click(); } }
      ];
      if (examplesMissing()) items.push({ label: 'Add example songs', hint: 'A few songs to look around with', icon: 'library', onSelect: function () { ctx.actions.loadExamples(); } });
      return items;
    }

    function renderHint() {
      var hint = ctx.actions.installHint ? ctx.actions.installHint() : null;
      D.clear(hintSlot);
      if (!hint) return;
      var text = hint.platform === 'ios'
        ? ['Keep your songs safe: tap ', h('strong', null, 'Share'), ', then ', h('strong', null, 'Add to Home Screen'), ', and use Songsheets from there. ',
          'Safari can delete songs from websites you have not opened for a week; the home-screen app keeps them. ',
          'It has its own storage, so tap Back up here first and Import the file there.']
        : ['Install Songsheets as an app so it opens offline and the browser is less likely to clear your songs.' + (hint.canPrompt ? '' : ' Use the browser menu, then Add to Home screen or Install app.')];
      hintSlot.appendChild(h('div', { class: 'notice', role: 'note' },
        h('p', null, text),
        h('div', { class: 'notice-actions' },
          hint.canPrompt ? D.button('Install', function () { ctx.actions.install().then(renderHint); }, { primary: true, icon: 'download' }) : null,
          hint.platform === 'ios' ? D.button('Back up', function () { ctx.actions.exportBackup(); }, { icon: 'download' }) : null,
          D.button('Dismiss', function () { ctx.actions.dismissInstallHint(); }, { class: 'btn-ghost' }))));
    }

    var addFab = h('button', {
      type: 'button', class: 'fab no-print', 'aria-label': 'Add a song', 'aria-haspopup': 'menu',
      on: { click: function () { ctx.ui.menu(addFab, addMenuItems()); } }
    }, D.icon('plus', { size: 26 }));

    var el = h('section', { class: 'view view-library' },
      h('h1', { class: 'visually-hidden' }, 'Library'),
      h('div', { class: 'toolbar' },
        h('div', { class: 'toolbar-row library-search' },
          h('div', { class: 'search-wrap' }, D.icon('search', { size: 18 }), search, clearBtn),
          sortSel),
        h('div', { class: 'toolbar-row toolbar-actions' },
          D.button('New song', function () { ctx.router.navigate('/new'); }, { primary: true, icon: 'plus', title: 'New song (N)' }),
          D.button('Convert with AI', function () { ctx.router.navigate('/convert'); }, { icon: 'sparkle', class: 'btn-soft', title: 'Turn a photo, PDF or text of a song into a Songsheets song' }),
          D.button('Import', function () { fileInput.click(); }, { icon: 'upload', title: 'Import JSON backup, ChordPro, text or exported HTML files' }),
          h('span', { class: 'spacer' }),
          D.button('Back up', function () { ctx.actions.exportBackup(); }, { icon: 'download', class: 'btn-ghost', title: 'Download a backup of all songs and sets' }))),
      hintSlot,
      tagsRow,
      countRow,
      body,
      addFab,
      fileInput);

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
      return h('li', { class: 'song-row' },
        h('a', { class: 'song-link', href: '#/song/' + encodeURIComponent(song.id) },
          h('span', { class: 'song-title' }, song.title),
          song.author ? h('span', { class: 'song-meta' }, song.author) : null,
          song.tags && song.tags.length ? h('span', { class: 'song-tags' }, song.tags.map(function (t) { return h('span', { class: 'tag' }, t); })) : null),
        key ? h('span', { class: 'key-pill', title: 'Key ' + key }, key) : null,
        h('span', { class: 'song-date muted small', title: 'Last edited ' + new Date(song.updatedAt).toLocaleString() }, D.formatDay(song.updatedAt)),
        D.iconButton('star', song.favourite ? 'Remove from favourites' : 'Add to favourites', function () {
          ctx.actions.toggleFavourite(song.id);
        }, { filled: song.favourite, pressed: song.favourite, class: ['btn-ghost', 'fav-btn', song.favourite ? 'is-fav' : null].join(' ') }));
    }

    function startCard(icon, title, text, onClick) {
      return h('button', { type: 'button', class: 'start-card', on: { click: onClick } },
        h('span', { class: 'start-icon' }, D.icon(icon, { size: 22 })),
        h('span', { class: 'start-text' }, h('span', { class: 'start-title' }, title), h('span', { class: 'start-desc' }, text)));
    }

    function emptyState() {
      return h('div', { class: 'empty-state' },
        h('h2', null, 'Welcome to Songsheets'),
        h('p', { class: 'lead' }, 'Write chord sheets, move them to any key, gather them into set lists, and print or export them. Everything stays in this browser.'),
        h('div', { class: 'start-cards' },
          startCard('edit', 'Write a new song', 'Type it in, with chords in [square brackets]', function () { ctx.router.navigate('/new'); }),
          startCard('sparkle', 'Convert a music sheet', 'Let an AI assistant turn a photo, PDF or text into a song', function () { ctx.router.navigate('/convert'); }),
          startCard('upload', 'Import files', 'Backups, ChordPro, text and songbase files', function () { fileInput.click(); })),
        h('button', { type: 'button', class: 'btn-link examples-link', on: { click: function () { ctx.actions.loadExamples(); } } }, 'Add three example songs to look around first'),
        h('p', { class: 'muted small drop-hint' }, 'You can also drop files anywhere on this page.'));
    }

    function clearFilters() {
      query = ''; search.value = ''; activeTags = []; favOnly = false;
      updateClear(); renderAll(); syncUrl();
    }

    function renderList() {
      var st = ctx.store.get();
      var songs = Object.keys(st.songs).map(function (k) { return st.songs[k]; });
      D.clear(body);
      el.classList.toggle('is-empty', !songs.length);
      if (!songs.length) { body.appendChild(emptyState()); countEl.textContent = ''; return; }
      var filtered = songs.filter(function (s) {
        if (favOnly && !s.favourite) return false;
        return activeTags.every(function (t) { return (s.tags || []).indexOf(t) >= 0; });
      });
      var results = sorted(S.search.searchSongs(filtered, query), st.settings.librarySort);
      D.clear(list);
      results.slice(0, 500).forEach(function (r) { list.appendChild(row(r.song)); });
      if (results.length) body.appendChild(list);
      else {
        body.appendChild(h('div', { class: 'empty-results' },
          h('p', null, query.trim() ? 'No songs match “' + query.trim() + '”.' : 'No songs match these filters.'),
          D.button('Clear search and filters', clearFilters, { class: 'btn-small' })));
      }
      countEl.textContent = results.length === songs.length
        ? songs.length + ' song' + (songs.length === 1 ? '' : 's')
        : results.length + ' of ' + songs.length + ' songs';
    }

    function renderAll() {
      renderHint();
      var st = ctx.store.get();
      renderTags(Object.keys(st.songs).map(function (k) { return st.songs[k]; }));
      renderList();
    }

    renderAll();
    var unsub = ctx.store.subscribe(function (st, patch) {
      if (patch.songs || patch.settings || patch.installable !== undefined) renderAll();
    });

    return {
      el: el,
      title: 'Library',
      onKey: function (e) {
        if (e.key === '/' && !D.isTyping(e)) { e.preventDefault(); search.focus(); search.select(); return true; }
        if (e.key === 'Escape' && e.target === search && search.value) { search.value = ''; query = ''; renderList(); syncUrl(); updateClear(); return true; }
        return false;
      },
      destroy: function () { unsub(); }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
