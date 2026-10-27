/**
 * Regelt die Auflösung der 3D-Welt nach der Bildzeit.
 *
 * - Maß ist der Median der Bildzeiten (je ~1,6 s): einzelne Ruckler beim Nachladen der Landschaft
 *   verfälschen ihn nicht – darum zählen alle Bilder der Fahrt.
 * - Zu langsam: Auflösung senken. Bringt das nichts (Grenze ist die Rechenzeit, nicht die Grafik),
 *   wird zurückgestellt und nicht weiter gesenkt – sonst würde es nur unscharf.
 * - Länger flüssig: vorsichtig wieder schärfer, aber nie über eine Stufe, die schon zu langsam war.
 * - Die gefundene Stufe merkt sich das Gerät für die nächste Fahrt.
 */
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

export class QualityGovernor {
  private dts: number[] = [];
  private t = 0;
  private ceil = 1;
  private probe: { from: number; med: number } | null = null;
  private calm = 0;
  private cpuBound = false;

  constructor(private min = 0.5) {}

  /** ein Bild der Fahrt (echte Zeit seit dem letzten, s); liefert eine neue Stufe oder null */
  frame(dt: number, q: number): number | null {
    if (dt <= 0 || dt > 0.25) return null;
    this.dts.push(dt * 1000);
    this.t += dt;
    if (this.t < 1.6) return null;
    const a = this.dts.sort((x, y) => x - y);
    const med = a[a.length >> 1];
    const p80 = a[Math.floor(a.length * 0.8)];
    this.dts = [];
    this.t = 0;
    const slow = med > 18.8 || p80 > 26;
    if (this.probe) {
      const pr = this.probe;
      this.probe = null;
      // Senken hat (fast) nichts gebracht: zurück und dabei bleiben
      if (slow && med > pr.med * 0.93) {
        this.cpuBound = true;
        store(pr.from);
        return pr.from;
      }
    }
    if (slow && !this.cpuBound && q > this.min + 1e-3) {
      this.calm = 0;
      this.ceil = Math.min(this.ceil, q - 0.04);
      this.probe = { from: q, med };
      const nq = Math.max(this.min, q - (med > 26 ? 0.2 : 0.1));
      store(nq);
      return nq;
    }
    if (!slow && med < 17.6) {
      this.calm += 1;
      if (this.calm >= 4 && q < this.ceil - 0.05) {
        this.calm = 0;
        const nq = Math.min(this.ceil, q + 0.06);
        store(nq);
        return nq;
      }
    } else this.calm = 0;
    return null;
  }
}
