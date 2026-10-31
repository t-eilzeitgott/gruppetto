import { at, h, hideDot, onDot, rnd, rollOut, showDot, type Variant } from '../engine';

/** Kürbis (100 × 100, steht unten auf y = 97): drei Rippen, Stiel, geschnitztes Gesicht (dunkel und leuchtend) */
const FACE = 'M31 56 L42 56 L36.5 45 Z M58 56 L69 56 L63.5 45 Z M29 67 Q50 86 71 67 L67 69.5 L63 75 L59 71 L55 77.5 L50 72.5 L45 77.5 L41 71 L37 75 L33 69.5 Z';
const PUMPKIN = `<svg viewBox="0 0 100 100" width="100%" height="100%" style="overflow:visible;display:block">
<defs>
<radialGradient id="ixPk" cx="42%" cy="38%" r="70%"><stop offset="0" stop-color="#ffb24d"/><stop offset=".55" stop-color="#f4801e"/><stop offset="1" stop-color="#b8420d"/></radialGradient>
<radialGradient id="ixPkL" cx="50%" cy="60%" r="55%"><stop offset="0" stop-color="#fff6c2"/><stop offset=".55" stop-color="#ffd05a"/><stop offset="1" stop-color="#ff9d24"/></radialGradient>
</defs>
<path d="M50 33 C48 25 49 17 56 10" stroke="#4f6b1c" stroke-width="7.5" stroke-linecap="round" fill="none"/>
<path d="M53 18 C60 14 66 17 69 22" stroke="#5f7f22" stroke-width="2.6" stroke-linecap="round" fill="none"/>
<ellipse cx="29" cy="64" rx="24" ry="32" fill="url(#ixPk)"/>
<ellipse cx="71" cy="64" rx="24" ry="32" fill="url(#ixPk)"/>
<ellipse cx="50" cy="63" rx="26" ry="34.5" fill="url(#ixPk)"/>
<path d="M39 32 C31 46 31 82 39 96 M61 32 C69 46 69 82 61 96" stroke="#9c3a0b" stroke-opacity=".5" stroke-width="2.2" fill="none"/>
<path d="${FACE}" fill="#341607"/>
<path class="ix-lit" d="${FACE}" fill="url(#ixPkL)" opacity="0"/>
</svg>`;

/** Fledermaus (Silhouette, 120 × 60) – die Flügel schlagen über scaleY */
const BAT = `<svg viewBox="0 0 120 60" width="100%" height="100%" style="overflow:visible;display:block"><g class="ix-wing" style="transform-origin:60px 30px">
<path fill="currentColor" d="M60 24 C58 18 55 15 53 19 C47 11 31 5 3 13 C13 17 18 24 15 33 C23 28 30 30 34 37 C40 30 48 32 52 39 C55 35 58 35 60 39 C62 35 65 35 68 39 C72 32 80 30 86 37 C90 30 97 28 105 33 C102 24 107 17 117 13 C89 5 73 11 67 19 C65 15 62 18 60 24 Z"/>
<path fill="currentColor" d="M55 21 L54 13 L58 19 L62 19 L66 13 L65 21 Z"/></g></svg>`;

const CSS = `
.ix-pk>div{width:100%;height:100%}
.ix-glow{border-radius:50%;pointer-events:none;opacity:0;background:radial-gradient(circle,rgba(255,165,60,.34) 0,rgba(255,130,40,.13) 34%,rgba(255,120,30,0) 64%)}
.ix-moon{border-radius:50%;opacity:0;background:
radial-gradient(circle at 36% 58%,rgba(0,0,0,.16) 0 7%,transparent 8%),
radial-gradient(circle at 60% 34%,rgba(0,0,0,.12) 0 5%,transparent 6%),
radial-gradient(circle at 63% 66%,rgba(0,0,0,.1) 0 4%,transparent 5%),
radial-gradient(circle at 44% 40%,rgba(255,248,226,.3) 0,rgba(236,222,186,.24) 46%,rgba(226,210,170,.2) 49%,rgba(226,210,170,0) 51%),
radial-gradient(circle,rgba(255,240,205,.05) 0 40%,rgba(255,240,205,0) 70%)}
.ix-fog{border-radius:50%;opacity:0;background:radial-gradient(ellipse at 50% 50%,rgba(150,140,195,.24),rgba(150,140,195,0) 68%)}
.ix-bat{color:#221b2c;opacity:0}
.ix-bat path{stroke:#3d344c;stroke-width:1.5}
[data-theme=light] .ix-moon{background:
radial-gradient(circle at 36% 58%,rgba(90,80,120,.16) 0 7%,transparent 8%),
radial-gradient(circle at 60% 34%,rgba(90,80,120,.12) 0 5%,transparent 6%),
radial-gradient(circle at 44% 40%,rgba(214,206,236,.7) 0,rgba(196,186,226,.62) 49%,rgba(196,186,226,0) 51%),
radial-gradient(circle,rgba(150,140,200,.12) 0 40%,rgba(150,140,200,0) 70%)}
[data-theme=light] .ix-fog{background:radial-gradient(ellipse at 50% 50%,rgba(110,100,150,.14),rgba(110,100,150,0) 68%)}
[data-theme=light] .ix-glow{background:radial-gradient(circle,rgba(255,150,40,.28) 0,rgba(255,130,40,.1) 34%,rgba(255,120,30,0) 64%)}
[data-theme=light] .ix-bat{color:#2a2232}
[data-theme=light] .ix-bat path{stroke:none}
`;

/**
 * Halloween: ein kleiner Kürbis rollt das Wort aus (dreht sich dabei), setzt auf, und sein geschnitztes Gesicht
 * glimmt wie Kerzenlicht. Dahinter ein blasser Mond, eine Fledermaus fliegt aus dem Kürbis heraus quer über den
 * Mond, unten zieht etwas Nebel. Beim Abflug wird der Kürbis wieder zum Punkt.
 */
export const halloween: Variant = (c) => {
  const { fs, dot, vw, vh } = c.geo;
  c.css(CSS);
  const s = fs * 0.6;
  // Schein hinter Kürbis und Wort (Ebene dahinter, an der Stelle, wo der Kürbis aufsetzt), dann der Kürbis
  // selbst (Halter → Stauchen → Drehen → Bild)
  const glow = at(c.back, h('div', 'ix-glow'), dot.x + s * 0.1, dot.base - s * 0.45, s * 4.2, s * 4.2);
  const pk = onDot(c, h('div', 'ix-pk'), s, s, { ax: 0.4, ay: 0.97 });
  const squash = h('div', '', 'transform-origin:50% 97%');
  const spin = h('div', '', 'transform-origin:50% 63%', PUMPKIN);
  squash.appendChild(spin);
  pk.appendChild(squash);
  hideDot(c);
  const lit = spin.querySelector('.ix-lit') as SVGElement;
  // Mond oben rechts, Nebel unten
  const mr = Math.min(vw, vh) * 0.34;
  const mx = vw * 0.77, my = vh * 0.19;
  const moon = at(c.back, h('div', 'ix-moon'), mx, my, mr, mr);
  const fogs = [0.28, 0.78].map((fx, i) => at(c.back, h('div', 'ix-fog'), vw * fx, vh * (0.93 - i * 0.04), vw * 1.25, vh * 0.3));

  if (c.calm) {
    lit.setAttribute('opacity', '1');
    glow.style.opacity = '0.8';
    moon.style.opacity = '1';
    fogs.forEach((f) => { f.style.opacity = '1'; });
    return { ping: false, leave: (dur) => { pk.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur * 0.5, fill: 'forwards' }); showDot(c, dur * 0.5); } };
  }

  const { land } = rollOut(c, { clip: true, squash: null, spin, turns: 2, edge: c.geo.pc.x + s * 0.1 });
  // weich aufsetzen (der Kürbis ist schwerer als ein Punkt)
  c.A(squash, [
    { transform: 'scale(1)' }, { transform: 'scale(1.16,.84)' }, { transform: 'scale(.95,1.06)' }, { transform: 'scale(1)' },
  ], { duration: 460, delay: land - 30, easing: 'ease-out', fill: 'both' });
  // Mond und Nebel kommen langsam
  c.A(moon, [{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 1100, delay: 100, easing: 'ease-out', fill: 'both' });
  fogs.forEach((f, i) => {
    c.A(f, [{ opacity: 0 }, { opacity: 1 }], { duration: 1200, delay: 150 * i, easing: 'ease-out', fill: 'both' });
    c.F(f, [{ transform: 'translateX(-5%)' }, { transform: 'translateX(6%)' }], { duration: 7000 + i * 2300, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' });
  });
  // das Gesicht entzündet sich nach dem Aufsetzen
  c.A(lit, [{ opacity: 0 }, { opacity: 0.35, offset: 0.25 }, { opacity: 0.1, offset: 0.4 }, { opacity: 1 }], { duration: 380, delay: land + 60, easing: 'ease-out', fill: 'both' });
  c.A(glow, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 520, delay: land + 120, easing: 'ease-out', fill: 'both' });

  // eine Fledermaus fliegt aus dem Kürbis heraus über den Mond davon
  c.at(land + 140, () => {
    const bw = fs * 0.95;
    const sx = dot.x + s * 0.1, sy = dot.base - s * 0.55;
    const bat = at(c.back, h('div', 'ix-bat', '', BAT), sx, sy, bw, bw / 2);
    const ex = vw * 1.06, ey = vh * 0.06;
    // Bahn durch die Mondmitte (quadratische Kurve, bei t = ½ am Mond)
    const cx = 2 * mx - (sx + ex) / 2, cy = 2 * my - (sy + ey) / 2;
    const pts: Keyframe[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * cx + t * t * ex;
      const y = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * cy + t * t * ey + Math.sin(t * Math.PI * 3) * fs * 0.12;
      const sc = 0.35 + Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) * 0.7 - t * 0.3;
      pts.push({ offset: t, transform: `translate(${x - sx}px,${y - sy}px) scale(${sc})`, opacity: t < 0.08 ? t / 0.08 : t > 0.88 ? (1 - t) / 0.12 : 1 });
    }
    c.F(bat, pts, { duration: 2200, easing: 'cubic-bezier(.3,.15,.55,.95)', fill: 'forwards' });
    c.F(bat.querySelector('.ix-wing')!, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(.45)' }], { duration: 140, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' });
  });

  return {
    land,
    ping: false,
    // Kerzenlicht: das Gesicht flackert unruhig, der Schein atmet mit
    idle() {
      const k: Keyframe[] = [];
      for (let i = 0; i <= 12; i++) k.push({ opacity: i === 0 || i === 12 ? 1 : rnd(0.62, 1) });
      c.F(lit, k, { duration: 1700, iterations: Infinity, easing: 'linear' });
      c.F(glow, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0.7, transform: 'scale(.94)' }, { opacity: 1, transform: 'scale(1.03)' }, { opacity: 0.82, transform: 'scale(.97)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 2300, iterations: Infinity, easing: 'ease-in-out' });
    },
    leave(dur) {
      pk.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.35)' }], { duration: dur * 0.55, easing: 'ease-in', fill: 'forwards' });
      glow.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur * 0.4, fill: 'forwards' });
      showDot(c, dur * 0.45, dur * 0.2);
    },
  };
};
