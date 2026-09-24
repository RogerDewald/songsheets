/* Songsheets — application bootstrap: state, persistence, actions, routing, shortcuts, offline. */
(function (root) {
  'use strict';
  var S = root.SongSheets;
  var D = S.dom;
  var h = D.h;
  var ui = S.ui;
  var doc = root.document;
  var APP_VERSION = '1.1.0';

  // ---- state and persistence ------------------------------------------------------------------
  var ls = S.storage.getLocalStorage();
  var loaded = S.storage.load(ls);
  var dataLocked = !!loaded.raw;           // unreadable saved data: never overwrite it silently
  var store = S.store.createStore({
    songs: loaded.songs,
    sets: loaded.sets,
    settings: loaded.settings,
    storageError: null
  });

  var saveTimer = null;
  var savePending = false;
  // What this tab last read from or wrote to storage. Another tab (or another copy of the app on
  // file://, which shares the key) may write in between; its changes are merged, never overwritten.
  var lastRaw = readRaw();
  var lastBase = { songs: loaded.songs, sets: loaded.sets };

  function readRaw() {
    if (!ls) return null;
    try { return ls.getItem(S.storage.DATA_KEY); } catch (e) { return null; }
  }

  /** Merge a newer stored copy into this tab's state. Returns true if the state changed. */
  function syncFromStorage(raw) {
    if (dataLocked || raw === lastRaw) return false;
    var remote;
    try { remote = raw ? S.storage.migrate(JSON.parse(raw)) : { songs: {}, sets: {} }; } catch (e) { return false; }
    var st = store.get();
    var merged = S.storage.rebaseData(lastBase, { songs: st.songs, sets: st.sets }, remote);
    lastRaw = raw;
    lastBase = { songs: remote.songs, sets: remote.sets };
    var changed = JSON.stringify(merged.songs) !== JSON.stringify(st.songs) || JSON.stringify(merged.sets) !== JSON.stringify(st.sets);
    if (changed) { syncing = true; store.set({ songs: merged.songs, sets: merged.sets }); syncing = false; }
    return changed;
  }
  var syncing = false;
  var lockWarned = false;
  var quotaToastClose = null;

  function flushSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!savePending) return;
    savePending = false;
    if (dataLocked) {
      if (!lockWarned) {
        lockWarned = true;
        ui.toast('Changes are not being saved, because the library already stored in this browser could not be read. Open Settings to download it, or delete everything to start fresh.', { type: 'error', sticky: true, actionLabel: 'Settings', onAction: function () { router.navigate('/settings'); } });
      }
      return;
    }
    syncFromStorage(readRaw());
    var st = store.get();
    var err = S.storage.saveData(ls, st.songs, st.sets);
    if (!err) {
      lastRaw = readRaw();
      lastBase = { songs: st.songs, sets: st.sets };
    }
    if (err) {
      store.set({ storageError: err });
      if (!quotaToastClose) {
        quotaToastClose = ui.toast(err.quota
          ? 'Browser storage is full, so your latest changes are not saved. Download a backup, then delete some songs.'
          : 'Could not save: ' + err.message, {
          type: 'error', sticky: true, actionLabel: 'Download backup',
          onAction: function () { quotaToastClose = null; actions.exportBackup(); }
        });
      }
    } else if (store.get().storageError) {
      store.set({ storageError: null });
      if (quotaToastClose) { quotaToastClose(); quotaToastClose = null; }
    }
  }

  function scheduleSave() {
    savePending = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 250);
  }
  var saveNow = flushSave;

  root.addEventListener('storage', function (e) {
    if (e.storageArea && e.storageArea !== ls) return;
    if (e.key === S.storage.DATA_KEY) {
      if (syncFromStorage(e.newValue) && savePending) scheduleSave();
    } else if (e.key === S.storage.SETTINGS_KEY && e.newValue) {
      try {
        var next = S.storage.normalizeSettings(JSON.parse(e.newValue));
        store.set({ settings: next });
        applyTheme(next.theme);
      } catch (err) { /* ignore */ }
    }
  });

  root.addEventListener('pagehide', saveNow);
  root.addEventListener('beforeunload', saveNow);
  doc.addEventListener('visibilitychange', function () { if (doc.visibilityState === 'hidden') saveNow(); });

  function applyTheme(theme) {
    var el = doc.documentElement;
    if (theme === 'light' || theme === 'night') el.setAttribute('data-theme', theme);
    else el.removeAttribute('data-theme');
    var meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'night' ? '#000000' : '#1f45ff');
  }

  // ---- storage protection and installing ------------------------------------------------------
  var persistState = { supported: !!(navigator.storage && navigator.storage.persist), persisted: false };
  function checkPersisted() {
    if (!persistState.supported || !navigator.storage.persisted) return Promise.resolve(false);
    return navigator.storage.persisted().then(function (p) { persistState.persisted = p; return p; }, function () { return false; });
  }
  /** Ask the browser not to clear our storage under pressure. Chrome decides silently (installed apps
   *  and often-used sites get it); Firefox may ask. Only asked once there are songs worth keeping. */
  function requestPersist() {
    if (!persistState.supported || persistState.persisted || persistState.asked) return;
    persistState.asked = true;
    navigator.storage.persist().then(function (ok) { persistState.persisted = ok; }, function () {});
  }

  var ua = navigator.userAgent || '';
  var platform = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'ios'
    : /Android/.test(ua) ? 'android' : 'desktop';
  function isStandalone() {
    return navigator.standalone === true || (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches);
  }
  var deferredInstall = null;
  root.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; store.set({ installable: true }); });
  root.addEventListener('appinstalled', function () { deferredInstall = null; store.set({ installable: false }); });

  // ---- helpers --------------------------------------------------------------------------------
  function now() { return S.ids.nowIso(); }

  function dateStamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function plainDownload(text, filename, mime) {
    if (S.export && S.export.download && S.export.download.download) {
      S.export.download.download(text, filename, mime);
      return;
    }
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: filename, style: 'display:none' });
    doc.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  function copyText(text, message) {
    function fallback() {
      var ta = h('textarea', { style: 'position:fixed;top:-1000px;opacity:0' });
      ta.value = text;
      doc.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    }
    var p = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); })
      : Promise.resolve(fallback());
    return p.then(function (ok) {
      ui.toast(ok ? (message || 'Copied') : 'Could not copy to the clipboard', { type: ok ? 'ok' : 'error', duration: 2500 });
      return ok;
    });
  }

  var EXPORT_ICONS = { print: 'print', pdf: 'file', docx: 'file', txt: 'text', cho: 'music', songbase: 'text', html: 'file', json: 'download' };

  // ---- actions --------------------------------------------------------------------------------
  var actions = {
    createSong: function (fields) {
      var rec = S.storage.normalizeSong(Object.assign({}, fields, { createdAt: now(), updatedAt: now() }));
      var songs = Object.assign({}, store.get().songs);
      songs[rec.id] = rec;
      store.set({ songs: songs });
      scheduleSave();
      requestPersist();
      return rec.id;
    },

    /** opts.touch false: a viewing preference (transpose, tune, favourite) that should not count as an edit. */
    updateSong: function (id, patch, opts) {
      var st = store.get();
      var old = st.songs[id];
      if (!old) return;
      var next = Object.assign({}, old, patch);
      if ('lyrics' in patch) next.lyrics = String(patch.lyrics).replace(/\r\n|\r/g, '\n');
      if (!opts || opts.touch !== false) next.updatedAt = now();
      var songs = Object.assign({}, st.songs);
      songs[id] = next;
      store.set({ songs: songs });
      scheduleSave();
    },

    deleteSong: function (id) {
      var st = store.get();
      var songs = Object.assign({}, st.songs);
      delete songs[id];
      var sets = {};
      Object.keys(st.sets).forEach(function (k) {
        var s = st.sets[k];
        var items = s.items.filter(function (it) { return it.songId !== id; });
        sets[k] = items.length === s.items.length ? s : Object.assign({}, s, { items: items, updatedAt: now() });
      });
      store.set({ songs: songs, sets: sets });
      scheduleSave();
    },

    toggleFavourite: function (id) {
      var s = store.get().songs[id];
      if (s) actions.updateSong(id, { favourite: !s.favourite }, { touch: false });
    },

    createSet: function (name, songIds) {
      var rec = S.storage.normalizeSet({
        name: name,
        items: (songIds || []).map(function (sid) { return { songId: sid }; }),
        createdAt: now(), updatedAt: now()
      });
      var sets = Object.assign({}, store.get().sets);
      sets[rec.id] = rec;
      store.set({ sets: sets });
      scheduleSave();
      return rec.id;
    },

    updateSet: function (id, patch, opts) {
      var st = store.get();
      if (!st.sets[id]) return;
      var next = Object.assign({}, st.sets[id], patch);
      if (!opts || opts.touch !== false) next.updatedAt = now();
      var sets = Object.assign({}, st.sets);
      sets[id] = next;
      store.set({ sets: sets });
      scheduleSave();
    },

    deleteSet: function (id) {
      var sets = Object.assign({}, store.get().sets);
      delete sets[id];
      store.set({ sets: sets });
      scheduleSave();
    },

    addToSet: function (setId, songIds) {
      var s = store.get().sets[setId];
      if (!s) return;
      var items = s.items.concat(songIds.map(function (sid) { return { songId: sid, transpose: null, capo: null, tuneIndex: null }; }));
      actions.updateSet(setId, { items: items });
      ui.toast('Added to “' + s.name + '”', { type: 'ok', actionLabel: 'Open set', onAction: function () { router.navigate('/set/' + encodeURIComponent(setId)); } });
    },

    addToSetMenuItems: function (songIds) {
      var st = store.get();
      var sets = Object.keys(st.sets).map(function (k) { return st.sets[k]; })
        .sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
      var items = sets.slice(0, 12).map(function (s) {
        return { label: s.name, hint: s.items.length + ' song' + (s.items.length === 1 ? '' : 's'), icon: 'list', onSelect: function () { actions.addToSet(s.id, songIds); } };
      });
      if (items.length) items.push({ separator: true });
      items.push({
        label: 'New set list…', icon: 'plus', onSelect: function () {
          ui.prompt({ title: 'New set list', label: 'Name', value: 'Set ' + new Date().toLocaleDateString(), okLabel: 'Create' }).then(function (name) {
            if (!name) return;
            var id = actions.createSet(name, songIds);
            ui.toast('Created “' + name + '”', { type: 'ok', actionLabel: 'Open set', onAction: function () { router.navigate('/set/' + encodeURIComponent(id)); } });
          });
        }
      });
      return items;
    },

    updateSettings: function (patch) {
      var settings = S.storage.normalizeSettings(Object.assign({}, store.get().settings, patch));
      store.set({ settings: settings });
      S.storage.saveSettings(ls, settings);
      if ('theme' in patch) applyTheme(settings.theme);
    },

    loadExamples: function () {
      var st = store.get();
      var have = {};
      Object.keys(st.songs).forEach(function (k) { have[S.search.normalizeForSearch(st.songs[k].title)] = true; });
      var first = null;
      var count = 0;
      (S.examples || []).forEach(function (ex) {
        if (have[S.search.normalizeForSearch(ex.title)]) return;
        var id = actions.createSong(ex);
        count++;
        if (!first) first = id;
      });
      ui.toast(count ? count + ' example song' + (count === 1 ? '' : 's') + ' added' : 'The example songs are already in your library', { type: 'ok' });
      return first;
    },

    openFormatExample: function () {
      var st = store.get();
      var guide = S.examples && S.examples[0];
      if (!guide) return;
      var t = S.search.normalizeForSearch(guide.title);
      var found = Object.keys(st.songs).filter(function (k) { return S.search.normalizeForSearch(st.songs[k].title) === t; })[0];
      var id = found || actions.createSong(guide);
      router.navigate('/edit/' + encodeURIComponent(id));
    },

    exportBackup: function () {
      var st = store.get();
      var text;
      if (S.export && S.export.backup && S.export.backup.exportJsonBackup) {
        text = S.export.backup.exportJsonBackup({ songs: st.songs, sets: st.sets, settings: st.settings });
      } else {
        text = JSON.stringify({
          format: 'songsheets-backup', version: 1, exportedAt: now(), app: 'songsheets/' + APP_VERSION,
          songs: Object.keys(st.songs).map(function (k) { return st.songs[k]; }),
          sets: Object.keys(st.sets).map(function (k) { return st.sets[k]; }),
          settings: st.settings
        }, null, 2);
      }
      plainDownload(text, 'songsheets-backup-' + dateStamp() + '.json', 'application/json;charset=utf-8');
      actions.updateSettings({ lastBackupAt: now() });
      ui.toast('Backup downloaded', { type: 'ok' });
    },

    downloadRaw: function () {
      if (loaded.raw) plainDownload(loaded.raw, 'songsheets-unreadable-data-' + dateStamp() + '.json', 'application/json;charset=utf-8');
    },

    /** opts: {askReplace, includeSettings} */
    importFiles: function (files, opts) {
      opts = opts || {};
      var B = S.export && S.export.backup;
      if (!B || !B.importFiles) { ui.toast('Import is not available: the export modules did not load.', { type: 'error' }); return Promise.resolve(); }
      return B.importFiles(files).then(function (res) {
        res = res || { songs: [], sets: [], warnings: [] };
        var warnings = (res.warnings || []).slice(0, 3).join(' ');
        if (!(res.songs && res.songs.length) && !(res.sets && res.sets.length)) {
          ui.toast('Nothing to import.' + (warnings ? ' ' + warnings : ''), { type: 'error' });
          return;
        }
        var ask = opts.askReplace
          ? ui.choice({
            title: 'Restore',
            message: 'The file has ' + res.songs.length + ' song' + (res.songs.length === 1 ? '' : 's') + ' and ' + (res.sets || []).length + ' set list' + ((res.sets || []).length === 1 ? '' : 's') + '. Merge them into your library (newer copies win), or replace your whole library with them?',
            choices: [{ label: 'Replace everything', value: 'replace', danger: true }, { label: 'Merge', value: 'merge', primary: true }]
          })
          : Promise.resolve('merge');
        return ask.then(function (mode) {
          if (!mode) return;
          var st = store.get();
          var before = { songs: st.songs, sets: st.sets };
          var merged = S.storage.mergeData(st, res, { mode: mode });
          store.set({ songs: merged.songs, sets: merged.sets });
          requestPersist();
          if (opts.includeSettings && res.settings) {
            var keep = { lastBackupAt: store.get().settings.lastBackupAt, backupReminderAt: store.get().settings.backupReminderAt, installHintDismissed: store.get().settings.installHintDismissed };
            actions.updateSettings(Object.assign({}, res.settings, keep));
          }
          scheduleSave();
          var msg = S.storage.describeStats(merged.stats) + (warnings ? ' ' + warnings : '');
          var undo = function () { store.set(before); scheduleSave(); ui.toast('Import undone', { type: 'ok' }); };
          ui.toast(msg, { type: 'ok', duration: 8000, actionLabel: 'Undo', onAction: undo });
          if (res.songs.length === 1 && merged.stats.added === 1 && !opts.askReplace) {
            router.navigate('/song/' + encodeURIComponent(res.songs[0].id));
          }
        });
      }).catch(function (e) {
        ui.toast('Import failed: ' + (e && e.message || e), { type: 'error' });
      });
    },

    copyText: copyText,

    storageInfo: function () {
      return { supported: persistState.supported, persisted: persistState.persisted, platform: platform, standalone: isStandalone() };
    },

    /** What the library's "keep your songs safe" hint should say, or null. */
    installHint: function () {
      var st = store.get();
      if (st.settings.installHintDismissed || isStandalone() || !/^https?:$/.test(root.location.protocol)) return null;
      if (!Object.keys(st.songs).length) return null;
      if (platform === 'ios') return { platform: 'ios', canPrompt: false };
      if (platform === 'android') return { platform: 'android', canPrompt: !!deferredInstall };
      return deferredInstall ? { platform: 'desktop', canPrompt: true } : null;
    },

    install: function () {
      if (!deferredInstall) return Promise.resolve(false);
      var p = deferredInstall;
      deferredInstall = null;
      p.prompt();
      return p.userChoice.then(function (c) { store.set({ installable: false }); return c && c.outcome === 'accepted'; }, function () { return false; });
    },

    dismissInstallHint: function () { actions.updateSettings({ installHintDismissed: true }); },

    /** Write pending changes now. Returns {ok, message}. */
    flush: function () {
      if (saveTimer || savePending) { savePending = true; flushSave(); }
      if (dataLocked) return { ok: false, message: 'not saved: the stored library could not be read' };
      var err = store.get().storageError;
      return err ? { ok: false, message: err.quota ? 'not saved: storage is full' : 'not saved: ' + err.message } : { ok: true, message: '' };
    },

    runExport: function (kind, getSheets, extra, action) {
      var E = S.export && S.export.exportMenu;
      if (!E) { ui.toast('Exports are not available: the export modules did not load.', { type: 'error' }); return Promise.resolve(); }
      var sheets;
      try { sheets = getSheets(); } catch (e) { ui.toast('Could not prepare the export: ' + e.message, { type: 'error' }); return Promise.resolve(); }
      if (!sheets || !sheets.length) { ui.toast('Nothing to export.', { type: 'error' }); return Promise.resolve(); }
      var busy = kind === 'pdf' || kind === 'docx' ? ui.toast('Preparing…', { sticky: true }) : null;
      return Promise.resolve().then(function () {
        return E.run(kind, sheets, {
          settings: store.get().settings,
          songs: extra.songs || [],
          set: extra.set || null,
          filenameBase: extra.filenameBase || (sheets[0] && sheets[0].title) || 'song',
          action: action || 'download',
          toast: ui.toast
        });
      }).then(function (r) {
        if (busy) busy();
        if (r && r.message) ui.toast(r.message, { type: r.ok ? 'ok' : 'error' });
      }, function (e) {
        if (busy) busy();
        ui.toast('Export failed: ' + (e && e.message || e), { type: 'error' });
      });
    },

    exportMenuItems: function (scope, getSheets, extra) {
      var E = S.export && S.export.exportMenu;
      if (!E) return [{ label: 'Exports did not load', disabled: true, onSelect: function () {} }];
      var list = E.list(scope);
      var items = list.map(function (x) {
        return { label: x.label, hint: x.hint, icon: EXPORT_ICONS[x.id] || 'download', onSelect: function () { actions.runExport(x.id, getSheets, extra, 'download'); } };
      });
      var copyable = list.filter(function (x) { return (x.id === 'txt' || x.id === 'cho' || x.id === 'songbase') && E.canCopy(x.id); });
      if (copyable.length) {
        items.push({ separator: true });
        items.push({ heading: 'Copy to clipboard' });
        copyable.forEach(function (x) {
          items.push({ label: x.label, icon: 'copy', onSelect: function () { actions.runExport(x.id, getSheets, extra, 'copy'); } });
        });
      }
      if (E.canShare && E.canShare()) {
        items.push({ separator: true });
        items.push({ label: 'Share PDF…', icon: 'share', onSelect: function () { actions.runExport('pdf', getSheets, extra, 'share'); } });
      }
      return items;
    },

    resetApp: function () {
      S.storage.clearAll(ls);
      lastRaw = null;
      lastBase = { songs: {}, sets: {} };
      dataLocked = false;
      loaded.raw = null;
      context.rawData = null;
      context.loadWarning = null;
      var settings = S.storage.normalizeSettings(null);
      store.set({ songs: {}, sets: {}, settings: settings, storageError: null });
      applyTheme(settings.theme);
      ui.toast('Everything was deleted', { type: 'ok' });
      router.navigate('/library');
    }
  };

  // ---- shell ----------------------------------------------------------------------------------
  var appEl = doc.getElementById('app');
  var navLinks = {};
  function navLink(name, href, label, iconName) {
    var a = h('a', { class: 'nav-link', href: href }, D.icon(iconName, { size: 18 }), h('span', { class: 'nav-text' }, label));
    navLinks[name] = a;
    return a;
  }
  var header = h('header', { class: 'app-header' },
    h('a', { class: 'brand', href: '#/library', 'aria-label': 'Songsheets home' },
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, '[G]'), h('span', { class: 'brand-name' }, 'Songsheets')),
    h('nav', { class: 'app-nav', 'aria-label': 'Main' },
      navLink('library', '#/library', 'Library', 'library'),
      navLink('sets', '#/sets', 'Sets', 'list'),
      navLink('settings', '#/settings', 'Settings', 'settings'),
      navLink('help', '#/help', 'Help', 'help')));
  var main = h('main', { class: 'app-main', id: 'main', tabindex: '-1' });
  D.replaceChildren(appEl, header, main);

  var context = {
    store: store,
    ui: ui,
    actions: actions,
    ls: ls,
    version: APP_VERSION,
    loadWarning: loaded.warning,
    rawData: loaded.raw,
    router: null
  };

  var current = null;
  var NAV_OF = { library: 'library', song: 'library', edit: 'library', 'new': 'library', sets: 'sets', set: 'sets', play: 'sets', settings: 'settings', help: 'help' };

  function show(route) {
    ui.closeMenu();
    if (current && current.destroy) {
      try { current.destroy(); } catch (e) { root.console.error(e); }
    }
    var factory = S.views[route.name];
    var view;
    try {
      view = factory ? factory(context, route) : S.views.notFound(context);
    } catch (e) {
      root.console.error(e);
      view = S.views.notFound(context, 'Something went wrong showing this page: ' + e.message);
    }
    current = view;
    D.replaceChildren(main, view.el);
    Object.keys(navLinks).forEach(function (k) {
      var on = NAV_OF[route.name] === k;
      navLinks[k].classList.toggle('is-active', on);
      if (on) navLinks[k].setAttribute('aria-current', 'page'); else navLinks[k].removeAttribute('aria-current');
    });
    doc.title = (view.title ? view.title + ' – ' : '') + 'Songsheets';
    doc.body.setAttribute('data-route', route.name);
    root.scrollTo(0, 0);
    if (view.focus) view.focus(); else main.focus({ preventScroll: true });
  }

  var skip = doc.querySelector('.skip-link');
  if (skip) skip.addEventListener('click', function (e) { e.preventDefault(); main.focus(); });

  var router = S.router.createRouter(show);
  context.router = router;

  // keyboard shortcuts
  doc.addEventListener('keydown', function (e) {
    if (e.defaultPrevented) return;
    if (doc.querySelector('dialog[open]') || doc.querySelector('.menu')) return;
    if (current && current.onKey && current.onKey(e)) { e.preventDefault(); return; }
    if (D.isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); router.navigate('/new'); }
    else if (e.key === '?') { e.preventDefault(); router.navigate('/help'); }
    else if (e.key === '/') { e.preventDefault(); router.navigate('/library'); }
  });

  // drop files anywhere to import them
  function hasFiles(e) {
    var t = e.dataTransfer && e.dataTransfer.types;
    return !!t && Array.prototype.indexOf.call(t, 'Files') >= 0;
  }
  doc.addEventListener('dragover', function (e) { if (hasFiles(e)) { e.preventDefault(); doc.body.classList.add('drop-target'); } });
  doc.addEventListener('dragleave', function (e) { if (!e.relatedTarget) doc.body.classList.remove('drop-target'); });
  doc.addEventListener('drop', function (e) {
    doc.body.classList.remove('drop-target');
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer.files.length) actions.importFiles(e.dataTransfer.files);
  });

  store.subscribe(function (st, patch) {
    if ((patch.songs || patch.sets) && !syncing) scheduleSave();
  });

  applyTheme(store.get().settings.theme);
  router.start();
  checkPersisted().then(function (p) { if (!p && Object.keys(store.get().songs).length) requestPersist(); });
  setTimeout(function () {
    var st = store.get();
    if (!S.storage.backupReminderDue(st.songs, st.settings, Date.now())) return;
    actions.updateSettings({ backupReminderAt: now() });
    var last = st.settings.lastBackupAt;
    ui.toast(last
      ? 'Your last backup was ' + Math.round((Date.now() - Date.parse(last)) / 864e5) + ' days ago. Songs live only in this browser, so download a fresh one.'
      : 'You have not backed up your songs yet. They live only in this browser, so download a backup to keep them safe.', {
      sticky: true, actionLabel: 'Back up', onAction: function () { actions.exportBackup(); }
    });
  }, 1500);
  if (loaded.warning) ui.toast(loaded.warning, { type: 'error', sticky: true });

  // ---- offline support (http/https only; file:// cannot use service workers) -------------------
  // Not on localhost while developing (a cache-first worker would hide edits); add ?sw=1 to test offline there.
  var devHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(root.location.hostname) && !/[?&]sw=1(&|$)/.test(root.location.search);
  if (/^https?:$/.test(root.location.protocol) && 'serviceWorker' in navigator && !devHost) {
    root.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').then(function (reg) {
        function offerUpdate(worker) {
          ui.toast('A new version of Songsheets is ready.', {
            sticky: true, actionLabel: 'Reload', onAction: function () { saveNow(); worker.postMessage({ type: 'SKIP_WAITING' }); }
          });
        }
        if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
        reg.addEventListener('updatefound', function () {
          var w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', function () {
            if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w);
          });
        });
      }).catch(function () { /* offline support is optional */ });
      var reloading = false;
      var hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (reloading || !hadController) return;
        reloading = true;
        root.location.reload();
      });
    });
  }

  S.app = { store: store, actions: actions, router: router, version: APP_VERSION, saveNow: saveNow };
})(typeof globalThis !== 'undefined' ? globalThis : this);
