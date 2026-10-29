/**
 * Messfahrt für den WebGPU-Test: zeichnet je Bild auf, wo die Zeit bleibt – damit Ruckler auf dem Gerät
 * nachvollziehbar werden, ohne dass jemand mit dem Debugger daneben sitzt.
 *
 * Je Bild: Abstand zum vorigen Bild (Bildzeit), Verspätung des Bildaufrufs (der Hauptfaden war vorher mit etwas
 * anderem beschäftigt: Seite neu zeichnen, Speicherbereinigung …), CPU-Zeit je Baustein (Fahrt, Kamera, Licht,
 * Bäume, Häuser, Leben, Zuschauer, Gras, Zeichnen), GPU-Zeit (nur, wenn das Gerät Zeitstempel kann),
 * Zeichenaufrufe, Dreiecke, Auflösung, Ort auf der Strecke, Tempo, Kamera, Gegner im Bild und Ereignisse
 * (Kamerawechsel, Stimmung, neue Gegner, Auflösung geändert, Anzeige der Seite aktualisiert, neue Shader bzw.
 * Pipelines – die kosten auf dem iPhone oft Hunderte Millisekunden –, Teile sichtbar geworden).
 *
 * Bericht: kompakt zum Kopieren (Zusammenfassung, Verteilung, die schlimmsten Ruckler mit Umfeld, Verlauf je
 * 2 s) – und vollständig als Datei (zusätzlich jedes einzelne Bild).
 */

/** Bausteine je Bild (Reihenfolge wie im Bildablauf) */
/** (welt: Nachladen der Strecke im Spiel, dinge: Flaschen, Hindernisse, Partikel, 2D-Ebene) */
export const SECTIONS = ['fahrt', 'kamera', 'licht', 'baeume', 'haeuser', 'leben', 'zuschauer', 'gras', 'zeichnen', 'welt', 'dinge'] as const;
export type Section = (typeof SECTIONS)[number];
const NS = SECTIONS.length;

/** Ereignisse (als Bits je Bild, dazu als Liste mit Text) */
export const EV = { cam: 1, mood: 2, opp: 4, dpr: 8, ui: 16, wrap: 32, settings: 64, drive: 128, shader: 256, vis: 512, error: 1024, piece: 2048, phase: 4096 } as const;
const EV_NAMES: [number, string][] = Object.entries(EV).map(([k, v]) => [v, k]);

export interface FrameInfo {
  /** Abstand zum vorigen Bild (ms, ungekappt) */
  dt: number;
  /** Bildschirmtakt (ms) */
  period: number;
  calls: number;
  tris: number;
  dpr: number;
  z: number;
  /** Tempo (m/s) */
  v: number;
  cam: number;
  opps: number;
}

const CAP = 60 * 120 * 6; // höchstens 6 min bei 120 Hz

class Rec {
  readonly t0 = performance.now();
  n = 0;
  dt = new Float32Array(CAP);
  late = new Float32Array(CAP);
  cpu = new Float32Array(CAP);
  sec = new Float32Array(CAP * NS);
  gpu = new Float32Array(CAP);
  calls = new Uint16Array(CAP);
  tris = new Uint32Array(CAP);
  dpr = new Float32Array(CAP);
  z = new Float32Array(CAP);
  v = new Float32Array(CAP);
  cam = new Uint8Array(CAP);
  opps = new Uint8Array(CAP);
  ev = new Uint16Array(CAP);
  period = new Float32Array(CAP);
  t = new Float32Array(CAP);
  events: { t: number; f: number; kind: string; text: string }[] = [];
  constructor(readonly meta: Record<string, unknown>) {}
}

export class Perf {
  /** laufende Messung (null: keine) */
  rec: Rec | null = null;
  /** letztes Bild: Bausteine (ms) */
  readonly sec = new Float32Array(NS);
  private last = 0;
  private start = 0;
  private late = 0;
  private evBits = 0;
  /** GPU-Zeit des zuletzt aufgelösten Bilds (ms; −1: unbekannt) */
  gpu = -1;
  /** Ruckler der laufenden Messung (für die Anzeige) */
  hitches = 0;
  /** Live-Kurve: die letzten 180 Bilder (Bildzeit, CPU) */
  readonly ring = new Float32Array(180 * 2);
  ringAt = 0;

  /** Bildbeginn: rafTime = Zeitstempel des Bildaufrufs */
  begin(rafTime: number) {
    const now = performance.now();
    this.start = this.last = now;
    // wie spät läuft der Bildaufruf an? (der Hauptfaden war vorher belegt)
    this.late = Math.max(0, now - rafTime);
    this.sec.fill(0);
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
    if (r && text !== undefined) {
      const name = EV_NAMES.find(([b]) => b === bit)?.[1] ?? '?';
      r.events.push({ t: (performance.now() - r.t0) / 1000, f: r.n, kind: name, text });
    }
  }

  /** Bildende */
  end(f: FrameInfo) {
    const cpu = performance.now() - this.start;
    const k = this.ringAt;
    this.ring[k * 2] = f.dt;
    this.ring[k * 2 + 1] = cpu;
    this.ringAt = (k + 1) % 180;
    const r = this.rec;
    if (r && r.n < CAP) {
      const i = r.n++;
      r.t[i] = (performance.now() - r.t0) / 1000;
      r.dt[i] = f.dt;
      r.late[i] = this.late;
      r.cpu[i] = cpu;
      r.sec.set(this.sec, i * NS);
      r.gpu[i] = this.gpu;
      r.calls[i] = Math.min(65535, f.calls);
      r.tris[i] = f.tris;
      r.dpr[i] = f.dpr;
      r.z[i] = f.z;
      r.v[i] = f.v;
      r.cam[i] = f.cam;
      r.opps[i] = Math.min(255, f.opps);
      r.ev[i] = this.evBits;
      r.period[i] = f.period;
      if (f.dt > f.period * 1.5 + 1) this.hitches++;
    }
    this.evBits = 0;
  }

  startRec(meta: Record<string, unknown>) { this.rec = new Rec(meta); this.hitches = 0; }

  /** laufende Messung: Sekunden seit Beginn */
  get recSeconds(): number { return this.rec ? (performance.now() - this.rec.t0) / 1000 : 0; }

  /** Messung beenden: Bericht (kompakt) und Datei (vollständig) */
  stopRec(extra?: Record<string, unknown>): Report | null {
    const r = this.rec;
    this.rec = null;
    if (!r || r.n < 30) return null;
    if (extra) Object.assign(r.meta, extra);
    return makeReport(r);
  }
}

export interface Report {
  /** Kurzfassung für die Anzeige */
  summary: { s: number; fps: number; low1: number; hitches: number; worst: number; period: number; cpuP95: number; gpuP95: number | null; frames: number };
  /** kompakt (zum Kopieren) */
  text: string;
  /** vollständig (Datei) */
  full: string;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
function pct(sorted: Float32Array | number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}
function stats(a: Float32Array) {
  const s = Float32Array.from(a).sort();
  let sum = 0;
  for (const x of a) sum += x;
  return { avg: r2(sum / Math.max(1, a.length)), p50: r2(pct(s, 0.5)), p90: r2(pct(s, 0.9)), p95: r2(pct(s, 0.95)), p99: r2(pct(s, 0.99)), max: r2(s[s.length - 1] ?? 0) };
}

function makeReport(r: Rec): Report {
  const n = r.n;
  const dt = r.dt.subarray(0, n);
  const cpu = r.cpu.subarray(0, n);
  const late = r.late.subarray(0, n);
  const period = pct(Float32Array.from(r.period.subarray(0, n)).sort(), 0.5);
  const dur = r.t[n - 1];
  // 1 % low: mittlere Bildrate der langsamsten 1 % Bilder
  const sorted = Float32Array.from(dt).sort();
  const worst1 = sorted.subarray(Math.floor(n * 0.99));
  let w = 0;
  for (const x of worst1) w += x;
  const low1 = 1000 / (w / Math.max(1, worst1.length));
  const fps = n / Math.max(0.001, dur);
  // Ruckler: deutlich länger als der Takt (mindestens ein verpasstes Bild)
  const hitchMs = period * 1.5 + 1;
  const hist: Record<string, number> = { '<9': 0, '9-13': 0, '13-18': 0, '18-25': 0, '25-34': 0, '34-50': 0, '50-100': 0, '>100': 0 };
  const edges: [number, string][] = [[9, '<9'], [13, '9-13'], [18, '13-18'], [25, '18-25'], [34, '25-34'], [50, '34-50'], [100, '50-100'], [Infinity, '>100']];
  let hitches = 0, missed = 0, cpuBound = 0, lateBound = 0;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = dt[i];
    hist[edges.find(([e]) => d < e)![1]]++;
    if (d > hitchMs) {
      hitches++;
      missed += Math.max(1, Math.round(d / period) - 1);
      idx.push(i);
      if (cpu[i] > period * 0.8) cpuBound++;
      if (late[i] > period * 0.5) lateBound++;
    }
  }
  // Bausteine: Mittel, 95 %, Höchstwert
  const secStats: Record<string, { avg: number; p95: number; max: number }> = {};
  for (let k = 0; k < NS; k++) {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = r.sec[i * NS + k];
    const s = stats(a);
    secStats[SECTIONS[k]] = { avg: s.avg, p95: s.p95, max: s.max };
  }
  const gpuOk = r.gpu.subarray(0, n).some((g) => g > 0);
  const gpuS = gpuOk ? stats(Float32Array.from(r.gpu.subarray(0, n)).filter((g) => g >= 0)) : null;
  const evText = (bits: number) => EV_NAMES.filter(([b]) => bits & b).map(([, k]) => k).join('+');
  const camName = (c: number) => ['verfolger', 'tief', 'seite', 'drohne'][c] ?? String(c);
  // die schlimmsten Ruckler mit Umfeld (Ereignisse ±3 Bilder, größter Baustein)
  const top = [...idx].sort((a, b) => dt[b] - dt[a]).slice(0, 40).sort((a, b) => a - b);
  const hitchRows = top.map((i) => {
    let bits = 0;
    for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 1); j++) bits |= r.ev[j];
    const secs = SECTIONS.map((s, k) => [s, r.sec[i * NS + k]] as const).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, v]) => `${s}:${r1(v)}`).join(' ');
    return [r1(r.t[i]), r1(dt[i]), r1(cpu[i]), r1(late[i]), r.gpu[i] >= 0 ? r1(r.gpu[i]) : null, secs, r.calls[i], Math.round(r.tris[i] / 1000), r2(r.dpr[i]), Math.round(r.z[i]), Math.round(r.v[i] * 3.6), camName(r.cam[i]), r.opps[i], evText(bits)];
  });
  // Verlauf je 2 s
  const timeline: (number | string)[][] = [];
  for (let i0 = 0; i0 < n;) {
    const tEnd = r.t[i0] + 2;
    let i1 = i0;
    let s = 0, mx = 0, c = 0, cm = 0, h = 0, g = 0, gn = 0, lt = 0;
    while (i1 < n && r.t[i1] < tEnd) {
      s += dt[i1]; mx = Math.max(mx, dt[i1]); c += cpu[i1]; cm = Math.max(cm, cpu[i1]); lt = Math.max(lt, late[i1]);
      if (dt[i1] > hitchMs) h++;
      if (r.gpu[i1] >= 0) { g += r.gpu[i1]; gn++; }
      i1++;
    }
    const m = i1 - i0;
    const mid = i0 + (m >> 1);
    timeline.push([r1(r.t[i0]), Math.round(r.z[mid]), Math.round(r.v[mid] * 3.6), r1(1000 / (s / m)), r1(mx), r1(c / m), r1(cm), r1(lt), gn ? r1(g / gn) : -1, h, r.calls[mid], Math.round(r.tris[mid] / 1000), r2(r.dpr[mid]), camName(r.cam[mid]), r.opps[mid]]);
    i0 = i1;
  }
  const summary = {
    s: r1(dur), fps: r1(fps), low1: r1(low1), hitches, worst: r1(sorted[n - 1]), period: r1(period), cpuP95: stats(cpu).p95,
    gpuP95: gpuS ? gpuS.p95 : null, frames: n,
  };
  const base = {
    art: 'gruppetto WebGPU-Messfahrt', v: 1, ...r.meta,
    zusammenfassung: {
      dauer_s: summary.s, bilder: n, takt_ms: summary.period, fps_mittel: summary.fps, fps_1pct_low: summary.low1,
      ruckler: hitches, verpasste_bilder: missed, ruckler_cpu_gebunden: cpuBound, ruckler_spaeter_aufruf: lateBound, ruckler_grenze_ms: r1(hitchMs),
    },
    bildzeit_ms: stats(dt), cpu_ms: stats(cpu), verspaetung_ms: stats(late), gpu_ms: gpuS ?? 'nicht verfügbar (Gerät ohne Zeitstempel)',
    verteilung_ms: hist, bausteine_ms: secStats,
    ruckler_spalten: ['t_s', 'bild_ms', 'cpu_ms', 'verspaetung_ms', 'gpu_ms', 'groesste_bausteine', 'aufrufe', 'dreiecke_k', 'aufloesung', 'z_m', 'kmh', 'kamera', 'gegner', 'ereignisse'],
    ruckler_liste: hitchRows,
    verlauf_spalten: ['t_s', 'z_m', 'kmh', 'fps', 'max_ms', 'cpu_ms', 'cpu_max', 'verspaetung_max', 'gpu_ms', 'ruckler', 'aufrufe', 'dreiecke_k', 'aufloesung', 'kamera', 'gegner'],
    verlauf_2s: timeline,
    ereignisse: r.events.slice(0, 150).map((e) => [r1(e.t), e.kind, e.text]),
  };
  const text = JSON.stringify(base);
  // vollständig: zusätzlich jedes Bild (Zeit, Bildzeit, Verspätung, CPU, Bausteine, GPU, Aufrufe, Dreiecke, z, Ereignis-Bits)
  const frames: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = [r2(r.t[i]), r2(dt[i]), r2(late[i]), r2(cpu[i])];
    for (let k = 0; k < NS; k++) row.push(r2(r.sec[i * NS + k]));
    row.push(r2(r.gpu[i]), r.calls[i], Math.round(r.tris[i] / 1000), Math.round(r.z[i]), r.ev[i]);
    frames.push(row);
  }
  const full = JSON.stringify({ ...base, bilder_spalten: ['t_s', 'bild_ms', 'verspaetung_ms', 'cpu_ms', ...SECTIONS, 'gpu_ms', 'aufrufe', 'dreiecke_k', 'z_m', 'ereignis_bits'], ereignis_bits: EV, bilder: frames });
  return { summary, text, full };
}
