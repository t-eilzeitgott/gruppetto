/**
 * Leichte Bausteine der Minispiele ohne 3D-Abhängigkeiten (für Spiele, die schnell laden sollen):
 * Gestensperre, hochzählende Punkte, lokaler Speicher, Pause-Symbole.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { fpsMeterOn, setFpsMeter } from '../game/fpsMeter';
import {
  GFX_LEVELS, GFX_MAX, GFX_MIN, deviceDensity, gfxAA, gfxLevel, gfxLevelText, gfxOn, gfxRes, onGfxSettings, resSteps, setGfxLevel, setGfxRes,
} from '../game/abfahrt/gfxOpts';

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

/**
 * Grafik als zwei Schieberegler (Pausenmenü aller 3D-Spiele und Profil): die Stufe von Low bis PC – sie fasst
 * Sichtweite, Schatten, Details, Licht & Wetter, Kantenglättung und PC-Grafik zusammen – und ganz getrennt davon die
 * Auflösung (Pixeldichte, fest). Übernommen wird kurz nach dem Loslassen (eine neue Stufe übersetzt Shader neu).
 */
export function GfxSliders({ page }: { page?: boolean }) {
  const cur = useGfxSettings();
  const [level, setLevel] = useState(cur.level);
  const steps = resSteps();
  const idxOf = (d: number) => steps.reduce((bi, x, i) => (Math.abs(x - d) < Math.abs(steps[bi] - d) ? i : bi), 0);
  const [ri, setRi] = useState(() => idxOf(cur.res));
  // von anderswo geändert: mitziehen
  useEffect(() => { setLevel(cur.level); }, [cur.level]);
  useEffect(() => { setRi(idxOf(cur.res)); }, [cur.res]); // eslint-disable-line react-hooks/exhaustive-deps
  const lt = useRef(0);
  const rt = useRef(0);
  useEffect(() => () => { window.clearTimeout(lt.current); window.clearTimeout(rt.current); }, []);
  // PC-Grafik und Kantenglättung gehören zur Bühne: sie wechseln erst mit dem nächsten Spiel
  const start = useRef({ pc: gfxOn('pc'), aa: gfxAA() });
  const L = GFX_LEVELS[level - 1];
  const later = L.pc !== start.current.pc || L.aa !== start.current.aa;
  const d = steps[ri];
  const dev = deviceDensity();
  let size = '';
  try { size = `${Math.round(window.innerWidth * d)} × ${Math.round(window.innerHeight * d)} Bildpunkte`; } catch { /* egal */ }
  const onLevel = (n: number) => {
    setLevel(n);
    window.clearTimeout(lt.current);
    lt.current = window.setTimeout(() => setGfxLevel(n), 220);
  };
  const onRes = (i: number) => {
    setRi(i);
    window.clearTimeout(rt.current);
    rt.current = window.setTimeout(() => setGfxRes(steps[i]), 120);
  };
  const pct = (v: number, max: number) => ({ '--p': `${(v / Math.max(1, max)) * 100}%` }) as CSSProperties;
  return (
    <div className={`gfx-sl${page ? ' gfx-sl--page' : ''}`}>
      <label className="gfx-sl__row">
        <span className="gfx-sl__head"><span className="gfx-sl__label">Grafik</span><span className="gfx-sl__val">{level} · {L.name}</span></span>
        <input type="range" className="gfx-sl__input" min={GFX_MIN} max={GFX_MAX} step={1} value={level} style={pct(level - GFX_MIN, GFX_MAX - GFX_MIN)}
          aria-valuetext={`Stufe ${level}: ${L.name}`} onChange={(e) => onLevel(Number(e.currentTarget.value))} />
        <span className="gfx-sl__ends" aria-hidden="true"><span>Low</span><span>PC</span></span>
        <span className="gfx-sl__hint">{gfxLevelText(level)}{later ? ' – Kantenglättung und PC-Grafik wechseln mit dem nächsten Spielstart' : ''}</span>
      </label>
      <label className="gfx-sl__row">
        <span className="gfx-sl__head"><span className="gfx-sl__label">Auflösung</span><span className="gfx-sl__val">{fmtX(d)} · {Math.round((d / dev) * 100)} %</span></span>
        <input type="range" className="gfx-sl__input" min={0} max={steps.length - 1} step={1} value={ri} style={pct(ri, steps.length - 1)}
          aria-valuetext={`${fmtX(d)} Pixeldichte, ${Math.round((d / dev) * 100)} Prozent`} onChange={(e) => onRes(Number(e.currentTarget.value))} />
        <span className="gfx-sl__ends" aria-hidden="true"><span>{fmtX(steps[0])}</span><span>{fmtX(steps[steps.length - 1])}</span></span>
        <span className="gfx-sl__hint">{size}{size ? ' · ' : ''}unabhängig von der Grafikstufe, wird nie automatisch gesenkt</span>
      </label>
    </div>
  );
}

export function PauseIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" /></svg>;
}
export function PlayIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor" /></svg>;
}
