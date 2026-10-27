/** Hilfen zum Durchspielen ohne Bild (Tests und Abstimmung) */
import { AkkuGame, MAX_PULL, type AkkuResult } from './game';

export interface Plan { angle: number; power: number; ability?: number }

/** Spiel bis zum nächsten Zielen (oder Ende) weiterlaufen lassen */
export function runUntilAim(g: AkkuGame, maxT = 20) {
  let t = 0;
  while (t < maxT) {
    if (g.phase === 'over') return;
    if (g.phase === 'aim' && g.loaded && g.loaded.hop >= 1) return;
    g.update(1 / 60);
    t += 1 / 60;
  }
}

/** einen Schuss abgeben: Winkel in Grad, Kraft 0..1, Fähigkeit nach so vielen Sekunden */
export function shoot(g: AkkuGame, p: Plan) {
  const a = (p.angle * Math.PI) / 180;
  const len = p.power * MAX_PULL;
  g.launch(-Math.cos(a) * len, -Math.sin(a) * len);
  let t = 0;
  let used = false;
  while (g.phase === 'fly' && t < 14) {
    if (p.ability !== undefined && !used && t >= p.ability) { g.useAbility(); used = true; }
    g.update(1 / 60);
    t += 1 / 60;
  }
  runUntilAim(g);
}

export function play(plans: Plan[], over?: (r: AkkuResult) => void): AkkuGame {
  const g = new AkkuGame({ skipIntro: true, events: { over } });
  runUntilAim(g);
  for (const p of plans) {
    if (g.phase === 'over' || g.phase === 'won' || g.phase === 'lost') break;
    shoot(g, p);
  }
  // Ende abwarten (auch wenn der letzte Schuss noch nachwirkt)
  let t = 0;
  while (g.phase !== 'over' && g.phase !== 'aim' && t < 20) { g.update(1 / 60); t += 1 / 60; }
  return g;
}
