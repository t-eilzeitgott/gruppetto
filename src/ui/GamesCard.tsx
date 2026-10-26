/**
 * Startseite: alle Minispiele in einer Karte. Wischen nach links/rechts wechselt das Spiel,
 * jedes zeigt seine eigene Bestenliste. Das zur heutigen Etappe passende Spiel steht vorn.
 */
import { useMemo, useRef, useState } from 'react';
import { useApp } from '../app/context';
import { useMembers } from '../app/hooks';
import { useQuery } from '../app/query';
import { source } from '../app/config';
import type { GameBest } from '../data/source';
import type { Stage, StageKind } from '../lib/types';
import { GAMES, isNewGame, type GameInfo } from '../game/games';
import { Track } from '../game/abfahrt/track';
import { berlinDayKey, berlinDayStart } from '../game/abfahrt/rng';
import { shortTour, stageRef } from '../game/abfahrt/stageRef';
import { Avatar, Link, cx } from './kit';
import { Icon } from './Icon';
import { GameBadge } from './GameIcon';

/** Reihenfolge: das Finale zur nächsten Etappe zuerst (flach/wellig → Sprint, sonst Berg), dann das andere, dann die Abfahrt */
function order(kind: StageKind | null): GameInfo[] {
  const rank: Record<string, number> = kind === 'flat' || kind === 'hilly' ? { sprint: 0, berg: 1, abfahrt: 2 } : { berg: 0, sprint: 1, abfahrt: 2 };
  return [...GAMES].sort((a, b) => (rank[a.id] ?? 9) - (rank[b.id] ?? 9));
}

export function GamesCard({ stageKind = null, tourName = null, stages = null }: { stageKind?: StageKind | null; tourName?: string | null; stages?: Stage[] | null }) {
  const games = useMemo(() => order(stageKind), [stageKind]);
  const scroller = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const anyNew = useMemo(() => games.some(isNewGame), [games]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const w = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? el.clientWidth;
    setActive(Math.max(0, Math.min(games.length - 1, Math.round(el.scrollLeft / Math.max(1, w)))));
  };
  const go = (i: number) => {
    const el = scroller.current;
    const slide = el?.children[i] as HTMLElement | undefined;
    if (el && slide) el.scrollTo({ left: slide.offsetLeft - (el.firstElementChild as HTMLElement).offsetLeft, behavior: 'smooth' });
  };
  return (
    <section className={cx('card games-card', anyNew && 'is-new')} aria-label="Minispiele">
      <div className="games-scroller" ref={scroller} onScroll={onScroll}>
        {games.map((g) => <GameSlide key={g.id} game={g} tourName={tourName} stages={stages} />)}
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
              className={cx('games-dots__dot', i === active && 'is-on')}
              onClick={() => go(i)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function GameSlide({ game, tourName, stages }: { game: GameInfo; tourName: string | null; stages: Stage[] | null }) {
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
  return (
    <Link to={game.path} className="games-slide game-card" ariaLabel={`Minispiel ${game.name} öffnen`}>
      <span className="game-card__head">
        <GameBadge game={game.id} size={48} />
        <span className="game-card__main">
          <span className="game-card__titlerow">
            <strong className="game-card__title">{game.name}</strong>
            {isNewGame(game) ? <span className="game-new">Neu</span> : null}
          </span>
          <span className="muted game-card__route">{sub}</span>
        </span>
        <Icon name="chevron" className="muted" />
      </span>
      {shown.length ? (
        <span className="game-board" role="list" aria-label={useToday ? 'Bestenliste heute' : 'Bestenliste Saison'}>
          <span className="game-board__label">{useToday ? 'Heute' : 'Saison'}</span>
          {shown.map(({ r, i }) => {
            const m = members.find((x) => x.id === r.user_id);
            return (
              <span key={r.user_id} role="listitem" className={cx('game-board__row', r.user_id === me.id && 'is-me')}>
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
