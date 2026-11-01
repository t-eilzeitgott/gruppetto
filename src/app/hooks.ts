import { useEffect, useState, useSyncExternalStore } from 'react';
import { source } from './config';
import { invalidate, useQuery } from './query';
import type { Profile, Tour, TourData } from '../lib/types';
import { defaultTour } from '../lib/time';
import { uiBusy } from '../game/uiBusy';

/** Aktuelle Zeit (im Demo-Modus die Demo-Uhr), aktualisiert sich regelmäßig. */
export function useNow(intervalMs = 15000): number {
  const [now, setNow] = useState(() => source.now());
  useEffect(() => {
    // bewegt sich die Oberfläche gerade (Wischen, Einrasten, Blatt), warten: das Neuberechnen der Seite fiele
    // sonst mitten in die Bewegung
    let later = 0;
    const tick = () => {
      window.clearTimeout(later);
      if (uiBusy()) { later = window.setTimeout(tick, 250); return; }
      setNow(source.now());
    };
    const id = window.setInterval(tick, intervalMs);
    return () => { window.clearInterval(id); window.clearTimeout(later); };
  }, [intervalMs]);
  return now;
}

export function useAuthUser() {
  return useSyncExternalStore(
    (cb) => source.onAuthChange(cb),
    () => source.currentUser()?.id ?? null,
  );
}

export function useMe() {
  const userId = useAuthUser();
  return useQuery<Profile | null>(userId ? `me:${userId}` : null, () => source.loadMe());
}

export function useMembers() {
  return useQuery<Profile[]>('members', () => source.loadMembers());
}

export function useTours() {
  return useQuery<Tour[]>('tours', () => source.loadTours());
}

export function useTourData(tour: Tour | null) {
  return useQuery<TourData>(tour ? `tour:${tour.id}` : null, () => source.loadTourData(tour!));
}

const TOUR_KEY = 'gruppetto.tour';
const tourListeners = new Set<() => void>();

function readTourPref(): string | null {
  try {
    return localStorage.getItem(TOUR_KEY);
  } catch {
    return null;
  }
}

export function setSelectedTour(id: string) {
  try {
    localStorage.setItem(TOUR_KEY, id);
  } catch {
    /* ignorieren */
  }
  tourListeners.forEach((cb) => cb());
}

/** Gewählte Rundfahrt: gespeicherte Wahl oder laufende/nächste. */
export function useSelectedTour(): { tour: Tour | null; tours: Tour[]; loading: boolean; error: unknown } {
  const { data, loading, error } = useTours();
  const stored = useSyncExternalStore(
    (cb) => {
      tourListeners.add(cb);
      return () => tourListeners.delete(cb);
    },
    readTourPref,
  );
  const visible = (data ?? []).filter((t) => t.is_visible);
  const tour = visible.find((t) => t.id === stored) ?? defaultTour(visible, source.now());
  return { tour, tours: visible, loading, error };
}

// ---------- Lieblingsfahrer ----------
const favPending = new Map<number, boolean>();
let favVersion = 0;
const favListeners = new Set<() => void>();
const favNotify = () => { favVersion += 1; favListeners.forEach((l) => l()); };

/** Schlüssel eines Fahrers für Favoriten (Stammdaten-ID, sonst Fahrer-ID) */
export function favKey(rider: { id: number; cyclist_id?: number | null }): number {
  return rider.cyclist_id ?? rider.id;
}

export function useFavorites(): { has: (rider: { id: number; cyclist_id?: number | null }) => boolean; toggle: (rider: { id: number; cyclist_id?: number | null }) => void; count: number } {
  const q = useQuery<number[]>('favorites', () => source.listFavorites());
  useSyncExternalStore((cb) => { favListeners.add(cb); return () => { favListeners.delete(cb); }; }, () => favVersion);
  const base = new Set(q.data ?? []);
  for (const [k, on] of favPending) {
    if (on) base.add(k); else base.delete(k);
  }
  return {
    has: (rider) => base.has(favKey(rider)),
    count: base.size,
    toggle: (rider) => {
      const key = favKey(rider);
      const on = !base.has(key);
      favPending.set(key, on);
      favNotify();
      source.setFavorite(key, on)
        .then(() => invalidate('favorites'))
        .catch(() => undefined)
        .finally(() => {
          // kurz warten, bis die neue Liste geladen ist, dann den Zwischenstand verwerfen
          window.setTimeout(() => { favPending.delete(key); favNotify(); }, 800);
        });
    },
  };
}
