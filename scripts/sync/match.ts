// PCS-Fahrer den Fahrern der Startliste zuordnen: zuerst über die Startnummer (mit Namensprobe),
// dann über den Namen (Reihenfolge, Akzente und Groß-/Kleinschreibung egal).
import { normalize } from '../../src/lib/pcsParse.ts';
import type { Rider } from '../../src/lib/types.ts';

export interface PcsPerson {
  bib: number | null;
  name: string;
  slug?: string | null;
}

const tokensOf = (s: string) => normalize(s).split(' ').filter((t) => t.length > 1);
/** Namenszusätze, die allein nichts über die Person sagen („van“, „de“ …) */
const PARTICLES = new Set(['van', 'der', 'den', 'de', 'del', 'della', 'da', 'di', 'du', 'le', 'la', 'ter', 'ten', 'von', 'dos', 'das', 'el', 'al']);

export function makeRiderMatcher(riders: Rider[]) {
  const prepared = riders.map((r) => {
    const tokens = tokensOf(r.name);
    return { rider: r, tokens, key: [...tokens].sort().join(' ') };
  });
  const byBib = new Map<number, (typeof prepared)[number]>();
  for (const p of prepared) if (p.rider.bib !== null && p.rider.bib !== undefined) byBib.set(p.rider.bib, p);

  return (person: PcsPerson): Rider | null => {
    const tokens = tokensOf(person.name);
    const slugTokens = person.slug ? person.slug.split('-').filter((t) => t.length > 1 && !/^\d+$/.test(t)) : [];
    const words = new Set([...tokens, ...slugTokens]);
    if (!words.size) return null;

    // 1. Startnummer, wenn mindestens ein Namensteil passt (schützt vor vertauschten Nummern)
    if (person.bib !== null) {
      const hit = byBib.get(person.bib);
      if (hit && hit.tokens.some((t) => !PARTICLES.has(t) && words.has(t))) return hit.rider;
    }
    // 2. gleicher Name in anderer Reihenfolge
    const key = [...tokens].sort().join(' ');
    const exact = prepared.filter((p) => p.key === key);
    if (exact.length === 1) return exact[0].rider;
    // 3. ein Name enthält den anderen vollständig (z. B. zweiter Vorname fehlt), aber nur eindeutig
    const contained = prepared.filter((p) => {
      if (!p.tokens.length) return false;
      const dbInPcs = p.tokens.every((t) => words.has(t));
      const pcsInDb = tokens.length >= 2 && tokens.every((t) => p.tokens.includes(t));
      return dbInPcs || pcsInDb;
    });
    if (contained.length === 1) return contained[0].rider;
    return null;
  };
}

/** Teamnamen der Wertung einem Teamnamen aus der Startliste zuordnen. */
export function makeTeamMatcher(teams: string[]) {
  const prepared = [...new Set(teams)].map((t) => ({ team: t, tokens: tokensOf(t) }));
  return (name: string): string | null => {
    const tokens = tokensOf(name);
    if (!tokens.length) return null;
    const key = tokens.join(' ');
    const exact = prepared.filter((p) => p.tokens.join(' ') === key);
    if (exact.length === 1) return exact[0].team;
    const contained = prepared.filter((p) =>
      p.tokens.length && (p.tokens.every((t) => tokens.includes(t)) || tokens.every((t) => p.tokens.includes(t))));
    return contained.length === 1 ? contained[0].team : null;
  };
}
