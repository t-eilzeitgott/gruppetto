/**
 * Startanimation der Minispiele – wie das Intro beim App-Start, je Spiel eine eigene:
 *  - Zeitfahren: eine Stoppuhr, der Zeiger läuft eine Runde, dann fliegt man durchs Zifferblatt in die Welt
 *  - Abfahrt: Fahrtwind-Striche, eine Serpentine zeichnet sich von oben nach unten, der Vorhang geht nach oben
 *  - Sprint: Zielband und Fotofinish-Strich, die Schilder 300 · 200 · 100 m, dann ein Wisch nach rechts
 *  - Berg: drei Bergketten steigen auf, das Bergtrikot (rote Punkte) springt herein, die Berge sinken weg
 *
 * Sie steht beim Tippen sofort (noch vor dem Seitenwechsel) und läuft nur über transform und opacity mit Web
 * Animations – also auf dem Compositor, auch wenn der Hauptfaden gerade Shader übersetzt oder die Strecke baut.
 * Darunter bereitet das Spiel alles vor (siehe gamePrep.ts): Bühne, Strecke, Hochladen, ein Probeblick in die
 * Fahrkamera. Erst wenn das fertig ist (und die Animation ihre Mindestzeit hatte), geht sie auf – Kameraschwenk und
 * Start laufen dann ohne Nachladen. Dauert es länger, läuft sie ruhig weiter („Strecke wird aufgebaut“).
 */
import type { GameId } from '../data/source';

interface Run {
  game: GameId;
  el: HTMLElement;
  /** erfüllt, sobald der Kreis vom Knopf aus den Bildschirm bedeckt */
  covered: Promise<void>;
  t0: number;
  min: number;
  ready: boolean;
  out: boolean;
  short: boolean;
  exit: () => Animation[];
  idle: Animation[];
  wait: Animation | null;
  timer: number;
  done: Promise<void>;
  finish: () => void;
}

let cur: Run | null = null;
/** zuletzt getippt (Startpunkt des Kreises, wenn der Aufrufer keinen Knopf nennt – z. B. „Nochmal“) */
let lastTap: { x: number; y: number; t: number } | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => { lastTap = { x: e.clientX, y: e.clientY, t: performance.now() }; }, { capture: true, passive: true });
}
const exitFns: (() => void)[] = [];
/** laufende Nummer (je gezeigter Animation eine neue – die Vorbereitung beginnt dann von vorn) */
let seq = 0;
/** was die Seite noch abwartet, bevor das Spiel als vorbereitet gilt (z. B. die Geister der Runde) */
const holds = new Set<string>();

/** längste Wartezeit: danach geht sie auf, auch wenn noch gebaut wird (Prüfungen: ?gimax=ms) */
const MAX_MS = (() => { try { const m = /[?&]gimax=(\d+)/.exec(window.location.search); return m ? Number(m[1]) : 5000; } catch { return 5000; } })();

const calm = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

function h(tag: string, cls: string, parent?: HTMLElement, style?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (style) e.style.cssText = style;
  parent?.append(e);
  return e;
}

function svg(markup: string, cls: string, parent: HTMLElement, viewBox: string): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', cls);
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('preserveAspectRatio', 'none');
  s.innerHTML = markup;
  parent.append(s);
  return s;
}

type KF = Keyframe[];
const EASE_OUT = 'cubic-bezier(0.2, 0.9, 0.3, 1)';
const POP = 'cubic-bezier(0.2, 1.35, 0.4, 1)';
const EASE_IN = 'cubic-bezier(0.5, 0, 0.75, 0.2)';

interface Variant {
  /** Bilder der Ankunft (laufen einmal) */
  enter: Animation[];
  /** ruhige Schleife, solange gewartet wird */
  idle: Animation[];
  /** Abgang: die Welt kommt zum Vorschein */
  exit: () => Animation[];
}

function anim(el: Element, kf: KF, o: KeyframeAnimationOptions): Animation {
  return el.animate(kf, { fill: 'both', ...o });
}

// ------------------------------------------------------------------ Zeitfahren: Stoppuhr

function zeitfahren(art: HTMLElement): Variant {
  const watch = h('div', 'gi-watch', art);
  const crown = h('div', 'gi-watch__crown', watch);
  const face = h('div', 'gi-watch__face', watch);
  const sweep = h('div', 'gi-watch__sweep', face);
  for (let i = 0; i < 60; i++) h('i', i % 5 === 0 ? 'gi-watch__tick is-big' : 'gi-watch__tick', face, `transform:rotate(${i * 6}deg)`);
  const hand = h('div', 'gi-watch__hand', face);
  h('div', 'gi-watch__pin', face);
  const enter = [
    anim(watch, [{ transform: 'scale(0.55)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 520, easing: POP }),
    anim(crown, [{ transform: 'translateY(0)' }, { transform: 'translateY(7px)' }, { transform: 'translateY(0)' }], { duration: 260, delay: 380, easing: 'ease-in-out' }),
    anim(hand, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 1150, delay: 420, easing: 'cubic-bezier(0.55, 0, 0.3, 1)' }),
    anim(sweep, [{ transform: 'rotate(0deg)', opacity: 0 }, { transform: 'rotate(60deg)', opacity: 1, offset: 0.15 }, { transform: 'rotate(360deg)', opacity: 1 }], { duration: 1150, delay: 420, easing: 'cubic-bezier(0.55, 0, 0.3, 1)' }),
  ];
  const idle = [
    anim(hand, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 2400, delay: 1570, iterations: Infinity, easing: 'linear', fill: 'none' }),
    anim(sweep, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 2400, delay: 1570, iterations: Infinity, easing: 'linear', fill: 'none' }),
  ];
  return {
    enter, idle,
    exit: () => [anim(watch, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(6)', opacity: 0 }], { duration: 520, easing: EASE_IN })],
  };
}

// ------------------------------------------------------------------ Abfahrt: Fahrtwind und Serpentine

function abfahrt(art: HTMLElement, root: HTMLElement): Variant {
  const wind = h('div', 'gi-wind', root);
  const idle: Animation[] = [];
  for (let i = 0; i < 16; i++) {
    const x = (i * 61) % 100;
    const len = 14 + ((i * 37) % 26);
    const line = h('i', 'gi-wind__line', wind, `left:${x}%;height:${len}vh;opacity:${0.25 + ((i * 13) % 50) / 100}`);
    idle.push(anim(line, [{ transform: 'translateY(-60vh)' }, { transform: 'translateY(170vh)' }], { duration: 520 + ((i * 97) % 480), delay: (i * 83) % 600, iterations: Infinity, easing: 'linear', fill: 'none' }));
  }
  // Serpentine: wischt von oben nach unten herein (außen nach unten, innen gegenläufig – nur transform)
  const clip = h('div', 'gi-road', art);
  const inner = h('div', 'gi-road__in', clip);
  svg('<path d="M58 0 C 58 18, 20 16, 22 32 S 82 44, 80 60 S 18 72, 24 88 S 60 98, 52 112" />', 'gi-road__svg', inner, '0 0 100 112');
  const enter = [
    anim(clip, [{ transform: 'translateY(-100%)' }, { transform: 'translateY(0)' }], { duration: 1000, delay: 150, easing: 'cubic-bezier(0.45, 0, 0.25, 1)' }),
    anim(inner, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 1000, delay: 150, easing: 'cubic-bezier(0.45, 0, 0.25, 1)' }),
    anim(wind, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 }),
  ];
  return {
    enter, idle,
    exit: () => [anim(root, [{ transform: 'translateY(0)' }, { transform: 'translateY(-100%)' }], { duration: 560, easing: 'cubic-bezier(0.6, 0, 0.3, 1)' })],
  };
}

// ------------------------------------------------------------------ Sprint: Zielband und Fotofinish

function sprint(art: HTMLElement, root: HTMLElement): Variant {
  const band = h('div', 'gi-band', art);
  const strip = h('div', 'gi-band__strip', band);
  const boards = h('div', 'gi-boards', art);
  const signs = ['300', '200', '100'].map((n) => { const b = h('span', 'gi-board', boards); b.textContent = `${n} m`; return b; });
  const scan = h('i', 'gi-scan', root);
  const enter = [
    anim(band, [{ transform: 'translateX(-110%) skewX(-12deg)' }, { transform: 'translateX(0) skewX(-12deg)' }], { duration: 560, easing: EASE_OUT }),
    ...signs.map((s, i) => anim(s, [{ transform: 'translateY(14px) scale(0.7)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, delay: 300 + i * 220, easing: POP })),
    anim(scan, [{ transform: 'translateX(-5vw)', opacity: 0 }, { transform: 'translateX(20vw)', opacity: 1, offset: 0.2 }, { transform: 'translateX(105vw)', opacity: 1 }], { duration: 900, delay: 700, easing: 'cubic-bezier(0.5, 0, 0.5, 1)' }),
  ];
  const idle = [
    anim(strip, [{ transform: 'translateX(0)' }, { transform: 'translateX(-40px)' }], { duration: 600, iterations: Infinity, easing: 'linear', fill: 'none' }),
    anim(scan, [{ transform: 'translateX(-5vw)', opacity: 0 }, { transform: 'translateX(20vw)', opacity: 1, offset: 0.2 }, { transform: 'translateX(105vw)', opacity: 1 }], { duration: 1300, delay: 1700, iterations: Infinity, easing: 'cubic-bezier(0.5, 0, 0.5, 1)', fill: 'none' }),
  ];
  return {
    enter, idle,
    exit: () => [anim(root, [{ transform: 'translateX(0)' }, { transform: 'translateX(105%)' }], { duration: 520, easing: 'cubic-bezier(0.6, 0, 0.3, 1)' })],
  };
}

// ------------------------------------------------------------------ Berg: Bergketten und Bergtrikot

function berg(art: HTMLElement, root: HTMLElement): Variant {
  const range = h('div', 'gi-range', root);
  const layers = [
    '<polygon points="0,100 0,58 12,46 22,52 36,30 48,44 58,26 70,40 84,22 100,38 100,100" />',
    '<polygon points="0,100 0,70 14,56 26,64 40,44 54,60 66,48 80,58 92,46 100,52 100,100" />',
    '<polygon points="0,100 0,82 18,70 32,78 50,62 64,74 78,66 100,76 100,100" />',
  ].map((p, i) => svg(p, `gi-range__l gi-range__l--${i}`, range, '0 0 100 100'));
  const kom = h('div', 'gi-kom', art);
  // Bergtrikot: rote Punkte im Versatz (wie gewebt), am Rand angeschnitten
  const dots: [number, number][] = [[30, 12], [70, 12], [10, 38], [50, 38], [90, 38], [30, 64], [70, 64], [10, 90], [50, 90], [90, 90]];
  for (const [x, y] of dots) h('i', 'gi-kom__dot', kom, `left:${x}%;top:${y}%`);
  const enter = [
    ...layers.map((l, i) => anim(l, [{ transform: `translateY(${50 + i * 20}%)` }, { transform: 'translateY(0)' }], { duration: 900, delay: i * 140, easing: EASE_OUT })),
    anim(kom, [{ transform: 'scale(0) rotate(-35deg)', opacity: 0 }, { transform: 'scale(1) rotate(0deg)', opacity: 1 }], { duration: 560, delay: 620, easing: POP }),
  ];
  const idle = [
    anim(kom, [{ transform: 'translateY(0)' }, { transform: 'translateY(-6px)' }, { transform: 'translateY(0)' }], { duration: 1800, delay: 1200, iterations: Infinity, easing: 'ease-in-out', fill: 'none' }),
  ];
  return {
    enter, idle,
    exit: () => [
      ...layers.map((l, i) => anim(l, [{ transform: 'translateY(0)' }, { transform: `translateY(${60 + i * 25}%)` }], { duration: 520, delay: (2 - i) * 50, easing: EASE_IN })),
      anim(kom, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.6)', opacity: 0 }], { duration: 380, easing: EASE_IN }),
    ],
  };
}

/** Nummer der laufenden Animation (0: keine) */
export function gameIntroId(): number {
  return cur && !cur.out ? seq : 0;
}

/**
 * Die Seite wartet noch auf etwas, das die Welt des Starts verändert (Geister, Mitspieler): solange gilt das Spiel
 * nicht als vorbereitet (höchstens bis zur längsten Wartezeit)
 */
export function holdGameIntro(key: string, on: boolean) {
  if (on) holds.add(key);
  else holds.delete(key);
}

/** wartet die Seite noch? */
export function gameIntroHeld(): boolean {
  return holds.size > 0;
}

/** läuft gerade eine Startanimation (für dieses Spiel)? */
export function gameIntroActive(game?: GameId): boolean {
  return !!cur && !cur.out && (!game || cur.game === game);
}

/** unter dem unteren Rand noch so viel Hintergrund (wächst der sichtbare Bereich, bleibt keine Lücke) */
const EXTRA = 220;
/** Kreis vom Knopf aus: Dauer; um so viel später beginnt der Inhalt der Animation */
const REVEAL_MS = 420;
const REVEAL_LEAD = 170;

/**
 * erfüllt, sobald die laufende Startanimation den Bildschirm ganz bedeckt (der Kreis vom Knopf aus ist auf) – erst
 * dann die Seite wechseln: Das Aufbauen der Spielseite hält den Hauptfaden an, der Kreis liefe sonst ruckelnd auf
 */
export function gameIntroCovered(): Promise<void> {
  return cur && !cur.out ? cur.covered : Promise.resolve();
}

/**
 * Startanimation zeigen – sofort, im selben Bild wie das Tippen. title/sub: Name und Strecke des Spiels;
 * short: kurz (Nochmal); from: getippter Knopf – von dort öffnet sich die Animation als Kreis
 *
 * Maße fest in Pixeln (Breite, Höhe des Bildschirms beim Tippen), der Inhalt an der Oberkante ausgerichtet: Baut
 * sich darunter der Ansichtsbereich um (Seitensperre des Spiels; auf dem iPhone als Web-App wird er dabei um die
 * Statusleiste kürzer oder länger), springt nichts – vorher rutschte die mittig gesetzte Uhr dabei um 30 px.
 */
export function playGameIntro(game: GameId, o: { title: string; sub?: string; short?: boolean; from?: DOMRect | null }) {
  if (cur && !cur.out && cur.game === game) return;
  cancelGameIntro();
  const quiet = calm();
  const el = h('div', `gintro gintro--${game}${o.short ? ' is-short' : ''}`);
  el.setAttribute('aria-hidden', 'true');
  const W = window.innerWidth;
  const H = Math.max(window.innerHeight, document.documentElement.clientHeight || 0);
  el.style.cssText = `inset:auto;left:0;top:0;width:${W}px;height:${H + EXTRA}px;--gi-h:${H}px`;
  // (der Kreis schneidet nur den Inhalt zu – die Hülle fängt vom ersten Bild an alle Fingertipps ab, auch außerhalb)
  const clip = h('div', 'gintro__clip', el);
  const bg = h('div', 'gintro__bg', clip, `background:radial-gradient(${Math.round(W * 1.2)}px ${Math.round(H * 0.8)}px at 50% ${Math.round(H * 0.38)}px, var(--gi-bg1) 0%, var(--gi-bg2) 70%)`);
  const stageEl = h('div', 'gintro__stage', clip);
  const art = h('div', 'gintro__art', stageEl);
  const text = h('div', 'gintro__text', stageEl);
  h('strong', 'gintro__title', text).textContent = o.title;
  if (o.sub) h('span', 'gintro__sub', text).textContent = o.sub;
  const wait = h('div', 'gintro__wait', clip);
  wait.innerHTML = 'Strecke wird aufgebaut<i>.</i><i>.</i><i>.</i>';
  document.body.append(el);
  let v: Variant;
  try {
    v = game === 'zeitfahren' ? zeitfahren(art) : game === 'sprint' ? sprint(art, stageEl) : game === 'berg' ? berg(art, stageEl) : abfahrt(art, stageEl);
  } catch {
    v = { enter: [], idle: [], exit: () => [] };
  }
  const textIn = anim(text, [{ transform: 'translateY(14px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 480, delay: game === 'zeitfahren' ? 260 : 420, easing: EASE_OUT });
  const waitIn = anim(wait, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 1900 });
  // vom getippten Knopf aus als Kreis öffnen; der Inhalt beginnt, sobald der Kreis den Großteil bedeckt
  let reveal: Animation | null = null;
  const from = o.from ?? (lastTap && performance.now() - lastTap.t < 900 ? new DOMRect(lastTap.x - 22, lastTap.y - 22, 44, 44) : null);
  if (from && !quiet) {
    const x = from.left + from.width / 2, y = from.top + from.height / 2;
    const r1 = Math.ceil(Math.hypot(Math.max(x, W - x), Math.max(y, H - y))) + 8;
    const r0 = Math.max(12, Math.min(from.height, from.width) / 2);
    try {
      reveal = clip.animate([{ clipPath: `circle(${r0}px at ${x}px ${y}px)` }, { clipPath: `circle(${r1}px at ${x}px ${y}px)` }], { duration: REVEAL_MS, easing: 'cubic-bezier(0.5, 0, 0.15, 1)' });
      for (const a of [...v.enter, ...v.idle, textIn, waitIn]) {
        const t = a.effect?.getTiming();
        if (t) a.effect!.updateTiming({ delay: (Number(t.delay) || 0) + REVEAL_LEAD });
      }
    } catch { reveal = null; }
  }
  // (ruhige Bewegung: Ankunft gleich am Ende, die Schleifen gar nicht – finish() wirft bei endlosen Animationen,
  // die Hülle bliebe dann für immer liegen)
  if (quiet) {
    for (const a of [...v.enter, textIn]) { try { a.finish(); } catch { /* weiter */ } }
    for (const a of v.idle) a.cancel();
  }
  if (o.short) for (const a of [...v.enter, textIn]) a.updatePlaybackRate(1.8);
  let finish = () => {};
  const done = new Promise<void>((r) => { finish = r; });
  const run: Run = {
    game, el, t0: performance.now(), min: (quiet ? 250 : o.short ? 520 : 1250) + (reveal ? REVEAL_LEAD : 0), ready: false, out: false, short: !!o.short,
    // (spätestens kurz nach der Dauer des Kreises – falls die Animation im Hintergrund hängt)
    covered: reveal
      ? Promise.race([reveal.finished.then(() => undefined, () => undefined), new Promise<void>((r) => { window.setTimeout(r, REVEAL_MS + 300); })])
      : Promise.resolve(),
    exit: () => {
      if (quiet) return [anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease' })];
      return [
        ...v.exit(),
        anim(text, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(-12px)', opacity: 0 }], { duration: 260, easing: EASE_IN }),
        anim(wait, [{ opacity: Number(getComputedStyle(wait).opacity) || 0 }, { opacity: 0 }], { duration: 200 }),
        anim(bg, [{ opacity: 1 }, { opacity: 0 }], { duration: 460, delay: 110, easing: 'ease-in' }),
      ];
    },
    idle: v.idle, wait: waitIn, timer: 0, done, finish,
  };
  cur = run;
  seq += 1;
  log('play');
  // Sicherheitsnetz: meldet das Spiel nichts (Fehler, ohne 3D), geht sie trotzdem auf (gezählt ab dem Seitenwechsel,
  // der nach dem Kreis kommt)
  run.timer = window.setTimeout(() => { if (cur === run) leave(run); }, MAX_MS + (reveal ? REVEAL_MS : 0));
}

/** Protokoll für automatische Prüfungen (window.__gameIntroLog, nur wenn vorhanden) */
function log(ev: string) {
  const l = (window as unknown as { __gameIntroLog?: [string, number][] }).__gameIntroLog;
  if (l) l.push([ev, Math.round(performance.now())]);
}

/** das Spiel ist vorbereitet: aufgehen, sobald die Mindestzeit um ist */
export function gameIntroReady() {
  const r = cur;
  if (!r || r.out || r.ready) return;
  log('ready');
  r.ready = true;
  const rest = r.min - (performance.now() - r.t0);
  if (rest <= 0) leave(r);
  else window.setTimeout(() => { if (cur === r) leave(r); }, rest);
}

/** beim Aufgehen (die Welt erscheint) – z. B. das Startblatt hereingleiten lassen; läuft sofort, wenn keine läuft */
export function onGameIntroExit(fn: () => void) {
  if (!cur || cur.out) { fn(); return; }
  exitFns.push(fn);
}

/** Promise, die mit dem Ende der laufenden Animation erfüllt ist */
export function gameIntroDone(): Promise<void> {
  return cur ? cur.done : Promise.resolve();
}

function leave(r: Run) {
  if (r.out) return;
  log(r.ready ? 'leave' : 'leave-timeout');
  r.out = true;
  window.clearTimeout(r.timer);
  r.wait?.cancel();
  for (const a of r.idle) { try { a.pause(); } catch { /* (abgebrochene endlose Schleife: wirft) */ } }
  const fns = exitFns.splice(0);
  let list: Animation[] = [];
  try { list = r.exit(); } catch { list = []; }
  for (const f of fns) { try { f(); } catch { /* weiter */ } }
  const end = () => {
    r.el.remove();
    if (cur === r) cur = null;
    r.finish();
  };
  if (!list.length) { end(); return; }
  Promise.all(list.map((a) => a.finished.catch(() => undefined))).then(end, end);
}

/** abbrechen (Seite verlassen): sofort weg */
export function cancelGameIntro() {
  const r = cur;
  if (!r) return;
  cur = null;
  r.out = true;
  window.clearTimeout(r.timer);
  exitFns.length = 0;
  r.el.remove();
  r.finish();
}
