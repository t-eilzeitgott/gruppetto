// Meldungen sortieren: nur Profi-Radsport, Themen, gleiche Meldung bei mehreren Quellen bündeln, Wichtigkeit.
import { createHash } from 'node:crypto';
import { clip, type RawItem } from './parse.ts';

export type Lang = 'de' | 'en';
export type Topic = 'rennen' | 'transfer' | 'verletzung' | 'team';

export interface Feed {
  id: string;
  /** so steht die Quelle in der App */
  name: string;
  lang: Lang;
  url: string;
  /** nur Links, die hierzu passen (z. B. die Rennsport-Rubrik einer Seite mit Tests und Kaufberatung) */
  include?: RegExp;
}

/** die Quellen: deutschsprachige zuerst, dazu die großen internationalen */
export const FEEDS: Feed[] = [
  { id: 'radsport-news', name: 'Radsport-News', lang: 'de', url: 'https://www.radsport-news.com/rss.xml' },
  { id: 'sportschau', name: 'Sportschau', lang: 'de', url: 'https://www.sportschau.de/radsport/index~atom.xml' },
  { id: 'cyclingnews', name: 'Cyclingnews', lang: 'en', url: 'https://www.cyclingnews.com/feeds.xml', include: /cyclingnews\.com\/(pro-cycling|races|news)\// },
  { id: 'cyclingweekly', name: 'Cycling Weekly', lang: 'en', url: 'https://www.cyclingweekly.com/feeds.xml', include: /cyclingweekly\.com\/racing\// },
  { id: 'velo', name: 'Velo', lang: 'en', url: 'https://velo.outsideonline.com/feed/', include: /\/(road|road-racing|news)\// },
  { id: 'inrng', name: 'The Inner Ring', lang: 'en', url: 'https://feeds.feedburner.com/inrng/inrng0' },
  { id: 'escape', name: 'Escape Collective', lang: 'en', url: 'https://escapecollective.com/feed/' },
];

export interface NewsRow {
  id: string;
  source: string;
  lang: Lang;
  title: string;
  summary: string | null;
  url: string;
  published_at: string;
  topics: Topic[];
  cluster: string | null;
  sources: number;
  score: number;
}

/** Kleinbuchstaben ohne Akzente (Pogačar → pogacar) */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss').toLowerCase();
}

/** kein Profi-Rennsport: Tests, Angebote, Kaufberatung, Training, Technik für Hobbyfahrer */
const OFF = /\b(product review|tested|first ride|first look|deal|deals|sale|discount|black friday|cyber monday|buyer'?s? guide|best [a-z ]*(bikes?|wheels?|helmets?|shoes|lights|jerseys?|bib)|how to|workout|training plan|nutrition|recipe|kaufberatung|im test|test:|angebot|rabatt|gutschein|gewinnspiel|e-?bike|gravel bike|bikepacking|commut\w*|zwift|indoor trainer|smart trainer|podcast|quiz|crossword|horoscope|groupset|wheelset|tyres?|tires?|saddle|power meter|bike computer|frameset|unboxing|gear guide)\b/;

// (auf gefalteten Text: ohne Umlaute und Akzente)
const TOPIC_WORDS: Record<Topic, RegExp> = {
  transfer: /\b(wechsel\w*|vertrag\w*|verlanger\w*|unterschreib\w*|unterzeichn\w*|neuzugang|neuzugange|transfer\w*|signs?|signing|signed|contract|extension|extends|re-signs?|kader 20\d\d|roster)\b/,
  verletzung: /\b(sturz|sturze|gesturzt|verletz\w*|\w*bruch|gebrochen\w*|operation|operiert|krankenhaus|klinik|gehirnerschutterung|ausfall|fallt aus|crash\w*|injur\w*|fracture\w*|broken|surgery|hospital\w*|concussion|abandons?)\b/,
  rennen: /\b(etappe\w*|etappensieg|sieg|siegt|gewinnt|gewonnen|sprint\w*|zeitfahren|klassiker|rundfahrt|gesamtwertung|weltmeister\w*|wm|stage|wins?|won|victory|race|classic|gc|time trial|world championships?|worlds|olympi\w*|podium|results?|tour de france|giro|vuelta|roubaix|flandern|flanders|ronde|sanremo|lombard\w*|luttich|liege|strade bianche|amstel|wevelgem|dauphin\w*|tour de suisse|paris-nizza|paris-nice|tirreno|deutschland tour|cyclocross|querfeldein)\b/,
  team: /\b(team|teams|mannschaft|sponsor\w*|fusion|merger|lizenz|licen[cs]e|worldtour|pro ?team|teamchef|sportlicher leiter|directeur sportif|budget|ausrüster|kit|trikot)\b/,
};

/** die großen Namen der Szene (Nachnamen, gefaltet): eine Meldung über sie zählt mehr */
const STARS = [
  'pogacar', 'vingegaard', 'evenepoel', 'roglic', 'van der poel', 'van aert', 'pidcock', 'milan', 'philipsen', 'merlier', 'ayuso',
  'almeida', 'carapaz', 'lipowitz', 'kamna', 'politt', 'ackermann', 'buchmann', 'pedersen', 'girmay', 'kooij', 'skjelmose', 'del toro',
  'jorgenson', 'kuss', 'yates', "o'connor", 'vauquelin', 'tiberi', 'pellizzari', 'seixas', 'arensman', 'groves', 'healy', 'hindley',
  'bernal', 'alaphilippe', 'mohoric', 'bauhaus', 'steimle', 'zimmermann', 'kittel', 'degenkolb', 'martinez',
  'rodriguez', 'gall', 'onley', 'storer', 'landa', 'jakobsen', 'magnier', 'wout', 'mathieu', 'remco', 'tadej', 'jonas',
];
const RACES = [
  'tour de france', 'giro', 'vuelta', 'roubaix', 'flandern', 'flanders', 'ronde', 'sanremo', 'lombard', 'luttich', 'liege', 'weltmeister',
  'world championship', 'worlds', 'olympi', 'strade bianche', 'amstel', 'dauphin', 'tour de suisse', 'paris-nizza', 'paris-nice',
  'tirreno', 'deutschland tour', 'wm', 'em',
];
const TEAMS = [
  'uae', 'visma', 'soudal', 'quick-step', 'ineos', 'red bull', 'bora', 'lidl-trek', 'alpecin', 'decathlon', 'movistar', 'ef education',
  'jayco', 'bahrain', 'intermarche', 'groupama', 'cofidis', 'astana', 'xds', 'picnic', 'postnl', 'tudor', 'uno-x', 'q36.5', 'lotto',
  'arkea', 'totalenergies', 'israel', 'nsn',
];

const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** ganzes Wort (Namen) – Rennen auch als Wortanfang (Lombard → Lombardei, Lombardia) */
const has = (hay: string, word: string, stem = false) => new RegExp(`(^|[^a-z])${esc(word)}${stem ? '' : '($|[^a-z])'}`).test(hay);

/** Namen und Rennen in einer Überschrift (für das Bündeln über Sprachgrenzen hinweg) */
export function keys(title: string): string[] {
  const t = fold(title);
  const first: Record<string, string> = { wout: 'van aert', mathieu: 'van der poel', remco: 'evenepoel', tadej: 'pogacar', jonas: 'vingegaard' };
  const hit = [
    ...STARS.filter((w) => has(t, w)).map((w) => first[w] ?? w),
    ...RACES.filter((w) => has(t, w, w.length >= 5)),
    ...TEAMS.filter((w) => w.length > 2 && has(t, w)),
  ];
  return [...new Set(hit)];
}

const STOP = new Set(('der die das und oder aber mit von vom zum zur für auf aus bei nach über unter vor ein eine einen einem einer ist sind war hat '
  + 'wird werden nicht noch auch nur schon wie als bis dem den des sich sein seine ihr ihre im in an am es er sie man '
  + 'the a an and or but with from for on of at by after over under before is are was has have will be not also just as to in his her '
  + 'their its it he she they this that new says said')
  .split(' '));

/** Inhaltswörter einer Überschrift (für das Bündeln in derselben Sprache) */
export function words(title: string): Set<string> {
  return new Set(fold(title).replace(/['’‘`]/g, '').replace(/[^a-z0-9 -]/g, ' ').split(/[\s-]+/).filter((w) => w.length >= 4 && !STOP.has(w)));
}

export function topics(title: string, summary: string): Topic[] {
  const t = fold(`${title} ${summary.slice(0, 200)}`);
  return (Object.keys(TOPIC_WORDS) as Topic[]).filter((k) => TOPIC_WORDS[k].test(t));
}

/** gehört die Meldung zum Profi-Radsport (und zu dieser Quelle)? */
export function wanted(feed: Feed, item: RawItem): boolean {
  if (feed.include && !feed.include.test(item.url)) return false;
  return !OFF.test(fold(`${item.title} ${item.categories.join(' ')} ${item.url}`));
}

/** Wichtigkeit ohne Zeit (die App rechnet das Alter dazu): Stars, große Rennen, Thema, mehrere Quellen */
export function importance(title: string, tps: Topic[], sources: number, lang: Lang): number {
  const k = keys(title);
  const stars = new Set(k.filter((w) => STARS.includes(w))).size;
  const races = k.some((w) => RACES.includes(w)) ? 1 : 0;
  let s = 1 + Math.min(2, stars) * 0.35 + races * 0.3;
  if (tps.includes('transfer')) s += 0.15;
  if (tps.includes('verletzung')) s += 0.2;
  s += Math.min(3, sources - 1) * 0.6;
  // die Runde liest Deutsch: deutschsprachige Meldungen etwas vorn
  if (lang === 'de') s += 0.3;
  return Math.round(s * 100) / 100;
}

export const idOf = (url: string) => createHash('sha1').update(url.replace(/[?#].*$/, '').replace(/\/+$/, '')).digest('hex').slice(0, 16);

export interface Scored { feed: Feed; item: RawItem }

const WIN = /\b(gewinnt|gewonnen|siegt|sieg|holt|triumph\w*|wins|won|victory|takes)\b/;

/**
 * Meldungen bündeln: je Meldung (älteste zuerst) das erste Bündel suchen, zu dessen erster Meldung sie passt –
 * keine Ketten über Zwischenschritte (sonst landen alle Meldungen über denselben Star in einem Bündel).
 * Passt: andere Quelle, höchstens 24 h auseinander und
 *  - gleiche Sprache: mindestens drei gleiche Inhaltswörter, gut die Hälfte der kürzeren Überschrift, oder
 *  - über die Sprache hinweg: derselbe Star und dazu ein weiterer Name, ein Rennen oder ein Team, dieselbe Art
 *    (Verletzung, Transfer, Sieg in demselben Rennen – „Rennen“ allein ist zu allgemein) oder drei gemeinsame
 *    Namen/Rennen/Teams
 */
export function cluster(list: { id: string; source: string; title: string; published: Date; lang?: Lang }[]): Map<string, string> {
  const items = [...list].sort((a, b) => a.published.getTime() - b.published.getTime()).map((x) => ({
    ...x, k: new Set(keys(x.title)), w: words(x.title),
    // Art der Meldung (über die Sprache hinweg vergleichbar): Verletzung, Transfer oder Sieg
    t: [...topics(x.title, '').filter((t) => t === 'verletzung' || t === 'transfer'), ...(WIN.test(fold(x.title)) ? ['sieg'] : [])],
  }));
  type It = (typeof items)[number];
  const match = (a: It, b: It) => {
    if (a.source === b.source) return false;
    if (Math.abs(a.published.getTime() - b.published.getTime()) > 24 * 3600e3) return false;
    const sw = [...a.w].filter((x) => b.w.has(x));
    if ((a.lang ?? 'de') === (b.lang ?? 'de') && sw.length >= 3 && sw.length / Math.min(a.w.size, b.w.size) >= 0.5) return true;
    const sk = [...a.k].filter((x) => b.k.has(x));
    if (sk.length >= 3) return true;
    const star = sk.some((x) => STARS.includes(x));
    return star && sk.length >= 2 && a.t.some((t) => b.t.includes(t)) && (!a.t.includes('sieg') || sk.some((x) => RACES.includes(x)));
  };
  const roots: It[] = [];
  const out = new Map<string, string>();
  for (const it of items) {
    const r = roots.find((x) => match(x, it));
    if (r) out.set(it.id, r.id);
    else { roots.push(it); out.set(it.id, it.id); }
  }
  return out;
}

/** aus den Feeds die Zeilen für die Datenbank (prior: schon gespeicherte der letzten Tage – für das Bündeln) */
export function build(items: Scored[], prior: { id: string; source: string; title: string; published_at: string; lang?: Lang }[], now = new Date()): NewsRow[] {
  const seen = new Set<string>();
  const fresh: { id: string; feed: Feed; item: RawItem }[] = [];
  for (const { feed, item } of items) {
    const id = idOf(item.url);
    if (seen.has(id)) continue;
    seen.add(id);
    fresh.push({ id, feed, item });
  }
  const all = [
    ...fresh.map((f) => ({ id: f.id, source: f.feed.name, title: f.item.title, published: f.item.published, lang: f.feed.lang })),
    ...prior.filter((p) => !seen.has(p.id)).map((p) => ({ id: p.id, source: p.source, title: p.title, published: new Date(p.published_at), lang: p.lang })),
  ];
  const cl = cluster(all);
  const size = new Map<string, Set<string>>();
  for (const x of all) {
    const c = cl.get(x.id)!;
    if (!size.has(c)) size.set(c, new Set());
    size.get(c)!.add(x.source);
  }
  return fresh.map(({ id, feed, item }) => {
    const c = cl.get(id)!;
    const sources = size.get(c)!.size;
    const tps = topics(item.title, item.summary);
    // Zeitstempel aus der Zukunft (falsche Zeitzone im Feed): jetzt
    const pub = item.published.getTime() > now.getTime() + 3600e3 ? now : item.published;
    return {
      id,
      source: feed.name,
      lang: feed.lang,
      title: clip(item.title, 300),
      summary: item.summary ? clip(item.summary, 280) : null,
      url: item.url,
      published_at: pub.toISOString(),
      topics: tps,
      cluster: sources > 1 ? c : null,
      sources,
      score: importance(item.title, tps, sources, feed.lang),
    };
  });
}
