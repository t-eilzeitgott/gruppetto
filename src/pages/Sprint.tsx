import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
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
import { shortTour, stageRef } from '../game/abfahrt/stageRef';
import { SPRINT_FINISH, Track } from '../game/abfahrt/track';
import { berlinDayKey, berlinDayStart } from '../game/abfahrt/rng';
import { HudBanner, PowerRing, RaceBar, TvAd, raceBar, writeBar, writeRing } from './hud';
import { cx, useTitle } from '../ui/kit';
import { useBikes, type Bikes } from '../ui/useBikes';
import { BikeChip, NewBikePill } from './bikeChip';
import { Icon } from '../ui/Icon';
import { SprintIcon } from '../ui/GameIcon';
import { BrakeIcon, PauseIcon, PlayIcon, TuckIcon, readAccent, useCountUp } from './Game';
import { FpsSwitch } from './gameKit';
import {
  FinaleBoard, FinaleMini, HowTo, Podium, RiderPicker, dist, lsGet, lsSet, nf, placeIn, placeThumb,
  useGameLock, useRaceKeys, useRaceLoop, type Board, type Ui,
} from './finale';

const LS_RIDER = 'gruppetto.sprint.rider';
const LS_RUNS = 'gruppetto.sprint.runs';
const LS_BEST = 'gruppetto.sprint.best';

type Coach = 'steer' | 'go';
const COACH: Record<Coach, { t: string; s: string; g: string }> = {
  steer: { t: 'Hinterrad wechseln', s: 'Daumen seitlich ziehen – im Windschatten sparst du Kraft', g: 'is-steer' },
  go: { t: 'Antreten!', s: 'Daumen nach oben schieben und halten', g: 'is-tuck' },
};

const sprintBars = (t: RiderOption['type']): [string, number][] => {
  const b = typeBars(t);
  return [['Endspeed', b.top], ['Antritt', b.acc], ['Ausdauer', b.end]];
};

/** Startbild des Sprints ohne Seite: beim App-Start unsichtbar vorwärmen (siehe app/warm.ts) */
export function warmSprint(a: WarmArgs): Promise<void> {
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
    kit: { jersey: a.accent, side: '#ffffff', helmet: '#ffffff', shorts: '#16171a', skin: '#f0c4a0', shoes: '#ffffff', number: chosen.number, bike: a.bike },
    town,
    onEvent: () => undefined,
    onOver: () => undefined,
  }), { accent: a.accent, dark: a.dark });
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
  const track = useMemo(() => new Track(day, names, 'sprint', ref), [day, names, ref]);
  const mine = season.data?.find((b) => b.user_id === me.id);
  const myBest = Math.max(best, mine?.best ?? 0);

  const makeEngine = () => {
    const accent = readAccent();
    const eng = new SprintRace({
      dayKey: day,
      names,
      rider: chosen,
      rivals: rivalNames(tourData.data, chosen.id),
      trains: sprintTrains(tourData.data, chosen.id, day),
      mate: teamMate(tourData.data, chosen.id, 'sprint')?.name ?? null,
      kit: { jersey: accent, side: '#ffffff', helmet: '#ffffff', shorts: '#16171a', skin: '#f0c4a0', shoes: '#ffffff', number: chosen.number, bike: bikes.current },
      town: ref,
      onEvent: (e) => onEvent(e),
      onOver: (r) => onOver(r),
    });
    eng.setViewport(stageEl.current?.getBoundingClientRect().width ?? 390);
    return eng;
  };

  const bannerKey = useRef(0);
  const onEvent = (e: SprintEvent) => {
    if (e.type === 'count') { setCount(e.n); return; }
    bannerKey.current += 1;
    setBanner({ key: bannerKey.current, title: e.title, sub: e.sub, tone: e.tone });
  };

  const onOver = (r: SprintResult) => {
    setResult(r);
    setUi('over');
    setCoach(null);
    lsSet(LS_RUNS, String((Number(lsGet(LS_RUNS)) || 0) + 1));
    if (r.score > (Number(lsGet(LS_BEST)) || 0)) { lsSet(LS_BEST, String(r.score)); setBest(r.score); }
    if (r.score > 0) source.submitScore('sprint', r.score, SPRINT_FINISH).then(() => invalidate('game:sprint')).catch(() => undefined);
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
    placeThumb(hud.current.thumb, h.touch, uiRef.current === 'playing', h.mode === 'go', h.mode === 'ease');
    writeBar(hud.current, last.current, raceBar(h.board, h.toGo > 0 ? dist(h.toGo) : 'Ziel', 'flag', 1 - h.toGo / SPRINT_FINISH));
    writeRing(hud.current, last.current, { kmh: h.kmh, fill: h.energy, tone: 'energy', mode: h.mode, draft: h.draft });
  };

  const glGen = useRaceLoop({
    stageRef: stageEl, engineRef, uiRef,
    make: makeEngine,
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
    engineRef.current = makeEngine();
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

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (ui !== 'playing' && ui !== 'countdown') return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    engineRef.current?.pointerDown(e.clientX, e.clientY);
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.buttons === 0) return;
    engineRef.current?.pointerMove(e.clientX, e.clientY);
  };
  const onPointerUp = () => engineRef.current?.pointerUp();

  const boardRows = board === 'day' ? today.data ?? [] : season.data ?? [];
  const flammePct = ((SPRINT_FINISH - 1000) / SPRINT_FINISH) * 100;
  const boardView = (
    <FinaleBoard title="Bestenliste Sprint" rows={boardRows} board={board} setBoard={setBoard} members={members.data ?? []} meId={me.id} onBack={() => setShowBoard(false)} unit={['Sprint', 'Sprints']} />
  );

  return (
    <div className={cx('abf', 'abf--sprint', `abf--${ui}`)}>
      {/* 3D-Bühne: die Leinwand kommt aus dem Vorrat (pool.ts) und wird hier eingehängt */}
      <div
        key={glGen}
        ref={stageEl}
        className="abf__stage"
        role="application"
        aria-label="Spielfeld: Daumen seitlich ziehen wechselt das Hinterrad, nach oben antreten, nach unten Tempo rausnehmen"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {glError ? (
        <div className="abf-layer">
          <div className="abf-card abf-card--small">
            <h2 className="abf-title">3D nicht verfügbar</h2>
            <p className="abf-muted">Dein Browser kann gerade keine 3D-Grafik (WebGL) anzeigen. Probier es in Safari oder Chrome noch einmal.</p>
            <button type="button" className="btn btn--secondary btn--full" onClick={() => navigate('/')}><span>Zurück</span></button>
          </div>
        </div>
      ) : null}

      {ui === 'playing' || ui === 'paused' || ui === 'countdown' ? (
        <div className="abf-hud hud" aria-hidden={ui === 'countdown'}>
          <div className="hud-top">
            <button type="button" className="abf-round" onClick={togglePause} aria-label={ui === 'paused' ? 'Weiter' : 'Pause'}>
              {ui === 'paused' ? <PlayIcon /> : <PauseIcon />}
            </button>
            <RaceBar bind={bind} marks={[{ at: flammePct / 100, kind: 'flamme' }]} />
            <PowerRing bind={bind} />
          </div>
          {banner && (ui === 'playing' || ui === 'countdown') ? <HudBanner banner={banner} onEnd={() => setBanner(null)} /> : null}
          <div className="abf-thumb" ref={bind('thumb')} aria-hidden="true">
            <span className="abf-thumb__up"><TuckIcon /></span>
            <span className="abf-thumb__dot" />
            <span className="abf-thumb__down"><BrakeIcon /></span>
          </div>
          <TvAd hidden={!!coach || ui !== 'playing'} seed={2} />
        </div>
      ) : null}

      {coach && ui === 'playing' ? (
        <div key={coach} className="abf-coach spr-coach" role="status">
          <span className={cx('abf-coach__gesture', COACH[coach].g)} aria-hidden="true"><i /></span>
          <span className="abf-coach__text"><strong>{COACH[coach].t}</strong><span>{COACH[coach].s}</span></span>
        </div>
      ) : null}

      {ui === 'countdown' ? (
        <div className="abf-count" aria-live="assertive">
          <span key={count}>{count > 0 ? count : 'Los!'}</span>
        </div>
      ) : null}

      {ui === 'paused' ? (
        <div className="abf-layer">
          <div className="abf-card abf-card--small">
            <h2 className="abf-title">Pause</h2>
            <button type="button" className="btn btn--primary btn--full" onClick={() => setUi('playing')}><span>Weiterfahren</span></button>
            <button type="button" className="btn btn--secondary btn--full" onClick={() => navigate('/')}><span>Aufhören</span></button>
            <FpsSwitch />
          </div>
        </div>
      ) : null}

      {ui === 'ready' ? (
        <div className="abf-layer">
          <button type="button" className="abf-round abf-close" onClick={() => navigate('/')} aria-label="Schließen"><Icon name="x" size={20} /></button>
          <div className="abf-card abf-scroll">
            {showBoard ? boardView : (
              <>
                <div className="abf-head">
                  <SprintIcon size={44} />
                  <div>
                    <h1 className="abf-title">Sprintfinale</h1>
                    <p className="abf-sub">{ref ? `${shortTour(ref.tour)} · ${ref.stage}. Etappe · ` : ''}{track.title.replace('Sprintfinale in ', 'Ziel in ')} · 2,4 km</p>
                    {ref?.finale?.line ? <p className="abf-sub abf-sub--finale">Echtes Finale: {ref.finale.line}</p> : null}
                  </div>
                </div>
                <RiderPicker options={options} chosen={chosen} onChoose={choose} info={(t) => TYPE_STATS[t]} bars={sprintBars} />
                <HowTo items={[['↔', 'Hinterrad'], ['↑', 'Antreten'], ['↓', 'Tempo raus']]} />
                <button type="button" className="btn btn--primary btn--full abf-go" onClick={start}><span>Losfahren</span></button>
                <BikeChip bikes={bikes} />
                <FinaleMini rows={today.data?.length ? today.data : season.data ?? []} label={today.data?.length ? 'Heute' : 'Saison'} members={members.data ?? []} meId={me.id} onOpen={() => setShowBoard(true)} empty="Noch keine Sprints – hol dir den ersten Tagessieg!" />
              </>
            )}
          </div>
        </div>
      ) : null}

      {ui === 'over' && result ? (
        <div className="abf-layer">
          <button type="button" className="abf-round abf-close" onClick={() => navigate('/')} aria-label="Schließen"><Icon name="x" size={20} /></button>
          <div className="abf-card abf-scroll">
            {showBoard ? boardView : (
              <SprintSummary
                bikes={bikes}
                result={result}
                rider={chosen}
                record={result.score >= myBest && result.score > 0}
                today={today.data ?? []}
                season={season.data ?? []}
                meId={me.id}
                onAgain={start}
                onRider={() => { setResult(null); setUi('ready'); }}
                onBoard={() => setShowBoard(true)}
              />
            )}
          </div>
        </div>
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
  return (
    <section className="abf-summary" aria-label="Ergebnis">
      <div className="abf-sum-top">
        <div className="abf-badges">
          <span className={cx('abf-badge', (win || record) && 'is-gold')}>
            <Icon name={win ? 'trophy' : record ? 'star' : 'flag'} size={14} />
            {win ? 'Etappensieg!' : record ? 'Bestleistung' : `${result.place}. von ${result.riders}`}
          </span>
          <NewBikePill bikes={bikes} />
        </div>
        <p className="abf-score"><strong>{nf(shown)}</strong><span className="sr-only"> Punkte</span></p>
        <div className="abf-stats">
          <span><Icon name="podium" size={15} />{result.place}.&nbsp;Platz</span>
          <span><Icon name="clock" size={15} />{win ? 'Sieger' : result.gap < 0.05 ? 'gleiche Zeit' : `+${result.gap.toFixed(2).replace('.', ',')} s`}</span>
          <span><Icon name="zap" size={15} />{result.topKmh}&nbsp;km/h</span>
        </div>
        <p className="abf-muted">{result.launchAt > 0 ? `Angetreten ${Math.round(result.launchAt)} m vor dem Ziel` : 'Nicht angetreten'}</p>
        <div className="abf-places">
          <span><Icon name="podium" size={15} /><b>{placeIn(today, meId, result.score)}.</b>&nbsp;heute</span>
          <span><Icon name="trophy" size={15} /><b>{placeIn(season, meId, result.score)}.</b>&nbsp;Saison</span>
        </div>
      </div>
      <Podium podium={result.podium} />
      <dl className="abf-parts spr-parts">
        {parts.filter(([, v]) => v > 0).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{nf(v)}</dd>
          </div>
        ))}
      </dl>
      <div className="abf-actions">
        <button type="button" className="btn btn--primary btn--full" onClick={onAgain}><Icon name="refresh" size={18} /><span>Nochmal</span></button>
        <button type="button" className="btn btn--secondary abf-actions__board" onClick={onBoard} aria-label="Bestenliste"><Icon name="podium" size={20} /></button>
      </div>
      <button type="button" className="abf-link spr-change" onClick={onRider}>Anderen Fahrer wählen<Icon name="chevron" size={14} /></button>
    </section>
  );
}
