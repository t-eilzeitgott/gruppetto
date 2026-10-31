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

/** zuletzt gezeichnete Seite */
let onScreen = shown;

function emit() {
  shown = current();
  listeners.forEach((cb) => cb());
  onScreen = shown;
}

/** Minispiele (mit 3D-Leinwand) */
const isGame = (p: string) => p.split('?')[0].startsWith('/spiel');

/**
 * In ein Minispiel hinein oder heraus: kein View Transition – iOS zeigt beim Abbau des Übergangs mit der
 * 3D-Leinwand für ein Bild einen Zwischenstand (Karte halb durchsichtig, altes Bild, Tableiste). Stattdessen
 * die neue Seite sofort zeichnen und kurz einblenden.
 */
function fadeIn(update: () => void) {
  flushSync(update);
  const el = document.getElementById('root');
  try {
    el?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'cubic-bezier(0.2, 0, 0.2, 1)' });
  } catch { /* egal */ }
}

type VTDocument = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void>; ready?: Promise<void> } };

let running = 0;
/** der nächste Wechsel ins Spiel wird von außen überblendet (handoff.ts) – dann nicht noch einmal einblenden */
let handed = false;
export function handOver() { handed = true; }

function transition(update: () => void) {
  const d = document as VTDocument;
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!d.startViewTransition || calm || document.hidden) {
    handed = false;
    update();
    return;
  }
  if (isGame(onScreen) || isGame(current())) {
    if (handed) { handed = false; flushSync(update); return; }
    fadeIn(update);
    return;
  }
  handed = false;
  const root = document.documentElement;
  try {
    // „vt“: Tableiste und Statusleiste während des Übergangs deckend (siehe styles.css)
    running += 1;
    root.classList.add('vt');
    const vt = d.startViewTransition(() => flushSync(update));
    // übersprungene Übergänge (schnelles Doppeltippen) sind kein Fehler
    vt.ready?.catch(() => undefined);
    vt.finished.catch(() => undefined).finally(() => {
      running -= 1;
      if (running <= 0) { running = 0; root.classList.remove('vt'); }
    });
  } catch {
    running = Math.max(0, running - 1);
    if (!running) root.classList.remove('vt');
    update();
  }
}

// Verlauf: Tab-Seiten (Heute, Etappen, Bonus, Rangliste, Profil) liegen immer ganz unten (Tiefe 0), nur
// Unterseiten kommen obendrauf. So geht die Wischgeste „zurück“ nur von einer Unterseite zu ihrem Tab –
// zwischen den Tabs gibt es nichts, wohin man zurückwischen könnte.
const TAB_ROOTS = ['/', '/etappen', '/bonus', '/rangliste', '/profil'];
type HistState = { inApp?: boolean; d?: number } | null;

function depth(): number {
  const d = (window.history.state as HistState)?.d;
  return typeof d === 'number' && d > 0 ? d : 0;
}

function urlFor(path: string) {
  return `${window.location.pathname}${window.location.search}#${path}`;
}

/** Zurück über den eigenen Pfeil (dann mit weichem Übergang) */
let ownBack = false;
/** Tab-Wechsel von einer Unterseite: erst den Verlauf bis zum Tab abbauen, dann ersetzen */
let pendingRoot: string | null = null;

function show(animate: boolean) {
  const update = () => {
    emit();
    window.scrollTo(0, 0);
  };
  if (animate) transition(update);
  else flushSync(update);
}

/** Zurück/Vor im Browser oder Hash-Änderung von außen */
function onExternal() {
  if (pendingRoot !== null) {
    // Verlauf ist bis zur Tiefe 0 abgebaut: dort den neuen Tab eintragen (Zwischenseite nie zeichnen)
    if (depth() > 0) return;
    const path = pendingRoot;
    pendingRoot = null;
    window.history.replaceState({ inApp: true, d: 0 }, '', urlFor(path));
    shown = current();
    show(true);
    return;
  }
  // popstate und hashchange kommen oft beide: nur einmal wechseln
  if (current() === shown) return;
  shown = current();
  // Wischgeste (oder Zurück im Browser): iOS hat den Wechsel schon selbst animiert – ohne zweiten
  // Übergang sofort die neue Seite zeigen, sonst blitzt die alte noch einmal auf
  const animate = ownBack;
  ownBack = false;
  if (animate) transition(emit);
  else flushSync(emit);
}

function subscribe(cb: () => void) {
  if (!bound) {
    bound = true;
    window.addEventListener('hashchange', onExternal);
    window.addEventListener('popstate', onExternal);
    // Einstieg: Tiefe merken (Tab-Seite oder direkt geöffnete Unterseite = ganz unten)
    if (typeof (window.history.state as HistState)?.d !== 'number') {
      window.history.replaceState({ ...(window.history.state ?? {}), d: 0 }, '', window.location.href);
    }
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
  // Tab-Seite: Verlauf bis zum Tab abbauen und ersetzen (kein Zurückwischen zwischen Tabs)
  if (TAB_ROOTS.includes(path)) {
    const d = depth();
    if (d > 0) {
      pendingRoot = path;
      window.history.go(-d);
      // Notbremse, falls der Browser nicht zurückspringt
      window.setTimeout(() => {
        if (pendingRoot !== path) return;
        pendingRoot = null;
        window.history.replaceState({ inApp: true, d: depth() }, '', urlFor(path));
        shown = current();
        show(true);
      }, 800);
      return;
    }
    window.history.replaceState({ inApp: true, d: 0 }, '', urlFor(path));
  } else if (opts.replace) {
    window.history.replaceState({ inApp: true, d: depth() }, '', urlFor(path));
  } else {
    window.history.pushState({ inApp: true, d: depth() + 1 }, '', urlFor(path));
  }
  shown = current();
  show(true);
}

/** Zurück innerhalb der App, sonst zur angegebenen Seite. */
export function goBack(fallback: string) {
  if (depth() > 0) {
    ownBack = true;
    window.history.back();
  } else navigate(fallback, { replace: true });
}
