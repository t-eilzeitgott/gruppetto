import { useEffect, useRef, useSyncExternalStore } from 'react';

interface Entry {
  data?: unknown;
  error?: unknown;
  loading: boolean;
  stale: boolean;
  promise?: Promise<void>;
}

const entries = new Map<string, Entry>();
const subscribers = new Set<() => void>();
let version = 0;

function notify() {
  version += 1;
  subscribers.forEach((cb) => cb());
}

function subscribe(cb: () => void) {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function load(key: string, fn: () => Promise<unknown>) {
  const entry: Entry = entries.get(key) ?? { loading: false, stale: true };
  if (entry.promise) return;
  entry.loading = true;
  entry.promise = fn()
    .then((data) => {
      entry.data = data;
      entry.error = undefined;
    })
    .catch((err) => {
      entry.error = err;
    })
    .finally(() => {
      entry.loading = false;
      entry.stale = false;
      entry.promise = undefined;
      notify();
    });
  entries.set(key, entry);
}

export interface QueryResult<T> {
  data: T | undefined;
  error: unknown;
  /** true nur beim allerersten Laden (keine Daten vorhanden). */
  loading: boolean;
  reload: () => void;
}

/** Kleiner Daten-Cache: lädt einmal, hält Daten, lädt nach invalidate() neu. */
export function useQuery<T>(key: string | null, fn: () => Promise<T>): QueryResult<T> {
  useSyncExternalStore(subscribe, () => version);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const entry = key ? entries.get(key) : undefined;

  useEffect(() => {
    if (!key) return;
    const e = entries.get(key);
    if (!e || (e.stale && !e.promise)) load(key, () => fnRef.current());
  });

  return {
    data: entry?.data as T | undefined,
    error: entry?.error,
    loading: !!key && (!entry || (entry.data === undefined && entry.error === undefined)),
    reload: () => key && invalidate(key),
  };
}

/** Markiert Einträge als veraltet (Präfix-Treffer) – sichtbare Komponenten laden neu. */
export function invalidate(prefix = '') {
  for (const [key, entry] of entries) {
    if (key.startsWith(prefix)) entry.stale = true;
  }
  notify();
}

/** Alles verwerfen, z. B. beim Abmelden. */
export function resetCache() {
  entries.clear();
  notify();
}

let focusBound = false;
/** Beim Zurückkehren in die App frische Daten holen. */
export function refreshOnFocus() {
  if (focusBound) return;
  focusBound = true;
  let last = Date.now();
  const handler = () => {
    if (document.visibilityState === 'visible' && Date.now() - last > 20000) {
      last = Date.now();
      invalidate();
    }
  };
  document.addEventListener('visibilitychange', handler);
  window.addEventListener('focus', handler);
}
