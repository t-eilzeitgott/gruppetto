import { useSyncExternalStore } from 'react';

const NAV_EVENT = 'gruppetto:nav';

function current(): string {
  const raw = window.location.hash.replace(/^#/, '');
  return raw.startsWith('/') ? raw : '/';
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  window.addEventListener('popstate', cb);
  window.addEventListener(NAV_EVENT, cb);
  return () => {
    window.removeEventListener('hashchange', cb);
    window.removeEventListener('popstate', cb);
    window.removeEventListener(NAV_EVENT, cb);
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
  window.dispatchEvent(new Event(NAV_EVENT));
  window.scrollTo(0, 0);
}

/** Zurück innerhalb der App, sonst zur angegebenen Seite. */
export function goBack(fallback: string) {
  const state = window.history.state as { inApp?: boolean } | null;
  if (state?.inApp) window.history.back();
  else navigate(fallback, { replace: true });
}
