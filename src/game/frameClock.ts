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
  /** zählt bei jeder Änderung von Takt oder Takten je Bild hoch (für die Messfahrt) */
  changes = 0;
  /**
   * so viele Bilder je Sekunde mindestens im festen Takt (60). Einfache Grafik: 30 – schafft ein langsames Gerät 60
   * nicht, kommt jedes Bild gleichmäßig nach 33 ms (auf 120 Hz erst nach 25), statt mal nach 17, mal nach 33
   */
  get minFps(): number { return this.floor; }
  set minFps(v: number) {
    if (v === this.floor) return;
    this.floor = v;
    // wieder schneller verlangt (einfache Grafik aus): nicht im langsameren Takt bleiben
    const m = maxDiv(this.period, v);
    if (this.div > m) { this.div = m; this.fn = 0; this.fk = 0; this.changes += 1; }
  }
  private floor = 60;

  /** neue Fahrt: ein langsamerer Takt als 60 je Sekunde aus der letzten Fahrt (Nachladen, warmes Telefon) gilt nicht weiter */
  resetSlow() {
    const m = maxDiv(this.period, 60);
    if (this.div > m) { this.div = m; this.fn = 0; this.fk = 0; this.changes += 1; }
  }

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
   * das nicht – ein Wechsel hin und her wäre selbst ein Ruckler. Unter 60 Bilder je Sekunde (nur mit einfacher
   * Grafik erlaubt) erst, wenn mehr als jedes vierte Bild zu spät kommt: ein paar verpasste Takte bei 60 sind besser
   * als gleichmäßige 40 oder 30.
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
    // nie seltener als 60 Bilder je Sekunde (auf 120 Hz also höchstens jeder zweite Takt) – reicht das nicht, ist es
    // Sache der Auflösungsregelung
    const slower = this.period * (this.div + 1) > 1000 / 60 + 1;
    if (late > this.fn / (slower ? 4 : 8) && this.div + 1 <= maxDiv(this.period, this.minFps)) {
      this.div += 1;
      this.changes += 1;
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
    // Anteil einfacher Takte: ein Takt muss sich selbst zeigen – unter Last ruft Safari auf dem 120-Hz-iPhone auch
    // nach 12,5 oder 21 ms auf; das passt zu 240 Hz (3 und 5 Takte), aber kein Aufruf kommt je nach 4 ms
    const ones: number[] = [];
    for (const P of RATES) {
      let err = 0;
      let out = 0;
      let one = 0;
      for (const x of a) { const e = Math.abs(x - Math.max(1, Math.round(x / P)) * P); err += e; if (e > 4) out += 1; if (x < P * 1.5) one += 1; }
      errs.push(err / a.length);
      outs.push(out / a.length);
      ones.push(one / a.length);
    }
    // der längste, der zu fast allen Abständen passt, fast so gut wie der beste – und ein ganzes Vielfaches von ihm
    // ist (60 Hz zu 240 Hz ja; 72 Hz zu 75 Hz nicht)
    const emin = Math.min(...errs);
    const Pb = RATES[errs.indexOf(emin)];
    const i = errs.findIndex((e, k) => { const r = RATES[k] / Pb; return outs[k] < 0.06 && e < emin + 0.6 && Math.abs(r - Math.round(r)) < 0.03 && ones[k] >= 0.15; });
    if (i < 0) return;
    const best = RATES[i];
    // anderer Takt erkannt: beim ersten Mal (statt der angenommenen 60 Hz) erst einmal jeden Takt versuchen; später
    // (der Browser ruft mal in jedem, mal nur in jedem zweiten Takt auf) bleibt die Zeit je Bild, wie sie ist
    if (Math.abs(best - this.period) > 0.08 * this.period) {
      const t = this.target;
      this.period = best;
      // nie seltener als 60 Bilder je Sekunde (wie in learnPace): eine Fehlerkennung (90 oder 240 statt 120 Hz)
      // ergab sonst einen Takt von 20–22 ms – auf dem 120-Hz-Schirm also 25 ms, 40 Bilder je Sekunde, und die
      // Auflösungsregelung senkte Auflösung und Sichtweite, obwohl das Gerät 60 schafft
      this.div = this.measured ? Math.max(1, Math.min(maxDiv(best, this.minFps), Math.round(t / best))) : 1;
      this.fn = 0;
      this.fk = 0;
      this.changes += 1;
    }
    this.measured = true;
  }
}

/**
 * höchstens so viele Takte je Bild, dass es mindestens 60 Bilder je Sekunde bleiben. Der feste Takt soll nur das
 * Springen zwischen 60 und 120 glätten – nie selbst bremsen: ein falsch erkannter Takt (90, 144 oder 240 statt
 * 120 Hz) mit einem Bildabstand zwischen 17 und 25 ms wird auf dem echten 120-Hz-Schirm zu 25 ms.
 */
export function maxDiv(period: number, minFps = 60): number {
  return Math.max(1, Math.floor((1000 / minFps + 1) / period));
}

/** Takt in Worten (Messfahrt): „120 Hz, jeder 2. Takt → 16,7 ms“ */
export function paceText(c: FrameClock): string {
  return `${Math.round(1000 / c.period)} Hz erkannt${c.div > 1 ? `, jeder ${c.div}. Takt` : ''} → Bild alle ${c.target.toFixed(1)} ms`;
}

/** übliche Bildschirmtakte (ms), längster zuerst */
const RATES = [60, 72, 75, 90, 100, 120, 144, 165, 240].map((hz) => 1000 / hz);
