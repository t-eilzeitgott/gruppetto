/**
 * Automatik für Auflösung, Sichtweite und Schattenkarte der 3D-Spiele. Die Schieberegler (gfxOpts.ts) sind die
 * Obergrenze: ruckelt es, senkt die Automatik im Spiel
 *
 *   1. die Auflösung in zwei Schritten bis auf drei Viertel der gewählten (2-fach → 1,75 → 1,5-fach) – das hilft, wenn
 *      die Grafik das Limit ist (auf dem iPhone fast immer), und kostet keinen Umbau der Welt;
 *   2. danach die Sichtweite Stufe für Stufe bis zur kürzesten („Einfach“);
 *   3. die Schattenkarte (ab Stufe 6) nur noch jedes zweite Bild – ihr Zeichendurchgang ist gut ein Drittel aller
 *      Zeichenaufrufe; nur die Schatten der Fahrer hinken dann ein Bild hinterher;
 *   4. die Auflösung weiter bis auf die Hälfte der gewählten (2-fach → 1,25 → 1-fach);
 *   5. die Schattenkarte nur jedes vierte Bild.
 *
 * Ist die Rechenzeit die Grenze, hilft die Auflösung nicht – dann gleich die Sichtweite.
 *
 * Ziel: eine Grafikzeit je Bild (Probebild) unter gut der Hälfte des Takts – auf dem iPhone unter 8–9 ms. Die
 * Wechselfahrten (Version 261–264) zeigten: bei 5–8 ms Grafik lief Stufe 6 in 1-facher Auflösung eine halbe Minute
 * ohne einen Ruckler, bei 9–13 ms kamen 20–50 je Minute, und zusätzliche Grafikarbeit (+4 ms) vervierfachte sie –
 * ein Bild, dessen Grafik nicht rechtzeitig fertig ist, lässt den Browser einen Takt auslassen. (Die frühere
 * Lesart, das iPhone takte bei kleiner Last herunter und liefe bei 8–13 ms am rundesten, war ein Zufall über
 * verschiedene Fahrten; ein Füllarbeit-Wechseltest widerlegte sie.) Darum:
 *
 * - Maß für „ruckelt“ sind die Bilder, die ihren Takt verpassen (frameClock.ts), gezählt über die letzten gut neun
 *   Sekunden (HORIZON Fenster): schon zwei davon sind ein spürbares Stottern (gut ein Dutzend je Minute). Gemessen
 *   wird nur während der Fahrt (nicht in Pause, Start- oder Ergebniskarte), die ersten Sekunden zählen nicht.
 * - Hinab nur, wenn ein Probebild zeigt, dass die Grafik über GPU_DOWN liegt (oder die Rechenzeit die Grenze ist):
 *   Ruckler bei kleiner Grafik (Hochladen, Hauptfaden) behebt kein Senken. Verpasst fast jedes Bild seinen Takt und
 *   die Grafik ist weit drüber, geht es zwei Schritte auf einmal und ohne das Ende des Fensters abzuwarten.
 * - Hinauf, sobald im Rückblick (fast) kein Bild zu spät kam und ein Probebild für den nächsten Schritt höchstens
 *   GPU_UP verspricht; danach Probezeit – zurück, sobald es wieder ruckelt und die Grafik über GPU_DOWN liegt. Nach einem
 *   Rückzieher dauert es bis zum nächsten Versuch doppelt so lang. Jeder Wechsel ruckelt selbst einmal.
 *
 * Je Spiel merkt sich das Gerät den letzten Stand je Wahl (Stufe und Auflösung): die nächste Fahrt beginnt dort,
 * statt erst wieder ins Ruckeln zu laufen. Für eine neue Wahl dient der Stand einer anderen als Anhalt (dieselbe
 * Pixeldichte). Ohne Three.js (das Menü zeigt den Stand).
 */
import { gfxAuto, gfxLevel, gfxOn, gfxRes } from './gfxOpts';
import { autoRangeDrop, rangeDropMax, setAutoRangeDrop, viewRange } from './viewRange';
import { setShadowEvery, shadowEveryN } from './shadowRate';

/** Auflösung: Faktoren auf die gewählte – höchstens bis zur Hälfte (2-fach → 1-fach) */
export const RES_STEPS = [1, 0.875, 0.75, 0.625, 0.5];
/** bis hierher (drei Viertel) zuerst die Auflösung, dann die Sichtweite, dann die Auflösung weiter */
const RES_FIRST = 2;
/** Schattenkarte: jedes n-te Bild je Schritt */
export const SHADOW_EVERY = [1, 2, 4];

/** Bilder je Urteil (bei 60 je Sekunde gut eine Sekunde) */
const WINDOW = 70;
/** so lange nach dem Start der Fahrt nicht urteilen (Shader, Landschaft rund um den Start) */
const WARMUP_S = 1.5;
/** Rückblick: so viele Urteile (gut 9 s) zählen die zu späten Bilder */
const HORIZON = 8;
/** ruckelt: mindestens so viele zu späte Bilder im Rückblick (gut ein Dutzend je Minute) */
const LATE_N = 2;
/** ruckelt deutlich: ab so vielen reicht ein kleineres Probebild zum Senken */
const LATE_MANY = 5;
/** hinauf nur, wenn im Rückblick höchstens so viele Bilder zu spät kamen (gut 6 je Minute – der Bodensatz auf dem iPhone) */
const LATE_UP = 1;
/** ab so viel vom laufenden Fenster zu spät: zwei Schritte auf einmal, und das Urteil fällt sofort */
const HEAVY = 0.5;
/**
 * Urteile seit dem letzten Wechsel vor dem ersten Versuch hinauf (gut 9 s); nach jedem Fehlschlag doppelt so viele
 * (höchstens MAX). Nicht kürzer: jeder Wechsel ruckelt selbst – zwischen Ort und freier Strecke hin und her wäre
 * schlimmer als eine etwas kleinere Auflösung
 */
const NEED0 = 8;
const NEED_MAX = 96;
/** nach „keine Luft“ höchstens so viele Urteile bis zum nächsten Probebild (gut 40 s) */
const NEED_ROOM_MAX = 32;
/**
 * Grafikzeit des Probebilds (Anteil des Bildtakts, 16,7 ms): hinab erst ab GPU_DOWN (9,2 ms); ruckelt es deutlich
 * oder verpasst fast jedes Bild den Takt, ab GPU_DOWN_MANY (8,3 – das Probebild zeigt ein einzelnes, oft leichteres
 * Bild; darunter liegt die Grafik im sauberen Bereich, dann ruckelt etwas anderes); zwei Schritte auf einmal ab
 * GPU_HEAVY; hinauf, wenn die Schätzung für den nächsten Schritt höchstens GPU_UP (7,5 ms) ergibt
 */
const GPU_DOWN = 0.55;
const GPU_DOWN_MANY = 0.5;
const GPU_HEAVY = 0.9;
const GPU_UP = 0.45;
const CPU_ROOM = 0.6;
/** Rechenzeit über so viel vom Bildtakt: die Grenze ist die Rechenzeit (Auflösung hilft nicht) */
const CPU_BOUND = 0.55;
/**
 * so lange gilt ein Probebild (s) – nicht öfter messen, jedes Probebild wartet einmal auf die Grafik. Sagt es „nicht
 * gesenkt“, gilt es doppelt so lange (bis PROBE_MAX_S): am Bodensatz zu später Bilder sonst alle paar Sekunden ein
 * Probebild, jedes ein kleiner Ruckler
 */
const PROBE_S = 6;
const PROBE_MAX_S = 60;
/** eine Stufe mehr Sichtweite kostet grob so viel mehr Grafik */
const RANGE_COST = 1.3;
/** die Schattenkarte wieder öfter: grob so viel mehr Grafik (ein Probebild ohne Schattendurchgang unterschätzt sie) */
const SHADOW_COST = 1.3;
/** nach einem Schritt hinauf: so viele Urteile Probezeit */
const TRIAL = 3;

/** Änderung (res, range, shadow) oder nur eine Notiz für die Messfahrt (info: zu spät, aber nichts geändert) */
export interface AutoChange { kind: 'res' | 'range' | 'shadow' | 'info'; text: string }
type Kind = 'res' | 'range' | 'shadow';

/** gespeicherter Stand je Wahl: Schritte (Auflösung, Sicht, Schatten) und die Pixeldichte, die dabei herauskam */
interface Stored { r: number; d: number; s?: number; e: number; t: number }
type Store = Record<string, Stored>;

// (auto2: Stände aus der fehlerhaften Prüfung „brachte nichts“ nicht übernehmen; auto3 je Wahl)
const storeKey = (scope: string) => `gruppetto.gfx.auto3.${scope}`;
const selKey = () => `${gfxLevel()}|${gfxRes()}`;
const MAX_STORED = 12;

function readStore(scope: string): Store {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(scope)) ?? 'null') as Store | null;
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

/** Auflösungsschritt, der (bei der gewählten Auflösung) höchstens die Pixeldichte e ergibt */
function stepFor(e: number): number {
  const base = gfxRes();
  for (let i = 0; i < RES_STEPS.length; i++) if (base * RES_STEPS[i] <= e * 1.05) return i;
  return RES_STEPS.length - 1;
}

/** Stand für die aktuelle Wahl – oder ein Anhalt aus einer anderen (dieselbe Pixeldichte; Sicht und Schatten nur bei gleicher Stufe) */
function load(scope: string): { r: number; d: number; s: number } | null {
  const st = readStore(scope);
  const own = st[selKey()];
  if (own) return { r: own.r, d: own.d, s: own.s ?? 0 };
  const level = `${gfxLevel()}|`;
  // am liebsten dieselbe Stufe, sonst der jüngste Stand
  let best: { v: Stored; same: boolean } | null = null;
  for (const [k, v] of Object.entries(st)) {
    const same = k.startsWith(level);
    if (!best || (same !== best.same ? same : v.t > best.v.t)) best = { v, same };
  }
  if (!best) return null;
  // (ganz oben gestanden: auch hier oben beginnen – die neue Auflösung ist die gewählte)
  if (best.v.r === 0 && best.v.d === 0 && !best.v.s) return null;
  return { r: stepFor(best.v.e), d: best.same ? best.v.d : 0, s: best.same ? best.v.s ?? 0 : 0 };
}

function save(scope: string, r: number, d: number, s: number) {
  try {
    const st = readStore(scope);
    st[selKey()] = { r, d, s, e: Math.round(gfxRes() * RES_STEPS[r] * 1000) / 1000, t: Date.now() };
    const keys = Object.keys(st).sort((a, b) => st[b].t - st[a].t);
    for (const k of keys.slice(MAX_STORED)) delete st[k];
    localStorage.setItem(storeKey(scope), JSON.stringify(st));
  } catch { /* egal */ }
}

// ------------------------------------------------------------------ Stand fürs Menü

export interface AutoView { on: boolean; res: number; range: string; shadow: number; reduced: boolean }
let view: AutoView = { on: false, res: 1, range: '', shadow: 1, reduced: false };
const viewSubs = new Set<() => void>();
/** was die Automatik gerade eingestellt hat (Pausenmenü); shadow: Schattenkarte jedes n-te Bild */
export function autoView(): AutoView { return view; }
export function onAutoView(f: () => void): () => void { viewSubs.add(f); return () => { viewSubs.delete(f); }; }
function publish(v: AutoView) {
  view = v;
  for (const f of [...viewSubs]) { try { f(); } catch (e) { console.error(e); } }
}

/** Pixeldichte in Worten: „1,75-fach“ */
export function fmtRes(d: number): string {
  return `${(Math.round(d * 100) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 })}-fach`;
}

const shadowText = (every: number) => (every <= 1 ? 'jedes Bild' : `alle ${every} Bilder`);

// ------------------------------------------------------------------ Regler

/** der Regler, dem Sichtweite und Schattenkarte gerade gehören (es gibt nur eine, viewRange.ts / weather.ts) */
let owner: AutoGfx | null = null;
/** Automatik ausgesetzt (Wechseltest der Messfahrt stellt Auflösung oder Last selbst) */
let suspended = false;
export function setAutoSuspended(on: boolean) { suspended = on; }

export class AutoGfx {
  /** Auflösungsschritt (Index in RES_STEPS) */
  res = 0;
  /** um so viele Stufen kürzere Sichtweite */
  range = 0;
  /** Schattenkarte: Schritt in SHADOW_EVERY */
  shadow = 0;
  private warm = 0;
  private n = 0;
  private late = 0;
  /** Summe der echten Bildabstände im Fenster (s) */
  private sum = 0;
  private cpu: number[] = [];
  /** Rückblick: zu späte Bilder und Dauer (s) der letzten Fenster */
  private ring: { late: number; s: number }[] = [];
  /** Urteile seit dem letzten Wechsel */
  private since = 0;
  private need = NEED0;
  private settle = 0;
  private trial: { kind: Kind; left: number } | null = null;
  /** ruckelt: Urteil wartet auf ein Probebild */
  private pending: { frac: number; recent: number; cpuMed: number; excess: number } | null = null;
  private lastInfo = -1e9;
  private t = 0;
  private probeAsk = false;
  /** letztes Probebild (ms Grafikzeit) und wann (Fahrzeit, s) */
  private gpu: number | null = null;
  private gpuT = -1e9;
  private probeFor = PROBE_S;
  /** zu späte Bilder im Rückblick beim letzten „nicht gesenkt“: deutlich mehr verlangt ein neues Probebild */
  private infoRecent = 0;
  /** Grafikzeit beim letzten „keine Luft“: deutlich weniger heißt, die Lage hat sich geändert – bald wieder probieren */
  private roomGpu = 0;

  constructor(private readonly scope: string) {
    this.reset(true);
  }

  /** Faktor auf die gewählte Auflösung */
  get quality(): number { return RES_STEPS[this.res]; }
  /** Schattenkarte jedes n-te Bild */
  get shadowEvery(): number { return SHADOW_EVERY[this.shadow]; }

  /**
   * neue Wahl (Stufe, Auflösung, Automatik an/aus) oder neue Fahrt: Stand der Wahl laden (oder voll beginnen) und
   * anwenden; liefert true, wenn sich die Auflösung dadurch ändert
   */
  reset(fromStore = false): boolean {
    const q0 = this.quality;
    const st = fromStore && gfxAuto() ? load(this.scope) : null;
    this.res = st ? Math.max(0, Math.min(RES_STEPS.length - 1, st.r)) : 0;
    this.range = st ? Math.max(0, Math.min(rangeDropMax(), st.d)) : 0;
    this.shadow = st && gfxOn('schatten') ? Math.max(0, Math.min(SHADOW_EVERY.length - 1, st.s)) : 0;
    this.warm = 0;
    this.n = 0;
    this.late = 0;
    this.sum = 0;
    this.cpu = [];
    this.ring = [];
    this.since = 0;
    this.need = NEED0;
    this.settle = 0;
    this.trial = null;
    this.pending = null;
    this.probeAsk = false;
    this.gpu = null;
    this.gpuT = -1e9;
    this.probeFor = PROBE_S;
    this.infoRecent = 0;
    this.roomGpu = 0;
    owner = this;
    setAutoRangeDrop(this.range);
    setShadowEvery(this.shadowEvery);
    this.show();
    return this.quality !== q0;
  }

  /** soll das nächste Bild die Grafikzeit messen (ein Probebild; wartet einmal auf die Grafik)? */
  wantProbe(): boolean { return this.probeAsk; }
  /** Ergebnis des Probebilds (ms Grafikzeit) */
  setProbe(ms: number) { this.probeAsk = false; this.gpu = ms; this.gpuT = this.t; }

  /**
   * ein gezeichnetes Bild. missed: hat es seinen Takt verpasst (frameClock); target: Bildtakt (ms); cpu: Rechenzeit
   * dieses Bildes (ms); dt: echter Abstand zum vorigen (s); active: Fahrt läuft (nicht Pause, Start, Ergebnis).
   * Liefert eine Änderung oder null. Sichtweite und Schattenkarte stellt der Regler selbst um; die Auflösung
   * übernimmt der Aufrufer (renderer.setQuality(quality) – wirkt direkt vor dem nächsten Bild).
   */
  frame(missed: boolean, target: number, cpu: number, dt: number, active: boolean): AutoChange | null {
    if (!gfxAuto() || suspended || !active || !(dt > 0) || dt > 0.25) return null;
    // Sichtweite und Schattenkarte gehören dem Regler des laufenden Spiels: hat sie jemand anderes verstellt (ein
    // Spiel, das sich erst nach diesem verabschiedet hat; ein Wechseltest), wieder auf den eigenen Stand
    if (owner !== this || autoRangeDrop() !== Math.min(this.range, rangeDropMax())) { owner = this; setAutoRangeDrop(this.range); }
    if (shadowEveryN() !== this.shadowEvery) setShadowEvery(this.shadowEvery);
    if (this.warm < WARMUP_S) { this.warm += dt; return null; }
    this.t += dt;
    const frame = Math.max(target, 1000 / 60);
    // ein Urteil wartet auf sein Probebild: jetzt entscheiden
    if (this.pending && this.gpu !== null && !this.probeAsk) {
      const p = this.pending;
      this.pending = null;
      return this.down(p.frac, p.recent, p.cpuMed, p.excess, frame);
    }
    this.n += 1;
    // im 120er-Takt (Gerät schafft mehr als 60 je Sekunde) zählt ein verpasster Takt nicht
    if (missed && target >= 15) this.late += 1;
    this.sum += dt;
    this.cpu.push(cpu);
    // Fenster voll – oder schon mehr als die Hälfte davon zu spät (dann nicht erst abwarten)
    if (this.n < WINDOW && this.late < WINDOW * HEAVY) return null;
    const frac = this.late / this.n;
    // mittlere Bildzeit über dem Takt (ms): wie weit die Bilder im Schnitt zu spät kommen
    const excess = Math.max(0, (this.sum / this.n) * 1000 - frame);
    const cs = this.cpu.sort((a, b) => a - b);
    const cpuMed = cs[cs.length >> 1];
    // (das erste Fenster nach einem Wechsel zählt nicht: der Wechsel selbst ruckelt)
    if (this.settle > 0) this.settle -= 1;
    else this.ring.push({ late: this.late, s: this.sum });
    if (this.ring.length > HORIZON) this.ring.shift();
    this.n = 0;
    this.late = 0;
    this.sum = 0;
    this.cpu = [];
    let recent = 0, secs = 0;
    for (const w of this.ring) { recent += w.late; secs += w.s; }
    this.since += 1;
    // Schritt hinauf gehalten
    if (this.trial && --this.trial.left <= 0) { this.trial = null; this.need = NEED0; }

    if (frac >= HEAVY || recent >= LATE_N) {
      this.pending = null;
      // Rechenzeit die Grenze: gleich senken; sonst erst ein Probebild (ein frisches genügt) – Ruckler bei kleiner
      // Grafik (Hochladen, Hauptfaden) sind kein Grund zu senken. Ein altes Probebild gilt nur, solange es nicht
      // deutlich schlimmer wurde – das Telefon drosselt mitten in der Fahrt, dann muss ein neues her
      const maxAge = frac >= HEAVY ? 1 : recent >= LATE_MANY || recent > this.infoRecent * 1.5 + 1 ? PROBE_S : this.probeFor;
      const freshProbe = this.gpu !== null && this.t - this.gpuT <= maxAge;
      if (cpuMed >= CPU_BOUND * frame || freshProbe) return this.down(frac, recent, cpuMed, excess, frame);
      this.pending = { frac, recent, cpuMed, excess };
      this.probeAsk = true;
      return null;
    }

    // ruhig: hinauf? Erst ein Probebild, dann entscheiden – nur, wenn der ganze Rückblick (fast) ohne zu spätes
    // Bild war; geht es dann doch schief, nimmt down() den Schritt zurück und der nächste Versuch wartet doppelt so lang
    const kind = this.kindUp();
    if (!kind) return null;
    if (this.since < this.need || recent > LATE_UP || secs < 5) return null;
    if (this.gpu === null || this.t - this.gpuT > PROBE_S) { this.probeAsk = true; return null; }
    const gpu = this.gpu;
    this.gpu = null;
    // seit dem letzten „keine Luft“ deutlich leichter (das Telefon ist wieder kühl): nicht länger warten
    if (this.roomGpu && gpu < this.roomGpu * 0.7) this.need = NEED0;
    const est = kind === 'range' ? gpu * RANGE_COST : kind === 'shadow' ? gpu * SHADOW_COST : gpu * (RES_STEPS[this.res - 1] / RES_STEPS[this.res]) ** 2;
    const cpuNext = kind === 'range' ? cpuMed * 1.15 : cpuMed;
    if (est > GPU_UP * frame || cpuNext > CPU_ROOM * frame) {
      // (noch) keine Luft: später wieder messen
      this.need = Math.min(NEED_ROOM_MAX, this.need * 2);
      this.roomGpu = gpu;
      this.since = 0;
      return null;
    }
    this.trial = { kind, left: TRIAL };
    const why = `Luft: Grafik ${gpu.toFixed(1)} ms, nächster Schritt etwa ${est.toFixed(1)} ms`;
    return this.step(kind, -1, why);
  }

  /** nächster Schritt hinab (null: nichts mehr zu senken). Rechenzeit die Grenze: zuerst die Sichtweite */
  private kindDown(cpuBound: boolean): Kind | null {
    const canRange = this.range < rangeDropMax();
    const canShadow = gfxOn('schatten');
    if (!cpuBound && this.res < RES_FIRST) return 'res';
    if (canRange) return 'range';
    if (canShadow && this.shadow < 1) return 'shadow';
    if (this.res < RES_STEPS.length - 1) return 'res';
    if (canShadow && this.shadow < SHADOW_EVERY.length - 1) return 'shadow';
    return null;
  }

  /** nächster Schritt hinauf: die Folge von kindDown rückwärts (null: schon ganz oben) */
  private kindUp(): Kind | null {
    if (this.shadow >= 2) return 'shadow';
    if (this.res > RES_FIRST) return 'res';
    if (this.shadow >= 1) return 'shadow';
    if (this.range > 0) return 'range';
    if (this.res > 0) return 'res';
    return null;
  }

  /** ruckelt: was senken? (frac: Anteil zu später Bilder im Fenster, recent: zu späte Bilder im Rückblick) */
  private down(frac: number, recent: number, cpuMed: number, excess: number, frame: number): AutoChange | null {
    const pct = frac >= HEAVY ? `${Math.round(frac * 100)} % der Bilder zu spät` : `${recent} zu späte Bilder in ${HORIZON} Fenstern`;
    const cpuBound = cpuMed >= CPU_BOUND * frame;
    // die Grafik nicht über der Grenze: das liegt nicht an Auflösung, Sichtweite oder Schatten – nichts senken
    const gate = frac >= HEAVY || recent >= LATE_MANY ? GPU_DOWN_MANY : GPU_DOWN;
    if (!cpuBound && (this.gpu === null || this.gpu < gate * frame)) {
      this.probeFor = Math.min(PROBE_MAX_S, this.probeFor * 2);
      this.infoRecent = recent;
      if (this.t - this.lastInfo < 10) return null;
      this.lastInfo = this.t;
      return { kind: 'info', text: `${pct}, Grafik nur ${this.gpu === null ? '?' : this.gpu.toFixed(1)} ms, Rechnen ${cpuMed.toFixed(1)} ms – nicht gesenkt` };
    }
    const kind = this.kindDown(cpuBound);
    if (!kind) {
      // nichts mehr zu senken: nur notieren, höchstens alle 10 s
      if (this.t - this.lastInfo < 10) return null;
      this.lastInfo = this.t;
      return { kind: 'info', text: `${pct}, Grafik ${this.gpu === null ? '?' : this.gpu.toFixed(1)} ms, Rechnen ${cpuMed.toFixed(1)} ms – nichts mehr zu senken` };
    }
    // weit daneben und die Grafik deutlich über dem Takt: zwei Schritte auf einmal
    const k = kind !== 'shadow' && frac >= HEAVY && (cpuBound || (this.gpu !== null && this.gpu >= GPU_HEAVY * frame)) ? 2 : 1;
    let why = `${pct}, im Schnitt ${excess.toFixed(1)} ms zu spät, Rechnen ${cpuMed.toFixed(1)} ms${this.gpu !== null ? `, Grafik ${this.gpu.toFixed(1)} ms` : ''}`;
    // eben erst hinauf: zurück, und bis zum nächsten Versuch doppelt so lange Ruhe
    if (this.trial) {
      this.trial = null;
      this.need = Math.min(NEED_MAX, this.need * 2);
      why = `zurück – ${why}`;
    }
    return this.step(kind, k, why);
  }

  /** einen Schritt (dir < 0: hinauf) in einer Art gehen; hinab in der Auflösung nur bis zur Grenze der Phase */
  private step(kind: Kind, dir: number, why: string): AutoChange {
    if (kind === 'res') {
      const from = gfxRes() * this.quality;
      // Phase 1 (Sichtweite noch nicht ganz kurz): nur bis drei Viertel; hinauf bis ganz oben
      const to = dir > 0 && this.range < rangeDropMax() ? RES_FIRST : RES_STEPS.length - 1;
      this.res = Math.max(0, Math.min(Math.max(to, this.res), this.res + dir));
      this.after(kind);
      return { kind, text: `Auflösung ${fmtRes(from)} → ${fmtRes(gfxRes() * this.quality)} (${why})` };
    }
    if (kind === 'range') {
      const from = viewRange().label;
      this.range = Math.max(0, Math.min(rangeDropMax(), this.range + dir));
      owner = this;
      setAutoRangeDrop(this.range);
      this.after(kind);
      return { kind, text: `Sichtweite ${from} → ${viewRange().label} (${why})` };
    }
    const from = this.shadowEvery;
    this.shadow = Math.max(0, Math.min(SHADOW_EVERY.length - 1, this.shadow + Math.sign(dir)));
    owner = this;
    setShadowEvery(this.shadowEvery);
    this.after(kind);
    return { kind, text: `Schattenkarte ${shadowText(from)} → ${shadowText(this.shadowEvery)} (${why})` };
  }

  private after(kind: Kind) {
    // (ein Probebild von vor dem Wechsel sagt nichts mehr; der Wechsel selbst ruckelt – das erste Fenster danach
    // zählt nicht, der Umbau der Landschaft braucht zwei)
    this.gpu = null;
    this.probeFor = PROBE_S;
    this.infoRecent = 0;
    this.roomGpu = 0;
    this.since = 0;
    this.ring = [];
    this.settle = kind === 'range' ? 2 : 1;
    save(this.scope, this.res, this.range, this.shadow);
    this.show();
  }

  private show() {
    publish({ on: gfxAuto(), res: gfxRes() * this.quality, range: viewRange().label, shadow: this.shadowEvery, reduced: this.res > 0 || this.range > 0 || this.shadow > 0 });
  }

  /** Spiel verlassen: Sichtweite und Schattenkarte wieder wie gewählt (die Bühne wird für andere Spiele vorgewärmt) –
   *  nur, wenn kein anderes Spiel sie inzwischen übernommen hat */
  dispose() {
    if (owner !== this) return;
    owner = null;
    setAutoRangeDrop(0);
    setShadowEvery(1);
    publish({ on: gfxAuto(), res: gfxRes(), range: viewRange().label, shadow: 1, reduced: false });
  }
}

// ------------------------------------------------------------------ in der Spielschleife

/** was autoStep vom Renderer braucht (ohne Three.js zu laden) */
interface AutoTarget { quality: number; setQuality(q: number): void; probeNext: boolean; gpuProbe: number | null }

/**
 * je gezeichnetem Bild aus der Spielschleife: Probebild abholen, Automatik füttern, eine neue Auflösung übernehmen
 * (wirkt vor dem nächsten Bild), das nächste Probebild anstoßen. log: Messfahrt (Auflösung: 'res', Sichtweite: 'range')
 */
export function autoStep(gov: AutoGfx, r: AutoTarget, clock: { slip: number; target: number }, cpu: number, raw: number, active: boolean,
  log: ((ch: AutoChange) => void) | null) {
  if (r.gpuProbe !== null) { gov.setProbe(r.gpuProbe); r.gpuProbe = null; }
  const ch = gov.frame(clock.slip > 0, clock.target, cpu, raw, active);
  if (ch) {
    if (ch.kind === 'res') r.setQuality(gov.quality);
    log?.(ch);
  }
  if (gov.wantProbe()) r.probeNext = true;
}
