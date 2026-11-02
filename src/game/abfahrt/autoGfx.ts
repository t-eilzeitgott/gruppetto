/**
 * Automatik für Auflösung und Sichtweite der 3D-Spiele. Die Schieberegler (gfxOpts.ts) sind die Obergrenze: reicht die
 * Leistung nicht für 60 Bilder je Sekunde, senkt die Automatik im Spiel
 *
 *   1. die Auflösung in zwei Schritten bis auf drei Viertel der gewählten (2-fach → 1,75 → 1,5-fach) – das hilft, wenn
 *      die Grafik das Limit ist (auf dem iPhone fast immer), und kostet keinen Umbau der Welt;
 *   2. danach die Sichtweite Stufe für Stufe bis zur kürzesten („Einfach“).
 *
 * Ist die Rechenzeit die Grenze (über gut die Hälfte des Bildtakts), hilft die Auflösung nicht – dann gleich die
 * Sichtweite. Wieder hinauf geht es in umgekehrter Folge, aber nur mit Beleg: nach einigen ruhigen Sekunden misst
 * ein einzelnes Probebild die Grafikzeit; reicht sie auch für den nächsten Schritt (mit Reserve), wird er probiert.
 * Ruckelt es danach gleich wieder, geht es zurück, und bis zum nächsten Versuch vergeht doppelt so viel Zeit.
 *
 * Maß sind die Bilder, die ihren Takt verpassen (frameClock.ts) – im festen 60er-Takt die verlässlichste Größe
 * (die Bildzeit selbst ist dort immer 16,7 ms, auch wenn die Grafik schon 15 ms braucht). Gemessen wird nur während
 * der Fahrt (nicht in Pause, Start- oder Ergebniskarte), die ersten Sekunden zählen nicht.
 *
 * Je Spiel merkt sich das Gerät den letzten Stand (für dieselbe Stufe und Auflösung): die nächste Fahrt beginnt dort,
 * statt erst wieder ins Ruckeln zu laufen. Ohne Three.js (das Menü zeigt den Stand).
 */
import { gfxAuto, gfxLevel, gfxRes } from './gfxOpts';
import { rangeDropMax, setAutoRangeDrop, viewRange } from './viewRange';

/** Auflösung: Faktoren auf die gewählte – höchstens bis drei Viertel (2-fach → 1,5-fach) */
export const RES_STEPS = [1, 0.875, 0.75];

/** Bilder je Urteil (bei 60 je Sekunde gut eine Sekunde) */
const WINDOW = 70;
/** so lange nach dem Start der Fahrt nicht urteilen (Shader, Landschaft rund um den Start) */
const WARMUP_S = 2.5;
/** zu langsam: mehr als so viele Bilder verpassen ihren Takt (jedes zwölfte – ein spürbares Stottern) */
const SLOW = 0.08;
/** ruhig: höchstens so viele */
const CALM = 0.015;
/** ruhige Urteile in Folge vor dem ersten Versuch hinauf; nach jedem Fehlschlag doppelt so viele (höchstens MAX) */
const NEED0 = 5;
const NEED_MAX = 96;
/** hinauf nur, wenn die geschätzte Grafikzeit danach höchstens so viel vom Bildtakt braucht (Reserve) */
const GPU_ROOM = 0.78;
const CPU_ROOM = 0.6;
/** Rechenzeit über so viel vom Bildtakt: die Grenze ist die Rechenzeit (Auflösung hilft nicht) */
const CPU_BOUND = 0.55;
/** eine Stufe mehr Sichtweite kostet grob so viel mehr Grafik */
const RANGE_COST = 1.3;
/** nach einem Schritt hinauf: so viele Urteile Probezeit */
const TRIAL = 3;

export interface AutoChange { kind: 'res' | 'range'; text: string }

interface Stored { k: string; r: number; d: number }

const storeKey = (scope: string) => `gruppetto.gfx.auto.${scope}`;
const selKey = () => `${gfxLevel()}|${gfxRes()}`;

function load(scope: string): Stored | null {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(scope)) ?? 'null') as Stored | null;
    return v && v.k === selKey() ? v : null;
  } catch { return null; }
}
function save(scope: string, r: number, d: number) {
  try {
    if (!r && !d) localStorage.removeItem(storeKey(scope));
    else localStorage.setItem(storeKey(scope), JSON.stringify({ k: selKey(), r, d }));
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

export class AutoGfx {
  /** Auflösungsschritt (Index in RES_STEPS) */
  res = 0;
  /** um so viele Stufen kürzere Sichtweite */
  range = 0;
  private warm = 0;
  private n = 0;
  private late = 0;
  private cpu: number[] = [];
  private calm = 0;
  private need = NEED0;
  private settle = 0;
  private trial: { kind: 'res' | 'range'; left: number } | null = null;
  private probeAsk = false;
  private gpu: number | null = null;

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
    this.cpu = [];
    this.calm = 0;
    this.need = NEED0;
    this.settle = 0;
    this.trial = null;
    this.probeAsk = false;
    this.gpu = null;
    setAutoRangeDrop(this.range);
    this.show();
    return this.quality !== q0;
  }

  /** soll das nächste Bild die Grafikzeit messen (ein Probebild; wartet einmal auf die Grafik)? */
  wantProbe(): boolean { return this.probeAsk; }
  /** Ergebnis des Probebilds (ms Grafikzeit) */
  setProbe(ms: number) { this.probeAsk = false; this.gpu = ms; }

  /**
   * ein gezeichnetes Bild. missed: hat es seinen Takt verpasst (frameClock); target: Bildtakt (ms); cpu: Rechenzeit
   * dieses Bildes (ms); dt: echter Abstand zum vorigen (s); active: Fahrt läuft (nicht Pause, Start, Ergebnis).
   * Liefert eine Änderung oder null. Die Sichtweite stellt der Regler selbst um; die Auflösung übernimmt der Aufrufer
   * (renderer.setQuality(quality) – wirkt direkt vor dem nächsten Bild).
   */
  frame(missed: boolean, target: number, cpu: number, dt: number, active: boolean): AutoChange | null {
    if (!gfxAuto() || !active || !(dt > 0) || dt > 0.25) return null;
    if (this.warm < WARMUP_S) { this.warm += dt; return null; }
    this.n += 1;
    // im 120er-Takt (Gerät schafft mehr als 60 je Sekunde) zählt ein verpasster Takt nicht
    if (missed && target >= 15) this.late += 1;
    this.cpu.push(cpu);
    if (this.n < WINDOW) return null;
    const frac = this.late / this.n;
    const cs = this.cpu.sort((a, b) => a - b);
    const cpuMed = cs[cs.length >> 1];
    this.n = 0;
    this.late = 0;
    this.cpu = [];
    if (this.settle > 0) { this.settle -= 1; return null; }
    const frame = Math.max(target, 1000 / 60);
    const slow = frac > SLOW;

    if (slow) {
      this.calm = 0;
      this.probeAsk = false;
      this.gpu = null;
      // eben hinauf und gleich wieder zu langsam: zurück, nächster Versuch erst nach doppelt so langer Ruhe
      if (this.trial) {
        const kind = this.trial.kind;
        this.trial = null;
        this.need = Math.min(NEED_MAX, this.need * 2);
        return kind === 'range' ? this.stepRange(1, 'zurück') : this.stepRes(1, 'zurück');
      }
      const why = `${Math.round(frac * 100)} % der Bilder zu spät, Rechnen ${cpuMed.toFixed(1)} ms`;
      // die Rechenzeit ist die Grenze: kleinere Auflösung hilft nicht, gleich die Sichtweite
      const cpuBound = cpuMed > CPU_BOUND * frame;
      if (!cpuBound && this.res < RES_STEPS.length - 1) return this.stepRes(1, why);
      if (this.range < rangeDropMax()) return this.stepRange(1, why);
      if (this.res < RES_STEPS.length - 1) return this.stepRes(1, why);
      return null;
    }

    if (this.trial && --this.trial.left <= 0) { this.trial = null; this.need = NEED0; }
    if (frac > CALM) { this.calm = 0; return null; }
    this.calm += 1;
    if (!this.res && !this.range) return null;
    if (this.calm < this.need) return null;
    // genug Ruhe: erst ein Probebild, dann entscheiden
    if (this.gpu === null) { this.probeAsk = true; return null; }
    const gpu = this.gpu;
    this.gpu = null;
    this.calm = 0;
    // umgekehrte Folge: zuerst die Sichtweite zurück (zuletzt gekürzt), dann die Auflösung
    const kind: 'res' | 'range' = this.range > 0 ? 'range' : 'res';
    const est = kind === 'range' ? gpu * RANGE_COST : gpu * (RES_STEPS[this.res - 1] / RES_STEPS[this.res]) ** 2;
    const cpuNext = kind === 'range' ? cpuMed * 1.15 : cpuMed;
    if (est > GPU_ROOM * frame || cpuNext > CPU_ROOM * frame) {
      // (noch) keine Luft: später wieder messen
      this.need = Math.min(NEED_MAX, this.need * 2);
      return null;
    }
    this.trial = { kind, left: TRIAL };
    const why = `Luft: Grafik ${gpu.toFixed(1)} ms`;
    return kind === 'range' ? this.stepRange(-1, why) : this.stepRes(-1, why);
  }

  private stepRes(dir: 1 | -1, why: string): AutoChange {
    const from = gfxRes() * this.quality;
    this.res = Math.max(0, Math.min(RES_STEPS.length - 1, this.res + dir));
    this.settle = 1;
    this.after();
    return { kind: 'res', text: `Auflösung ${fmtRes(from)} → ${fmtRes(gfxRes() * this.quality)} (${why})` };
  }

  private stepRange(dir: 1 | -1, why: string): AutoChange {
    const from = viewRange().label;
    this.range = Math.max(0, Math.min(rangeDropMax(), this.range + dir));
    setAutoRangeDrop(this.range);
    // (der Umbau der Landschaft ruckelt selbst: zwei Urteile abwarten)
    this.settle = 2;
    this.after();
    return { kind: 'range', text: `Sichtweite ${from} → ${viewRange().label} (${why})` };
  }

  private after() {
    save(this.scope, this.res, this.range);
    this.show();
  }

  private show() {
    publish({ on: gfxAuto(), res: gfxRes() * this.quality, range: viewRange().label, reduced: this.res > 0 || this.range > 0 });
  }

  /** Spiel verlassen: Sichtweite wieder wie gewählt (die Bühne wird für andere Spiele vorgewärmt) */
  dispose() {
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
    r.setQuality(gov.quality);
    log?.(ch);
  }
  if (gov.wantProbe()) r.probeNext = true;
}
