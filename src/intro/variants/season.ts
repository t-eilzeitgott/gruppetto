/**
 * Themenwochen bis Jahresende: Herbstlaub, Laternen (St. Martin), Novembernebel, Raureif, Advent (1–4 Kerzen),
 * Weihnachten, Schneeball (zwischen den Jahren), Silvester, Neujahr. Jede ist eine kleine Abwandlung des
 * gewohnten Intros – der Punkt rollt das Wort aus und wird am Ende wieder zum Punkt.
 */
import { at, h, hideDot, onDot, rnd, rollOut, shiftMark, showDot, type Ctx, type Variant } from '../engine';

const once = new Set<string>();
const css = (c: Ctx, id: string, s: string) => { if (!once.has(id)) { once.add(id); c.css(s); } };
const svg = (vb: string, body: string) => `<svg viewBox="${vb}" width="100%" height="100%" style="overflow:visible;display:block">${body}</svg>`;

/** Schmuck am Punkt beim Abflug zurück zum Punkt verwandeln */
const morphBack = (c: Ctx, nodes: Element[], dur: number) => {
  for (const n of nodes) n.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.3)' }], { duration: dur * 0.55, easing: 'ease-in', fill: 'forwards' });
  showDot(c, dur * 0.45, dur * 0.2);
};

// ---------------------------------------------------------------- Herbstlaub

const MAPLE = 'M50 4L58 24 74 16 70 36 92 34 80 50 96 62 72 66 76 86 56 74 52 95 48 95 44 74 24 86 28 66 4 62 20 50 8 34 30 36 26 16 42 24Z';
const OVAL = 'M50 5C79 26 80 70 50 95 20 70 21 26 50 5Z';
const LEAF_COLS = ['#e2a03a', '#c8562a', '#d8b24a', '#a8432a', '#e07b2f', '#b9772c'];

function leaf(i: number): string {
  const col = LEAF_COLS[i % LEAF_COLS.length];
  const maple = i % 3 !== 1;
  return svg('0 0 100 100', `<path d="${maple ? MAPLE : OVAL}" fill="${col}"/><path d="M50 ${maple ? 18 : 10}L50 99" stroke="rgba(60,25,8,.45)" stroke-width="3" fill="none"/>`);
}

/**
 * Herbstlaub: der rollende Punkt wirbelt hinter sich Blätter auf (Ahorn, Buche – rostrot, ocker, bernstein), die
 * trudelnd zu Boden segeln; beim Warten fällt ab und zu ein Blatt von oben durchs Bild.
 */
export const laub: Variant = (c) => {
  const { fs, dot, word, vw, vh, hidden } = c.geo;
  if (c.calm) return rollOut(c);
  const { land } = rollOut(c, { clip: true });
  // aufgewirbelt hinter dem Punkt (Lage des Punkts während des Rollens: von hinter dem „g" bis ans Ende)
  for (let i = 0; i < 7; i++) {
    const p = 0.12 + i * 0.13;
    const t = 300 + 650 * p;
    c.at(t, () => {
      const x = dot.x - hidden * (1 - Math.min(1, p * 1.08));
      const sz = fs * rnd(0.34, 0.52);
      const lf = at(c.front, h('div', '', 'opacity:0', leaf(i)), x, dot.base - sz * 0.5, sz, sz);
      const up = fs * rnd(0.7, 1.6), side = fs * rnd(-0.9, 0.5);
      const fall = word.bottom + fs * rnd(1.4, 4.2) - dot.base;
      const r0 = rnd(-60, 60), spin = rnd(160, 420) * (i % 2 ? 1 : -1);
      const kf: Keyframe[] = [];
      for (let k = 0; k <= 12; k++) {
        const u = k / 12;
        // hoch (schnell), dann trudelnd sinken
        const y = u < 0.22 ? -up * Math.sin((u / 0.22) * Math.PI * 0.5) : -up + (fall + up) * ((u - 0.22) / 0.78) ** 1.15;
        const xx = side * Math.min(1, u * 2.2) + Math.sin(u * Math.PI * 3.2 + i) * fs * 0.32 * u;
        const flip = Math.cos(u * Math.PI * 5 + i);
        kf.push({ offset: u, opacity: u < 0.06 ? u / 0.06 : u > 0.82 ? (1 - u) / 0.18 : 1, transform: `translate(${xx}px,${y}px) rotate(${r0 + spin * u}deg) scaleX(${0.35 + 0.65 * Math.abs(flip)})` });
      }
      c.F(lf, kf, { duration: rnd(3000, 4200), easing: 'linear', fill: 'forwards' });
    });
  }
  return {
    land,
    idle() {
      // ab und zu ein Blatt von oben
      for (let i = 0; i < 5; i++) {
        const sz = fs * rnd(0.3, 0.48);
        const x0 = vw * rnd(0.1, 0.9);
        const lf = at(c.back, h('div', '', 'opacity:0', leaf(i + 2)), x0, -sz, sz, sz);
        const kf: Keyframe[] = [];
        for (let k = 0; k <= 10; k++) {
          const u = k / 10;
          kf.push({ offset: u, opacity: u < 0.1 ? u / 0.1 * 0.85 : u > 0.85 ? (1 - u) / 0.15 * 0.85 : 0.85, transform: `translate(${Math.sin(u * Math.PI * 2.4 + i) * fs * 0.9}px,${(vh + sz * 2) * u}px) rotate(${u * 300 * (i % 2 ? 1 : -1)}deg) scaleX(${0.3 + 0.7 * Math.abs(Math.cos(u * 9 + i))})` });
        }
        c.F(lf, kf, { duration: rnd(5200, 7200), delay: i * 900 + rnd(0, 400), iterations: Infinity, easing: 'linear' });
      }
      c.ping.animate([{ opacity: 0.55, transform: 'scale(.4)' }, { opacity: 0, transform: 'scale(2.6)' }], { duration: 1100, iterations: Infinity, easing: 'cubic-bezier(.2,.6,.3,1)' });
    },
  };
};

// ---------------------------------------------------------------- Laternen (St. Martin)

const LANTERN = svg('0 0 100 130', `
<defs><radialGradient id="ixLt" cx="50%" cy="52%" r="58%"><stop offset="0" stop-color="#fff6cf"/><stop offset=".45" stop-color="#ffd36b"/><stop offset="1" stop-color="#e8741f"/></radialGradient></defs>
<path d="M50 0V26" stroke="var(--muted)" stroke-width="2"/>
<rect x="33" y="24" width="34" height="9" rx="2" fill="#3b2a1a"/>
<ellipse cx="50" cy="72" rx="40" ry="40" fill="url(#ixLt)"/>
<path d="M30 39C20 56 20 88 30 105M43 33C38 55 38 89 43 111M57 33C62 55 62 89 57 111M70 39C80 56 80 88 70 105" stroke="#c8641c" stroke-opacity=".45" stroke-width="2.2" fill="none"/>
<rect x="36" y="108" width="28" height="8" rx="2" fill="#3b2a1a"/>
<path d="M50 116V128" stroke="#e8741f" stroke-width="3" stroke-linecap="round"/>`);

/**
 * Laternen (St. Martin): das Wort rollt aus, dann entzündet sich der Punkt zu einer runden Papierlaterne, die
 * an ihrem Faden sanft pendelt und das Wort warm anleuchtet. Unten zieht ein kleiner Laternenumzug vorbei,
 * darüber ein paar Sterne.
 */
export const laterne: Variant = (c) => {
  const { fs, dot, vw, vh } = c.geo;
  css(c, 'ix-lt', `.ix-lt-glow{border-radius:50%;background:radial-gradient(circle,rgba(255,196,90,.38) 0,rgba(255,160,60,.14) 36%,rgba(255,150,50,0) 66%)}
.ix-lt-star{border-radius:50%;background:radial-gradient(circle,#fff 0 30%,rgba(255,255,255,0) 70%)}
.ix-lt-walk{border-radius:50%;background:radial-gradient(circle,rgba(255,214,120,.95) 0 28%,rgba(255,170,60,.35) 45%,rgba(255,160,60,0) 70%)}
[data-theme=light] .ix-lt-star{background:radial-gradient(circle,#b9a46a 0 30%,rgba(185,164,106,0) 70%)}`);
  const s = fs * 0.62;
  const glow = at(c.back, h('div', 'ix-lt-glow', 'opacity:0'), dot.x, dot.y - fs * 0.12, s * 4.4, s * 4.4);
  // Laterne hängt am Faden: Drehpunkt oben am Faden
  const lt = onDot(c, h('div', '', `opacity:0;transform-origin:50% 0`, LANTERN), s, s * 1.3, { ax: 0.5, ay: 0.62, mid: true });
  const stars = [[0.16, 0.18], [0.3, 0.1], [0.72, 0.13], [0.86, 0.24], [0.55, 0.07], [0.08, 0.32]].map(([x, y]) => at(c.back, h('div', 'ix-lt-star', 'opacity:0'), vw * x, vh * y, 5, 5));
  // Umzug: kleine Laternen, die unten langsam von links nach rechts wippen
  const walk = Array.from({ length: 7 }, (_, i) => {
    const w = at(c.back, h('div', '', 'opacity:0'), -20 - i * fs * 0.75, vh * 0.86 + (i % 2) * 4, fs * 0.45, fs * 0.45);
    w.appendChild(h('div', 'ix-lt-walk', 'width:100%;height:100%'));
    return w;
  });
  if (c.calm) {
    hideDot(c);
    lt.style.opacity = '1';
    glow.style.opacity = '1';
    stars.forEach((x) => { x.style.opacity = '.7'; });
    return { ping: false, leave: (dur) => morphBack(c, [lt], dur) };
  }
  const { land } = rollOut(c, { clip: true });
  // der Punkt wird zur Laterne
  c.A(c.dotin, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(2.2)' }], { duration: 260, delay: land + 40, easing: 'ease-in', fill: 'forwards' });
  c.A(lt, [{ opacity: 0, transform: 'translateY(-.35em) scale(.25)' }, { opacity: 1, transform: 'translateY(0) scale(1.06)', offset: 0.7 }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 520, delay: land + 80, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' });
  c.A(glow, [{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 700, delay: land + 140, easing: 'ease-out', fill: 'both' });
  stars.forEach((st, i) => c.A(st, [{ opacity: 0 }, { opacity: 0.75 }], { duration: 600, delay: 150 + i * 90, fill: 'both' }));
  walk.forEach((w, i) => {
    c.A(w, [{ opacity: 0 }, { opacity: c.dark ? 0.9 : 0.75 }], { duration: 800, delay: 200, fill: 'both' });
    c.F(w, [{ transform: 'translate(0,0)' }, { transform: `translate(${vw + fs * 6}px,0)` }], { duration: 16000, iterations: Infinity, easing: 'linear' });
    c.F(w.firstElementChild!, [{ transform: 'translateY(0)' }, { transform: 'translateY(-3px)' }], { duration: 480 + i * 37, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' });
  });
  return {
    land: land + 600,
    ping: false,
    idle() {
      c.F(lt, [{ transform: 'rotate(-7deg)' }, { transform: 'rotate(7deg)' }], { duration: 1500, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' });
      c.F(glow, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0.78, transform: 'scale(.95)' }, { opacity: 1, transform: 'scale(1.02)' }, { opacity: 0.86 }, { opacity: 1, transform: 'scale(1)' }], { duration: 2100, iterations: Infinity, easing: 'ease-in-out' });
      stars.forEach((st, i) => c.F(st, [{ opacity: 0.75, transform: 'scale(1)' }, { opacity: 0.25, transform: 'scale(.6)' }], { duration: 900 + i * 170, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' }));
    },
    leave(dur) {
      glow.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur * 0.4, fill: 'forwards' });
      morphBack(c, [lt], dur);
    },
  };
};

// ---------------------------------------------------------------- Novembernebel

/**
 * Novembernebel: Nebelbänke ziehen langsam vor und hinter dem Wort vorbei, das Wort taucht unscharf aus dem Grau
 * auf und wird klar. Der Punkt leuchtet wie ein Fahrradlicht mit Lichtkegel nach vorn in den Nebel.
 */
export const nebel: Variant = (c) => {
  const { fs, dot, vw, vh } = c.geo;
  css(c, 'ix-nb', `.ix-nb-band{background:radial-gradient(closest-side,rgba(175,185,200,.2),rgba(175,185,200,.07) 55%,rgba(175,185,200,0))}
.ix-nb-beam{background:linear-gradient(90deg,rgba(255,250,232,.42),rgba(255,250,232,.12) 50%,rgba(255,250,232,0));clip-path:polygon(0 47%,100% 0,100% 100%,0 53%);transform-origin:0 50%}
.ix-nb-halo{border-radius:50%;background:radial-gradient(circle,rgba(255,250,235,.55) 0,rgba(255,250,235,.12) 30%,rgba(255,250,235,0) 64%)}
[data-theme=light] .ix-nb-band{background:radial-gradient(closest-side,rgba(150,160,175,.22),rgba(150,160,175,.08) 55%,rgba(150,160,175,0))}
[data-theme=light] .ix-nb-beam{background:linear-gradient(90deg,rgba(255,214,120,.45),rgba(255,214,120,.12) 55%,rgba(255,214,120,0))}
[data-theme=light] .ix-nb-halo{background:radial-gradient(circle,rgba(255,200,90,.55) 0,rgba(255,200,90,.14) 30%,rgba(255,200,90,0) 64%)}`);
  const bands = [
    { y: dot.y - fs * 1.4, w: 1.6, d: 9000, front: false },
    { y: dot.y + fs * 0.2, w: 1.3, d: 7000, front: true },
    { y: dot.y + fs * 1.6, w: 1.8, d: 11000, front: false },
    { y: vh * 0.82, w: 1.7, d: 13000, front: false },
    { y: vh * 0.2, w: 1.5, d: 12000, front: false },
  ].map((b, i) => {
    const el = at(b.front ? c.front : c.back, h('div', 'ix-nb-band', 'opacity:0'), vw * (i % 2 ? 0.3 : 0.7), b.y, vw * b.w, fs * (b.front ? 2.2 : 3.2));
    return { el, ...b, i };
  });
  // Licht am Punkt: Schein und Kegel nach vorn
  const halo = onDot(c, h('div', 'ix-nb-halo', 'opacity:0'), fs * 1.3, fs * 1.3, { ax: 0.5, ay: 0.5, mid: true });
  const beam = onDot(c, h('div', 'ix-nb-beam', 'opacity:0'), fs * 4.2, fs * 1.5, { ax: 0, ay: 0.5, mid: true, dx: -c.geo.pc.r * 0.3 });
  if (c.calm) {
    bands.forEach((b) => { b.el.style.opacity = '1'; });
    halo.style.opacity = '1';
    beam.style.opacity = '.8';
    return {};
  }
  const { land } = rollOut(c, { clip: true });
  // unscharf aus dem Nebel
  c.A(c.mark, [{ filter: 'blur(7px)', opacity: 0.35 }, { filter: 'blur(2px)', opacity: 0.8, offset: 0.55 }, { filter: 'blur(0px)', opacity: 1 }], { duration: land + 200, easing: 'ease-out', fill: 'both', composite: 'replace' });
  bands.forEach((b) => {
    c.A(b.el, [{ opacity: 0 }, { opacity: 1 }], { duration: 900, delay: b.i * 80, easing: 'ease-out', fill: 'both' });
    c.F(b.el, [{ transform: `translateX(${(b.i % 2 ? -1 : 1) * vw * 0.12}px)` }, { transform: `translateX(${(b.i % 2 ? 1 : -1) * vw * 0.14}px)` }], { duration: b.d, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' });
  });
  c.A(halo, [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 500, delay: 200, easing: 'ease-out', fill: 'both' });
  c.A(beam, [{ opacity: 0, transform: 'scaleX(.2)' }, { opacity: 1, transform: 'scaleX(1)' }], { duration: 700, delay: 260, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' });
  const acc = getComputedStyle(c.dot).color;
  c.A(c.dotin, [{ color: c.dark ? '#fff6dc' : '#f0b23a' }, { color: c.dark ? '#fff6dc' : '#f0b23a', offset: 0.8 }, { color: acc }], { duration: land + 500, fill: 'backwards' });
  return {
    land,
    ping: false,
    idle() {
      c.F(beam, [{ opacity: 1 }, { opacity: 0.75 }], { duration: 1600, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' });
    },
    leave(dur) {
      for (const n of [beam, halo]) n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur * 0.4, fill: 'forwards' });
    },
  };
};

// ---------------------------------------------------------------- Raureif

/** Eiskristall-Zweig (Dendrit) als Pfad: Hauptast mit Seitenästen im 60°-Winkel, zwei Ebenen */
function dendrite(x: number, y: number, ang: number, len: number, depth: number, out: string[]) {
  const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
  out.push(`M${x.toFixed(1)} ${y.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`);
  if (depth <= 0) return;
  for (let k = 1; k <= 4; k++) {
    const f = k / 5;
    const bx = x + Math.cos(ang) * len * f, by = y + Math.sin(ang) * len * f;
    const bl = len * 0.42 * (1 - f * 0.55);
    dendrite(bx, by, ang + Math.PI / 3, bl, depth - 1, out);
    dendrite(bx, by, ang - Math.PI / 3, bl, depth - 1, out);
  }
}

/**
 * Raureif: aus den Ecken wachsen Eisblumen (feine Dendriten) ins Bild, über das ausgerollte Wort läuft ein kalter
 * Glanz, an den Buchstaben glitzern kleine Eiskristalle.
 */
export const frost: Variant = (c) => {
  const { fs, word, vw, vh } = c.geo;
  css(c, 'ix-fr', `.ix-fr-ice{stroke:#cfe7ff;stroke-opacity:.42;stroke-width:1.1;fill:none;stroke-linecap:round}
[data-theme=light] .ix-fr-ice{stroke:#7fa7cf;stroke-opacity:.5}
.ix-fr-glint{background:radial-gradient(circle,#fff 0 18%,rgba(220,240,255,0) 60%);clip-path:polygon(50% 0,58% 42%,100% 50%,58% 58%,50% 100%,42% 58%,0 50%,42% 42%)}
[data-theme=light] .ix-fr-glint{background:radial-gradient(circle,#7fb3e6 0 18%,rgba(127,179,230,0) 60%)}`);
  // Eisblumen in zwei Ecken (oben links, unten rechts) – als ein Pfad je Ecke, gezeichnet über die Strichlänge
  const corners: [number, number, number][] = [[0, 0, Math.PI * 0.25], [vw, vh, Math.PI * 1.25], [vw, 0, Math.PI * 0.75]];
  const frosts = corners.map(([x, y, a], i) => {
    const out: string[] = [];
    const L = Math.min(vw, vh) * (i === 2 ? 0.3 : 0.42);
    dendrite(x, y, a, L, 2, out);
    dendrite(x, y, a + 0.42, L * 0.7, 2, out);
    dendrite(x, y, a - 0.42, L * 0.7, 2, out);
    const g = h('div', '', `position:absolute;inset:0`, `<svg width="${vw}" height="${vh}" style="display:block"><path class="ix-fr-ice" d="${out.join('')}"/></svg>`);
    c.back.appendChild(g);
    return { g, x, y, r: L * 1.25 };
  });
  if (c.calm) return rollOut(c);
  const { land } = rollOut(c, { clip: true });
  frosts.forEach((f, i) => c.A(f.g, [{ clipPath: `circle(0px at ${f.x}px ${f.y}px)` }, { clipPath: `circle(${f.r}px at ${f.x}px ${f.y}px)` }], { duration: 1600, delay: 80 + i * 160, easing: 'cubic-bezier(.3,.55,.35,1)', fill: 'both' }));
  // kalter Glanz über das Wort (Verlauf in der Schrift)
  const ww = word.right - word.left;
  c.word.style.cssText += `;background:linear-gradient(100deg,var(--text) 0 40%,#d8efff 47%,#ffffff 50%,#d8efff 53%,var(--text) 60% 100%);background-size:${ww * 3}px 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent`;
  c.A(c.word, [{ backgroundPosition: `${ww * 1.2}px 0` }, { backgroundPosition: `${-ww * 2.1}px 0` }], { duration: 900, delay: land - 50, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' });
  // Glitzer an den Oberkanten
  const glints = Array.from({ length: 7 }, (_, i) => {
    const x = word.left + ww * (0.06 + i * 0.145) + rnd(-4, 4);
    const y = word.top + (word.bottom - word.top) * rnd(0.12, 0.35);
    return at(c.front, h('div', 'ix-fr-glint', 'opacity:0'), x, y, fs * 0.36, fs * 0.36);
  });
  glints.forEach((g, i) => c.A(g, [{ opacity: 0, transform: 'scale(0) rotate(0deg)' }, { opacity: 1, transform: 'scale(1) rotate(45deg)', offset: 0.4 }, { opacity: 0, transform: 'scale(.2) rotate(90deg)' }], { duration: 650, delay: land + 60 + i * 70, easing: 'ease-out', fill: 'both' }));
  return {
    land,
    idle() {
      glints.forEach((g, i) => c.F(g, [{ opacity: 0, transform: 'scale(0) rotate(0deg)' }, { opacity: 0.9, transform: 'scale(1) rotate(45deg)', offset: 0.2 }, { opacity: 0, transform: 'scale(.2) rotate(90deg)', offset: 0.4 }, { opacity: 0 }], { duration: 2400, delay: 300 + i * 330, iterations: Infinity, easing: 'ease-out' }));
      c.ping.animate([{ opacity: 0.55, transform: 'scale(.4)' }, { opacity: 0, transform: 'scale(2.6)' }], { duration: 1100, iterations: Infinity, easing: 'cubic-bezier(.2,.6,.3,1)' });
    },
  };
};

// ---------------------------------------------------------------- Advent

const FLAME = svg('0 0 40 70', `<defs><radialGradient id="ixFl" cx="50%" cy="72%" r="62%"><stop offset="0" stop-color="#fffbe6"/><stop offset=".35" stop-color="#ffe08a"/><stop offset=".75" stop-color="#ff9d2e"/><stop offset="1" stop-color="#ff7a1f" stop-opacity="0"/></radialGradient></defs>
<path d="M20 2C27 18 36 30 36 46 36 59 29 68 20 68 11 68 4 59 4 46 4 30 13 18 20 2Z" fill="url(#ixFl)"/>
<path d="M20 34C23 42 26 46 26 53 26 59 23 63 20 63 17 63 14 59 14 53 14 46 17 42 20 34Z" fill="#fffef5" opacity=".85"/>`);

/**
 * Advent: hinter dem Punkt erscheinen drei weitere Punkte – vier wie Kerzen in einer Reihe, darunter ein
 * Tannenzweig. Je Adventssonntag brennt eine Kerze mehr: über den entzündeten Punkten flackert eine Flamme.
 */
export const advent: Variant = (c) => {
  const { fs, pc } = c.geo;
  const lit = Math.max(1, Math.min(4, Number(c.pick.p) || 1));
  css(c, 'ix-ad', `.ix-ad-d{border-radius:50%;background:var(--muted);opacity:0}
.ix-ad-glow{border-radius:50%;background:radial-gradient(circle,rgba(255,190,80,.42) 0,rgba(255,150,50,.12) 40%,rgba(255,150,50,0) 68%);opacity:0}
.ix-ad-fl{opacity:0;transform-origin:50% 95%}`);
  const gap = fs * 0.36;
  const r = pc.r * 1.02;
  shiftMark(c, -gap * 1.5);
  const els: HTMLElement[] = [];
  const flames: HTMLElement[] = [];
  const glows: HTMLElement[] = [];
  // Zweig unter den vier Punkten: geschwungene Linie mit Nadeln
  let needles = '';
  for (let i = 0; i <= 26; i++) {
    const x = 4 + i * 7.4, y = 12 + Math.sin(i * 0.5) * 2.2;
    needles += `M${x.toFixed(1)} ${y.toFixed(1)}l${(2.5 + (i % 3) * 0.6).toFixed(1)} -7M${x.toFixed(1)} ${y.toFixed(1)}l${(2.5 + (i % 2) * 0.8).toFixed(1)} 7`;
  }
  const branchW = gap * 3 + fs * 0.7;
  const branch = onDot(c, h('div', '', 'opacity:0', svg('0 0 200 24', `<path d="M2 12C50 18 120 6 198 13" stroke="#3f7a3a" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="${needles}" stroke="#4f9a46" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="62" cy="15" r="3.6" fill="#c8323a"/><circle cx="69" cy="12" r="3" fill="#d94048"/><circle cx="150" cy="15" r="3.2" fill="#c8323a"/>`)), branchW, branchW * 0.12, { ax: 0.08, ay: 0, dy: fs * 0.1 });
  for (let i = 0; i < 4; i++) {
    const cx = pc.x + i * gap;
    if (i > 0) {
      const d = h('div', 'ix-ad-d', `position:absolute;left:${cx - r}px;top:${pc.y - r}px;width:${2 * r}px;height:${2 * r}px`);
      c.dot.appendChild(d);
      els.push(d);
    }
    if (i < lit) {
      const g = at(c.back, h('div', 'ix-ad-glow'), c.geo.dot.x + i * gap, c.geo.dot.y - fs * 0.3, fs * 1.2, fs * 1.2);
      const f = h('div', 'ix-ad-fl', `position:absolute;left:${cx - fs * 0.09}px;top:${pc.y - r - fs * 0.36}px;width:${fs * 0.18}px;height:${fs * 0.32}px`, FLAME);
      c.dot.appendChild(f);
      flames.push(f);
      glows.push(g);
    }
  }
  if (c.calm) {
    els.forEach((d, i) => { d.style.opacity = i + 1 < lit ? '1' : '.45'; if (i + 1 < lit) d.style.background = 'var(--accent)'; });
    flames.forEach((f) => { f.style.opacity = '1'; });
    glows.forEach((g) => { g.style.opacity = '1'; });
    branch.style.opacity = '1';
    return { ping: false, leave: (dur) => { for (const n of [...els, ...flames, ...glows, branch]) n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur * 0.4, fill: 'forwards' }); } };
  }
  const { land } = rollOut(c, { clip: true });
  // die drei weiteren Punkte rollen nacheinander heraus (die angezündeten in der Farbe der Rundfahrt)
  els.forEach((d, i) => {
    if (i + 1 < lit) d.style.background = 'var(--accent)';
    c.A(d, [{ opacity: 0, transform: `translateX(${-gap * (i + 1)}px) scale(.4)` }, { opacity: i + 1 < lit ? 1 : 0.45, transform: 'translateX(0) scale(1)' }], { duration: 380, delay: land - 60 + i * 110, easing: 'cubic-bezier(.2,.9,.3,1.15)', fill: 'both' });
  });
  c.A(branch, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 0.95, transform: 'translateY(0)' }], { duration: 500, delay: land + 120, easing: 'ease-out', fill: 'both' });
  // Flammen entzünden sich nacheinander
  const t0 = land + 380;
  flames.forEach((f, i) => {
    c.A(f, [{ opacity: 0, transform: 'scale(.2,.1)' }, { opacity: 1, transform: 'scale(1.15,1.25)', offset: 0.45 }, { opacity: 1, transform: 'scale(1)' }], { duration: 420, delay: t0 + i * 170, easing: 'ease-out', fill: 'both' });
    c.A(glows[i], [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 520, delay: t0 + i * 170 + 60, easing: 'ease-out', fill: 'both' });
  });
  return {
    land: t0 + flames.length * 170 + 300,
    ping: false,
    idle() {
      flames.forEach((f, i) => {
        const kf: Keyframe[] = [];
        for (let k = 0; k <= 10; k++) kf.push({ transform: `scale(${rnd(0.9, 1.06).toFixed(2)},${rnd(0.88, 1.12).toFixed(2)}) skewX(${rnd(-6, 6).toFixed(1)}deg)` });
        kf[0] = { transform: 'scale(1)' }; kf[10] = { transform: 'scale(1)' };
        c.F(f, kf, { duration: 1300 + i * 210, iterations: Infinity, easing: 'ease-in-out' });
        c.F(glows[i], [{ opacity: 1 }, { opacity: 0.75 }, { opacity: 1 }, { opacity: 0.85 }, { opacity: 1 }], { duration: 1700 + i * 190, iterations: Infinity });
      });
    },
    leave(dur) {
      for (const n of [...els, ...flames, ...glows, branch]) n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur * 0.4, fill: 'forwards' });
    },
  };
};

// ---------------------------------------------------------------- Schnee (gemeinsam)

/** Schneefall auf einer Ebene: n Flocken, fallen endlos, schon verteilt (negativer Start) */
function snow(c: Ctx, layer: HTMLElement, n: number, k = 1) {
  const { vw, vh, fs } = c.geo;
  css(c, 'ix-sn', `.ix-sn{border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.95) 0 35%,rgba(255,255,255,0) 70%)}
[data-theme=light] .ix-sn{background:radial-gradient(circle,rgba(150,168,196,.9) 0 35%,rgba(150,168,196,0) 70%)}`);
  for (let i = 0; i < n; i++) {
    const s = rnd(3, 8) * k * (fs / 48);
    const x = vw * rnd(-0.05, 1.05);
    const f = at(layer, h('div', 'ix-sn', `opacity:${rnd(0.45, 0.95).toFixed(2)}`), x, -10, s, s);
    const dur = rnd(5200, 9800) * (8 / Math.max(3, s));
    const sway = rnd(12, 34);
    c.F(f, [
      { transform: 'translate(0,0)' },
      { transform: `translate(${sway}px,${vh * 0.25}px)` },
      { transform: `translate(${-sway * 0.6}px,${vh * 0.5}px)` },
      { transform: `translate(${sway * 0.8}px,${vh * 0.75}px)` },
      { transform: `translate(0,${vh + 20}px)` },
    ], { duration: Math.min(14000, dur), delay: -rnd(0, Math.min(14000, dur)), iterations: Infinity, easing: 'linear' });
  }
}

// ---------------------------------------------------------------- Weihnachten

const STAR = svg('0 0 100 100', `<defs><radialGradient id="ixSt" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#fff7d1"/><stop offset=".5" stop-color="#ffd760"/><stop offset="1" stop-color="#e8a10f"/></radialGradient></defs>
<path d="M50 4L61.8 36.6 96.6 37.6 69 58.6 79 92 50 72.4 21 92 31 58.6 3.4 37.6 38.2 36.6Z" fill="url(#ixSt)" stroke="#f2b82e" stroke-width="2" stroke-linejoin="round"/>`);

/**
 * Weihnachten: leiser Schneefall über dem ganzen Bild; das Wort rollt aus, und der Punkt steigt ein Stück auf und
 * wird zum goldenen Stern mit funkelnden Strahlen.
 */
export const weihnachten: Variant = (c) => {
  const { fs } = c.geo;
  css(c, 'ix-wn', `.ix-wn-glow{border-radius:50%;background:radial-gradient(circle,rgba(255,215,110,.45) 0,rgba(255,200,80,.12) 35%,rgba(255,200,80,0) 66%)}
.ix-wn-ray{background:linear-gradient(90deg,rgba(255,236,170,0),rgba(255,236,170,.9) 50%,rgba(255,236,170,0))}
[data-theme=light] .ix-wn-ray{background:linear-gradient(90deg,rgba(232,161,15,0),rgba(232,161,15,.8) 50%,rgba(232,161,15,0))}`);
  snow(c, c.front, 34);
  const s = fs * 0.62;
  const glow = at(c.back, h('div', 'ix-wn-glow', 'opacity:0'), c.geo.dot.x + fs * 0.12, c.geo.dot.y - fs * 0.3, s * 3.6, s * 3.6);
  const rays = onDot(c, h('div', '', 'opacity:0'), s * 2.6, s * 2.6, { ax: 0.5, ay: 0.5, mid: true, dx: fs * 0.12, dy: -fs * 0.3 });
  for (let i = 0; i < 4; i++) rays.appendChild(h('div', 'ix-wn-ray', `position:absolute;left:0;top:50%;width:100%;height:1.5px;margin-top:-.75px;transform:rotate(${i * 45}deg)`));
  const star = onDot(c, h('div', '', 'opacity:0', STAR), s, s, { ax: 0.5, ay: 0.5, mid: true, dx: fs * 0.12, dy: -fs * 0.3 });
  if (c.calm) {
    hideDot(c);
    for (const n of [glow, rays, star]) n.style.opacity = '1';
    return { ping: false, leave: (dur) => morphBack(c, [star, rays, glow], dur) };
  }
  const { land } = rollOut(c, { clip: true });
  c.A(c.dotin, [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: `translateY(${-fs * 0.3}px) scale(1.6)` }], { duration: 300, delay: land + 40, easing: 'ease-in', fill: 'forwards' });
  c.A(star, [{ opacity: 0, transform: 'scale(.2) rotate(-90deg)' }, { opacity: 1, transform: 'scale(1.12) rotate(8deg)', offset: 0.7 }, { opacity: 1, transform: 'scale(1) rotate(0deg)' }], { duration: 600, delay: land + 120, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' });
  c.A(glow, [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 700, delay: land + 220, easing: 'ease-out', fill: 'both' });
  c.A(rays, [{ opacity: 0, transform: 'scale(.3) rotate(0deg)' }, { opacity: 1, transform: 'scale(1) rotate(22deg)' }], { duration: 700, delay: land + 300, easing: 'ease-out', fill: 'both' });
  return {
    land: land + 700,
    ping: false,
    idle() {
      c.F(rays, [{ transform: 'scale(1) rotate(22deg)', opacity: 1 }, { transform: 'scale(.82) rotate(67deg)', opacity: 0.55 }, { transform: 'scale(1) rotate(112deg)', opacity: 1 }], { duration: 3200, iterations: Infinity, easing: 'ease-in-out' });
      c.F(star, [{ transform: 'scale(1)' }, { transform: 'scale(1.07)' }], { duration: 1100, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' });
    },
    leave: (dur) => morphBack(c, [star, rays, glow], dur),
  };
};

// ---------------------------------------------------------------- Schneeball

/**
 * Schneeball (zwischen den Jahren): es schneit leicht, der Punkt rollt als Schneeball das Wort aus und wird dabei
 * größer; hinter ihm bleibt eine Schneespur. Beim Aufsetzen stäubt etwas Schnee auf.
 */
export const winter: Variant = (c) => {
  const { fs, dot, pc } = c.geo;
  css(c, 'ix-wb', `.ix-wb{border-radius:50%;background:radial-gradient(circle at 36% 32%,#ffffff 0,#f1f5fa 45%,#c9d5e4 100%);box-shadow:inset -1px -2px 3px rgba(80,100,130,.25)}
[data-theme=light] .ix-wb{background:radial-gradient(circle at 36% 32%,#ffffff 0,#e9eef5 40%,#aebcd0 100%);box-shadow:inset -1px -2px 3px rgba(60,80,110,.35),0 0 0 1px rgba(120,140,170,.35)}
.ix-wb-trail{background:linear-gradient(90deg,rgba(235,242,250,0),rgba(235,242,250,.55));border-radius:4px;transform-origin:100% 50%}
[data-theme=light] .ix-wb-trail{background:linear-gradient(90deg,rgba(150,168,196,0),rgba(150,168,196,.5))}`);
  snow(c, c.front, 18, 0.9);
  const S = fs * 0.5;
  const ball = onDot(c, h('div', 'ix-wb'), S, S, { ax: 0.42, ay: 1, dy: S * 0.04 });
  hideDot(c);
  if (c.calm) return { leave: (dur) => morphBack(c, [ball], dur) };
  const { land } = rollOut(c, { clip: true, squash: null, edge: pc.x + S * 0.08 });
  // wächst beim Rollen
  c.A(ball, [{ transform: 'scale(.4)' }, { transform: 'scale(1)' }], { duration: 650, delay: 300, easing: 'cubic-bezier(.4,0,.4,1)', fill: 'both' });
  ball.style.transformOrigin = '50% 100%';
  // aufstäuben
  c.at(land - 20, () => {
    for (let i = 0; i < 10; i++) {
      const p = at(c.front, h('div', 'ix-sn'), dot.x + rnd(-4, 8), dot.base - 4, rnd(3, 6), rnd(3, 6));
      const ang = rnd(-2.6, -0.5), sp = fs * rnd(0.4, 1);
      c.F(p, [{ opacity: 1, transform: 'translate(0,0)' }, { opacity: 0.8, transform: `translate(${Math.cos(ang) * sp}px,${Math.sin(ang) * sp}px)`, offset: 0.4 }, { opacity: 0, transform: `translate(${Math.cos(ang) * sp * 1.4}px,${Math.sin(ang) * sp * 0.4 + fs * 0.25}px)` }], { duration: rnd(700, 1100), easing: 'ease-out', fill: 'forwards' });
    }
  });
  c.A(ball, [{ transform: 'scale(1)' }, { transform: 'scale(1.12,.86)' }, { transform: 'scale(1)' }], { duration: 380, delay: land - 20, easing: 'ease-out', fill: 'forwards' });
  return { land, leave: (dur) => morphBack(c, [ball], dur) };
};

// ---------------------------------------------------------------- Silvester

const SPARK_COLS = ['#ffd760', '#ffffff', '#ff9f43', 'var(--accent)'];

/** Feuerwerk: n Funken um (x, y), fliegen aus und sinken glühend ab */
function burst(c: Ctx, x: number, y: number, n: number, rad: number, delay: number, cols: string[], size = 4) {
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + rnd(-0.12, 0.12);
    const r = rad * rnd(0.75, 1.1);
    const col = cols[i % cols.length];
    const sp = at(c.back, h('div', '', `border-radius:50%;background:${col};box-shadow:0 0 6px 1px ${col};opacity:0`), x, y, size, size);
    const kf: Keyframe[] = [];
    for (let k = 0; k <= 8; k++) {
      const u = k / 8;
      const e = 1 - (1 - u) ** 3;
      const dx = Math.cos(ang) * r * e;
      const dy = Math.sin(ang) * r * e + rad * 0.45 * u * u;
      kf.push({ offset: u, opacity: u === 0 ? 0 : u < 0.1 ? 1 : 1 - u ** 1.6, transform: `translate(${dx}px,${dy}px) scale(${1 - u * 0.5})` });
    }
    c.F(sp, kf, { duration: rnd(1100, 1500), delay, easing: 'linear', fill: 'both' });
  }
}

/**
 * Silvester: das Wort rollt aus, dann steigt der Punkt als Rakete mit Funkenschweif auf und zerplatzt als
 * Feuerwerk; ein Funke fällt zurück und wird wieder zum Punkt. Im Hintergrund knallen kleinere Raketen.
 */
export const silvester: Variant = (c) => {
  const { fs, dot, vw, vh } = c.geo;
  if (c.calm) return rollOut(c);
  const { land } = rollOut(c, { clip: true });
  const top = Math.max(vh * 0.16, dot.y - vh * 0.3);
  const rise = 520;
  // Rakete: der Punkt steigt auf (Schweif dahinter)
  const tail = at(c.back, h('div', '', 'color:var(--accent);background:linear-gradient(0deg,rgba(255,215,96,0),currentColor);border-radius:2px;transform-origin:50% 100%;opacity:0'), dot.x, (dot.y + top) / 2, 2, dot.y - top);
  c.A(c.dotin, [{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${top - dot.y}px) scale(.8)`, opacity: 1, offset: 0.96 }, { transform: `translateY(${top - dot.y}px) scale(.8)`, opacity: 0 }], { duration: rise, delay: land + 80, easing: 'cubic-bezier(.3,.1,.6,1)', fill: 'forwards' });
  c.A(tail, [{ opacity: 0, transform: 'scaleY(0)' }, { opacity: 0.8, transform: 'scaleY(.9)', offset: 0.9 }, { opacity: 0, transform: 'scaleY(1)' }], { duration: rise + 260, delay: land + 80, easing: 'cubic-bezier(.3,.1,.6,1)', fill: 'both' });
  const tb = land + 80 + rise;
  c.at(tb, () => {
    burst(c, dot.x, top, 30, fs * 2.3, 0, SPARK_COLS, Math.max(3, fs * 0.08));
    burst(c, dot.x, top, 14, fs * 1.2, 60, ['#fff3c4', '#ffd760'], Math.max(2, fs * 0.06));
    // ein Funke fällt zurück und wird zum Punkt
    const sp = at(c.back, h('div', '', 'color:var(--accent);border-radius:50%;background:currentColor;box-shadow:0 0 6px currentColor'), dot.x, top, c.geo.pc.r * 2, c.geo.pc.r * 2);
    c.F(sp, [{ opacity: 0, transform: 'translate(0,0)' }, { opacity: 1, transform: `translate(${fs * 0.25}px,${fs * 0.15}px)`, offset: 0.15 }, { opacity: 1, transform: `translate(0,${dot.y - top}px)` }], { duration: 760, delay: 300, easing: 'cubic-bezier(.5,0,.8,.6)', fill: 'forwards' });
    c.F(c.dotin, [{ opacity: 0, transform: 'scale(1.6)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 260, delay: 1040, easing: 'ease-out', fill: 'both' });
    c.F(sp, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, delay: 1060, fill: 'forwards' });
  });
  return {
    land: tb,
    ping: false,
    idle() {
      // kleine Feuerwerke in der Ferne, abwechselnd links und rechts
      const spots: [number, number, string[]][] = [[vw * 0.22, vh * 0.2, ['#7ab8ff', '#ffffff']], [vw * 0.8, vh * 0.26, ['#ff5fa2', '#ffd760']], [vw * 0.6, vh * 0.12, ['#3ddc84', '#ffffff']]];
      spots.forEach(([x, y, cols], i) => {
        const d = 900 + i * 700;
        burst(c, x, y, 18, fs * 1.1, d, cols, 2.5);
      });
    },
    leave(dur) { showDot(c, dur * 0.3); },
  };
};

// ---------------------------------------------------------------- Neujahr

/**
 * Neujahr: unter dem Wort steht „Saison 2026", die letzte Ziffer rollt wie ein Zählwerk auf 2027 und leuchtet
 * kurz in der Farbe der Rundfahrt auf.
 */
export const neujahr: Variant = (c) => {
  const { fs, dot, word } = c.geo;
  const year = Number(c.pick.p) || new Date().getFullYear();
  const prev = String(year - 1), next = String(year);
  // gemeinsame Ziffern vorn, wechselnde hinten (2026 → 2027: „202" bleibt, „6" → „7")
  let k = 0;
  while (k < 4 && prev[k] === next[k]) k++;
  css(c, 'ix-ny', `.ix-ny{font-weight:600;letter-spacing:.02em;color:var(--muted);white-space:nowrap;display:flex;align-items:baseline;justify-content:center;font-variant-numeric:tabular-nums}
.ix-ny-w{display:inline-block;height:1.15em;overflow:hidden;vertical-align:bottom}
.ix-ny-w>span{display:block;line-height:1.15em}`);
  const box = at(c.back, h('div', 'ix-ny', `font-size:${Math.round(fs * 0.4)}px;opacity:0`), (word.left + dot.x) / 2, dot.base + fs * 0.75, fs * 5, fs * 0.6);
  box.innerHTML = `<span>Saison&nbsp;</span><span class="ix-ny-y">${next.slice(0, k)}</span>${next.slice(k).split('').map((ch, i) => `<span class="ix-ny-w"><span>${prev[k + i]}</span><span>${ch}</span></span>`).join('')}`;
  const wheels = Array.from(box.querySelectorAll('.ix-ny-w > span:first-child')).map((e) => e.parentElement!);
  if (c.calm) { box.style.opacity = '1'; wheels.forEach((w) => { (w.firstElementChild as HTMLElement).style.marginTop = '-1.15em'; }); return rollOut(c); }
  const { land } = rollOut(c, { clip: true });
  c.A(box, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 420, delay: 380, easing: 'ease-out', fill: 'both' });
  wheels.forEach((w, i) => {
    const inner = Array.from(w.children) as HTMLElement[];
    for (const e of inner) c.A(e, [{ transform: 'translateY(0)' }, { transform: 'translateY(-118%)', offset: 0.8 }, { transform: 'translateY(-100%)' }], { duration: 520, delay: land + 60 + i * 120, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'both' });
  });
  const cs = getComputedStyle(c.mark);
  const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#8e8e93';
  const acc = getComputedStyle(c.dot).color;
  c.A(box, [{ color: muted }, { color: acc, offset: 0.3 }, { color: acc, offset: 0.7 }, { color: cs.color }], { duration: 1200, delay: land + 300, easing: 'ease', fill: 'both' });
  return { land: land + 500 };
};
