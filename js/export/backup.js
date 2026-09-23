/* Songsheets — JSON backup, import detection and import of every supported file kind.
 *
 * exportJsonBackup(state) -> string      state = {songs: {id: song}|song[], sets: {id: set}|set[], settings}
 * detectImport(text, filename) -> 'backup'|'html-embed'|'songbase-api'|'songbase-songs'|'chordpro'
 *                                 |'two-line'|'songbase-text'|'unknown'
 * importAny(text, filename) -> {songs, sets, settings|null, warnings, kind}
 * importFiles(fileList) -> Promise<{songs, sets, settings|null, warnings, kind}>
 * fromSongbaseApi(json, opts) -> {songs, sets, warnings}
 * parseHtmlEmbed(html) -> embed object | null
 * Records are returned fully populated; merging them into the library is the app's job.
 * Browser: window.SongSheets.export.backup   Node: require('./backup.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var U = isNode ? require('./util.js') : root.SongSheets.export.util;
  var CP = isNode ? require('./chordpro.js') : root.SongSheets.export.chordpro;
  var N = isNode ? require('../core/normalize.js') : root.SongSheets.normalize;
  var ids = isNode ? require('../core/ids.js') : root.SongSheets.ids;

  var VERSION = 1;
  var CHORDPRO_EXT = /\.(cho|chopro|chordpro|crd|pro)$/i;
  var CHORDPRO_RE = /^\s*\{\s*(?:title|t|subtitle|st|artist|composer|key|capo|new_song|ns|soc|eoc|sov|eov|sob|eob|sot|eot|chorus|comment|c|ci|start_of_\w+|end_of_\w+)\s*(?::|\}|\s)/m;
  var EMBED_RE = /<script\b[^>]*\bid\s*=\s*["']songsheets-source["'][^>]*>([\s\S]*?)<\/script\s*>/i;

  function values(x) {
    if (!x) return [];
    if (Array.isArray(x)) return x.slice();
    if (typeof x === 'object') return Object.keys(x).map(function (k) { return x[k]; });
    return [];
  }

  function str(x) { return typeof x === 'string' ? x : x == null ? '' : String(x); }
  function intOr(x, d) { return typeof x === 'number' && isFinite(x) ? Math.trunc(x) : d; }
  function intOrNull(x) { return typeof x === 'number' && isFinite(x) ? Math.trunc(x) : null; }
  function isoOr(x, d) { return typeof x === 'string' && !isNaN(Date.parse(x)) ? x : d; }

  /** A song record with every field present and typed; unknown fields are not copied. */
  function normalizeSongRecord(r, now) {
    r = r && typeof r === 'object' ? r : {};
    now = now || ids.nowIso();
    var createdAt = isoOr(r.createdAt, now);
    return {
      id: typeof r.id === 'string' && r.id ? r.id : typeof r.id === 'number' ? String(r.id) : ids.newId(),
      title: N.normalizeText(str(r.title)).replace(/\s+/g, ' ').trim() || 'Untitled',
      author: typeof r.author === 'string' && r.author.trim() ? r.author.trim() : null,
      tags: Array.isArray(r.tags) ? r.tags.filter(function (t) { return typeof t === 'string' && t.trim(); }).map(function (t) { return t.trim(); }) : [],
      lyrics: N.normalizeText(str(r.lyrics)),
      notes: typeof r.notes === 'string' ? r.notes : '',
      transpose: ((intOr(r.transpose, 0) % 12) + 12) % 12,
      accidentals: r.accidentals === 'sharp' || r.accidentals === 'flat' || r.accidentals === 'auto' ? r.accidentals : null,
      tuneIndex: Math.max(0, intOr(r.tuneIndex, 0)),
      favourite: r.favourite === true,
      createdAt: createdAt,
      updatedAt: isoOr(r.updatedAt, createdAt),
      origin: r.origin && typeof r.origin === 'object' ? JSON.parse(JSON.stringify(r.origin)) : null
    };
  }

  function normalizeSetItem(it) {
    it = it && typeof it === 'object' ? it : {};
    var capo = intOrNull(it.capo);
    return {
      songId: str(it.songId),
      transpose: intOrNull(it.transpose),
      capo: capo !== null && capo > 0 ? capo : null,
      tuneIndex: intOrNull(it.tuneIndex)
    };
  }

  function normalizeSetRecord(r, now) {
    r = r && typeof r === 'object' ? r : {};
    now = now || ids.nowIso();
    var createdAt = isoOr(r.createdAt, now);
    return {
      id: typeof r.id === 'string' && r.id ? r.id : ids.newId(),
      name: N.normalizeText(str(r.name)).replace(/\s+/g, ' ').trim() || 'Set list',
      items: (Array.isArray(r.items) ? r.items : []).map(normalizeSetItem).filter(function (it) { return it.songId; }),
      createdAt: createdAt,
      updatedAt: isoOr(r.updatedAt, createdAt)
    };
  }

  function newSong(fields, now) {
    return normalizeSongRecord({ title: fields.title, author: fields.author, lyrics: fields.lyrics, tags: fields.tags, origin: fields.origin }, now);
  }

  // ---- backup ---------------------------------------------------------------------------------

  function exportJsonBackup(state) {
    state = state || {};
    var doc = {
      format: U.BACKUP_FORMAT,
      version: VERSION,
      exportedAt: ids.nowIso(),
      app: U.APP_ID,
      songs: values(state.songs),
      sets: values(state.sets),
      settings: state.settings && typeof state.settings === 'object' ? state.settings : null
    };
    return JSON.stringify(doc, null, 2) + '\n';
  }

  // ---- songbase -------------------------------------------------------------------------------

  function isSongbaseSong(x) {
    return !!x && typeof x === 'object' && !Array.isArray(x) && typeof x.lyrics === 'string' && typeof x.title === 'string';
  }

  /** Songbase API data ({songs, books} or a bare songs array) -> records. Ids are 'songbase-<id>', so
   *  importing the same data again yields the same records. */
  function fromSongbaseApi(json, opts) {
    opts = opts || {};
    var now = opts.now || ids.nowIso();
    var list = Array.isArray(json) ? json : json && Array.isArray(json.songs) ? json.songs : [];
    var books = !Array.isArray(json) && json && Array.isArray(json.books) ? json.books : [];
    var warnings = [];
    var songs = [];
    var seen = {};
    var skipped = 0;
    list.forEach(function (s) {
      if (!isSongbaseSong(s)) { skipped++; return; }
      var hasId = typeof s.id === 'number' || typeof s.id === 'string' && s.id !== '';
      var id = hasId ? 'songbase-' + s.id : ids.newId();
      if (!hasId) warnings.push('Songbase song "' + s.title + '" has no id; it will not merge on a later import.');
      if (seen[id]) { warnings.push('Songbase song ' + s.id + ' appears twice; the first copy was kept.'); return; }
      seen[id] = true;
      var lang = typeof s.lang === 'string' && s.lang.trim() ? s.lang.normalize('NFC').trim().toLowerCase() : null;
      var rec = newSong({
        title: s.title,
        lyrics: s.lyrics,
        tags: lang ? [lang] : [],
        origin: {
          source: 'songbase',
          id: hasId ? s.id : null,
          lang: lang,
          language_links: Array.isArray(s.language_links) ? s.language_links.slice() : [],
          importedAt: now
        }
      }, now);
      rec.id = id;
      songs.push(rec);
    });
    if (skipped) {
      warnings.push(skipped === 1 ? '1 entry was not a song (no title or lyrics) and was skipped.'
        : skipped + ' entries were not songs (no title or lyrics) and were skipped.');
    }

    var sets = [];
    books.forEach(function (b) {
      if (!b || typeof b !== 'object') return;
      var entries = b.songs && typeof b.songs === 'object' ? Object.keys(b.songs).map(function (sid) {
        return { sid: sid, index: Number(b.songs[sid]) };
      }) : [];
      entries.sort(function (a, c) {
        var ai = isFinite(a.index) ? a.index : Infinity;
        var ci = isFinite(c.index) ? c.index : Infinity;
        return ai - ci || (a.sid < c.sid ? -1 : a.sid > c.sid ? 1 : 0);
      });
      var missing = [];
      var items = [];
      entries.forEach(function (e) {
        var songId = 'songbase-' + e.sid;
        if (!seen[songId]) { missing.push(e.sid); return; }
        items.push({ songId: songId, transpose: null, capo: null, tuneIndex: null });
      });
      var name = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : 'Songbase book ' + (b.id != null ? b.id : sets.length + 1);
      if (missing.length) {
        warnings.push('Book "' + name + '": ' + missing.length + ' song' + (missing.length === 1 ? ' is' : 's are') +
          ' not in this file and ' + (missing.length === 1 ? 'was' : 'were') + ' left out (songbase ids ' + missing.slice(0, 10).join(', ') + (missing.length > 10 ? ', …' : '') + ').');
      }
      var set = normalizeSetRecord({ id: b.id != null ? 'songbase-book-' + b.id : undefined, name: name, items: items, createdAt: now, updatedAt: now }, now);
      sets.push(set);
    });
    return { songs: songs, sets: sets, warnings: warnings };
  }

  // ---- html embed -----------------------------------------------------------------------------

  function parseHtmlEmbed(html) {
    var m = EMBED_RE.exec(String(html == null ? '' : html));
    if (!m) return null;
    var data;
    try {
      data = JSON.parse(m[1]);
    } catch (e) {
      throw new Error('The song data inside this HTML file is damaged (' + e.message + ').');
    }
    if (!data || data.format !== U.EMBED_FORMAT) throw new Error('The HTML file has song data in an unknown format.');
    return data;
  }

  // ---- detection ------------------------------------------------------------------------------

  function stripBom(text) {
    var t = String(text == null ? '' : text);
    return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
  }

  function tryJson(t) {
    var s = t.trim();
    if (s[0] !== '{' && s[0] !== '[') return undefined;
    try { return JSON.parse(s); } catch (e) { return undefined; }
  }

  function looksBinary(t) {
    // NUL bytes, or bytes that were not valid UTF-8 (decoded as U+FFFD): a PDF, DOCX, image…
    return t.indexOf(String.fromCharCode(0)) >= 0 || t.indexOf(String.fromCharCode(0xfffd)) >= 0;
  }

  function hasTwoLine(t) {
    var lines = N.splitLines(t);
    for (var i = 0; i + 1 < lines.length; i++) {
      if (lines[i + 1].trim() && CP.isChordLine(lines[i], lines[i + 1]) && !CP.isChordLine(lines[i + 1], lines[i + 2])) return true;
    }
    return false;
  }

  function detectImport(text, filename) {
    var t = stripBom(text);
    if (!t.trim() || looksBinary(t)) return 'unknown';
    var trimmed = t.replace(/^\s+/, '');
    if (trimmed[0] === '<' && /\bid\s*=\s*["']songsheets-source["']/.test(t)) return 'html-embed';
    var json = tryJson(t);
    if (json !== undefined) {
      if (json && (json.format === U.BACKUP_FORMAT || json.format === U.EMBED_FORMAT)) return 'backup';
      if (Array.isArray(json)) return json.length && json.every(isSongbaseSong) ? 'songbase-songs' : 'unknown';
      if (json && Array.isArray(json.songs) && json.songs.every(isSongbaseSong) && (json.songs.length || Array.isArray(json.books))) return 'songbase-api';
      return 'unknown';
    }
    if (/\.json$/i.test(String(filename || ''))) return 'unknown';
    if (trimmed[0] === '<' && /<html[\s>]|<!doctype html/i.test(trimmed.slice(0, 2000))) return 'unknown';
    if (CHORDPRO_EXT.test(String(filename || '')) || CHORDPRO_RE.test(t)) return 'chordpro';
    if (/\[[^\]\n]*\]/.test(t)) return 'songbase-text';
    if (hasTwoLine(t)) return 'two-line';
    return 'songbase-text';
  }

  // ---- import ---------------------------------------------------------------------------------

  function result(kind) {
    return { songs: [], sets: [], settings: null, warnings: [], kind: kind };
  }

  function fromRecords(songs, sets, settings, kind, warnings) {
    var r = result(kind);
    var now = ids.nowIso();
    r.songs = songs.map(function (s) { return normalizeSongRecord(s, now); });
    r.sets = sets.map(function (s) { return normalizeSetRecord(s, now); });
    r.settings = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : null;
    r.warnings = warnings || [];
    return r;
  }

  function importAny(text, filename) {
    var t = stripBom(text);
    var kind = detectImport(t, filename);
    var r;
    try {
      if (kind === 'backup') {
        var doc = JSON.parse(t);
        var w = [];
        if (typeof doc.version === 'number' && doc.version > VERSION) w.push('This file was made by a newer version of Songsheets (format ' + doc.version + '); some details may be missing.');
        if (doc.format === U.EMBED_FORMAT) return fromRecords(values(doc.songs), doc.set ? [doc.set] : [], null, kind, w);
        return fromRecords(values(doc.songs), values(doc.sets), doc.settings, kind, w);
      }
      if (kind === 'html-embed') {
        var embed = parseHtmlEmbed(t);
        return fromRecords(values(embed.songs), embed.set ? [embed.set] : [], null, kind, []);
      }
      if (kind === 'songbase-api' || kind === 'songbase-songs') {
        var sb = fromSongbaseApi(JSON.parse(t));
        r = result(kind);
        r.songs = sb.songs;
        r.sets = sb.sets;
        r.warnings = sb.warnings;
        return r;
      }
      if (kind === 'chordpro') {
        r = result(kind);
        CP.importChordPro(t, { filename: filename }).forEach(function (s) {
          r.songs.push(newSong(s));
          s.warnings.forEach(function (msg) { r.warnings.push(s.title + ': ' + msg); });
        });
        if (!r.songs.length) r.warnings.push('No songs were found in ' + (filename || 'the ChordPro text') + '.');
        return r;
      }
      if (kind === 'two-line' || kind === 'songbase-text') {
        r = result(kind);
        var lyrics = kind === 'two-line' ? CP.twoLineToInline(t) : t;
        r.songs.push(newSong({ title: U.titleFromFilename(filename, 'Untitled'), lyrics: lyrics }));
        return r;
      }
    } catch (e) {
      r = result(kind);
      r.warnings.push((filename ? filename + ': ' : '') + e.message);
      return r;
    }
    r = result('unknown');
    r.warnings.push((filename ? filename + ': ' : '') + 'not a file Songsheets can import (expected a backup, songbase JSON, ChordPro, HTML export or song text).');
    return r;
  }

  /** Read and import every file; per-file failures become warnings, never a rejection. */
  function importFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    var total = result('unknown');
    var kinds = [];
    return files.reduce(function (p, file) {
      return p.then(function () {
        return Promise.resolve().then(function () { return file.text(); }).then(function (text) {
          var r = importAny(text, file.name);
          kinds.push(r.kind);
          total.songs = total.songs.concat(r.songs);
          total.sets = total.sets.concat(r.sets);
          if (r.settings) total.settings = r.settings;
          r.warnings.forEach(function (w) { total.warnings.push(w.indexOf(file.name + ': ') === 0 ? w : file.name + ': ' + w); });
        }, function (err) {
          kinds.push('unknown');
          total.warnings.push((file && file.name ? file.name : 'file') + ': could not be read (' + (err && err.message || err) + ').');
        });
      });
    }, Promise.resolve()).then(function () {
      var distinct = kinds.filter(function (k, i) { return kinds.indexOf(k) === i; });
      total.kind = distinct.length === 1 ? distinct[0] : distinct.length ? 'mixed' : 'unknown';
      return total;
    });
  }

  var api = {
    VERSION: VERSION,
    exportJsonBackup: exportJsonBackup,
    detectImport: detectImport,
    importAny: importAny,
    importFiles: importFiles,
    fromSongbaseApi: fromSongbaseApi,
    parseHtmlEmbed: parseHtmlEmbed,
    normalizeSongRecord: normalizeSongRecord,
    normalizeSetRecord: normalizeSetRecord
  };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.export = root.SongSheets.export || {};
  root.SongSheets.export.backup = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
