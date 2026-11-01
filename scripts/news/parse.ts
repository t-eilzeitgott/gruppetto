// Feeds lesen (RSS 2.0 und Atom) ohne Abhängigkeiten: Überschrift, Link, Anriss, Datum, Kategorien.
// Bewusst schlicht – die Feeds der Radsport-Medien sind wohlgeformt; was nicht passt, wird übersprungen.

export interface RawItem {
  title: string;
  url: string;
  summary: string;
  published: Date;
  categories: string[];
}

const ENT: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
  bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', sbquo: '‚', euro: '€', shy: '',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à',
  iacute: 'í', oacute: 'ó', uacute: 'ú', ccedil: 'ç', ntilde: 'ñ', ecirc: 'ê', ocirc: 'ô', ucirc: 'û', icirc: 'î', acirc: 'â',
  Eacute: 'É', scaron: 'š', Scaron: 'Š', ccaron: 'č', Ccaron: 'Č', zcaron: 'ž', Zcaron: 'Ž', oslash: 'ø', Oslash: 'Ø', aring: 'å', Aring: 'Å',
};

/** HTML-Entitäten auflösen (&amp; &#228; &#xE4; &auml; …) */
export function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENT[e] ?? ENT[e.toLowerCase()] ?? m;
  });
}

/** Inhalt eines Elements: CDATA auspacken, Entitäten auflösen */
function text(raw: string | undefined): string {
  if (!raw) return '';
  const cdata = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c: string) => c);
  return decode(cdata).trim();
}

/** HTML zu Fließtext: Tags weg, Leerraum zusammen, typische Anhänge von Blog-Systemen weg */
export function plain(html: string): string {
  return decode(
    html
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c: string) => c)
      .replace(/<(script|style|figure|figcaption)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/p>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/The post .*? appeared first on .*?\.?$/i, '')
    .replace(/\s*(\[(…|\.\.\.)\]|Weiterlesen|Read more|Continue reading)\s*.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** höchstens n Zeichen, an einer Wortgrenze, mit … */
export function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const i = cut.lastIndexOf(' ');
  return `${(i > n * 0.6 ? cut.slice(0, i) : cut).replace(/[\s,;:–—-]+$/, '')}…`;
}

function tag(block: string, name: string): string | undefined {
  // <name …>inhalt</name> – auch mit Namensraum-Präfix (dc:date, content:encoded)
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  return re.exec(block)?.[1];
}

function tags(block: string, name: string): string[] {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi');
  const out: string[] = [];
  for (let m = re.exec(block); m; m = re.exec(block)) out.push(m[1]);
  return out;
}

function date(s: string): Date | null {
  const t = text(s);
  if (!t) return null;
  const d = new Date(t);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** RSS 2.0 (<item>) oder Atom (<entry>) – Einträge ohne Überschrift, Link oder Datum fallen weg */
export function parseFeed(xml: string): RawItem[] {
  const out: RawItem[] = [];
  const atom = !/<item[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  const blocks = atom ? tags(xml, 'entry') : tags(xml, 'item');
  for (const b of blocks) {
    const title = plain(text(tag(b, 'title')));
    let url = '';
    if (atom) {
      // <link rel="alternate" href="…"/> bevorzugt, sonst der erste Link
      const links = [...b.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
      const alt = links.find((l) => /rel=["']alternate["']/i.test(l)) ?? links.find((l) => !/rel=/i.test(l)) ?? links[0];
      url = decode(/href=["']([^"']+)["']/i.exec(alt ?? '')?.[1] ?? '').trim();
    } else {
      url = text(tag(b, 'link'));
      if (!url) url = text(tag(b, 'guid'));
    }
    const summaryRaw = atom ? tag(b, 'summary') ?? tag(b, 'content') : tag(b, 'description') ?? tag(b, 'content:encoded');
    const summary = plain(summaryRaw ?? '');
    const published = date(tag(b, atom ? 'published' : 'pubDate') ?? tag(b, 'updated') ?? tag(b, 'dc:date') ?? '');
    const categories = atom
      ? [...b.matchAll(/<category\b[^>]*term=["']([^"']+)["']/gi)].map((m) => decode(m[1]))
      : tags(b, 'category').map((c) => plain(text(c)));
    if (!title || !/^https?:\/\//.test(url) || !published) continue;
    out.push({ title, url, summary, published, categories });
  }
  return out;
}
