/**
 * Leichte Bausteine der Minispiele ohne 3D-Abhängigkeiten (für Spiele, die schnell laden sollen):
 * Gestensperre, hochzählende Punkte, lokaler Speicher, Pause-Symbole.
 */
import { useEffect, useState } from 'react';
import { fpsMeterOn, setFpsMeter } from '../game/fpsMeter';

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
      if (el?.closest('.abf-scroll') && e.touches.length === 1) return;
      e.preventDefault();
    };
    const touchStart = (e: TouchEvent) => { if (e.touches.length > 1) e.preventDefault(); };
    let lastTap = 0;
    const touchEnd = (e: TouchEvent) => {
      const now = Date.now();
      if (now - lastTap < 320 && !(e.target as HTMLElement | null)?.closest('button, a')) e.preventDefault();
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

export function PauseIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" /></svg>;
}
export function PlayIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor" /></svg>;
}
