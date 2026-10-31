/**
 * Abwechslung bei jedem dritten Öffnen: fünf eigenständige Varianten, alle in der Farbe der Rundfahrt, alle
 * enden wie gewohnt mit dem Punkt hinter dem Wort.
 */
import { at, bezier, h, hideDot, letters, onDot, rollOut, showDot, type Ctx, type Variant } from '../engine';

const css = (c: Ctx, id: string, s: string) => { if (!document.getElementById(id)) { c.css(s); } };

// ---------------------------------------------------------------- Zielsprint

/**
 * Zielsprint: der Punkt schießt mit Tempo von links herein und bremst ab, hinter ihm springen die Buchstaben in
 * seinem Windschatten auf (vom Fahrtwind noch schräg). Am Ziel ein kurzer Wurf nach vorn, ein Zielstrich blitzt.
 */
export const sprint: Variant = (c) => {
  const L = letters(c);
  const { fs, dot, vw } = c.geo;
  if (c.calm) return {};
  c.cover.style.display = 'none';
  const ease = bezier(0.12, 0.72, 0.24, 1);
  const delay = 80, dur = 760;
  const startX = -fs * 1.2;
  const travel = dot.x - startX;
  c.A(c.roll, [{ transform: `translateX(${-travel}px)` }, { transform: 'translateX(0)' }], { duration: dur, delay, easing: ease.css, fill: 'both' });
  // Fahrtwind-Streifen am Punkt
  const trail = onDot(c, h('div', '', `transform-origin:100% 50%;border-radius:${fs * 0.05}px;background:linear-gradient(90deg,transparent,currentColor)`), fs * 2.4, fs * 0.085, { ax: 1, ay: 0.5, mid: true, dx: -c.geo.pc.r * 0.6 });
  c.A(trail, [{ opacity: 0.9, transform: 'scaleX(1)' }, { opacity: 0.6, transform: 'scaleX(.55)', offset: 0.5 }, { opacity: 0, transform: 'scaleX(0)' }], { duration: dur, delay, easing: 'ease-out', fill: 'both' });
  // Buchstaben erscheinen, sobald der Punkt an ihnen vorbei ist
  for (const l of L) {
    const p = (l.x - startX) / travel;
    const t = delay + dur * ease.inv(Math.min(0.999, Math.max(0, p))) + 25;
    c.A(l.inner, [
      { opacity: 0, transform: 'translateY(.34em) skewX(-20deg) scaleY(.55)' },
      { opacity: 1, transform: 'translateY(-.05em) skewX(5deg) scaleY(1.06)', offset: 0.55 },
      { opacity: 1, transform: 'none' },
    ], { duration: 340, delay: t, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' });
  }
  // Tempo-Linien quer über den Schirm (nur am Anfang)
  const lines = [-1.15, 0.75, -0.55, 1.35].map((k, i) => {
    const ln = at(c.back, h('div', '', 'background:linear-gradient(90deg,transparent,var(--muted),transparent);opacity:0;height:1px'), vw * 0.5, dot.y + k * fs, vw * (0.35 + 0.1 * i), 1);
    c.A(ln, [{ opacity: 0, transform: `translateX(${-vw * 0.9}px)` }, { opacity: 0.55, offset: 0.3 }, { opacity: 0, transform: `translateX(${vw * 0.9}px)` }], { duration: 420 + i * 60, delay: 20 + i * 70, easing: 'linear', fill: 'both' });
    return ln;
  });
  void lines;
  // Wurf: kurz nach vorn, dann zurück; Zielstrich blitzt
  const end = delay + dur;
  c.A(c.dot, [{ transform: 'translateX(0)' }, { transform: 'translateX(.16em)', offset: 0.35 }, { transform: 'translateX(0)' }], { duration: 300, delay: end - 140, easing: 'ease-in-out', fill: 'both' });
  // Zielstrich: senkrechte Linie durchs Ziel (oben und unten verlaufend), dazu ein kurzer Blitz der Zielkamera
  const line = at(c.back, h('div', '', 'color:var(--accent);background:linear-gradient(180deg,transparent,currentColor 30%,currentColor 70%,transparent);transform-origin:50% 60%'), dot.x + fs * 0.34, dot.base - fs * 0.32, Math.max(2, fs * 0.035), fs * 2.4);
  c.A(line, [{ opacity: 0, transform: 'scaleY(.2)' }, { opacity: 0.9, transform: 'scaleY(1)', offset: 0.2 }, { opacity: 0, transform: 'scaleY(1)' }], { duration: 620, delay: end - 140, easing: 'ease-out', fill: 'both' });
  const flash = at(c.back, h('div', '', 'border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.13),rgba(255,255,255,0) 65%)'), dot.x + fs * 0.34, dot.base - fs * 0.35, fs * 3, fs * 3);
  c.A(flash, [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0 }], { duration: 420, delay: end - 120, easing: 'ease-out', fill: 'both' });
  c.A(c.dotin, [{ transform: 'scale(1)' }, { transform: 'scale(1.3,.78)' }, { transform: 'scale(.92,1.1)' }, { transform: 'scale(1)' }], { duration: 380, delay: end + 120, easing: 'ease-out', fill: 'both' });
  return { land: end + 200 };
};

// ---------------------------------------------------------------- Windschatten

/**
 * Windschatten: das Wort rollt als enges Feld von links herein – der Punkt führt, die Buchstaben hängen dicht an
 * seinem Hinterrad und wippen im Tritt. Beim Abbremsen zieht sich das Feld auseinander, bis jeder seinen Platz hat.
 */
export const windschatten: Variant = (c) => {
  const L = letters(c);
  const { fs, dot } = c.geo;
  if (c.calm) return {};
  c.cover.style.display = 'none';
  const T = 1150;
  const travel = dot.x + fs * 0.6;
  const arrive = bezier(0.2, 0.7, 0.3, 1);
  // Abstand zum Punkt: erst eng (Windschatten), ab der Hälfte zieht sich das Feld auf seine Plätze
  const k0 = 0.76;
  const spread = (u: number) => { const t = Math.max(0, Math.min(1, (u - 0.42) / 0.58)); return t * t * (3 - 2 * t); };
  const N = 16;
  const lead: Keyframe[] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    lead.push({ offset: u, transform: `translateX(${-travel * (1 - arrive.y(u))}px)` });
  }
  c.A(c.roll, lead, { duration: T, delay: 40, easing: 'linear', fill: 'both' });
  L.forEach((l, i) => {
    const gap = dot.x - l.x;
    const jitter = ((i * 37) % 7) / 7 - 0.5;
    const kf: Keyframe[] = [];
    for (let j = 0; j <= N; j++) {
      const u = j / N;
      const k = k0 + jitter * 0.05 + (1 - k0 - jitter * 0.05) * spread(u);
      const x = -travel * (1 - arrive.y(u)) + gap * (1 - k);
      // eng gefahren: etwas schmaler; im Tritt leicht wippend
      const sq = 1 - 0.08 * (1 - spread(u));
      const bob = Math.sin(u * Math.PI * 7 + i * 1.3) * fs * 0.025 * (1 - spread(u));
      kf.push({ offset: u, transform: `translate(${x}px,${bob}px) scaleX(${sq})` });
    }
    c.A(l.el, kf, { duration: T, delay: 40, easing: 'linear', fill: 'both' });
  });
  c.A(c.dot, [{ transform: 'translateY(0)' }, { transform: 'translateY(-.05em)' }, { transform: 'translateY(0)' }, { transform: 'translateY(-.035em)' }, { transform: 'translateY(0)' }], { duration: T * 0.7, delay: 40, easing: 'ease-in-out', fill: 'both' });
  c.A(c.dotin, [{ transform: 'scale(1)' }, { transform: 'scale(1.22,.82)' }, { transform: 'scale(.95,1.06)' }, { transform: 'scale(1)' }], { duration: 360, delay: 40 + T * 0.62, easing: 'ease-out', fill: 'both' });
  return { land: 40 + T - 80 };
};

// ---------------------------------------------------------------- Zielfoto

/**
 * Zielfoto: ein Schlitz wie bei der Zielkamera tastet das Wort von links nach rechts ab – was er erfasst, steht
 * erst gestreckt da und zieht sich zusammen. Darunter eine Zeitleiste mit laufender Zeit; zuletzt überquert der
 * Punkt die Linie, die Zeit steht.
 */
export const zielfoto: Variant = (c) => {
  const L = letters(c);
  const { fs, dot, word } = c.geo;
  css(c, 'ix-zf', `.ix-zf-t{font:600 ${Math.round(fs * 0.25)}px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;color:var(--muted);white-space:nowrap;text-align:right}`);
  if (c.calm) return {};
  c.cover.style.display = 'none';
  const x0 = word.left - fs * 0.15;
  const x1 = dot.x + fs * 0.3;
  const delay = 160, dur = 980;
  const ease = bezier(0.42, 0, 0.58, 1);
  // Wort aufdecken mit dem Schlitz (clip-path von rechts)
  const ww = word.right - word.left;
  const kf: Keyframe[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const x = x0 + (x1 - x0) * ease.y(t);
    kf.push({ offset: t, clipPath: `inset(-40% ${Math.max(0, Math.min(ww, word.right - x))}px -60% -20%)` });
  }
  c.A(c.word, kf, { duration: dur, delay, easing: 'linear', fill: 'both' });
  // der Schlitz: feine Linie mit Schein
  const slit = at(c.front, h('div', '', 'color:var(--accent);background:currentColor;box-shadow:0 0 8px 1px currentColor;border-radius:1px'), x0, (word.top + word.bottom) / 2, Math.max(1.5, fs * 0.03), fs * 1.7);
  c.A(slit, [{ opacity: 0, transform: 'translateX(0)' }, { opacity: 1, offset: 0.06 }, { opacity: 1, offset: 0.9 }, { opacity: 0, transform: `translateX(${x1 - x0}px)` }], { duration: dur + 120, delay, easing: ease.css, fill: 'both' });
  // gestreckt erfasst, dann zusammenziehen
  for (const l of L) {
    const t = delay + dur * ease.inv((l.x - l.w / 2 - x0) / (x1 - x0));
    c.A(l.inner, [{ transform: 'scaleX(1.9)', opacity: 0.55 }, { transform: 'scaleX(1)', opacity: 1 }], { duration: 300, delay: t, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
    l.inner.style.transformOrigin = '0 50%';
  }
  // Punkt: erst, wenn der Schlitz ihn erreicht
  const td = delay + dur * ease.inv((dot.x - c.geo.pc.r - x0) / (x1 - x0));
  c.A(c.dotin, [{ opacity: 0, transform: 'scale(1.8,.6)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 260, delay: td, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'both' });
  // Zeitleiste mit Strichen und Zeit
  const rw = x1 - x0 + fs * 0.4;
  const ruler = at(c.back, h('div', '', 'background:repeating-linear-gradient(90deg,var(--muted) 0 1px,transparent 1px 7px),repeating-linear-gradient(90deg,var(--muted) 0 1px,transparent 1px 35px);background-size:100% 40%,100% 100%;background-repeat:no-repeat;background-position:0 100%,0 0'), (x0 + x1) / 2, dot.base + fs * 0.42, rw, fs * 0.16);
  c.A(ruler, [{ opacity: 0 }, { opacity: 0.45, offset: 0.2 }, { opacity: 0.45, offset: 0.8 }, { opacity: 0.2 }], { duration: dur + 500, delay: 40, easing: 'ease', fill: 'both' });
  const time = at(c.back, h('div', 'ix-zf-t'), x1 - fs * 0.9, dot.base + fs * 0.85, fs * 2.6, fs * 0.4);
  const fmt = (ms: number) => `0:0${Math.floor(ms / 1000)}.${String(Math.floor((ms % 1000) / 10)).padStart(2, '0')}`;
  time.textContent = fmt(0);
  c.A(time, [{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: 60, fill: 'both' });
  for (let t = 0; t <= dur; t += 40) c.at(delay + t, () => { time.textContent = fmt(Math.min(dur, t) * 1.12); });
  c.at(delay + dur + 10, () => { time.textContent = fmt(dur * 1.12); time.style.color = 'var(--accent)'; });
  return { land: delay + dur + 60 };
};

// ---------------------------------------------------------------- Laufrad

const WHEEL = (() => {
  let spokes = '';
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    // tangential gekreuzt: Speichen setzen am Nabenrand versetzt an
    const off = (i % 2 ? 1 : -1) * 0.5;
    const hx = 50 + Math.cos(a + off) * 6, hy = 50 + Math.sin(a + off) * 6;
    const rx = 50 + Math.cos(a) * 39, ry = 50 + Math.sin(a) * 39;
    spokes += `M${hx.toFixed(1)} ${hy.toFixed(1)}L${rx.toFixed(1)} ${ry.toFixed(1)}`;
  }
  return `<svg viewBox="0 0 100 100" width="100%" height="100%" style="overflow:visible;display:block">
<circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="8"/>
<circle cx="50" cy="50" r="40" fill="none" stroke="var(--muted)" stroke-width="2"/>
<path class="ix-sp" d="${spokes}" stroke="var(--text)" stroke-opacity=".75" stroke-width="1.6" fill="none"/>
<circle class="ix-blur" cx="50" cy="50" r="39" fill="currentColor" opacity="0"/>
<circle cx="50" cy="50" r="7" fill="currentColor"/><circle cx="50" cy="50" r="2.6" fill="var(--bg)"/>
</svg>`;
})();

/**
 * Laufrad: der Punkt ist ein kleines Laufrad mit gekreuzten Speichen. Schnell gerollt verschwimmen die Speichen,
 * beim Ausrollen werden sie sichtbar; danach dreht es im Freilauf langsam aus. Beim Abflug wieder ein Punkt.
 */
export const laufrad: Variant = (c) => {
  const { fs, hidden } = c.geo;
  const s = fs * 0.56;
  const w = onDot(c, h('div', '', 'color:var(--accent)'), s, s, { ax: 0.42, ay: 1, dy: s * 0.02 });
  const spin = h('div', '', 'width:100%;height:100%', WHEEL);
  w.appendChild(spin);
  hideDot(c);
  const sp = spin.querySelector('.ix-sp') as SVGElement;
  const blur = spin.querySelector('.ix-blur') as SVGElement;
  const leave = (dur: number) => {
    w.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.3)' }], { duration: dur * 0.55, easing: 'ease-in', fill: 'forwards' });
    showDot(c, dur * 0.45, dur * 0.2);
  };
  if (c.calm) return { ping: false, leave };
  const turns = Math.round((hidden / (Math.PI * s)) * 4) / 4;
  const { land } = rollOut(c, { clip: true, squash: null, spin, turns, hop: 0.8, edge: c.geo.pc.x + s * 0.08 });
  // schnell: Speichen verschwimmen zu einer Scheibe, beim Ausrollen werden sie scharf
  c.A(blur, [{ opacity: 0.35 }, { opacity: 0.25, offset: 0.55 }, { opacity: 0 }], { duration: 650, delay: 300, easing: 'ease-in', fill: 'both' });
  c.A(sp, [{ opacity: 0.2 }, { opacity: 0.35, offset: 0.55 }, { opacity: 1 }], { duration: 650, delay: 300, easing: 'ease-in', fill: 'both' });
  return {
    land,
    ping: false,
    // Freilauf: dreht langsam aus, ein kleines Nachwippen
    idle() {
      c.F(spin, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(260deg)' }], { duration: 2600, easing: 'cubic-bezier(.1,.6,.3,1)', fill: 'forwards' });
    },
    leave,
  };
};

// ---------------------------------------------------------------- Trikots

const JERSEYS: { col: string; name: string; text?: string }[] = [
  { col: '#ff4f9a', name: 'Maglia rosa' },
  { col: '#f5c400', name: 'Maillot jaune' },
  { col: '#1fae54', name: 'Maillot vert' },
  { col: '#ffffff', name: 'Bergtrikot', text: '#e0262b' },
];

/**
 * Trikots: beim Ausrollen trägt der Punkt nacheinander die Farben der Wertungstrikots – Rosa, Gelb, Grün und
 * zuletzt Weiß mit roten Punkten (Bergtrikot); darunter steht kurz der Name. Beim Aufsetzen wieder die Farbe der
 * Rundfahrt.
 */
export const trikots: Variant = (c) => {
  const { fs, dot, word, pc } = c.geo;
  css(c, 'ix-tk', `.ix-tk-l{font:700 ${Math.round(fs * 0.22)}px var(--font);letter-spacing:.14em;text-transform:uppercase;text-align:center;white-space:nowrap;opacity:0}`);
  if (c.calm) return rollOut(c);
  const { land } = rollOut(c, { clip: true, edge: pc.x });
  // der Punkt wird beim Rollen größer (man soll die Farben sehen), beim Aufsetzen wieder klein
  c.A(c.dotin, [{ transform: 'scale(1)' }, { transform: 'scale(1.7)', offset: 0.12 }, { transform: 'scale(1.7)', offset: 0.88 }, { transform: 'scale(1)' }], { duration: land - 250, delay: 250, easing: 'ease-in-out', fill: 'none' });
  const step = (land - 300) / JERSEYS.length;
  const kf: Keyframe[] = [];
  JERSEYS.forEach((j, i) => {
    kf.push({ offset: (i * step) / (land - 300), color: j.col });
    kf.push({ offset: Math.min(1, ((i + 1) * step - 1) / (land - 300)), color: j.col });
  });
  c.A(c.dotin, kf, { duration: land - 300, delay: 300, easing: 'linear', fill: 'backwards' });
  // Bergtrikot: rote Punkte auf dem weißen Punkt
  const r = pc.r * 1.02;
  const polka = h('div', '', `position:absolute;left:${pc.x - r}px;top:${pc.y - r}px;width:${2 * r}px;height:${2 * r}px;border-radius:50%;opacity:0;background:
radial-gradient(circle at 30% 34%,#e0262b 0 13%,transparent 15%),radial-gradient(circle at 68% 30%,#e0262b 0 11%,transparent 13%),
radial-gradient(circle at 52% 70%,#e0262b 0 12%,transparent 14%),radial-gradient(circle at 22% 72%,#e0262b 0 8%,transparent 10%),
radial-gradient(circle at 82% 66%,#e0262b 0 8%,transparent 10%),#fff;box-shadow:0 0 0 .5px rgba(0,0,0,.3)`);
  c.dotin.style.position = 'relative';
  c.dotin.appendChild(polka);
  const t4 = 300 + 3 * step;
  c.A(polka, [{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.92 }, { opacity: 0 }], { duration: step, delay: t4, easing: 'linear', fill: 'both' });
  // Namen darunter
  const cx = (word.left + dot.x) / 2;
  JERSEYS.forEach((j, i) => {
    const l = at(c.back, h('div', 'ix-tk-l'), cx, dot.base + fs * 0.62, fs * 5, fs * 0.36);
    l.textContent = j.name;
    l.style.color = j.text ?? j.col;
    c.A(l, [{ opacity: 0, transform: 'translateY(.3em)' }, { opacity: 1, transform: 'translateY(0)', offset: 0.22 }, { opacity: 1, transform: 'translateY(0)', offset: 0.78 }, { opacity: 0, transform: 'translateY(-.2em)' }], { duration: step + 60, delay: 300 + i * step, easing: 'ease-out', fill: 'both' });
  });
  return { land };
};
