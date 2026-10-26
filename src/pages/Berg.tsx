import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useApp } from '../app/context';
import { useMembers, useTourData } from '../app/hooks';
import { invalidate, useQuery } from '../app/query';
import { navigate } from '../app/router';
import { source } from '../app/config';
import type { GameBest } from '../data/source';
import { BERG_STATS, BergRace, bergBars, type BergEvent, type BergHud, type BergResult } from '../game/abfahrt/berg';
import { riderOptions, rivalNames, stageOfDay, type RiderOption } from '../game/abfahrt/sprintRiders';
import { MOUNTAIN_FINISH, MOUNTAIN_TOP, Track } from '../game/abfahrt/track';
import { berlinDayKey, berlinDayStart } from '../game/abfahrt/rng';
import { cx, useTitle } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { BergIcon } from '../ui/GameIcon';
import { lastName } from '../ui/bits';
import { BrakeIcon, PauseIcon, PlayIcon, TuckIcon, readAccent, useCountUp } from './Game';
import {
  FinaleBoard, FinaleMini, HowTo, Podium, RiderPicker, dist, lsGet, lsSet, nf, placeIn, placeThumb,
  useGameLock, useRaceKeys, useRaceLoop, type Board, type Ui,
} from './finale';

const LS_RIDER = 'gruppetto.berg.rider';
const LS_RUNS = 'gruppetto.berg.runs';
const LS_BEST = 'gruppetto.berg.best';

type Coach = 'attack' | 'tuck';
const COACH: Record<Coach, { t: string; s: string; g: string }> = {
  attack: { t: 'Mitgehen oder angreifen', s: 'Daumen hoch und halten – kostet Kraft', g: 'is-tuck' },
  tuck: { t: 'Abfahrt: ducken', s: 'Daumen hoch = schneller · vor Kehren loslassen', g: 'is-tuck' },
};

const bars = (t: RiderOption['type']): [string, number][] => {
  const b = bergBars(t);
  return [['Bergauf', b.climb], ['Antritt', b.kick], ['Abfahrt', b.desc]];
};

const sec = (s: number) => s.toFixed(1).replace('.', ',');

/** Minispiel „Bergfinale“: Schlussanstieg in der Favoritengruppe, Bergwertung, Abfahrt ins Ziel */
export function BergPage() {
  useTitle('Bergfinale');
  const { me, tour } = useApp();
  const members = useMembers();
  const tourData = useTourData(tour);
  const day = berlinDayKey();
  const since = useMemo(() => berlinDayStart().toISOString(), [day]);
  const season = useQuery<GameBest[]>('game:berg:season', () => source.gameLeaderboard('berg'));
  const today = useQuery<GameBest[]>(`game:berg:day:${day}`, () => source.gameLeaderboard('berg', since));

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
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
  const stage = useMemo(() => (tourData.data ? stageOfDay(tourData.data.stages, day) : null), [tourData.data, day]);
  const town = stage && stage.kind === 'mountain' ? stage.arrival ?? '' : '';
  const track = useMemo(() => new Track(day, names, 'mountain', town), [day, names, town]);
  const mine = season.data?.find((b) => b.user_id === me.id);
  const myBest = Math.max(best, mine?.best ?? 0);

  const makeEngine = () => {
    const accent = readAccent();
    const eng = new BergRace({
      dayKey: day,
      names,
      rider: chosen,
      rivals: rivalNames(tourData.data, chosen.id, 'climb'),
      kit: { jersey: accent, side: '#ffffff', helmet: '#ffffff', shorts: '#16171a', skin: '#f0c4a0', shoes: '#ffffff', number: chosen.number },
      town,
      onEvent: (e) => onEvent(e),
      onOver: (r) => onOver(r),
    });
    eng.setViewport(canvasRef.current?.getBoundingClientRect().width ?? 390);
    return eng;
  };

  const bannerKey = useRef(0);
  const onEvent = (e: BergEvent) => {
    if (e.type === 'count') { setCount(e.n); return; }
    if (e.title.startsWith('Attacke')) coachRef.current.attacked = true;
    bannerKey.current += 1;
    setBanner({ key: bannerKey.current, title: e.title, sub: e.sub, tone: e.tone });
  };

  const onOver = (r: BergResult) => {
    setResult(r);
    setUi('over');
    setCoach(null);
    lsSet(LS_RUNS, String((Number(lsGet(LS_RUNS)) || 0) + 1));
    if (r.score > (Number(lsGet(LS_BEST)) || 0)) { lsSet(LS_BEST, String(r.score)); setBest(r.score); }
    if (r.score > 0) source.submitScore('berg', r.score, MOUNTAIN_FINISH).then(() => invalidate('game:berg')).catch(() => undefined);
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
    placeThumb(hud.current.thumb, h.touch, uiRef.current === 'playing', h.mode === 'go', h.mode === 'ease');
    const set = (key: string, val: string) => {
      if (last.current[key] === val) return;
      last.current[key] = val;
      const el = hud.current[key];
      if (el) el.textContent = val;
    };
    set('place', `${h.place}.`);
    set('riders', `von ${h.riders}`);
    set('kmh', String(h.kmh));
    set('toGo', h.toTop > 0 ? `Gipfel ${dist(h.toTop)}` : h.toGo > 0 ? `noch ${dist(h.toGo)}` : 'Ziel');
    const en = hud.current.energy;
    if (en) {
      en.style.setProperty('--e', h.energy.toFixed(3));
      en.classList.toggle('is-go', h.mode === 'go');
      en.classList.toggle('is-low', h.energy < 0.18);
    }
    const label = h.stage === 'descent'
      ? (h.mode === 'go' ? 'Ducken' : h.mode === 'ease' ? 'Bremsen' : 'Kraft')
      : h.mode === 'go' ? (h.stage === 'final' ? 'Sprint' : 'Attacke') : h.mode === 'ease' ? 'Erholen' : 'Kraft';
    set('energyLabel', label);
    const g = Math.round(h.grade);
    set('grade', `${g > 0 ? '▲' : g < 0 ? '▼' : ''} ${Math.abs(g)} %`);
    const draftEl = hud.current.draft;
    if (draftEl) {
      draftEl.style.opacity = h.stage === 'descent' && h.draft > 0.15 ? '1' : '0';
      draftEl.style.setProperty('--d', h.draft.toFixed(2));
    }
    const lead = hud.current.lead;
    if (lead) {
      if (h.lead && h.toGo > 0) {
        const l = h.lead;
        const text = l.name === 'Du'
          ? (l.gap < -0.5 ? `Du führst · ${sec(-l.gap)} s` : 'Du führst')
          : l.gap < 0.8 ? 'In der Spitzengruppe' : `Spitze: ${lastName(l.name)} · +${sec(l.gap)} s`;
        set('leadText', text);
        lead.style.opacity = '1';
        lead.classList.toggle('is-front', l.name === 'Du' || l.gap < 0.8);
      } else lead.style.opacity = '0';
    }
    const dot = hud.current.dot;
    if (dot) dot.style.left = `${Math.min(100, (1 - h.toGo / MOUNTAIN_FINISH) * 100).toFixed(2)}%`;
  };

  useRaceLoop({
    canvasRef, overlayRef, engineRef, uiRef,
    make: makeEngine,
    onFrame: writeHud,
    onGlError: () => setGlError(true),
    onHidden: () => setUi('paused'),
  });

  // Vorschau im Startbildschirm: Gruppe des Tages mit dem gewählten Fahrer
  useEffect(() => {
    if (uiRef.current === 'ready' && engineRef.current) engineRef.current = makeEngine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names, town, chosen.name, chosen.type]);

  useGameLock();

  const start = () => {
    if (!canvasRef.current) return;
    engineRef.current = makeEngine();
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

  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (ui !== 'playing' && ui !== 'countdown') return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    engineRef.current?.pointerDown(e.clientX, e.clientY);
  };
  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.buttons === 0) return;
    engineRef.current?.pointerMove(e.clientX, e.clientY);
  };
  const onPointerUp = () => engineRef.current?.pointerUp();

  const boardRows = board === 'day' ? today.data ?? [] : season.data ?? [];
  const pct = (z: number) => `${((z / MOUNTAIN_FINISH) * 100).toFixed(1)}%`;
  const boardView = (
    <FinaleBoard title="Bestenliste Bergfinale" rows={boardRows} board={board} setBoard={setBoard} members={members.data ?? []} meId={me.id} onBack={() => setShowBoard(false)} unit={['Bergfinale', 'Bergfinals']} />
  );

  return (
    <div className={cx('abf', 'abf--sprint', 'abf--berg', `abf--${ui}`)}>
      <canvas
        ref={canvasRef}
        className="abf__canvas"
        aria-label="Spielfeld: Daumen seitlich ziehen wechselt das Hinterrad, nach oben angreifen (bergab ducken), nach unten Tempo rausnehmen (bergab bremsen)"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <canvas ref={overlayRef} className="abf__overlay" aria-hidden="true" />
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
        <div className="abf-hud" aria-hidden={ui === 'countdown'}>
          <div className="abf-hud__top">
            <button type="button" className="abf-round" onClick={togglePause} aria-label={ui === 'paused' ? 'Weiter' : 'Pause'}>
              {ui === 'paused' ? <PlayIcon /> : <PauseIcon />}
            </button>
            <div className="spr-place">
              <strong ref={bind('place')}>–</strong>
              <span ref={bind('riders')} />
            </div>
            <div className="abf-hud__speed">
              <span><strong ref={bind('kmh')}>0</strong>&nbsp;km/h</span>
              <span className="abf-hud__dist" ref={bind('toGo')} />
            </div>
          </div>
          <div className="abf-strip spr-strip" aria-hidden="true">
            <div className="abf-strip__line" />
            <span className="brg-strip__gpm" style={{ left: pct(MOUNTAIN_TOP) }} />
            <span className="spr-strip__flamme" style={{ left: pct(MOUNTAIN_FINISH - 1000) }} />
            <span className="spr-strip__finish" />
            <span className="abf-strip__dot" ref={bind('dot')} />
          </div>
          <div className="spr-energy" ref={bind('energy')}>
            <span ref={bind('energyLabel')}>Kraft</span>
            <i aria-hidden="true" />
            <b className="brg-grade" ref={bind('grade')} />
          </div>
          <div className="abf-next spr-wheel brg-lead" ref={bind('lead')}>
            <Icon name="flag" size={14} />
            <span ref={bind('leadText')} />
          </div>
          <div className="abf-draft spr-draft" ref={bind('draft')}>
            <span>Windschatten</span>
            <i aria-hidden="true" />
          </div>
          <div className="abf-thumb" ref={bind('thumb')} aria-hidden="true">
            <span className="abf-thumb__up"><TuckIcon /></span>
            <span className="abf-thumb__dot" />
            <span className="abf-thumb__down"><BrakeIcon /></span>
          </div>
        </div>
      ) : null}

      {banner && (ui === 'playing' || ui === 'countdown') ? (
        <div key={banner.key} className={cx('abf-banner', banner.tone && `abf-banner--${banner.tone}`)} onAnimationEnd={() => setBanner(null)}>
          <strong>{banner.title}</strong>
          {banner.sub ? <span>{banner.sub}</span> : null}
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
                  <BergIcon size={44} />
                  <div>
                    <h1 className="abf-title">Bergfinale</h1>
                    <p className="abf-sub">{stage && town ? `${stage.number}. Etappe · ` : ''}{track.title}</p>
                  </div>
                </div>
                <BergProfile track={track} />
                <RiderPicker options={options} chosen={chosen} onChoose={choose} info={(t) => BERG_STATS[t]} bars={bars} />
                <HowTo items={[['↔', 'Hinterrad'], ['↑', 'Angreifen · bergab ducken'], ['↓', 'Erholen · bremsen']]} />
                <button type="button" className="btn btn--primary btn--full abf-go" onClick={start}><span>Losfahren</span></button>
                <FinaleMini rows={today.data?.length ? today.data : season.data ?? []} label={today.data?.length ? 'Heute' : 'Saison'} members={members.data ?? []} meId={me.id} onOpen={() => setShowBoard(true)} empty="Noch niemand am Berg – hol dir den ersten Tagessieg!" />
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
              <BergSummary
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

/** Höhenprofil: Schlussanstieg bis zur Bergwertung, Abfahrt ins Ziel */
function BergProfile({ track }: { track: Track }) {
  const W = 300;
  const H = 46;
  const pts = useMemo(() => {
    const n = 60;
    const ys: number[] = [];
    for (let i = 0; i <= n; i++) ys.push(track.heightAt((i / n) * MOUNTAIN_FINISH));
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

function BergSummary({ result, rider, record, today, season, meId, onAgain, onRider, onBoard }: {
  result: BergResult; rider: RiderOption; record: boolean; today: GameBest[]; season: GameBest[]; meId: string;
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
    ? (result.gap < -0.3 ? `${sec(-result.gap)} s Vorsprung` : 'Sieger')
    : result.gap < 0.05 ? 'gleiche Zeit' : `+${sec(result.gap)} s`;
  return (
    <section className="abf-summary" aria-label="Ergebnis">
      <div className="abf-sum-top">
        <span className={cx('abf-badge', (win || record) && 'is-gold')}>
          <Icon name={win ? 'trophy' : record ? 'star' : 'flag'} size={14} />
          {win ? 'Etappensieg!' : record ? 'Bestleistung' : `${result.place}. von ${result.riders}`}
        </span>
        <p className="abf-score"><strong>{nf(shown)}</strong><span className="sr-only"> Punkte</span></p>
        <div className="abf-stats">
          <span><Icon name="podium" size={15} />{result.place}.&nbsp;Platz</span>
          <span><Icon name="clock" size={15} />{gapText}</span>
          <span><Icon name="zap" size={15} />{result.topKmh}&nbsp;km/h</span>
        </div>
        <p className="abf-muted">
          Bergwertung: {result.gpmPlace}.{result.slides > 0 ? ` · ${result.slides}× abgerutscht` : ''}
        </p>
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
