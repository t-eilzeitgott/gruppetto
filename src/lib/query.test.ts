import { test } from 'node:test';
import assert from 'node:assert/strict';

test('Zwischenspeicher: gemerkte Daten stehen beim Start bereit (veraltet), fremde Schlüssel und alte Versionen nicht', async () => {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  const g = globalThis as unknown as { localStorage: unknown; window: unknown };
  g.localStorage = ls;
  g.window = { setTimeout, clearTimeout };
  store.set('gruppetto.cache.alt', '{}');
  store.set('gruppetto.cache.v2', JSON.stringify({ at: Date.now(), data: { 'tour:1': { stages: [1, 2] }, members: [{ id: 'a' }], 'geheim': 1 } }));
  const q = await import('../app/query');
  q.persistQueries('gruppetto.cache.v2', /^(tour:|members$)/);
  assert.deepEqual(q.peekQuery('tour:1'), { data: { stages: [1, 2] }, stale: true });
  assert.equal(q.peekQuery('geheim'), undefined);
  assert.equal(store.has('gruppetto.cache.alt'), false, 'alte Version weggeräumt');
  q.resetCache();
  assert.equal(store.has('gruppetto.cache.v2'), false, 'Abmelden löscht den Speicher');
});
