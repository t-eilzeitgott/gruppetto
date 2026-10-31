/**
 * Startseite: alle Minispiele in einer Karte. Oben die Spielwahl (gleitende Markierung), darunter das gewählte
 * Spiel mit der Strecke des Tages und der kleinen Bestenliste der Runde, der Startknopf, unten Radgarage,
 * Europareise und Passbuch als Kacheln. Wechseln geht per Tipp oder Wischen (die Inhalte gleiten nach), der
 * Vorrat der 3D-Bühne folgt der Wahl (warm.ts) und der Kopf der Karte fliegt beim Start ins Spiel (handoff.ts).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type RefObject } from 'react';
import { useApp } from '../app/context';
import { useMembers } from '../app/hooks';
import { useQuery } from '../app/query';
import { source } from '../app/config';
import { warmGame } from '../app/warm';
import { beginHandoff } from '../app/handoff';
import { markUiBusy } from '../game/uiBusy';
import type { GameBest, GameRun } from '../data/source';
import type { Stage, StageKind } from '../lib/types';
import { GAMES, fmtBest, gameOrder, isNewGame, type GameInfo } from '../game/games';
import type { GameId } from '../data/source';
import { overtaken, type Seen } from '../lib/overtaken';
import { berlinDayKey, berlinDayStart } from '../game/abfahrt/rng';
import { gameSub } from '../game/gameSub';
import { Avatar, Link, cx } from './kit';
import { AreaIcon } from './GameIcon';
import { GameHead } from './GameHead';
import { useBikes } from './useBikes';
import { useJourney } from './useJourney';
import { fmtKm, ROUTE, ROUTE_KM } from '../game/journey';
import { BIKES, GARAGE_START } from '../game/bikes';
import { passStamps } from '../game/passbook';
import { BoardSkeleton, SkelText } from './skeleton';

const LS_SEL = 'gruppetto.games.sel';
/** kurze Namen für die Spielwahl */
const SHORT: Record<GameId, string> = { zeitfahren: 'Zeitfahren', abfahrt: 'Abfahrt', sprint: 'Sprint', berg: 'Berg' };

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

/** Bestenlisten eines Spiels: heute (wenn schon jemand gefahren ist), sonst Saison */
function useBoard(game: GameId) {
  const day = berlinDayKey();
  const since = useMemo(() => berlinDayStart().toISOString(), [day]);
  const season = useQuery<GameBest[]>(`game:${game}:season`, () => source.gameLeaderboard(game));
  const today = useQuery<GameBest[]>(`game:${game}:day:${day}`, () => source.gameLeaderboard(game, since));
  const useToday = (today.data?.length ?? 0) > 0;
  return { loaded: !!season.data && !!today.data, error: !!(season.error || today.error), rows: (useToday ? today.data : season.data) ?? [], today: useToday, day, season: season.data };
}

/** Zahl der gestempelten Pässe – aus den eigenen Läufen, in einer ruhigen Minute gerechnet (baut Strecken nach) */
function usePassCount(tourName: string | null, stages: Stage[] | null): number | null {
  const runs = useQuery<GameRun[]>('game:runs:me', () => source.myRuns(GARAGE_START));
  const [n, setN] = useState<number | null>(null);
  const data = runs.data;
  useEffect(() => {
    if (!data) return undefined;
    if (data.length === 0) { setN(0); return undefined; }
    let on = true;
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const go = () => { if (!on) return; try { setN(passStamps(data, tourName, stages).length); } catch { setN(0); } };
    const h = idle ? idle(go, { timeout: 2500 }) : window.setTimeout(go, 600);
    return () => { on = false; if (!idle) window.clearTimeout(h); };
  }, [data, tourName, stages]);
  return n;
}

export function GamesCard({ stageKind = null, tourName = null, stages = null }: { stageKind?: StageKind | null; tourName?: string | null; stages?: Stage[] | null }) {
  const { me } = useApp();
  const members = useMembers().data ?? [];
  // Spielwahl: zuletzt gewählt, sonst das Spiel zur Etappe des Tages
  const [sel, setSel] = useState<GameId>(() => {
    try { const v = localStorage.getItem(LS_SEL) as GameId | null; if (v && GAMES.some((g) => g.id === v)) return v; } catch { /* egal */ }
    return gameOrder(stageKind)[0]?.id ?? 'zeitfahren';
  });
  const [dir, setDir] = useState(1);
  const idx = Math.max(0, GAMES.findIndex((g) => g.id === sel));
  const game = GAMES[idx];
  const choose = (id: GameId) => {
    if (id === sel) return;
    // der Inhalt gleitet – ein laufender Umbau der 3D-Bühne tritt so lange zurück
    markUiBusy(450);
    setDir(GAMES.findIndex((g) => g.id === id) > idx ? 1 : -1);
    setSel(id);
    try { localStorage.setItem(LS_SEL, id); } catch { /* egal */ }
  };
  // die 3D-Bühne im Vorrat folgt der Wahl
  useEffect(() => { warmGame(sel); }, [sel]);

  // Bestenlisten aller Spiele (für Hinweise auf den Reitern und die eigenen Läufe)
  const boards = GAMES.map((g) => useBoard(g.id)); // eslint-disable-line react-hooks/rules-of-hooks
  const runs = useMemo(() => {
    if (!boards.every((b) => b.season)) return null;
    return Object.fromEntries(GAMES.map((g, i) => [g.id, boards[i].season!.find((b) => b.user_id === me.id)?.runs ?? 0])) as Partial<Record<GameId, number>>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards.map((b) => b.season).join('|'), me.id]);
  const alerts = GAMES.map((g, i) => useOvertaken(g.id, boards[i].today ? `day:${boards[i].day}` : 'season', boards[i].rows, me.id)); // eslint-disable-line react-hooks/rules-of-hooks

  // Wischen zwischen den Spielen
  const headRef = useRef<HTMLDivElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const swipe = useRef<{ id: number; x: number; y: number; on: boolean | null; moved: boolean } | null>(null);
  const skipClick = useRef(false);
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY, on: null, moved: false };
    skipClick.current = false;
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (s.on === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) s.on = Math.abs(dx) > Math.abs(dy) * 1.2;
    if (!s.on) return;
    s.moved = true;
    skipClick.current = true;
    const el = paneRef.current;
    if (el) el.style.transform = `translateX(${dx * 0.3}px)`;
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    if (!s || s.id !== e.pointerId) return;
    swipe.current = null;
    const el = paneRef.current;
    if (el) { el.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.9, 0.3, 1)'; el.style.transform = ''; window.setTimeout(() => { if (el) el.style.transition = ''; }, 320); }
    if (!s.on) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) < 42) return;
    const next = GAMES[idx + (dx < 0 ? 1 : -1)];
    if (next) choose(next.id);
  };

  const open = () => {
    if (skipClick.current) { skipClick.current = false; return; }
    alerts[idx].ack();
    const head = headRef.current;
    if (head) beginHandoff(head, game.path);
    else beginHandoff(document.createElement('div'), game.path);
  };

  return (
    <section className="card arena" aria-label="Minispiele">
      <div className="arena__tabs" role="tablist" aria-label="Spiel wählen" style={{ '--i': idx } as CSSProperties}>
        <span className="arena__ind" aria-hidden="true" />
        {GAMES.map((g, i) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={i === idx}
            className={cx('arena__tab', i === idx && 'is-on', (alerts[i].alert || isNewGame(g, runs)) && i !== idx && 'is-dot')}
            onClick={() => choose(g.id)}
          >
            {SHORT[g.id]}
          </button>
        ))}
      </div>
      <div className="arena__body" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div key={game.id} ref={paneRef} className="arena__pane" style={{ '--dir': dir } as CSSProperties}>
          <GamePane game={game} board={boards[idx]} alert={alerts[idx].alert} fresh={isNewGame(game, runs)} tourName={tourName} stages={stages} members={members} meId={me.id} headRef={headRef} onOpen={open} />
        </div>
      </div>
      <button type="button" className="btn btn--primary btn--full arena__go" onClick={open}><span>Spielen</span></button>
      <Tiles tourName={tourName} stages={stages} />
    </section>
  );
}

function GamePane({ game, board, alert, fresh, tourName, stages, members, meId, headRef, onOpen }: {
  game: GameInfo; board: ReturnType<typeof useBoard>; alert: ReturnType<typeof overtaken>; fresh: boolean;
  tourName: string | null; stages: Stage[] | null; members: { id: string; display_name: string | null; avatar_color: string | null }[]; meId: string;
  headRef: RefObject<HTMLDivElement | null>; onOpen: () => void;
}) {
  const day = board.day;
  const sprint = game.id === 'sprint';
  const berg = game.id === 'berg';
  const tt = game.id === 'zeitfahren';
  // echte Vorlage: Ziel der nächsten Flachetappe, Schlussanstieg der nächsten Bergetappe, nächstes Einzelzeitfahren
  // (derselbe Text wie im Startblatt des Spiels)
  const sub = useMemo(() => gameSub(game.id, day, tourName, stages), [game.id, day, tourName, stages]);
  const rows = board.rows;
  const myIdx = rows.findIndex((b) => b.user_id === meId);
  const shown = rows.slice(0, 3).map((r, i) => ({ r, i }));
  if (myIdx >= 3) shown.push({ r: rows[myIdx], i: myIdx });
  const nameOf = (id: string) => members.find((x) => x.id === id)?.display_name?.split(/\s+/)[0] ?? 'Jemand';
  const byNames = alert ? alert.by.map(nameOf) : [];
  const alertText = byNames.length === 0 ? 'Du wurdest überholt'
    : byNames.length === 1 ? `${byNames[0]} hat dich überholt`
      : `${byNames.slice(0, -1).join(', ')} und ${byNames[byNames.length - 1]} haben dich überholt`;
  return (
    <>
      <a href={`#${game.path}`} className="arena__hero" aria-label={`${game.name} spielen${fresh ? ' – neu' : ''}`} onClick={(e) => { e.preventDefault(); onOpen(); }}>
        <GameHead ref={headRef} game={game.id} title={game.name} sub={sub} tag={fresh ? <span className="game-new">Neu</span> : null} />
      </a>
      {!board.loaded ? (
        board.error ? <p className="arena__empty">Bestenliste gerade nicht erreichbar</p> : <BoardSkeleton />
      ) : shown.length ? (
        <ol className="arena__board" aria-label={board.today ? 'Bestenliste heute' : 'Bestenliste Saison'}>
          <li className="arena__board-label" aria-hidden="true">{board.today ? 'Heute' : 'Saison'}</li>
          {shown.map(({ r, i }) => {
            const m = members.find((x) => x.id === r.user_id);
            return (
              <li key={r.user_id} className={cx('arena__row', r.user_id === meId && 'is-me', alert?.by.includes(r.user_id) && 'is-by')}>
                <span className="arena__rank">{i + 1}</span>
                <Avatar name={m?.display_name ?? '?'} color={m?.avatar_color ?? '#888'} size={22} />
                <span className="arena__name">{r.user_id === meId ? 'Du' : m?.display_name ?? 'Jemand'}</span>
                <strong>{fmtBest(game, r.best)}</strong>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="arena__empty">{tt ? 'Fahr die erste Zeit des Tages – die Geister der Runde warten' : sprint || berg ? 'Hol dir den ersten Tagessieg' : 'Fahr die erste Bestmarke der Runde'}</p>
      )}
      {alert ? (
        <p className="arena__alert" role="status">
          <i aria-hidden="true" />
          <span>{alertText}</span>
          <b>Platz {alert.from} → {alert.to}</b>
        </p>
      ) : null}
    </>
  );
}

/** Radgarage, Europareise und Passbuch als Kacheln mit Stand */
function Tiles({ tourName, stages }: { tourName: string | null; stages: Stage[] | null }) {
  const bikes = useBikes();
  const j = useJourney();
  const passes = usePassCount(tourName, stages);
  const n = bikes.unlocked.length;
  const fresh = bikes.fresh.length > 0;
  const next = bikes.next;
  const p = next ? bikes.progress[next.id] : null;
  const frac = p ? Math.min(1, p.value / (p.target || 1)) : 1;
  const pos = j.me;
  const nextStop = ROUTE[pos.next];
  const done = pos.at === ROUTE.length - 1;
  const reiseSub = !j.loaded ? '' : pos.meters === 0 ? 'Wuppertal → Palermo' : done ? 'In Palermo' : `→ ${nextStop.name}`;
  return (
    <div className="arena__tiles">
      <Link to="/spiel/garage" className={cx('arena__tile', fresh && 'is-fresh')} ariaLabel={`Radgarage – ${n} von ${BIKES.length} Rädern freigeschaltet${fresh ? ', neues Rad' : ''}`}>
        <AreaIcon area="garage" size={34} />
        <span className="arena__tile-text">
          {bikes.loaded ? <strong>{n}<small>/{BIKES.length}</small></strong> : <SkelText w={36} size={17} />}
          <span>{fresh ? 'Neues Rad' : 'Räder'}</span>
        </span>
        {bikes.loaded && next ? <i className="arena__tile-bar" style={{ '--p': frac } as CSSProperties} aria-hidden="true" /> : null}
      </Link>
      <Link to="/spiel/reise" className="arena__tile" ariaLabel={`Europareise – ${fmtKm(pos.meters / 1000)}${j.loaded && !done && pos.meters > 0 ? `, noch ${fmtKm(pos.toNext)} bis ${nextStop.name}` : ''}`}>
        <AreaIcon area="reise" size={34} />
        <span className="arena__tile-text">
          {j.loaded ? <strong>{fmtKm(pos.meters / 1000)}</strong> : <SkelText w={44} size={17} />}
          <span>{j.loaded ? reiseSub : 'Reise'}</span>
        </span>
        {j.loaded && pos.meters > 0 ? <i className="arena__tile-bar" style={{ '--p': Math.min(1, pos.km / ROUTE_KM) } as CSSProperties} aria-hidden="true" /> : null}
      </Link>
      <Link to="/spiel/reise" className="arena__tile" ariaLabel={`Passbuch – ${passes ?? 0} Pässe`}>
        <AreaIcon area="paesse" size={34} />
        <span className="arena__tile-text">
          {passes !== null ? <strong>{passes}</strong> : <SkelText w={22} size={17} />}
          <span>{passes === 1 ? 'Pass' : 'Pässe'}</span>
        </span>
      </Link>
    </div>
  );
}
