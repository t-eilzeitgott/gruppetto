import type { Rider } from './types';

export interface ParsedRider {
  bib: number | null;
  name: string;
  team: string;
}

export interface StartlistParse {
  riders: ParsedRider[];
  skipped: string[];
}

const PARTICLES = new Set(['van', 'der', 'den', 'de', 'del', 'della', 'da', 'di', 'du', 'le', 'la', 'ter', 'ten', 'von', 'dos', 'das', 'y']);

/** Entfernt Akzente und vereinheitlicht für Vergleiche. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ø/gi, 'o')
    .replace(/æ/gi, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/ł/gi, 'l')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const isUpperWord = (w: string) => /\p{L}/u.test(w) && w === w.toUpperCase() && w !== w.toLowerCase();

function titleCase(word: string, first: boolean): string {
  const lower = word.toLowerCase();
  if (!first && PARTICLES.has(lower)) return lower;
  return lower.replace(/(^|[-'’])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/**
 * PCS schreibt Namen als „NACHNAME Vorname“ (z. B. „VAN DER POEL Mathieu“).
 * Ergebnis: „Mathieu van der Poel“. Bereits normale Namen bleiben unverändert.
 */
export function pcsName(raw: string): string {
  const words = raw.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  let i = 0;
  while (i < words.length && isUpperWord(words[i]) && words[i].replace(/[^\p{L}]/gu, '').length > 1) i += 1;
  if (i === 0 || i === words.length) {
    return i === words.length ? words.map((w, k) => titleCase(w, k === 0)).join(' ') : words.join(' ');
  }
  const last = words.slice(0, i).map((w, k) => titleCase(w, k === 0 && !PARTICLES.has(w.toLowerCase())));
  const first = words.slice(i);
  return [...first, ...last].join(' ');
}

function cleanTeam(line: string): string {
  return line
    .replace(/\((WT|PRT|CT|PCT|UWT)\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const NOISE = /^(startlist|startliste|riders?|fahrer|team|teams|bib|nr\.?|#|name|pos|rnk)$/i;

/**
 * Liest eine Startliste ein. Unterstützt
 *  1. „Nr;Name;Team“ bzw. tab-getrennt (eine Zeile pro Fahrer)
 *  2. den kopierten PCS-Text: Teamname als eigene Zeile, darunter „1 POGAČAR Tadej“.
 */
export function parseStartlist(text: string): StartlistParse {
  const riders: ParsedRider[] = [];
  const skipped: string[] = [];
  let team = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/ /g, ' ').trim();
    if (!line) continue;

    if (/[;\t]/.test(line)) {
      const parts = line.split(/[;\t]/).map((p) => p.trim()).filter((p, idx, arr) => p !== '' || idx < arr.length - 1);
      const [a, b, c] = parts;
      if (a && /^\d{1,3}$/.test(a) && b) {
        riders.push({ bib: Number(a), name: pcsName(b), team: cleanTeam(c ?? team) || 'Unbekannt' });
      } else if (a && b && !/^\d/.test(a) && !NOISE.test(a)) {
        riders.push({ bib: null, name: pcsName(a), team: cleanTeam(b) || 'Unbekannt' });
      } else {
        skipped.push(line);
      }
      continue;
    }

    const m = line.match(/^(\d{1,3})\s*[.)]?\s*(\p{L}.*)$/u);
    if (m) {
      const name = m[2].replace(/\s+\d+$/, '').trim();
      if (!team) {
        skipped.push(line);
        continue;
      }
      riders.push({ bib: Number(m[1]), name: pcsName(name), team });
      continue;
    }

    if (/^\p{L}/u.test(line) && !NOISE.test(line) && line.length <= 80) {
      team = cleanTeam(line);
    } else {
      skipped.push(line);
    }
  }
  return { riders, skipped };
}

export interface ResultParse {
  riderIds: number[];
  unmatched: string[];
}

/**
 * Erkennt Fahrer in einem kopierten Ergebnis (eine Zeile pro Platz) anhand der Startliste.
 * Reihenfolge der Zeilen = Platzierung. Doppelte Fahrer werden ignoriert.
 */
export function parseResults(text: string, riders: Rider[], limit = 10): ResultParse {
  const prepared = riders.map((r) => ({
    rider: r,
    tokens: normalize(r.name).split(' ').filter((t) => t.length > 1),
  }));
  const riderIds: number[] = [];
  const unmatched: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (riderIds.length >= limit) break;
    const line = rawLine.trim();
    if (!line) continue;
    const words = new Set(normalize(line).split(' '));
    let best: { id: number; score: number } | null = null;
    for (const p of prepared) {
      if (!p.tokens.length || !p.tokens.every((t) => words.has(t))) continue;
      if (!best || p.tokens.length > best.score) best = { id: p.rider.id, score: p.tokens.length };
    }
    if (best && !riderIds.includes(best.id)) riderIds.push(best.id);
    else if (!best && /\p{L}{3,}/u.test(line)) unmatched.push(line);
  }
  return { riderIds, unmatched };
}
