// Kleiner, fehlertoleranter HTML-Parser ohne Zusatzpakete – genug für die Ergebnisseiten
// von procyclingstats.com. Baut einen Baum aus Elementen und Text und kann einfache
// CSS-Selektoren auswerten (Tag, .klasse, [attr], [attr=wert], Nachfahre „ “ und Kind „>“).

export interface El {
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
  parent: El | null;
}
export type Node = El | string;

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);
/** Elemente, die ein offenes gleichnamiges Element automatisch schließen (z. B. <li> nach <li>). */
const AUTO_CLOSE: Record<string, string[]> = {
  li: ['li'],
  tr: ['tr', 'td', 'th'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  option: ['option'],
  p: ['p'],
};
const SCOPE = new Set(['table', 'ul', 'ol', 'select', 'div', 'body']);

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsaquo: '›', lsaquo: '‹',
  raquo: '»', laquo: '«', middot: '·', ndash: '–', mdash: '—', prime: '′', Prime: '″', hellip: '…',
};

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED[code] ?? m;
  });
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

export function parseHtml(html: string): El {
  const root: El = { tag: '#root', attrs: {}, children: [], parent: null };
  const stack: El[] = [root];
  const top = () => stack[stack.length - 1];
  let i = 0;
  const len = html.length;

  const closeTo = (index: number) => {
    stack.length = index;
  };

  while (i < len) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      top().children.push(decodeEntities(html.slice(i)));
      break;
    }
    if (lt > i) top().children.push(decodeEntities(html.slice(i, lt)));

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt);
      i = end === -1 ? len : end + 1;
      continue;
    }

    const isEnd = html[lt + 1] === '/';
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(html.slice(lt + (isEnd ? 2 : 1), lt + 40));
    if (!nameMatch) {
      top().children.push('<');
      i = lt + 1;
      continue;
    }
    const tag = nameMatch[0].toLowerCase();
    // Ende des Tags finden (Anführungszeichen in Attributen beachten)
    let j = lt + 1 + (isEnd ? 1 : 0) + tag.length;
    let quote: string | null = null;
    while (j < len) {
      const c = html[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
      j += 1;
    }
    const inner = html.slice(lt + 1 + (isEnd ? 1 : 0) + tag.length, j);
    i = j + 1;

    if (isEnd) {
      // nächstes offenes Element mit diesem Namen schließen, sonst das End-Tag ignorieren
      for (let k = stack.length - 1; k > 0; k -= 1) {
        if (stack[k].tag === tag) {
          closeTo(k);
          break;
        }
      }
      continue;
    }

    const closes = AUTO_CLOSE[tag];
    if (closes) {
      for (let k = stack.length - 1; k > 0; k -= 1) {
        if (closes.includes(stack[k].tag)) {
          closeTo(k);
          break;
        }
        if (SCOPE.has(stack[k].tag)) break;
      }
    }

    const el: El = { tag, attrs: parseAttrs(inner), children: [], parent: top() };
    top().children.push(el);
    if (VOID.has(tag) || inner.trimEnd().endsWith('/')) continue;

    if (RAW.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, i);
      const stop = end === -1 ? len : end;
      if (tag === 'title' || tag === 'textarea') el.children.push(decodeEntities(html.slice(i, stop)));
      const close = end === -1 ? len : html.indexOf('>', end);
      i = close === -1 ? len : close + 1;
      continue;
    }
    stack.push(el);
  }
  return root;
}

// ---------------------------------------------------------------------
// Abfragen
// ---------------------------------------------------------------------

export const isEl = (n: Node): n is El => typeof n !== 'string';

export function hasClass(el: El, cls: string): boolean {
  const c = el.attrs.class;
  return !!c && c.split(/\s+/).includes(cls);
}

/** Textinhalt mit zusammengefassten Leerzeichen. */
export function text(node: Node | null | undefined): string {
  if (!node) return '';
  return rawText(node).replace(/[\s ]+/g, ' ').trim();
}

function rawText(node: Node): string {
  if (typeof node === 'string') return node;
  let s = '';
  for (const c of node.children) s += rawText(c);
  return s;
}

export function childElements(el: El): El[] {
  return el.children.filter(isEl);
}

interface Compound {
  tag: string | null;
  classes: string[];
  attrs: { name: string; value: string | null; op: '=' | '^=' | '*=' | null }[];
}
interface Step {
  combinator: ' ' | '>';
  compound: Compound;
}

const selectorCache = new Map<string, Step[][]>();

function parseSelector(sel: string): Step[][] {
  const cached = selectorCache.get(sel);
  if (cached) return cached;
  const groups = sel.split(',').map((part) => {
    const tokens = part.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean);
    const steps: Step[] = [];
    let combinator: ' ' | '>' = ' ';
    for (const tok of tokens) {
      if (tok === '>') {
        combinator = '>';
        continue;
      }
      const compound: Compound = { tag: null, classes: [], attrs: [] };
      const re = /^([a-zA-Z0-9*-]+)|\.([\w-]+)|\[([\w-]+)(?:(\^=|\*=|=)"?([^"\]]*)"?)?\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(tok))) {
        if (m[0] === '') break;
        if (m[1]) compound.tag = m[1] === '*' ? null : m[1].toLowerCase();
        else if (m[2]) compound.classes.push(m[2]);
        else if (m[3]) compound.attrs.push({ name: m[3].toLowerCase(), value: m[5] ?? null, op: (m[4] as Compound['attrs'][number]['op']) ?? null });
      }
      steps.push({ combinator, compound });
      combinator = ' ';
    }
    return steps;
  });
  selectorCache.set(sel, groups);
  return groups;
}

function matchesCompound(el: El, c: Compound): boolean {
  if (c.tag && el.tag !== c.tag) return false;
  for (const cls of c.classes) if (!hasClass(el, cls)) return false;
  for (const a of c.attrs) {
    const v = el.attrs[a.name];
    if (v === undefined) return false;
    if (a.op === '=' && v !== a.value) return false;
    if (a.op === '^=' && !v.startsWith(a.value ?? '')) return false;
    if (a.op === '*=' && !v.includes(a.value ?? '')) return false;
  }
  return true;
}

function matchesSteps(el: El, steps: Step[], scope: El): boolean {
  let idx = steps.length - 1;
  if (!matchesCompound(el, steps[idx].compound)) return false;
  let current: El | null = el;
  while (idx > 0) {
    const comb = steps[idx].combinator;
    idx -= 1;
    const want = steps[idx].compound;
    if (comb === '>') {
      current = current.parent;
      if (!current || current === scope.parent || !matchesCompound(current, want)) return false;
    } else {
      let p: El | null = current.parent;
      while (p && p !== scope.parent && !matchesCompound(p, want)) p = p.parent;
      if (!p || p === scope.parent) return false;
      current = p;
    }
    if (current === scope && idx > 0) return false;
  }
  return true;
}

/** Alle Nachfahren von `root`, auf die der Selektor passt (in Dokumentreihenfolge). */
export function selectAll(root: El, selector: string): El[] {
  const groups = parseSelector(selector);
  const out: El[] = [];
  const walk = (el: El) => {
    for (const c of el.children) {
      if (typeof c === 'string') continue;
      if (groups.some((steps) => matchesSteps(c, steps, root))) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

export function select(root: El, selector: string): El | null {
  return selectAll(root, selector)[0] ?? null;
}

/** Nächster Vorfahr (inklusive selbst), auf den das Prädikat passt. */
export function closest(el: El | null, pred: (e: El) => boolean): El | null {
  let p = el;
  while (p && !pred(p)) p = p.parent;
  return p;
}
