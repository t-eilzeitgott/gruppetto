// Was verschickt wird – ohne Datenbank und Netz (testbar). run.ts lädt die Daten, plan() entscheidet,
// run.ts beansprucht jeden Eintrag in push_log und verschickt.
//
// Zwei Arten:
//   remind – Tippschluss in höchstens REMIND_BEFORE_H Stunden und noch kein Tipp abgegeben
//   result – Ergebnis der Etappe veröffentlicht (Etappe höchstens RESULT_WINDOW_H Stunden alt): deine Punkte und der
//            Tagesbeste deiner Gruppe, gerechnet nach den Regeln der Gruppe (wie in der App, src/lib/scoring.ts)
import { DEFAULT_SCALE, scaleOf, scoreStage } from '../../src/lib/scoring.ts';
import type { PointScale, Stage, StageResult, StageTip } from '../../src/lib/types.ts';

export const REMIND_BEFORE_H = 2;
export const RESULT_WINDOW_H = 30;

export type PushKind = 'result' | 'remind';

export interface PushSub {
  endpoint: string;
  user_id: string;
  p256dh: string;
  auth: string;
}
export interface PushProfile {
  id: string;
  display_name: string | null;
  group_id: string | null;
  is_member: boolean;
}
export interface PushGroup {
  id: string;
  stage_points: number[];
  underdog_bonus: boolean;
}
export interface PushTour {
  id: string;
  short_name: string;
  group_id: string | null;
}
export interface PushStage {
  id: number;
  tour_id: string;
  number: number;
  starts_at: string;
  departure: string | null;
  arrival: string | null;
  results_published: boolean;
}
export interface PushData {
  now: Date;
  subs: PushSub[];
  /** alle Mitglieder (auch ohne Gerät – für Gruppenwertung und Tagesbesten) */
  profiles: PushProfile[];
  groups: PushGroup[];
  tours: PushTour[];
  /** Etappen im Zeitfenster (RESULT_WINDOW_H zurück bis REMIND_BEFORE_H voraus) */
  stages: PushStage[];
  tips: { stage_id: number; user_id: string; rider_id: number }[];
  results: StageResult[];
  riders: { id: number; name: string }[];
  /** schon verschickt: `${user_id}|${kind}|${stage_id}` */
  sent: Set<string>;
}

export interface Payload {
  title: string;
  body: string;
  /** Pfad in der App (Hash-Route) */
  url: string;
  tag: string;
}
export interface PushMessage {
  userId: string;
  kind: PushKind;
  stageId: number;
  payload: Payload;
  /** Nachricht verfällt, wenn das Gerät bis dahin nicht erreichbar ist (Sekunden) */
  ttl: number;
}

export const sentKey = (userId: string, kind: PushKind, stageId: number) => `${userId}|${kind}|${stageId}`;

/** „Tadej Pogačar“ → „Pogačar“, „Wout van Aert“ → „van Aert“ */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.trim();
  const i = parts.findIndex((p, k) => k > 0 && /^(van|von|de|del|della|der|den|da|di|du|le|la|ten|ter)$/i.test(p));
  return parts.slice(i > 0 ? i : parts.length - 1).join(' ');
}

function berlinTime(d: Date): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(d);
}

function route(stage: PushStage): string {
  return stage.departure && stage.arrival ? ` · ${stage.departure} → ${stage.arrival}` : '';
}

const pts = (n: number) => `${n} ${n === 1 ? 'Punkt' : 'Punkte'}`;

/** Mitglied sieht die Rundfahrt (Rundfahrten mit Gruppe nur für diese) */
function seesTour(p: PushProfile, tour: PushTour): boolean {
  return tour.group_id === null || tour.group_id === p.group_id;
}

export function plan(d: PushData): PushMessage[] {
  const now = d.now.getTime();
  const out: PushMessage[] = [];
  const profile = new Map(d.profiles.map((p) => [p.id, p]));
  const tours = new Map(d.tours.map((t) => [t.id, t]));
  const groups = new Map(d.groups.map((g) => [g.id, g]));
  const riders = new Map(d.riders.map((r) => [r.id, r.name]));
  const subscribed = [...new Set(d.subs.map((s) => s.user_id))]
    .map((id) => profile.get(id))
    .filter((p): p is PushProfile => !!p && p.is_member);

  for (const stage of d.stages) {
    const tour = tours.get(stage.tour_id);
    if (!tour) continue;
    const start = new Date(stage.starts_at).getTime();
    const tipped = new Set(d.tips.filter((t) => t.stage_id === stage.id).map((t) => t.user_id));

    // Erinnerung: Tippschluss bald, noch kein Tipp
    if (start > now && start - now <= REMIND_BEFORE_H * 3600e3) {
      const mins = Math.max(1, Math.round((start - now) / 60e3));
      const left = mins >= 90 ? `in ${Math.round(mins / 60)} Stunden` : mins >= 55 ? 'in einer Stunde' : `in ${mins} Minuten`;
      for (const p of subscribed) {
        if (!seesTour(p, tour) || tipped.has(p.id) || d.sent.has(sentKey(p.id, 'remind', stage.id))) continue;
        out.push({
          userId: p.id,
          kind: 'remind',
          stageId: stage.id,
          ttl: Math.max(60, Math.round((start - now) / 1000)),
          payload: {
            title: `Noch kein Tipp für Etappe ${stage.number}`,
            body: `${tour.short_name}${route(stage)} – Tippschluss ${left} (${berlinTime(new Date(start))} Uhr).`,
            url: `/tipp/${stage.id}`,
            tag: `remind-${stage.id}`,
          },
        });
      }
    }

    // Ergebnis: veröffentlicht, Etappe nicht zu alt
    if (stage.results_published && start <= now && now - start <= RESULT_WINDOW_H * 3600e3) {
      const results = d.results.filter((r) => r.stage_id === stage.id);
      const winner = results.find((r) => r.position === 1);
      if (!winner) continue;
      const winnerName = shortName(riders.get(winner.rider_id) ?? 'unbekannt');
      // je Gruppe rechnen (Regeln und Außenseiter-Bonus hängen an den Tipps der Gruppe)
      const byGroup = new Map<string | null, ReturnType<typeof scoreStage>>();
      const scoreFor = (groupId: string | null) => {
        if (!byGroup.has(groupId)) {
          const members = new Set(d.profiles.filter((p) => p.is_member && p.group_id === groupId).map((p) => p.id));
          const tips: StageTip[] = d.tips
            .filter((t) => t.stage_id === stage.id && members.has(t.user_id))
            .map((t) => ({ ...t, updated_at: '' }));
          const g = groupId ? groups.get(groupId) : undefined;
          const scale: PointScale[] = g ? scaleOf(g.stage_points) : DEFAULT_SCALE;
          byGroup.set(groupId, scoreStage({ ...stage, kind: 'flat', distance_km: null } as Stage, tips, results, scale, g?.underdog_bonus ?? true));
        }
        return byGroup.get(groupId)!;
      };
      for (const p of subscribed) {
        if (!seesTour(p, tour) || d.sent.has(sentKey(p.id, 'result', stage.id))) continue;
        const scores = scoreFor(p.group_id);
        const mine = scores.find((s) => s.userId === p.id);
        const best = Math.max(0, ...scores.map((s) => s.total));
        const leaders = best > 0 ? scores.filter((s) => s.total === best) : [];
        let body: string;
        if (mine) {
          const rider = shortName(riders.get(mine.riderId) ?? 'Dein Fahrer');
          const place = mine.position === null ? 'nicht in den Punkten' : mine.position === 1 ? 'hat gewonnen' : `wurde ${mine.position}.`;
          body = `${rider} ${place} – ${mine.total > 0 ? `+${pts(mine.total)}` : 'keine Punkte'}${mine.bonus > 0 ? ` (inkl. ${mine.bonus} Außenseiter-Bonus)` : ''}.`;
          if (mine.position !== 1) body = `Sieg für ${winnerName}. ${body}`;
        } else {
          body = `Sieg für ${winnerName}. Du hattest nicht getippt.`;
        }
        if (leaders.length) {
          if (leaders.some((s) => s.userId === p.id)) body += leaders.length === 1 ? ' Du bist Tagesbester!' : ' Du teilst dir den Tagessieg.';
          else {
            const names = leaders.map((s) => profile.get(s.userId)?.display_name ?? '?');
            body += ` Tagesbest${names.length === 1 ? 'er' : 'e'}: ${names.slice(0, 2).join(' und ')}${names.length > 2 ? ` und ${names.length - 2} weitere` : ''} (${best}).`;
          }
        }
        out.push({
          userId: p.id,
          kind: 'result',
          stageId: stage.id,
          ttl: 24 * 3600,
          payload: { title: `${tour.short_name}, Etappe ${stage.number}: Ergebnis ist da`, body, url: `/etappe/${stage.id}`, tag: `result-${stage.id}` },
        });
      }
    }
  }
  return out;
}
