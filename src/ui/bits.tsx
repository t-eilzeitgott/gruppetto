import { useEffect } from 'react';
import type { Profile, Rider, Stage, TourData } from '../lib/types';
import { KIND_SHORT, fmtDay, stageState, fmtClock, fmtKm } from '../lib/time';
import { Avatar, cx } from './kit';
import { Skel, SkelText } from './skeleton';
import { useQuery, invalidate } from '../app/query';
import { source } from '../app/config';

export function KindChip({ stage }: { stage: Stage }) {
  return <span className="chip chip--accent">{KIND_SHORT[stage.kind]}</span>;
}

export function stageRoute(stage: Stage): string | null {
  if (stage.departure && stage.arrival) {
    return stage.departure === stage.arrival ? stage.departure : `${stage.departure} → ${stage.arrival}`;
  }
  return stage.departure ?? stage.arrival ?? null;
}

export function stageFacts(stage: Stage): string {
  const parts = [fmtDay(stage.starts_at)];
  if (stage.distance_km) parts.push(`${fmtKm(stage.distance_km)}`);
  parts.push(`Start ${fmtClock(stage.starts_at)}`);
  return parts.join(' · ');
}

export function riderName(data: TourData, id: number | null | undefined): string {
  if (id === null || id === undefined) return '–';
  return data.riders.find((r) => r.id === id)?.name ?? 'Unbekannter Fahrer';
}

export function lastName(name: string): string {
  const parts = name.split(' ');
  const idx = parts.findIndex((p, i) => i > 0 && (p[0] === p[0]?.toUpperCase() || ['van', 'de', 'del', 'der', 'da', 'di', 'le', 'la'].includes(p)));
  return idx > 0 ? parts.slice(idx).join(' ') : parts[parts.length - 1];
}

/** Wer hat schon getippt? (ohne den Fahrer zu verraten) */
export function Tippers({ stage, members, compact }: { stage: Stage; members: Profile[]; compact?: boolean }) {
  const q = useQuery<string[]>(`tippers:${stage.id}`, () => source.stageTippers(stage.id));
  const ids = new Set(q.data ?? []);
  const tipped = members.filter((m) => ids.has(m.id));
  if (q.loading) {
    return (
      <div className={cx('tippers', compact && 'tippers--compact')} aria-hidden="true">
        <div className="avatar-stack">{[0, 1, 2].map((i) => <Skel key={i} w={30} h={30} r="50%" />)}</div>
        <div className="tippers__text">
          <SkelText w={120} size={14} />
          <SkelText w={140} size={12.5} />
        </div>
      </div>
    );
  }
  const shown = tipped.slice(0, 4);
  const rest = tipped.length - shown.length;
  return (
    <div className={cx('tippers', compact && 'tippers--compact')}>
      {tipped.length > 0 ? (
        <div className="avatar-stack" aria-hidden="true">
          {shown.map((m) => <Avatar key={m.id} name={m.display_name} color={m.avatar_color} size={30} />)}
          {rest > 0 ? <span className="avatar avatar--more" style={{ width: 30, height: 30 }}>+{rest}</span> : null}
        </div>
      ) : null}
      <div className="tippers__text">
        <strong>{tipped.length} von&nbsp;{members.length} getippt</strong>
        <span className="muted">aufgedeckt um {fmtClock(stage.starts_at)}</span>
      </div>
    </div>
  );
}

/** Lädt die Rundfahrt neu, sobald die nächste Etappe startet (Tipps werden sichtbar). */
export function useRefreshAtStart(stages: Stage[] | undefined, now: number) {
  useEffect(() => {
    if (!stages) return;
    const next = stages
      .map((s) => new Date(s.starts_at).getTime())
      .filter((t) => t > now)
      .sort((a, b) => a - b)[0];
    if (!next) return;
    const delay = next - now + 1500;
    if (delay > 2 ** 31 - 1) return;
    const id = window.setTimeout(() => {
      invalidate('tour:');
      invalidate('tippers:');
    }, delay);
    return () => window.clearTimeout(id);
  }, [stages, now]);
}

export function stateLabel(stage: Stage, now: number): string {
  const st = stageState(stage, now);
  if (st === 'done') return 'Ausgewertet';
  if (st === 'running') return 'Läuft – Ergebnis folgt';
  return 'Tippbar';
}

export function RiderLine({ rider, sub }: { rider: Rider | undefined; sub?: string }) {
  return (
    <div className="rider-line">
      <span className="rider-line__name">{rider?.name ?? 'Unbekannter Fahrer'}</span>
      {sub ?? rider?.team ? <span className="rider-line__team">{sub ?? rider?.team}</span> : null}
    </div>
  );
}
