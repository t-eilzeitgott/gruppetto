/**
 * Embleme im Profil: Vitrine (nur was man hat – kein Katalog, keine leeren Plätze) und die Verleihung neuer
 * Embleme: Bühne mit Lichtstrahlen, das Emblem springt mit einer gedämpften Feder herein und dreht sich wie eine
 * Münze aus, Funken stieben, danach fliegt es an seinen Platz in der Vitrine.
 * Ob ein Emblem schon verliehen wurde, merkt sich das Gerät (je Mitglied).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '../app/query';
import { useApp } from '../app/context';
import { useRoute } from '../app/router';
import { source } from '../app/config';
import { EMBLEM_SINCE, RARITY_LABEL, emblemsFor, shelf, type Emblem, type ShelfItem } from '../lib/emblems';
import type { Profile, TourTheme } from '../lib/types';
import { EmblemArt, TONES } from './EmblemArt';
import { cx } from './kit';

// ------------------------------------------------------------------ Daten

export function useEmblems(me: Profile) {
  return useQuery<Emblem[]>(`emblems:${me.id}`, async () => {
    const now = source.now();
    const tours = (await source.loadTours()).filter((t) => t.is_visible && t.start_date >= EMBLEM_SINCE && Date.parse(t.start_date) <= now + 864e5);
    if (!tours.length) return [];
    const [members, datas] = await Promise.all([source.loadMembers(), Promise.all(tours.map((t) => source.loadTourData(t)))]);
    return emblemsFor(me.id, datas, members);
  });
}

const seenKey = (uid: string) => `gruppetto.emblems.seen.${uid}`;
function readSeen(uid: string): Set<string> {
  try {
    const raw = localStorage.getItem(seenKey(uid));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function writeSeen(uid: string, keys: Set<string>) {
  try { localStorage.setItem(seenKey(uid), JSON.stringify([...keys])); } catch { /* egal */ }
}

const CEREMONY_ORDER: Record<Emblem['rarity'], number> = { klassisch: 0, selten: 1, episch: 2, legendaer: 3, medaille: 4 };
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
const calm = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------------ Bewegung

/** Sprungantwort einer gedämpften Feder (0 → 1, schwingt über) */
function spring(t: number, k = 170, c = 13): number {
  const w0 = Math.sqrt(k);
  const z = c / (2 * w0);
  const wd = w0 * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
}

/** Auftritt: aus der Tiefe, Münzdrehung, Feder – als Schlüsselbilder für die Web Animations API */
function entranceFrames(): Keyframe[] {
  const frames: Keyframe[] = [];
  const N = 64;
  const T = 1.25;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * T;
    const p = spring(t);
    const q = spring(t, 120, 11); // Drehung etwas träger
    frames.push({
      offset: i / N,
      opacity: Math.min(1, t * 7),
      transform: `translate3d(0, ${((1 - p) * 140).toFixed(2)}px, 0) rotateY(${((1 - q) * -540).toFixed(1)}deg) rotateZ(${((1 - p) * 8).toFixed(2)}deg) scale(${(0.18 + 0.82 * p).toFixed(4)})`,
    });
  }
  return frames;
}

interface Spark { x: number; y: number; vx: number; vy: number; age: number; max: number; size: number; color: string; rot: number; vr: number; kind: 0 | 1 | 2; seed: number }

/** Funken: Kreise, Splitter und Sternchen mit Schwerkraft, Luftwiderstand und Funkeln */
function burst(canvas: HTMLCanvasElement, x: number, y: number, colors: string[]): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => undefined;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  const sparks: Spark[] = [];
  const n = window.innerWidth < 500 ? 70 : 100;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 3 + Math.random() * 9;
    sparks.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3.5, age: 0, max: 55 + Math.random() * 65,
      size: 1.5 + Math.random() * 3.2, color: colors[i % colors.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      kind: (i % 5 === 0 ? 2 : i % 2) as 0 | 1 | 2, seed: Math.random() * 10,
    });
  }
  let raf = 0;
  const step = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    let alive = 0;
    for (const s of sparks) {
      if (s.age >= s.max) continue;
      alive += 1;
      s.age += 1;
      s.vy += 0.17;
      s.vx *= 0.975;
      s.vy *= 0.975;
      s.x += s.vx;
      s.y += s.vy;
      s.rot += s.vr;
      const life = 1 - s.age / s.max;
      ctx.globalAlpha = Math.max(0, life * (0.65 + 0.35 * Math.sin(s.age * 0.45 + s.seed)));
      ctx.fillStyle = s.color;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      if (s.kind === 0) {
        ctx.beginPath();
        ctx.arc(0, 0, s.size * (0.6 + 0.4 * life), 0, Math.PI * 2);
        ctx.fill();
      } else if (s.kind === 1) {
        ctx.fillRect(-s.size, -s.size * 0.35, s.size * 2, s.size * 0.7);
      } else {
        const r = s.size * 1.6;
        ctx.beginPath();
        for (let k = 0; k < 8; k++) {
          const rr = k % 2 ? r * 0.3 : r;
          const aa = (Math.PI / 4) * k;
          ctx.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (alive) raf = requestAnimationFrame(step);
    else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

function buzz(pattern: number[]) {
  try { navigator.vibrate?.(pattern); } catch { /* egal */ }
}

// ------------------------------------------------------------------ Bühne (Verleihung und Ansicht)

interface StageItem { item: ShelfItem; fresh: Emblem[] }

function slotOf(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-emb-slot="${CSS.escape(id)}"]`);
}

/** von einem Rechteck zum anderen: Verschiebung und Maßstab (Mittelpunkte) */
function flyTo(from: DOMRect, to: DOMRect) {
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  return { dx, dy, s: to.width / from.width };
}

function EmblemStage({ items, mode, onLand, onClose, probe }: {
  items: StageItem[];
  /** Verleihung (neu) oder Ansicht (aus der Vitrine geöffnet) */
  mode: 'award' | 'show';
  onLand: (item: StageItem) => void;
  onClose: () => void;
  /** Probe-Verleihung (Admin-Test): nichts wird gespeichert */
  probe?: boolean;
}) {
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<'in' | 'idle' | 'out'>('in');
  const [closing, setClosing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const tilt = useRef<HTMLDivElement>(null);
  const fx = useRef<HTMLCanvasElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const stopFx = useRef<() => void>(() => undefined);
  const cur = items[i];
  const e = cur.fresh[cur.fresh.length - 1] ?? cur.item.latest;
  const tone = TONES[e.look.tone];
  const last = i === items.length - 1;

  // Seite festhalten, solange die Bühne steht
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; stopFx.current(); };
  }, []);

  // Auftritt
  useLayoutEffect(() => {
    const el = art.current;
    if (!el) return;
    setPhase('in');
    let done = false;
    const finish = () => { if (!done) { done = true; setPhase('idle'); next.current?.focus({ preventScroll: true }); } };
    if (calm()) {
      el.animate([{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'ease-out', fill: 'both' }).finished.then(finish, finish);
      return;
    }
    if (mode === 'show') {
      // aus der Vitrine heraus: vom Platz des Emblems in die Mitte, mit Feder
      const slot = slotOf(cur.item.id);
      const r = el.getBoundingClientRect();
      const s = slot?.getBoundingClientRect();
      const f = s ? flyTo(r, s) : { dx: 0, dy: 60, s: 0.3 };
      const frames: Keyframe[] = [];
      for (let k = 0; k <= 40; k++) {
        const p = spring((k / 40) * 0.9, 220, 20);
        frames.push({ offset: k / 40, transform: `translate3d(${(f.dx * (1 - p)).toFixed(1)}px, ${(f.dy * (1 - p)).toFixed(1)}px, 0) scale(${(f.s + (1 - f.s) * p).toFixed(4)})` });
      }
      el.animate(frames, { duration: 900, easing: 'linear', fill: 'both' }).finished.then(finish, finish);
      return;
    }
    el.animate(entranceFrames(), { duration: 1250, easing: 'linear', fill: 'both' }).finished.then(finish, finish);
    // Funken, wenn das Emblem nach vorn klappt
    const t = window.setTimeout(() => {
      const r = el.getBoundingClientRect();
      if (fx.current) {
        stopFx.current();
        stopFx.current = burst(fx.current, r.left + r.width / 2, r.top + r.height / 2, [tone.hi, tone.mid, '#ffffff', tone.lo]);
      }
      buzz(e.rarity === 'legendaer' || e.rarity === 'medaille' ? [12, 40, 18, 40, 30] : [14, 30, 14]);
    }, 230);
    return () => window.clearTimeout(t);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  /** an den Platz in der Vitrine fliegen, dann weiter oder schließen */
  const go = useCallback((all = false) => {
    if (phase === 'out') return;
    const el = art.current;
    const end = () => {
      if (mode === 'award') {
        onLand(cur);
        if (all) items.slice(i + 1).forEach(onLand);
      }
      if (last || all) onClose();
      else setI((n) => n + 1);
    };
    setPhase('out');
    if (last || all) setClosing(true);
    if (!el || calm()) { window.setTimeout(end, calm() ? 200 : 0); return; }
    const slot = slotOf(cur.item.id);
    if (slot) slot.scrollIntoView({ block: 'nearest' });
    const from = el.getBoundingClientRect();
    const to = slot?.getBoundingClientRect();
    if (!to || to.width === 0) {
      el.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.6)' }], { duration: 320, easing: 'ease-in', fill: 'forwards' }).finished.then(end, end);
      return;
    }
    const f = flyTo(from, to);
    // Bogen statt Gerade: leicht nach oben ausholen, dabei eine halbe Drehung
    const frames: Keyframe[] = [];
    for (let k = 0; k <= 30; k++) {
      const t = k / 30;
      const ease = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      const lift = Math.sin(Math.PI * t) * -60;
      frames.push({ offset: t, transform: `translate3d(${(f.dx * ease).toFixed(1)}px, ${(f.dy * ease + lift).toFixed(1)}px, 0) rotateY(${(ease * 360).toFixed(1)}deg) scale(${(1 + (f.s - 1) * ease).toFixed(4)})` });
    }
    el.animate(frames, { duration: 760, easing: 'linear', fill: 'forwards' }).finished.then(end, end);
  }, [phase, mode, cur, items, i, last, onLand, onClose]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') go(true); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  // Ansicht: Emblem folgt dem Finger (leichtes Kippen)
  const onMove = (ev: ReactPointerEvent) => {
    const el = tilt.current;
    if (!el || calm()) return;
    const r = el.getBoundingClientRect();
    const x = (ev.clientX - (r.left + r.width / 2)) / r.width;
    const y = (ev.clientY - (r.top + r.height / 2)) / r.height;
    el.style.transform = `rotateY(${(x * 22).toFixed(1)}deg) rotateX(${(-y * 22).toFixed(1)}deg)`;
  };
  const onLeave = () => { if (tilt.current) tilt.current.style.transform = ''; };

  const style = { '--emb-glow': tone.glow, '--emb-hi': tone.hi, '--emb-mid': tone.mid } as CSSProperties;
  const medal = e.rarity === 'medaille';
  const list = mode === 'show' ? [...cur.item.all].reverse() : cur.fresh;

  return createPortal(
    <div
      ref={root}
      className={cx('emb-stage', `emb-stage--${mode}`, `is-${phase}`, closing && 'is-closing')}
      style={style}
      role="dialog" aria-modal="true" aria-labelledby="emb-stage-name"
      onClick={(ev) => { if (ev.target === ev.currentTarget || (ev.target as HTMLElement).classList.contains('emb-stage__center')) go(mode === 'show'); }}
      onPointerMove={onMove} onPointerLeave={onLeave}
    >
      <div className="emb-stage__rays" aria-hidden="true" />
      <canvas ref={fx} className="emb-stage__fx" aria-hidden="true" />
      <div className="emb-stage__center">
        <div className="emb-stage__art" ref={art}>
          <div className="emb-stage__glow" aria-hidden="true" />
          <div className="emb-stage__ring" aria-hidden="true" key={`ring${i}`} />
          <div className="emb-stage__float">
            <div className="emb-stage__tilt" ref={tilt}>
              <EmblemArt look={e.look} size={196} title={e.name} />
            </div>
          </div>
        </div>
        <div className="emb-stage__copy" key={`copy${i}`} aria-live="polite">
          <span className="emb-stage__eyebrow">
            {probe ? 'Probe · ' : ''}{mode === 'award' ? (medal ? 'Neue Medaille' : 'Neues Emblem') : RARITY_LABEL[e.rarity]}
            {mode === 'award' && !medal && e.rarity !== 'klassisch' ? <span className={cx('emb-rarity', `emb-rarity--${e.rarity}`)}>{RARITY_LABEL[e.rarity]}</span> : null}
          </span>
          <h2 id="emb-stage-name" className="emb-stage__name">
            {mode === 'show' ? cur.item.latest.name : e.name}
            {list.length > 1 ? <span className="emb-stage__times">×{mode === 'show' ? cur.item.all.length : list.length}</span> : null}
          </h2>
          {list.length > 1 ? (
            <ul className="emb-stage__list">
              {list.slice(0, 5).map((x) => <li key={x.key}><span>{x.text}</span><time dateTime={x.at}>{fmtDate(x.at)}</time></li>)}
              {list.length > 5 ? <li className="muted">und {list.length - 5} weitere</li> : null}
            </ul>
          ) : (
            <>
              <p className="emb-stage__text">{e.text}</p>
              <time className="emb-stage__date" dateTime={e.at}>{fmtDate(e.at)}</time>
            </>
          )}
        </div>
        <div className="emb-stage__actions">
          <button ref={next} type="button" className="emb-stage__next" onClick={() => go(false)}>
            {mode === 'show' ? 'Schließen' : !last ? 'Weiter' : probe ? 'Fertig' : 'In die Vitrine'}
          </button>
          {mode === 'award' && items.length > 1 && !last ? (
            <button type="button" className="emb-stage__skip" onClick={() => go(true)}>{probe ? 'Überspringen' : 'Alle einsortieren'} · {items.length - i}</button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ Probe (Admin-Test)

/** Probe-Verleihung mit Platzhaltern – zeigt Medaille und seltene Stufen, ohne den Katalog zu verraten */
function probeItems(theme: TourTheme): StageItem[] {
  const at = new Date().toISOString();
  const text = 'Nur zum Testen der Verleihung – wird nicht gespeichert und erscheint nicht in der Vitrine.';
  const list: Emblem[] = [
    { key: 'probe:medaille', id: 'probe:medaille', name: 'Probemedaille', text, rarity: 'medaille', look: { shape: 'medal', tone: 'gold', glyph: '1', ribbon: theme }, at, tour: null },
    { key: 'probe:episch', id: 'probe:episch', name: 'Probe-Emblem', text, rarity: 'episch', look: { shape: 'star', tone: 'violet', glyph: '?' }, at, tour: null },
    { key: 'probe:legendaer', id: 'probe:legendaer', name: 'Probe-Emblem', text, rarity: 'legendaer', look: { shape: 'shield', tone: 'prism', glyph: 'sparkle' }, at, tour: null },
  ];
  return list.map((e) => ({ item: { id: e.id, latest: e, all: [e] }, fresh: [e] }));
}

// ------------------------------------------------------------------ Vitrine

function Tally({ count }: { count: { gold: number; silver: number; bronze: number } }) {
  const parts = (['gold', 'silver', 'bronze'] as const).filter((k) => count[k] > 0);
  if (!parts.length) return null;
  const word = { gold: 'Gold', silver: 'Silber', bronze: 'Bronze' };
  return (
    <span className="emb-tally" aria-label={parts.map((k) => `${count[k]}× ${word[k]}`).join(', ')}>
      {parts.map((k) => <span key={k} className={`emb-tally__dot emb-tally__dot--${k}`}>{count[k]}</span>)}
    </span>
  );
}

function Tile({ item, shown, landing, index, onOpen, medal }: {
  item: ShelfItem; shown: number; landing: boolean; index: number; onOpen: () => void; medal?: boolean;
}) {
  const e = item.latest;
  return (
    <button
      type="button"
      className={cx('emb-tile', medal && 'emb-tile--medal', shown === 0 && 'is-pending', landing && 'is-landing')}
      onClick={onOpen}
      aria-label={`${e.name}${shown > 1 ? `, ${shown}-mal` : ''}`}
      style={{ ['--d' as string]: `${(index * 1.7) % 9}s` }}
    >
      <span className="emb-tile__art" data-emb-slot={item.id}>
        <EmblemArt look={e.look} size={medal ? 84 : 70} />
        {shown > 1 ? <span className="emb-tile__count" key={shown}>×{shown}</span> : null}
      </span>
      <span className="emb-tile__name">{medal ? e.tour?.label ?? e.name : e.name}</span>
      {medal ? <span className="emb-tile__sub">{e.look.tone === 'gold' ? 'Gold' : e.look.tone === 'silver' ? 'Silber' : 'Bronze'}</span> : null}
    </button>
  );
}

export function EmblemCase({ me }: { me: Profile }) {
  const q = useEmblems(me);
  const { tour } = useApp();
  const route = useRoute();
  const [probe, setProbe] = useState<StageItem[] | null>(null);
  const list = useMemo(() => q.data ?? [], [q.data]);
  const [seen, setSeen] = useState<Set<string>>(() => readSeen(me.id));
  const [queue, setQueue] = useState<StageItem[] | null>(null);
  const [showing, setShowing] = useState<StageItem | null>(null);
  const [landing, setLanding] = useState<Set<string>>(new Set());
  const { medals, badges, count } = useMemo(() => shelf(list), [list]);

  // neue Embleme: nacheinander verleihen (je Fach eine Verleihung, älteste zuerst)
  const running = !!queue?.length;
  const freshKey = (q.data ?? []).filter((x) => !seen.has(x.key)).map((x) => x.key).join('|');
  const build = useRef<() => StageItem[]>(() => []);
  build.current = () => [...medals, ...badges]
    .map((item) => ({ item, fresh: item.all.filter((x) => !seen.has(x.key)) }))
    .filter((x) => x.fresh.length)
    // der Reihe nach, wie sie verdient wurden; am selben Tag zuerst das Willkommen, das Seltenste zuletzt
    .sort((a, b) => {
      const ea = a.fresh[a.fresh.length - 1];
      const eb = b.fresh[b.fresh.length - 1];
      return ea.at.localeCompare(eb.at) || Number(eb.id === 'start') - Number(ea.id === 'start') || CEREMONY_ORDER[ea.rarity] - CEREMONY_ORDER[eb.rarity];
    });
  useEffect(() => {
    if (!freshKey || running) return;
    // kurz warten: erst steht die Seite, dann beginnt die Verleihung
    const t = window.setTimeout(() => setQueue(build.current()), 650);
    return () => window.clearTimeout(t);
  }, [freshKey, running]);

  const land = useCallback((it: StageItem) => {
    setSeen((prev) => {
      const nextSeen = new Set(prev);
      for (const x of it.fresh) nextSeen.add(x.key);
      writeSeen(me.id, nextSeen);
      return nextSeen;
    });
    setLanding((prev) => new Set(prev).add(it.item.id));
    window.setTimeout(() => setLanding((prev) => { const n = new Set(prev); n.delete(it.item.id); return n; }), 1100);
  }, [me.id]);

  const shownCount = (item: ShelfItem) => item.all.filter((x) => seen.has(x.key)).length;

  // Testen: eigene Verleihung wiederholen (vergisst auf diesem Gerät, was schon gezeigt wurde) oder Probe (nur Admins)
  const replay = useCallback(() => {
    writeSeen(me.id, new Set());
    setSeen(new Set());
    setQueue(null);
  }, [me.id]);
  const startProbe = useCallback(() => setProbe(probeItems(tour?.theme ?? 'giro')), [tour?.theme]);
  // auch per Adresse: #/profil?embleme=neu bzw. #/profil?embleme=probe
  const param = route.query.get('embleme');
  const loaded = q.data !== undefined;
  useEffect(() => {
    if (!loaded) return;
    if (param === 'neu') replay();
    else if (param === 'probe' && me.is_admin) startProbe();
  }, [param, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.loading) {
    return (
      <section className="card emb-case" aria-busy="true" aria-labelledby="emb-title">
        <div className="emb-case__head"><h2 id="emb-title" className="card__title">Embleme</h2></div>
        <div className="emb-grid">{[0, 1, 2].map((k) => <span key={k} className="emb-tile emb-tile--skel"><span className="skel" style={{ width: 62, height: 62, borderRadius: '50%' }} /></span>)}</div>
      </section>
    );
  }

  return (
    <section className="card emb-case" aria-labelledby="emb-title">
      <div className="emb-case__head">
        <h2 id="emb-title" className="card__title">Embleme</h2>
        <Tally count={count} />
      </div>
      {medals.length ? (
        <div className="emb-medals" aria-label="Medaillen">
          {medals.map((m, k) => (
            <Tile key={m.id} item={m} medal index={k} shown={shownCount(m)} landing={landing.has(m.id)} onOpen={() => setShowing({ item: m, fresh: [] })} />
          ))}
        </div>
      ) : null}
      {badges.length ? (
        <div className="emb-grid" aria-label="Abzeichen">
          {badges.map((b, k) => (
            <Tile key={b.id} item={b} index={k + medals.length} shown={shownCount(b)} landing={landing.has(b.id)} onOpen={() => setShowing({ item: b, fresh: [] })} />
          ))}
        </div>
      ) : null}
      {!list.length ? (
        <div className="emb-empty">
          <span className="emb-empty__shape" aria-hidden="true" />
          <p>Noch leer. Embleme und Medaillen gibt es für besondere Momente in der Tipprunde – welche, verraten wir nicht.</p>
        </div>
      ) : null}

      {me.is_admin ? (
        <div className="emb-test">
          <span className="emb-test__label">Admin-Test</span>
          <button type="button" className="emb-test__btn" onClick={replay} disabled={!list.length || running}>Verleihung wiederholen</button>
          <button type="button" className="emb-test__btn" onClick={startProbe} disabled={running || !!probe}>Probe mit Medaille</button>
        </div>
      ) : null}

      {running ? (
        <EmblemStage items={queue!} mode="award" onLand={land} onClose={() => setQueue([])} />
      ) : null}
      {probe && !running ? (
        <EmblemStage items={probe} mode="award" probe onLand={() => undefined} onClose={() => setProbe(null)} />
      ) : null}
      {showing && !running && !probe ? (
        <EmblemStage items={[showing]} mode="show" onLand={() => undefined} onClose={() => setShowing(null)} />
      ) : null}
    </section>
  );
}
