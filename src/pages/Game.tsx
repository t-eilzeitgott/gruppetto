import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/context';
import { useMembers } from '../app/hooks';
import { invalidate, useQuery } from '../app/query';
import { source } from '../app/config';
import type { GameBest } from '../data/source';
import { BIDON_POINTS, DescentGame, type DescentStats } from '../game/descent';
import { Avatar, Button, TopBar, cx, useTitle } from '../ui/kit';

const LS_KEY = 'gruppetto.abfahrt.best';
const readBest = () => { try { return Number(localStorage.getItem(LS_KEY)) || 0; } catch { return 0; } };
const writeBest = (n: number) => { try { localStorage.setItem(LS_KEY, String(n)); } catch { /* egal */ } };

type Phase = 'ready' | 'playing' | 'over';

/** Minispiel „Abfahrt“ mit Bestenliste der Runde */
export function GamePage() {
  useTitle('Abfahrt');
  const { me } = useApp();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<DescentGame | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [stats, setStats] = useState<DescentStats>({ meters: 0, bidons: 0, speedKmh: 0, topKmh: 0, score: 0 });
  const [last, setLast] = useState<DescentStats | null>(null);
  const [best, setBest] = useState(readBest);
  const [record, setRecord] = useState(false);
  const board = useQuery<GameBest[]>('game:abfahrt', () => source.gameLeaderboard('abfahrt'));
  const members = useMembers();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let frame = 0;
    const game = new DescentGame(canvas, {
      onTick: (s) => {
        // HUD nicht bei jedem Frame neu rendern
        frame += 1;
        if (frame % 4 === 0) setStats(s);
      },
      onCrash: (s) => {
        setStats(s);
        setLast(s);
        setPhase('over');
        const prev = readBest();
        const isRecord = s.score > prev;
        setRecord(isRecord);
        if (isRecord) { writeBest(s.score); setBest(s.score); }
        if (s.score > 0) {
          source.submitScore('abfahrt', s.score).then(() => invalidate('game:abfahrt')).catch(() => undefined);
        }
      },
    });
    gameRef.current = game;
    const onResize = () => game.resize();
    const onVis = () => { if (document.hidden) game.pause(); else game.resume(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') game.nudge(-1);
      if (e.key === 'ArrowRight') game.nudge(1);
    };
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onTheme = () => window.setTimeout(() => { game.readColors(); game.resize(); }, 50);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('keydown', onKey);
    mq.addEventListener?.('change', onTheme);
    const obs = new MutationObserver(onTheme);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-tour'] });
    return () => {
      game.destroy();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('keydown', onKey);
      mq.removeEventListener?.('change', onTheme);
      obs.disconnect();
    };
  }, []);

  const start = () => {
    setPhase('playing');
    setRecord(false);
    setStats({ meters: 0, bidons: 0, speedKmh: 43, topKmh: 43, score: 0 });
    gameRef.current?.start();
  };

  const rows = (board.data ?? []).slice(0, 10);
  const name = (uid: string) => members.data?.find((m) => m.id === uid);
  const myRank = (board.data ?? []).findIndex((b) => b.user_id === me.id);

  return (
    <>
      <TopBar title="Abfahrt" subtitle="Minispiel" back="/" />
      <div className="game">
        <div className="game__stage">
          <canvas ref={canvasRef} className="game__canvas" aria-label="Spielfeld: Daumen nach links und rechts ziehen, um zu lenken" />
          <div className="game__hud" aria-live="off">
            <span><strong>{stats.meters.toLocaleString('de-DE')}</strong>&nbsp;m</span>
            <span><strong>{stats.speedKmh}</strong>&nbsp;km/h</span>
            <span><span className="game__dot game__dot--bidon" aria-hidden="true" /><strong>{stats.bidons}</strong></span>
          </div>

          {phase !== 'playing' ? (
            <div className="game__overlay">
              <div className="game__card">
                {phase === 'ready' ? (
                  <>
                    <h2 className="game__title">Abfahrt</h2>
                    <p className="muted">Zieh den Daumen nach links und rechts und bleib auf der Straße. Es wird immer schneller und kurviger.</p>
                    <ul className="game__rules">
                      <li><span className="game__dot game__dot--bidon" aria-hidden="true" />Trinkflasche: +{BIDON_POINTS} Punkte</li>
                      <li><span className="game__dot game__dot--hole" aria-hidden="true" />Schlagloch: Sturz</li>
                      <li><span className="game__dot game__dot--edge" aria-hidden="true" />Im Kies: bremst – bleibst du drin, stürzt du</li>
                    </ul>
                  </>
                ) : (
                  <>
                    <h2 className="game__title">{record ? 'Neue Bestleistung!' : 'Sturz!'}</h2>
                    <p className="game__score"><strong>{last?.score.toLocaleString('de-DE')}</strong> Punkte</p>
                    <p className="muted small">
                      {last?.meters.toLocaleString('de-DE')}&nbsp;m · {last?.bidons}&nbsp;{last?.bidons === 1 ? 'Flasche' : 'Flaschen'} · Spitze {last?.topKmh}&nbsp;km/h
                    </p>
                  </>
                )}
                <Button full onClick={start}>{phase === 'ready' ? 'Losfahren' : 'Nochmal'}</Button>
                <p className="muted small center">Deine Bestleistung: {best.toLocaleString('de-DE')}</p>
              </div>
            </div>
          ) : null}
        </div>

        <section className="card game__board" aria-labelledby="game-board">
          <div className="card__row">
            <h2 id="game-board" className="eyebrow">Bestenliste der Runde</h2>
            {myRank >= 0 ? <span className="chip chip--accent">Du: Platz&nbsp;{myRank + 1}</span> : null}
          </div>
          {rows.length === 0 ? <p className="muted">Noch keine Läufe – fahr die erste Bestzeit!</p> : (
            <ol className="list">
              {rows.map((r, i) => {
                const m = name(r.user_id);
                return (
                  <li key={r.user_id} className={cx('person-row', r.user_id === me.id && 'is-me')}>
                    <span className="rank">{i + 1}</span>
                    <Avatar name={m?.display_name ?? '?'} color={m?.avatar_color ?? '#888'} size={30} />
                    <span className="person-row__main">
                      <span className="person-row__name">{m?.display_name ?? 'Ehemaliges Mitglied'}{r.user_id === me.id ? ' (du)' : ''}</span>
                      <span className="person-row__sub">{r.runs}&nbsp;{r.runs === 1 ? 'Lauf' : 'Läufe'}</span>
                    </span>
                    <span className="points">{r.best.toLocaleString('de-DE')}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}
