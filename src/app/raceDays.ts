/**
 * Etappentage für das Intro merken: index.html läuft vor der App und kennt keine Daten – an einem Renntag zeigt
 * es die Renntag-Animation mit der Etappe aus diesem Zwischenspeicher (siehe src/intro/schedule.ts).
 */
import type { TourData } from '../lib/types';
import type { RaceDay } from '../intro/schedule';
import { berlinDayKey } from '../game/abfahrt/rng';

const KEY = 'gruppetto.raceDays';

export function rememberRaceDays(d: TourData) {
  try {
    const today = berlinDayKey();
    const old = JSON.parse(localStorage.getItem(KEY) || 'null') as { days?: Record<string, RaceDay> } | null;
    const days: Record<string, RaceDay> = {};
    // andere Rundfahrten behalten (nur heute und später)
    for (const [k, v] of Object.entries(old?.days ?? {})) if (k >= today && v.id !== d.tour.id) days[k] = v;
    const last = Math.max(0, ...d.stages.map((s) => s.number));
    for (const s of d.stages) {
      const k = berlinDayKey(new Date(s.starts_at));
      if (k < today) continue;
      const r: RaceDay = { id: d.tour.id, t: d.tour.theme, tour: d.tour.short_name, n: s.number, k: s.kind, from: s.departure, to: s.arrival, km: s.distance_km };
      if (s.number === last) r.last = true;
      days[k] = r;
    }
    localStorage.setItem(KEY, JSON.stringify({ v: 1, days }));
  } catch { /* privat, voll: dann eben ohne */ }
}
