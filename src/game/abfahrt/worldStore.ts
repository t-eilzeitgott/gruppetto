/**
 * Änderungen aus dem Welt-Editor für die Spiele: je Tagesstrecke („abfahrt:2026-10-28“) und „überall“ (global).
 * Der Renderer ruft bei jedem Bild sync(track) auf – lädt beim ersten Mal aus der Datenbank (Kopie im Browser,
 * damit es auch ohne Netz und sofort geht) und legt die Änderungen auf die Strecke, sobald sie da sind.
 * Der Editor schreibt über set() direkt hinein, sodass seine Strecke nicht komplett neu gebaut wird.
 */
import { source } from '../../app/config';
import type { Track } from './track';
import { GLOBAL_KEY, KIND_GAME, editsKey, normalizeEdits, type WorldEdits } from './worldEdits';

interface Entry { edits: WorldEdits | null; loadedAt: number; loading: boolean }
const cache = new Map<string, Entry>();
let version = 0;
/** so lange gilt eine geladene Fassung, danach wird beim nächsten Spiel neu nachgesehen */
const MAX_AGE = 3 * 60 * 1000;
const LS = (key: string) => `gruppetto.world.${key}`;

function fromLocal(key: string): WorldEdits | null {
  try {
    const t = localStorage.getItem(LS(key));
    return t ? (JSON.parse(t) as WorldEdits) : null;
  } catch {
    return null;
  }
}
function toLocal(key: string, e: WorldEdits | null) {
  try {
    if (e) localStorage.setItem(LS(key), JSON.stringify(e)); else localStorage.removeItem(LS(key));
  } catch { /* egal */ }
}

function normalize(key: string, raw: unknown): WorldEdits | null {
  if (!raw) return null;
  if (key === GLOBAL_KEY) {
    const e = normalizeEdits(raw, 'abfahrt', '', 'Überall');
    return { ...e, key: GLOBAL_KEY };
  }
  const [g, d] = key.split(':');
  return normalizeEdits(raw, (g as 'abfahrt' | 'sprint' | 'berg') ?? 'abfahrt', d ?? '');
}

function entry(key: string): Entry {
  let e = cache.get(key);
  if (!e) {
    e = { edits: normalize(key, fromLocal(key)), loadedAt: 0, loading: false };
    cache.set(key, e);
  }
  if (!e.loading && Date.now() - e.loadedAt > MAX_AGE) {
    e.loading = true;
    source.loadWorldEdits(key).then((raw) => {
      const n = normalize(key, raw);
      const cur = e!.edits;
      // die neuere Fassung gewinnt (eine Kopie im Browser kann jünger sein, wenn das Speichern fehlschlug)
      if (!cur?.updated || !n || !n.updated || n.updated >= cur.updated) {
        if (JSON.stringify(n) !== JSON.stringify(cur)) { e!.edits = n; toLocal(key, n); version += 1; }
      }
    }).catch(() => undefined).finally(() => { e!.loadedAt = Date.now(); e!.loading = false; });
  }
  return e;
}

/** Änderungen für eine Strecke lesen (sofort aus dem Zwischenspeicher, lädt nebenbei nach) */
export function get(key: string): WorldEdits | null {
  return entry(key).edits;
}

export function currentVersion(): number { return version; }

/**
 * Strecke auf den Stand bringen. true = Änderungen wurden neu aufgelegt (der Renderer baut dann alles neu);
 * false = nichts zu tun.
 */
export function sync(track: Track): boolean {
  const key = editsKey(KIND_GAME[track.kind], track.dayKey);
  const day = entry(key);
  const glob = entry(GLOBAL_KEY);
  if (track.editsVersion === version) return false;
  track.editsVersion = version;
  const same = track.edits === day.edits && track.global === glob.edits;
  if (same) return false;
  track.global = glob.edits;
  track.edits = day.edits;
  return true;
}

/** vom Editor: eine Fassung ablegen, die eine Strecke schon trägt (kein Neuaufbau durch sync) */
export function set(key: string, e: WorldEdits | null, applied?: Track) {
  const en = entry(key);
  en.edits = e;
  en.loadedAt = Date.now();
  toLocal(key, e);
  version += 1;
  if (applied) applied.editsVersion = version;
}
