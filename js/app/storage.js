/* Songsheets — persistence in localStorage, record normalisation and import merging.
 *
 * Keys: 'songsheets:data'     {version, songs:{id:Song}, sets:{id:Set}}   (one blob: atomic, and it IS the backup)
 *       'songsheets:settings' {version, theme, fontScale, showChords, accidentals, pageSize, ...}
 * The keys are prefixed because every file:// page in Chromium shares one localStorage origin.
 * Browser: window.SongSheets.storage   Node: require('./storage.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var Ids = isNode ? require('../core/ids.js') : root.SongSheets.ids;
  var N = isNode ? require('../core/normalize.js') : root.SongSheets.normalize;

  var DATA_KEY = 'songsheets:data';
  var SETTINGS_KEY = 'songsheets:settings';
  var VERSION = 1;

  var DEFAULT_SETTINGS = {
    version: 1,
    theme: 'auto',            // 'auto' | 'light' | 'night'
    fontScale: 1,             // 0.7 .. 2
    showChords: true,
    accidentals: 'auto',      // default for songs without their own choice
    pageSize: 'A4',           // 'A4' | 'Letter'
    chordColor: '#1f45ff',
    printBw: false,
    librarySort: 'title',     // 'title' | 'updated' | 'created'
    editorShortcuts: true     // \ or $ inserts [], a-g inside [ is capitalised
  };

  function str(v, d) { return typeof v === 'string' ? v : (d === undefined ? '' : d); }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function numOrNull(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  function normalizeSong(rec) {
    rec = rec || {};
    var now = Ids.nowIso();
    var tags = Array.isArray(rec.tags) ? rec.tags : (typeof rec.tags === 'string' ? rec.tags.split(',') : []);
    return {
      id: str(rec.id) || Ids.newId(),
      title: str(rec.title).trim() || 'Untitled',
      author: rec.author ? String(rec.author) : null,
      tags: tags.map(function (t) { return String(t).trim(); }).filter(Boolean)
        .filter(function (t, i, a) { return a.indexOf(t) === i; }),
      lyrics: N.normalizeText(str(rec.lyrics)),
      notes: str(rec.notes),
      transpose: num(rec.transpose, 0) | 0,
      accidentals: rec.accidentals === 'sharp' || rec.accidentals === 'flat' || rec.accidentals === 'auto' ? rec.accidentals : null,
      tuneIndex: Math.max(0, num(rec.tuneIndex, 0) | 0),
      favourite: !!rec.favourite,
      createdAt: str(rec.createdAt) || now,
      updatedAt: str(rec.updatedAt) || str(rec.createdAt) || now,
      origin: rec.origin && typeof rec.origin === 'object' ? rec.origin : null
    };
  }

  function normalizeSet(rec) {
    rec = rec || {};
    var now = Ids.nowIso();
    return {
      id: str(rec.id) || Ids.newId(),
      name: str(rec.name).trim() || 'Untitled set',
      items: (Array.isArray(rec.items) ? rec.items : []).filter(function (it) { return it && it.songId; }).map(function (it) {
        return {
          songId: String(it.songId),
          transpose: numOrNull(it.transpose),
          capo: numOrNull(it.capo),
          tuneIndex: numOrNull(it.tuneIndex !== undefined ? it.tuneIndex : it.tune)
        };
      }),
      createdAt: str(rec.createdAt) || now,
      updatedAt: str(rec.updatedAt) || str(rec.createdAt) || now
    };
  }

  function normalizeSettings(s) {
    var out = Object.assign({}, DEFAULT_SETTINGS);
    s = s || {};
    if (['auto', 'light', 'night'].indexOf(s.theme) >= 0) out.theme = s.theme;
    if (typeof s.fontScale === 'number' && s.fontScale >= 0.6 && s.fontScale <= 2.5) out.fontScale = Math.round(s.fontScale * 100) / 100;
    if (typeof s.showChords === 'boolean') out.showChords = s.showChords;
    if (['auto', 'sharp', 'flat'].indexOf(s.accidentals) >= 0) out.accidentals = s.accidentals;
    if (s.pageSize === 'A4' || s.pageSize === 'Letter') out.pageSize = s.pageSize;
    if (typeof s.chordColor === 'string' && /^#[0-9a-f]{6}$/i.test(s.chordColor)) out.chordColor = s.chordColor;
    if (typeof s.printBw === 'boolean') out.printBw = s.printBw;
    if (['title', 'updated', 'created'].indexOf(s.librarySort) >= 0) out.librarySort = s.librarySort;
    if (typeof s.editorShortcuts === 'boolean') out.editorShortcuts = s.editorShortcuts;
    return out;
  }

  function toMap(list, normalizer) {
    var out = {};
    (Array.isArray(list) ? list : Object.keys(list || {}).map(function (k) { return list[k]; }))
      .forEach(function (r) { var n = normalizer(r); out[n.id] = n; });
    return out;
  }

  // ---- migrations -----------------------------------------------------------------------------
  var MIGRATIONS = {
    // 0: data written before versioning (arrays instead of maps)
    0: function (d) { return { version: 1, songs: d.songs || {}, sets: d.sets || {} }; }
  };

  function migrate(data) {
    var d = data && typeof data === 'object' ? data : {};
    var v = typeof d.version === 'number' ? d.version : 0;
    if (v > VERSION) {
      var err = new Error('This library was saved by a newer version of Songsheets (data version ' + v + ').');
      err.code = 'FUTURE_VERSION';
      throw err;
    }
    while (v < VERSION) { d = MIGRATIONS[v](d); v = d.version; }
    return { version: VERSION, songs: toMap(d.songs, normalizeSong), sets: toMap(d.sets, normalizeSet) };
  }

  // ---- storage access -------------------------------------------------------------------------
  function isQuotaError(e) {
    return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
  }

  function getLocalStorage() {
    try {
      var ls = root.localStorage;
      var k = 'songsheets:probe';
      ls.setItem(k, '1');
      ls.removeItem(k);
      return ls;
    } catch (e) {
      return null;
    }
  }

  /** load(ls) -> {songs, sets, settings, warning|null, raw|null (unreadable data kept for download)} */
  function load(ls) {
    var out = { songs: {}, sets: {}, settings: normalizeSettings(null), warning: null, raw: null };
    if (!ls) { out.warning = 'Browser storage is unavailable, so nothing will be kept after you close this page. Export a backup to keep your songs.'; return out; }
    try {
      var s = ls.getItem(SETTINGS_KEY);
      if (s) out.settings = normalizeSettings(JSON.parse(s));
    } catch (e) { /* bad settings: use defaults */ }
    var raw = null;
    try {
      raw = ls.getItem(DATA_KEY);
      if (raw) {
        var data = migrate(JSON.parse(raw));
        out.songs = data.songs;
        out.sets = data.sets;
      }
    } catch (e) {
      out.raw = raw;
      out.warning = e.code === 'FUTURE_VERSION'
        ? e.message + ' Your data was not changed; download it from Settings and update this copy of the app.'
        : 'Your saved library could not be read. It was left untouched; download it from Settings before making changes.';
    }
    return out;
  }

  function serializeData(songs, sets) {
    return JSON.stringify({ version: VERSION, songs: songs, sets: sets });
  }

  /** Returns null on success or an error object {quota:boolean, message}. */
  function saveData(ls, songs, sets) {
    if (!ls) return { quota: false, message: 'Browser storage is unavailable.' };
    try {
      ls.setItem(DATA_KEY, serializeData(songs, sets));
      return null;
    } catch (e) {
      return { quota: isQuotaError(e), message: isQuotaError(e) ? 'Storage is full.' : String(e && e.message || e) };
    }
  }

  function saveSettings(ls, settings) {
    if (!ls) return null;
    try { ls.setItem(SETTINGS_KEY, JSON.stringify(settings)); return null; } catch (e) { return { quota: isQuotaError(e), message: String(e && e.message || e) }; }
  }

  function clearAll(ls) {
    if (!ls) return;
    [DATA_KEY, SETTINGS_KEY].forEach(function (k) { try { ls.removeItem(k); } catch (e) { /* ignore */ } });
  }

  function usageBytes(ls) {
    if (!ls) return 0;
    var n = 0;
    [DATA_KEY, SETTINGS_KEY].forEach(function (k) {
      try { var v = ls.getItem(k); if (v) n += (v.length + k.length) * 2; } catch (e) { /* ignore */ }
    });
    return n;
  }

  // ---- merge ----------------------------------------------------------------------------------
  function newer(a, b) { return String(a || '') > String(b || ''); }

  /** Merge imported records into the current library.
   *  mode 'merge': by id; an incoming record replaces an existing one only if its updatedAt is newer.
   *  mode 'replace': the import becomes the whole library.
   *  Set items that point at songs that do not exist are dropped.
   *  Returns {songs, sets, stats:{added, updated, skipped, setsAdded, setsUpdated, setsSkipped, droppedItems}} */
  function mergeData(current, incoming, opts) {
    opts = opts || {};
    var mode = opts.mode === 'replace' ? 'replace' : 'merge';
    var stats = { added: 0, updated: 0, skipped: 0, setsAdded: 0, setsUpdated: 0, setsSkipped: 0, droppedItems: 0 };
    var songs = mode === 'replace' ? {} : Object.assign({}, current.songs || {});
    var sets = mode === 'replace' ? {} : Object.assign({}, current.sets || {});
    var inSongs = toMap(incoming.songs, normalizeSong);
    var inSets = toMap(incoming.sets, normalizeSet);

    Object.keys(inSongs).forEach(function (id) {
      var rec = inSongs[id];
      var old = songs[id];
      if (!old) { songs[id] = rec; stats.added++; }
      else if (newer(rec.updatedAt, old.updatedAt)) { songs[id] = rec; stats.updated++; }
      else stats.skipped++;
    });
    Object.keys(inSets).forEach(function (id) {
      var rec = inSets[id];
      var old = sets[id];
      if (!old) { sets[id] = rec; stats.setsAdded++; }
      else if (newer(rec.updatedAt, old.updatedAt)) { sets[id] = rec; stats.setsUpdated++; }
      else stats.setsSkipped++;
    });
    Object.keys(sets).forEach(function (id) {
      var s = sets[id];
      var kept = s.items.filter(function (it) { return !!songs[it.songId]; });
      if (kept.length !== s.items.length) {
        stats.droppedItems += s.items.length - kept.length;
        sets[id] = Object.assign({}, s, { items: kept });
      }
    });
    return { songs: songs, sets: sets, stats: stats };
  }

  /** Three-way merge for two tabs sharing one localStorage blob.
   *  base = what this tab last read or wrote, local = this tab's state now, remote = what is stored now.
   *  Starts from remote and re-applies this tab's own edits and deletions since base.
   *  When both sides changed the same record, the newer updatedAt wins. Works on {id: record} maps. */
  function rebaseMap(base, local, remote) {
    base = base || {}; local = local || {}; remote = remote || {};
    var out = Object.assign({}, remote);
    var same = function (a, b) { return a === b || JSON.stringify(a) === JSON.stringify(b); };
    Object.keys(local).forEach(function (id) {
      if (base[id] && same(local[id], base[id])) return;             // unchanged here: remote wins
      var r = remote[id];
      if (r && base[id] && !same(r, base[id]) && newer(r.updatedAt, local[id].updatedAt)) return;   // both changed, remote newer
      out[id] = local[id];
    });
    Object.keys(base).forEach(function (id) {
      if (local[id]) return;                                          // not deleted here
      var r = remote[id];
      if (r && !same(r, base[id]) && newer(r.updatedAt, base[id].updatedAt)) return;   // edited elsewhere after: keep it
      delete out[id];
    });
    return out;
  }

  function rebaseData(base, local, remote) {
    return {
      songs: rebaseMap(base.songs, local.songs, remote.songs),
      sets: rebaseMap(base.sets, local.sets, remote.sets)
    };
  }

  function describeStats(stats) {
    var parts = [];
    if (stats.added) parts.push(stats.added + ' song' + (stats.added === 1 ? '' : 's') + ' added');
    if (stats.updated) parts.push(stats.updated + ' updated');
    if (stats.skipped) parts.push(stats.skipped + ' already up to date');
    if (stats.setsAdded) parts.push(stats.setsAdded + ' set' + (stats.setsAdded === 1 ? '' : 's') + ' added');
    if (stats.setsUpdated) parts.push(stats.setsUpdated + ' set' + (stats.setsUpdated === 1 ? '' : 's') + ' updated');
    if (stats.droppedItems) parts.push(stats.droppedItems + ' set entr' + (stats.droppedItems === 1 ? 'y' : 'ies') + ' without a song removed');
    return parts.length ? parts.join(', ') + '.' : 'Nothing new to import.';
  }

  var api = {
    DATA_KEY: DATA_KEY,
    SETTINGS_KEY: SETTINGS_KEY,
    VERSION: VERSION,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    normalizeSong: normalizeSong,
    normalizeSet: normalizeSet,
    normalizeSettings: normalizeSettings,
    migrate: migrate,
    isQuotaError: isQuotaError,
    getLocalStorage: getLocalStorage,
    load: load,
    serializeData: serializeData,
    saveData: saveData,
    saveSettings: saveSettings,
    clearAll: clearAll,
    usageBytes: usageBytes,
    mergeData: mergeData,
    rebaseMap: rebaseMap,
    rebaseData: rebaseData,
    describeStats: describeStats
  };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.storage = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
