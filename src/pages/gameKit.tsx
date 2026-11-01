/**
 * Leichte Bausteine der Minispiele ohne 3D-Abhängigkeiten (für Spiele, die schnell laden sollen):
 * Gestensperre, hochzählende Punkte, lokaler Speicher, Pause-Symbole.
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { fpsMeterOn, setFpsMeter } from '../game/fpsMeter';
import { GFX_LEVELS, GFX_MAX, GFX_MIN, gfxAA, gfxLevel, gfxOn, gfxRes, onGfxSettings, resSteps, setGfxLevel, setGfxRes } from '../game/abfahrt/gfxOpts';
import { cx } from '../ui/kit';

export const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
export const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

/** Kein Zoomen, kein Scrollen, kein Zurückwischen während des Spiels */
export function useGameLock() {
  useEffect(() => {
    const meta = document.querySelector('meta[name=viewport]');
    const before = meta?.getAttribute('content') ?? '';
    meta?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
    document.documentElement.classList.add('game-lock');
    const stop = (e: Event) => e.preventDefault();
    const touchMove = (e: TouchEvent) => {
      const el = e.target as HTMLElement | null;
      // Listen dürfen scrollen, Schieberegler sich ziehen lassen
      if (el?.closest('.abf-scroll, input[type=range]') && e.touches.length === 1) return;
      e.preventDefault();
    };
    const touchStart = (e: TouchEvent) => { if (e.touches.length > 1) e.preventDefault(); };
    let lastTap = 0;
    const touchEnd = (e: TouchEvent) => {
      const now = Date.now();
      if (now - lastTap < 320 && !(e.target as HTMLElement | null)?.closest('button, a, label, input')) e.preventDefault();
      lastTap = now;
    };
    document.addEventListener('gesturestart', stop, { passive: false } as AddEventListenerOptions);
    document.addEventListener('gesturechange', stop, { passive: false } as AddEventListenerOptions);
    document.addEventListener('touchmove', touchMove, { passive: false });
    document.addEventListener('touchstart', touchStart, { passive: false });
    document.addEventListener('touchend', touchEnd, { passive: false });
    document.addEventListener('dblclick', stop);
    document.addEventListener('contextmenu', stop);
    window.scrollTo(0, 0);
    return () => {
      if (meta) meta.setAttribute('content', before);
      document.documentElement.classList.remove('game-lock');
      document.removeEventListener('gesturestart', stop);
      document.removeEventListener('gesturechange', stop);
      document.removeEventListener('touchmove', touchMove);
      document.removeEventListener('touchstart', touchStart);
      document.removeEventListener('touchend', touchEnd);
      document.removeEventListener('dblclick', stop);
      document.removeEventListener('contextmenu', stop);
    };
  }, []);
}

export function useCountUp(target: number) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const dur = Math.min(1600, 500 + target / 20);
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      setV(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

/** Schalter im Pausenmenü: Bildrate unten links anzeigen */
export function FpsSwitch() {
  const [on, setOn] = useState(fpsMeterOn);
  return (
    <button type="button" role="switch" aria-checked={on} className={`abf-switch${on ? ' is-on' : ''}`} onClick={() => { setFpsMeter(!on); setOn(!on); }}>
      <span>Bildrate anzeigen</span>
      <span className="abf-switch__track" aria-hidden="true"><span className="abf-switch__knob" /></span>
    </button>
  );
}

/** Stufe und Auflösung (gfxOpts) – folgen Änderungen von anderswo (Pausenmenü, Profil) */
function useGfxSettings(): { level: number; res: number } {
  const read = () => ({ level: gfxLevel(), res: gfxRes() });
  const [v, setV] = useState(read);
  useEffect(() => onGfxSettings(() => setV(read())), []);
  return v;
}

const fmtX = (d: number) => `${String(Math.round(d * 100) / 100).replace('.', ',')}×`;

/** ein leiser Tick je Stufe beim Ziehen (wo das Gerät vibrieren kann) */
function tick() {
  try { navigator.vibrate?.(5); } catch { /* egal */ }
}

/**
 * Schieberegler mit Rasterpunkten: folgt dem Finger stufenlos, zeigt unterwegs die Stufe unter dem Daumen (mit einem
 * Tick je Stufe) und rastet beim Loslassen weich ein – erst dann wird übernommen. Tippen auf die Leiste springt
 * dorthin; Pfeiltasten, Pos1 und Ende gehen auch.
 */
function SnapSlider({ count, value, label, valueText, onPreview, onCommit, warnFrom }: {
  count: number;
  /** Stufe 0 … count−1 */
  value: number;
  label: string;
  valueText: (i: number) => string;
  /** unterwegs (ohne Übernahme) */
  onPreview: (i: number) => void;
  onCommit: (i: number) => void;
  /** ab dieser Stufe (halbe Stufen erlaubt) ist die Leiste als „anspruchsvoll“ getönt */
  warnFrom?: number;
}) {
  const track = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = useRef(value);
  const max = Math.max(1, count - 1);
  const pos = drag ?? value;
  const near = Math.round(pos);
  const at = (x: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return pos;
    return Math.max(0, Math.min(1, (x - r.left) / r.width)) * max;
  };
  const show = (p: number) => {
    const i = Math.round(p);
    if (i === shown.current) return;
    shown.current = i;
    tick();
    onPreview(i);
  };
  const end = () => {
    if (drag === null) return;
    const i = Math.round(drag);
    setDrag(null);
    shown.current = i;
    onCommit(i);
  };
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 2, PageDown: -2 }[e.key];
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? max : step !== undefined ? Math.max(0, Math.min(max, value + step)) : null;
    if (to === null) return;
    e.preventDefault();
    if (to === value) return;
    shown.current = to;
    onPreview(to);
    onCommit(to);
  };
  const pct = (v: number) => `${(v / max) * 100}%`;
  return (
    <div
      className={cx('snap', drag !== null && 'is-drag')}
      role="slider" tabIndex={0} aria-label={label}
      aria-valuemin={0} aria-valuemax={max} aria-valuenow={near} aria-valuetext={valueText(near)}
      onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const p = at(e.clientX);
        setDrag(p);
        show(p);
      }}
      onPointerMove={(e: ReactPointerEvent<HTMLDivElement>) => {
        if (drag === null) return;
        const p = at(e.clientX);
        setDrag(p);
        show(p);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={key}
    >
      <div className="snap__track" ref={track}>
        {warnFrom !== undefined && warnFrom <= max ? <i className="snap__warn" style={{ left: pct(warnFrom) }} /> : null}
        <i className="snap__fill" style={{ width: pct(pos) }} />
        {count <= 16 ? Array.from({ length: count }, (_, i) => <i key={i} className={cx('snap__tick', i <= pos + 0.01 && 'is-on')} style={{ left: pct(i) }} />) : null}
        <i className="snap__thumb" style={{ left: pct(pos) }} />
      </div>
    </div>
  );
}

/**
 * Grafik als zwei Schieberegler (Pausenmenü aller 3D-Spiele und Profil): die Stufe von Low bis PC – sie fasst
 * Sichtweite, Schatten, Details, Licht & Wetter, Kantenglättung und PC-Grafik zusammen – und ganz getrennt davon die
 * Auflösung (Pixeldichte, fest). Übernommen wird beim Loslassen (eine neue Stufe übersetzt Shader neu).
 */
export function GfxSliders({ page }: { page?: boolean }) {
  const cur = useGfxSettings();
  const steps = resSteps();
  const idxOf = (d: number) => steps.reduce((bi, x, i) => (Math.abs(x - d) < Math.abs(steps[bi] - d) ? i : bi), 0);
  // unterwegs gezeigte Stufe (beim Ziehen), sonst die gültige
  const [lv, setLv] = useState(cur.level);
  const [ri, setRi] = useState(() => idxOf(cur.res));
  useEffect(() => { setLv(cur.level); }, [cur.level]);
  useEffect(() => { setRi(idxOf(cur.res)); }, [cur.res]); // eslint-disable-line react-hooks/exhaustive-deps
  // PC-Grafik und Kantenglättung gehören zur Bühne: sie wechseln erst mit dem nächsten Spiel
  const start = useRef({ pc: gfxOn('pc'), aa: gfxAA() });
  const L = GFX_LEVELS[lv - 1];
  const later = L.pc !== start.current.pc || L.aa !== start.current.aa;
  const d = steps[ri];
  // am Telefon über doppelter Dichte: getönt (selten noch 60 Bilder je Sekunde)
  const phone = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const w2 = steps.findIndex((x) => x > 2 + 1e-6);
  const warnFrom = phone && w2 > 0 ? w2 - 0.5 : undefined;
  return (
    <div className={cx('gfx-sl', page && 'gfx-sl--page')}>
      <div className="gfx-sl__row">
        <div className="gfx-sl__head" aria-hidden="true"><span className="gfx-sl__label">Grafik</span><span className="gfx-sl__val">{L.name}</span></div>
        <SnapSlider count={GFX_MAX - GFX_MIN + 1} value={cur.level - GFX_MIN} label="Grafikstufe"
          valueText={(i) => `${GFX_LEVELS[i].name}, Stufe ${i + GFX_MIN} von ${GFX_MAX}`}
          onPreview={(i) => setLv(i + GFX_MIN)} onCommit={(i) => { setLv(i + GFX_MIN); setGfxLevel(i + GFX_MIN); }} />
        <div className="gfx-sl__ends" aria-hidden="true"><span>Low</span>{later ? <span className="gfx-sl__note">ab dem nächsten Start</span> : null}<span>PC</span></div>
      </div>
      <div className="gfx-sl__row">
        <div className="gfx-sl__head" aria-hidden="true"><span className="gfx-sl__label">Auflösung</span><span className={cx('gfx-sl__val', warnFrom !== undefined && ri > warnFrom && 'is-warn')}>{fmtX(d)}</span></div>
        <SnapSlider count={steps.length} value={idxOf(cur.res)} label="Auflösung" warnFrom={warnFrom}
          valueText={(i) => `${fmtX(steps[i])} Pixeldichte${warnFrom !== undefined && i > warnFrom ? ', kostet viel Bildrate' : ''}`}
          onPreview={setRi} onCommit={(i) => { setRi(i); setGfxRes(steps[i]); }} />
        <div className="gfx-sl__ends" aria-hidden="true"><span>{fmtX(steps[0])}</span><span>{fmtX(steps[steps.length - 1])}</span></div>
      </div>
    </div>
  );
}

export function PauseIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" /></svg>;
}
export function PlayIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor" /></svg>;
}
