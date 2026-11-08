/**
 * Emoji-Reaktionen je Etappe: jedes Mitglied kann jede der festen Reaktionen einmal setzen (an/aus).
 * Sichtbar nur innerhalb der eigenen Gruppe (Row Level Security, Tabelle stage_reactions).
 */

/** feste Auswahl – dieselbe Liste prüft die Datenbank (stage_reactions.emoji) */
export const REACTIONS = ['🔥', '👏', '😱', '😂', '🤯', '🐐', '💀', '🚴'] as const;
export type ReactionEmoji = (typeof REACTIONS)[number];

/** Beschriftung für Screenreader */
export const REACTION_LABEL: Record<ReactionEmoji, string> = {
  '🔥': 'Feuer', '👏': 'Applaus', '😱': 'Schock', '😂': 'Lachen', '🤯': 'Umgehauen', '🐐': 'Legende', '💀': 'Erledigt', '🚴': 'Allez',
};

export interface StageReaction {
  stage_id: number;
  user_id: string;
  emoji: ReactionEmoji;
  created_at: string;
}

export function isReaction(v: unknown): v is ReactionEmoji {
  return typeof v === 'string' && (REACTIONS as readonly string[]).includes(v);
}

const keyOf = (r: Pick<StageReaction, 'user_id' | 'emoji'>) => `${r.user_id}|${r.emoji}`;

export interface ReactionSummary {
  emoji: ReactionEmoji;
  count: number;
  mine: boolean;
  /** wer reagiert hat, neueste zuerst */
  users: string[];
}

/** Zählung je Emoji in fester Reihenfolge; nur Reaktionen von bekannten Mitgliedern (falls angegeben) */
export function summarize(rows: StageReaction[], me: string, members?: Set<string>): ReactionSummary[] {
  const by = new Map<ReactionEmoji, StageReaction[]>();
  for (const r of rows) {
    if (!isReaction(r.emoji)) continue;
    if (members && !members.has(r.user_id)) continue;
    by.set(r.emoji, [...(by.get(r.emoji) ?? []), r]);
  }
  return REACTIONS.map((emoji) => {
    const list = (by.get(emoji) ?? []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { emoji, count: list.length, mine: list.some((r) => r.user_id === me), users: list.map((r) => r.user_id) };
  });
}

/** neue Reaktionen anderer seit dem letzten Stand (für die Animation), älteste zuerst */
export function arrivals(prev: StageReaction[], next: StageReaction[], me: string): StageReaction[] {
  const seen = new Set(prev.map(keyOf));
  return next
    .filter((r) => r.user_id !== me && !seen.has(keyOf(r)))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** eigene Reaktion an- oder ausschalten (lokal, vor der Antwort der Datenbank) */
export function toggle(rows: StageReaction[], r: StageReaction, on: boolean): StageReaction[] {
  const k = keyOf(r);
  const rest = rows.filter((x) => keyOf(x) !== k);
  return on ? [...rest, r] : rest;
}

/** zuletzt Reagierte (je Person nur einmal, mit allen ihren Emojis), neueste zuerst */
export function recentPeople(rows: StageReaction[], limit = 8): { user_id: string; emojis: ReactionEmoji[]; at: string }[] {
  const by = new Map<string, { user_id: string; emojis: ReactionEmoji[]; at: string }>();
  for (const r of rows.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const e = by.get(r.user_id);
    if (e) e.emojis.push(r.emoji);
    else by.set(r.user_id, { user_id: r.user_id, emojis: [r.emoji], at: r.created_at });
  }
  return [...by.values()].slice(0, limit);
}
