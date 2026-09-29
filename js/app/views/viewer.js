/* Songsheets — Song viewer (#/song/:id). */
(function (root) {
  'use strict';
  var S = root.SongSheets;
  var D = S.dom;
  var h = D.h;

  S.views = S.views || {};
  S.views.song = function (ctx, route) {
    var id = route.params.id;
    var song = function () { return ctx.store.get().songs[id]; };
    if (!song()) return S.views.notFound(ctx, 'That song is not in your library.');

    function toggleFav() { ctx.actions.toggleFavourite(id); }
    function edit() { ctx.router.navigate('/edit/' + encodeURIComponent(id)); }
    function copyLyrics() { ctx.actions.copyText(S.sheetModel.toPlainLyrics(view.getSheet()), 'Lyrics copied (no chords)'); }
    function exportItems() {
      return ctx.actions.exportMenuItems('song', function () { return [view.getSheet()]; }, { songs: [song()], set: null, filenameBase: song().title });
    }

    /** A labelled action button; the label is hidden on the narrowest screens by CSS. */
    function action(icon, label, onClick, title) {
      return h('button', { type: 'button', class: 'btn', title: title || label, on: { click: onClick } },
        D.icon(icon, { size: 18 }), h('span', { class: 'btn-label' }, label));
    }

    function favButton() {
      var fav = !!(song() && song().favourite);
      return h('button', {
        type: 'button', class: ['btn', fav ? 'is-fav' : null], 'aria-pressed': String(fav),
        title: fav ? 'Remove from favourites' : 'Add to favourites', on: { click: toggleFav }
      }, D.icon('star', { size: 18, filled: fav }), h('span', { class: 'btn-label' }, 'Favourite'));
    }
    var favSlot = h('span', { class: 'fav-slot' }, favButton());

    var addToSetBtn = action('addList', 'Add to set', function () { ctx.ui.menu(addToSetBtn, ctx.actions.addToSetMenuItems([id])); }, 'Add to a set list');
    addToSetBtn.setAttribute('aria-haspopup', 'menu');
    var exportBtn = action('download', 'Export', function () { ctx.ui.menu(exportBtn, exportItems()); }, 'Print, download or copy this song');
    exportBtn.setAttribute('aria-haspopup', 'menu');
    var editBtn = h('button', { type: 'button', class: 'btn btn-primary', title: 'Edit this song (E)', on: { click: edit } },
      D.icon('edit', { size: 18 }), h('span', null, 'Edit'));

    // phones: Edit stays in reach; everything else sits behind one menu
    var moreBtn = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'More actions', 'aria-haspopup': 'menu', title: 'More actions' }, D.icon('more'));
    moreBtn.addEventListener('click', function () {
      var fav = !!(song() && song().favourite);
      ctx.ui.menu(moreBtn, [
        { label: fav ? 'Remove from favourites' : 'Add to favourites', icon: 'star', onSelect: toggleFav },
        { label: 'Add to a set list', icon: 'addList', onSelect: function () { ctx.ui.menu(moreBtn, ctx.actions.addToSetMenuItems([id])); } },
        { label: 'Copy lyrics', hint: 'Words only, no chords', icon: 'copy', onSelect: copyLyrics },
        { label: 'Export or print…', icon: 'download', onSelect: function () { ctx.ui.menu(moreBtn, exportItems()); } }
      ]);
    });
    var editBtnPhone = h('button', { type: 'button', class: 'btn btn-primary', title: 'Edit this song', on: { click: edit } }, D.icon('edit', { size: 18 }), h('span', null, 'Edit'));

    var view = S.sheetView.create(ctx, {
      getSong: song,
      getPrefs: function () {
        var s = song() || {};
        return { transpose: s.transpose || 0, accidentals: s.accidentals || null, tuneIndex: s.tuneIndex || 0, capoOverride: null };
      },
      setPrefs: function (patch) { ctx.actions.updateSong(id, patch, { touch: false }); }
    });

    var back = h('a', { class: 'btn btn-ghost back-link', href: '#/library' }, D.icon('back', { size: 18 }), 'Library');
    var el = h('section', { class: 'view view-song' },
      h('div', { class: 'view-nav song-nav' },
        back,
        h('span', { class: 'spacer' }),
        h('div', { class: 'song-actions' }, favSlot, addToSetBtn, action('copy', 'Copy lyrics', copyLyrics, 'Copy the words without chords'), exportBtn, editBtn),
        h('div', { class: 'song-actions-phone' }, editBtnPhone, moreBtn)),
      view.el);

    var unsub = ctx.store.subscribe(function (st, patch) {
      if (!patch.songs) return;
      if (!st.songs[id]) { ctx.router.navigate('/library', { replace: true }); return; }
      D.replaceChildren(favSlot, favButton());
    });

    return {
      el: el,
      title: song().title,
      onKey: function (e) {
        if (view.onKey(e)) return true;
        if (D.isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return false;
        if (e.key === 'e' || e.key === 'E') { edit(); return true; }
        if (e.key === 'Escape') { ctx.router.navigate('/library'); return true; }
        return false;
      },
      destroy: function () { unsub(); view.destroy(); }
    };
  };

  S.views.notFound = function (ctx, message) {
    return {
      el: h('section', { class: 'view view-empty' },
        h('div', { class: 'empty-state' },
          h('h2', null, 'Not found'),
          h('p', null, message || 'This page does not exist.'),
          h('a', { class: 'btn btn-primary', href: '#/library' }, 'Go to the library'))),
      title: 'Not found',
      destroy: function () {}
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
