/**
 * Abwechslung bei jedem dritten Öffnen: sechs ruhige Varianten, alle in der Farbe der Rundfahrt, alle enden wie
 * gewohnt mit dem Punkt hinter dem Wort.
 */
import { at, bezier, h, letters, onDot, type Variant } from '../engine';

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
 * erst gestreckt da und zieht sich zusammen; zuletzt überquert der Punkt die Linie.
 */
export const zielfoto: Variant = (c) => {
  const L = letters(c);
  const { fs, dot, word } = c.geo;
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
  return { land: delay + dur + 60 };
};

// ---------------------------------------------------------------- Fokus

/**
 * Fokus: die Buchstaben werden von links nach rechts nacheinander scharf (aus der Unschärfe, ein Hauch von unten),
 * zuletzt fällt der Punkt von oben auf seinen Platz und federt kurz.
 */
export const fokus: Variant = (c) => {
  const L = letters(c);
  const { fs } = c.geo;
  if (c.calm) return {};
  c.cover.style.display = 'none';
  L.forEach((l, i) => {
    c.A(l.inner, [
      { opacity: 0, filter: 'blur(8px)', transform: 'translateY(.12em) scale(1.06)' },
      { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0) scale(1)' },
    ], { duration: 520, delay: 80 + i * 55, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' });
  });
  const t = 80 + L.length * 55 + 180;
  c.A(c.dot, [
    { offset: 0, transform: `translateY(${-fs * 1.4}px)`, opacity: 0, easing: 'cubic-bezier(.5,0,.9,.5)' },
    { offset: 0.55, transform: 'translateY(0)', opacity: 1, easing: 'cubic-bezier(.2,.7,.4,1)' },
    { offset: 0.78, transform: `translateY(${-fs * 0.16}px)`, opacity: 1, easing: 'cubic-bezier(.5,0,.9,.5)' },
    { offset: 1, transform: 'translateY(0)', opacity: 1 },
  ], { duration: 560, delay: t, fill: 'both' });
  c.A(c.dotin, [{ transform: 'scale(1)' }, { transform: 'scale(1.35,.7)' }, { transform: 'scale(.92,1.1)' }, { transform: 'scale(1)' }], { duration: 300, delay: t + 300, easing: 'ease-out', fill: 'both' });
  return { land: t + 560 };
};

// ---------------------------------------------------------------- Welle

/**
 * Welle: die Buchstaben wachsen nacheinander aus der Grundlinie und federn nach – wie ein Feld, das über eine
 * Kuppe kommt. Der Punkt kommt als Letzter oben drüber.
 */
export const welle: Variant = (c) => {
  const L = letters(c);
  if (c.calm) return {};
  c.cover.style.display = 'none';
  L.forEach((l, i) => {
    l.inner.style.transformOrigin = '50% 85%';
    c.A(l.inner, [
      { opacity: 0, transform: 'translateY(.18em) scaleY(0)' },
      { opacity: 1, transform: 'translateY(-.06em) scaleY(1.12)', offset: 0.55 },
      { opacity: 1, transform: 'translateY(.01em) scaleY(.97)', offset: 0.8 },
      { opacity: 1, transform: 'translateY(0) scaleY(1)' },
    ], { duration: 560, delay: 60 + i * 62, easing: 'ease-out', fill: 'both' });
  });
  const t = 60 + L.length * 62;
  c.A(c.dot, [
    { transform: 'translate(-.5em,-.1em)', opacity: 0 },
    { transform: 'translate(-.2em,-.45em)', opacity: 1, offset: 0.45 },
    { transform: 'translate(0,0)', opacity: 1 },
  ], { duration: 460, delay: t, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'both' });
  c.A(c.dotin, [{ transform: 'scale(1)' }, { transform: 'scale(1.3,.74)' }, { transform: 'scale(.94,1.08)' }, { transform: 'scale(1)' }], { duration: 320, delay: t + 440, easing: 'ease-out', fill: 'both' });
  return { land: t + 480 };
};

// ---------------------------------------------------------------- Aufprall

/**
 * Aufprall: der Punkt fällt von oben auf seinen Platz; beim Aufprall läuft eine feine Linie über die Grundlinie,
 * und das Wort fächert sich vom Punkt aus nach links auf.
 */
export const fall: Variant = (c) => {
  const L = letters(c);
  const { fs, dot, word } = c.geo;
  if (c.calm) return {};
  c.cover.style.display = 'none';
  const drop = 520;
  c.A(c.dot, [
    { offset: 0, transform: `translateY(${-c.geo.vh * 0.42}px)`, easing: 'cubic-bezier(.55,0,1,.45)' },
    { offset: 0.72, transform: 'translateY(0)', easing: 'cubic-bezier(0,.55,.45,1)' },
    { offset: 0.86, transform: `translateY(${-fs * 0.2}px)`, easing: 'cubic-bezier(.55,0,1,.45)' },
    { offset: 1, transform: 'translateY(0)' },
  ], { duration: drop / 0.72, delay: 60, fill: 'both' });
  const hit = 60 + drop;
  c.A(c.dotin, [{ transform: 'scale(1)' }, { transform: 'scale(1.5,.6)' }, { transform: 'scale(.9,1.12)' }, { transform: 'scale(1)' }], { duration: 320, delay: hit - 10, easing: 'ease-out', fill: 'both' });
  // feine Linie entlang der Grundlinie, vom Punkt nach links
  const w = dot.x - word.left + fs * 0.3;
  const ln = at(c.back, h('div', '', 'color:var(--accent);background:linear-gradient(90deg,transparent,currentColor);transform-origin:100% 50%;opacity:0'), dot.x - w / 2, dot.base + fs * 0.12, w, Math.max(1, fs * 0.025));
  c.A(ln, [{ opacity: 0.9, transform: 'scaleX(0)' }, { opacity: 0.6, transform: 'scaleX(1)', offset: 0.6 }, { opacity: 0, transform: 'scaleX(1)' }], { duration: 640, delay: hit, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' });
  // Wort fächert sich vom Punkt aus auf (letzter Buchstabe zuerst)
  const n = L.length;
  L.forEach((l, i) => {
    const k = n - 1 - i;
    c.A(l.el, [
      { opacity: 0, transform: `translateX(${dot.x - l.x}px) scale(.6)` },
      { opacity: 1, transform: 'translateX(0) scale(1)' },
    ], { duration: 480, delay: hit + 20 + k * 32, easing: 'cubic-bezier(.16,.9,.3,1.06)', fill: 'both' });
  });
  return { land: hit + 20 + n * 32 + 300 };
};
