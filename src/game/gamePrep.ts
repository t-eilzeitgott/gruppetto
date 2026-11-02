/**
 * Vorbereitung unter der Startanimation (app/gameIntro.ts), Bild für Bild aus der 3D-Schleife eines Spiels:
 *  1. solange sie die Welt verdeckt, baut der Renderer mit allem, was geht (idleK = 1), und es wird jedes Bild
 *     gezeichnet (nicht nur 10-mal pro Sekunde wie hinter dem Startblatt)
 *  2. steht die Welt rund um den Start (Renderer3D.settled) zwei Bilder hintereinander und wartet die Seite auf
 *     nichts mehr (Geister …), kommt ein Probeblick aus der Fahrkamera – wie nach dem Kameraschwenk
 *  3. danach noch zwei normale Bilder, dann darf die Animation aufgehen
 * Wechselt darunter das Rennen (neue Geister → neuer Lauf), beginnt die Prüfung von vorn.
 */
import type { Renderer3D } from './abfahrt/render3d';
import type { RaceView } from './abfahrt/engine';
import { gameIntroHeld, gameIntroId, gameIntroReady } from '../app/gameIntro';

export class GamePrep {
  private id = 0;
  private eng: RaceView | null = null;
  private n = 0;
  private peeked = false;
  private after = 0;
  private told = false;
  private boosted = false;

  constructor(private renderer: Renderer3D) {}

  /** verdeckt gerade eine Startanimation die Welt? (dann jedes Bild zeichnen) */
  covering(): boolean {
    return gameIntroId() !== 0;
  }

  /**
   * nach jedem gezeichneten Bild; true genau einmal, wenn die Animation gerade aufgegangen ist (dann den Bildtakt
   * neu lernen – unter ihr waren viele Bilder absichtlich lang)
   */
  step(eng: RaceView): boolean {
    const id = gameIntroId();
    if (!id) {
      if (this.boosted) { this.boosted = false; this.renderer.idleK = 0.3; return true; }
      return false;
    }
    // fast alles, was geht – nur das Hochladen bleibt in Portionen (idleK = 1 hieße: alles in einem Bild)
    if (!this.boosted) { this.boosted = true; this.renderer.idleK = 0.99; }
    if (id !== this.id || eng !== this.eng) {
      this.id = id;
      this.eng = eng;
      this.n = 0;
      this.peeked = false;
      this.after = 0;
      this.told = false;
    }
    if (this.told || gameIntroHeld()) return false;
    if (!this.peeked) {
      this.n = this.renderer.settled(eng) ? this.n + 1 : 0;
      if (this.n >= 2) { this.renderer.peekNext(); this.peeked = true; }
      return false;
    }
    this.after += 1;
    if (this.after >= 3) { this.told = true; gameIntroReady(); }
    return false;
  }
}
