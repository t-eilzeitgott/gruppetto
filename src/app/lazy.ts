/**
 * Seite erst bei Bedarf laden, aber vorab holbar: Ist das Modul schon da (preload), wird die Seite sofort
 * gezeigt – ohne den kurzen Umweg über den Platzhalter, den React.lazy sonst auch bei geladenen Modulen nimmt.
 */
import { createElement, lazy, type ComponentType } from 'react';

export type LazyPage<P extends object> = ComponentType<P> & { preload: () => Promise<unknown> };

export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>): LazyPage<P> {
  let mod: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const get = () => (pending ??= load().then((m) => (mod = m)).catch((e) => { pending = null; throw e; }));
  const Lazy = lazy(() => get().then((m) => ({ default: m })));
  const Page = ((props: P) => createElement(mod ?? Lazy, props)) as LazyPage<P>;
  Page.preload = get;
  return Page;
}
