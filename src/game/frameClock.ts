/**
 * Spielzeit je Bild – gleichmäßig im Takt des Bildschirms.
 *
 * Die Zeitstempel der Browser rauschen: Safari rundet sie auf ganze Millisekunden (gerechnet wurde 17 – 17 – 16 ms,
 * der Bildschirm zeigt aber genau alle 16,7 ms ein Bild), und ist der Browser gerade beschäftigt, kommt der Stempel
 * etwas später. Die Welt rückte dadurch ungleichmäßig vor. An den Fahrern sieht man das nicht (sie fahren mit der
 * Kamera), an der vorbeiziehenden Welt schon.
 *
 * - Ein Schritt ist ein Bildschirmtakt (gemessen: 60, 90, 120 Hz …; schafft das Gerät nur jeden zweiten Takt,
 *   eben zwei). Abweichungen gleicht die Uhr sanft aus – auf Dauer läuft die Spielzeit genau mit der echten.
 * - Fällt ein Bild aus, springt die Welt danach nicht doppelt so weit: die verlorene Zeit wird über die folgenden
 *   Bilder nachgeholt (je Bild höchstens ein Viertel mehr).
 * - Nach langen Pausen (App im Hintergrund) wird nichts nachgeholt.
 */
export class FrameClock {
  /** Bildschirmtakt (ms) */
  period = 1000 / 60;
  /** echter Abstand zum vorigen Bild (s) – für Bildraten-Anzeige und Qualitätsregelung */
  raw = 0;
  /** geglätteter Abstand der Bilder (ms) */
  private avg = 1000 / 60;
  /** echte Zeit, die das Spiel noch nachholen muss (ms; negativ: ist voraus) */
  private owed = 0;
  private prev: number;
  private hist = new Float64Array(64);
  private n = 0;
  private k = 0;

  constructor(start = performance.now()) {
    this.prev = start;
  }

  /** Abstand eines Bildes im gleichmäßigen Lauf (ms): ein oder mehrere Bildschirmtakte */
  get cadence(): number {
    const m = Math.max(1, Math.round(this.avg / this.period));
    // passt der Lauf zum Raster, genau das Raster – sonst (z. B. abwechselnd ein und zwei Takte) der Mittelwert
    return Math.abs(this.avg - m * this.period) < 0.15 * m * this.period ? m * this.period : this.avg;
  }

  /** Zeitstempel aus requestAnimationFrame → Spielzeit für dieses Bild (s) */
  tick(now: number): number {
    const raw = now - this.prev;
    this.prev = now;
    this.raw = Math.max(0, raw) / 1000;
    if (!(raw > 0)) return 0;
    // lange Pause (Hintergrund, Ladepause): nichts nachholen
    if (raw > 250) {
      this.owed = 0;
      return this.cadence / 1000;
    }
    if (raw < 100) {
      this.hist[this.k] = raw;
      this.k = (this.k + 1) & 63;
      if (this.n < 64) this.n += 1;
      if ((this.k & 15) === 0 && this.n >= 16) this.measure();
      this.avg += (raw - this.avg) * 0.04;
    }
    const cad = this.cadence;
    this.owed += raw;
    // sanft ausgleichen: Rauschen der Stempel fällt fast ganz weg, ein ausgefallenes Bild wird über die nächsten
    // Bilder nachgeholt statt in einem Sprung
    const fix = Math.max(-0.2 * cad, Math.min(0.25 * cad, (this.owed - cad) * 0.15));
    const dt = cad + fix;
    this.owed -= dt;
    // längere Hänger nicht vollständig nachholen (wie bisher höchstens ein paar Bilder)
    this.owed = Math.max(-cad, Math.min(3 * cad, this.owed));
    return dt / 1000;
  }

  /** Bildschirmtakt aus den letzten Abständen: die kurzen (ein Takt), gemittelt – ganze ms von Safari mitteln sich weg */
  private measure() {
    const a = Array.from(this.hist.subarray(0, this.n)).sort((x, y) => x - y);
    const q = a[Math.floor(a.length * 0.25)];
    let s = 0;
    let c = 0;
    for (const x of a) if (x >= q * 0.8 && x <= q * 1.25) { s += x; c += 1; }
    if (c >= 8) this.period = s / c;
  }
}
