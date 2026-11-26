let DICT: [string, string][] = [];

export type Lang = 'de' | 'en';

export const LANGS: [Lang, string][] = [
  ['de', 'Deutsch'],
  ['en', 'English'],
];

const STORE = 'gruppetto.lang';
const isLang = (v: unknown): v is Lang => v === 'de' || v === 'en';

function fromBrowser(): Lang {
  const list = typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [];
  for (const l of list) {
    const p = String(l || '').slice(0, 2).toLowerCase();
    if (isLang(p)) return p;
  }
  return 'en';
}

function detect(): Lang {
  if (typeof document === 'undefined') return 'de';
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (isLang(q)) {
      try {
        localStorage.setItem(STORE, q);
      } catch {
        /* no storage */
      }
      return q;
    }
  } catch {
    /* no location */
  }
  try {
    const s = localStorage.getItem(STORE);
    if (isLang(s)) return s;
  } catch {
    /* no storage */
  }
  return fromBrowser();
}

export const LANG: Lang = detect();
export const LOCALE = LANG === 'de' ? 'de-DE' : 'en-GB';
export const isEn = LANG === 'en';

export function setLang(l: Lang): void {
  try {
    localStorage.setItem(STORE, l);
  } catch {
    /* no storage */
  }
  try {
    const u = new URL(location.href);
    if (u.searchParams.has('lang')) {
      u.searchParams.delete('lang');
      history.replaceState(history.state, '', u.toString());
    }
  } catch {
    /* no history */
  }
}

/** Loads the dictionary (only needed when the interface is not German) */
export async function loadDict(): Promise<void> {
  if (LANG === 'de' || DICT.length) return;
  DICT = (await import('./i18n/dict')).DICT;
  exact = null;
  cache.clear();
}

interface Pattern {
  re: RegExp;
  out: string;
  order: string[];
  weight: number;
}

let exact: Map<string, string> | null = null;
let patterns: Pattern[] = [];
const cache = new Map<string, string>();
export const MISSES = new Set<string>();

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LETTERS = /[A-Za-zÄÖÜäöüß]{2}/;

function build(): Map<string, string> {
  const map = new Map<string, string>();
  const pats: Pattern[] = [];
  for (const [de, out] of DICT) {
    if (!out) continue;
    if (!/\{\d+\}/.test(de)) {
      if (out !== de) map.set(de, out);
      continue;
    }
    const literal = de.replace(/\{\d+\}/g, '');
    if (!LETTERS.test(literal)) continue;
    const order: string[] = [];
    const src = de
      .split(/(\{\d+\})/)
      .map((part) => {
        const m = /^\{(\d+)\}$/.exec(part);
        if (!m) return esc(part);
        order.push(m[1]);
        return '(.+?)';
      })
      .join('');
    pats.push({ re: new RegExp(`^${src}$`), out, order, weight: literal.length });
  }
  patterns = pats.sort((a, b) => b.weight - a.weight);
  return map;
}

const NAME = /^[A-ZÄÖÜÀ-ÝČŠŽŁ][\p{L}'’.-]*( [\p{L}'’.-]+){0,3}$/u;
const BREAK = /[.!?] [A-ZÄÖÜ]/;

function names(g: string): string | undefined {
  if (!g.includes(' und ')) return undefined;
  const list = g.split(/, | und /);
  return list.length > 1 && list.every((n) => NAME.test(n)) ? g.replace(/ und /g, ' and ') : undefined;
}

const part = (g: string) => names(g) ?? tr(g);

function lookup(core: string): string | undefined {
  if (!exact) exact = build();
  const hit = exact.get(core);
  if (hit !== undefined) return hit;
  for (const p of patterns) {
    const m = p.re.exec(core);
    if (!m) continue;
    if (m.slice(1).some((g) => BREAK.test(g) || g.includes(' · ') || !/[\p{L}\p{N}]/u.test(g))) continue;
    return p.out.replace(/\{(\d+)\}/g, (_, n: string) => {
      const g = m[p.order.indexOf(n) + 1] ?? '';
      return g.length < core.length ? part(g) : g;
    });
  }
  return undefined;
}

function split(s: string): [string, string, string] {
  const lead = /^\s*/.exec(s)![0];
  const rest = s.slice(lead.length);
  const tail = /\s*$/.exec(rest)![0];
  return [lead, rest.slice(0, rest.length - tail.length).replace(/\s+/g, ' '), tail];
}

const HEAD = /^([·•–—\-([„“"»«:,;/|+→←↑↓✓★▲▼×]+\s*)(.*)$/;
const TAIL = /^(.*?)(\s*[)\].,:;!?…“”"«»]+)$/;

function pieces(parts: string[], sep: string): string | undefined {
  let any = false;
  const out = parts.map((p) => {
    const t = p ? deep(p) : undefined;
    if (t !== undefined) any = true;
    return t ?? p;
  });
  return any ? out.join(sep) : undefined;
}

function deep(core: string): string | undefined {
  const res = lookup(core);
  if (res !== undefined) return res;
  const sentences: string[] = [];
  const re = /[.!?]\s+(?=[A-ZÄÖÜ0-9„"])/g;
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(core))) {
    sentences.push(core.slice(at, m.index + 1));
    at = m.index + m[0].length;
  }
  if (sentences.length) {
    sentences.push(core.slice(at));
    const t = pieces(sentences, ' ');
    if (t !== undefined) return t;
  }
  for (const sep of [' · ', ' – ', ' — ', ' | ', ' / ']) {
    if (core.includes(sep)) {
      const t = pieces(core.split(sep), sep);
      if (t !== undefined) return t;
    }
  }
  const h = HEAD.exec(core);
  if (h && h[2]) {
    const t = deep(h[2]);
    if (t !== undefined) return h[1] + t;
  }
  const t2 = TAIL.exec(core);
  if (t2 && t2[1]) {
    const t = deep(t2[1]);
    if (t !== undefined) return t + t2[2];
  }
  return names(core);
}

/** Translation of a German text, or undefined when the dictionary has none */
function find(s: string): string | undefined {
  if (LANG === 'de' || !s || !LETTERS.test(s)) return undefined;
  const hit = cache.get(s);
  if (hit !== undefined) return hit === s ? undefined : hit;
  const [lead, core, tail] = split(s);
  const res = deep(core);
  const full = res === undefined ? s : lead + res + tail;
  if (res === undefined && /[äöüß]|\b(der|die|das|und|nicht|mit|zum|zur|noch|nach|ist|du|dein|deine)\b/i.test(core)) MISSES.add(core);
  if (cache.size > 6000) cache.clear();
  cache.set(s, full);
  return res === undefined ? undefined : full;
}

/** Translates a German text; unknown texts stay as they are */
export function tr(s: string): string {
  return find(s) ?? s;
}

const ATTRS = ['aria-label', 'title', 'placeholder', 'alt', 'aria-description', 'aria-valuetext'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'NOSCRIPT']);

const src = new WeakMap<Text, string>();
const shown = new WeakMap<Text, string>();
const attrSrc = new WeakMap<Element, Map<string, [string, string]>>();

function skipped(e: Element | null): boolean {
  if (!e) return true;
  if (SKIP.has(e.tagName)) return true;
  return !!e.closest('[translate="no"],[contenteditable="true"]');
}

function source(n: Text): string {
  const cur = n.data;
  const was = shown.get(n);
  if (was !== undefined && was === cur) return src.get(n) ?? cur;
  src.set(n, cur);
  shown.delete(n);
  return cur;
}

function put(n: Text, v: string): void {
  shown.set(n, v);
  if (n.data !== v) n.data = v;
}

function runs(el: Element): void {
  if (skipped(el)) return;
  let run: Text[] = [];
  const flush = () => {
    if (!run.length) return;
    if (run.length === 1) {
      const n = run[0];
      const s = source(n);
      put(n, tr(s));
    } else {
      const srcs = run.map(source);
      const whole = find(srcs.join(''));
      if (whole !== undefined) {
        run.forEach((n, i) => put(n, i === 0 ? whole : ''));
      } else {
        run.forEach((n, i) => put(n, tr(srcs[i])));
      }
    }
    run = [];
  };
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) run.push(c as Text);
    else if (c.nodeType === 8) continue;
    else flush();
  }
  flush();
}

function attrs(e: Element): void {
  if (skipped(e)) return;
  for (const a of ATTRS) {
    const v = e.getAttribute(a);
    if (!v) continue;
    let m = attrSrc.get(e);
    const prev = m?.get(a);
    const german = prev && prev[1] === v ? prev[0] : v;
    const t = tr(german);
    if (!m) attrSrc.set(e, (m = new Map()));
    m.set(a, [german, t]);
    if (t !== v) e.setAttribute(a, t);
  }
}

function walk(root: Node, todo: Set<Element>): void {
  if (root.nodeType === 3) {
    if (root.parentElement) todo.add(root.parentElement);
    return;
  }
  if (root.nodeType !== 1 && root.nodeType !== 11) return;
  if (root.nodeType === 1) {
    const e = root as Element;
    if (SKIP.has(e.tagName) || e.getAttribute('translate') === 'no') return;
    attrs(e);
    todo.add(e);
  }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let n = w.nextNode();
  while (n) {
    const e = n as Element;
    if (SKIP.has(e.tagName) || e.getAttribute('translate') === 'no') {
      n = w.nextSibling() ?? nextOut(w);
      continue;
    }
    attrs(e);
    if (e.firstChild) todo.add(e);
    n = w.nextNode();
  }
}

function nextOut(w: TreeWalker): Node | null {
  while (w.parentNode()) {
    const s = w.nextSibling();
    if (s) return s;
  }
  return null;
}

function patchCanvas(): void {
  const protos = [typeof CanvasRenderingContext2D !== 'undefined' ? CanvasRenderingContext2D.prototype : null, typeof OffscreenCanvasRenderingContext2D !== 'undefined' ? OffscreenCanvasRenderingContext2D.prototype : null];
  for (const p of protos) {
    if (!p) continue;
    const proto = p as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const k of ['fillText', 'strokeText', 'measureText']) {
      const f = proto[k];
      if (typeof f !== 'function') continue;
      proto[k] = function (this: unknown, text: unknown, ...rest: unknown[]) {
        return f.call(this, typeof text === 'string' ? tr(text) : text, ...rest);
      };
    }
  }
}

function patchDialogs(): void {
  const w = window as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const k of ['alert', 'confirm', 'prompt']) {
    const f = w[k];
    if (typeof f !== 'function') continue;
    w[k] = function (msg?: unknown, ...rest: unknown[]) {
      return f.call(window, typeof msg === 'string' ? tr(msg) : msg, ...rest);
    };
  }
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (typeof nav.share === 'function') {
    const share = nav.share.bind(nav);
    nav.share = (d: ShareData) => share({ ...d, ...(d.title ? { title: tr(d.title) } : {}), ...(d.text ? { text: tr(d.text) } : {}) });
  }
  const cb = navigator.clipboard;
  if (cb && typeof cb.writeText === 'function') {
    const write = cb.writeText.bind(cb);
    try {
      cb.writeText = (t: string) => write(tr(t));
    } catch {
      /* read-only */
    }
  }
}

/** Translates the whole interface and everything added or changed later */
export function translateDom(): void {
  document.documentElement.lang = LANG;
  if (LANG === 'de') return;
  (window as unknown as { __i18n: unknown }).__i18n = { LANG, MISSES };
  patchCanvas();
  patchDialogs();
  const todo = new Set<Element>();
  const flush = () => {
    for (const e of todo) runs(e);
    todo.clear();
  };
  const title = document.querySelector('title');
  if (title) todo.add(title);
  if (document.body) walk(document.body, todo);
  flush();
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === 'characterData') {
        const p = (m.target as Text).parentElement;
        if (p) todo.add(p);
      } else if (m.type === 'attributes') attrs(m.target as Element);
      else {
        if (m.target.nodeType === 1) todo.add(m.target as Element);
        m.addedNodes.forEach((n) => walk(n, todo));
      }
    }
    flush();
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
