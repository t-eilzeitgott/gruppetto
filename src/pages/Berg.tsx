import { useEffect, useMemo, useRef, useState } from 'react';
import { prewarm } from '../game/abfahrt/pool';
import type { WarmArgs } from '../app/warm';
import { useApp } from '../app/context';
import { useMembers, useTourData } from '../app/hooks';
import { invalidate, useQuery } from '../app/query';
import { navigate } from '../app/router';
import { source } from '../app/config';
import type { GameBest } from '../data/source';
import { BERG_STATS, BergRace, bergBars, type BergEvent, type BergHud, type BergResult } from '../game/abfahrt/berg';
import { riderOptions, rivalNames, teamMate, type RiderOption } from '../game/abfahrt/sprintRiders';
import { stageRef } from '../game/abfahrt/stageRef';
import { gameSubFor } from '../game/gameSub';
import { MOUNTAIN_FINISH, MOUNTAIN_TOP, Track } from '../game/abfahrt/track';
import { nextWeatherName } from '../game/abfahrt/weather';
import { berlinDayKey, berlinDayStart } from '../game/abfahrt/rng';
import { HudBanner, PowerRing, RaceBar, SwapIcon, TvAd, raceBar, writeBar, writeRing } from './hud';
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
import { RaceControls, controlsHowTo, type ControlsHandle } from './controls';
import { teamKit } from '../game/teams';
import {
  FinaleBoard, HowTo, Podium, RiderPicker, dist, lsGet, lsSet, nf,
  againWithIntro, useGameLock, usePreparedRace, useRaceKeys, useRaceLoop, type Board, type Ui,
} from './finale';

const LS_RIDER = 'gruppetto.berg.rider';
const LS_RUNS = 'gruppetto.berg.runs';
const LS_BEST = 'gruppetto.berg.best';

type Coach = 'attack' | 'tuck';
const COACH: Record<Coach, { t: string; s: string; g: string }> = {
  attack: { t: 'Mitgehen oder angreifen', s: 'Rechte Taste halten – kostet Kraft', g: 'is-tuck' },
  tuck: { t: 'Abfahrt: ducken', s: 'Rechte Taste = schneller · vor Kehren loslassen, dann bremst die Automatik', g: 'is-tuck' },
};

const bars = (t: RiderOption['type']): [string, number][] => {
  const b = bergBars(t);
  return [['Bergauf', b.climb], ['Antritt', b.kick], ['Abfahrt', b.desc]];
};

const sec = (s: number) => s.toFixed(1).replace('.', ',');

/** Startbild des Bergfinales ohne Seite: beim App-Start unsichtbar vorwärmen (siehe app/warm.ts) */
export function warmBerg(a: WarmArgs, reuse = false): Promise<void> {
  const options = riderOptions(a.data, a.me, a.day);
  const pick = lsGet(LS_RIDER);
  const chosen = options.find((o) => `${o.id ?? 'x'}:${o.type}` === pick) ?? options.find((o) => o.type === 'climber') ?? options[0];
  const town = stageRef('mountain', a.tour?.name, a.data?.stages, a.day);
  return prewarm(() => new BergRace({
    dayKey: a.day,
    names: a.names,
    rider: chosen,
    rivals: rivalNames(a.data, chosen.id, 'climb'),
    mate: teamMate(a.data, chosen.id, 'climb')?.name ?? null,
    kit: teamKit('gruppetto', chosen.number, { bike: a.bike }),
    town,
    onEvent: () => undefined,
    onOver: () => undefined,
  }), { accent: a.accent, dark: a.dark }, 'berg', reuse);
}

/** Minispiel „Bergfinale“: Schlussanstieg in der Favoritengruppe, Bergwertung, Abfahrt ins Ziel */
export function BergPage() {
  useTitle('Bergfinale');
  const { me, tour } = useApp();
  const members = useMembers();
  const tourData = useTourData(tour);
  const day = berlinDayKey();
  const since = useMemo(() => berlinDayStart().toISOString(), [day]);
  const season = useQuery<GameBest[]>('game:berg:season', () => source.gameLeaderboard('berg'));
  const bikes = useBikes();
  const gh = useGameGhosts('berg');
  const today = useQuery<GameBest[]>(`game:berg:day:${day}`, () => source.gameLeaderboard('berg', since));

  const stageEl = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<BergRace | null>(null);
  const [glError, setGlError] = useState(false);
  const [ui, setUi] = useState<Ui>('ready');
  const uiRef = useRef<Ui>('ready');
  uiRef.current = ui;
  const [count, setCount] = useState(3);
  const [result, setResult] = useState<BergResult | null>(null);
  const [banner, setBanner] = useState<{ key: number; title: string; sub?: string; tone?: 'gold' | 'accent' | 'red' } | null>(null);
  const [board, setBoard] = useState<Board>('day');
  const [showBoard, setShowBoard] = useState(false);
  const [coach, setCoach] = useState<Coach | null>(null);
  /** Steuerung (controls.tsx): Beschriftung nach Lage, Warnung vor Kehren */
  const controls = useRef<ControlsHandle | null>(null);
  const coachRef = useRef<{ on: boolean; t: number; shown: Set<Coach>; cur: Coach | null; attacked: boolean }>({ on: false, t: 0, shown: new Set(), cur: null, attacked: false });
  const [best, setBest] = useState(() => Number(lsGet(LS_BEST)) || 0);
  const hud = useRef<Record<string, HTMLElement | null>>({});
  const last = useRef<Record<string, string>>({});
  const bind = (key: string) => (el: HTMLElement | null) => { hud.current[key] = el; };

  const names = useMemo(() => (members.data ?? []).map((m) => m.display_name ?? '').filter(Boolean), [members.data]);
  const options = useMemo(() => riderOptions(tourData.data, me, day), [tourData.data, me, day]);
  const [pickId, setPickId] = useState<string | null>(() => lsGet(LS_RIDER));
  const keyOf = (o: RiderOption) => `${o.id ?? 'x'}:${o.type}`;
  const chosen = options.find((o) => keyOf(o) === pickId) ?? options.find((o) => o.type === 'climber') ?? options[0];
  // echte Vorlage: Schlussanstieg der heutigen oder nächsten Bergetappe (sonst Vorschau aus dem Tour-Plan)
  const ref = useMemo(() => stageRef('mountain', tour?.name, tourData.data?.stages, day), [tour?.name, tourData.data, day]);
  const track = useMemo(() => new Track(day, names, 'mountain', ref), [day, names, ref]);
  const mine = season.data?.find((b) => b.user_id === me.id);
  const myBest = Math.max(best, mine?.best ?? 0);

  const makeEngine = () => {
    const eng = new BergRace({
      dayKey: day,
      names,
      rider: chosen,
      rivals: rivalNames(tourData.data, chosen.id, 'climb'),
      mate: teamMate(tourData.data, chosen.id, 'climb')?.name ?? null,
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
  const onEvent = (e: BergEvent) => {
    if (e.type === 'count') { setCount(e.n); return; }
    if (e.title.startsWith('Attacke')) coachRef.current.attacked = true;
    bannerKey.current += 1;
    setBanner({ key: bannerKey.current, title: e.title, sub: e.sub, tone: e.tone });
  };

  // Messmodus (Admin oder ?mess): Messfahrt und Kostenanalyse wie in der Abfahrt
  const rendererRef = useRef<Renderer3D | null>(null);
  const meas = useMeasure({
    admin: !!me.is_admin, game: 'Berg', renderer: () => rendererRef.current,
    meta: () => ({ strecke: track.title, tag: day }),
    onResume: () => { if (uiRef.current === 'paused') setUi('playing'); },
  });
  const onOver = (r: BergResult) => {
    meas.m.stop();
    setResult(r);
    setUi('over');
    setCoach(null);
    lsSet(LS_RUNS, String((Number(lsGet(LS_RUNS)) || 0) + 1));
    if (r.score > (Number(lsGet(LS_BEST)) || 0)) { lsSet(LS_BEST, String(r.score)); setBest(r.score); }
    if (r.score > 0) source.submitScore('berg', r.score, MOUNTAIN_FINISH, { avg_kmh: r.avgKmh, top_kmh: r.topKmh, reserve: r.reserve, place: r.place, riders: r.riders, bike: bikes.current, slides: r.slides, type: BERG_STATS[chosen.type].label }).then(() => invalidate('game:berg')).catch(() => undefined);
    gh.save({ score: r.score, meters: MOUNTAIN_FINISH, trace: r.trace, bike: bikes.current });
  };

  /** Tutorial der ersten Läufe: bei der ersten Attacke mitgehen, in der Abfahrt ducken */
  const runCoach = (h: BergHud, dt: number) => {
    const c = coachRef.current;
    if (!c.on || uiRef.current !== 'playing') return;
    c.t += dt;
    const show = (k: Coach | null) => { c.cur = k; c.t = 0; setCoach(k); };
    if (!c.shown.has('attack') && h.stage === 'climb' && (c.attacked || h.toTop < 320)) { c.shown.add('attack'); show('attack'); return; }
    if (c.cur === 'attack' && (h.mode === 'go' || c.t > 5 || h.stage !== 'climb')) show(null);
    if (!c.shown.has('tuck') && h.stage === 'descent' && h.toTop < -60) { c.shown.add('tuck'); show('tuck'); return; }
    if (c.cur === 'tuck' && c.t > 5.5) { c.on = false; show(null); }
  };

  const writeHud = (eng: BergRace, dt = 0) => {
    if (uiRef.current !== 'playing' && uiRef.current !== 'paused') return;
    const h = eng.hud();
    runCoach(h, dt);
    // Tasten nach Lage benennen; bergab warnt die Gas-Taste vor zu schnellen Kehren
    const c = controls.current;
    if (c) {
      if (h.stage === 'descent') c.labels('Ducken', 'Bremse');
      else if (h.stage === 'final') c.labels('Sprint', 'Erholen');
      else c.labels('Angreifen', 'Erholen');
      c.warn(h.warn && uiRef.current === 'playing');
    }
    const set = (key: string, val: string) => {
      if (last.current[key] === val) return;
      last.current[key] = val;
      const el = hud.current[key];
      if (el) el.textContent = val;
    };
    // vor dem Gipfel: Meter bis zur Bergwertung (gepunktetes Symbol), danach bis ins Ziel
    const toText = h.toTop > 0 ? dist(h.toTop) : h.toGo > 0 ? dist(h.toGo) : 'Ziel';
    writeBar(hud.current, last.current, raceBar(h.board, toText, h.toTop > 0 ? 'gpm' : 'flag', 1 - h.toGo / MOUNTAIN_FINISH));
    const g = Math.round(h.grade);
    writeRing(hud.current, last.current, {
      kmh: h.kmh, fill: h.energy, tone: 'energy', mode: h.mode, draft: h.draft,
      badge: h.toGo > 0 ? `${g > 0 ? '▲' : g < 0 ? '▼' : ''} ${Math.abs(g)} %` : '',
    });
    const mate = hud.current.mate;
    if (mate) {
      mate.classList.toggle('is-off', !h.mate || uiRef.current !== 'playing');
      if (h.mate) {
        mate.classList.toggle('is-me', !h.mate.front);
        set('mateState', h.mate.front ? 'Helfer vorn' : 'Du vorn');
      }
    }
  };

  // Rückrufe des Rennens immer aus dem aktuellen Stand (das Rennen kann lange vor dem Start angelegt sein)
  const cbs = useRef({ onEvent, onOver });
  cbs.current = { onEvent, onOver };

  const glGen = useRaceLoop({
    perf: meas.m.perf, onRenderer: (r) => { rendererRef.current = r; },
    game: 'berg',
    stageRef: stageEl, engineRef, uiRef,
    make: race.make,
    onFrame: writeHud,
    onGlError: () => setGlError(true),
    onHidden: () => setUi('paused'),
  });

  // Vorschau im Startbildschirm: Gruppe des Tages mit dem gewählten Fahrer
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
    coachRef.current = { on: (Number(lsGet(LS_RUNS)) || 0) < 3, t: 0, shown: new Set(), cur: null, attacked: false };
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
  const boardView = (
    <FinaleBoard game="berg" title="Bestenliste Bergfinale" rows={boardRows} board={board} setBoard={setBoard} members={members.data ?? []} meId={me.id} onBack={() => setShowBoard(false)} unit={['Bergfinale', 'Bergfinals']} />
  );

  return (
    <div className={cx('abf', 'abf--sprint', 'abf--berg', `abf--${ui}`)}>
      {/* 3D-Bühne: die Leinwand kommt aus dem Vorrat (pool.ts) und wird hier eingehängt */}
      <div
        key={glGen}
        ref={stageEl}
        className="abf__stage"
        role="application"
        aria-label="Spielfeld: Finger seitlich ziehen wechselt das Hinterrad, rechte Taste halten zum Angreifen (bergab ducken), linke Taste halten zum Erholen (bergab bremsen)"
      />
      {ui === 'playing' || ui === 'countdown' || ui === 'paused' ? (
        <RaceControls eng={() => engineRef.current} enabled={ui === 'playing' || ui === 'countdown'} gas="Angreifen" brake="Erholen" hint={coach ? 'gas' : null} ctl={controls} />
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
            <RaceBar bind={bind} marks={[{ at: MOUNTAIN_TOP / MOUNTAIN_FINISH, kind: 'gpm' }, { at: (MOUNTAIN_FINISH - 1000) / MOUNTAIN_FINISH, kind: 'flamme' }]} />
            <PowerRing bind={bind} badge />
          </div>
          {banner && ui === 'playing' ? <HudBanner banner={banner} onEnd={() => setBanner(null)} /> : null}
          <button type="button" className="hud-mate is-off" ref={bind('mate')} onClick={() => engineRef.current?.swapMate()} aria-label="Führung mit dem Helfer tauschen">
            <span className="hud-mate__ico"><SwapIcon /></span>
            <small ref={bind('mateState')}>Helfer vorn</small>
          </button>
          <TvAd hidden={!!coach || ui !== 'playing'} seed={5} />
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
        <PauseSheet game="Bergfinale" id="berg" status={(() => { const h = engineRef.current?.hud(); return h ? [<><b>{h.place}.</b> von {h.riders}</>, h.toTop > 0 ? <>noch <b>{dist(h.toTop)}</b> zum Gipfel</> : <>noch <b>{dist(h.toGo)}</b></>, <Kraft k={h.energy} />] : undefined; })()} onResume={() => setUi('playing')} onQuit={() => navigate('/')} extra={meas.menu(() => engineRef.current)} />
      ) : null}

      {meas.overlays(ui === 'paused')}

      {ui === 'ready' ? (
        <StartSheet
          game="berg" title="Bergfinale"
          sub={gameSubFor('berg', day, ref)}
          onStart={start} onClose={() => navigate('/')} plain={showBoard}
          after={meas.m.can ? <><button type="button" className="btn btn--ghost btn--sm" onClick={() => { start(); meas.m.start(); }}>Losfahren mit Messfahrt</button>{meas.abSelect}</> : null}
        >
          {showBoard ? boardView : (
            <>
              <BergProfile track={track} />
              <RiderPicker options={options} chosen={chosen} onChoose={choose} info={(t) => BERG_STATS[t]} bars={bars} />
              <HowTo items={[...controlsHowTo('Angreifen', 'Erholen'), ['⇄', 'Helfer'], ...(wetter ? [['☼', wetter] as [string, string]] : [])]} />
              <BikeChip bikes={bikes} />
              <BoardLink rows={today.data?.length ? today.data : season.data ?? []} label={today.data?.length ? 'Heute' : 'Saison'} members={members.data ?? []} meId={me.id} onOpen={() => setShowBoard(true)} fmt={nf} />
            </>
          )}
        </StartSheet>
      ) : null}

      {ui === 'over' && result ? (
        <OverSheet game="berg" onClose={() => navigate('/')} plain={showBoard}>
          {showBoard ? boardView : (
            <BergSummary
              bikes={bikes}
              result={result}
              rider={chosen}
              record={result.score >= myBest && result.score > 0}
              today={today.data ?? []}
              season={season.data ?? []}
              meId={me.id}
              onAgain={() => againWithIntro('berg', 'Bergfinale', () => { engineRef.current = race.make(); }, start)}
              onRider={() => { setResult(null); setUi('ready'); }}
              onBoard={() => setShowBoard(true)}
            />
          )}
        </OverSheet>
      ) : null}
    </div>
  );
}

/** Höhenprofil: Schlussanstieg bis zur Bergwertung, Abfahrt ins Ziel */
function BergProfile({ track }: { track: Track }) {
  const W = 300;
  const H = 46;
  const pts = useMemo(() => {
    const n = 60;
    const ys: number[] = [];
    for (let i = 0; i <= n; i++) ys.push(track.realHeightAt((i / n) * MOUNTAIN_FINISH));
    const top = Math.max(...ys);
    const low = Math.min(...ys);
    return ys.map((y, i) => [(i / n) * W, 4 + ((top - y) / Math.max(1, top - low)) * (H - 10)] as [number, number]);
  }, [track]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const summit = track.summit;
  const topX = (MOUNTAIN_TOP / MOUNTAIN_FINISH) * 100;
  return (
    <figure className="abf-profile brg-profile" aria-label={`Profil: ${MOUNTAIN_TOP} m bergauf bis ${summit.name}, dann Abfahrt ins Ziel`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={`${line} L${W},${H} L0,${H} Z`} className="abf-profile__area" />
        <path d={line} className="abf-profile__line" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="brg-profile__gpm" style={{ left: `${topX}%` }}>
        <i aria-hidden="true" />
        <span>GPM · {summit.alt.toLocaleString('de-DE')} m</span>
      </span>
      <span className="brg-profile__finish">Ziel</span>
    </figure>
  );
}

function BergSummary({ bikes, result, rider, record, today, season, meId, onAgain, onRider, onBoard }: {
  bikes: Bikes; result: BergResult; rider: RiderOption; record: boolean; today: GameBest[]; season: GameBest[]; meId: string;
  onAgain: () => void; onRider: () => void; onBoard: () => void;
}) {
  const shown = useCountUp(result.score);
  const win = result.place === 1;
  const parts: [string, number][] = [
    [`${result.place}. Platz`, result.parts.place],
    ['Bergwertung', result.parts.gpm],
    ['Vorsprung', result.parts.gap],
    [`${BERG_STATS[rider.type].label}-Bonus`, result.parts.type],
  ];
  const gapText = win
    ? (result.gap < -0.3 ? `${sec(-result.gap)} s Vorsprung` : 'Sieg am Berg')
    : result.gap < 0.05 ? 'gleiche Zeit' : `+${sec(result.gap)} s`;
  const line = verdict({ game: 'berg', seed: result.score, place: result.place, riders: result.riders, win, pb: record, reserve: result.reserve, gapS: win ? undefined : result.gap, slides: result.slides, leader: result.winner });
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
        <p className="rp-gap">{win ? gapText : result.gap < 0.05 ? `zeitgleich mit ${result.winner}` : `${gapText} auf ${result.winner}`} · Bergwertung {result.gpmPlace}.</p>
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
