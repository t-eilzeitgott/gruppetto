import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

function current(): string {
  const raw = window.location.hash.replace(/^#/, '');
  return raw.startsWith('/') ? raw : '/';
}

// Alle Seitenwechsel laufen über einen Weg: Zustand ändern, dann alle Abonnenten in einem Rutsch neu zeichnen –
// wo der Browser es kann, als weicher Übergang (View Transition): alte Seite blendet aus, neue ein. So gibt es
// keinen harten Schnitt zwischen App und Minispiel.
const listeners = new Set<() => void>();
let shown = typeof window === 'undefined' ? '/' : current();
let bound = false;

function emit() {
  shown = current();
  listeners.forEach((cb) => cb());
}

type VTDocument = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void>; ready?: Promise<void> } };

function transition(update: () => void) {
  const d = document as VTDocument;
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!d.startViewTransition || calm || document.hidden) {
    update();
    return;
  }
  try {
    const vt = d.startViewTransition(() => flushSync(update));
    // übersprungene Übergänge (schnelles Doppeltippen) sind kein Fehler
    vt.ready?.catch(() => undefined);
    vt.finished.catch(() => undefined);
  } catch {
    update();
  }
}

/** Zurück/Vor im Browser oder Hash-Änderung von außen */
function onExternal() {
  // popstate und hashchange kommen oft beide: nur einmal wechseln
  if (current() === shown) return;
  shown = current();
  transition(emit);
}

function subscribe(cb: () => void) {
  if (!bound) {
    bound = true;
    window.addEventListener('hashchange', onExternal);
    window.addEventListener('popstate', onExternal);
  }
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export interface Route {
  path: string;
  parts: string[];
  query: URLSearchParams;
}

export function useRoute(): Route {
  const full = useSyncExternalStore(subscribe, current);
  const [path, search = ''] = full.split('?');
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(search) };
}

export function navigate(path: string, opts: { replace?: boolean } = {}) {
  if (current() === path && !opts.replace) return;
  const url = `${window.location.pathname}${window.location.search}#${path}`;
  if (opts.replace) window.history.replaceState(window.history.state, '', url);
  else window.history.pushState({ inApp: true }, '', url);
  shown = current();
  transition(() => {
    emit();
    window.scrollTo(0, 0);
  });
}

/** Zurück innerhalb der App, sonst zur angegebenen Seite. */
export function goBack(fallback: string) {
  const state = window.history.state as { inApp?: boolean } | null;
  if (state?.inApp) window.history.back();
  else navigate(fallback, { replace: true });
}
