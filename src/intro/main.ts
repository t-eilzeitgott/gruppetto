/**
 * App-Intro (wird beim Bauen in index.html eingesetzt und läuft vor dem App-Skript): aus „g." (wie das
 * App-Symbol) rollt der Punkt das Wort aus; danach fliegt die Wortmarke in den Kopf der Startseite. Welche
 * Variante läuft, bestimmt schedule.ts (Thema des Tages, jedes dritte Öffnen eine Abwechslung, Vorschau mit
 * ?intro=id). Die App sagt über window.__intro.finish Bescheid, wann es weitergeht (app/intro.ts).
 */
import { pickIntro, type IntroPick, type RaceDay } from './schedule';
import { VARIANTS } from './variants';
import { h, type Ctx, type Hooks } from './engine';

declare global {
  interface Window {
    __intro?: { finish: (target: Element | null) => void };
    __introPick?: IntroPick;
    __introLanded?: boolean;
  }
}

const KN = 'gruppetto.introN';
const KD = 'gruppetto.introDay';
const KR = 'gruppetto.raceDays';

function berlinDay(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Variante wählen (zählt die Starts mit, außer in der Vorschau) */
function choose(force: string | null): IntroPick {
  const day = /[?&]introdate=(\d{4}-\d\d-\d\d)/.exec(location.search)?.[1] ?? berlinDay();
  let n = 1;
  let first = true;
  let race: RaceDay | null = null;
  try {
    n = (Number(localStorage.getItem(KN)) || 0) + 1;
    first = localStorage.getItem(KD) !== day;
    if (!force) {
      localStorage.setItem(KN, String(n));
      localStorage.setItem(KD, day);
    }
    const rd = JSON.parse(localStorage.getItem(KR) || 'null') as { days?: Record<string, RaceDay> } | null;
    race = rd?.days?.[day] ?? null;
  } catch { /* privat, voll: gewohnt */ }
  return pickIntro({ day, n, firstToday: first, race, force });
}

(function () {
  const el = document.getElementById('intro');
  const d = document.documentElement;
  const qs = location.search;
  const force = /[?&]intro=([\w:-]+)/.exec(qs)?.[1] ?? null;
  // nicht angemeldet (Anmeldeseite), Browser ohne Web Animations oder automatische Prüfung: kein Intro
  let off = d.dataset.boot === 'none' || /[?&]demo=login\b/.test(qs);
  try { off = off || (!force && localStorage.getItem('gruppetto.nointro') === '1'); } catch { /* egal */ }
  if (!el || off || !el.animate) { el?.remove(); markLanded(); return; }
  const pristine = el.innerHTML;
  let pick = choose(force);
  window.__introPick = pick;
  try {
    start(el, pick);
  } catch (e) {
    // Variante kaputt: gewohntes Intro
    console.error('[intro]', pick.id, e);
    el.innerHTML = pristine;
    pick = { id: 'base', why: 'standard' };
    window.__introPick = pick;
    start(el, pick);
  }
})();

/**
 * Die Hauptbewegung des Intros ist durch (der Punkt hat aufgesetzt): die App darf jetzt Schweres tun (3D-Welt
 * vorwärmen, app/warm.ts) – vorher würde es mit dem Intro um Rechenzeit und Grafik konkurrieren
 */
function markLanded() {
  if (window.__introLanded) return;
  window.__introLanded = true;
  window.dispatchEvent(new Event('gruppetto-intro-landed'));
}

function start(el: HTMLElement, pick: IntroPick) {
  const d = document.documentElement;
  const calm = !!window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const q = (s: string) => el.querySelector(s) as HTMLElement;
  const mark = q('.intro__mark'), word = q('.intro__word'), roll = q('.intro__roll'), cover = q('.intro__cover');
  const dot = q('.intro__dot'), dotin = q('.intro__dotin'), ping = q('.intro__ping'), bg = q('.intro__bg');
  const ver = el.querySelector<HTMLElement>('.intro__ver');
  const t0 = performance.now();
  const SEQ = calm ? 250 : 1150;
  // Animationen der Sequenz (ohne Endlos-Schmuck) – beim Abschluss werden sie beschleunigt statt abgebrochen
  const seq: Animation[] = [];
  const ats: { t: number; f: () => void; done?: boolean }[] = [];
  // Ring genau um den Punkt (Tinte des „."-Zeichens aus der Schrift vermessen)
  const cs = getComputedStyle(mark);
  const fs = parseFloat(cs.fontSize) || 48;
  const pc = { x: fs * 0.1, y: fs * 0.72, r: fs * 0.06, base: fs * 0.8 };
  try {
    const cx = document.createElement('canvas').getContext('2d')!;
    cx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = cx.measureText('.');
    const base = (fs - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    const rr = Math.max(m.actualBoundingBoxRight + m.actualBoundingBoxLeft, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 2;
    const pcx = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
    const pcy = base - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    if (rr > 0 && isFinite(pcy)) {
      ping.style.left = `${pcx - rr}px`; ping.style.top = `${pcy - rr}px`; ping.style.bottom = 'auto';
      ping.style.width = ping.style.height = `${2 * rr}px`;
      dotin.style.transformOrigin = `${pcx}px ${base + m.actualBoundingBoxDescent}px`;
      pc.x = pcx; pc.y = pcy; pc.r = rr; pc.base = base;
    }
  } catch { /* Schätzwerte */ }
  // Bühne: Wortmarke und die Ebenen der Varianten (dahinter, davor) in einem gemeinsamen Kasten – so groß wie das
  // Intro beim Messen und mittig darin; die Wortmarke steht darauf fest, wo sie gemessen wurde. Alle Maße gelten auf
  // der Bühne. Ändert sich danach die Größe des Schirms, verschiebt sich die Bühne als Ganzes: Wortmarke und
  // Schmuck bleiben zueinander, wie gemessen. (Als Web-App vom Home-Bildschirm misst iOS beim Start erst ohne die
  // Statusleiste – 793 statt 852 px hoch –, bis zum ersten Bild ist es der ganze Schirm. Die mittige Wortmarke rückte
  // dabei 28 px tiefer, alles fest Platzierte nicht: der Punkt fuhr unter dem Profil des Renntags, das Wort deckte
  // dessen Gipfel ab, Zielstrich und Blitz im Zielsprint standen zu hoch.)
  const er = el.getBoundingClientRect();
  const mr = mark.getBoundingClientRect();
  const stage = h('div', '', `position:absolute;left:50%;top:50%;width:${er.width}px;height:${er.height}px;margin:${-er.height / 2}px 0 0 ${-er.width / 2}px`);
  bg.after(stage);
  mark.style.position = 'absolute';
  mark.style.margin = '0';
  mark.style.left = `${mr.left - er.left}px`;
  mark.style.top = `${mr.top - er.top}px`;
  // (Schmuck darf über die Bühne hinausragen – abgeschnitten wird am Rand des Intros)
  const back = h('div', 'intro__fx', 'overflow:visible');
  const front = h('div', 'intro__fx', 'overflow:visible');
  stage.append(back, mark, front);
  const box = (n: Element | Range) => {
    const s = stage.getBoundingClientRect();
    const b = n.getBoundingClientRect();
    return { left: b.left - s.left, top: b.top - s.top, right: b.right - s.left, bottom: b.bottom - s.top, width: b.width, height: b.height };
  };
  // Maße: Breite des „g" und des ganzen Worts, Lage am Ende (noch ohne Animation gemessen)
  const r = document.createRange();
  r.setStart(word.firstChild!, 0); r.setEnd(word.firstChild!, 1);
  const gW = r.getBoundingClientRect().width;
  const wr = box(word);
  const hidden = wr.width - gW;
  const dr = box(dot);
  const ctx: Ctx = {
    el, mark, word, roll, cover, dot, dotin, ping, bg, back, front, calm,
    dark: d.dataset.theme !== 'light',
    pick,
    geo: {
      fs, gW, hidden, shift: hidden / 2, pc,
      dot: { x: dr.left + pc.x, y: dr.top + pc.y, base: dr.top + pc.base },
      word: { left: wr.left, right: wr.right, top: wr.top, bottom: wr.bottom },
      vw: er.width, vh: er.height,
    },
    box,
    A: (n, k, o) => { const a = n.animate(k, o); seq.push(a); return a; },
    F: (n, k, o) => n.animate(k, o),
    at: (t, f) => { ats.push({ t, f }); },
    css: (s) => { const st = document.createElement('style'); st.textContent = s; document.head.appendChild(st); },
  };
  el.dataset.variant = pick.id;
  const hooks: Hooks = (VARIANTS[pick.id] ?? VARIANTS.base)(ctx) || {};

  // ein leiser Ring um den Punkt, solange die App noch lädt (startet, sobald der Punkt aufgesetzt hat)
  const startPing = () => {
    ping.animate([{ opacity: 0.55, transform: 'scale(.4)' }, { opacity: 0, transform: 'scale(2.6)' }], { duration: 1100, iterations: Infinity, easing: 'cubic-bezier(.2,.6,.3,1)' });
  };
  const idle = () => {
    if (calm) return;
    if (hooks.idle) hooks.idle();
    else if (hooks.ping !== false) startPing();
  };

  // Kasten nur um die Buchstaben (Textknoten), ohne Abdeckung, Ring und Schmuck
  const textBox = (root: Element) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    let box: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null = null;
    while ((n = w.nextNode())) {
      if (!n.nodeValue || !n.nodeValue.trim()) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      const c = rg.getBoundingClientRect();
      if (!c.width) continue;
      box = box
        ? { left: Math.min(box.left, c.left), top: Math.min(box.top, c.top), right: Math.max(box.right, c.right), bottom: Math.max(box.bottom, c.bottom), width: 0, height: 0 }
        : { left: c.left, top: c.top, right: c.right, bottom: c.bottom, width: 0, height: 0 };
    }
    if (box) { box.width = box.right - box.left; box.height = box.bottom - box.top; }
    return box;
  };

  // Die Sequenz läuft im Compositor (auf dem iPhone in Core Animation): Bewegungen aus transform und opacity spielt
  // das System selbst ab – flüssig, auch wenn das App-Skript beim Start den Hauptfaden belegt (Laden, Startseite,
  // 3D-Welt vorwärmen). Früher setzte ein eigener Takt in jedem Bild die Zeit aller Animationen; war der Hauptfaden
  // beschäftigt, stand das Intro still oder ruckelte. Eine leere Animation über die ganze Sequenz dient als Uhr
  // (Zeitpunkte für Rückrufe, Ende abwarten); alle starten im selben Bild.
  let END = 0;
  let waiters: (() => void)[] = [];
  let landed = false;
  let done = false;
  let rate = 1;
  seq.forEach((x) => { END = Math.max(END, Number(x.effect?.getComputedTiming().endTime) || 0); });
  ats.sort((a, b) => a.t - b.t);
  if (seq.length) for (const a of ats) END = Math.max(END, a.t);
  const LAND = Math.min(hooks.land ?? 950, END || Infinity);
  const ref = seq.length ? new Animation(new KeyframeEffect(null, [], { duration: END, fill: 'forwards' }), document.timeline) : null;
  const all = ref ? [...seq, ref] : seq;
  const now = () => (ref ? Math.min(END, Number(ref.currentTime) || 0) : Infinity);
  const fire = () => {
    const clock = now();
    for (const a of ats) {
      if (a.done || a.t > clock) continue;
      a.done = true;
      try { a.f(); } catch (e) { console.error('[intro]', e); }
    }
  };
  const settle = () => {
    const w = waiters; waiters = [];
    w.forEach((f) => f());
  };
  if (ref) {
    ref.play();
    // gleicher Start für alle (im selben Bild angelegt – sicherheitshalber ausgerichtet, sobald die Uhr läuft)
    ref.ready.then(() => { for (const x of seq) if (x.playState !== 'finished') x.startTime = ref.startTime; }).catch(() => undefined);
    ref.finished.then(() => { fire(); settle(); }).catch(() => undefined);
    // Rückrufe und Aufsetzen (Hauptfaden – nur Nebensachen wie eine mitlaufende Uhr, nie die Bewegung selbst)
    const js = () => {
      fire();
      if (!landed && now() >= LAND) { landed = true; if (!done) idle(); markLanded(); }
      if (now() < END) requestAnimationFrame(js);
      else markLanded();
    };
    requestAnimationFrame(js);
    // (kommen gar keine Bilder, gilt es spätestens nach dem Ende der Sequenz als gelandet)
    setTimeout(markLanded, END + 400);
  } else { fire(); markLanded(); }
  // Sequenz zu Ende spielen: was noch fehlt, läuft in höchstens MAXREST ms (schneller, aber vollständig)
  // (Themen-Varianten dürfen etwas länger ausspielen – man soll sie ja sehen)
  const MAXREST = pick.id === 'base' ? 420 : 700;
  const playOut = (then: () => void) => {
    const rest = (END - now()) / rate;
    if (!ref || rest <= 0) { then(); return; }
    if (rest > MAXREST) {
      rate = (END - now()) / MAXREST;
      // neue Geschwindigkeit ohne Sprung – bleibt im Compositor
      for (const x of all) x.updatePlaybackRate(rate);
    }
    let fired = false;
    const go = () => { if (!fired) { fired = true; then(); } };
    waiters.push(go);
    // Notbremse, falls gar keine Bilder mehr kommen (z. B. App im Hintergrund)
    setTimeout(() => { if (!fired) { for (const x of all) { try { x.finish(); } catch { /* egal */ } } fire(); go(); } }, 2500);
  };
  // Abschluss: Wortmarke fliegt an ihren Platz im Kopf der App (target), der Hintergrund blendet aus
  // Vorschau (?intro=…): ganz abspielen und kurz stehen lassen, auch wenn die App schneller bereit ist
  const hold = pick.why === 'vorschau' ? (END || SEQ) + 1600 : 0;
  const finish = (target: Element | null) => {
    if (done) return;
    const wait0 = t0 + hold - performance.now();
    if (wait0 > 0) { setTimeout(() => finish(target ?? findMark()), wait0); return; }
    done = true;
    const wait = (fn: () => void) => { if (calm) setTimeout(fn, Math.max(0, t0 + SEQ - performance.now())); else playOut(fn); };
    wait(() => {
      el.style.pointerEvents = 'none';
      const a = textBox(mark);
      const b = target && !calm ? textBox(target) : null;
      const fade = (n: Element, delay: number) => n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, delay, easing: 'ease', fill: 'forwards' });
      try { hooks.leave?.(520); } catch (e) { console.error('[intro]', e); }
      if (a && b) {
        // skalieren um die Mitte der Schrift (nicht um die Mitte des Kastens)
        const e = mark.getBoundingClientRect();
        mark.style.transformOrigin = `${a.left + a.width / 2 - e.left}px ${a.top + a.height / 2 - e.top}px`;
        const s = b.width / a.width;
        const dx = b.left + b.width / 2 - (a.left + a.width / 2);
        const dy = b.top + b.height / 2 - (a.top + a.height / 2);
        // solange sie fliegt, ist die echte Wortmarke unsichtbar (sonst stünde sie doppelt da)
        d.classList.add('intro-fly');
        const fly = mark.animate([{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(${dx}px,${dy}px) scale(${s})` }],
          { duration: 520, easing: 'cubic-bezier(.4,0,.1,1)', fill: 'forwards' });
        ping.getAnimations().forEach((x) => x.cancel());
        fade(bg, 60);
        fade(back, 0);
        fade(front, 0);
        ver?.animate([{ opacity: 0 }], { duration: 200, easing: 'ease', fill: 'forwards' });
        // gelandet: im selben Bild die echte Wortmarke zeigen und das Intro entfernen
        let gone = false;
        const land = () => { if (gone) return; gone = true; d.classList.remove('intro-fly'); el.remove(); };
        fly.onfinish = land;
        setTimeout(land, 900);
      } else {
        mark.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.96)' }], { duration: 260, easing: 'ease', fill: 'forwards' });
        ver?.animate([{ opacity: 0 }], { duration: 200, easing: 'ease', fill: 'forwards' });
        fade(back, 0);
        fade(front, 0);
        fade(bg, 0).onfinish = () => el.remove();
      }
    });
  };
  window.__intro = { finish };
  // falls die App nicht Bescheid gibt: spätestens nach 3,5 s
  setTimeout(() => finish(null), Math.max(3500, hold + 200));
}

/** sichtbare Wortmarke der App (Kopf der Startseite oder Seitenleiste) – wie app/intro.ts */
function findMark(): Element | null {
  for (const e of Array.from(document.querySelectorAll('#root .wordmark'))) {
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && getComputedStyle(e).visibility !== 'hidden') return e;
  }
  return null;
}
