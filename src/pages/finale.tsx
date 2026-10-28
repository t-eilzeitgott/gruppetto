/**
 * Gemeinsame Bausteine der Rennfinals (Sprintfinale, Bergfinale): 3D-Schleife, Gestensperre,
 * Tastatur, Fahrerauswahl, Bestenlisten und Podium.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { acquireStage, hasWarmStage, releaseStage, type Stage } from '../game/abfahrt/pool';
import { QualityGovernor, storedQuality } from '../game/abfahrt/quality';
import { FpsMeter } from '../game/fpsMeter';
import { afterPaint } from '../lib/afterPaint';
import type { GameBest } from '../data/source';
import type { Profile } from '../lib/types';
import type { RaceView } from '../game/abfahrt/engine';
import type { RiderType } from '../game/abfahrt/sprint';
import type { RiderOption } from '../game/abfahrt/sprintRiders';
import { Avatar, Segmented, cx } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { readAccent } from './Game';

export { lsGet, lsSet, useGameLock } from './gameKit';

export type Ui = 'ready' | 'countdown' | 'playing' | 'paused' | 'over';
export type Board = 'day' | 'season';

export const nf = (n: number) => Math.round(n).toLocaleString('de-DE');
export const dist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`);

/** was die Schleife von einem Rennen braucht */
export interface LoopEngine extends RaceView {
  update(dt: number): void;
  setViewport(w: number): void;
}

/**
 * 3D-Schleife: Renderer anlegen, jedes Bild rechnen und zeichnen, Bildrate beobachten (notfalls
 * Auflösung senken), Größe und Thema verfolgen. Testmodi: ?nogl (ohne 3D) und ?lowgfx (winzig).
 */
export function useRaceLoop<E extends LoopEngine>(opts: {
  /** Platz für die 3D-Bühne (die Leinwand wird hineingehängt) */
  stageRef: RefObject<HTMLDivElement | null>;
  engineRef: RefObject<E | null>;
  uiRef: RefObject<Ui>;
  make: () => E;
  onFrame: (eng: E, dt: number) => void;
  onGlError: () => void;
  onHidden: () => void;
}): number {
  const cb = useRef(opts);
  cb.current = opts;
  // Neuaufbau der 3D-Ansicht (neue Leinwand), wenn der Browser den Kontext entzogen hat
  const [gen, setGen] = useState(0);
  useLayoutEffect(() => {
    const stage = cb.current.stageRef.current;
    if (!stage) return undefined;
    const engineRef = cb.current.engineRef;
    const uiRef = cb.current.uiRef;
    const g = window as unknown as { __abfahrt?: unknown };
    if (/[?&]nogl\b/.test(window.location.search)) {
      engineRef.current = cb.current.make();
      let raf = 0;
      let prev = performance.now();
      const tick = (now: number) => {
        const dt = Math.min(0.05, (now - prev) / 1000);
        prev = now;
        if (uiRef.current !== 'paused') engineRef.current!.update(dt);
        cb.current.onFrame(engineRef.current!, dt);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      g.__abfahrt = { engine: () => engineRef.current, renderer: null };
      return () => cancelAnimationFrame(raf);
    }
    // 3D erst nach dem ersten Bild aufbauen: Startkarte und Bühne stehen sofort, die Szene blendet ein
    const start = (): (() => void) | undefined => {
      // fertige Bühne aus dem Vorrat (beim App-Start vorgewärmt) oder eine neue
      const warm = hasWarmStage();
      let st: Stage;
      try {
        st = acquireStage();
      } catch {
        cb.current.onGlError();
        return undefined;
      }
      const { renderer, canvas, overlay } = st;
      stage.append(canvas, overlay);
      renderer.resize();
      renderer.setTheme(readAccent(), document.documentElement.dataset.theme === 'dark');
      const low = /[?&]lowgfx\b/.test(window.location.search);
      if (low) { renderer.quality = 0.25; renderer.resize(); }
      // zuletzt gefundene Auflösungsstufe dieses Geräts
      else if (renderer.quality !== storedQuality()) { renderer.quality = storedQuality(); renderer.resize(); }
      const gov = new QualityGovernor(0.5);
      // beim Neuaufbau läuft das Rennen weiter
      if (!engineRef.current || (gen === 0 && uiRef.current === 'ready')) engineRef.current = cb.current.make();
      // vorgewärmt: gleich ein Bild zeichnen – die Welt steht, bevor die Seite erscheint
      if (warm) renderer.draw(engineRef.current!, 0);
      let raf = 0;
      let prev = performance.now();
      let acc = 0;
      let frames = 0;
      let idleT = 0;
      let lostT = 0;
      let rebuilt = false;
      let drawn = false;
      const rebuild = () => { if (!rebuilt) { rebuilt = true; setGen((x) => x + 1); } };
      // Bildrate für Admins (unauffällig unten links)
      const fps = new FpsMeter(stage);
      let lastDraw = 0;
      const loop = (now: number) => {
        const raw = (now - prev) / 1000;
        const dt = Math.min(0.05, raw);
        prev = now;
        const eng = engineRef.current!;
        // Kontext verloren und nicht zurückgekommen: neue Leinwand statt schwarzem Bild
        if (renderer.lost) {
          lostT += dt;
          if (lostT > 0.8) { rebuild(); return; }
          raf = requestAnimationFrame(loop);
          return;
        }
        lostT = 0;
        if (uiRef.current !== 'paused') eng.update(dt);
        // Start- und Ergebniskarte: Szene dahinter nur 10-mal pro Sekunde zeichnen (spart Akku und Wärme)
        const idle = uiRef.current === 'ready' || uiRef.current === 'over';
        idleT = idle ? idleT + dt : 0;
        if (idle && idleT < 0.1 && frames > 2) {
          cb.current.onFrame(eng, dt);
          frames += 1;
          raf = requestAnimationFrame(loop);
          return;
        }
        const c0 = performance.now();
        if (!low || frames % 30 === 0) renderer.draw(eng, uiRef.current === 'paused' ? 0 : idle ? Math.min(0.1, idleT) : dt);
      if (!drawn) { drawn = true; canvas.classList.add('is-drawn'); }
        idleT = 0;
        cb.current.onFrame(eng, dt);
        fps.frame(lastDraw ? now - lastDraw : 0, performance.now() - c0, renderer.quality);
        lastDraw = now;
        if (idle) { frames += 1; raf = requestAnimationFrame(loop); return; }
        acc += dt;
        frames += 1;
        // Auflösung nach Bildzeit regeln: alle Bilder der Fahrt zählen (Median – Nachladeruckler stören nicht)
        if (uiRef.current === 'playing' && !low) {
          const nq = gov.frame(raw, renderer.quality);
          if (nq !== null) renderer.setQuality(nq); // wirkt direkt vor dem nächsten Bild (kein schwarzes Bild)
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      const onResize = () => { renderer.requestResize(); engineRef.current?.setViewport(canvas.getBoundingClientRect().width); };
      const onVis = () => {
        if (document.hidden && uiRef.current === 'playing') cb.current.onHidden();
        if (!document.hidden && renderer.lost) rebuild();
      };
      const onLost = (e: Event) => { e.preventDefault(); };
      const onRestored = () => rebuild();
      canvas.addEventListener('webglcontextlost', onLost);
      canvas.addEventListener('webglcontextrestored', onRestored);
      const onTheme = () => window.setTimeout(() => renderer.setTheme(readAccent(), document.documentElement.dataset.theme === 'dark'), 30);
      const obs = new MutationObserver(onTheme);
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-tour'] });
      window.addEventListener('resize', onResize);
      // Homescreen-App auf iOS: 100vh ist dort zu kurz, darum die echte Bildschirmhöhe nehmen
      const root = stage.parentElement as HTMLElement | null;
      const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
      const fit = () => {
        if (!root || !standalone) return;
        const portrait = window.innerHeight >= window.innerWidth;
        const h = portrait ? Math.max(screen.height, screen.width) : Math.min(screen.height, screen.width);
        root.style.height = `${Math.max(window.innerHeight, h)}px`;
      };
      fit();
      window.addEventListener('orientationchange', fit);
      const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
      ro?.observe(canvas);
      document.addEventListener('visibilitychange', onVis);
      g.__abfahrt = { engine: () => engineRef.current, renderer };
      return () => {
        cancelAnimationFrame(raf);
        fps.dispose();
        canvas.removeEventListener('webglcontextlost', onLost);
        canvas.removeEventListener('webglcontextrestored', onRestored);
        ro?.disconnect();
        window.removeEventListener('orientationchange', fit);
        releaseStage(st);
        window.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', onVis);
        obs.disconnect();
      };
    };
    // vorgewärmte Bühne: sofort (das erste Bild ist schon im Übergang zu sehen), sonst nach dem ersten Bild
    let stop: (() => void) | undefined;
    let cancel = () => {};
    if (hasWarmStage()) stop = start();
    else cancel = afterPaint(() => { stop = start(); });
    return () => { cancel(); stop?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen]);
  return gen;
}

type KeyEngine = { key(name: 'left' | 'right' | 'down' | 'up', down: boolean): void; swapMate?: () => void };

/** Tastatur: Pfeile/WASD steuern, Leertaste startet, Escape pausiert, E tauscht die Führung mit dem Helfer */
export function useRaceKeys(engineRef: RefObject<KeyEngine | null>, uiRef: RefObject<Ui>, start: () => void, togglePause: () => void) {
  useEffect(() => {
    const map: Record<string, 'left' | 'right' | 'down' | 'up'> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', ArrowUp: 'up', a: 'left', d: 'right', s: 'down', w: 'up' };
    const down = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        if (uiRef.current === 'ready' || uiRef.current === 'over') { e.preventDefault(); start(); }
        return;
      }
      if (e.key === 'Escape' || e.key === 'p') { togglePause(); return; }
      if ((e.key === 'e' || e.key === 'Tab') && engineRef.current?.swapMate) { e.preventDefault(); engineRef.current.swapMate(); return; }
      const k = map[e.key];
      if (k) { e.preventDefault(); engineRef.current?.key(k, true); }
    };
    const up = (e: KeyboardEvent) => { const k = map[e.key]; if (k) engineRef.current?.key(k, false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  });
}

/** vorläufiger Platz eines neuen Laufs gegen die Bestwerte der anderen */
export function placeIn(list: GameBest[], meId: string, score: number): number {
  const others = list.filter((b) => b.user_id !== meId).map((b) => b.best);
  const mine = Math.max(score, list.find((b) => b.user_id === meId)?.best ?? 0);
  return others.filter((s) => s > mine).length + 1;
}

// ------------------------------------------------------------------ Fahrerauswahl

export interface TypeInfo { label: string; bonus: number }

/**
 * Fahrer wählen – der wichtigste Teil der Startkarte: kurze Zeilen (Name, Typ, Punkte-Faktor) und darunter
 * die Stärken des gewählten Fahrers als drei beschriftete Balken, die beim Wechsel sichtbar umspringen.
 */
export function RiderPicker({ options, chosen, onChoose, info, bars }: {
  options: RiderOption[];
  chosen: RiderOption;
  onChoose: (o: RiderOption) => void;
  info: (t: RiderType) => TypeInfo;
  bars: (t: RiderType) => [string, number][];
}) {
  const factor = (b: number) => `×${b.toFixed(2).replace(/0$/, '').replace('.', ',')}`;
  // „J. Vingegaard“: Nachname ganz, Vorname als Initiale – passt in eine Zeile
  const short = (n: string) => {
    const w = n.trim().split(/\s+/);
    return w.length > 1 ? `${w[0][0]}. ${w.slice(1).join(' ')}` : n;
  };
  return (
    <section className="spr-pick" aria-label="Fahrer auswählen">
      <div className="spr-pick__head">
        <h2 className="spr-pick__title">Wähle deinen Fahrer</h2>
        <span className="spr-pick__hint">Jeder fährt anders</span>
      </div>
      <div className="spr-pick__list" role="radiogroup" aria-label="Fahrer">
        {options.map((o) => {
          const on = o === chosen;
          const s = info(o.type);
          const rows = bars(o.type);
          return (
            <button
              key={`${o.id ?? 'x'}:${o.type}`}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${o.id === null ? s.label : o.name}, ${s.label}, Punkte ${factor(s.bonus)}: ${rows.map(([l, v]) => `${l} ${Math.round(v * 10)} von 10`).join(', ')}`}
              title={o.why || undefined}
              className={cx('spr-rider', on && 'is-on')}
              onClick={() => onChoose(o)}
            >
              <span className="spr-rider__dot" aria-hidden="true" />
              <span className="spr-rider__name">{o.id === null ? s.label : short(o.name)}</span>
              {o.tip ? <span className="spr-rider__tip">Tipp</span> : null}
              <span className="spr-rider__type">{s.label}</span>
              <span className={cx('spr-rider__x', s.bonus > 1 && 'is-up')}>{factor(s.bonus)}</span>
            </button>
          );
        })}
      </div>
      <div className="spr-stats" aria-hidden="true">
        {bars(chosen.type).map(([l, v]) => (
          <span key={l} className="spr-stat">
            <span className="spr-stat__label">{l}</span>
            <i><b style={{ width: `${Math.round(12 + Math.max(0, Math.min(1, v)) * 88)}%` }} /></i>
          </span>
        ))}
      </div>
    </section>
  );
}

/** Steuerung in einer Zeile */
export function HowTo({ items }: { items: [string, string][] }) {
  return (
    <ul className="spr-keys" aria-label="Steuerung">
      {items.map(([k, t]) => <li key={k}><b aria-hidden="true">{k}</b>{t}</li>)}
    </ul>
  );
}

// ------------------------------------------------------------------ Bestenlisten

export function FinaleMini({ rows, label, members, meId, onOpen, empty }: {
  rows: GameBest[]; label: string; members: Profile[]; meId: string; onOpen: () => void; empty: string;
}) {
  const myIdx = rows.findIndex((r) => r.user_id === meId);
  const shown = rows.slice(0, 3).map((r, i) => ({ r, i }));
  if (myIdx >= 3) shown.push({ r: rows[myIdx], i: myIdx });
  return (
    <section className="abf-mini" aria-label="Bestenliste">
      <div className="abf-row">
        <h2 className="abf-eyebrow">Bestenliste · {label}</h2>
        <button type="button" className="abf-link" onClick={onOpen}>Alle<Icon name="chevron" size={14} /></button>
      </div>
      {shown.length ? (
        <ol className="abf-top">
          {shown.map(({ r, i }) => {
            const m = members.find((x) => x.id === r.user_id);
            return (
              <li key={r.user_id} className={cx(r.user_id === meId && 'is-me')}>
                <span className="abf-top__rank">{i + 1}</span>
                <Avatar name={m?.display_name ?? '?'} color={m?.avatar_color ?? '#888'} size={22} />
                <span className="abf-top__name">{r.user_id === meId ? 'Du' : m?.display_name ?? 'Jemand'}</span>
                <strong>{nf(r.best)}</strong>
              </li>
            );
          })}
        </ol>
      ) : <p className="abf-muted">{empty}</p>}
    </section>
  );
}

export function FinaleBoard({ title, rows, board, setBoard, members, meId, onBack, unit }: {
  title: string; rows: GameBest[]; board: Board; setBoard: (b: Board) => void; members: Profile[]; meId: string; onBack: () => void;
  /** Läufe benennen: „1 Sprint“ / „3 Sprints“ */
  unit: [string, string];
}) {
  return (
    <section className="abf-board" aria-label="Bestenliste">
      <div className="abf-row">
        <button type="button" className="abf-link" onClick={onBack}><Icon name="back" size={16} />Zurück</button>
        <h2 className="abf-eyebrow">{title}</h2>
      </div>
      <Segmented<Board> label="Zeitraum" value={board} onChange={setBoard} options={[{ value: 'day', label: 'Heute' }, { value: 'season', label: 'Saison' }]} />
      {rows.length === 0 ? <p className="abf-muted">{board === 'day' ? 'Heute ist noch niemand gefahren.' : `Noch keine ${unit[1]}.`}</p> : (
        <ol className="list abf-list">
          {rows.slice(0, 30).map((r, i) => {
            const m = members.find((x) => x.id === r.user_id);
            return (
              <li key={r.user_id} className={cx('person-row', r.user_id === meId && 'is-me')}>
                <span className="rank">{i + 1}</span>
                <Avatar name={m?.display_name ?? '?'} color={m?.avatar_color ?? '#888'} size={30} />
                <span className="person-row__main">
                  <span className="person-row__name">{m?.display_name ?? 'Ehemaliges Mitglied'}{r.user_id === meId ? ' (du)' : ''}</span>
                  <span className="person-row__sub">{r.runs === 1 ? `1 ${unit[0]}` : `${r.runs} ${unit[1]}`}</span>
                </span>
                <span className="points">{nf(r.best)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Podium eines Rennens */
export function Podium({ podium }: { podium: { name: string; me: boolean }[] }) {
  return (
    <ol className="spr-podium" aria-label="Podium">
      {podium.map((p, i) => (
        <li key={`${p.name}-${i}`} className={cx(p.me && 'is-me')}>
          <span className="spr-podium__pos">{i + 1}</span>
          <span className="spr-podium__name">{p.me ? `${p.name} (du)` : p.name}</span>
        </li>
      ))}
    </ol>
  );
}

/** Daumenring im HUD: Anker, oben, unten */
export function placeThumb(th: HTMLElement | null, touch: { x: number; y: number } | null, playing: boolean, up: boolean, down: boolean) {
  if (!th) return;
  if (touch && playing) {
    th.style.opacity = '1';
    th.style.visibility = 'visible';
    th.style.transform = `translate(${touch.x.toFixed(0)}px, ${touch.y.toFixed(0)}px)`;
    th.classList.toggle('is-tuck', up);
    th.classList.toggle('is-brake', down);
  } else { th.style.opacity = '0'; th.style.visibility = 'hidden'; }
}
