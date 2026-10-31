/**
 * Spielzeit je Bild – im Takt des Bildschirms, und ein gleichmäßiger Bildtakt.
 *
 * Zwei Dinge machen ein Spiel ruckelig, auch wenn die Bildrate stimmt:
 *
 * 1. Ungleichmäßiger Takt. Ein 120-Hz-Telefon (ProMotion), das ein Bild nicht in 8,3 ms schafft, zeigt mal nach zwei
 *    Takten (16,7 ms) ein neues Bild, mal nach drei (25 ms) – im Mittel ~60 Bilder je Sekunde, aber unregelmäßig.
 *    Darum der feste Bildtakt: schafft das Gerät den vollen Takt nicht, wird jeder zweite (dritte …) Takt
 *    ausgelassen (ready) – dann kommt jedes Bild genau nach 16,7 ms.
 * 2. Spielzeit, die nicht zur Anzeigezeit passt. Jedes Bild rückt die Welt genau um die Zeit vor, die es zu sehen
 *    sein wird: den Abstand zum vorigen Bild, auf ganze Bildschirmtakte gerundet. (Safari rundet die Zeitstempel
 *    auf ganze Millisekunden – 17, 17, 16 ms –, die Rundung auf den Takt nimmt dieses Rauschen heraus.) Fällt ein
 *    Bild aus, stand das alte doppelt so lange da – das nächste rückt dann auch doppelt so weit (die Bewegung bleibt
 *    gleichmäßig; ein „sanftes Nachholen“ über mehrere Bilder ließe die Welt erst hängen und dann eilen).
 *    Eine kleine Korrektur hält die Spielzeit auf Dauer genau bei der echten.
 * - Nach langen Pausen (App im Hintergrund) wird nichts nachgeholt.
 */
export class FrameClock {
  /** Bildschirmtakt (ms): kürzester regelmäßiger Abstand der Aufrufe (60, 90, 120, 144 Hz …) */
  period = 1000 / 60;
  /** Takte je Bild (1 = voller Bildschirmtakt; 2 auf 120 Hz = 60 Bilder je Sekunde) */
  div = 1;
  /** echter Abstand zum vorigen gezeichneten Bild (s) – für Bildraten-Anzeige und Qualitätsregelung */
  raw = 0;
  /** echte Zeit, die das Spiel noch nachholen muss (ms; negativ: ist voraus) */
  private owed = 0;
  private prev: number;
  /** Abstände der Aufrufe (für den Takt) und der gezeichneten Bilder (für den festen Bildtakt) */
  private hist = new Float64Array(64);
  private n = 0;
  private k = 0;
  private frames = new Float64Array(90);
  private fn = 0;
  private fk = 0;
  private lastCall: number;
  /** fester Bildtakt eingeschaltet (ready lässt Aufrufe aus) */
  pace = true;
  private measured = false;

  constructor(start = performance.now()) {
    this.prev = start;
    this.lastCall = start;
  }

  /** Abstand der Bilder im festen Takt (ms) */
  get target(): number { return this.period * this.div; }

  /**
   * Soll in diesem Aufruf (requestAnimationFrame) gezeichnet werden? Lernt nebenbei den Bildschirmtakt; im festen
   * Bildtakt kommen Aufrufe, die zu früh sind, nicht zum Zug.
   */
  ready(now: number): boolean {
    const call = now - this.lastCall;
    this.lastCall = now;
    if (call > 0 && call < 100) {
      this.hist[this.k] = call;
      this.k = (this.k + 1) & 63;
      if (this.n < 64) this.n += 1;
      if ((this.k & 15) === 0 && this.n >= 16) this.measure();
    }
    if (!this.pace || this.div <= 1) return true;
    // (halber Takt Spielraum: verrauschte Stempel lassen kein Bild fälschlich aus)
    return now - this.prev >= this.target - this.period * 0.5;
  }

  /** Zeitstempel des gezeichneten Bildes → Spielzeit für dieses Bild (s) */
  tick(now: number): number {
    const raw = now - this.prev;
    this.prev = now;
    this.raw = Math.max(0, raw) / 1000;
    if (!(raw > 0)) return 0;
    // lange Pause (Hintergrund, Ladepause): nichts nachholen
    if (raw > 250) {
      this.owed = 0;
      return this.target / 1000;
    }
    this.learnPace(raw);
    // auf ganze Bildschirmtakte gerundet (mindestens der feste Bildtakt)
    const P = this.period;
    const steps = Math.max(this.div, Math.round(raw / P));
    let dt = steps * P;
    // auf Dauer genau mit der echten Zeit (kleine Korrektur, unmerklich)
    this.owed += raw - dt;
    if (Math.abs(this.owed) > 2 * P) this.owed = Math.sign(this.owed) * 2 * P;
    const fix = Math.max(-0.04 * dt, Math.min(0.04 * dt, this.owed * 0.05));
    dt += fix;
    this.owed -= fix;
    return dt / 1000;
  }

  /**
   * fester Bildtakt: verpasst mehr als jedes achte Bild seinen Takt, ein Takt mehr je Bild; zurückgenommen wird
   * das nicht – ein Wechsel hin und her wäre selbst ein Ruckler.
   */
  private learnPace(raw: number) {
    if (raw >= 100) return;
    this.frames[this.fk] = raw;
    this.fk = (this.fk + 1) % this.frames.length;
    if (this.fn < this.frames.length) this.fn += 1;
    if (!this.pace || this.fn < this.frames.length || this.fk !== 0) return;
    const T = this.target;
    let late = 0;
    for (let i = 0; i < this.fn; i++) if (this.frames[i] > T * 1.25 + 1) late += 1;
    // nie langsamer als 45 Bilder je Sekunde (auf 120 Hz also höchstens jeder zweite Takt: 60 je Sekunde) – reicht
    // das nicht, ist es Sache der Auflösungsregelung
    if (late > this.fn / 8 && this.period * (this.div + 1) <= 1000 / 45 + 0.5) {
      this.div += 1;
      this.fn = 0;
      this.fk = 0;
    }
  }

  /**
   * Bildschirmtakt aus den Abständen der Aufrufe: der längste übliche Takt (60, 75, 90, 120, 144 Hz …), zu dem fast
   * alle Abstände als ganze Vielfache passen. Ein 120-Hz-Telefon, das nur jeden zweiten oder dritten Takt schafft,
   * ruft im Abstand 16,7 und 25 ms auf – das passt nur zu 8,3 ms, nicht zu 16,7.
   */
  private measure() {
    const a = this.hist.subarray(0, this.n);
    // je Takt: mittlere Abweichung zum nächsten Vielfachen und Anteil grober Abweichungen (> 4 ms – Rauschen der
    // Stempel ist kleiner, ein falscher Takt liegt um einen halben daneben)
    const errs: number[] = [];
    const outs: number[] = [];
    for (const P of RATES) {
      let err = 0;
      let out = 0;
      for (const x of a) { const e = Math.abs(x - Math.max(1, Math.round(x / P)) * P); err += e; if (e > 4) out += 1; }
      errs.push(err / a.length);
      outs.push(out / a.length);
    }
    // der längste, der zu fast allen Abständen passt, fast so gut wie der beste – und ein ganzes Vielfaches von ihm
    // ist (60 Hz zu 240 Hz ja; 72 Hz zu 75 Hz nicht)
    const emin = Math.min(...errs);
    const Pb = RATES[errs.indexOf(emin)];
    const i = errs.findIndex((e, k) => { const r = RATES[k] / Pb; return outs[k] < 0.06 && e < emin + 0.6 && Math.abs(r - Math.round(r)) < 0.03; });
    if (i < 0) return;
    const best = RATES[i];
    // anderer Takt erkannt: beim ersten Mal (statt der angenommenen 60 Hz) erst einmal jeden Takt versuchen; später
    // (der Browser ruft mal in jedem, mal nur in jedem zweiten Takt auf) bleibt die Zeit je Bild, wie sie ist
    if (Math.abs(best - this.period) > 0.08 * this.period) {
      const t = this.target;
      this.period = best;
      this.div = this.measured ? Math.max(1, Math.round(t / best)) : 1;
      this.fn = 0;
      this.fk = 0;
    }
    this.measured = true;
  }
}

/** übliche Bildschirmtakte (ms), längster zuerst */
const RATES = [60, 72, 75, 90, 100, 120, 144, 165, 240].map((hz) => 1000 / hz);
