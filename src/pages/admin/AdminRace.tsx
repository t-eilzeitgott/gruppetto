/**
 * Abfahrt auf WebGPU (Admin): das ganze Spiel mit der neuen Grafik – Startkarte, Countdown, Fahrt mit Punkten,
 * Kombos, Hinweisen und Sturz, Ergebnis. Keine Bestenlisten, nichts wird gespeichert (nur die Einstellungen).
 * Im Pausenmenü: Himmel und Licht (dramatischer Himmel, Sonnenuntergangs-Licht …), Welt, Kamera, Technik und
 * die Messfahrt für Berichte vom Gerät.
 */
import React, { useEffect, useRef, useState } from 'react';
import { navigate } from '../../app/router';
import { useMembers } from '../../app/hooks';
import { cx, Segmented, useTitle } from '../../ui/kit';
import { Icon } from '../../ui/Icon';
import { useGameLock, PauseIcon, PlayIcon, lsGet, lsSet } from '../gameKit';
import { HudBanner, PowerRing, RaceBar, writeBar, writeRing, type HudBannerData } from '../hud';
import { useBikes } from '../../ui/useBikes';
import { BUILD_ID } from '../../app/config';
import { berlinDayKey } from '../../game/abfahrt/rng';
import { SCORE_LABEL, type GameEvent, type RunResult, type ScoreCat } from '../../game/abfahrt/engine';
import type { Kit } from '../../game/abfahrt/rider';
import type { Race, RaceCam, RaceStats } from '../../game/gpu/race';
import type { Report } from '../../game/gpu/perf';
import { loadSettings, MOOD_IDS, MOODS, RACE_DEFAULTS, RACE_KEY, type MoodId, type Settings } from '../../game/gpu/mood';
import { copyText, lsRead, lsWrite, shareFile } from './gpuKit';

type Ui = 'loading' | 'ready' | 'countdown' | 'playing' | 'paused' | 'over';

const LS_REPORT = 'gruppetto.gpu.race.lastReport';
const LS_FPS = 'gruppetto.gpu.race.fps';
const nf = (n: number) => Math.round(n).toLocaleString('de-DE');
const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`);

const SKY: { k: keyof Settings; label: string; hint: string }[] = [
  { k: 'drama', label: 'Dramatischer Himmel', hint: 'Quellwolken, angestrahlte Wolkenfelder, Strahlen – gebacken, kostet beim Fahren nichts' },
  { k: 'sunset', label: 'Sonnenuntergangs-Licht', hint: 'Warmer Schein um die tiefe Sonne, ganz dezent – fast kostenlos' },
  { k: 'cycle', label: 'Wetterwechsel', hint: 'Alle Stimmungen der Reihe nach (alle 16 s)' },
  { k: 'shadows', label: 'Sonnenschatten', hint: 'Weiche Schatten um den Fahrer' },
  { k: 'bloom', label: 'Leuchten', hint: 'Glanz um helle Stellen (Bloom)' },
  { k: 'grade', label: 'Farbfilter', hint: 'Wärme, Kontrast, kühle Schatten' },
  { k: 'vignette', label: 'Vignette', hint: 'Dunklere Bildränder' },
  { k: 'grain', label: 'Filmkorn', hint: '' },
  { k: 'fog', label: 'Dunst', hint: 'Luftperspektive in der Ferne' },
  { k: 'rain', label: 'Regenstreifen', hint: 'Bei Regen' },
];
const WORLD: { k: keyof Settings; label: string; hint: string }[] = [
  { k: 'crowd', label: 'Zuschauer', hint: '' },
  { k: 'life', label: 'Blumen, Sträucher, Tiere', hint: '' },
  { k: 'grass', label: 'Grashalme', hint: 'Am Straßenrand' },
];
const CAMS: { value: RaceCam; label: string }[] = [
  { value: 'chase', label: 'Verfolger' },
  { value: 'low', label: 'Tief' },
  { value: 'side', label: 'Seite' },
  { value: 'drone', label: 'Drohne' },
];
const ORDER: ScoreCat[] = ['dist', 'overtake', 'bidons', 'draft', 'curves', 'near', 'air', 'bonus'];

function Switch({ on, label, hint, onChange }: { on: boolean; label: string; hint?: string; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={cx('abf-switch abf-switch--sub', on && 'is-on')} onClick={() => onChange(!on)}>
      <span className="abf-switch__text"><span>{label}</span>{hint ? <small>{hint}</small> : null}</span>
      <span className="abf-switch__track" aria-hidden="true"><span className="abf-switch__knob" /></span>
    </button>
  );
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="race-slider">
      <span>{label} <em>{value.toFixed(step >= 1 ? 0 : 2)}</em></span>
      <input type="range" min={min} max={max} step={step} value={value}
        onInput={(e: React.FormEvent<HTMLInputElement>) => onChange(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function TuckIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V5M8 9l4-4 4 4" /></svg>;
}
function BrakeIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v15M8 15l4 4 4-4" /></svg>;
}

export function RaceGpuPage() {
  useTitle('Abfahrt · WebGPU');
  useGameLock();
  const members = useMembers();
  const bikes = useBikes();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const raceRef = useRef<Race | null>(null);
  const [ui, setUi] = useState<Ui>('loading');
  const uiRef = useRef<Ui>('loading');
  uiRef.current = ui;
  const [stats, setStats] = useState<RaceStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(3);
  const [banner, setBanner] = useState<HudBannerData | null>(null);
  const bannerKey = useRef(0);
  const [result, setResult] = useState<RunResult | null>(null);
  const [cruise, setCruise] = useState(0);
  const [settings, setSettings] = useState<Settings>(() => loadSettings(RACE_KEY, RACE_DEFAULTS));
  const [cam, setCam] = useState<RaceCam>('chase');
  const [auto, setAuto] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [showFps, setShowFps] = useState(() => lsGet(LS_FPS) === '1');
  const [title, setTitle] = useState('');
  const [veil, setVeil] = useState(true);
  // Messfahrt
  const [measuring, setMeasuring] = useState(false);
  const [recInfo, setRecInfo] = useState({ s: 0, hitches: 0 });
  const [report, setReport] = useState<Report | null>(null);
  const [lastReport, setLastReport] = useState<string | null>(() => lsRead(LS_REPORT));
  const [copied, setCopied] = useState(false);
  // Kostenanalyse: Fortschritt und Ergebnis
  const [cost, setCost] = useState<{ i: number; n: number; label: string } | null>(null);
  const [costText, setCostText] = useState<string | null>(null);
  const [costCopied, setCostCopied] = useState(false);
  const hud = useRef<Record<string, HTMLElement | null>>({});
  const last = useRef<Record<string, string>>({});
  const bind = (key: string) => (el: HTMLElement | null) => { hud.current[key] = el; };
  const names = (members.data ?? []).map((m) => (m.display_name ?? '').trim()).filter(Boolean);
  const namesRef = useRef(names);
  namesRef.current = names;
  const bikeRef = useRef(bikes.current);
  bikeRef.current = bikes.current;

  const onEvent = (e: GameEvent) => {
    if (e.type === 'count') { setCount(e.n); if (e.n <= 0) window.setTimeout(() => { if (uiRef.current === 'countdown') setUi('playing'); }, 450); return; }
    if (e.type === 'section') { bannerKey.current += 1; setBanner({ key: bannerKey.current, title: e.name, sub: `${e.alt.toLocaleString('de-DE')} m` }); return; }
    if (e.type === 'tip') { bannerKey.current += 1; setBanner({ key: bannerKey.current, title: e.text }); }
  };
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  /** HUD jedes Bild direkt in die Elemente (kein React-Render) */
  const writeHud = () => {
    const r = raceRef.current;
    const u = uiRef.current;
    if (!r || (u !== 'playing' && u !== 'paused' && u !== 'countdown')) return;
    const h = r.hud();
    if (!h) return;
    const th = hud.current.thumb;
    if (th) {
      if (h.touch && u === 'playing') {
        th.style.opacity = '1';
        th.style.visibility = 'visible';
        th.style.transform = `translate(${h.touch.x.toFixed(0)}px, ${h.touch.y.toFixed(0)}px)`;
        th.classList.toggle('is-tuck', h.wantTuck);
        th.classList.toggle('is-brake', h.wantBrake > 0.3);
      } else { th.style.opacity = '0'; th.style.visibility = 'hidden'; }
    }
    const set = (key: string, val: string) => {
      if (last.current[key] === val) return;
      last.current[key] = val;
      const el = hud.current[key];
      if (el) el.textContent = val;
    };
    set('score', nf(h.score));
    set('mult', `×${h.mult}`);
    const multEl = hud.current.multWrap;
    if (multEl) { multEl.style.opacity = h.mult > 1 ? '1' : '0'; multEl.style.setProperty('--left', String(h.multLeft)); }
    writeBar(hud.current, last.current, { place: '', gap: '', label: '', dist: km(h.meters), icon: 'road', lead: false, progress: (h.meters % 4000) / 4000 });
    writeRing(hud.current, last.current, { kmh: h.kmh, fill: Math.min(1, h.kmh / 100), tone: 'speed', mode: h.wantTuck ? 'go' : h.wantBrake > 0.3 ? 'ease' : 'sit', draft: h.draft });
  };
  const writeHudRef = useRef(writeHud);
  writeHudRef.current = writeHud;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let alive = true;
    let race: Race | null = null;
    let lastUi = 0;
    void import('../../game/gpu/race').then(({ Race: R }) => {
      if (!alive) return;
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff5fa2';
      const kit: Kit = { jersey: accent, side: '#ffffff', helmet: '#ffffff', shorts: '#16171a', skin: '#f0c4a0', shoes: '#ffffff', number: '27', bike: bikeRef.current };
      race = new R(host, {
        dayKey: berlinDayKey(),
        names: namesRef.current,
        kit,
        onStats: (s) => {
          const now = performance.now();
          if (s.loading >= 1 && now - lastUi < 400) return;
          lastUi = now;
          if (s.loading >= 1) race?.perf.event(16);
          setStats({ ...s });
        },
        onReady: () => { setUi('ready'); setTitle(race?.title ?? ''); },
        onError: (e) => setError(String(e)),
        onEvent: (e) => onEventRef.current(e),
        onOver: (res) => { setResult(res); setUi('over'); },
        onFrame: () => writeHudRef.current(),
      });
      race.overlay.accent = accent;
      raceRef.current = race;
      (window as unknown as { __race?: Race }).__race = race;
      race.start().catch((e) => { console.error(e); setError(e instanceof Error ? e.message : String(e)); });
    }).catch((e) => setError(String(e)));
    const onResize = () => race?.resize();
    const onVis = () => { if (document.hidden && uiRef.current === 'playing') pause(true); };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      race?.dispose();
      raceRef.current = null;
      delete (window as unknown as { __race?: Race }).__race;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ui === 'loading') return;
    const id = window.setTimeout(() => setVeil(false), 650);
    return () => window.clearTimeout(id);
  }, [ui]);

  const change = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    raceRef.current?.applySettings(next);
  };

  const go = (k = 0) => {
    const r = raceRef.current;
    if (!r) return;
    setCruise(k);
    setResult(null);
    setBanner(null);
    setSheet(false);
    last.current = {};
    r.autopilot = auto;
    r.go(k);
    setCount(3);
    setUi('countdown');
  };
  const pause = (on: boolean) => {
    const r = raceRef.current;
    if (!r) return;
    if (on && uiRef.current !== 'playing' && uiRef.current !== 'countdown') return;
    r.paused = on;
    r.pointerUp();
    setUi(on ? 'paused' : 'playing');
  };
  const toStart = () => {
    raceRef.current?.toStart();
    setResult(null);
    setSheet(false);
    setUi('ready');
  };

  // Daumensteuerung (wie im Spiel)
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (ui !== 'playing' && ui !== 'countdown') return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    raceRef.current?.pointerDown(e.clientX, e.clientY);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.buttons === 0) return;
    raceRef.current?.pointerMove(e.clientX, e.clientY);
  };
  const onUp = () => raceRef.current?.pointerUp();

  // Tastatur
  useEffect(() => {
    const map: Record<string, 'left' | 'right' | 'down' | 'up'> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', ArrowUp: 'up', a: 'left', d: 'right', s: 'down', w: 'up' };
    const down = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') { if (uiRef.current === 'ready' || uiRef.current === 'over') { e.preventDefault(); go(cruise); } return; }
      if (e.key === 'Escape' || e.key === 'p') { pause(uiRef.current !== 'paused'); return; }
      const k = map[e.key];
      if (k) { e.preventDefault(); raceRef.current?.key(k, true); }
    };
    const up = (e: KeyboardEvent) => { const k = map[e.key]; if (k) raceRef.current?.key(k, false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  });

  // Messfahrt
  const startMeasure = () => {
    const r = raceRef.current;
    if (!r) return;
    const diff: Partial<Settings> = {};
    for (const k of Object.keys(settings) as (keyof Settings)[]) if (settings[k] !== RACE_DEFAULTS[k]) (diff as Record<string, unknown>)[k] = settings[k];
    r.startMeasure({ version: BUILD_ID, einstellungen: diff, aufnahme: new Date().toISOString() });
    setMeasuring(true);
    setReport(null);
    if (uiRef.current === 'paused') pause(false);
  };
  const stopMeasure = () => {
    const r = raceRef.current?.stopMeasure() ?? null;
    setMeasuring(false);
    if (r) { setReport(r); setCopied(false); lsWrite(LS_REPORT, r.text); setLastReport(r.text); }
  };
  const runCost = () => {
    const r = raceRef.current;
    if (!r || cost) return;
    setCost({ i: 0, n: 1, label: 'startet' });
    void r.costAnalysis((i, n, label) => setCost({ i, n, label })).then((t) => { setCost(null); setCostText(t); setCostCopied(false); })
      .catch((e: unknown) => { setCost(null); setError(String(e)); });
  };
  useEffect(() => {
    if (!measuring) return;
    const id = window.setInterval(() => { const p = raceRef.current?.perf; if (p) setRecInfo({ s: p.recSeconds, hitches: p.hitches }); }, 500);
    return () => window.clearInterval(id);
  }, [measuring]);

  const moodName = (id: MoodId) => MOODS[id].name.replace('Goldene Stunde', 'Abend');
  const pct = Math.round((stats?.loading ?? 0) * 100);
  const running = ui === 'playing' || ui === 'paused' || ui === 'countdown';

  const settingsPanel = (
    <>
      <div className="race-sec">
        <span className="abf-range__label">Stimmung</span>
        <Segmented label="Stimmung" value={settings.mood} options={MOOD_IDS.map((id) => ({ value: id, label: moodName(id) }))} onChange={(id) => change({ mood: id, cycle: false })} />
      </div>
      <div className="abf-gfx">
        <span className="abf-range__label">Himmel und Licht</span>
        {SKY.map((t) => <Switch key={t.k} on={!!settings[t.k]} label={t.label} hint={t.hint} onChange={(v) => change({ [t.k]: v } as Partial<Settings>)} />)}
      </div>
      <div className="abf-gfx">
        <span className="abf-range__label">Welt</span>
        {WORLD.map((t) => <Switch key={t.k} on={!!settings[t.k]} label={t.label} hint={t.hint} onChange={(v) => change({ [t.k]: v } as Partial<Settings>)} />)}
        <Slider label="Gegner im Bild (höchstens)" value={settings.oppMax} min={0} max={16} step={1} onChange={(v) => change({ oppMax: v })} />
        <Slider label="Bäume in der Ferne bis (m)" value={settings.treeFar} min={300} max={1850} step={50} onChange={(v) => change({ treeFar: v })} />
      </div>
      <div className="race-sec">
        <span className="abf-range__label">Kamera</span>
        <Segmented label="Kamera" value={cam} options={CAMS} onChange={(c) => { setCam(c); if (raceRef.current) raceRef.current.camMode = c; }} />
      </div>
      <div className="abf-gfx">
        <span className="abf-range__label">Technik</span>
        <Slider label="Auflösung höchstens" value={settings.maxDpr} min={0.7} max={3} step={0.05} onChange={(v) => change({ maxDpr: v })} />
        <Slider label="Auflösung mindestens" value={settings.minDpr} min={0.5} max={2} step={0.05} onChange={(v) => change({ minDpr: v })} />
        <Switch on={settings.msaa > 0} label="Kantenglättung (4×)" hint="Wirkt nach Neuladen der Seite" onChange={(v) => { change({ msaa: v ? 4 : 0 }); window.setTimeout(() => location.reload(), 150); }} />
        <Switch on={showFps} label="Bildrate anzeigen" hint="Bildzeit, CPU, GPU, Auflösung, Nachladen" onChange={(v) => { setShowFps(v); lsSet(LS_FPS, v ? '1' : '0'); }} />
        <Switch on={auto} label="Autopilot" hint="Fährt selbst: Linie, Flaschen, weicht Hindernissen aus" onChange={(v) => { setAuto(v); if (raceRef.current) raceRef.current.autopilot = v; }} />
      </div>
      <div className="race-sec">
        <span className="abf-range__label">Messfahrt</span>
        <span className="abf-range__hint">Zeichnet jedes Bild auf (Bildzeit, CPU je Baustein, GPU, Nachladen der Welt, neue Shader). Danach Bericht kopieren und mir schicken.</span>
        <div className="race-row">
          {measuring ? <button type="button" className="btn btn--secondary btn--sm" onClick={stopMeasure}>Messung beenden</button>
            : <button type="button" className="btn btn--secondary btn--sm" onClick={startMeasure}>Messfahrt starten</button>}
          {lastReport ? <button type="button" className="btn btn--ghost btn--sm" onClick={() => { void copyText(lastReport).then((ok) => setCopied(ok)); }}>{copied ? 'Kopiert ✓' : 'Letzten Bericht kopieren'}</button> : null}
        </div>
      </div>
      <div className="race-sec">
        <span className="abf-range__label">Kostenanalyse</span>
        <span className="abf-range__hint">Misst an dieser Stelle je Ebene (Leuchten, Schatten, Gegner, Bäume, Landschaft …) und Auflösung, was sie kostet – etwa 30 s, das Spiel bleibt solange in der Pause.</span>
        <button type="button" className="btn btn--secondary btn--sm" onClick={runCost} disabled={!!cost}>{cost ? `${cost.i + 1}/${cost.n}: ${cost.label}` : 'Kostenanalyse starten'}</button>
      </div>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => change({ ...RACE_DEFAULTS })}>Grafik zurücksetzen</button>
    </>
  );

  return (
    <div className={cx('abf race', `abf--${ui === 'loading' ? 'ready' : ui}`)}>
      <div ref={hostRef} className="abf__stage" role="application" aria-label="Spielfeld: Daumen seitlich ziehen zum Lenken, nach oben zum Ducken, nach unten zum Bremsen"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />

      {running ? (
        <div className="abf-hud hud" aria-hidden={ui === 'countdown'}>
          <div className="hud-top hud-top--score">
            <button type="button" className="abf-round" onClick={() => pause(ui !== 'paused')} aria-label={ui === 'paused' ? 'Weiter' : 'Pause'}>
              {ui === 'paused' ? <PlayIcon /> : <PauseIcon />}
            </button>
            <div className="hud-score">
              <strong ref={bind('score')}>0</strong>
              <span className="abf-mult" ref={bind('multWrap')}><span ref={bind('mult')}>×1</span><i aria-hidden="true" /></span>
            </div>
            <PowerRing bind={bind} />
          </div>
          <RaceBar bind={bind} wide />
          {banner && ui !== 'paused' ? <HudBanner banner={banner} onEnd={() => setBanner(null)} /> : null}
          <div className="abf-thumb" ref={bind('thumb')} aria-hidden="true">
            <span className="abf-thumb__up"><TuckIcon /></span>
            <span className="abf-thumb__dot" />
            <span className="abf-thumb__down"><BrakeIcon /></span>
          </div>
        </div>
      ) : null}

      {cruise && (ui === 'playing' || ui === 'countdown') ? <CruiseBar race={() => raceRef.current} /> : null}

      {showFps && stats && ui !== 'loading' ? (
        <div className="race-fps">
          <b>{Math.round(stats.fps)} fps</b> {stats.ms.toFixed(1)} ms · CPU {stats.cpu.toFixed(1)}{stats.gpu > 0 ? ` · GPU ${stats.gpu.toFixed(1)}` : ''} · ×{stats.dpr.toFixed(2)} · {stats.calls} Aufrufe
          <br />Welt bis {km(stats.built)} (+{Math.round(stats.built - stats.z)} m) · Nachladen {stats.buildMs.toFixed(2)} ms/Bild · {settings.cycle ? raceRef.current?.moodName : MOODS[settings.mood].name}
        </div>
      ) : null}

      {measuring ? (
        <div className="gpu-rec race-rec">
          <i />
          <span>Messung {Math.floor(recInfo.s / 60)}:{String(Math.floor(recInfo.s % 60)).padStart(2, '0')} · {recInfo.hitches} Ruckler</span>
          <button type="button" onClick={stopMeasure}>Stopp</button>
        </div>
      ) : null}

      {ui === 'countdown' ? (
        <div className="abf-count" aria-live="assertive"><span key={count}>{count > 0 ? count : 'Los!'}</span></div>
      ) : null}

      {ui === 'paused' ? (
        <div className="abf-layer">
          <div className="abf-card abf-scroll race-card">
            <h2 className="abf-title">Pause</h2>
            <button type="button" className="btn btn--primary btn--full" onClick={() => pause(false)}><span>Weiterfahren</span></button>
            <div className="race-row">
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => go(cruise)}>Neu starten</button>
              <button type="button" className="btn btn--secondary btn--sm" onClick={toStart}>Zum Start</button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/admin')}>Aufhören</button>
            </div>
            {settingsPanel}
          </div>
        </div>
      ) : null}

      {ui === 'ready' ? (
        <div className="abf-layer">
          <button type="button" className="abf-round abf-close" onClick={() => navigate('/admin')} aria-label="Schließen"><Icon name="x" size={20} /></button>
          <div className="abf-card abf-scroll race-card">
            <div className="abf-head">
              <span className="race-badge">GPU</span>
              <div>
                <h1 className="abf-title">Abfahrt</h1>
                <p className="abf-sub">{title || 'Passabfahrt'} · WebGPU · Admin-Test</p>
              </div>
            </div>
            <p className="abf-muted">Das ganze Spiel mit der neuen Grafik: endlose Strecke, Gegner, Flaschen, Hindernisse, Tunnel. Ohne Bestenliste – nichts wird gespeichert.</p>
            <button type="button" className="btn btn--primary btn--full abf-go" onClick={() => go(0)}><span>Losfahren</span></button>
            <div className="abf-cruise">
              <span className="abf-muted">Testfahrt ohne Hindernisse, Zeitraffer</span>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => go(2)}>2×</button>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => go(3)}>3×</button>
            </div>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSheet((s) => !s)}>{sheet ? 'Grafik ausblenden' : 'Grafik und Technik'}</button>
            {sheet ? settingsPanel : null}
          </div>
        </div>
      ) : null}

      {ui === 'over' && result ? (
        <div className="abf-layer">
          <button type="button" className="abf-round abf-close" onClick={() => navigate('/admin')} aria-label="Schließen"><Icon name="x" size={20} /></button>
          <div className="abf-card abf-scroll race-card">
            <span className="abf-eyebrow">{cruise ? `Testfahrt ${cruise}× · zählt nicht` : result.reason || 'Fahrt beendet'}</span>
            <div className="race-result">
              <div><strong>{nf(result.score)}</strong><span>Punkte</span></div>
              <div><strong>{km(result.meters)}</strong><span>Strecke</span></div>
              <div><strong>{Math.round(result.topKmh)}</strong><span>km/h max.</span></div>
            </div>
            {result.sectionName ? <p className="abf-muted">Zuletzt: {result.sectionName}</p> : null}
            <ul className="race-parts">
              {ORDER.filter((k) => result.parts[k] > 0).map((k) => <li key={k}><span>{SCORE_LABEL[k]}</span><b>{nf(result.parts[k])}</b></li>)}
            </ul>
            <button type="button" className="btn btn--primary btn--full abf-go" onClick={() => go(0)}><span>Nochmal</span></button>
            <div className="abf-cruise">
              <span className="abf-muted">Testfahrt</span>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => go(2)}>2×</button>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => go(3)}>3×</button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={toStart}>Start</button>
            </div>
          </div>
        </div>
      ) : null}

      {costText ? (
        <div className="gpu-report">
          <strong>Kostenanalyse fertig</strong>
          <pre className="gpu-report__pre">{costText.split('\n').slice(3).join('\n')}</pre>
          <div className="gpu-menu__row gpu-menu__actions">
            <button type="button" className="gpu-chip is-on" onClick={() => { void copyText(costText).then((ok) => setCostCopied(ok)); }}>{costCopied ? 'Kopiert ✓' : 'Ergebnis kopieren'}</button>
            <button type="button" className="gpu-chip" onClick={() => setCostText(null)}>Schließen</button>
          </div>
        </div>
      ) : null}
      {report ? (
        <div className="gpu-report">
          <strong>Messfahrt fertig</strong>
          <div className="gpu-report__grid">
            <span>Dauer</span><b>{report.summary.s.toFixed(0)} s</b>
            <span>Bildrate</span><b>{report.summary.fps.toFixed(0)} fps (Takt {Math.round(1000 / report.summary.period)} Hz)</b>
            <span>1 % langsamste</span><b>{report.summary.low1.toFixed(0)} fps</b>
            <span>Ruckler</span><b>{report.summary.hitches}</b>
            <span>schlimmstes Bild</span><b>{report.summary.worst.toFixed(0)} ms</b>
            <span>CPU (95 %)</span><b>{report.summary.cpuP95.toFixed(1)} ms</b>
            <span>GPU (95 %)</span><b>{report.summary.gpuP95 !== null ? `${report.summary.gpuP95.toFixed(1)} ms` : 'nicht messbar'}</b>
          </div>
          <div className="gpu-menu__row gpu-menu__actions">
            <button type="button" className="gpu-chip is-on" onClick={() => { void copyText(report.text).then((ok) => setCopied(ok)); }}>{copied ? 'Kopiert ✓' : 'Bericht kopieren'}</button>
            <button type="button" className="gpu-chip" onClick={() => { void shareFile(report.full, `abfahrt-gpu-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`); }}>Vollständig als Datei</button>
            <button type="button" className="gpu-chip" onClick={() => setReport(null)}>Schließen</button>
          </div>
        </div>
      ) : null}

      {veil && !error ? (
        <div className={`gpu-load${ui === 'loading' ? '' : ' gpu-load--done'}`}>
          <div className="gpu-load__box">
            <strong>Abfahrt</strong>
            <span className="gpu-load__sub">WebGPU · Admin-Test</span>
            <div className="gpu-load__bar"><i style={{ transform: `scaleX(${(stats?.loading ?? 0).toFixed(3)})` }} /></div>
            <span className="gpu-load__stage">{ui === 'loading' ? `${stats?.stage ?? 'WebGPU startet'} … ${pct} %` : 'Los geht’s'}</span>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="gpu-load gpu-load--err">
          <span>{error}</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => navigate('/admin')}>Zurück</button>
        </div>
      ) : null}
    </div>
  );
}

/** Prüfpult der Testfahrt: stehen bleiben, Zeitraffer (wie im Spiel) */
function CruiseBar({ race }: { race: () => Race | null }) {
  const [speed, setSpeed] = useState(() => race()?.dbg?.speed ?? 1);
  const [freeze, setFreeze] = useState(false);
  return (
    <div className="abf-dbg" role="group" aria-label="Prüfpult">
      <button type="button" className={cx('abf-dbg__btn', freeze && 'is-on')} onClick={() => { const d = race()?.dbg; if (!d) return; d.freeze = !d.freeze; setFreeze(d.freeze); }}>{freeze ? '▶' : '⏸'}</button>
      {[1, 2, 3, 5].map((k) => (
        <button key={k} type="button" className={cx('abf-dbg__btn', speed === k && 'is-on')} onClick={() => { const d = race()?.dbg; if (!d) return; d.speed = k; setSpeed(k); }}>{k}×</button>
      ))}
    </div>
  );
}
