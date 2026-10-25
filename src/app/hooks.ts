import { useEffect, useState, useSyncExternalStore } from 'react';
import { source } from './config';
import { useQuery } from './query';
import type { Profile, Tour, TourData } from '../lib/types';
import { defaultTour } from '../lib/time';

/** Aktuelle Zeit (im Demo-Modus die Demo-Uhr), aktualisiert sich regelmäßig. */
export function useNow(intervalMs = 15000): number {
  const [now, setNow] = useState(() => source.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(source.now()), intervalMs);
    return () => window.clearInterval(id);
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
