import { useSyncExternalStore } from 'react';
import type { TourTheme } from '../lib/types';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'gruppetto.theme';
const listeners = new Set<() => void>();

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

let pref: ThemePref = read();
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function resolvedTheme(): 'light' | 'dark' {
  if (pref === 'system') return media.matches ? 'dark' : 'light';
  return pref;
}

export function applyTheme() {
  const resolved = resolvedTheme();
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#000000' : '#ffffff');
}

export function setThemePref(next: ThemePref) {
  pref = next;
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    /* ignorieren */
  }
  applyTheme();
  listeners.forEach((cb) => cb());
}

media.addEventListener('change', () => {
  applyTheme();
  listeners.forEach((cb) => cb());
});

export function useThemePref(): ThemePref {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => pref,
  );
}

export function setTourTheme(theme: TourTheme | null) {
  document.documentElement.dataset.tour = theme ?? 'neutral';
}
