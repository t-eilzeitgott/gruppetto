/**
 * Feiertage im neuen Jahr: Valentinstag, Karneval (Weiberfastnacht bis Veilchendienstag), Ostern (Karfreitag bis
 * Ostermontag).
 */
import { at, h, hideDot, onDot, rnd, rollOut, showDot, type Ctx, type Variant } from '../engine';

const once = new Set<string>();
const css = (c: Ctx, id: string, s: string) => { if (!once.has(id)) { once.add(id); c.css(s); } };
const svg = (vb: string, body: string) => `<svg viewBox="${vb}" width="100%" height="100%" style="overflow:visible;display:block">${body}</svg>`;

const morphBack = (c: Ctx, nodes: Element[], dur: number) => {
  for (const n of nodes) n.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.3)' }], { duration: dur * 0.55, easing: 'ease-in', fill: 'forwards' });
  showDot(c, dur * 0.45, dur * 0.2);
};

// ---------------------------------------------------------------- Valentinstag

const HEART_D = 'M50 90C22 68 4 50 4 31 4 16 15 6 29 6 39 6 46 12 50 21 54 12 61 6 71 6 85 6 96 16 96 31 96 50 78 68 50 90Z';
const HEART = svg('0 0 100 100', `<defs><linearGradient id="ixHt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a96"/><stop offset="1" stop-color="#e3214d"/></linearGradient></defs>
<path d="${HEART_D}" fill="url(#ixHt)"/><ellipse cx="29" cy="25" rx="10" ry="6" fill="#fff" opacity=".35" transform="rotate(-30 29 25)"/>`);

/**
 * Valentinstag: das Wort rollt aus, beim Aufsetzen wird der Punkt zu einem kleinen Herz, das schlägt – bei jedem
 * Schlag ein leiser Ring; ab und zu steigt ein winziges Herz auf.
 */
export const valentin: Variant = (c) => {
  const { fs, dot } = c.geo;
  css(c, 'ix-vl', `.ix-vl-ring{border-radius:50%;box-shadow:0 0 0 2px rgba(255,90,120,.7);opacity:0}`);
  const s = fs * 0.5;
  const ht = onDot(c, h('div', '', 'opacity:0', HEART), s, s, { ax: 0.5, ay: 0.5, mid: true, dx: fs * 0.08, dy: -fs * 0.08 });
  const ring = at(c.back, h('div', 'ix-vl-ring'), dot.x + fs * 0.08, dot.y - fs * 0.08, s * 0.9, s * 0.9);
  if (c.calm) { hideDot(c); ht.style.opacity = '1'; return { ping: false, leave: (dur) => morphBack(c, [ht], dur) }; }
  const { land } = rollOut(c, { clip: true });
  c.A(c.dotin, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.8)' }], { duration: 200, delay: land + 40, easing: 'ease-in', fill: 'forwards' });
  c.A(ht, [{ opacity: 0, transform: 'scale(0)' }, { opacity: 1, transform: 'scale(1.3)', offset: 0.6 }, { opacity: 1, transform: 'scale(1)' }], { duration: 480, delay: land + 80, easing: 'cubic-bezier(.2,.9,.3,1.1)', fill: 'both' });
  return {
    land: land + 560,
    ping: false,
    idle() {
      // „lub-dub": zwei Schläge, dann Pause
      c.F(ht, [
        { transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: 0.08 }, { transform: 'scale(1)', offset: 0.17 },
        { transform: 'scale(1.11)', offset: 0.25 }, { transform: 'scale(1)', offset: 0.36 }, { transform: 'scale(1)' },
      ], { duration: 1150, iterations: Infinity, easing: 'ease-in-out' });
      c.F(ring, [{ opacity: 0.7, transform: 'scale(.8)' }, { opacity: 0, transform: 'scale(2.6)', offset: 0.6 }, { opacity: 0 }], { duration: 1150, iterations: Infinity, easing: 'ease-out' });
      for (let i = 0; i < 3; i++) {
        const sz = fs * rnd(0.16, 0.24);
        const tiny = at(c.back, h('div', '', 'opacity:0', HEART), dot.x + rnd(-fs * 0.4, fs * 0.5), dot.y - fs * 0.3, sz, sz);
        c.F(tiny, [{ opacity: 0, transform: 'translate(0,0) scale(.6)' }, { opacity: 0.8, transform: `translate(${rnd(-8, 8)}px,${-fs * 0.6}px) scale(1)`, offset: 0.3 }, { opacity: 0, transform: `translate(${rnd(-20, 20)}px,${-fs * 2.2}px) scale(.8)` }], { duration: 2400, delay: 300 + i * 800, iterations: Infinity, easing: 'ease-out' });
      }
    },
    leave: (dur) => morphBack(c, [ht], dur),
  };
};

// ---------------------------------------------------------------- Karneval

const CONFETTI = ['#ff4d6d', '#ffd23f', '#3ddc84', '#4dabff', '#b388ff', '#ff8c42', '#ffffff'];

/** ein Stück Konfetti: Streifen, Viereck oder Kreis */
function piece(i: number, k: number): HTMLElement {
  const col = CONFETTI[i % CONFETTI.length];
  const shape = i % 3;
  const w = shape === 0 ? 7 * k : 5 * k, hh = shape === 0 ? 3.2 * k : 5 * k;
  const e = h('div', '', `position:absolute;left:0;top:0;width:${w}px;height:${hh}px;background:${col};border-radius:${shape === 2 ? '50%' : '1px'};opacity:0`);
  return e;
}

/**
 * Karneval: das Wort rollt aus, beim Aufsetzen platzt aus dem Punkt eine Ladung Konfetti, bunte Luftschlangen
 * rollen sich aus; beim Warten rieselt es weiter von oben.
 */
export const karneval: Variant = (c) => {
  const { fs, dot, vw, vh } = c.geo;
  const k = fs / 48;
  if (c.calm) return rollOut(c);
  const { land } = rollOut(c, { clip: true });
  c.at(land - 10, () => {
    // Konfetti aus dem Punkt: nach oben und zur Seite, dann flatternd fallen
    for (let i = 0; i < 42; i++) {
      const p = piece(i, k);
      const wrap = at(c.front, h('div'), dot.x, dot.y, 1, 1);
      wrap.appendChild(p);
      const ang = rnd(-Math.PI * 0.95, -Math.PI * 0.05);
      const sp = fs * rnd(1.4, 3.6);
      const vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;
      const fall = vh * rnd(0.25, 0.45);
      const rot = rnd(-720, 720);
      const kf: Keyframe[] = [];
      for (let j = 0; j <= 12; j++) {
        const u = j / 12;
        const e = 1 - (1 - Math.min(1, u * 2.2)) ** 2;
        const x = vx * e + Math.sin(u * 9 + i) * fs * 0.15 * u;
        const y = vy * e + fall * Math.max(0, u - 0.3) ** 1.4;
        kf.push({ offset: u, opacity: u === 0 ? 0 : u > 0.8 ? (1 - u) / 0.2 : 1, transform: `translate(${x}px,${y}px) rotate(${rot * u}deg) scaleY(${(0.25 + 0.75 * Math.abs(Math.cos(u * 14 + i))).toFixed(2)})` });
      }
      c.F(p, kf, { duration: rnd(1700, 2600), easing: 'linear', fill: 'forwards' });
    }
    // Luftschlangen: geschwungene Linien, die sich vom Punkt aus abrollen
    const dirs = [[-0.45, -1.6], [0.35, -1.7], [1.35, -1], [1.55, 0.35]];
    dirs.forEach(([dx, dy], i) => {
      const col = CONFETTI[(i * 2 + 1) % CONFETTI.length];
      // Luftschlange: Kringel (Schraube) entlang der Richtung
      const L = fs * 1.9;
      const len = Math.hypot(dx, dy);
      const ux = dx / len, uy = dy / len;
      let d = 'M0 0';
      for (let j = 1; j <= 48; j++) {
        const u = j / 48;
        const a = u * Math.PI * 2 * 3.2;
        const rad = fs * 0.16 * (0.4 + u * 0.6);
        const along = L * u + Math.cos(a) * rad * 0.6 - rad * 0.6;
        const side = Math.sin(a) * rad;
        d += `L${(ux * along - uy * side).toFixed(1)} ${(uy * along + ux * side + fs * 0.35 * u * u).toFixed(1)}`;
      }
      const s = at(c.front, h('div', '', 'overflow:visible', `<svg width="1" height="1" style="overflow:visible;display:block"><path d="${d}" fill="none" stroke="${col}" stroke-width="${2.2 * k}" stroke-linecap="round" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1"/></svg>`), dot.x, dot.y, 1, 1);
      const path = s.querySelector('path')!;
      c.F(path, [{ strokeDashoffset: '1' }, { strokeDashoffset: '0' }], { duration: 700, delay: i * 70, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
      c.F(s, [{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 2600, delay: i * 70, fill: 'forwards' });
    });
  });
  return {
    land,
    idle() {
      // es rieselt weiter von oben
      for (let i = 0; i < 16; i++) {
        const p = piece(i + 3, k * 0.9);
        const wrap = at(c.back, h('div'), vw * rnd(0, 1), -10, 1, 1);
        wrap.appendChild(p);
        c.F(p, [
          { opacity: 0, transform: 'translate(0,0) rotate(0deg)' },
          { opacity: 0.9, transform: `translate(${rnd(-20, 20)}px,${vh * 0.15}px) rotate(120deg) scaleY(.4)`, offset: 0.15 },
          { opacity: 0.9, transform: `translate(${rnd(-30, 30)}px,${vh * 0.6}px) rotate(300deg) scaleY(1)`, offset: 0.6 },
          { opacity: 0, transform: `translate(${rnd(-30, 30)}px,${vh + 20}px) rotate(520deg) scaleY(.5)` },
        ], { duration: rnd(4500, 7000), delay: rnd(0, 3000), iterations: Infinity, easing: 'linear' });
      }
      c.ping.animate([{ opacity: 0.55, transform: 'scale(.4)' }, { opacity: 0, transform: 'scale(2.6)' }], { duration: 1100, iterations: Infinity, easing: 'cubic-bezier(.2,.6,.3,1)' });
    },
  };
};

// ---------------------------------------------------------------- Ostern

const EGG_COLS: [string, string, string][] = [
  ['#ffd6e2', '#ff9fbb', '#e2557d'],
  ['#d2ecff', '#93ccff', '#3b86d6'],
  ['#fff3b0', '#ffe066', '#e0a400'],
  ['#d9f5cf', '#a5e08f', '#4c9d3a'],
];

function egg(i: number): string {
  const [a, b, d] = EGG_COLS[i % EGG_COLS.length];
  return svg('0 0 100 120', `<defs><radialGradient id="ixEg${i}" cx="38%" cy="32%" r="78%"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>
<clipPath id="ixEc${i}"><path d="M50 3C77 3 93 47 93 74 93 99 75 117 50 117 25 117 7 99 7 74 7 47 23 3 50 3Z"/></clipPath></defs>
<path d="M50 3C77 3 93 47 93 74 93 99 75 117 50 117 25 117 7 99 7 74 7 47 23 3 50 3Z" fill="url(#ixEg${i})"/>
<g clip-path="url(#ixEc${i})" fill="none" stroke="${d}" stroke-width="5" stroke-linejoin="round">
<path d="M0 62L12 52 24 62 36 52 48 62 60 52 72 62 84 52 96 62 108 52"/>
<path d="M0 82L12 92 24 82 36 92 48 82 60 92 72 82 84 92 96 82 108 92" stroke="#ffffff" stroke-opacity=".85"/>
</g>
<g fill="${d}"><circle cx="34" cy="34" r="4"/><circle cx="58" cy="28" r="3.4"/><circle cx="68" cy="42" r="3"/><circle cx="44" cy="104" r="3.4"/><circle cx="62" cy="106" r="3"/></g>`);
}

const GRASS = svg('0 0 100 40', `<g fill="none" stroke-linecap="round" stroke-width="5">
<path d="M14 40C14 28 10 20 4 14" stroke="#5aa64a"/><path d="M30 40C30 26 32 16 38 6" stroke="#4c9d3a"/><path d="M48 40C48 30 44 22 40 18" stroke="#6bb85a"/>
<path d="M66 40C66 26 70 16 76 10" stroke="#5aa64a"/><path d="M84 40C84 30 88 24 96 18" stroke="#4c9d3a"/></g>`);

/**
 * Ostern: statt zu rollen hüpft ein Osterei wie ein Hase in drei Sprüngen ans Wortende, deckt dabei das Wort auf,
 * landet in einem Grasbüschel und wackelt nach. Die Farbe des Eis wechselt von Jahr zu Jahr.
 */
export const ostern: Variant = (c) => {
  const { fs, pc } = c.geo;
  const i = new Date().getFullYear() % EGG_COLS.length;
  const W = fs * 0.46, H = W * 1.2;
  const grass = onDot(c, h('div', '', 'opacity:0;transform-origin:50% 100%', GRASS), W * 1.9, W * 0.76, { ax: 0.5, ay: 1, dx: fs * 0.1, dy: fs * 0.04 });
  const eg = onDot(c, h('div', '', 'transform-origin:50% 100%', egg(i)), W, H, { ax: 0.5, ay: 1, dx: fs * 0.1, dy: fs * 0.02 });
  hideDot(c);
  if (c.calm) { grass.style.opacity = '1'; return { leave: (dur) => morphBack(c, [eg, grass], dur) }; }
  const { land } = rollOut(c, { clip: true, hop: 0, squash: null, edge: pc.x + fs * 0.1 });
  // drei Hasensprünge (hoch: abbremsen, runter: beschleunigen)
  const up = 'cubic-bezier(.2,.6,.4,1)', down = 'cubic-bezier(.6,0,.8,.4)';
  c.A(c.dot, [
    { offset: 0, transform: 'translateY(0)', easing: up }, { offset: 0.17, transform: 'translateY(-.62em)', easing: down },
    { offset: 0.34, transform: 'translateY(0)', easing: up }, { offset: 0.52, transform: 'translateY(-.48em)', easing: down },
    { offset: 0.7, transform: 'translateY(0)', easing: up }, { offset: 0.85, transform: 'translateY(-.26em)', easing: down },
    { offset: 1, transform: 'translateY(0)' },
  ], { duration: 650, delay: 300, fill: 'both' });
  // in der Luft nach vorn geneigt, beim Landen gestaucht
  c.A(eg, [
    { offset: 0, transform: 'rotate(0) scale(1)' }, { offset: 0.1, transform: 'rotate(12deg) scale(.95,1.06)' }, { offset: 0.32, transform: 'rotate(0) scale(1.1,.88)' },
    { offset: 0.42, transform: 'rotate(10deg) scale(.96,1.05)' }, { offset: 0.68, transform: 'rotate(0) scale(1.1,.9)' },
    { offset: 0.78, transform: 'rotate(8deg)' }, { offset: 1, transform: 'rotate(0) scale(1)' },
  ], { duration: 650, delay: 300, easing: 'ease-in-out', fill: 'both' });
  // Nachwackeln und Gras
  c.A(eg, [{ transform: 'rotate(0)' }, { transform: 'rotate(14deg)' }, { transform: 'rotate(-10deg)' }, { transform: 'rotate(6deg)' }, { transform: 'rotate(-3deg)' }, { transform: 'rotate(0)' }], { duration: 900, delay: land, easing: 'ease-in-out', fill: 'forwards' });
  c.A(grass, [{ opacity: 0, transform: 'scaleY(0)' }, { opacity: 1, transform: 'scaleY(1.1)', offset: 0.7 }, { opacity: 1, transform: 'scaleY(1)' }], { duration: 420, delay: land - 40, easing: 'ease-out', fill: 'both' });
  return {
    land: land + 400,
    idle() {
      c.F(eg, [{ transform: 'rotate(0)' }, { transform: 'rotate(10deg)', offset: 0.1 }, { transform: 'rotate(-7deg)', offset: 0.2 }, { transform: 'rotate(4deg)', offset: 0.3 }, { transform: 'rotate(0)', offset: 0.4 }, { transform: 'rotate(0)' }], { duration: 2400, delay: 600, iterations: Infinity, easing: 'ease-in-out' });
    },
    leave: (dur) => morphBack(c, [eg, grass], dur),
  };
};
