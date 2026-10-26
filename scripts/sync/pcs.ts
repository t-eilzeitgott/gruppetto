// Etappenseiten von procyclingstats.com abrufen und auslesen.
// Aufbau der Seite (Stand 2026): Reiter „STAGE / GC / POINTS / KOM / YOUTH / TEAMS“ (ul.resultTabs),
// je Reiter ein div.resTab[data-id] mit der Wertung in div.general > table.results,
// Spalten über th[data-code] (rnk, bib, ridername, teamnamelink, time …), Infos in ul.keyvalueList.
import { childElements, parseHtml, select, selectAll, text, type El } from './html.ts';

export const PCS_BASE = 'https://www.procyclingstats.com';

export type PcsTable = 'stage' | 'gc' | 'points' | 'kom' | 'youth' | 'teams';
export type PcsStatus = 'DF' | 'DNF' | 'DNS' | 'OTL' | 'DSQ' | 'DNQ' | 'NR' | string;

export interface PcsRow {
  /** Platz laut PCS (null bei DNF/DNS …) */
  rank: number | null;
  status: PcsStatus;
  /** durchgestrichen (z. B. nachträglich disqualifiziert) */
  removed: boolean;
  bib: number | null;
  /** „Vorname Nachname“ */
  name: string;
  /** z. B. 'tadej-pogacar' aus rider/tadej-pogacar */
  slug: string | null;
  team: string | null;
  /** Zeit bzw. Rückstand wie angezeigt (nur Platz 1 ist eine absolute Zeit) */
  time: string | null;
}

export interface PcsTeamRow {
  rank: number | null;
  team: string;
  slug: string | null;
}

export interface PcsStage {
  title: string;
  /** 'RR' Straßenrennen, 'ITT' Einzelzeitfahren, 'TTT' Mannschaftszeitfahren */
  type: 'RR' | 'ITT' | 'TTT';
  /** YYYY-MM-DD */
  date: string | null;
  /** Startzeit „HH:MM“ (mitteleuropäische Zeit, wenn PCS sie angibt) */
  startTime: string | null;
  distanceKm: number | null;
  departure: string | null;
  arrival: string | null;
  /** Profil-Symbol p0–p5 (p1 flach … p5 Bergankunft) */
  profile: string | null;
  /** „Won how“, z. B. „Sprint of large group“ – ist nur nach der Zielankunft gesetzt */
  wonHow: string | null;
  stage: PcsRow[];
  gc: PcsRow[];
  points: PcsRow[];
  kom: PcsRow[];
  youth: PcsRow[];
  teams: PcsTeamRow[];
  /** gefundene Reiter (z. B. ['stage','gc',…]) – hilft bei der Fehlersuche */
  tabs: PcsTable[];
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const TAB_NAMES: [PcsTable, RegExp][] = [
  ['stage', /^STAGE|^RESULT/],
  ['gc', /^GC/],
  ['points', /^POINTS/],
  ['kom', /^KOM|^MOUNTAIN/],
  ['youth', /^YOUTH|^YOUNG/],
  ['teams', /^TEAMS?/],
];

export function parseDate(value: string): string | null {
  const m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(value);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** „13:05 (12:05 CET)“ → „12:05“, „16:45“ → „16:45“ */
export function parseStartTime(value: string): string | null {
  const cet = /(\d{1,2}):(\d{2})\s*(?:CET|CEST)/i.exec(value);
  const m = cet ?? /(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/** „4:12:31“ / „58:12“ → Sekunden */
export function parseDuration(value: string | null): number | null {
  if (!value) return null;
  const m = /(?:(\d+):)?(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function infoList(doc: El): Map<string, El> {
  const map = new Map<string, El>();
  for (const li of selectAll(doc, 'ul.keyvalueList li')) {
    const divs = childElements(li).filter((e) => e.tag === 'div');
    if (divs.length < 2) continue;
    const label = text(divs[0]).replace(/:\s*$/, '').toLowerCase();
    if (label) map.set(label, divs[1]);
  }
  return map;
}

function columnIndex(table: El): Map<string, number> {
  const map = new Map<string, number>();
  const ths = selectAll(table, 'thead th');
  ths.forEach((th, i) => {
    const code = th.attrs['data-code'] || text(th).toLowerCase();
    if (code && !map.has(code)) map.set(code, i);
  });
  return map;
}

function riderFromCell(cell: El | undefined): { name: string; slug: string | null } | null {
  if (!cell) return null;
  const a = select(cell, 'a[href^="rider/"]');
  if (!a) return null;
  const slug = a.attrs.href.replace(/^rider\//, '').replace(/\/.*$/, '') || null;
  const lastEl = select(a, 'span.uppercase');
  const full = text(a);
  let name = full;
  if (lastEl) {
    const last = text(lastEl);
    const first = full.slice(full.indexOf(last) + last.length).trim() || full.replace(last, '').trim();
    name = [first, last].filter(Boolean).join(' ');
  }
  return { name, slug };
}

function parseRiderTable(table: El | null): PcsRow[] {
  if (!table) return [];
  const cols = columnIndex(table);
  const idx = (code: string, fallback: number | null) => cols.get(code) ?? fallback;
  const rows: PcsRow[] = [];
  const body = select(table, 'tbody') ?? table;
  for (const tr of childElements(body).filter((e) => e.tag === 'tr')) {
    const cells = childElements(tr).filter((e) => e.tag === 'td');
    if (cells.length < 3) continue; // z. B. „relegated from …“
    const rankCell = cells[idx('rnk', 0) ?? 0];
    const removed = !!rankCell && !!select(rankCell, 's');
    const rankText = text(rankCell).toUpperCase();
    const rank = /^\d+$/.test(rankText) && !removed ? Number(rankText) : null;
    const status: PcsStatus = /^\d+$/.test(rankText) ? (removed ? 'DSQ' : 'DF') : rankText || 'DF';
    let riderCell = cells[idx('ridername', -1) ?? -1];
    if (!riderCell || !select(riderCell, 'a[href^="rider/"]')) riderCell = cells.find((c) => !!select(c, 'a[href^="rider/"]')) as El;
    const rider = riderFromCell(riderCell);
    if (!rider) continue;
    const bibCell = cells[idx('bib', -1) ?? -1];
    const bibText = text(bibCell);
    const teamCell = cells[idx('teamnamelink', -1) ?? -1] ?? cells.find((c) => !!select(c, 'a[href^="team/"]'));
    const teamA = teamCell ? select(teamCell, 'a[href^="team/"]') : null;
    const timeCell = cells[idx('time', -1) ?? -1];
    const timeFirst = timeCell ? childElements(timeCell)[0] : undefined;
    rows.push({
      rank,
      status,
      removed,
      bib: /^\d+$/.test(bibText) ? Number(bibText) : null,
      name: rider.name,
      slug: rider.slug,
      team: teamA ? text(teamA) : null,
      time: timeCell ? text(timeFirst ?? timeCell) || null : null,
    });
  }
  return rows;
}

function parseTeamTable(table: El | null): PcsTeamRow[] {
  if (!table) return [];
  const rows: PcsTeamRow[] = [];
  const body = select(table, 'tbody') ?? table;
  for (const tr of childElements(body).filter((e) => e.tag === 'tr')) {
    const cells = childElements(tr).filter((e) => e.tag === 'td');
    const a = select(tr, 'a[href^="team/"]');
    if (!a || !cells.length) continue;
    const rankText = text(cells[0]);
    rows.push({
      rank: /^\d+$/.test(rankText) ? Number(rankText) : null,
      team: text(a),
      slug: a.attrs.href.replace(/^team\//, '') || null,
    });
  }
  return rows;
}

/** Wertungstabelle eines Reiters (div.resTab) – die Gesamtwertung steht in div.general. */
function tabTable(tab: El): El | null {
  return select(tab, 'div.general table.results') ?? select(tab, 'table.results');
}

export function parseStagePage(html: string): PcsStage {
  const doc = parseHtml(html);
  const title = text(select(doc, 'title'));
  const heading = text(select(doc, '.page-title'));
  const info = infoList(doc);
  const val = (label: string) => {
    const el = info.get(label);
    const v = el ? text(el) : '';
    return v || null;
  };

  const tables: Partial<Record<PcsTable, El | null>> = {};
  const tabs: PcsTable[] = [];
  const tabLinks = selectAll(doc, 'ul.resultTabs li a, ul.restabs li a');
  for (const a of tabLinks) {
    const label = text(a).toUpperCase();
    const entry = TAB_NAMES.find(([, re]) => re.test(label));
    const id = a.attrs['data-id'];
    if (!entry || !id || tables[entry[0]] !== undefined) continue;
    const tab = select(doc, `div.resTab[data-id="${id}"]`);
    if (!tab) continue;
    tables[entry[0]] = tab;
    tabs.push(entry[0]);
  }
  // Ältere oder einfache Seiten ohne Reiter: erste Ergebnistabelle ist das Etappenergebnis
  if (!tables.stage) {
    const first = select(doc, 'div.resTab') ?? select(doc, '.resultCont') ?? null;
    if (first) {
      tables.stage = first;
      tabs.unshift('stage');
    }
  }

  const stageTab = tables.stage ?? null;
  const isTtt = /\bTTT\b/.test(heading) || (!!stageTab && !!select(stageTab, '.ttt-results'));
  const type: PcsStage['type'] = isTtt ? 'TTT' : /\bITT\b/.test(heading) ? 'ITT' : 'RR';

  const profileEl = select(doc, 'ul.keyvalueList span.icon.profile') ?? select(doc, 'span.icon.profile');
  const profile = profileEl ? (profileEl.attrs.class.split(/\s+/).find((c) => /^p\d$/.test(c)) ?? null) : null;
  const distance = val('distance');
  const km = distance ? Number.parseFloat(distance.replace(',', '.')) : NaN;
  const riderTable = (t: PcsTable) => {
    const tab = tables[t];
    if (!tab) return [];
    if (t === 'stage' && isTtt) return [];
    return parseRiderTable(tabTable(tab));
  };

  return {
    title,
    type,
    date: parseDate(val('date') ?? ''),
    startTime: parseStartTime(val('start time') ?? ''),
    distanceKm: Number.isFinite(km) && km > 0 ? km : null,
    departure: val('departure'),
    arrival: val('arrival'),
    profile,
    wonHow: val('won how'),
    stage: riderTable('stage'),
    gc: riderTable('gc'),
    points: riderTable('points'),
    kom: riderTable('kom'),
    youth: riderTable('youth'),
    teams: tables.teams ? parseTeamTable(tabTable(tables.teams)) : [],
    tabs,
  };
}

/** Pfad der Etappenseite, z. B. race/giro-d-italia/2027/stage-7 (Prolog über stage.info.pcs_path). */
export function stagePath(slug: string, number: number, override?: string | null): string {
  const clean = slug.replace(/^\/+|\/+$/g, '').replace(/^race\//, '');
  return `race/${clean}/${override ? override.replace(/^\/+/, '') : `stage-${number}`}`;
}

export class PcsError extends Error {
  readonly status: number | null;
  readonly blocked: boolean;
  constructor(message: string, status: number | null, blocked: boolean) {
    super(message);
    this.status = status;
    this.blocked = blocked;
  }
}

export interface FetchOptions {
  retries?: number;
  timeoutMs?: number;
  /** Wartezeit vor der n-ten Wiederholung: n × retryDelayMs */
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

/** Lädt eine PCS-Seite (mit Browser-Kennung, Wiederholung bei Netzfehlern). */
export async function fetchPcsPage(path: string, opts: FetchOptions = {}): Promise<string> {
  const url = /^https?:/.test(path) ? path : `${PCS_BASE}/${path.replace(/^\/+/, '')}`;
  const retries = opts.retries ?? 2;
  const doFetch = opts.fetchImpl ?? fetch;
  let last: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt) await new Promise((r) => setTimeout(r, (opts.retryDelayMs ?? 2000) * attempt));
    try {
      const res = await doFetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-GB,en;q=0.9,de;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 25000),
      });
      const body = await res.text();
      const challenge = res.headers.get('cf-mitigated') === 'challenge' || /<title>\s*Just a moment/i.test(body);
      if (challenge || res.status === 403 || res.status === 429) {
        throw new PcsError(`procyclingstats.com blockiert den Abruf (HTTP ${res.status}${challenge ? ', Cloudflare-Prüfung' : ''})`, res.status, true);
      }
      if (res.status === 404) throw new PcsError(`Seite nicht gefunden: ${url}`, 404, false);
      if (!res.ok) throw new PcsError(`procyclingstats.com antwortet mit HTTP ${res.status}`, res.status, false);
      return body;
    } catch (err) {
      last = err;
      if (err instanceof PcsError && (err.blocked || err.status === 404)) throw err;
    }
  }
  if (last instanceof PcsError) throw last;
  // fetch() meldet nur „fetch failed“ – der eigentliche Grund steckt in cause (z. B. ECONNRESET, Zeitüberschreitung)
  const cause = last instanceof Error && last.cause instanceof Error
    ? ` (${(last.cause as Error & { code?: string }).code ?? last.cause.message})`
    : '';
  const reason = last instanceof Error ? (last.name === 'TimeoutError' ? 'Zeitüberschreitung' : last.message) : String(last);
  throw new PcsError(`procyclingstats.com nicht erreichbar: ${reason}${cause}`, null, false);
}

