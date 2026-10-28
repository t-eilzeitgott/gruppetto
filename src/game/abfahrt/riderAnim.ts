/**
 * Lebendige Fahrer: aus dem Zustand der Spiellogik (Schräglage, Kurbel, Haltung, Tempo) wird je Bild eine Pose
 * für den 3D-Fahrer (rider3d.ts) – mit Federn statt Sprüngen und mit Nebenbewegungen, die der Logik egal sind.
 *
 * - Haltungen (ducken, bremsen, Wiegetritt) folgen über kritisch gedämpfte Federn: weicher Ansatz, weiches
 *   Ankommen, kein Ruck, wenn ein Schwellwert in der Logik kippt.
 * - Aus der Kurbel wird die Trittfrequenz geschätzt; daraus das Arbeiten des Oberkörpers (Hüfte, Schultern, Kopf).
 * - Beim Einlenken geht der Oberkörper voraus, der Kopf bleibt aufrechter als das Rad und schaut in die Kurve.
 * - Beim Bremsen rutscht der Oberkörper kurz nach vorn; in der Luft und bei der Landung federn Arme und Beine.
 * - Atmen, Rütteln auf Pflaster und Schotter, Wind bei hohem Tempo – je Fahrer leicht anders (Zufallssaat).
 *
 * Die Logik-Werte selbst (p.tuck, p.brake …) bleiben unangetastet: sie steuern die Fahrphysik.
 */
import { clamp01, smooth, spring, springSet, springStep } from './motion';
import type { RiderPose } from './rider3d';
import type { Surface } from './track';

/** Zustand eines Fahrers aus der Spiellogik, wie die Darstellung ihn sieht */
export interface RiderState {
  lean: number;
  pedal: number;
  tuck: number;
  brake: number;
  stand: number;
  /** Sprint 1 (Unterlenker, tief) oder Wiegetritt am Berg 0 */
  sprint: number;
  /** Tempo (m/s) */
  v: number;
  /** Höhe über der Straße (m) – Sprünge */
  air: number;
  /** Untergrund unter dem Rad */
  surface: Surface;
  /** Taumeln, Rempler (0–1) */
  wobble: number;
  light: number;
  roll: number;
}

const ROUGH: Record<Surface, number> = { asphalt: 0.12, fresh: 0.04, gravel: 0.55, cobble: 1 };
const clampAbs = (x: number, m: number) => (x < -m ? -m : x > m ? m : x);

export class RiderAnim {
  private tuck = spring();
  private brake = spring();
  private stand = spring();
  private lean = spring();
  private pump = spring();
  private absorb = spring();
  private lurch = spring();
  private shake = spring();
  private prevPedal = 0;
  private cad = 0;
  private prevLean = 0;
  private leanRate = 0;
  private prevBrake = 0;
  private lastAir = 0;
  private breath: number;
  private t: number;
  private started = false;
  /** persönliche Note: Tempo der Federn, Schwung des Oberkörpers (0,85 … 1,15) */
  private readonly vary: number;
  private readonly seed: number;
  private readonly out: RiderPose = { lean: 0, pedal: 0, tuck: 0, brake: 0, light: 0, roll: 0, stand: 0, sprint: 0, pump: 0, shake: 0, absorb: 0, breath: 0, t: 0, leanRate: 0, lurch: 0, look: 0, seed: 0 };

  /**
   * seed: beliebige Zahl je Fahrer (Startnummer, Kennung); player: der eigene Fahrer folgt der Eingabe straffer,
   * Gegner dürfen etwas gemächlicher und unterschiedlicher sein
   */
  constructor(seed: number, private readonly player = false) {
    const h = Math.abs(Math.sin(seed * 12.9898 + 78.233) * 43758.5453);
    const r = h - Math.floor(h);
    this.vary = player ? 1 : 0.85 + 0.3 * r;
    this.seed = r * 6.2832;
    this.t = r * 100;
    this.breath = r * 6.2832;
  }

  /** erster Schritt (auch nach längerer Pause): ohne Übergang auf den Zustand setzen */
  private sync(s: RiderState) {
    springSet(this.tuck, s.tuck);
    springSet(this.brake, s.brake);
    springSet(this.stand, s.stand);
    springSet(this.lean, s.lean);
    springSet(this.pump, 0);
    springSet(this.absorb, s.air > 0.02 ? 0.65 : 0);
    springSet(this.lurch, 0);
    springSet(this.shake, 0);
    this.prevPedal = s.pedal;
    this.cad = 0;
    this.prevLean = s.lean;
    this.leanRate = 0;
    this.prevBrake = s.brake;
    this.lastAir = s.air;
    this.started = true;
  }

  private lastNow = -1;

  /**
   * aus dem Zustand die Pose für dieses Bild; dt = Spielzeit des Bildes (s), now = laufende Spielzeit (s):
   * war der Fahrer eine Weile außer Sicht, setzt die Animation ohne Nachschwingen neu auf
   */
  step(s: RiderState, dt: number, now = -1): RiderPose {
    if (!this.started || dt > 0.5 || (now >= 0 && this.lastNow >= 0 && now - this.lastNow > 0.5)) this.sync(s);
    this.lastNow = now;
    dt = Math.max(1e-4, Math.min(0.1, dt));
    this.t += dt;
    const pl = this.player;
    const k = this.vary;
    // Haltungen: Federn (der eigene Fahrer straffer – die Eingabe soll sich sofort zeigen)
    const tuck = springStep(this.tuck, s.tuck, (pl ? 11 : 8) * k, dt);
    const brake = springStep(this.brake, s.brake, (pl ? 14 : 10) * k, dt);
    const stand = springStep(this.stand, s.stand, (pl ? 10 : 8) * k, dt);
    const lean = springStep(this.lean, s.lean, pl ? 28 : 18, dt);
    // Änderungsraten (gefiltert): Einlenken, Bremsbeginn
    const lr = (lean - this.prevLean) / dt;
    this.prevLean = lean;
    this.leanRate += (lr - this.leanRate) * Math.min(1, dt * 10);
    const brakeRate = Math.max(0, (brake - this.prevBrake) / dt);
    this.prevBrake = brake;
    springStep(this.lurch, Math.min(1, brakeRate * 0.6), 8, dt);
    // Trittfrequenz aus dem Kurbelwinkel (Kreis beachten; ein Sprung – Neustart – zählt nicht)
    let d = s.pedal - this.prevPedal;
    this.prevPedal = s.pedal;
    if (d > Math.PI) d -= Math.PI * 2;
    else if (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > 40 * dt) d = 0;
    this.cad += (d / dt - this.cad) * Math.min(1, dt * 8);
    // Oberkörper arbeitet mit, sobald wirklich getreten wird – geduckt weniger, kräftig bei hoher Frequenz
    const effort = smooth(2.5, 8.5, Math.abs(this.cad)) * (1 - 0.55 * tuck);
    springStep(this.pump, effort * (0.75 + 0.35 * clamp01(Math.abs(this.cad) / 10)) * k, 6, dt);
    // Sprünge: in der Luft stehen (Knie weich), beim Aufsetzen abfedern (je nach Fallgeschwindigkeit)
    const vy = (s.air - this.lastAir) / dt;
    const landed = this.lastAir > 0.02 && s.air <= 0.02;
    this.lastAir = s.air;
    if (landed) this.absorb.v += 12 * clamp01(-vy / 5 + 0.25);
    springStep(this.absorb, s.air > 0.02 ? 0.65 : 0, 9, dt);
    // Atmen: ruhig beim Rollen, schnell unter Last
    this.breath += dt * (2.0 + 3.6 * effort + 2.5 * stand);
    // Rütteln: Untergrund (mehr bei Tempo), Wind bei hohem Tempo, Taumeln
    const rough = ROUGH[s.surface] ?? 0.12;
    springStep(this.shake, clamp01(rough * (0.3 + 0.7 * smooth(3, 15, s.v)) + 0.3 * (s.v / 32) ** 2 + s.wobble * 0.9), 6, dt);

    const o = this.out;
    o.lean = lean;
    o.pedal = s.pedal;
    o.tuck = tuck;
    o.brake = brake;
    o.stand = stand;
    o.sprint = s.sprint;
    o.light = s.light;
    o.roll = s.roll;
    o.pump = this.pump.x;
    o.shake = this.shake.x;
    o.absorb = this.absorb.x;
    o.breath = 0.5 - 0.5 * Math.cos(this.breath);
    o.t = this.t;
    o.leanRate = clampAbs(this.leanRate, 2.5);
    o.lurch = this.lurch.x;
    // Blick in die Kurve: mit der Schräglage und schon beim Einlenken
    o.look = clampAbs(lean * 0.5 + this.leanRate * 0.05, 0.4);
    o.seed = this.seed;
    return o;
  }
}
