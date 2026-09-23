'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const St = require('../../js/app/storage.js');
const R = require('../../js/app/router.js');
const { createStore } = require('../../js/app/store.js');

function memoryStorage(opts = {}) {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      if (opts.quota && String(v).length > opts.quota) {
        const e = new Error('full');
        e.name = 'QuotaExceededError';
        throw e;
      }
      data.set(k, String(v));
    },
    removeItem: (k) => data.delete(k),
    _data: data
  };
}

const song = (id, extra = {}) => St.normalizeSong(Object.assign({ id, title: 'Song ' + id, lyrics: '[G]la', updatedAt: '2026-01-01T00:00:00.000Z' }, extra));

test('normalizeSong fills defaults and normalises text', () => {
  const s = St.normalizeSong({ title: '  Hi ', lyrics: '\r\n\r\n  [C]chorus\r\nline  \r\n', tags: 'a, b, a' });
  assert.equal(s.title, 'Hi');
  assert.equal(s.lyrics, '  [C]chorus\nline');
  assert.deepEqual(s.tags, ['a', 'b']);
  assert.equal(s.transpose, 0);
  assert.equal(s.favourite, false);
  assert.ok(s.id && s.createdAt && s.updatedAt);
  assert.equal(St.normalizeSong({ lyrics: 'cafe\u0301' }).lyrics, 'café');
});

test('save and load round trip', () => {
  const ls = memoryStorage();
  const songs = { a: song('a'), b: song('b') };
  const sets = { s: St.normalizeSet({ id: 's', name: 'Sunday', items: [{ songId: 'a', transpose: 2 }] }) };
  assert.equal(St.saveData(ls, songs, sets), null);
  St.saveSettings(ls, St.normalizeSettings({ theme: 'night', fontScale: 1.3, bogus: 1 }));
  const loaded = St.load(ls);
  assert.deepEqual(loaded.songs, songs);
  assert.equal(loaded.sets.s.items[0].transpose, 2);
  assert.equal(loaded.sets.s.items[0].capo, null);
  assert.equal(loaded.settings.theme, 'night');
  assert.equal(loaded.settings.fontScale, 1.3);
  assert.equal(loaded.settings.bogus, undefined);
  assert.equal(loaded.warning, null);
});

test('unreadable or future data is left untouched', () => {
  const ls = memoryStorage();
  ls.setItem(St.DATA_KEY, '{not json');
  const bad = St.load(ls);
  assert.equal(bad.raw, '{not json');
  assert.ok(bad.warning);
  ls.setItem(St.DATA_KEY, JSON.stringify({ version: 99, songs: {} }));
  const future = St.load(ls);
  assert.match(future.warning, /newer version/);
  assert.ok(future.raw);
  assert.ok(St.load(null).warning);
});

test('migration from unversioned arrays', () => {
  const d = St.migrate({ songs: [{ id: 'x', title: 'X', lyrics: 'a' }], sets: [] });
  assert.equal(d.version, 1);
  assert.equal(d.songs.x.title, 'X');
});

test('quota errors are reported, not thrown', () => {
  const ls = memoryStorage({ quota: 50 });
  const err = St.saveData(ls, { a: song('a') }, {});
  assert.equal(err.quota, true);
  assert.equal(St.isQuotaError({ code: 22 }), true);
  assert.equal(St.isQuotaError(new Error('x')), false);
});

test('merge: newer wins, ties keep current, orphans dropped', () => {
  const current = {
    songs: { a: song('a', { title: 'Local A', updatedAt: '2026-02-01T00:00:00.000Z' }), b: song('b') },
    sets: { s: St.normalizeSet({ id: 's', name: 'Set', items: [{ songId: 'a' }, { songId: 'b' }], updatedAt: '2026-01-01T00:00:00.000Z' }) }
  };
  const incoming = {
    songs: [
      song('a', { title: 'Older A', updatedAt: '2026-01-15T00:00:00.000Z' }),
      song('b', { title: 'Newer B', updatedAt: '2026-03-01T00:00:00.000Z' }),
      song('c')
    ],
    sets: [St.normalizeSet({ id: 't', name: 'New', items: [{ songId: 'c' }, { songId: 'zzz' }] })]
  };
  const r = St.mergeData(current, incoming);
  assert.equal(r.songs.a.title, 'Local A');
  assert.equal(r.songs.b.title, 'Newer B');
  assert.ok(r.songs.c);
  assert.deepEqual(r.sets.t.items.map((i) => i.songId), ['c']);
  assert.deepEqual(r.stats, { added: 1, updated: 1, skipped: 1, setsAdded: 1, setsUpdated: 0, setsSkipped: 0, droppedItems: 1 });
  assert.match(St.describeStats(r.stats), /1 song added/);
  const rep = St.mergeData(current, incoming, { mode: 'replace' });
  assert.deepEqual(Object.keys(rep.songs).sort(), ['a', 'b', 'c']);
  assert.equal(rep.songs.a.title, 'Older A');
  assert.equal(rep.sets.s, undefined);
  // current state is never mutated
  assert.equal(current.songs.b.title, 'Song b');
});

test('router parsing', () => {
  assert.deepEqual(R.parseHash(''), { path: '/library', query: {} });
  assert.deepEqual(R.parseHash('#/song/abc%20d?tune=1&q=a+b'), { path: '/song/abc%20d', query: { tune: '1', q: 'a b' } });
  assert.deepEqual(R.matchRoute('/song/abc%20d'), { name: 'song', params: { id: 'abc d' } });
  assert.deepEqual(R.matchRoute('/set/x/play/3'), { name: 'play', params: { id: 'x', index: '3' } });
  assert.deepEqual(R.matchRoute('/set/x'), { name: 'set', params: { id: 'x' } });
  assert.equal(R.matchRoute('/nope'), null);
  assert.equal(R.buildHash('/library', { q: 'a b', tags: '' }), '#/library?q=a%20b');
});

test('store notifies subscribers with the patch', () => {
  const s = createStore({ a: 1 });
  const seen = [];
  const off = s.subscribe((st, p) => seen.push([st.a, p]));
  s.set({ a: 2 });
  off();
  s.set({ a: 3 });
  assert.deepEqual(seen, [[2, { a: 2 }]]);
  assert.equal(s.get().a, 3);
});

test('two tabs: rebase keeps both sides\' edits and deletions', () => {
  const base = { a: song('a'), b: song('b'), c: song('c') };
  // this tab edited a and deleted c; the other tab added d and edited b
  const local = { a: song('a', { title: 'A here', updatedAt: '2026-05-01T00:00:00.000Z' }), b: base.b };
  const remote = { a: base.a, b: song('b', { title: 'B there', updatedAt: '2026-05-02T00:00:00.000Z' }), c: base.c, d: song('d') };
  const out = St.rebaseMap(base, local, remote);
  assert.deepEqual(Object.keys(out).sort(), ['a', 'b', 'd']);
  assert.equal(out.a.title, 'A here');
  assert.equal(out.b.title, 'B there');
  // both edited the same song: the newer one wins
  const both = St.rebaseMap({ a: base.a }, { a: song('a', { title: 'mine', updatedAt: '2026-05-01T00:00:00.000Z' }) },
    { a: song('a', { title: 'theirs', updatedAt: '2026-06-01T00:00:00.000Z' }) });
  assert.equal(both.a.title, 'theirs');
  // deleted here, but edited later elsewhere: keep it
  const kept = St.rebaseMap({ a: base.a }, {}, { a: song('a', { title: 'edited', updatedAt: '2026-06-01T00:00:00.000Z' }) });
  assert.equal(kept.a.title, 'edited');
  // nothing changed here: the stored copy wins entirely (including its deletions)
  assert.deepEqual(St.rebaseMap(base, base, { a: base.a }), { a: base.a });
});
