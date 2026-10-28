/**
 * Startseite: alle Minispiele in einer Karte. Wischen nach links/rechts wechselt das Spiel,
 * jedes zeigt seine eigene Bestenliste. Das selbst meistgespielte Spiel steht vorn, bei Gleichstand das zur Etappe passende.
 * Darüber der Eingang zur Radgarage.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/context';
import { useMembers } from '../app/hooks';
import { useQuery } from '../app/query';
import { source } from '../app/config';
import type { GameBest } from '../data/source';
import type { Stage, StageKind } from '../lib/types';
import { GAMES, gameOrderByPlays, type GameInfo } from '../game/games';
import type { GameId } from '../data/source';
import { Track } from '../game/abfahrt/track';
import { overtaken, type Seen } from '../lib/overtaken';
import { berlinDayKey, berlinDayStart } from '../game/abfahrt/rng';
import { shortTour, stageRef } from '../game/abfahrt/stageRef';
import { Avatar, Link, cx } from './kit';
import { Icon } from './Icon';
import { GameBadge } from './GameIcon';
import { useBikes } from './useBikes';
import { useJourney } from './useJourney';
import { fmtKm, ROUTE, ROUTE_KM } from '../game/journey';
import { BIKES } from '../game/bikes';
import { BoardSkeleton, SkelText } from './skeleton';

const SWIPED = 'gruppetto.games.swiped';

const seenKey = (game: string, board: string) => `gruppetto.rank.${game}.${board}`;
const readSeen = (k: string): Seen | null => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as Seen : null; } catch { return null; } };
const writeSeen = (k: string, v: Seen) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } };

/**
 * Überholt? Wer auf Platz 1 oder 2 stand und seitdem zurückgefallen ist, bekommt einen Hinweis –
 * bis er das Spiel öffnet (oder sich den Platz zurückholt)
 */
function useOvertaken(game: string, board: string, rows: GameBest[], meId: string) {
  const key = seenKey(game, board);
  const myIdx = rows.findIndex((b) => b.user_id === meId);
  const cur: Seen | null = myIdx >= 0 ? { rank: myIdx + 1, above: rows.slice(0, myIdx).map((b) => b.user_id) } : null;
  const prev = useMemo(() => readSeen(key), [key, rows]);
  const alert = overtaken(prev, cur);
  const curJson = cur ? JSON.stringify(cur) : '';
  useEffect(() => {
    // ohne Rückfall aus den Top 2: den aktuellen Stand merken
    if (cur && !alert && rows.length) writeSeen(key, cur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, curJson, !!alert]);
  const ack = () => { if (cur) writeSeen(key, cur); };
  return { alert, ack };
}

export function GamesCard({ stageKind = null, tourName = null, stages = null }: { stageKind?: StageKind | null; tourName?: string | null; stages?: Stage[] | null }) {
  const { me } = useApp();
  // eigene Läufe je Spiel (Saison) – gleiche Abfragen wie die Bestenlisten der Karten, also kein Mehraufwand
  const boards = GAMES.map((g) => useQuery<GameBest[]>(`game:${g.id}:season`, () => source.gameLeaderboard(g.id))); // eslint-disable-line react-hooks/rules-of-hooks
  const loaded = boards.every((q) => q.data);
  const runsKey = loaded ? boards.map((q) => q.data!.find((b) => b.user_id === me.id)?.runs ?? 0).join(',') : '';
  const games = useMemo(() => {
    if (!runsKey) return gameOrderByPlays(stageKind, null);
    const n = runsKey.split(',').map(Number);
    const runs = Object.fromEntries(GAMES.map((g, i) => [g.id, n[i]])) as Partial<Record<GameId, number>>;
    return gameOrderByPlays(stageKind, runs);
  }, [stageKind, runsKey]);
  const scroller = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  // Spiele, in denen man gerade überholt wurde (Punkt unten pulsiert)
  const [alerts, setAlerts] = useState<Record<string, boolean>>({});
  const onAlert = (id: string, on: boolean) => setAlerts((a) => (a[id] === on ? a : { ...a, [id]: on }));
  // Hinweis „rechts gibt es mehr“, bis man einmal gewischt hat
  const [swiped, setSwiped] = useState(() => { try { return localStorage.getItem(SWIPED) === '1'; } catch { return false; } });
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const w = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? el.clientWidth;
    const i = Math.max(0, Math.min(games.length - 1, Math.round(el.scrollLeft / Math.max(1, w))));
    setActive(i);
    if (i > 0 && !swiped) {
      setSwiped(true);
      try { localStorage.setItem(SWIPED, '1'); } catch { /* egal */ }
    }
  };
  const go = (i: number) => {
    const el = scroller.current;
    const slide = el?.children[i] as HTMLElement | undefined;
    if (el && slide) el.scrollTo({ left: slide.offsetLeft - (el.firstElementChild as HTMLElement).offsetLeft, behavior: 'smooth' });
  };
  return (
    <>
      <GarageTeaser />
      <JourneyTeaser />
      <section className={cx('card games-card', games.length > 1 && active < games.length - 1 && 'has-more', !swiped && games.length > 1 && 'nudge')} aria-label="Minispiele">
        <div className="games-scroller" ref={scroller} onScroll={onScroll}>
          {games.map((g) => <GameSlide key={g.id} game={g} tourName={tourName} stages={stages} onAlert={onAlert} />)}
        </div>
        {games.length > 1 ? (
          <div className="games-dots" role="tablist" aria-label="Spiel wählen">
            {games.map((g, i) => (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={i === active}
                aria-label={g.name}
                className={cx('games-dots__dot', i === active && 'is-on', i === active + 1 && 'is-next', alerts[g.id] && i !== active && 'is-alert')}
                onClick={() => go(i)}
              />
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}

/**
 * Eingang zur Radgarage über den Spielen: leuchtet, solange es noch Räder freizuschalten gibt;
 * unten eine feine Linie bis zum nächsten Rad.
 */
function GarageTeaser() {
  const bikes = useBikes();
  const n = bikes.unlocked.length;
  const fresh = bikes.fresh.length > 0;
  const next = bikes.next;
  const p = next ? bikes.progress[next.id] : null;
  const frac = p ? Math.min(1, p.value / (p.target || 1)) : 1;
  const all = bikes.loaded && !next;
  const label = fresh ? 'Neues Rad freigeschaltet' : all ? 'Radgarage' : 'Räder freischalten';
  // bis die Läufe geladen sind: Zahl als Platzhalter (gleiche Breite), kein Leuchten
  return (
    <Link to="/spiel/garage" className={cx('card garage-teaser', bikes.loaded && !all && 'is-glow', fresh && 'is-fresh')} ariaLabel={`Radgarage – ${n} von ${BIKES.length} Rädern freigeschaltet${fresh ? ', neues Rad' : ''}`}>
      <span className="garage-teaser__icon" aria-hidden="true"><Icon name="bike" size={22} /></span>
      <strong className="garage-teaser__title">{label}</strong>
      {bikes.loaded ? <span className="garage-teaser__count">{n}/{BIKES.length}</span> : <SkelText w={34} size={14} />}
      <Icon name="chevron" className="muted" size={18} />
      {bikes.loaded && !all ? <span className="garage-teaser__bar" aria-hidden="true"><i style={{ width: `${Math.round(frac * 100)}%` }} /></span> : null}
    </Link>
  );
}

/** Europareise: wo man gerade steht – alle Kilometer aus allen Spielen auf dem Weg nach Palermo */
function JourneyTeaser() {
  const j = useJourney();
  const p = j.me;
  const at = ROUTE[p.at];
  const next = ROUTE[p.next];
  const done = p.at === ROUTE.length - 1;
  const sub = !j.loaded ? '' : p.meters === 0 ? `Wuppertal → Palermo · jeder Lauf zählt` : done ? 'In Palermo angekommen' : `${at.name} · noch ${fmtKm(p.toNext)} bis ${next.name}`;
  return (
    <Link to="/spiel/reise" className="card garage-teaser journey-teaser" ariaLabel={`Europareise – ${sub}`}>
      <span className="garage-teaser__icon" aria-hidden="true"><Icon name="flag" size={22} /></span>
      <span className="garage-teaser__title"><strong>Europareise</strong>{j.loaded ? <span className="journey-teaser__sub">{sub}</span> : <SkelText w={150} size={12} />}</span>
      {j.loaded ? <span className="garage-teaser__count">{fmtKm(p.meters / 1000)}</span> : null}
      <Icon name="chevron" className="muted" size={18} />
      {j.loaded && p.meters > 0 ? <span className="garage-teaser__bar" aria-hidden="true"><i style={{ width: `${Math.round(Math.min(1, p.km / ROUTE_KM) * 100)}%` }} /></span> : null}
    </Link>
  );
}

function GameSlide({ game, tourName, stages, onAlert }: { game: GameInfo; tourName: string | null; stages: Stage[] | null; onAlert: (id: string, on: boolean) => void }) {
  const { me } = useApp();
  const members = useMembers().data ?? [];
  const day = berlinDayKey();
  const since = useMemo(() => berlinDayStart().toISOString(), [day]);
  const season = useQuery<GameBest[]>(`game:${game.id}:season`, () => source.gameLeaderboard(game.id));
  const today = useQuery<GameBest[]>(`game:${game.id}:day:${day}`, () => source.gameLeaderboard(game.id, since));
  const sprint = game.id === 'sprint';
  const berg = game.id === 'berg';
  // echte Vorlage: Ziel der nächsten Flachetappe bzw. Schlussanstieg der nächsten Bergetappe
  const sub = useMemo(() => {
    if (sprint || berg) {
      const ref = stageRef(sprint ? 'sprint' : 'mountain', tourName, stages, day);
      const pre = ref ? `${shortTour(ref.tour)} · ${ref.stage}. Etappe · ` : '';
      if (sprint) return `${pre}${new Track(day, [], 'sprint', ref).title.replace('Sprintfinale in ', 'Ziel in ')}`;
      return `${pre}${new Track(day, [], 'mountain', ref).title}`;
    }
    return new Track(day).title;
  }, [day, sprint, berg, tourName, stages]);
  const useToday = (today.data?.length ?? 0) > 0;
  const rows = (useToday ? today.data : season.data) ?? [];
  const myIdx = rows.findIndex((b) => b.user_id === me.id);
  const shown = rows.slice(0, 3).map((r, i) => ({ r, i }));
  if (myIdx >= 3) shown.push({ r: rows[myIdx], i: myIdx });
  const { alert, ack } = useOvertaken(game.id, useToday ? `day:${day}` : 'season', rows, me.id);
  useEffect(() => { onAlert(game.id, !!alert); }, [game.id, !!alert]); // eslint-disable-line react-hooks/exhaustive-deps
  const nameOf = (id: string) => members.find((x) => x.id === id)?.display_name?.split(/\s+/)[0] ?? 'Jemand';
  const byNames = alert ? alert.by.map(nameOf) : [];
  const alertText = byNames.length === 0 ? 'Du wurdest überholt'
    : byNames.length === 1 ? `${byNames[0]} hat dich überholt`
      : `${byNames.slice(0, -1).join(', ')} und ${byNames[byNames.length - 1]} haben dich überholt`;
  return (
    <Link to={game.path} className={cx('games-slide game-card', alert && 'is-overtaken')} ariaLabel={`Minispiel ${game.name} öffnen${alert ? ` – ${alertText}` : ''}`} onNavigate={ack}>
      <span className="game-card__head">
        <GameBadge game={game.id} size={48} />
        <span className="game-card__main">
          <strong className="game-card__title">{game.name}</strong>
          <span className="muted game-card__route">{sub}</span>
          {alert ? (
            <span className="game-alert" role="status">
              <i aria-hidden="true" />
              <span>{alertText}</span>
              <b>Platz {alert.from} → {alert.to}</b>
            </span>
          ) : null}
        </span>
        <Icon name="chevron" className="muted" />
      </span>
      {!season.data || !today.data ? (
        season.error || today.error ? <span className="game-card__meta">Bestenliste gerade nicht erreichbar</span> : <BoardSkeleton />
      ) : shown.length ? (
        <span className="game-board" role="list" aria-label={useToday ? 'Bestenliste heute' : 'Bestenliste Saison'}>
          <span className="game-board__label">{useToday ? 'Heute' : 'Saison'}</span>
          {shown.map(({ r, i }) => {
            const m = members.find((x) => x.id === r.user_id);
            return (
              <span key={r.user_id} role="listitem" className={cx('game-board__row', r.user_id === me.id && 'is-me', alert?.by.includes(r.user_id) && 'is-by')}>
                <span className="game-board__rank">{i + 1}</span>
                <Avatar name={m?.display_name ?? '?'} color={m?.avatar_color ?? '#888'} size={24} />
                <span className="game-board__name">{r.user_id === me.id ? 'Du' : m?.display_name ?? 'Jemand'}</span>
                <strong>{r.best.toLocaleString('de-DE')}</strong>
              </span>
            );
          })}
        </span>
      ) : (
        <span className="game-card__meta">{sprint || berg ? 'Hol dir den ersten Tagessieg' : 'Fahr die erste Bestmarke der Runde'}</span>
      )}
    </Link>
  );
}
