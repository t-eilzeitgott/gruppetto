import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AkkuGame, RIDERS, type AkkuResult } from './game';
import { LEVEL } from './level';
import { play, runUntilAim, shoot } from './sim';

/** in der Simulation gefundene Folge, die das Level in drei Schüssen gewinnt */
const WIN = [{ angle: 48, power: 0.75, ability: 0.8 }, { angle: 48, power: 1 }, { angle: 40, power: 0.9, ability: 0.45 }];

test('Level steht ruhig: nach dem Aufbau schläft alles, niemand ist verletzt', () => {
  const g = new AkkuGame({ skipIntro: true });
  assert.equal(g.world.awakeCount, 0, 'alles schläft');
  assert.equal(g.enemiesAlive, LEVEL.enemies.length);
  g.blocks.forEach((b, i) => {
    const d = LEVEL.blocks[i];
    if (d.poly) return;
    assert.ok(Math.hypot(b.body.x - d.x, b.body.y - d.y) < 0.08, `${d.mat} bei ${d.x} verrutscht`);
  });
  // zehn Sekunden ohne Schuss: nichts fällt um
  for (let i = 0; i < 600; i++) g.update(1 / 60);
  assert.equal(g.enemiesAlive, LEVEL.enemies.length);
  assert.equal(g.blocks.filter((b) => b.dead).length, 0);
  assert.ok(g.enemies.every((e) => e.hp === e.maxHp));
  assert.equal(g.phase, 'aim');
});

test('Level ist in drei Schüssen zu gewinnen (wiederholbar)', () => {
  let over: AkkuResult | null = null;
  const g = play(WIN, (r) => { over = r; });
  assert.equal(g.enemiesAlive, 0, 'alle E-Biker leer');
  assert.equal(g.phase, 'over');
  assert.ok(over, 'Ende gemeldet');
  const r = over as unknown as AkkuResult;
  assert.equal(r.won, true);
  assert.equal(r.ridersLeft, 2);
  assert.equal(r.parts.bonus, 20000, 'zwei Fahrer übrig = 20.000');
  assert.ok(r.stars >= 2, `${r.stars} Sterne`);
  const again = play(WIN);
  assert.equal(Math.round(again.score), Math.round(g.score), 'gleiche Punkte bei gleicher Folge');
});

test('Alle Schüsse daneben: verloren, E-Biker lachen', () => {
  let over: AkkuResult | null = null;
  const g = play([0, 1, 2, 3, 4].map(() => ({ angle: 180, power: 0.5 })), (r) => { over = r; });
  assert.equal(g.phase, 'over');
  const r = over as unknown as AkkuResult;
  assert.equal(r.won, false);
  assert.equal(r.stars, 0);
  assert.equal(r.enemiesLeft, LEVEL.enemies.length);
});

test('Fähigkeiten: Antritt, Attacke, Flaschen, Aero, Champus', () => {
  const fly = (type: keyof typeof RIDERS) => {
    const g = new AkkuGame({ skipIntro: true });
    runUntilAim(g);
    g.loaded!.type = type;
    const a = (45 * Math.PI) / 180;
    g.launch(-Math.cos(a) * 1.5, -Math.sin(a) * 1.5);
    for (let i = 0; i < 18; i++) g.update(1 / 60);
    return g;
  };
  let g = fly('sprinter');
  const v0 = g.shots[0].body.speed;
  g.useAbility();
  assert.ok(g.shots[0].body.speed > v0 * 1.6, 'Sprinter wird schneller');
  g = fly('floh');
  g.useAbility();
  assert.equal(g.shots.filter((s) => !s.dead).length, 3, 'Bergfloh teilt sich');
  g = fly('wasser');
  g.useAbility();
  assert.equal(g.bottles.length, 3, 'drei Flaschen');
  assert.ok(g.shots[0].body.vy > 5, 'Wasserträger springt hoch');
  g = fly('zeit');
  const m0 = g.shots[0].body.m;
  g.useAbility();
  assert.ok(g.shots[0].body.vy < -20 && g.shots[0].body.m > m0 * 2.5, 'Zeitfahrer stürzt schwer nach unten');
  g = fly('gelb');
  g.useAbility();
  g.update(1 / 60);
  assert.equal(g.shots[0].dead, true, 'Gelbes Trikot knallt');
  assert.equal(g.ghosts.length, 1, 'und fliegt davon');
  // Fähigkeit nur einmal
  g = fly('sprinter');
  g.useAbility();
  const v1 = g.shots[0].body.speed;
  g.useAbility();
  assert.ok(Math.abs(g.shots[0].body.speed - v1) < 1e-9);
});

test('Schuss nach vorn trifft und gibt Punkte', () => {
  const g = new AkkuGame({ skipIntro: true });
  runUntilAim(g);
  shoot(g, { angle: 15, power: 0.9 });
  assert.ok(g.score > 0, `Punkte: ${g.score}`);
  assert.ok(g.enemiesAlive < LEVEL.enemies.length, 'mindestens ein E-Biker erwischt');
  assert.equal(g.ridersLeft, LEVEL.riders.length - 1);
});
