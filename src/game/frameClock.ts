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
 *    sein wird: den Abstand zum vorigen Bild in ganzen Bildschirmtakten. Fällt ein Bild aus, stand das alte doppelt so
 *    lange da – das nächste rückt dann auch doppelt so weit (die Bewegung bleibt gleichmäßig; ein „sanftes Nachholen"
 *    über mehrere Bilder ließe die Welt erst hängen und dann eilen). Eine kleine Korrektur hält die Spielzeit auf
 *    Dauer genau bei der echten.
 * - Nach langen Pausen (App im Hintergrund) wird nichts nachgeholt.
 *
 * Safari auf dem iPhone liefert keine sauberen Takt-Zeitstempel: es ist die Zeit, zu der das Skript drankommt –
 * auf ganze Millisekunden gerundet und oft ein paar Millisekunden nach dem Takt, mal zwei Aufrufe kurz
 * hintereinander. Darum:
 * - Bildschirmtakt auf Apple-Telefonen und -Tablets nur 60 oder 120 Hz (andere gibt es dort nicht). Früher lasen
 *   sich die verrauschten Abstände als 240, 165, 144 oder 72 Hz: daraus wurden Bildtakte von 12,5 oder 13,9 ms, die
 *   auf dem 120-Hz-Schirm mal ein, mal zwei Takte stehen (Mikroruckeln), und bei „240 Hz, jeder 4. Takt" fielen
 *   ganze Bilder aus (33 ms).
 * - Ein einmal erkannter schneller Takt bleibt. Wartet die Grafik, kommen auch auf dem 120-Hz-Schirm nur noch Aufrufe
 *   alle 16,7 ms – das ist kein 60-Hz-Schirm (früher: Takt „60 Hz", fester Bildtakt aus, das Bild sprang wieder
 *   zwischen 8,3 und 16,7 ms).
 * - Wann ein Bild dran ist, zählt sich an den Aufrufen seit dem letzten Bild (Safari ruft zu jedem Takt, auch
 *   während die Grafik noch arbeitet); fehlt ein Aufruf, entscheidet das gleichmäßige Raster der gezeichneten Bilder,
 *   nicht der verrauschte Zeitstempel des letzten. Das Raster liegt an den frühesten Stempeln (die nie vor ihrem
 *   Takt liegen); ein Stempel bis 7 ms nach seinem Takt gehört noch zu diesem. Mit nur einem halben Takt Spielraum
 *   nach der Zeit allein galt auf dem iPhone jeder fünfte Aufruf als ein Takt später (Spielzeit sprang um einen
 *   halben Takt vor und zurück), und 3–4 % der Bilder kamen schon nach einem Takt (als Ruckler zu sehen).
 */
/**
 * Spielraum fürs Zeichnen (Anteil eines Takts): fehlte ein Aufruf, ist ein Bild dran, sobald sein Takt im Raster bis
 * auf so viel erreicht ist (Stempel liegen nie vor ihrem Takt)
 */
const SLACK = 0.15;
/**
 * so viele ms nach seinem Takt gilt ein Stempel als ein Takt später (verpasstes Bild). Safari-Stempel sind bis zu
 * einigen ms spät, ohne dass ein Bild fehlt – ein halber Takt (4 ms auf 120 Hz) war zu wenig: jeder fünfte Aufruf
 * galt als verpasst, die Spielzeit sprang um einen halben Takt vor und wieder zurück
 */
const LATE_MS = 7;

/** fester Bildtakt für alle Uhren aus (Wechseltest der Messfahrt: jeder Aufruf zeichnet) */
let paceOff = false;
export function setPaceOff(off: boolean) { paceOff = off; }
export function isPaceOff(): boolean { return paceOff; }
/**
 * mehr Takte je Bild erzwingen (Wechseltest der Messfahrt: 3 auf 120 Hz = 40 Bilder je Sekunde; 0 = wie gelernt).
 * Gilt nur, wenn es mehr sind als gelernt, und nur auf schnellen Schirmen (unter 10 ms Takt) – auf 60 Hz wären drei
 * Takte 20 Bilder je Sekunde
 */
let paceDivForce = 0;
export function setPaceDivForce(d: number) { paceDivForce = d; }
/**
 * Apple-Gerät, dessen Browser mit 120 Hz aufruft (Safari ohne „Prefer Page Rendering Updates near 60fps“). Messfahrten
 * 261–267: mit 120-Hz-Aufrufen lässt Safari bei 8–13 ms Grafik je Bild laufend einzelne Takte aus (30–90 Ruckler je
 * Minute), mit 60-Hz-Aufrufen (Chrome auf iOS, Safari mit der Einstellung) dieselbe Szene fast keinen – jeder Aufruf
 * samt Antwort des Systems muss bei 120 Hz in 8,3 ms durch, bei 60 in 16,7. Das Spiel zeichnet ohnehin 60 je Sekunde
 */
let fastTicks = false;
export function fastTicksSeen(): boolean { return fastTicks; }
/**
 * Wechseltest „Bildaufrufe halbieren“: nach einem gezeichneten Bild den nächsten Aufruf nicht sofort anfordern,
 * sondern über einen Zeitgeber ~12 ms nach dem Takt – so fällt er auf den übernächsten 120-Hz-Takt (einer je 16,7 ms
 * statt einer je Takt), und Safari hat je Bild nur einen Aufruf samt Antwort zu schaffen, wie mit 60-Hz-Aufrufen
 */
let halfCalls = false;
export function setHalfCalls(on: boolean) { halfCalls = on; }
let halfTimer = 0;
let halfRaf = 0;
/** nächsten Aufruf anfordern (now: Stempel des laufenden Aufrufs; drew: in ihm wurde gezeichnet) */
export function requestNext(loop: FrameRequestCallback, clock: FrameClock, now: number, drew: boolean): number {
  if (!(halfCalls && drew && clock.period < 10)) return requestAnimationFrame(loop);
  const delay = Math.max(1, Math.round(now + 12 - performance.now()));
  halfTimer = window.setTimeout(() => { halfTimer = 0; halfRaf = requestAnimationFrame(loop); }, delay);
  return 0;
}
export function cancelNext(raf: number) {
  if (raf) cancelAnimationFrame(raf);
  if (halfTimer) { clearTimeout(halfTimer); halfTimer = 0; }
  if (halfRaf) { cancelAnimationFrame(halfRaf); halfRaf = 0; }
}

export class FrameClock {
  /** Bildschirmtakt (ms): kürzester regelmäßiger Abstand der Aufrufe (60, 90, 120, 144 Hz …) */
  period = 1000 / 60;
  /** Takte je Bild (1 = voller Bildschirmtakt; 2 auf 120 Hz = 60 Bilder je Sekunde) */
  div = 1;
  /** echter Abstand zum vorigen gezeichneten Bild (s) – für Bildraten-Anzeige und Qualitätsregelung */
  raw = 0;
  /** fester Bildtakt eingeschaltet (ready lässt Aufrufe aus) */
  pace = true;
  /** zählt bei jeder Änderung von Takt oder Takten je Bild hoch (für die Messfahrt) */
  changes = 0;
  /** das zuletzt gezeichnete Bild kam so viele Bildschirmtakte zu spät (0 = pünktlich; für die Automatik) */
  slip = 0;
  /** Stempel des zuletzt gezeichneten Bildes gegenüber seinem Takt im Raster (ms, vor dem Nachführen; Messfahrt) */
  off = 0;
  /** Aufrufe seit dem vorigen gezeichneten Bild, mit dem gezeichneten (Messfahrt) */
  callsLast = 0;
  /** echte Zeit, die das Spiel noch nachholen muss (ms; negativ: ist voraus) */
  private owed = 0;
  private prev: number;
  /** Rasterzeit des letzten gezeichneten Bildes (geglättet: folgt den Zeitstempeln langsam, ohne ihr Rauschen) */
  private due: number;
  /** Abstände der Aufrufe (für den Takt) */
  private hist = new Float64Array(64);
  private n = 0;
  private k = 0;
  private lastCall: number;
  private measured = false;
  /** mögliche Takte (ms), längster zuerst */
  private rates: number[];
  private apple: boolean;
  /** Messungen in Folge, die für einen anderen Takt sprechen */
  private pendP = 0;
  private pend = 0;
  /** Aufrufe seit dem letzten gezeichneten Bild (mit dem laufenden) */
  private calls = 0;
  /** fester Bildtakt: verspätete Bilder im laufenden Fenster */
  private seen = 0;
  private late = 0;
  private window = 30;

  constructor(start = performance.now(), o: { apple?: boolean } = {}) {
    this.prev = start;
    this.due = start;
    this.lastCall = start;
    this.apple = o.apple ?? appleDevice();
    this.rates = (this.apple ? [60, 120] : RATES_HZ).map((hz) => 1000 / hz);
  }

  /** Takte je Bild, die gerade gelten (gelernt oder erzwungen, s. setPaceDivForce) */
  get divNow(): number { return paceDivForce > this.div && this.period < 10 ? paceDivForce : this.div; }

  /** Abstand der Bilder im festen Takt (ms) */
  get target(): number { return this.period * this.divNow; }

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
    this.calls += 1;
    const div = this.divNow;
    if (!this.pace || paceOff || div <= 1) return true;
    // dran, wenn seit dem letzten Bild so viele Aufrufe kamen, wie Takte je Bild gelten (Safari ruft zu jedem Takt,
    // auch während die Grafik noch arbeitet) – oder, fehlte ein Aufruf (der Browser war aufgehalten), wenn das
    // nächste Bild im Raster fast erreicht ist. Nicht nach der Zeit allein: ein Aufruf, der 5 ms spät dran ist, sähe
    // sonst wie der nächste Takt aus, und das Bild käme nach 8 statt 17 ms (ein Doppel, das als Ruckler zu sehen ist)
    return this.calls >= div || now >= this.due + (div - SLACK) * this.period;
  }

  /** Zeitstempel des gezeichneten Bildes → Spielzeit für dieses Bild (s) */
  tick(now: number): number {
    const raw = now - this.prev;
    this.prev = now;
    this.raw = Math.max(0, raw) / 1000;
    this.slip = 0;
    if (!(raw > 0)) return 0;
    // lange Pause (Hintergrund, Ladepause): nichts nachholen, Raster neu beginnen
    if (raw > 250) {
      this.owed = 0;
      this.due = now;
      return this.target / 1000;
    }
    const P = this.period;
    // Aufrufe schneller als der angenommene Takt (er ist noch nicht erkannt): echte Zeit, Raster neu
    if (raw < P * 0.7) {
      this.due = now;
      this.owed = 0;
      return raw / 1000;
    }
    // ganze Bildschirmtakte seit dem letzten Bild im Raster (mindestens der feste Bildtakt); ein Stempel bis LATE_MS
    // nach seinem Takt gehört noch zu diesem
    const div = this.divNow;
    const steps = Math.max(paceOff ? 1 : div, 1 + Math.floor((now - this.due - LATE_MS) / P));
    this.slip = Math.max(0, steps - div);
    this.off = now - (this.due + div * P);
    this.callsLast = this.calls;
    this.calls = 0;
    this.due += steps * P;
    // Raster an den frühesten Stempeln ausrichten: ein früherer Stempel setzt es sofort, späteren folgt es nur
    // langsam (kleine Abweichung des Takts) – so liegt es dort, wo die Takte wirklich sind, nicht im Mittel der
    // Verspätungen
    if (now < this.due) this.due = now;
    else this.due += (now - this.due) * 0.03;
    this.learnPace(steps, div);
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
   * das nicht – ein Wechsel hin und her wäre selbst ein Ruckler. Das erste Fenster nach dem Erkennen des Takts ist
   * kurz (30 Bilder: auf 120 Hz eine Viertelsekunde volle Rate versuchen), danach 90 Bilder. Nie seltener als 60
   * Bilder je Sekunde, in keiner Grafikstufe: der feste Takt glättet nur 120 Hz zu gleichmäßigen 60, er bremst nie
   * darunter.
   */
  private learnPace(steps: number, div: number) {
    if (!this.pace) return;
    this.seen += 1;
    if (steps > div) this.late += 1;
    if (this.seen < this.window) return;
    // nie seltener als 60 Bilder je Sekunde (auf 120 Hz also höchstens jeder zweite Takt) – schafft das Gerät das
    // nicht, hilft eine kleinere Auflösung oder Grafikstufe
    if (this.late > this.seen / 8 && this.div + 1 <= maxDiv(this.period)) {
      this.div += 1;
      this.changes += 1;
    }
    this.seen = 0;
    this.late = 0;
    this.window = 90;
  }

  /** Bildschirmtakt aus den Abständen der Aufrufe (alle 16 Aufrufe über die letzten 64) */
  private measure() {
    const a = this.hist.subarray(0, this.n);
    const best = this.apple ? measureApple(a) : measureAny(a, this.rates);
    if (best === null) return;
    if (Math.abs(best - this.period) <= 0.08 * this.period) {
      this.pend = 0;
      this.measured = true;
      return;
    }
    // beim ersten Mal (statt der angenommenen 60 Hz) gilt die Messung gleich
    if (!this.measured) { this.adopt(best); return; }
    // später: ein schnellerer Takt erst nach zwei Messungen in Folge; ein langsamerer nie auf Apple-Geräten (dort
    // heißt das nur, dass die Grafik wartet) und sonst nur, wenn der bisherige Takt zu den Aufrufen gar nicht mehr
    // passt (drei Messungen in Folge – anderer Schirm, Stromsparmodus mit anderem Takt)
    const faster = best < this.period;
    if (!faster && (this.apple || fits(a, this.period))) { this.pend = 0; return; }
    if (this.pendP && Math.abs(this.pendP - best) <= 0.08 * best) this.pend += 1;
    else { this.pendP = best; this.pend = 1; }
    if (this.pend >= (faster ? 2 : 3)) this.adopt(best);
  }

  private adopt(best: number) {
    const t = this.target;
    this.period = best;
    if (this.apple && best < 10) fastTicks = true;
    // beim ersten Mal jeden Takt versuchen; später bleibt die Zeit je Bild, wie sie ist (nie seltener als 60 je s:
    // eine Fehlerkennung ergab sonst Bildtakte von 20–25 ms)
    this.div = this.measured ? Math.max(1, Math.min(maxDiv(best), Math.round(t / best))) : 1;
    this.measured = true;
    this.pend = 0;
    this.pendP = 0;
    this.seen = 0;
    this.late = 0;
    this.window = 30;
    this.changes += 1;
  }
}

/** Apple-Telefon oder -Tablet (auch ein iPad, das sich als Mac meldet): Schirm mit 60 oder 120 Hz */
export function appleDevice(): boolean {
  try {
    const nav = (globalThis as { navigator?: { userAgent?: string; maxTouchPoints?: number } }).navigator;
    const ua = nav?.userAgent ?? '';
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1);
  } catch { return false; }
}

/**
 * Apple: 120 Hz, sobald ein guter Teil der Aufrufe im Abstand eines 120-Hz-Takts kommt (6,7 – 10 ms). Ein 60-Hz-Schirm
 * ruft nur im Abstand von 16,7 ms auf (verrauscht um wenige ms) – so kurz nie in Menge.
 */
function measureApple(a: Float64Array): number {
  const P = 1000 / 120;
  let one = 0;
  // (Index-Schleifen: for…of über ein Float64Array legt je Schritt ein Objekt an – alle 16 Aufrufe 64 Stück)
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - P) <= 1.7) one += 1;
  return one / a.length >= 0.15 ? P : 1000 / 60;
}

/** passen die Abstände zu ganzen Vielfachen von P? (höchstens ein Viertel daneben) */
function fits(a: Float64Array, P: number): boolean {
  const tol = Math.max(1.5, 0.2 * P);
  let off = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i]; if (Math.abs(x - Math.max(1, Math.round(x / P)) * P) > tol) off += 1; }
  return off / a.length <= 0.25;
}

/**
 * Andere Geräte: der längste übliche Takt (60, 75, 90, 120, 144 Hz …), zu dem fast alle Abstände als ganze Vielfache
 * passen. Ein 120-Hz-Schirm, der nur jeden zweiten oder dritten Takt schafft, ruft im Abstand 16,7 und 25 ms auf –
 * das passt nur zu 8,3 ms, nicht zu 16,7.
 */
function measureAny(a: Float64Array, rates: number[]): number | null {
  // je Takt: mittlere Abweichung zum nächsten Vielfachen und Anteil grober Abweichungen (> 4 ms – Rauschen der
  // Stempel ist kleiner, ein falscher Takt liegt um einen halben daneben)
  const errs: number[] = [];
  const outs: number[] = [];
  // Anteil einfacher Takte: ein Takt muss sich selbst zeigen – unter Last kommen Aufrufe auch nach 12,5 oder 21 ms;
  // das passt zu 240 Hz (3 und 5 Takte), aber kein Aufruf kommt je nach 4 ms
  const ones: number[] = [];
  for (const P of rates) {
    let err = 0;
    let out = 0;
    let one = 0;
    for (let i = 0; i < a.length; i++) { const x = a[i]; const e = Math.abs(x - Math.max(1, Math.round(x / P)) * P); err += e; if (e > 4) out += 1; if (x < P * 1.5) one += 1; }
    errs.push(err / a.length);
    outs.push(out / a.length);
    ones.push(one / a.length);
  }
  // der längste, der zu fast allen Abständen passt, fast so gut wie der beste – und ein ganzes Vielfaches von ihm
  // ist (60 Hz zu 240 Hz ja; 72 Hz zu 75 Hz nicht)
  const emin = Math.min(...errs);
  const Pb = rates[errs.indexOf(emin)];
  const i = errs.findIndex((e, k) => { const r = rates[k] / Pb; return outs[k] < 0.06 && e < emin + 0.6 && Math.abs(r - Math.round(r)) < 0.03 && ones[k] >= 0.15; });
  return i < 0 ? null : rates[i];
}

/**
 * höchstens so viele Takte je Bild, dass es mindestens 60 Bilder je Sekunde bleiben. Der feste Takt soll nur das
 * Springen zwischen 60 und 120 glätten – nie selbst bremsen: ein falsch erkannter Takt (90, 144 oder 240 statt
 * 120 Hz) mit einem Bildabstand zwischen 17 und 25 ms wird auf dem echten 120-Hz-Schirm zu 25 ms.
 */
export function maxDiv(period: number): number {
  return Math.max(1, Math.floor((1000 / 60 + 1) / period));
}

/** Takt in Worten (Messfahrt): „120 Hz, jeder 2. Takt → 16,7 ms" */
export function paceText(c: FrameClock): string {
  return `${Math.round(1000 / c.period)} Hz erkannt${c.divNow > 1 ? `, jeder ${c.divNow}. Takt` : ''} → Bild alle ${c.target.toFixed(1)} ms`;
}

/** übliche Bildschirmtakte (Hz), längster Takt zuerst */
const RATES_HZ = [60, 72, 75, 90, 100, 120, 144, 165, 240];
