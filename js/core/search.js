/* Songsheets — library search, using songbase's normalisation and ranking.
 * Browser: window.SongSheets.search   Node: require('./search.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;

  /** NFD, strip accents, _ - — – to spaces, strip [chords] and punctuation, upper-case, collapse spaces. */
  function normalizeForSearch(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/[_\-—–‿]/g, ' ')
      .replace(/[’‘'"“”,!?()\[\].;:*#]/g, '')
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  var cache = new Map();                  // id -> {stamp, title, lyrics, author, tags}
  function indexed(song) {
    var stamp = (song.updatedAt || '') + '|' + (song.title || '').length + '|' + (song.lyrics || '').length;
    var c = cache.get(song.id);
    if (c && c.stamp === stamp) return c;
    c = {
      stamp: stamp,
      title: normalizeForSearch(song.title),
      lyrics: normalizeForSearch(song.lyrics),
      extra: normalizeForSearch([song.author || ''].concat(song.tags || []).join(' '))
    };
    cache.set(song.id, c);
    return c;
  }

  function byTitle(a, b) {
    return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base', numeric: true });
  }

  /** songs: array. Returns [{song, rank}] — rank 3 title starts with, 2 title contains, 1 author/tag, 0 lyrics. */
  function searchSongs(songs, query, opts) {
    opts = opts || {};
    var q = normalizeForSearch(query);
    var list = songs.slice();
    if (!q) {
      return list.sort(byTitle).map(function (s) { return { song: s, rank: 0 }; });
    }
    var out = [];
    list.forEach(function (song) {
      var ix = indexed(song);
      var rank = -1;
      if (ix.title.indexOf(q) === 0) rank = 3;
      else if (ix.title.indexOf(q) > 0) rank = 2;
      else if (ix.extra.indexOf(q) >= 0) rank = 1;
      else if (ix.lyrics.indexOf(q) >= 0) rank = 0;
      if (rank >= 0) out.push({ song: song, rank: rank });
    });
    out.sort(function (a, b) { return b.rank - a.rank || byTitle(a.song, b.song); });
    return opts.limit ? out.slice(0, opts.limit) : out;
  }

  var api = {
    normalizeForSearch: normalizeForSearch,
    escapeRegExp: escapeRegExp,
    searchSongs: searchSongs,
    byTitle: byTitle
  };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.search = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
