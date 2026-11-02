/**
 * Bestenliste eines Minispiels: oben das Podium der ersten drei, darunter die übrigen – jeweils mit den Kennzahlen
 * des besten Laufs (Ø km/h, Kraft übrig). Ein Tipp auf einen Fahrer klappt seinen Lauf auf: Spitze, Platz im
 * Rennen, Rad, Fahrertyp, Rutscher, Zahl der Läufe und wann er gefahren ist.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { GameBest, GameId, RunStats } from '../data/source';
import type { Profile } from '../lib/types';
import { BIKES } from '../game/bikes';
import { Avatar, Segmented, cx } from '../ui/kit';
import { Icon } from '../ui/Icon';

export type Board = 'day' | 'season';

const kmh = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (k: number) => `${Math.round(k * 100)} %`;
const bikeName = (id?: string) => (id ? BIKES.find((b) => b.id === id)?.name ?? null : null);

/** wann gefahren: „heute, 21:28“, „gestern, 9:05“ oder „Mo., 3.11.“ */
function when(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = (x: Date) => x.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
  const now = new Date();
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
  if (day(d) === day(now)) return `heute, ${time}`;
  if (day(d) === day(new Date(now.getTime() - 864e5))) return `gestern, ${time}`;
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'Europe/Berlin' });
}

/** Kraftanzeige als kleine Batterie (wie viel im Ziel noch drin war) */
export function Kraft({ k, label = true }: { k: number; label?: boolean }) {
  return (
    <span className="rb-kraft" title="Kraft übrig im Ziel">
      <span className="rb-kraft__cell" style={{ '--k': Math.max(0, Math.min(1, k)) } as CSSProperties} aria-hidden="true"><i /></span>
      {label ? <span>{pct(k)}</span> : null}
      <span className="sr-only"> Kraft übrig</span>
    </span>
  );
}

/** Ø km/h und Kraft – die kurze Zeile unter dem Namen */
function StatLine({ s, runs, unit, extra }: { s: RunStats | null | undefined; runs: number; unit: [string, string]; extra?: string | null }) {
  const parts: ReactNode[] = [];
  if (s?.avg_kmh) parts.push(<span key="v" className="rb-stat"><Icon name="zap" size={12} />Ø&nbsp;{kmh(s.avg_kmh)}<small>&nbsp;km/h</small></span>);
  if (s?.reserve !== undefined) parts.push(<Kraft key="k" k={s.reserve} />);
  if (extra) parts.push(<span key="x" className="rb-stat rb-stat--muted">{extra}</span>);
  parts.push(<span key="n" className="rb-stat rb-stat--muted">{runs === 1 ? `1 ${unit[0]}` : `${runs} ${unit[1]}`}</span>);
  return <span className="rb-line">{parts}</span>;
}

/** aufgeklappter Lauf: alle Kennzahlen als kleine Kacheln */
function Detail({ row, extra }: { row: GameBest; extra?: [string, string] | null }) {
  const s = row.stats ?? {};
  const tiles: [string, ReactNode][] = [];
  if (s.avg_kmh) tiles.push(['Schnitt', <>{kmh(s.avg_kmh)}<small> km/h</small></>]);
  if (s.top_kmh) tiles.push(['Spitze', <>{Math.round(s.top_kmh)}<small> km/h</small></>]);
  if (s.reserve !== undefined) tiles.push(['Kraft übrig', <Kraft k={s.reserve} />]);
  if (s.place && s.riders) tiles.push(['Im Rennen', <>{s.place}.<small> von {s.riders}</small></>]);
  if (s.type) tiles.push(['Fahrer', s.type]);
  const bike = bikeName(s.bike);
  if (bike) tiles.push(['Rad', bike]);
  if (s.slides) tiles.push(['Rutscher', `${s.slides}×`]);
  if (extra) tiles.push(extra);
  const t = when(row.best_at ?? row.last_at);
  return (
    <div className="rb-detail">
      {tiles.length ? (
        <dl className="rb-tiles">
          {tiles.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      ) : <p className="rb-none">Für diesen Lauf gibt es noch keine Kennzahlen – sie werden ab jetzt mitgespeichert.</p>}
      {t ? <p className="rb-when"><Icon name="clock" size={12} />Bester Lauf {t}</p> : null}
    </div>
  );
}

export function RunBoard({ title, game, rows, board, setBoard, members, meId, onBack, unit, fmt, extra }: {
  title: string; game: GameId; rows: GameBest[]; board: Board; setBoard: (b: Board) => void; members: Profile[]; meId: string;
  onBack: () => void;
  /** Läufe benennen: „1 Sprint“ / „3 Sprints“ */
  unit: [string, string];
  /** Bestwert anzeigen (Punkte; im Zeitfahren eine Zeit) */
  fmt: (best: number) => string;
  /** zusätzliche Angabe je Fahrer: kurz in der Zeile, mit Namen im aufgeklappten Lauf (Abfahrt: wie weit) */
  extra?: (r: GameBest) => { line: string; tile: [string, string] } | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id));
  const nameOf = (id: string) => members.find((x) => x.id === id);
  const shown = rows.slice(0, 30);
  const podium = shown.length >= 3 ? shown.slice(0, 3) : [];
  const rest = shown.slice(podium.length);
  const openRow = podium.find((r) => r.user_id === open);
  return (
    <section className={cx('abf-board rb', `rb--${game}`)} aria-label="Bestenliste">
      <div className="abf-row">
        <button type="button" className="abf-link" onClick={onBack}><Icon name="back" size={16} />Zurück</button>
        <h2 className="abf-eyebrow">{title}</h2>
      </div>
      <Segmented<Board> label="Zeitraum" value={board} onChange={(b) => { setOpen(null); setBoard(b); }} options={[{ value: 'day', label: 'Heute' }, { value: 'season', label: 'Saison' }]} />
      {shown.length === 0 ? <p className="abf-muted">{board === 'day' ? 'Heute ist noch niemand gefahren.' : `Noch keine ${unit[1]}.`}</p> : null}
      {podium.length ? (
        <>
          <ol className="rb-podium" aria-label="Podium">
            {[1, 0, 2].map((i) => {
              const r = podium[i];
              const m = nameOf(r.user_id);
              const me = r.user_id === meId;
              const first = (m?.display_name ?? 'Ehemaliges Mitglied').split(/\s+/)[0];
              return (
                <li key={r.user_id} className={cx('rb-step', `rb-step--${i + 1}`, me && 'is-me', open === r.user_id && 'is-open')} style={{ order: i === 0 ? 2 : i === 1 ? 1 : 3 }}>
                  <button type="button" className="rb-step__btn" onClick={() => toggle(r.user_id)} aria-expanded={open === r.user_id}
                    aria-label={`${i + 1}. ${m?.display_name ?? 'Ehemaliges Mitglied'}${me ? ' (du)' : ''}, ${fmt(r.best)}`}>
                    <span className="rb-step__av"><Avatar name={m?.display_name ?? '?'} color={m?.avatar_color ?? '#888'} size={i === 0 ? 52 : 42} /></span>
                    <span className="rb-step__name">{me ? 'Du' : first}</span>
                    <strong className="rb-step__best">{fmt(r.best)}</strong>
                    {r.stats?.avg_kmh ? <span className="rb-step__v">Ø {kmh(r.stats.avg_kmh)} km/h</span> : <span className="rb-step__v">{r.runs === 1 ? `1 ${unit[0]}` : `${r.runs} ${unit[1]}`}</span>}
                    {r.stats?.reserve !== undefined ? <Kraft k={r.stats.reserve} /> : null}
                    <span className="rb-step__plinth" aria-hidden="true">{i + 1}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          {openRow ? <Detail row={openRow} extra={extra?.(openRow)?.tile} /> : null}
        </>
      ) : null}
      {rest.length ? (
        <ol className="rb-list" start={podium.length + 1}>
          {rest.map((r, k) => {
            const i = podium.length + k;
            const m = nameOf(r.user_id);
            const me = r.user_id === meId;
            const isOpen = open === r.user_id;
            return (
              <li key={r.user_id} className={cx('rb-row', me && 'is-me', isOpen && 'is-open', i < 3 && `rb-row--${i + 1}`)}>
                <button type="button" className="rb-row__btn" onClick={() => toggle(r.user_id)} aria-expanded={isOpen}>
                  <span className="rb-row__rank">{i + 1}</span>
                  <Avatar name={m?.display_name ?? '?'} color={m?.avatar_color ?? '#888'} size={32} />
                  <span className="rb-row__main">
                    <span className="rb-row__name">{m?.display_name ?? 'Ehemaliges Mitglied'}{me ? ' (du)' : ''}</span>
                    <StatLine s={r.stats} runs={r.runs} unit={unit} extra={extra?.(r)?.line} />
                  </span>
                  <strong className="rb-row__best">{fmt(r.best)}</strong>
                </button>
                {isOpen ? <Detail row={r} extra={extra?.(r)?.tile} /> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
