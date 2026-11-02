import { useEffect, useMemo, useRef, useState } from 'react';
import { prewarm } from '../game/abfahrt/pool';
import type { WarmArgs } from '../app/warm';
import { useApp } from '../app/context';
import { useMembers, useTourData } from '../app/hooks';
import { invalidate, useQuery } from '../app/query';
import { navigate } from '../app/router';
import { source } from '../app/config';
import type { GameBest } from '../data/source';
import { SprintRace, TYPE_STATS, typeBars, type SprintEvent, type SprintHud, type SprintResult } from '../game/abfahrt/sprint';
import { riderOptions, rivalNames, sprintTrains, teamMate, type RiderOption } from '../game/abfahrt/sprintRiders';
import { stageRef } from '../game/abfahrt/stageRef';
import { gameSubFor } from '../game/gameSub';
import { SPRINT_FINISH } from '../game/abfahrt/track';
import { nextWeatherName } from '../game/abfahrt/weather';
import { berlinDayKey, berlinDayStart } from '../game/abfahrt/rng';
import { HudBanner, PowerRing, RaceBar, TvAd, raceBar, writeBar, writeRing } from './hud';
import { cx, useTitle } from '../ui/kit';
import { useBikes, type Bikes } from '../ui/useBikes';
import { useGameGhosts } from '../ui/useGameGhosts';
import { BikeChip, NewBikePill } from './bikeChip';
import { Icon } from '../ui/Icon';
import { BoardLink, Countdown, OverSheet, PauseSheet, StartSheet } from './startSheet';
import { useMeasure } from './measure';
import { Kraft } from './runBoard';
import { RunTiles, ReportActions, Standing, Verdict, raceTiles, verdict } from './report';
import type { Renderer3D } from '../game/abfahrt/render3d';
import { PauseIcon, PlayIcon, useCountUp } from './Game';
import { RaceControls, controlsHowTo } from './controls';
import { teamKit } from '../game/teams';
import {
  FinaleBoard, HowTo, Podium, RiderPicker, dist, lsGet, lsSet, nf,
  againWithIntro, useGameLock, usePreparedRace, useRaceKeys, useRaceLoop, type Board, type Ui,
} from './finale';

const LS_RIDER = 'gruppetto.sprint.rider';
const LS_RUNS = 'gruppetto.sprint.runs';
const LS_BEST = 'gruppetto.sprint.best';

type Coach = 'steer' | 'go';
const COACH: Record<Coach, { t: string; s: string; g: string }> = {
  steer: { t: 'Hinterrad wechseln', s: 'Finger seitlich ziehen – im Windschatten sparst du Kraft', g: 'is-steer' },
  go: { t: 'Antreten!', s: 'Rechte Taste halten – bis über die Linie', g: 'is-tuck' },
};

const sprintBars = (t: RiderOption['type']): [string, number][] => {
  const b = typeBars(t);
  return [['Endspeed', b.top], ['Antritt', b.acc], ['Ausdauer', b.end]];
};

/** Startbild des Sprints ohne Seite: beim App-Start unsichtbar vorwärmen (siehe app/warm.ts) */
export function warmSprint(a: WarmArgs, reuse = false): Promise<void> {
  const options = riderOptions(a.data, a.me, a.day);
  const pick = lsGet(LS_RIDER);
  const chosen = options.find((o) => `${o.id ?? 'x'}:${o.type}` === pick) ?? options[0];
  const town = stageRef('sprint', a.tour?.name, a.data?.stages, a.day);
  return prewarm(() => new SprintRace({
    dayKey: a.day,
    names: a.names,
    rider: chosen,
    rivals: rivalNames(a.data, chosen.id),
    trains: sprintTrains(a.data, chosen.id, a.day),
    mate: teamMate(a.data, chosen.id, 'sprint')?.name ?? null,
    kit: teamKit('gruppetto', chosen.number, { bike: a.bike }),
    town,
    onEvent: () => undefined,
    onOver: () => undefined,
  }), { accent: a.accent, dark: a.dark }, 'sprint', reuse);
}

/** Minispiel „Sprintfinale“: die letzten 2,4 km im Feld – Windschatten, Position, Antritt */
export function SprintPage() {
  useTitle('Sprintfinale');
  const { me, tour } = useApp();
  const members = useMembers();
  const tourData = useTourData(tour);
  const day = berlinDayKey();
  const since = useMemo(() => berlinDayStart().toISOString(), [day]);
  const season = useQuery<GameBest[]>('game:sprint:season', () => source.gameLeaderboard('sprint'));
  const bikes = useBikes();
  const gh = useGameGhosts('sprint');
  const today = useQuery<GameBest[]>(`game:sprint:day:${day}`, () => source.gameLeaderboard('sprint', since));

  const stageEl = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SprintRace | null>(null);
  const [glError, setGlError] = useState(false);
  const [ui, setUi] = useState<Ui>('ready');
  const uiRef = useRef<Ui>('ready');
  uiRef.current = ui;
  const [count, setCount] = useState(3);
  const [result, setResult] = useState<SprintResult | null>(null);
  const [banner, setBanner] = useState<{ key: number; title: string; sub?: string; tone?: 'gold' | 'accent' | 'red' } | null>(null);
  const [board, setBoard] = useState<Board>('day');
  const [showBoard, setShowBoard] = useState(false);
  const [coach, setCoach] = useState<Coach | null>(null);
  const coachRef = useRef<{ on: boolean; t: number; shown: Set<Coach>; cur: Coach | null }>({ on: false, t: 0, shown: new Set(), cur: null });
  const [best, setBest] = useState(() => Number(lsGet(LS_BEST)) || 0);
  const hud = useRef<Record<string, HTMLElement | null>>({});
  const last = useRef<Record<string, string>>({});
  const bind = (key: string) => (el: HTMLElement | null) => { hud.current[key] = el; };

  const names = useMemo(() => (members.data ?? []).map((m) => m.display_name ?? '').filter(Boolean), [members.data]);
  const options = useMemo(() => riderOptions(tourData.data, me, day), [tourData.data, me, day]);
  const [pickId, setPickId] = useState<string | null>(() => lsGet(LS_RIDER));
  const keyOf = (o: RiderOption) => `${o.id ?? 'x'}:${o.type}`;
  const chosen = options.find((o) => keyOf(o) === pickId) ?? options[0];
  // echte Vorlage: Zielort der heutigen oder nächsten Flachetappe (sonst Vorschau aus dem Tour-Plan)
  const ref = useMemo(() => stageRef('sprint', tour?.name, tourData.data?.stages, day), [tour?.name, tourData.data, day]);
  const mine = season.data?.find((b) => b.user_id === me.id);
  const myBest = Math.max(best, mine?.best ?? 0);

  const makeEngine = () => {
    const eng = new SprintRace({
      dayKey: day,
      names,
      rider: chosen,
      rivals: rivalNames(tourData.data, chosen.id),
      trains: sprintTrains(tourData.data, chosen.id, day),
      mate: teamMate(tourData.data, chosen.id, 'sprint')?.name ?? null,
      kit: teamKit('gruppetto', chosen.number, { bike: bikes.current }),
      town: ref,
      ghosts: gh.ghosts,
      onEvent: (e) => cbs.current.onEvent(e),
      onOver: (r) => cbs.current.onOver(r),
    });
    eng.setViewport(stageEl.current?.clientWidth || 390);
    return eng;
  };
  // was das Rennen ausmacht: ändert es sich hinter dem Startblatt, wird es gleich neu angelegt (nicht erst beim Start)
  const raceKey = `${day}|${names.join(',')}|${chosen.id ?? ''}:${chosen.type}|${bikes.current}|${ref ? JSON.stringify(ref) : ''}|${tourData.data ? 1 : 0}|${gh.sig}`;
  const race = usePreparedRace({ engineRef, uiRef, key: raceKey, settled: gh.settled && !!members.data && !tourData.loading, make: makeEngine });

  const bannerKey = useRef(0);
  const onEvent = (e: SprintEvent) => {
    if (e.type === 'count') { setCount(e.n); return; }
    bannerKey.current += 1;
    setBanner({ key: bannerKey.current, title: e.title, sub: e.sub, tone: e.tone });
  };

  // Messmodus (Admin oder ?mess): Messfahrt und Kostenanalyse wie in der Abfahrt
  const rendererRef = useRef<Renderer3D | null>(null);
  const meas = useMeasure({
    admin: !!me.is_admin, game: 'Sprint', renderer: () => rendererRef.current,
    meta: () => ({ strecke: gameSubFor('sprint', day, ref), tag: day }),
    onResume: () => { if (uiRef.current === 'paused') setUi('playing'); },
  });
  const onOver = (r: SprintResult) => {
    meas.m.stop();
    setResult(r);
    setUi('over');
    setCoach(null);
    lsSet(LS_RUNS, String((Number(lsGet(LS_RUNS)) || 0) + 1));
    if (r.score > (Number(lsGet(LS_BEST)) || 0)) { lsSet(LS_BEST, String(r.score)); setBest(r.score); }
    if (r.score > 0) source.submitScore('sprint', r.score, SPRINT_FINISH, { avg_kmh: r.avgKmh, top_kmh: r.topKmh, reserve: r.reserve, place: r.place, riders: r.riders, bike: bikes.current, type: TYPE_STATS[chosen.type].label }).then(() => invalidate('game:sprint')).catch(() => undefined);
    gh.save({ score: r.score, meters: SPRINT_FINISH, trace: r.trace, bike: bikes.current });
  };

  /** Tutorial der ersten Sprints: Hinterrad wechseln am Anfang, Antreten im Finale */
  const runCoach = (h: SprintHud, dt: number) => {
    const c = coachRef.current;
    if (!c.on || uiRef.current !== 'playing') return;
    c.t += dt;
    const show = (k: Coach | null) => { c.cur = k; c.t = 0; setCoach(k); };
    if (!c.shown.has('steer') && c.t > 1) { c.shown.add('steer'); show('steer'); return; }
    if (c.cur === 'steer' && c.t > 5) show(null);
    if (!c.shown.has('go') && h.toGo < 330 && h.toGo > 0) { c.shown.add('go'); show('go'); return; }
    if (c.cur === 'go' && (h.mode === 'go' || h.toGo <= 0 || c.t > 6)) { c.on = false; show(null); }
  };

  const writeHud = (eng: SprintRace, dt = 0) => {
    if (uiRef.current !== 'playing' && uiRef.current !== 'paused') return;
    const h = eng.hud();
    runCoach(h, dt);
    writeBar(hud.current, last.current, raceBar(h.board, h.toGo > 0 ? dist(h.toGo) : 'Ziel', 'flag', 1 - h.toGo / SPRINT_FINISH));
    writeRing(hud.current, last.current, { kmh: h.kmh, fill: h.energy, tone: 'energy', mode: h.mode, draft: h.draft });
  };

  // Rückrufe des Rennens immer aus dem aktuellen Stand (das Rennen kann lange vor dem Start angelegt sein)
  const cbs = useRef({ onEvent, onOver });
  cbs.current = { onEvent, onOver };

  const glGen = useRaceLoop({
    perf: meas.m.perf, onRenderer: (r) => { rendererRef.current = r; },
    game: 'sprint',
    stageRef: stageEl, engineRef, uiRef,
    make: race.make,
    onFrame: writeHud,
    onGlError: () => setGlError(true),
    onHidden: () => setUi('paused'),
  });

  // Vorschau im Startbildschirm: Feld des Tages mit dem gewählten Fahrer (sobald Namen/Zielort da sind)
  useEffect(() => {
    if (uiRef.current === 'ready' && engineRef.current) engineRef.current = makeEngine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names, ref, chosen.name, chosen.type, bikes.current]);

  useGameLock();

  const start = () => {
    if (!stageEl.current) return;
    // das Rennen hinter dem Startblatt ist schon vorbereitet (usePreparedRace) – beim Start nichts neu bauen
    engineRef.current = race.take();
    engineRef.current.start();
    setResult(null);
    setShowBoard(false);
    setBanner(null);
    last.current = {};
    coachRef.current = { on: (Number(lsGet(LS_RUNS)) || 0) < 3, t: 0, shown: new Set(), cur: null };
    setCoach(null);
    setUi('countdown');
    window.setTimeout(() => { if (uiRef.current === 'countdown') setUi('playing'); }, 2300);
  };

  const togglePause = () => {
    if (uiRef.current === 'playing') setUi('paused');
    else if (uiRef.current === 'paused') setUi('playing');
  };

  useRaceKeys(engineRef, uiRef, start, togglePause);

  const choose = (o: RiderOption) => {
    setPickId(keyOf(o));
    lsSet(LS_RIDER, keyOf(o));
  };


  const boardRows = board === 'day' ? today.data ?? [] : season.data ?? [];
  // Wetter der nächsten Fahrt (wechselt über den Tag, siehe weather.ts)
  const wetter = nextWeatherName();
  const flammePct = ((SPRINT_FINISH - 1000) / SPRINT_FINISH) * 100;
  const boardView = (
    <FinaleBoard game="sprint" title="Bestenliste Sprint" rows={boardRows} board={board} setBoard={setBoard} members={members.data ?? []} meId={me.id} onBack={() => setShowBoard(false)} unit={['Sprint', 'Sprints']} />
  );

  return (
    <div className={cx('abf', 'abf--sprint', `abf--${ui}`)}>
      {/* 3D-Bühne: die Leinwand kommt aus dem Vorrat (pool.ts) und wird hier eingehängt */}
      <div
        key={glGen}
        ref={stageEl}
        className="abf__stage"
        role="application"
        aria-label="Spielfeld: Finger seitlich ziehen wechselt das Hinterrad, rechte Taste halten zum Antreten, linke Taste halten nimmt Tempo raus"
      />
      {ui === 'playing' || ui === 'countdown' || ui === 'paused' ? (
        <RaceControls eng={() => engineRef.current} enabled={ui === 'playing' || ui === 'countdown'} gas="Antreten" brake="Tempo raus" hint={coach === 'go' ? 'gas' : null} />
      ) : null}
      {glError ? (
        <div className="abf-layer">
          <div className="abf-card abf-card--small">
            <h2 className="abf-title">3D nicht verfügbar</h2>
            <p className="abf-muted">Dein Browser kann gerade keine 3D-Grafik (WebGL) anzeigen. Probier es in Safari oder Chrome noch einmal.</p>
            <button type="button" className="btn btn--secondary btn--full" onClick={() => navigate('/')}><span>Zurück</span></button>
          </div>
        </div>
      ) : null}

      {/* HUD erst mit „Los“ (gestaffelt herein) – im Countdown nur Welt und Ring */}
      {ui === 'playing' || ui === 'paused' ? (
        <div className="abf-hud hud">
          <div className="hud-top">
            <button type="button" className="abf-round" onClick={togglePause} aria-label={ui === 'paused' ? 'Weiter' : 'Pause'}>
              {ui === 'paused' ? <PlayIcon /> : <PauseIcon />}
            </button>
            <RaceBar bind={bind} marks={[{ at: flammePct / 100, kind: 'flamme' }]} />
            <PowerRing bind={bind} />
          </div>
          {banner && ui === 'playing' ? <HudBanner banner={banner} onEnd={() => setBanner(null)} /> : null}
          <TvAd hidden={!!coach || ui !== 'playing'} seed={2} />
        </div>
      ) : null}

      {coach && ui === 'playing' ? (
        <div key={coach} className="abf-coach spr-coach" role="status">
          <span className={cx('abf-coach__gesture', COACH[coach].g)} aria-hidden="true"><i /></span>
          <span className="abf-coach__text"><strong>{COACH[coach].t}</strong><span>{COACH[coach].s}</span></span>
        </div>
      ) : null}

      {ui === 'countdown' ? <Countdown count={count} /> : null}

      {ui === 'paused' ? (
        <PauseSheet game="Sprintfinale" id="sprint" status={(() => { const h = engineRef.current?.hud(); return h ? [<><b>{h.place}.</b> von {h.riders}</>, <>noch <b>{dist(h.toGo)}</b></>, <Kraft k={h.energy} />] : undefined; })()} onResume={() => setUi('playing')} onQuit={() => navigate('/')} extra={meas.menu(() => engineRef.current)} />
      ) : null}

      {meas.overlays(ui === 'paused')}

      {ui === 'ready' ? (
        <StartSheet
          game="sprint" title="Sprintfinale"
          sub={gameSubFor('sprint', day, ref)}
          onStart={start} onClose={() => navigate('/')} plain={showBoard}
          after={meas.m.can ? <><button type="button" className="btn btn--ghost btn--sm" onClick={() => { start(); meas.m.start(); }}>Losfahren mit Messfahrt</button>{meas.abSelect}</> : null}
        >
          {showBoard ? boardView : (
            <>
              <RiderPicker options={options} chosen={chosen} onChoose={choose} info={(t) => TYPE_STATS[t]} bars={sprintBars} />
              <HowTo items={[...controlsHowTo('Antreten', 'Tempo raus'), ...(wetter ? [['☼', wetter] as [string, string]] : [])]} />
              <BikeChip bikes={bikes} />
              <BoardLink rows={today.data?.length ? today.data : season.data ?? []} label={today.data?.length ? 'Heute' : 'Saison'} members={members.data ?? []} meId={me.id} onOpen={() => setShowBoard(true)} fmt={nf} />
            </>
          )}
        </StartSheet>
      ) : null}

      {ui === 'over' && result ? (
        <OverSheet game="sprint" onClose={() => navigate('/')} plain={showBoard}>
          {showBoard ? boardView : (
            <SprintSummary
              bikes={bikes}
              result={result}
              rider={chosen}
              record={result.score >= myBest && result.score > 0}
              today={today.data ?? []}
              season={season.data ?? []}
              meId={me.id}
              onAgain={() => againWithIntro('sprint', 'Sprintfinale', () => { engineRef.current = race.make(); }, start)}
              onRider={() => { setResult(null); setUi('ready'); }}
              onBoard={() => setShowBoard(true)}
            />
          )}
        </OverSheet>
      ) : null}
    </div>
  );
}

function SprintSummary({ bikes, result, rider, record, today, season, meId, onAgain, onRider, onBoard }: {
  bikes: Bikes; result: SprintResult; rider: RiderOption; record: boolean; today: GameBest[]; season: GameBest[]; meId: string;
  onAgain: () => void; onRider: () => void; onBoard: () => void;
}) {
  const shown = useCountUp(result.score);
  const win = result.place === 1;
  const parts: [string, number][] = [
    [`${result.place}. Platz`, result.parts.place],
    ['Windschatten', result.parts.draft],
    ['Plätze gutgemacht', result.parts.gain],
    [`${TYPE_STATS[rider.type].label}-Bonus`, result.parts.type],
  ];
  const line = verdict({ game: 'sprint', seed: result.score, place: result.place, riders: result.riders, win, pb: record, reserve: result.reserve, gapS: win ? undefined : result.gap, leader: result.winner });
  return (
    <section className="abf-summary" aria-label="Ergebnis">
      <div className="abf-sum-top">
        <div className="abf-badges">
          <span className={cx('abf-badge', (win || record) && 'is-gold')}>
            <Icon name={win ? 'trophy' : record ? 'star' : 'flag'} size={14} />
            {win ? 'Etappensieg!' : record ? 'Bestleistung' : 'Im Ziel'}
          </span>
          <NewBikePill bikes={bikes} />
        </div>
        <p className="abf-score"><strong>{nf(shown)}</strong><span className="sr-only"> Punkte</span></p>
        <p className="rp-gap">{win ? 'Sprintsieg vor dem ganzen Feld' : result.gap < 0.05 ? `zeitgleich mit ${result.winner}` : `+${result.gap.toFixed(2).replace('.', ',')} s auf ${result.winner}`}</p>
      </div>
      <Verdict line={line} />
      <RunTiles tiles={raceTiles({ place: result.place, riders: result.riders, avgKmh: result.avgKmh, reserve: result.reserve, topKmh: result.topKmh })} />
      <Standing today={today} season={season} meId={meId} score={result.score} fmt={nf} bestWord="Bestleistung" onBoard={onBoard} />
      <Podium podium={result.podium} />
      <dl className="abf-parts spr-parts">
        {parts.filter(([, v]) => v > 0).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{nf(v)}</dd>
          </div>
        ))}
      </dl>
      <ReportActions onAgain={onAgain} onBoard={onBoard} />
      <button type="button" className="abf-link spr-change" onClick={onRider}>Anderen Fahrer wählen<Icon name="chevron" size={14} /></button>
    </section>
  );
}
