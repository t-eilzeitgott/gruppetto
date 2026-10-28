/**
 * Regelt Sichtweite und Auflösung der 3D-Welt nach der Bildzeit.
 *
 * - Zu langsam: zuerst die Sichtweite Stufe für Stufe kürzer (weniger Landschaft, Bäume und Nachladen je Bild),
 *   erst bei der kürzesten Sichtweite die Auflösung. Wieder flüssig: erst die Auflösung zurück, dann die Sichtweite.
 *
 * - Maß ist die Bildzeit, die 60 % der Bilder eines Fensters (~1,6 s) unterschreiten: Ruckler beim Nachladen
 *   der Landschaft, beim Übersetzen neuer Shader oder von der Speicherbereinigung treffen nur einzelne Bilder
 *   und zählen so nicht – die Auflösung hilft gegen sie ohnehin nicht. Zu langsam heißt: mehr als 40 % der
 *   Bilder brauchen länger als 18,8 ms (unter 53 Bilder je Sekunde), egal ob der Bildschirm 60 oder 120 Hz hat.
 * - Die ersten Sekunden einer Fahrt zählen nicht (Shader, Landschaft rund um den Start).
 * - Bringt ein Schritt (fast) nichts, wird er zurückgenommen: eine kürzere Sichtweite ohne Wirkung heißt, die
 *   Landschaft ist nicht das Problem – dann wird die Auflösung probiert; eine kleinere Auflösung ohne Wirkung
 *   heißt, die Grenze ist die Rechenzeit – dann wird nicht weiter gesenkt, sonst würde es nur unscharf.
 * - Länger flüssig: wieder schärfer, zunächst nur bis zu einer Stufe, die noch nicht zu langsam war; bleibt es
 *   dort länger ruhig, wird auch diese Grenze wieder angehoben (ein Ruckler zu Beginn soll nicht die ganze
 *   Fahrt unscharf halten). Danach die Sichtweite wieder weiter.
 * - Beide Stufen merkt sich das Gerät für die nächste Fahrt.
 */
import { canDropRange, rangeDrop, setRangeDrop } from './viewRange';

const KEY = 'gruppetto.gfx';

export function storedQuality(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (v >= 0.5 && v <= 1) return v;
  } catch { /* kein Speicher */ }
  return 1;
}

function store(q: number) {
  try { localStorage.setItem(KEY, q.toFixed(2)); } catch { /* egal */ }
}

/** Bildzeit, ab der ein Bild als langsam gilt (ms; unter 53 Bilder je Sekunde) */
const SLOW_MS = 18.8;
/** flüssig: deutlich unter der Grenze (sonst pendelt es) */
const CALM_MS = 17.6;
/** Anlaufzeit je Fahrt (s), die nicht zählt */
const WARMUP_S = 2.5;
/** Fenster (s) und Mindestzahl Bilder darin */
const WINDOW_S = 1.6;
const MIN_FRAMES = 12;

export class QualityGovernor {
  private dts: number[] = [];
  private t = 0;
  private warm = 0;
  /** Obergrenze der Auflösung in dieser Fahrt: eine Stufe, die zu langsam war – erholt sich nach längerer Ruhe */
  private ceil = 1;
  /** letzter Schritt nach unten: war es danach nicht besser, zurück und nicht weiter */
  private probe: { kind: 'range' | 'quality'; from: number; p60: number } | null = null;
  private calm = 0;
  private cpuBound = false;
  /** kürzere Sichtweite hat nichts gebracht: bis zur nächsten Erholung nur noch die Auflösung */
  private rangeStuck = false;
  /** nach einer Änderung ein Fenster abwarten (Umbau der Landschaft ruckelt selbst) */
  private settle = 0;

  constructor(private min = 0.5) {}

  /**
   * ein Bild der Fahrt (echte Zeit seit dem letzten, s). Die Sichtweite stellt der Regler selbst um
   * (setRangeDrop); eine neue Auflösungsstufe liefert er zurück, sonst null.
   */
  frame(dt: number, q: number): number | null {
    if (dt <= 0 || dt > 0.25) return null;
    if (this.warm < WARMUP_S) { this.warm += dt; return null; }
    this.dts.push(dt * 1000);
    this.t += dt;
    if (this.t < WINDOW_S) return null;
    const a = this.dts.sort((x, y) => x - y);
    const n = a.length;
    const p60 = a[Math.min(n - 1, Math.floor(n * 0.6))];
    this.dts = [];
    this.t = 0;
    // zu wenige Bilder (App im Hintergrund, Karte offen): kein Urteil
    if (n < MIN_FRAMES) return null;
    if (this.settle > 0) { this.settle -= 1; return null; }
    const slow = p60 > SLOW_MS;
    if (this.probe) {
      const pr = this.probe;
      this.probe = null;
      // Senken hat (fast) nichts gebracht: zurück und dabei bleiben
      if (slow && p60 > pr.p60 * 0.93) {
        this.settle = 1;
        if (pr.kind === 'range') { this.rangeStuck = true; setRangeDrop(pr.from); return null; }
        this.cpuBound = true;
        store(pr.from);
        return pr.from;
      }
    }
    if (slow && !this.cpuBound) {
      this.calm = 0;
      this.settle = 1;
      // erst die Sichtweite kürzer …
      if (canDropRange() && !this.rangeStuck) {
        this.probe = { kind: 'range', from: rangeDrop(), p60 };
        setRangeDrop(rangeDrop() + 1);
        return null;
      }
      // … erst bei der kürzesten die Auflösung
      if (q > this.min + 1e-3) {
        this.ceil = Math.min(this.ceil, q - 0.04);
        this.probe = { kind: 'quality', from: q, p60 };
        const nq = Math.max(this.min, q - (p60 > 26 ? 0.2 : 0.1));
        store(nq);
        return nq;
      }
      return null;
    }
    if (!slow && p60 < CALM_MS) {
      this.calm += 1;
      // erst die Auflösung zurück (bis ganz an die Grenze; mit viel Luft in größeren Schritten) …
      if (this.calm >= 3 && q < this.ceil - 0.005) {
        this.calm = 0;
        const nq = Math.min(this.ceil, q + (p60 < 12 ? 0.12 : 0.06));
        store(nq);
        return nq;
      }
      if (this.calm >= 8 && this.ceil < 1) {
        // lange ruhig an der Grenze: die Grenze selbst wieder anheben und das Senken wieder erlauben
        this.calm = 0;
        this.ceil = Math.min(1, this.ceil + 0.06);
        this.cpuBound = false;
        this.rangeStuck = false;
        return null;
      }
      // … dann die Sichtweite (Umbau der Landschaft: erst nach längerer Ruhe und nur mit Luft)
      if (this.calm >= 6 && rangeDrop() > 0 && p60 < 14) {
        this.calm = 0;
        this.settle = 1;
        this.cpuBound = false;
        this.rangeStuck = false;
        setRangeDrop(rangeDrop() - 1);
      }
    } else this.calm = 0;
    return null;
  }
}
