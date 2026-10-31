/**
 * Renntag: an Tagen mit Etappe zeichnet sich unter dem Wort das Profil der Etappe (nach ihrer Art: flach,
 * hügelig, Berg mit Gipfelankunft, Zeitfahren), der Punkt fährt es in der Farbe der Rundfahrt ab, springt am Ziel
 * hinter das Wort, und darunter stehen Etappe, Start und Ziel. Im Zeitfahren läuft die Uhr mit, im
 * Mannschaftszeitfahren fahren drei Teamkollegen hinterher.
 */
import { demoRace } from '../schedule';
import { at, bezier, h, ROLL, type Ctx, type Variant } from '../engine';

const KIND: Record<string, string> = { flat: 'Flachetappe', hilly: 'Hügelig', mountain: 'Bergetappe', itt: 'Einzelzeitfahren', ttt: 'Mannschaftszeitfahren' };
const START: Record<string, string> = { giro: 'Grande Partenza', tour: 'Grand Départ', vuelta: 'La Salida' };

const once = new Set<string>();
const css = (c: Ctx, id: string, s: string) => { if (!once.has(id)) { once.add(id); c.css(s); } };

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Höhenprofil (u = Strecke 0 … 1, v = Höhe 0 … 1) nach Art der Etappe, fest je Etappennummer */
export function stageProfile(kind: string, n: number): [number, number][] {
  const r = mulberry(n * 7919 + kind.length * 131);
  const bumps: [number, number, number][] = [];
  let finish = 0;
  if (kind === 'flat') for (let i = 0; i < 4; i++) bumps.push([r(), 0.05 + r() * 0.08, 0.05 + r() * 0.07]);
  else if (kind === 'hilly') for (let i = 0; i < 5; i++) bumps.push([0.08 + r() * 0.84, 0.22 + r() * 0.32, 0.035 + r() * 0.05]);
  else if (kind === 'mountain') {
    bumps.push([0.2 + r() * 0.08, 0.45 + r() * 0.15, 0.065]);
    bumps.push([0.5 + r() * 0.08, 0.6 + r() * 0.15, 0.07]);
    finish = 0.9;
  } else for (let i = 0; i < 3; i++) bumps.push([r(), 0.02 + r() * 0.03, 0.08]);
  const out: [number, number][] = [];
  for (let i = 0; i <= 90; i++) {
    const u = i / 90;
    let v = 0.08;
    for (const [p, a, w] of bumps) v += a * Math.exp(-((u - p) ** 2) / (2 * w * w));
    if (finish) v += finish * sstep(0.74, 1, u) ** 1.25;
    v += (Math.sin(u * 47 + n) + Math.sin(u * 93 + n * 3)) * 0.007;
    out.push([u, Math.max(0, Math.min(1, v))]);
  }
  return out;
}

export const renntag: Variant = (c) => {
  const race = c.pick.race ?? demoRace(c.pick.p);
  const d = document.documentElement;
  if (race.t === 'giro' || race.t === 'tour' || race.t === 'vuelta') d.dataset.tour = race.t;
  // Farbe der Rundfahrt im Intro festhalten (die App setzt beim Laden ihre gewählte Rundfahrt)
  c.el.style.setProperty('--accent', getComputedStyle(d).getPropertyValue('--accent').trim());
  const { fs, dot, vw, pc } = c.geo;
  css(c, 'ix-rt', `.ix-rt-svg{position:absolute;inset:0;color:var(--accent)}
.ix-rt-1{font:700 ${Math.round(fs * 0.24)}px var(--font);letter-spacing:.14em;text-transform:uppercase;color:var(--accent);text-align:center;white-space:nowrap}
.ix-rt-2{font:500 ${Math.round(fs * 0.29)}px var(--font);color:var(--muted);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ix-rt-clock{font:700 ${Math.round(fs * 0.27)}px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.ix-rt-mate{border-radius:50%;background:var(--accent)}`);
  // ---- Profil auf dem Schirm
  const tt = race.k === 'itt' || race.k === 'ttt';
  const prof = stageProfile(race.k, race.n);
  const x0 = vw * 0.1, x1 = vw * 0.9;
  const baseY = dot.base + fs * 1.65;
  const hMax = fs * (race.k === 'flat' || tt ? 0.9 : race.k === 'mountain' ? 1.5 : 1.25);
  const P = prof.map(([u, v]) => [x0 + (x1 - x0) * u, baseY - v * hMax] as [number, number]);
  const line = P.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const area = `${line}L${x1.toFixed(1)} ${baseY.toFixed(1)}L${x0.toFixed(1)} ${baseY.toFixed(1)}Z`;
  const W = vw, Hh = c.geo.vh;
  const box = h('div', '', 'position:absolute;inset:0', `<svg class="ix-rt-svg" width="${W}" height="${Hh}" style="display:block">
<defs><linearGradient id="ixRp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".26"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
<path d="M${x0} ${baseY}H${x1}" stroke="var(--muted)" stroke-opacity=".35" stroke-width="1"/>
<path d="${area}" fill="url(#ixRp)"/>
<path d="${line}" fill="none" stroke="currentColor" stroke-width="${Math.max(2, fs * 0.055)}" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`);
  c.back.appendChild(box);
  // Ziel: kleine karierte Fahne am Ende
  const [ex, ey] = P[P.length - 1];
  const flag = at(c.back, h('div', '', 'opacity:0', `<svg viewBox="0 0 24 34" width="100%" height="100%" style="display:block;overflow:visible">
<path d="M2 34V2" stroke="var(--muted)" stroke-width="2"/>
<g transform="translate(3 2)"><rect width="18" height="12" fill="var(--text)"/><path d="M0 0h4.5v4h-4.5zM9 0h4.5v4h-4.5zM4.5 4h4.5v4h-4.5zM13.5 4h4.5v4h-4.5zM0 8h4.5v4h-4.5zM9 8h4.5v4h-4.5z" fill="var(--bg)"/></g></svg>`), ex + fs * 0.12, ey - fs * 0.34, fs * 0.36, fs * 0.5);
  // Bogenlänge für gleichmäßige Fahrt
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const total = cum[cum.length - 1];
  const pointAt = (s: number): [number, number] => {
    const L = Math.max(0, Math.min(1, s)) * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < L) i++;
    const f = (L - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * f, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * f];
  };
  // ---- Text darunter
  const first = race.n === 1 ? START[race.t] : race.last ? 'Schlussetappe' : race.tour ?? '';
  const l1 = at(c.back, h('div', 'ix-rt-1', 'opacity:0'), vw / 2, baseY + fs * 0.5, vw * 0.9, fs * 0.36);
  l1.textContent = `${first ? `${first} · ` : ''}Etappe ${race.n}${tt ? ` · ${KIND[race.k]}` : ''}`;
  const route = race.from && race.to ? (race.from === race.to ? race.from : `${race.from} → ${race.to}`) : KIND[race.k] ?? '';
  const l2 = at(c.back, h('div', 'ix-rt-2', 'opacity:0'), vw / 2, baseY + fs * 0.92, vw * 0.88, fs * 0.42);
  l2.textContent = `${route}${race.km ? ` · ${Math.round(race.km)} km` : ''}`;

  if (c.calm) {
    for (const n of [flag, l1, l2]) n.style.opacity = '1';
    return {};
  }
  c.cover.style.display = 'none';
  const t0 = 120, RIDE = 1150, JUMP = 320;
  const D = RIDE + JUMP;
  const ease = bezier(0.32, 0, 0.3, 1);
  const r = pc.r;
  // Profil wird hinter dem Punkt sichtbar, der Punkt fährt auf der Linie
  const N = 36;
  const ride: Keyframe[] = [];
  const reveal: Keyframe[] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const [x, y] = pointAt(ease.y(u));
    const off = (u * RIDE) / D;
    ride.push({ offset: off, transform: `translate(${(x - dot.x).toFixed(1)}px,${(y - r * 1.1 - dot.y).toFixed(1)}px)` });
    reveal.push({ offset: u, clipPath: `inset(-20px ${Math.max(0, W - x).toFixed(1)}px -20px 0px)` });
  }
  // Sprung vom Ziel hinter das Wort
  for (let i = 1; i <= 8; i++) {
    const u = i / 8;
    const x = (ex - dot.x) * (1 - u);
    const y = (ey - r * 1.1 - dot.y) * (1 - u) - Math.sin(u * Math.PI) * fs * 0.9;
    ride.push({ offset: (RIDE + JUMP * u) / D, transform: `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)` });
  }
  c.A(c.dot, ride, { duration: D, delay: t0, easing: 'linear', fill: 'both' });
  c.A(box, reveal, { duration: RIDE, delay: t0, easing: 'linear', fill: 'both' });
  c.A(flag, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 400, delay: 60, easing: 'ease-out', fill: 'both' });
  // Wort erscheint von links, während der Punkt hinüberspringt
  c.A(c.word, [{ clipPath: 'inset(-40% 100% -50% -30%)', opacity: 0.2 }, { clipPath: 'inset(-40% 0% -50% -30%)', opacity: 1 }], { duration: 520, delay: t0 + RIDE - 240, easing: ROLL, fill: 'both' });
  c.A(c.dotin, [{ transform: 'scale(1)' }, { transform: 'scale(1.3,.74)' }, { transform: 'scale(.92,1.1)' }, { transform: 'scale(1)' }], { duration: 380, delay: t0 + D - 20, easing: 'ease-out', fill: 'both' });
  c.A(l1, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 420, delay: t0 + RIDE - 100, easing: 'ease-out', fill: 'both' });
  c.A(l2, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 420, delay: t0 + RIDE + 20, easing: 'ease-out', fill: 'both' });
  // Zeitfahren: Uhr über dem Ziel; Mannschaftszeitfahren: drei Kollegen dahinter
  if (tt) {
    const clock = at(c.back, h('div', 'ix-rt-clock', 'opacity:0'), ex - fs * 1.2, ey - fs * 0.62, fs * 2.2, fs * 0.4);
    const kmh = race.k === 'ttt' ? 54 : 48;
    const secs = Math.round(((race.km ?? 30) / kmh) * 3600);
    const fmt = (s: number) => { const m = Math.floor(s / 60); const hh = Math.floor(m / 60); const ss = String(s % 60).padStart(2, '0'); return hh ? `${hh}:${String(m % 60).padStart(2, '0')}:${ss}` : `${m}:${ss}`; };
    clock.textContent = fmt(0);
    c.A(clock, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: t0, fill: 'both' });
    for (let t = 0; t <= RIDE; t += 40) c.at(t0 + t, () => { clock.textContent = fmt(Math.round(secs * ease.y(Math.min(1, t / RIDE)))); });
    if (race.k === 'ttt') {
      for (let m = 1; m <= 3; m++) {
        const sz = r * 1.7;
        const mate = at(c.back, h('div', 'ix-rt-mate', `opacity:${1 - m * 0.18}`), 0, 0, sz, sz);
        const kf: Keyframe[] = [];
        for (let i = 0; i <= N; i++) {
          const u = i / N;
          const [x, y] = pointAt(Math.max(0, ease.y(u) - m * 0.028));
          kf.push({ offset: u, transform: `translate(${x.toFixed(1)}px,${(y - sz * 0.55).toFixed(1)}px)` });
        }
        c.A(mate, kf, { duration: RIDE, delay: t0, easing: 'linear', fill: 'both' });
      }
    }
  }
  return { land: t0 + D + 60 };
};
