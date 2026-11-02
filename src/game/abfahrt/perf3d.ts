/**
 * Messfahrt im WebGL-Spiel (Abfahrt): zeichnet je Bild auf, wo die Zeit bleibt – wie die Messfahrt der WebGPU-Abfahrt
 * (gpu/perf.ts), mit den Bausteinen dieses Renderers. So lassen sich Ruckler und das Herunterregeln der Auflösung
 * auf dem Gerät nachvollziehen, ohne dass jemand mit dem Debugger daneben sitzt.
 *
 * Je Bild: Abstand zum vorigen Bild (Bildzeit), Verspätung des Bildaufrufs (der Hauptfaden war vorher mit etwas
 * anderem beschäftigt: Seite, Speicherbereinigung …), CPU-Zeit je Baustein, Zeichenaufrufe, Dreiecke, Programme,
 * Auflösungsstufe, Sichtweite, Ort auf der Strecke (freie Strecke, Ortsdurchfahrt, Dorf), Tempo und Ereignisse
 * (Abschnitt fertig oder sofort gebaut, Landschaftskachel, neue Shader, Regler, Phase …).
 *
 * GPU: WebGL auf dem iPhone kennt keine Zeitstempel. Darum wird etwa alle 1,5 s ein Bild „synchron“ gezeichnet:
 * erst warten, bis die Grafik mit dem Vorigen fertig ist (Rückstau), dann zeichnen und auf das Ende warten
 * (Grafikzeit dieses Bildes). Diese Probebilder zählen nicht als Ruckler.
 *
 * Bericht: kompakt zum Kopieren (Zusammenfassung, Vergleich der Orte, Verteilung, Bausteine, die schlimmsten
 * Ruckler mit Umfeld, Verlauf je 2 s, Ereignisse) – und vollständig als Datei (zusätzlich jedes einzelne Bild).
 *
 * Ruckler ohne Last (Rechnen und Grafik weit unter dem Takt) suchen: je Bild zusätzlich
 * - die Bildaufrufe des Browsers seit dem vorigen Bild und ihr größter Abstand – fehlt ein Aufruf (Abstand über
 *   anderthalb Bildschirmtakte), war der Browser selbst aufgehalten (Seite, Speicherbereinigung, Grafikprozess);
 *   kamen die Aufrufe pünktlich und eines wurde ausgelassen, lag es am festen Bildtakt;
 * - was auf die Grafikkarte geladen wurde (kB, Texturen);
 * - neue Zeichenzustände: Programm × Aufbau der Geometrie × Mischung/Tiefe × Ziel – beim ersten Zeichnen baut der
 *   Grafiktreiber (Metal) dafür eine Pipeline, das kostet ihn Zeit, die weder Rechen- noch Grafikzeit des Spiels ist;
 * - Änderungen an der Oberfläche (Elemente kommen hinzu oder gehen: Ansagen, Werbung, Hinweise).
 */

/** Bausteine je Bild (Reihenfolge wie im Bildablauf) */
export const SECTIONS = ['spiel', 'licht', 'welt', 'abschnitte', 'kamera', 'umgebung', 'landschaft', 'fahrer', 'himmel', 'zuschauer', 'dinge', 'zeichnen', 'hochladen', 'anzeige'] as const;
export type Section = (typeof SECTIONS)[number];
const NS = SECTIONS.length;
export const SEC = Object.fromEntries(SECTIONS.map((s, i) => [s, i])) as Record<Section, number>;

/** Ereignisse (als Bits je Bild, mit Text auch als Liste) */
export const EV = { chunk: 1, sync: 2, tile: 4, shader: 8, quality: 16, range: 32, phase: 64, resize: 128, lost: 256, mtn: 512, probe: 1024, error: 2048, pace: 4096, ui: 8192, pipe: 16384, tex: 32768 } as const;
/** Ereignisse, deren Text auch in der Rucklerliste steht (was genau neu war) */
const DETAIL_KINDS = new Set(['ui', 'pipe', 'tex', 'mtn', 'quality', 'range']);
const EV_NAMES: [number, string][] = Object.entries(EV).map(([k, v]) => [v, k]);

/** Ort auf der Strecke */
export const PLACES = ['frei', 'ortsdurchfahrt', 'dorf'] as const;
const PHASES = ['ready', 'countdown', 'playing', 'crash', 'over', 'paused'];

export interface FrameInfo {
  /** Abstand zum vorigen Bild (ms, ungekappt) */
  dt: number;
  /** Bildschirmtakt (ms) */
  period: number;
  calls: number;
  tris: number;
  progs: number;
  /** Auflösungsstufe 0,5 … 1 und Pixel je Punkt der Zeichenfläche */
  quality: number;
  px: number;
  /** Sichtweite: um so viele Stufen gekürzt */
  range: number;
  z: number;
  /** Tempo (m/s) */
  v: number;
  phase: string;
  /** 0 frei, 1 Ortsdurchfahrt, 2 Dorf */
  place: number;
  /** Fahrer im Bild (Modelle) */
  riders: number;
  /** Bildschirmtakt (ms; 8,3 auf 120 Hz) */
  screen: number;
  /** Stempel dieses Bildes gegenüber seinem Takt im Raster (ms; frameClock.off) */
  off: number;
}

/** Probebild: Rückstau (Warten auf das vorige Bild), Abschicken, Grafikzeit dieses Bildes (ms) */
export interface Probe { drain: number; submit: number; gpu: number }

const CAP = 60 * 60 * 10; // höchstens 10 min bei 60 Hz (bei 120 Hz 5 min)
/** Abstand der Probebilder (s) */
export const PROBE_S = 1.5;

class Rec {
  readonly t0 = performance.now();
  n = 0;
  t = new Float32Array(CAP);
  dt = new Float32Array(CAP);
  late = new Float32Array(CAP);
  cpu = new Float32Array(CAP);
  sec = new Float32Array(CAP * NS);
  calls = new Uint16Array(CAP);
  tris = new Uint32Array(CAP);
  progs = new Uint16Array(CAP);
  quality = new Float32Array(CAP);
  px = new Float32Array(CAP);
  range = new Uint8Array(CAP);
  z = new Float32Array(CAP);
  v = new Float32Array(CAP);
  phase = new Uint8Array(CAP);
  place = new Uint8Array(CAP);
  riders = new Uint8Array(CAP);
  ev = new Uint16Array(CAP);
  period = new Float32Array(CAP);
  screen = new Float32Array(CAP);
  /** Bildaufrufe des Browsers seit dem vorigen Bild (mit diesem) und ihr größter Abstand (ms) */
  calls2 = new Uint8Array(CAP);
  gap = new Float32Array(CAP);
  /** auf die Grafikkarte geladen (kB) */
  up = new Float32Array(CAP);
  drain = new Float32Array(CAP).fill(-1);
  gpu = new Float32Array(CAP).fill(-1);
  submit = new Float32Array(CAP).fill(-1);
  /** Hauptfaden nach dem Bild (ms): wie lange nach dem Bildende eine Nachricht an sich selbst brauchte – Stil,
   *  Layout und Zeichnen der Oberfläche, Speicherbereinigung, andere Arbeit der Seite */
  after = new Float32Array(CAP).fill(-1);
  endAt = new Float64Array(CAP);
  /** Hauptfaden blockiert (ms): längste Lücke zwischen zwei Wächter-Aufrufen (setTimeout alle paar ms) seit dem
   *  vorigen Bild – darin steckt auch die Rechenzeit des Bildes selbst; deutlich mehr heißt: Speicherbereinigung
   *  oder andere Arbeit hielt den Hauptfaden an, auch zwischen den Bildern */
  stall = new Float32Array(CAP).fill(-1);
  /** Stempel gegenüber seinem Takt (ms) */
  off = new Float32Array(CAP);
  /** Wechseltest: Variante dieses Bildes (0/1; 255: kein Wechseltest) */
  ab = new Uint8Array(CAP).fill(255);
  events: { t: number; f: number; kind: string; text: string }[] = [];
  constructor(readonly meta: Record<string, unknown>) {}
}

export class Perf3D {
  rec: Rec | null = null;
  /** letztes Bild: Bausteine (ms) */
  readonly sec = new Float32Array(NS);
  private last = 0;
  private start = 0;
  private late = 0;
  private evBits = 0;
  private probe: Probe | null = null;
  private lastProbe = 0;
  /** Ruckler der laufenden Messung (für die Anzeige) */
  hitches = 0;
  /** Bildaufrufe seit dem letzten Bild, ihr größter Abstand, Zeit des letzten */
  private calls = 0;
  private gapMax = 0;
  private lastCall = 0;
  /** in diesem Bild hochgeladen (Bytes) */
  private upBytes = 0;
  private uiObs: MutationObserver | null = null;
  /** Nachricht an sich selbst nach jedem Bild (misst, wie lange der Hauptfaden danach noch beschäftigt ist) */
  private chan: MessageChannel | null = null;
  /**
   * Wechseltest: zwei Varianten einer Einstellung wechseln sich alle AB_PERIOD_S ab (A, B, A, B …) – so vergleicht
   * eine Fahrt beide auf derselben Strecke, ohne dass Wärme, Ort oder Fahrerfeld das Ergebnis verzerren
   */
  private ab: AbTest | null = null;
  private abCur = -1;
  /** Wächter: setTimeout-Schleife; die längste Lücke seit dem vorigen Bild zeigt, ob der Hauptfaden stand */
  private guardT = 0;
  private guardMax = 0;
  private guardTimer = 0;

  /** jeder Bildaufruf des Browsers (auch die, die der feste Takt auslässt) – vor clock.ready */
  call() {
    const t = performance.now();
    if (this.lastCall && t - this.lastCall > this.gapMax) this.gapMax = t - this.lastCall;
    this.lastCall = t;
    this.calls++;
  }

  /** etwas wird auf die Grafikkarte geladen (Bytes); tex: eine Textur (Text fürs Ereignis) */
  upload(bytes: number, tex?: string) {
    this.upBytes += bytes;
    if (tex !== undefined) this.event(EV.tex, tex);
  }

  /** Bildbeginn: rafTime = Zeitstempel des Bildaufrufs */
  begin(rafTime: number) {
    const now = performance.now();
    this.start = this.last = now;
    this.late = Math.max(0, now - rafTime);
    this.sec.fill(0);
    this.probe = null;
  }

  /** Abschnitt fertig: Zeit seit der letzten Marke diesem Baustein gutschreiben */
  mark(i: number) {
    const now = performance.now();
    this.sec[i] += now - this.last;
    this.last = now;
  }

  /** Ereignis in diesem Bild (Bit) – mit Text auch in die Liste der Messung */
  event(bit: number, text?: string) {
    this.evBits |= bit;
    const r = this.rec;
    if (r && text !== undefined && r.events.length < 2000) {
      const name = EV_NAMES.find(([b]) => b === bit)?.[1] ?? '?';
      r.events.push({ t: (performance.now() - r.t0) / 1000, f: r.n, kind: name, text });
    }
  }

  /** Soll dieses Bild ein Probebild werden? (etwa alle 1,5 s während einer Messung) */
  wantProbe(): boolean {
    if (!this.rec) return false;
    const now = performance.now();
    if (now - this.lastProbe < PROBE_S * 1000) return false;
    this.lastProbe = now;
    return true;
  }

  /** Ergebnis des Probebilds (vom Renderer) */
  setProbe(p: Probe) { this.probe = p; this.evBits |= EV.probe; }

  /** Bildende */
  end(f: FrameInfo) {
    const cpu = performance.now() - this.start;
    const r = this.rec;
    if (r && this.ab) {
      const want = Math.floor((performance.now() - r.t0) / 1000 / AB_PERIOD_S) % 2;
      if (want !== this.abCur) {
        this.abCur = want;
        try { this.ab.apply(want === 1); } catch (e) { console.error(e); }
        this.event(EV.phase, `Wechseltest ${this.ab.name}: ${this.ab.labels[want]}`);
      }
    }
    if (r && r.n < CAP) {
      const i = r.n++;
      r.ab[i] = this.ab ? this.abCur : 255;
      r.t[i] = (performance.now() - r.t0) / 1000;
      r.dt[i] = f.dt;
      r.late[i] = this.late;
      r.cpu[i] = cpu;
      r.sec.set(this.sec, i * NS);
      r.calls[i] = Math.min(65535, f.calls);
      r.tris[i] = f.tris;
      r.progs[i] = Math.min(65535, f.progs);
      r.quality[i] = f.quality;
      r.px[i] = f.px;
      r.range[i] = f.range;
      r.z[i] = f.z;
      r.v[i] = f.v;
      r.phase[i] = Math.max(0, PHASES.indexOf(f.phase));
      r.place[i] = f.place;
      r.riders[i] = Math.min(255, f.riders);
      r.ev[i] = this.evBits;
      r.period[i] = f.period;
      r.screen[i] = f.screen;
      r.calls2[i] = Math.min(255, this.calls);
      r.gap[i] = this.gapMax;
      r.up[i] = this.upBytes / 1024;
      if (this.probe) { r.drain[i] = this.probe.drain; r.submit[i] = this.probe.submit; r.gpu[i] = this.probe.gpu; }
      // (das Bild nach einem Probebild läuft spät an: beide zählen nicht als Ruckler)
      const prevProbe = i > 0 && (r.ev[i - 1] & EV.probe) !== 0;
      if (f.dt > hitchLimit(f.period) && !(this.evBits & EV.probe) && !prevProbe) this.hitches++;
      r.stall[i] = this.guardMax;
      r.off[i] = f.off;
      r.endAt[i] = performance.now();
      try { this.chan?.port2.postMessage(i); } catch { /* egal */ }
    }
    this.guardMax = 0;
    this.evBits = 0;
    this.calls = 0;
    this.gapMax = 0;
    this.upBytes = 0;
  }

  startRec(meta: Record<string, unknown>, ab: AbTest | null = null) {
    this.rec = new Rec(meta);
    this.ab = ab;
    this.abCur = -1;
    this.hitches = 0;
    this.lastProbe = performance.now();
    this.calls = 0;
    this.gapMax = 0;
    this.lastCall = 0;
    this.upBytes = 0;
    this.guardMax = 0;
    this.guardT = performance.now();
    clearTimeout(this.guardTimer);
    const guard = () => {
      if (!this.rec) return;
      const now = performance.now();
      const gap = now - this.guardT;
      if (gap > this.guardMax) this.guardMax = gap;
      this.guardT = now;
      this.guardTimer = window.setTimeout(guard, 2);
    };
    this.guardTimer = window.setTimeout(guard, 2);
    try {
      this.chan?.port1.close();
      this.chan = new MessageChannel();
      // (Node, Tests: offene Kanäle halten den Prozess am Leben)
      (this.chan.port1 as { unref?: () => void }).unref?.();
      (this.chan.port2 as { unref?: () => void }).unref?.();
      this.chan.port1.onmessage = (e: MessageEvent<number>) => {
        const r = this.rec;
        const i = e.data;
        if (r && i >= 0 && i < r.n) r.after[i] = performance.now() - r.endAt[i];
      };
    } catch { this.chan = null; }
    // Oberfläche: Elemente, die hinzukommen oder gehen (Ansagen, Werbung, Hinweise) – nur Elemente, kein Text
    // (Tempo und Zeit wechseln jedes Bild ihren Text)
    try {
      this.uiObs?.disconnect();
      this.uiObs = new MutationObserver((list) => {
        const names = new Set<string>();
        for (const m of list) {
          for (const [nodes, sign] of [[m.addedNodes, '+'], [m.removedNodes, '−']] as const) {
            for (const nd of nodes) {
              if (nd.nodeType !== 1) continue;
              const el = nd as Element;
              if (el.closest?.('.gpu-rec, .fps-meter') || el.classList.contains('fps-meter')) continue;
              const cls = typeof el.className === 'string' && el.className ? el.className.split(/\s+/)[0] : el.tagName.toLowerCase();
              names.add(`${sign}${cls}`);
            }
          }
        }
        if (names.size) this.event(EV.ui, [...names].slice(0, 4).join(' '));
      });
      this.uiObs.observe(document.body, { childList: true, subtree: true });
    } catch { this.uiObs = null; }
  }

  /** laufende Messung: Sekunden seit Beginn */
  get recSeconds(): number { return this.rec ? (performance.now() - this.rec.t0) / 1000 : 0; }

  /** Messung beenden: Bericht (kompakt) und Datei (vollständig) */
  stopRec(extra?: Record<string, unknown>): Report | null {
    const r = this.rec;
    this.rec = null;
    this.uiObs?.disconnect();
    this.uiObs = null;
    clearTimeout(this.guardTimer);
    if (this.ab) { try { if (this.ab.end) this.ab.end(); else this.ab.apply(false); } catch { /* egal */ } }
    const ab = this.ab;
    this.ab = null;
    try { this.chan?.port1.close(); this.chan?.port2.close(); } catch { /* egal */ }
    this.chan = null;
    if (!r || r.n < 30) return null;
    if (extra) Object.assign(r.meta, extra);
    return makeReport(r, ab);
  }
}

/** Wechseltest: Name, Beschriftung der Varianten (A = aus/normal, B = an), Umschalten; end: Aufräumen am Ende
 *  (sonst apply(false)) */
export interface AbTest { name: string; labels: [string, string]; apply: (b: boolean) => void; end?: () => void }
/** Abstand der Wechsel (s) */
export const AB_PERIOD_S = 20;

export interface Report {
  /** Kurzfassung für die Anzeige */
  summary: { s: number; fps: number; low1: number; hitches: number; worst: number; period: number; cpuP95: number; gpuMed: number | null; frames: number; places: { name: string; s: number; fps: number; p60: number; gpu: number | null }[]; ab: { label: string; s: number; fps: number; late: number; hitchesPerMin: number }[] | null };
  /** kompakt (zum Kopieren) */
  text: string;
  /** vollständig (Datei) */
  full: string;
}

/** Ruckler: mindestens ein verpasstes Bild bei 60 Hz (auf 120-Hz-Bildschirmen zählt ein 60-Hz-Bild nicht als Ruckler) */
const hitchLimit = (period: number) => Math.max(period, 1000 / 60) * 1.5 + 1;
/** Hauptfaden nach dem Bild länger als so viele ms beschäftigt: das hat das nächste Bild aufgehalten */
const MAIN_BUSY_MS = 4;
/** Wächter-Lücke (ohne Rechenzeit des Bildes) über so viele ms: der Hauptfaden stand (der Wächter läuft alle 4 ms) */
const STALL_MS = 10;

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
function pct(sorted: ArrayLike<number>, p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}
function stats(a: ArrayLike<number>) {
  const s = Float32Array.from(a as ArrayLike<number>).sort();
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s[i];
  return { avg: r2(sum / Math.max(1, s.length)), p50: r2(pct(s, 0.5)), p60: r2(pct(s, 0.6)), p90: r2(pct(s, 0.9)), p95: r2(pct(s, 0.95)), p99: r2(pct(s, 0.99)), max: r2(s[s.length - 1] ?? 0) };
}

function makeReport(r: Rec, ab: AbTest | null): Report {
  const n = r.n;
  const dt = r.dt.subarray(0, n);
  const cpu = r.cpu.subarray(0, n);
  const late = r.late.subarray(0, n);
  const period = pct(Float32Array.from(r.period.subarray(0, n)).sort(), 0.5);
  const dur = Math.max(0.001, r.t[n - 1]);
  const isProbe = (i: number) => (r.ev[i] & EV.probe) !== 0 || (i > 0 && (r.ev[i - 1] & EV.probe) !== 0);
  // ohne Probebilder (die warten absichtlich auf die Grafik)
  const keep: number[] = [];
  for (let i = 0; i < n; i++) if (!isProbe(i)) keep.push(i);
  const dtK = keep.map((i) => dt[i]);
  const sorted = Float32Array.from(dtK).sort();
  const worst1 = sorted.subarray(Math.floor(sorted.length * 0.99));
  let w = 0;
  for (const x of worst1) w += x;
  const low1 = 1000 / (w / Math.max(1, worst1.length));
  const fps = n / dur;
  // Ruckler: deutlich länger als der Takt (mindestens ein verpasstes Bild bei 60 Hz)
  const hitchMs = hitchLimit(period);
  const hist: Record<string, number> = { '<9': 0, '9-13': 0, '13-18': 0, '18-25': 0, '25-34': 0, '34-50': 0, '50-100': 0, '>100': 0 };
  const edges: [number, string][] = [[9, '<9'], [13, '9-13'], [18, '13-18'], [25, '18-25'], [34, '25-34'], [50, '34-50'], [100, '50-100'], [Infinity, '>100']];
  let hitches = 0, missed = 0, cpuBound = 0, lateBound = 0;
  // ohne Last: fehlender Bildaufruf (Browser aufgehalten) oder ausgelassener (fester Takt); dabei Neues gezeichnet,
  // hochgeladen oder an der Oberfläche geändert (Ereignisse dieses und der drei Bilder davor)
  let noCall = 0, skipped = 0, withPipe = 0, withUp = 0, withUi = 0, withMain = 0, withStall = 0;
  // Hauptfaden nach dem vorigen Bild noch so lange beschäftigt (ms): das verzögert dieses Bild
  const mainBefore = (i: number) => (i > 0 ? r.after[i - 1] : -1);
  // Hauptfaden stand zwischen dem vorigen und diesem Bild: Wächter-Lücke über ihrem üblichen Maß (iOS lässt die
  // setTimeout-Schleife unter Last nur etwa alle 28 ms dran – Messfahrt 258: Median 25 ms; darum zählt nur, was
  // darüber hinausgeht). −1: in diesem Bild kein Wächter-Aufruf
  const gapsAll = Float32Array.from(keep.map((i) => r.stall[i]).filter((x) => x > 0)).sort();
  const gapBase = gapsAll.length ? pct(gapsAll, 0.5) : 0;
  const stallOf = (i: number) => (r.stall[i] <= 0 ? -1 : Math.max(0, r.stall[i] - gapBase));
  // Takt-Versatz der Stempel (ms gegenüber dem Raster): wie verrauscht Safari die Aufrufe stempelt
  const offHist: Record<string, number> = { '<0': 0, '0-2': 0, '2-4': 0, '4-7': 0, '7-10': 0, '10-15': 0, '>15': 0 };
  const offEdges: [number, string][] = [[0, '<0'], [2, '0-2'], [4, '2-4'], [7, '4-7'], [10, '7-10'], [15, '10-15'], [Infinity, '>15']];
  const near = (i: number, bit: number) => { for (let j = Math.max(0, i - 3); j <= i; j++) if (r.ev[j] & bit) return true; return false; };
  const upNear = (i: number) => { let kb = 0; for (let j = Math.max(0, i - 1); j <= i; j++) kb += r.up[j]; return kb; };
  // Taktfehler: ein Bild kam später als im festen Bildtakt (auch die kleinen, z. B. 25 statt 16,7 ms auf 120 Hz –
  // die fühlen sich als Mikroruckler an, obwohl sie unter der Rucklergrenze bleiben)
  let offBeat = 0;
  const idx: number[] = [];
  // (Grenzen je Bild nach seinem Takt: ein Wechseltest kann den Bildtakt umstellen, 16,7 ↔ 25 ms)
  for (const i of keep) {
    const d = dt[i];
    const per = r.period[i] || period;
    if (d > per * 1.25 + 1) offBeat++;
    hist[edges.find(([e]) => d < e)![1]]++;
    if (d > hitchLimit(per)) {
      hitches++;
      missed += Math.max(1, Math.round(d / per) - 1);
      idx.push(i);
      if (cpu[i] > period * 0.8) cpuBound++;
      if (late[i] > period * 0.5) lateBound++;
      const scr = r.screen[i] || period;
      if (r.gap[i] > scr * 1.5) noCall++;
      else if (r.calls2[i] > Math.max(1, Math.round(r.period[i] / scr))) skipped++;
      if (near(i, EV.pipe)) withPipe++;
      if (near(i, EV.tex) || upNear(i) > 256) withUp++;
      if (near(i, EV.ui)) withUi++;
      if (mainBefore(i) > MAIN_BUSY_MS) withMain++;
      if (stallOf(i) > STALL_MS) withStall++;
    }
    offHist[offEdges.find(([e]) => r.off[i] < e)![1]]++;
  }
  const afterAll = keep.map((i) => r.after[i]).filter((x) => x >= 0);
  const stallAll = keep.map((i) => stallOf(i)).filter((x) => x >= 0);
  const secAvg = (list: number[]) => {
    const o: Record<string, number> = {};
    for (let k = 0; k < NS; k++) {
      let s = 0;
      for (const i of list) s += r.sec[i * NS + k];
      o[SECTIONS[k]] = r2(s / Math.max(1, list.length));
    }
    return o;
  };
  // Bausteine: Mittel, 95 %, Höchstwert (ohne Probebilder)
  const secStats: Record<string, { avg: number; p95: number; max: number }> = {};
  for (let k = 0; k < NS; k++) {
    const s = stats(keep.map((i) => r.sec[i * NS + k]));
    secStats[SECTIONS[k]] = { avg: s.avg, p95: s.p95, max: s.max };
  }
  // Probebilder: Rückstau und Grafikzeit
  const probes: number[] = [];
  for (let i = 0; i < n; i++) if (r.gpu[i] >= 0) probes.push(i);
  const probeStats = (list: number[]) => (list.length ? { anzahl: list.length, rueckstau_ms: stats(list.map((i) => r.drain[i])), grafik_ms: stats(list.map((i) => r.gpu[i])), abschicken_ms: stats(list.map((i) => r.submit[i])) } : null);
  // Orte: freie Strecke, Ortsdurchfahrt, Dorf – nur gefahrene Bilder (playing)
  const playing = PHASES.indexOf('playing');
  const places = PLACES.map((name, p) => {
    const list = keep.filter((i) => r.place[i] === p && r.phase[i] === playing);
    if (!list.length) return null;
    let secs = 0, calls = 0, tris = 0, q = 0, px = 0, c = 0, rd = 0;
    for (const i of list) { secs += dt[i] / 1000; calls += r.calls[i]; tris += r.tris[i]; q += r.quality[i]; px += r.px[i]; c += cpu[i]; rd += r.riders[i]; }
    const m = list.length;
    const d = stats(list.map((i) => dt[i]));
    const pr = probes.filter((i) => r.place[i] === p && r.phase[i] === playing);
    const top = Object.entries(secAvg(list)).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return {
      name, sekunden: r1(secs), bilder: m, fps: r1(m / Math.max(0.001, secs)), bildzeit_p60_ms: d.p60, bildzeit_p90_ms: d.p90, bildzeit_max_ms: d.max,
      cpu_mittel_ms: r2(c / m), groesste_bausteine_ms: Object.fromEntries(top), aufrufe: Math.round(calls / m), dreiecke_k: Math.round(tris / m / 1000),
      aufloesung_fach: r2(q / m), pixel_je_punkt: r2(px / m), fahrer_als_modell: r1(rd / m), grafik_probe: probeStats(pr),
    };
  }).filter((x) => x !== null);
  // Wechseltest: je Variante nur gefahrene Bilder, ohne die ersten zwei Sekunden nach jedem Wechsel (der Wechsel
  // selbst kann ruckeln)
  const abRows = ab ? [0, 1].map((v) => {
    const list: number[] = [];
    let since = -1;
    for (const i of keep) {
      if (r.phase[i] !== playing) continue;
      if (i > 0 && r.ab[i] !== r.ab[i - 1]) since = r.t[i];
      if (r.ab[i] === v && r.t[i] - since >= 2) list.push(i);
    }
    let secs = 0, h = 0, off = 0;
    for (const i of list) { const d = dt[i]; const per = r.period[i] || period; secs += d / 1000; if (d > hitchLimit(per)) h++; if (d > per * 1.25 + 1) off++; }
    const pr = probes.filter((i) => r.ab[i] === v && r.phase[i] === playing);
    const gpuList = pr.map((i) => r.gpu[i]);
    const gpuMed = gpuList.length ? pct(Float32Array.from(gpuList).sort(), 0.5) : null;
    return { variante: ab.labels[v], sekunden: r1(secs), bilder: list.length, fps: r1(list.length / Math.max(0.001, secs)), taktfehler_prozent: r1((off / Math.max(1, list.length)) * 100), ruckler: h, ruckler_je_min: r1(h / Math.max(0.001, secs / 60)), grafik_probe_median_ms: gpuMed };
  }) : null;
  const evText = (bits: number) => EV_NAMES.filter(([b]) => bits & b).map(([, k]) => k).join('+');
  // die schlimmsten Ruckler mit Umfeld (Ereignisse −3 … +1 Bilder, größte Bausteine)
  const top = [...idx].sort((a, b) => dt[b] - dt[a]).slice(0, 40).sort((a, b) => a - b);
  const hitchRows = top.map((i) => {
    let bits = 0;
    for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 1); j++) bits |= r.ev[j];
    const secs = SECTIONS.map((s, k) => [s, r.sec[i * NS + k]] as const).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, v]) => `${s}:${r1(v)}`).join(' ');
    // was genau neu war (Zeichenzustand, Textur, Oberfläche …) in diesem und den drei Bildern davor
    const det = r.events.filter((e) => e.f >= i - 3 && e.f <= i && DETAIL_KINDS.has(e.kind)).map((e) => `${e.kind}: ${e.text}`);
    const detail = det.length > 4 ? [...det.slice(0, 4), `… ${det.length - 4} weitere`] : det;
    return [r1(r.t[i]), r1(dt[i]), r1(cpu[i]), r1(late[i]), secs, r.calls[i], Math.round(r.tris[i] / 1000), r2(r.quality[i]), Math.round(r.z[i]), Math.round(r.v[i] * 3.6), PLACES[r.place[i]], PHASES[r.phase[i]], r.riders[i], evText(bits), r.calls2[i], r1(r.gap[i]), Math.round(r.up[i] + (i > 0 ? r.up[i - 1] : 0)), r1(mainBefore(i)), r1(stallOf(i)), r1(r.off[i]), detail.join(' | ')];
  });
  // Verlauf je 2 s
  const timeline: (number | string)[][] = [];
  for (let i0 = 0; i0 < n;) {
    const tEnd = r.t[i0] + 2;
    let i1 = i0;
    let s = 0, mx = 0, c = 0, cm = 0, h = 0, lt = 0, g = -1, dr = -1, af = -1, st = -1;
    const dts: number[] = [];
    while (i1 < n && r.t[i1] < tEnd) {
      s += dt[i1]; c += cpu[i1]; cm = Math.max(cm, cpu[i1]); lt = Math.max(lt, late[i1]); af = Math.max(af, r.after[i1]); st = Math.max(st, stallOf(i1));
      if (!isProbe(i1)) { mx = Math.max(mx, dt[i1]); dts.push(dt[i1]); if (dt[i1] > hitchMs) h++; }
      if (r.gpu[i1] >= 0) { g = r.gpu[i1]; dr = r.drain[i1]; }
      i1++;
    }
    const m = i1 - i0;
    const mid = i0 + (m >> 1);
    dts.sort((a, b) => a - b);
    timeline.push([r1(r.t[i0]), Math.round(r.z[mid]), Math.round(r.v[mid] * 3.6), r1(1000 / (s / m)), r1(pct(dts, 0.6)), r1(mx), r1(c / m), r1(cm), r1(lt), r1(af), r1(st), r1(g), r1(dr), h, r.calls[mid], Math.round(r.tris[mid] / 1000), r2(r.quality[mid]), r.range[mid], PLACES[r.place[mid]], PHASES[r.phase[mid]], r.riders[mid], r1(r.period[mid])]);
    i0 = i1;
  }
  const probeAll = probeStats(probes.filter((i) => r.phase[i] === playing));
  const summary: Report['summary'] = {
    s: r1(dur), fps: r1(fps), low1: r1(low1), hitches, worst: r1(sorted[sorted.length - 1] ?? 0), period: r1(period), cpuP95: stats(cpu).p95,
    gpuMed: probeAll ? probeAll.grafik_ms.p50 : null, frames: n,
    places: places.map((p) => ({ name: p.name, s: p.sekunden, fps: p.fps, p60: p.bildzeit_p60_ms, gpu: p.grafik_probe ? p.grafik_probe.grafik_ms.p50 : null })),
    ab: abRows ? abRows.map((a) => ({ label: a.variante, s: a.sekunden, fps: a.fps, late: a.taktfehler_prozent, hitchesPerMin: a.ruckler_je_min })) : null,
  };
  const base = {
    art: 'gruppetto Abfahrt (WebGL) Messfahrt', v: 1, ...r.meta,
    zusammenfassung: {
      dauer_s: summary.s, bilder: n, takt_ms: summary.period, fps_mittel: summary.fps, fps_1pct_low: summary.low1,
      taktfehler: offBeat, taktfehler_prozent: r1((offBeat / Math.max(1, keep.length)) * 100),
      ruckler: hitches, verpasste_bilder: missed, ruckler_cpu_gebunden: cpuBound, ruckler_spaeter_aufruf: lateBound, ruckler_grenze_ms: r1(hitchMs),
      ruckler_ohne_bildaufruf: noCall, ruckler_aufruf_ausgelassen: skipped, ruckler_mit_neuem_zeichenzustand: withPipe, ruckler_mit_hochladen: withUp, ruckler_mit_oberflaeche: withUi, ruckler_mit_hauptfaden: withMain, ruckler_mit_blockiertem_hauptfaden: withStall,
      hinweis: `takt_ms = fester Bildtakt (frameClock.ts); Taktfehler = Bild später als dieser Takt. ruckler_ohne_bildaufruf: der Browser rief länger als anderthalb Bildschirmtakte nicht auf (Seite, Speicherbereinigung oder Grafikprozess hielten ihn auf); ruckler_aufruf_ausgelassen: Aufrufe kamen, der feste Takt ließ einen aus. Zeichenzustand = erstes Zeichnen einer neuen Kombination (Pipeline im Grafiktreiber). ruckler_mit_hauptfaden: der Hauptfaden war nach dem vorigen Bild noch über ${MAIN_BUSY_MS} ms beschäftigt (hauptfaden_ms: Stil, Layout und Zeichnen der Oberfläche). ruckler_mit_blockiertem_hauptfaden: ein Wächter (setTimeout-Schleife; iOS lässt sie unter Last nur etwa alle 28 ms dran) kam zwischen dem vorigen und diesem Bild über ${STALL_MS} ms später dran als üblich (blockiert_ms = Lücke über dem Median aller Lücken; −1: kein Aufruf in diesem Bild): Speicherbereinigung oder andere Arbeit der Seite – nicht die Grafik. takt_versatz_ms: Stempel der gezeichneten Bilder gegenüber ihrem Takt im Raster (Safari stempelt mit der Zeit, zu der das Skript drankommt). Auflösung und Sichtweite regelt die Automatik (Ereignisse quality und range)`,
    },
    orte: places,
    wechseltest: ab ? { einstellung: ab.name, wechsel_alle_s: AB_PERIOD_S, hinweis: 'A und B wechseln sich alle 20 s ab; je Variante zählen nur gefahrene Bilder ab zwei Sekunden nach dem Wechsel', varianten: abRows } : undefined,
    grafik_probe: probeAll ?? 'keine Probebilder',
    bildzeit_ms: stats(dtK), cpu_ms: stats(cpu), verspaetung_ms: stats(late), hauptfaden_ms: afterAll.length ? stats(afterAll) : 'nicht gemessen', blockiert_ms: stallAll.length ? { ...stats(stallAll), waechter_takt_ms: r1(gapBase) } : 'nicht gemessen', takt_versatz_ms: offHist,
    verteilung_ms: hist, bausteine_ms: secStats,
    ruckler_spalten: ['t_s', 'bild_ms', 'cpu_ms', 'verspaetung_ms', 'groesste_bausteine', 'aufrufe', 'dreiecke_k', 'aufloesung_fach', 'z_m', 'kmh', 'ort', 'phase', 'fahrer_modelle', 'ereignisse', 'bildaufrufe', 'aufruf_luecke_ms', 'hochgeladen_kb', 'hauptfaden_ms', 'blockiert_ms', 'takt_versatz_ms', 'neu'],
    ruckler_liste: hitchRows,
    verlauf_spalten: ['t_s', 'z_m', 'kmh', 'fps', 'p60_ms', 'max_ms', 'cpu_ms', 'cpu_max', 'verspaetung_max', 'hauptfaden_max', 'blockiert_max', 'grafik_probe_ms', 'rueckstau_probe_ms', 'ruckler', 'aufrufe', 'dreiecke_k', 'aufloesung_fach', 'grafikstufe', 'ort', 'phase', 'fahrer_modelle', 'takt_ms'],
    verlauf_2s: timeline,
    ereignisse: r.events.slice(0, 400).map((e) => [r1(e.t), e.kind, e.text]),
  };
  const text = JSON.stringify(base);
  // vollständig: zusätzlich jedes Bild
  const frames: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = [r2(r.t[i]), r2(dt[i]), r2(late[i]), r2(cpu[i])];
    for (let k = 0; k < NS; k++) row.push(r2(r.sec[i * NS + k]));
    row.push(r.calls[i], Math.round(r.tris[i] / 1000), r.progs[i], r2(r.quality[i]), r2(r.px[i]), r.range[i], Math.round(r.z[i]), r1(r.v[i] * 3.6), r.place[i], r.phase[i], r2(r.drain[i]), r2(r.submit[i]), r2(r.gpu[i]), r.ev[i], r.calls2[i], r1(r.gap[i]), r1(r.up[i]));
    frames.push(row);
  }
  const full = JSON.stringify({
    ...base,
    bilder_spalten: ['t_s', 'bild_ms', 'verspaetung_ms', 'cpu_ms', ...SECTIONS, 'aufrufe', 'dreiecke_k', 'programme', 'aufloesung_fach', 'pixel_je_punkt', 'grafikstufe', 'z_m', 'kmh', 'ort', 'phase', 'rueckstau_ms', 'abschicken_ms', 'grafik_ms', 'ereignis_bits', 'bildaufrufe', 'aufruf_luecke_ms', 'hochgeladen_kb'],
    orte_codes: PLACES, phasen_codes: PHASES, ereignis_bits: EV, alle_ereignisse: r.events.map((e) => [r2(e.t), e.f, e.kind, e.text]),
    bilder: frames,
  });
  return { summary, text, full };
}
