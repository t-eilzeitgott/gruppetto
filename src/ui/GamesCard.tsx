/**
 * Startseite: alle Minispiele in einer Karte. Oben die Spielwahl (gleitende Markierung), darunter das gewählte
 * Spiel mit der Strecke des Tages und der kleinen Bestenliste der Runde, der Startknopf, unten Radgarage,
 * Europareise und Passbuch als Kacheln. Wechseln geht per Tipp oder Wischen (die Inhalte gleiten nach), der
 * Vorrat der 3D-Bühne folgt der Wahl (warm.ts) und der Kopf der Karte fliegt beim Start ins Spiel (handoff.ts).
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useApp } from '../app/context';
import { useMembers } from '../app/hooks';
import { invalidate, useQuery } from '../app/query';
import { source } from '../app/config';
import { warmGame } from '../app/warm';
import { beginHandoff } from '../app/handoff';
import { markUiBusy, uiBusy } from '../game/uiBusy';
import type { GameBest, GameRun } from '../data/source';
import type { Profile, Stage, StageKind } from '../lib/types';
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
  const err = !!(season.error || today.error);
  // gleiches Objekt, solange sich die Daten nicht ändern (die Spielkarte zeichnet dann nichts neu)
  return useMemo<Board>(() => {
    const useToday = (today.data?.length ?? 0) > 0;
    return { loaded: !!season.data && !!today.data, error: err, rows: (useToday ? today.data : season.data) ?? NONE, today: useToday, day, season: season.data };
  }, [season.data, today.data, err, day]);
}
const NONE: GameBest[] = [];
interface Board { loaded: boolean; error: boolean; rows: GameBest[]; today: boolean; day: string; season: GameBest[] | undefined }

/** Zahl der gestempelten Pässe – aus den eigenen Läufen, in einer ruhigen Minute gerechnet (baut Strecken nach) */
function usePassCount(tourName: string | null, stages: Stage[] | null): number | null {
  const runs = useQuery<GameRun[]>('game:runs:me', () => source.myRuns(GARAGE_START));
  const [n, setN] = useState<number | null>(null);
  const data = runs.data;
  // nur neu rechnen, wenn ein Lauf dazugekommen ist (nicht bei jedem Neuladen alle 30 s)
  const sig = data ? `${data.length}|${data.length ? data[data.length - 1].created_at : ''}|${tourName ?? ''}|${stages?.length ?? 0}` : '';
  useEffect(() => {
    if (!data) return undefined;
    if (data.length === 0) { setN(0); return undefined; }
    let on = true;
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const go = () => { if (!on) return; try { setN(passStamps(data, tourName, stages).length); } catch { setN(0); } };
    const h = idle ? idle(go, { timeout: 2500 }) : window.setTimeout(go, 600);
    return () => { on = false; if (!idle) window.clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return n;
}

/** alle 30 s neu laden (Bestenlisten, eigene Läufe, Garage, Geister) – solange die Seite zu sehen ist */
const REFRESH_MS = 30_000;
function refresh() {
  invalidate('game:');
  invalidate('ghosts:');
  invalidate('tt:ghosts:');
}

export function GamesCard({ stageKind = null, tourName = null, stages = null }: { stageKind?: StageKind | null; tourName?: string | null; stages?: Stage[] | null }) {
  const { me } = useApp();
  const members = useMembers().data ?? EMPTY;
  // Spielwahl: zuletzt gewählt, sonst das Spiel zur Etappe des Tages
  const [idx, setIdx] = useState<number>(() => {
    let id: GameId | null = null;
    try { const v = localStorage.getItem(LS_SEL) as GameId | null; if (v && GAMES.some((g) => g.id === v)) id = v; } catch { /* egal */ }
    id ??= gameOrder(stageKind)[0]?.id ?? 'zeitfahren';
    return Math.max(0, GAMES.findIndex((g) => g.id === id));
  });
  const idxRef = useRef(idx);
  idxRef.current = idx;

  // Bestenlisten aller Spiele (alle vorab geladen – Wechseln zeigt sofort Inhalt)
  const boards = GAMES.map((g) => useBoard(g.id)); // eslint-disable-line react-hooks/rules-of-hooks
  const runs = useMemo(() => {
    if (!boards.every((b) => b.season)) return null;
    return Object.fromEntries(GAMES.map((g, i) => [g.id, boards[i].season!.find((b) => b.user_id === me.id)?.runs ?? 0])) as Partial<Record<GameId, number>>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...boards.map((b) => b.season), me.id]);
  const alerts = GAMES.map((g, i) => useOvertaken(g.id, boards[i].today ? `day:${boards[i].day}` : 'season', boards[i].rows, me.id)); // eslint-disable-line react-hooks/rules-of-hooks
  // Untertitel aller Spiele einmal (baut die Tagesstrecken) – nicht bei jedem Wechsel
  const day = boards[0].day;
  const subs = useMemo(() => GAMES.map((g) => gameSub(g.id, day, tourName, stages)), [day, tourName, stages]);

  // auch die Geister der Spiele schon laden: das Startblatt steht dann sofort vollständig
  useQuery<unknown>('ghosts:abfahrt', () => source.gameGhosts('abfahrt'));
  useQuery<unknown>('ghosts:sprint', () => source.gameGhosts('sprint'));
  useQuery<unknown>('ghosts:berg', () => source.gameGhosts('berg'));
  useQuery<unknown>(`tt:ghosts:${day}`, () => source.ttGhosts(day));

  // alle 30 s neu laden (nicht, während jemand wischt – dann kurz danach)
  useEffect(() => {
    let t = 0;
    const tick = () => {
      if (document.hidden) { t = window.setTimeout(tick, REFRESH_MS); return; }
      if (uiBusy()) { t = window.setTimeout(tick, 1500); return; }
      refresh();
      t = window.setTimeout(tick, REFRESH_MS);
    };
    t = window.setTimeout(tick, REFRESH_MS);
    const onShow = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { window.clearTimeout(t); document.removeEventListener('visibilitychange', onShow); };
  }, []);

  // Wischen: echtes Scrollen mit Einrasten (läuft auf dem Grafikprozessor, auch wenn die Seite gerade rechnet);
  // die Markierung der Reiter folgt dem Finger Bild für Bild, ohne React
  const scroller = useRef<HTMLDivElement | null>(null);
  const tabs = useRef<HTMLDivElement | null>(null);
  const heads = useRef<(HTMLDivElement | null)[]>([]);
  const raf = useRef(0);
  const settle = useRef(0);
  const width = () => scroller.current?.clientWidth || 1;
  // Startlage: das gewählte Spiel (ohne Bewegung)
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = idxRef.current * width();
    tabs.current?.style.setProperty('--i', String(idxRef.current));
    warmGame(GAMES[idxRef.current].id);
  }, []);
  const onScroll = () => {
    // ein laufender Umbau der 3D-Bühne tritt zurück, solange gewischt wird
    markUiBusy(500);
    if (!raf.current) {
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        const el = scroller.current;
        if (!el) return;
        const x = Math.max(0, Math.min(GAMES.length - 1, el.scrollLeft / width()));
        tabs.current?.style.setProperty('--i', x.toFixed(4));
        const i = Math.round(x);
        if (i !== idxRef.current) { idxRef.current = i; setIdx(i); }
      });
    }
    // zur Ruhe gekommen: Wahl merken, 3D-Bühne dafür umbauen
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const id = GAMES[idxRef.current].id;
      try { localStorage.setItem(LS_SEL, id); } catch { /* egal */ }
      warmGame(id);
    }, 700);
  };
  useEffect(() => () => { cancelAnimationFrame(raf.current); window.clearTimeout(settle.current); }, []);
  const go = (i: number) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ left: i * width(), behavior: 'smooth' });
  };

  const ackRef = useRef(alerts.map((a) => a.ack));
  ackRef.current = alerts.map((a) => a.ack);
  const open = useCallback((i: number) => {
    ackRef.current[i]?.();
    const head = heads.current[i];
    beginHandoff(head ?? document.createElement('div'), GAMES[i].path);
  }, []);

  return (
    <section className="card arena" aria-label="Minispiele">
      <div className="arena__tabs" role="tablist" aria-label="Spiel wählen" ref={tabs}>
        <span className="arena__ind" aria-hidden="true" />
        {GAMES.map((g, i) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={i === idx}
            className={cx('arena__tab', i === idx && 'is-on', (alerts[i].alert || isNewGame(g, runs)) && i !== idx && 'is-dot')}
            onClick={() => go(i)}
          >
            {SHORT[g.id]}
          </button>
        ))}
      </div>
      <div className="arena__scroller" ref={scroller} onScroll={onScroll}>
        {GAMES.map((g, i) => (
          <div key={g.id} className="arena__pane" aria-hidden={i !== idx}>
            <GamePane
              index={i} game={g} board={boards[i]} alert={alerts[i].alert} fresh={isNewGame(g, runs)} sub={subs[i]}
              members={members} meId={me.id} heads={heads} onOpen={open}
            />
          </div>
        ))}
      </div>
      <button type="button" className="btn btn--primary btn--full arena__go" onClick={() => open(idx)}><span>Spielen</span></button>
      <Tiles tourName={tourName} stages={stages} />
    </section>
  );
}

const EMPTY: Profile[] = [];

/** ein Spiel in der Karte – neu gezeichnet nur, wenn sich seine Daten ändern (nicht beim Wischen) */
const GamePane = memo(function GamePane({ index, game, board, alert, fresh, sub, members, meId, heads, onOpen }: {
  index: number; game: GameInfo; board: Board; alert: ReturnType<typeof overtaken>; fresh: boolean; sub: string;
  members: Profile[]; meId: string; heads: RefObject<(HTMLDivElement | null)[]>; onOpen: (i: number) => void;
}) {
  const sprint = game.id === 'sprint';
  const berg = game.id === 'berg';
  const tt = game.id === 'zeitfahren';
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
      <a href={`#${game.path}`} className="arena__hero" aria-label={`${game.name} spielen${fresh ? ' – neu' : ''}`} onClick={(e) => { e.preventDefault(); onOpen(index); }}>
        <GameHead ref={(el: HTMLDivElement | null) => { heads.current[index] = el; }} game={game.id} title={game.name} sub={sub} tag={fresh ? <span className="game-new">Neu</span> : null} />
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
}, (a, b) => a.board === b.board && a.sub === b.sub && a.fresh === b.fresh && a.members === b.members && a.meId === b.meId
  && JSON.stringify(a.alert) === JSON.stringify(b.alert));

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
