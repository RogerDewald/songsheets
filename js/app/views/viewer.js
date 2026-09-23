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

    var favBtn = null;
    function favButton() {
      var fav = song() && song().favourite;
      return D.iconButton('star', fav ? 'Remove from favourites' : 'Add to favourites', function () { ctx.actions.toggleFavourite(id); },
        { filled: fav, pressed: fav, class: fav ? 'is-fav' : null });
    }
    favBtn = favButton();

    var exportBtn = D.button('Export', function () {
      ctx.ui.menu(exportBtn, ctx.actions.exportMenuItems('song', function () { return [view.getSheet()]; }, { songs: [song()], set: null, filenameBase: song().title }));
    }, { icon: 'download', title: 'Print, download or copy this song' });
    exportBtn.setAttribute('aria-haspopup', 'menu');

    var setBtn = D.iconButton('addList', 'Add to a set list', function () {
      ctx.ui.menu(setBtn, ctx.actions.addToSetMenuItems([id]));
    });
    setBtn.setAttribute('aria-haspopup', 'menu');

    var extras = [
      D.iconButton('copy', 'Copy lyrics (no chords)', function () {
        ctx.actions.copyText(S.sheetModel.toPlainLyrics(view.getSheet()), 'Lyrics copied');
      }),
      setBtn,
      exportBtn,
      D.button('Edit', function () { ctx.router.navigate('/edit/' + encodeURIComponent(id)); }, { icon: 'edit', title: 'Edit this song (E)' })
    ];
    var favSlot = h('span', { class: 'fav-slot' }, favBtn);
    extras.unshift(favSlot);

    var view = S.sheetView.create(ctx, {
      getSong: song,
      getPrefs: function () {
        var s = song() || {};
        return { transpose: s.transpose || 0, accidentals: s.accidentals || null, tuneIndex: s.tuneIndex || 0, capoOverride: null };
      },
      setPrefs: function (patch) { ctx.actions.updateSong(id, patch, { touch: false }); },
      extraControls: extras
    });

    var back = h('a', { class: 'btn btn-ghost back-link', href: '#/library' }, D.icon('back', { size: 18 }), 'Library');
    var el = h('section', { class: 'view view-song' }, h('div', { class: 'view-nav' }, back), view.el);

    var unsub = ctx.store.subscribe(function (st, patch) {
      if (!patch.songs) return;
      if (!st.songs[id]) { ctx.router.navigate('/library', { replace: true }); return; }
      var nb = favButton();
      D.replaceChildren(favSlot, nb);
    });

    return {
      el: el,
      title: song().title,
      onKey: function (e) {
        if (view.onKey(e)) return true;
        if (D.isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return false;
        if (e.key === 'e' || e.key === 'E') { ctx.router.navigate('/edit/' + encodeURIComponent(id)); return true; }
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
