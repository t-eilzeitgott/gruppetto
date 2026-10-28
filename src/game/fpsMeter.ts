/**
 * Kleine Bildraten-Anzeige für Admins (unten links, blass): Bilder je Sekunde, mittlere und längste Bildzeit
 * der letzten halben Sekunde, Rechenzeit fürs Zeichnen und – bei den 3D-Spielen – die Auflösungsstufe.
 * Schreibt direkt ins DOM (kein React), zweimal je Sekunde.
 */
let enabled = false;

/** von der App gesetzt, sobald feststeht, wer angemeldet ist */
export function setFpsMeter(on: boolean) {
  enabled = on;
}

export class FpsMeter {
  private el: HTMLDivElement | null = null;
  private parent: HTMLElement | null;
  private n = 0;
  private sum = 0;
  private max = 0;
  private cpu = 0;
  private t0 = 0;

  /** die Anzeige entsteht erst beim Zeichnen: Wer Admin ist, steht beim Spielstart nicht immer schon fest */
  constructor(parent: HTMLElement | null) {
    this.parent = parent;
  }

  /** ein gezeichnetes Bild: Abstand zum vorigen (ms), Rechenzeit fürs Bild (ms), Auflösungsstufe (0–1, optional) */
  frame(intervalMs: number, cpuMs: number, quality?: number) {
    if (!enabled || !this.parent) {
      if (this.el) { this.el.remove(); this.el = null; }
      return;
    }
    if (!this.el) {
      const e = document.createElement('div');
      e.className = 'fps-meter';
      e.setAttribute('aria-hidden', 'true');
      e.textContent = '– fps';
      this.parent.append(e);
      this.el = e;
    }
    const el = this.el;
    // nach Pausen (Hintergrund, Karte) nicht mitzählen
    if (intervalMs > 0 && intervalMs < 250) {
      this.n += 1;
      this.sum += intervalMs;
      if (intervalMs > this.max) this.max = intervalMs;
      this.cpu += cpuMs;
    }
    const now = performance.now();
    if (!this.t0) this.t0 = now;
    if (now - this.t0 < 500 || !this.n) return;
    const avg = this.sum / this.n;
    const f = (x: number) => x.toFixed(1).replace('.', ',');
    const q = quality !== undefined ? ` · ${Math.round(quality * 100)} %` : '';
    el.textContent = `${Math.round(1000 / avg)} fps · ${f(avg)} ms · max ${Math.round(this.max)} · CPU ${f(this.cpu / this.n)}${q}`;
    // einbrechende Bildrate dezent markieren
    el.classList.toggle('is-slow', avg > 20 || this.max > 50);
    this.n = 0;
    this.sum = 0;
    this.max = 0;
    this.cpu = 0;
    this.t0 = now;
  }

  dispose() {
    this.el?.remove();
    this.el = null;
    this.parent = null;
  }
}
