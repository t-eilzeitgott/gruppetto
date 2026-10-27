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
      if (persist?.match.test(key)) scheduleSave();
    })
    .catch((err) => {
      // vorhandene (auch zwischengespeicherte) Daten bleiben stehen, z. B. ohne Netz
      if (entry.data === undefined) entry.error = err;
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

/** aktueller Stand eines Eintrags (für Tests) */
export function peekQuery(key: string): { data: unknown; stale: boolean } | undefined {
  const e = entries.get(key);
  return e ? { data: e.data, stale: e.stale } : undefined;
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
  if (persist) {
    window.clearTimeout(saveT);
    try { localStorage.removeItem(persist.key); } catch { /* egal */ }
  }
  notify();
}

// ------------------------------------------------------------ Zwischenspeicher auf dem Gerät

/**
 * Zuletzt geladene Daten (passende Schlüssel) auf dem Gerät halten: Beim nächsten Start steht die Seite sofort
 * mit diesem Stand da und lädt im Hintergrund neu („stale-while-revalidate“) – kein Laden, kein Springen.
 * Der Speicher gilt nur für diese App-Version (neue Version: einmal frisch laden).
 */
let persist: { key: string; match: RegExp } | null = null;
let saveT = 0;

export function persistQueries(key: string, match: RegExp, maxAgeMs = 14 * 864e5) {
  persist = { key, match };
  try {
    // alte Stände anderer Versionen wegräumen
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k !== key && k.startsWith('gruppetto.cache.')) localStorage.removeItem(k);
    }
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const saved = JSON.parse(raw) as { at: number; data: Record<string, unknown> };
    if (!saved?.data || Date.now() - saved.at > maxAgeMs) return;
    for (const [k, data] of Object.entries(saved.data)) {
      if (!entries.has(k) && match.test(k)) entries.set(k, { data, loading: false, stale: true });
    }
  } catch {
    /* kaputter Speicher: einfach frisch laden */
  }
}

function scheduleSave() {
  window.clearTimeout(saveT);
  saveT = window.setTimeout(save, 700);
}

function save() {
  if (!persist) return;
  const data: Record<string, unknown> = {};
  for (const [k, e] of entries) if (persist.match.test(k) && e.data !== undefined) data[k] = e.data;
  try {
    localStorage.setItem(persist.key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // Speicher voll: lieber nichts als einen halben Stand
    try { localStorage.removeItem(persist.key); } catch { /* egal */ }
  }
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
