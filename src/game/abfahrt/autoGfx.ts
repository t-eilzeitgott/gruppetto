/**
 * Automatik für Auflösung und Sichtweite der 3D-Spiele. Die Schieberegler (gfxOpts.ts) sind die Obergrenze: reicht die
 * Leistung nicht für 60 Bilder je Sekunde, senkt die Automatik im Spiel
 *
 *   1. die Auflösung in zwei Schritten bis auf drei Viertel der gewählten (2-fach → 1,75 → 1,5-fach) – das hilft, wenn
 *      die Grafik das Limit ist (auf dem iPhone fast immer), und kostet keinen Umbau der Welt;
 *   2. danach die Sichtweite Stufe für Stufe bis zur kürzesten („Einfach“);
 *   3. reicht auch das nicht, die Auflösung weiter bis auf die Hälfte der gewählten (2-fach → 1,25 → 1-fach).
 *
 * Ist die Rechenzeit die Grenze, hilft die Auflösung nicht – dann gleich die Sichtweite.
 *
 * Ziel ist nicht die kleinste Grafik, sondern eine Grafikzeit von etwa der Hälfte bis drei Vierteln des Takts
 * (8–13 ms Probebild bei 16,7 ms). Messfahrten (Version 255–258) zeigten: bei 12–13 ms Grafik kamen die wenigsten
 * Bilder zu spät (32 Ruckler in 150 s), bei 6–8 ms auf der kleinsten Stufe dagegen 80–200 – in Schüben an denselben
 * Streckenstellen, bei freiem Hauptfaden, ohne Hochladen oder neue Shader. Das iPhone taktet seine Grafik bei
 * kleiner Last herunter und verpasst dann gerade die leichten Bilder; mehr Last hält den Takt oben. Darum:
 *
 * - Hinab nur, wenn ein Probebild zeigt, dass die Grafik über GPU_DOWN liegt (oder die Rechenzeit die Grenze ist) –
 *   egal, wie viele Bilder zu spät kamen. Verpasst fast jedes Bild seinen Takt und die Grafik ist weit drüber, geht
 *   es zwei Schritte auf einmal und ohne das Ende des Fensters abzuwarten (vom Start bis zur passenden Stufe wenige
 *   Sekunden statt fast einer Minute). Früher wurde jeder Schritt hinab geprüft („brachte nichts“ → zurück, Art
 *   gesperrt); das scheiterte am Rauschen und daran, dass das Telefon seinen Takt mitten in der Fahrt ändert.
 * - Hinauf, sobald eine Weile wenig zu spät kam und ein Probebild für den nächsten Schritt höchstens GPU_UP
 *   verspricht; danach Probezeit – zurück nur, wenn ein Probebild dann wirklich über GPU_DOWN liegt (ein Schub
 *   später Bilder bei kleiner Grafik ist kein Grund). Nach einem Rückzieher dauert es bis zum nächsten Versuch
 *   doppelt so lang.
 *
 * Maß für „zu spät“ sind die Bilder, die ihren Takt verpassen (frameClock.ts); gemessen wird nur während der Fahrt
 * (nicht in Pause, Start- oder Ergebniskarte), die ersten Sekunden zählen nicht.
 *
 * Je Spiel merkt sich das Gerät den letzten Stand je Wahl (Stufe und Auflösung): die nächste Fahrt beginnt dort,
 * statt erst wieder ins Ruckeln zu laufen. Für eine neue Wahl dient der Stand einer anderen als Anhalt (dieselbe
 * Pixeldichte). Ohne Three.js (das Menü zeigt den Stand).
 */
import { gfxAuto, gfxLevel, gfxRes } from './gfxOpts';
import { autoRangeDrop, rangeDropMax, setAutoRangeDrop, viewRange } from './viewRange';

/** Auflösung: Faktoren auf die gewählte – höchstens bis zur Hälfte (2-fach → 1-fach) */
export const RES_STEPS = [1, 0.875, 0.75, 0.625, 0.5];
/** bis hierher (drei Viertel) zuerst die Auflösung, dann die Sichtweite, dann die Auflösung weiter */
const RES_FIRST = 2;

/** Bilder je Urteil (bei 60 je Sekunde gut eine Sekunde) */
const WINDOW = 70;
/** so lange nach dem Start der Fahrt nicht urteilen (Shader, Landschaft rund um den Start) */
const WARMUP_S = 1.5;
/** zu langsam: mehr als so viele Bilder eines Fensters verpassen ihren Takt (jedes zwölfte – ein spürbares Stottern) */
const SLOW = 0.08;
/** hinauf nur, wenn im gleitenden Mittel der Fenster höchstens so viele zu spät kamen */
const SLOW_UP = 0.15;
/** ab so vielen zu späten Bildern: zwei Schritte auf einmal, und das Urteil fällt, sobald so viel vom Fenster zu spät ist */
const HEAVY = 0.5;
/**
 * Urteile seit dem letzten Wechsel vor dem ersten Versuch hinauf (gut 9 s); nach jedem Fehlschlag doppelt so viele
 * (höchstens MAX). Nicht kürzer: jeder Wechsel der Auflösung ruckelt selbst – zwischen Ort und freier Strecke hin
 * und her wäre schlimmer als eine etwas kleinere Auflösung
 */
const NEED0 = 8;
const NEED_MAX = 96;
/** nach „keine Luft“ höchstens so viele Urteile bis zum nächsten Probebild (gut 40 s) */
const NEED_ROOM_MAX = 32;
/**
 * Grafikzeit des Probebilds (Anteil des Bildtakts): hinab erst ab GPU_DOWN; zwei Schritte auf einmal ab GPU_HEAVY;
 * hinauf, wenn die Schätzung für den nächsten Schritt höchstens GPU_UP ergibt. Dazwischen (8–13 ms) bleibt es –
 * dort läuft das iPhone am rundesten (siehe oben)
 */
const GPU_DOWN = 0.78;
/** verpasst mehr als ein Viertel / mehr als die Hälfte der Bilder den Takt, reicht entsprechend weniger im Probebild
 *  (es zeigt ein einzelnes Bild, oft ein leichteres als die zu späten) */
const GPU_DOWN_MANY = 0.7;
const GPU_DOWN_HEAVY = 0.6;
const GPU_HEAVY = 0.9;
const GPU_UP = 0.7;
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
/** nach einem Schritt hinauf: so viele Urteile Probezeit */
const TRIAL = 3;

/** Änderung (res, range) oder nur eine Notiz für die Messfahrt (info: zu spät, aber nichts geändert) */
export interface AutoChange { kind: 'res' | 'range' | 'info'; text: string }

/** gespeicherter Stand je Wahl: Schritte und die Pixeldichte, die dabei herauskam */
interface Stored { r: number; d: number; e: number; t: number }
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

/** Stand für die aktuelle Wahl – oder ein Anhalt aus einer anderen (dieselbe Pixeldichte; die Sicht nur bei gleicher Stufe) */
function load(scope: string): { r: number; d: number } | null {
  const st = readStore(scope);
  const own = st[selKey()];
  if (own) return { r: own.r, d: own.d };
  const level = `${gfxLevel()}|`;
  // am liebsten dieselbe Stufe, sonst der jüngste Stand
  let best: { v: Stored; same: boolean } | null = null;
  for (const [k, v] of Object.entries(st)) {
    const same = k.startsWith(level);
    if (!best || (same !== best.same ? same : v.t > best.v.t)) best = { v, same };
  }
  if (!best) return null;
  // (ganz oben gestanden: auch hier oben beginnen – die neue Auflösung ist die gewählte)
  if (best.v.r === 0 && best.v.d === 0) return null;
  return { r: stepFor(best.v.e), d: best.same ? best.v.d : 0 };
}

function save(scope: string, r: number, d: number) {
  try {
    const st = readStore(scope);
    st[selKey()] = { r, d, e: Math.round(gfxRes() * RES_STEPS[r] * 1000) / 1000, t: Date.now() };
    const keys = Object.keys(st).sort((a, b) => st[b].t - st[a].t);
    for (const k of keys.slice(MAX_STORED)) delete st[k];
    localStorage.setItem(storeKey(scope), JSON.stringify(st));
  } catch { /* egal */ }
}

// ------------------------------------------------------------------ Stand fürs Menü

export interface AutoView { on: boolean; res: number; range: string; reduced: boolean }
let view: AutoView = { on: false, res: 1, range: '', reduced: false };
const viewSubs = new Set<() => void>();
/** was die Automatik gerade eingestellt hat (Pausenmenü) */
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

// ------------------------------------------------------------------ Regler

/** der Regler, dem die Sichtweite gerade gehört (es gibt nur eine, viewRange.ts) */
let owner: AutoGfx | null = null;
/** Automatik ausgesetzt (Wechseltest der Messfahrt stellt Auflösung oder Last selbst) */
let suspended = false;
export function setAutoSuspended(on: boolean) { suspended = on; }

export class AutoGfx {
  /** Auflösungsschritt (Index in RES_STEPS) */
  res = 0;
  /** um so viele Stufen kürzere Sichtweite */
  range = 0;
  private warm = 0;
  private n = 0;
  private late = 0;
  /** Summe der echten Bildabstände im Fenster (s) */
  private sum = 0;
  private cpu: number[] = [];
  /** gleitendes Mittel des Anteils zu später Bilder je Fenster (−1: noch keins) */
  private lateAvg = -1;
  /** Urteile seit dem letzten Wechsel */
  private since = 0;
  private need = NEED0;
  private settle = 0;
  private trial: { kind: 'res' | 'range'; left: number } | null = null;
  /** leicht zu spät: Urteil wartet auf ein Probebild */
  private pending: { frac: number; cpuMed: number; excess: number } | null = null;
  private lastInfo = -1e9;
  private t = 0;
  private probeAsk = false;
  /** letztes Probebild (ms Grafikzeit) und wann (Fahrzeit, s) */
  private gpu: number | null = null;
  private gpuT = -1e9;
  private probeFor = PROBE_S;
  /** Anteil zu später Bilder beim letzten „nicht gesenkt“: deutlich mehr verlangt ein neues Probebild */
  private infoFrac = 0;
  /** Grafikzeit beim letzten „keine Luft“: deutlich weniger heißt, die Lage hat sich geändert – bald wieder probieren */
  private roomGpu = 0;

  constructor(private readonly scope: string) {
    this.reset(true);
  }

  /** Faktor auf die gewählte Auflösung */
  get quality(): number { return RES_STEPS[this.res]; }

  /**
   * neue Wahl (Stufe, Auflösung, Automatik an/aus) oder neue Fahrt: Stand der Wahl laden (oder voll beginnen) und
   * anwenden; liefert true, wenn sich die Auflösung dadurch ändert
   */
  reset(fromStore = false): boolean {
    const q0 = this.quality;
    const st = fromStore && gfxAuto() ? load(this.scope) : null;
    this.res = st ? Math.max(0, Math.min(RES_STEPS.length - 1, st.r)) : 0;
    this.range = st ? Math.max(0, Math.min(rangeDropMax(), st.d)) : 0;
    this.warm = 0;
    this.n = 0;
    this.late = 0;
    this.sum = 0;
    this.cpu = [];
    this.lateAvg = -1;
    this.since = 0;
    this.need = NEED0;
    this.settle = 0;
    this.trial = null;
    this.pending = null;
    this.probeAsk = false;
    this.gpu = null;
    this.gpuT = -1e9;
    this.probeFor = PROBE_S;
    this.infoFrac = 0;
    this.roomGpu = 0;
    owner = this;
    setAutoRangeDrop(this.range);
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
   * Liefert eine Änderung oder null. Die Sichtweite stellt der Regler selbst um; die Auflösung übernimmt der Aufrufer
   * (renderer.setQuality(quality) – wirkt direkt vor dem nächsten Bild).
   */
  frame(missed: boolean, target: number, cpu: number, dt: number, active: boolean): AutoChange | null {
    if (!gfxAuto() || suspended || !active || !(dt > 0) || dt > 0.25) return null;
    // die Sichtweite gehört dem Regler des laufenden Spiels: hat sie jemand anderes zurückgesetzt (ein Spiel, das
    // sich erst nach diesem verabschiedet hat), wieder auf den eigenen Stand
    if (owner !== this || autoRangeDrop() !== Math.min(this.range, rangeDropMax())) { owner = this; setAutoRangeDrop(this.range); }
    if (this.warm < WARMUP_S) { this.warm += dt; return null; }
    this.t += dt;
    const frame = Math.max(target, 1000 / 60);
    // ein Urteil wartet auf sein Probebild: jetzt entscheiden
    if (this.pending && this.gpu !== null && !this.probeAsk) {
      const p = this.pending;
      this.pending = null;
      return this.down(p.frac, p.cpuMed, p.excess, frame);
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
    this.n = 0;
    this.late = 0;
    this.sum = 0;
    this.cpu = [];
    this.lateAvg = this.lateAvg < 0 ? frac : this.lateAvg + (frac - this.lateAvg) * 0.3;
    this.since += 1;
    if (this.settle > 0) { this.settle -= 1; return null; }
    // Schritt hinauf gehalten
    if (this.trial && --this.trial.left <= 0) { this.trial = null; this.need = NEED0; }

    if (frac > SLOW) {
      this.pending = null;
      // Rechenzeit die Grenze: gleich senken; sonst erst ein Probebild (ein frisches genügt) – auch wenn fast jedes
      // Bild zu spät kommt: Schübe später Bilder bei kleiner Grafik (siehe oben) sind kein Grund zu senken
      // (Messfahrt 256: „2,25 → 1,97-fach (26 %)“ bei 6 ms Grafik)
      // (ein altes Probebild gilt nur, solange es nicht deutlich schlimmer wurde – das Telefon drosselt mitten in der
      // Fahrt, dann muss ein neues her)
      const maxAge = frac >= HEAVY ? 1 : frac >= 0.25 || frac > this.infoFrac * 1.5 + 0.05 ? PROBE_S : this.probeFor;
      const fresh = this.gpu !== null && this.t - this.gpuT <= maxAge;
      if (cpuMed >= CPU_BOUND * frame || fresh) return this.down(frac, cpuMed, excess, frame);
      this.pending = { frac, cpuMed, excess };
      this.probeAsk = true;
      return null;
    }

    // ruhig genug: hinauf? Erst ein Probebild, dann entscheiden
    if (!this.res && !this.range) return null;
    if (this.since < this.need || this.lateAvg > SLOW_UP) return null;
    if (this.gpu === null || this.t - this.gpuT > PROBE_S) { this.probeAsk = true; return null; }
    const gpu = this.gpu;
    this.gpu = null;
    // seit dem letzten „keine Luft“ deutlich leichter (das Telefon ist wieder kühl): nicht länger warten
    if (this.roomGpu && gpu < this.roomGpu * 0.7) this.need = NEED0;
    // umgekehrte Folge: erst die Auflösung bis drei Viertel, dann die Sichtweite, dann die Auflösung ganz
    const kind: 'res' | 'range' = this.res > RES_FIRST || !this.range ? 'res' : 'range';
    const est = kind === 'range' ? gpu * RANGE_COST : gpu * (RES_STEPS[this.res - 1] / RES_STEPS[this.res]) ** 2;
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
    return kind === 'range' ? this.stepRange(-1, why) : this.stepRes(-1, why);
  }

  /** zu spät: was senken? (frac: Anteil zu später Bilder im Fenster) */
  private down(frac: number, cpuMed: number, excess: number, frame: number): AutoChange | null {
    const pct = `${Math.round(frac * 100)} % der Bilder zu spät`;
    const cpuBound = cpuMed >= CPU_BOUND * frame;
    // die Grafik nicht über der Grenze: das liegt nicht an Auflösung oder Sichtweite – nichts senken
    const gate = frac >= HEAVY ? GPU_DOWN_HEAVY : frac >= 0.25 ? GPU_DOWN_MANY : GPU_DOWN;
    if (!cpuBound && (this.gpu === null || this.gpu < gate * frame)) {
      this.probeFor = Math.min(PROBE_MAX_S, this.probeFor * 2);
      this.infoFrac = frac;
      if (this.t - this.lastInfo < 10) return null;
      this.lastInfo = this.t;
      return { kind: 'info', text: `${pct}, Grafik nur ${this.gpu === null ? '?' : this.gpu.toFixed(1)} ms, Rechnen ${cpuMed.toFixed(1)} ms – nicht gesenkt` };
    }
    const canRange = this.range < rangeDropMax();
    // die Grafik (mit dem Zusammensetzen des Bildschirms) ist fast immer die Grenze: zuerst die Auflösung bis drei
    // Viertel, dann die Sichtweite, dann die Auflösung weiter; ist es die Rechenzeit, zuerst die Sichtweite
    const resTo = canRange ? RES_FIRST : RES_STEPS.length - 1;
    const kind: 'res' | 'range' | null = !cpuBound && this.res < RES_FIRST ? 'res' : canRange ? 'range' : this.res < resTo ? 'res' : null;
    if (!kind) {
      // nichts mehr zu senken: nur notieren, höchstens alle 10 s
      if (this.t - this.lastInfo < 10) return null;
      this.lastInfo = this.t;
      return { kind: 'info', text: `${pct}, Grafik ${this.gpu === null ? '?' : this.gpu.toFixed(1)} ms, Rechnen ${cpuMed.toFixed(1)} ms – nichts mehr zu senken` };
    }
    // weit daneben und die Grafik deutlich über dem Takt: zwei Schritte auf einmal
    const k = frac >= HEAVY && (cpuBound || (this.gpu !== null && this.gpu >= GPU_HEAVY * frame)) ? 2 : 1;
    let why = `${pct}, im Schnitt ${excess.toFixed(1)} ms zu spät, Rechnen ${cpuMed.toFixed(1)} ms${this.gpu !== null ? `, Grafik ${this.gpu.toFixed(1)} ms` : ''}`;
    // eben erst hinauf: zurück, und bis zum nächsten Versuch doppelt so lange Ruhe
    if (this.trial) {
      this.trial = null;
      this.need = Math.min(NEED_MAX, this.need * 2);
      why = `zurück – ${why}`;
    }
    return kind === 'res' ? this.stepRes(k, why, resTo) : this.stepRange(k, why);
  }

  private stepRes(dir: number, why: string, to = RES_STEPS.length - 1): AutoChange {
    const from = gfxRes() * this.quality;
    // hinab höchstens bis to (Phase 1: drei Viertel), hinauf bis ganz oben
    const hi = dir > 0 ? Math.max(to, this.res) : RES_STEPS.length - 1;
    this.res = Math.max(0, Math.min(hi, this.res + dir));
    // (die neue Leinwand selbst ruckelt ein Bild lang – das verfälscht kein Fenster)
    this.settle = 0;
    this.after();
    return { kind: 'res', text: `Auflösung ${fmtRes(from)} → ${fmtRes(gfxRes() * this.quality)} (${why})` };
  }

  private stepRange(dir: number, why: string): AutoChange {
    const from = viewRange().label;
    this.range = Math.max(0, Math.min(rangeDropMax(), this.range + dir));
    owner = this;
    setAutoRangeDrop(this.range);
    // (der Umbau der Landschaft ruckelt selbst: ein Urteil abwarten)
    this.settle = 1;
    this.after();
    return { kind: 'range', text: `Sichtweite ${from} → ${viewRange().label} (${why})` };
  }

  private after() {
    // (ein Probebild von vor dem Wechsel sagt nichts mehr)
    this.gpu = null;
    this.probeFor = PROBE_S;
    this.infoFrac = 0;
    this.roomGpu = 0;
    this.since = 0;
    save(this.scope, this.res, this.range);
    this.show();
  }

  private show() {
    publish({ on: gfxAuto(), res: gfxRes() * this.quality, range: viewRange().label, reduced: this.res > 0 || this.range > 0 });
  }

  /** Spiel verlassen: Sichtweite wieder wie gewählt (die Bühne wird für andere Spiele vorgewärmt) – nur, wenn kein
   *  anderes Spiel sie inzwischen übernommen hat */
  dispose() {
    if (owner !== this) return;
    owner = null;
    setAutoRangeDrop(0);
    publish({ on: gfxAuto(), res: gfxRes(), range: viewRange().label, reduced: false });
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
    if (ch.kind !== 'info') r.setQuality(gov.quality);
    log?.(ch);
  }
  if (gov.wantProbe()) r.probeNext = true;
}
