/**
 * Steuerung aller Rennspiele (Abfahrt, Sprint, Bergfinale, Zeitfahren) – so, wie man es von Rennspielen kennt:
 *
 * - rechts unten die Gas-Taste (halten: antreten, drücken, bergab ducken),
 * - links unten die Bremse (halten: bremsen, Tempo raus, erholen),
 * - Lenken: Finger irgendwo seitlich ziehen – der Fahrer folgt direkt. Auch auf den Tasten: wer Gas hält, lenkt mit
 *   demselben Daumen, indem er ihn zur Seite schiebt.
 *
 * Mehrere Finger zugleich gehen (links lenken, rechts Gas). Wo ein Finger aufsetzt, entscheidet seine Rolle; seitlich
 * schieben lenkt immer. Bremse schlägt Gas. Alles läuft ohne React-Neuzeichnen: Klassen und Lage direkt am Element.
 */
import { useEffect, useLayoutEffect, useRef, type PointerEvent as RPointerEvent, type ReactNode, type RefObject } from 'react';
import { cx } from '../ui/kit';

/** was die Steuerung von einem Spiel braucht */
export interface SteerEngine {
  /** Finger um dx Bildpunkte seitlich verschoben */
  steerBy(dx: number): void;
  /** 1 Gas, −1 Bremse, 0 nichts */
  setPedal(v: number): void;
  /** liegt ein Finger auf? (optional) */
  setTouch?(on: boolean): void;
}

/** von außen je Bild: Beschriftung nach Lage (bergauf, bergab, Zielsprint) und Warnung „zu schnell für die Kurve“ */
export interface ControlsHandle {
  labels(gas: string, brake: string): void;
  warn(on: boolean): void;
}

type Role = 'gas' | 'brake' | 'steer';
interface Ptr { role: Role; x: number; x0: number; sum: number }

/** Trefferfläche der Tasten etwas größer als ihr Bild (Daumen treffen selten genau) */
const SLOP = 18;

export function RaceControls({ eng, enabled, gas, brake, hint = null, ctl }: {
  eng: () => SteerEngine | null;
  /** nimmt Eingaben an (Rennen läuft oder Countdown) */
  enabled: boolean;
  /** Beschriftung der Tasten zu Beginn */
  gas: string;
  brake: string;
  /** Tutorial: diese Taste pulsiert */
  hint?: 'gas' | 'brake' | null;
  ctl?: RefObject<ControlsHandle | null>;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  const gasEl = useRef<HTMLDivElement | null>(null);
  const brakeEl = useRef<HTMLDivElement | null>(null);
  const gasLabel = useRef<HTMLSpanElement | null>(null);
  const brakeLabel = useRef<HTMLSpanElement | null>(null);
  const ring = useRef<HTMLDivElement | null>(null);
  const ptrs = useRef(new Map<number, Ptr>());
  const pedal = useRef(0);
  const shown = useRef({ gas, brake, warn: false });
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  /** Tasten und Spiel auf den Stand der Finger bringen */
  const sync = () => {
    let g = false;
    let b = false;
    let steer: Ptr | null = null;
    for (const p of ptrs.current.values()) {
      if (p.role === 'gas') g = true;
      else if (p.role === 'brake') b = true;
      else steer = p;
    }
    const v = b ? -1 : g ? 1 : 0;
    gasEl.current?.classList.toggle('is-down', g);
    brakeEl.current?.classList.toggle('is-down', b);
    if (!steer) ring.current?.classList.remove('is-on');
    const e = eng();
    if (v !== pedal.current) { pedal.current = v; e?.setPedal(v); }
    e?.setTouch?.(ptrs.current.size > 0);
  };

  const releaseAll = () => {
    ptrs.current.clear();
    for (const el of [gasEl.current, brakeEl.current]) el?.style.setProperty('--slide', '0px');
    sync();
  };

  // nicht mehr aktiv (Pause, Ziel), App im Hintergrund: alles loslassen
  useEffect(() => {
    if (!enabled) releaseAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  useEffect(() => {
    const off = () => releaseAll();
    const vis = () => { if (document.hidden) releaseAll(); };
    window.addEventListener('blur', off);
    document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('blur', off); document.removeEventListener('visibilitychange', vis); off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (!ctl) return;
    ctl.current = {
      labels: (g, b) => {
        const s = shown.current;
        if (s.gas !== g && gasLabel.current) { s.gas = g; gasLabel.current.textContent = g; }
        if (s.brake !== b && brakeLabel.current) { s.brake = b; brakeLabel.current.textContent = b; }
      },
      warn: (on) => {
        if (shown.current.warn === on) return;
        shown.current.warn = on;
        gasEl.current?.classList.toggle('is-warn', on);
      },
    };
    return () => { ctl.current = null; };
  }, [ctl]);

  const roleAt = (x: number, y: number): Role => {
    const hit = (el: HTMLElement | null) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return x >= r.left - SLOP && x <= r.right + SLOP && y >= r.top - SLOP && y <= r.bottom + SLOP;
    };
    if (hit(brakeEl.current)) return 'brake';
    if (hit(gasEl.current)) return 'gas';
    return 'steer';
  };

  const placeRing = (p: Ptr, x: number, y: number) => {
    const el = ring.current;
    if (!el) return;
    el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    el.classList.add('is-on');
    el.classList.toggle('is-left', p.sum < -6);
    el.classList.toggle('is-right', p.sum > 6);
  };

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!enabledRef.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* egal */ }
    const role = roleAt(e.clientX, e.clientY);
    const p: Ptr = { role, x: e.clientX, x0: e.clientX, sum: 0 };
    ptrs.current.set(e.pointerId, p);
    if (role === 'steer') placeRing(p, e.clientX, e.clientY);
    sync();
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const p = ptrs.current.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    p.x = e.clientX;
    if (dx !== 0) {
      p.sum = p.sum * 0.6 + dx;
      eng()?.steerBy(dx);
    }
    if (p.role === 'steer') placeRing(p, e.clientX, e.clientY);
    else {
      // die Taste geht ein Stück mit dem Daumen mit – man sieht, dass seitliches Schieben lenkt
      const el = p.role === 'gas' ? gasEl.current : brakeEl.current;
      const off = Math.max(-16, Math.min(16, (e.clientX - p.x0) * 0.3));
      el?.style.setProperty('--slide', `${off.toFixed(1)}px`);
    }
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const p = ptrs.current.get(e.pointerId);
    if (!p) return;
    ptrs.current.delete(e.pointerId);
    if (p.role !== 'steer') (p.role === 'gas' ? gasEl.current : brakeEl.current)?.style.setProperty('--slide', '0px');
    sync();
  };

  return (
    <div
      ref={root}
      className={cx('rc', !enabled && 'is-off')}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e: { preventDefault(): void }) => e.preventDefault()}
    >
      <div className="rc-ring" ref={ring} aria-hidden="true"><Chevron dir="left" /><i /><Chevron dir="right" /></div>
      <div className={cx('rc-pedal rc-pedal--brake', hint === 'brake' && 'is-hint')} ref={brakeEl} aria-hidden="true">
        <span className="rc-pedal__knob"><BrakeGlyph /><span className="rc-pedal__label" ref={brakeLabel}>{brake}</span></span>
      </div>
      <div className={cx('rc-pedal rc-pedal--gas', hint === 'gas' && 'is-hint')} ref={gasEl} aria-hidden="true">
        <span className="rc-pedal__warn">Kurve!</span>
        <span className="rc-pedal__knob"><GasGlyph /><span className="rc-pedal__label" ref={gasLabel}>{gas}</span></span>
      </div>
    </div>
  );
}

function Svg({ children }: { children: ReactNode }) {
  return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}
/** Gas: zwei Winkel nach oben */
function GasGlyph() { return <Svg><path d="M6 13.5 12 7.5l6 6" /><path d="M6 19 12 13l6 6" /></Svg>; }
/** Bremse: zwei Balken (wie die Bremsgriffe) */
function BrakeGlyph() { return <Svg><path d="M8.5 6.5v11M15.5 6.5v11" /></Svg>; }
function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return <svg className={`rc-ring__${dir}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={dir === 'left' ? 'M15 5 8 12l7 7' : 'm9 5 7 7-7 7'} /></svg>;
}

/** Hinweis für die Startblätter: so wird gesteuert (Gas/Bremse je Spiel benannt) */
export function controlsHowTo(gas: string, brake: string): [string, string][] {
  return [['↔', 'ziehen: lenken'], ['▲', `rechts: ${gas}`], ['‖', `links: ${brake}`]];
}
