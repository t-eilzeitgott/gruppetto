import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, type Body } from './physics';

const DT = 1 / 120;

function run(world: World, seconds: number, each?: () => void) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) { world.step(DT); each?.(); }
}

function ground(world: World) {
  return world.add({ x: 0, y: -1, box: [200, 2], static: true, friction: 0.8 });
}

test('Kiste liegt ruhig auf dem Boden und schläft ein', () => {
  const w = new World();
  ground(w);
  const box = w.add({ x: 0, y: 0.5, box: [1, 1] });
  run(w, 2);
  assert.ok(Math.abs(box.y - 0.5) < 0.02, `y = ${box.y}`);
  assert.ok(Math.abs(box.a) < 1e-3);
  assert.equal(box.awake, false, 'schläft');
});

test('Turm aus zehn Kisten bleibt stehen', () => {
  const w = new World();
  ground(w);
  const boxes: Body[] = [];
  for (let i = 0; i < 10; i++) boxes.push(w.add({ x: 0, y: 0.5 + i, box: [1, 1] }));
  run(w, 6);
  for (let i = 0; i < 10; i++) {
    assert.ok(Math.abs(boxes[i].x) < 0.05, `Kiste ${i} x = ${boxes[i].x}`);
    assert.ok(Math.abs(boxes[i].y - (0.5 + i)) < 0.08, `Kiste ${i} y = ${boxes[i].y}`);
  }
  assert.ok(boxes.every((b) => !b.awake), 'alle schlafen');
});

test('Pyramide und Planken auf Stützen bleiben stehen', () => {
  const w = new World();
  ground(w);
  const all: Body[] = [];
  for (let row = 0; row < 6; row++) {
    for (let i = 0; i < 6 - row; i++) all.push(w.add({ x: -2.5 + row * 0.5 + i, y: 0.5 + row, box: [0.98, 1] }));
  }
  // Tor aus zwei Säulen und einer Planke
  all.push(w.add({ x: 6, y: 1.5, box: [0.4, 3] }));
  all.push(w.add({ x: 8, y: 1.5, box: [0.4, 3] }));
  all.push(w.add({ x: 7, y: 3.2, box: [3, 0.4] }));
  const start = all.map((b) => [b.x, b.y]);
  run(w, 6);
  all.forEach((b, i) => {
    assert.ok(Math.hypot(b.x - start[i][0], b.y - start[i][1]) < 0.08, `Körper ${i} verrutscht`);
  });
});

test('Kugel rollt die Schräge hinunter, Dreieck liegt flach', () => {
  const w = new World();
  ground(w);
  w.add({ x: 0, y: 2, box: [8, 0.5], angle: -0.35, static: true });
  const ball = w.add({ x: -3, y: 4.5, circle: 0.5 });
  const tri = w.add({ x: 6, y: 1, poly: [[-1, 0], [1, 0], [0, 1.2]] });
  run(w, 3);
  assert.ok(ball.x > 3, `Kugel bei x = ${ball.x}`);
  assert.ok(Math.abs(tri.a) < 0.01, 'Dreieck liegt flach');
  assert.ok(Math.abs(tri.minY) < 0.05, `Dreieck auf dem Boden (${tri.minY})`);
});

test('Geschoss reißt den Turm um und meldet den Aufprall', () => {
  const w = new World();
  ground(w);
  const tower: Body[] = [];
  for (let i = 0; i < 6; i++) tower.push(w.add({ x: 10, y: 0.5 + i, box: [1, 1], density: 0.6 }));
  run(w, 1.5);
  let hits = 0;
  let maxImp = 0;
  w.onImpact = (_a, _b, imp) => { hits++; maxImp = Math.max(maxImp, imp); };
  const ball = w.add({ x: 0, y: 4.5, circle: 0.6, density: 3 });
  ball.vx = 22;
  ball.vy = 2;
  run(w, 4);
  assert.ok(hits > 0 && maxImp > 5, `Aufprall gemeldet (${maxImp})`);
  const fallen = tower.filter((b) => b.y < 2.5).length;
  assert.ok(fallen >= 4, `Turm eingestürzt (${fallen} unten)`);
  for (const b of w.bodies) assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), 'keine NaN');
  for (const b of w.bodies) assert.ok(Math.abs(b.vx) < 40 && Math.abs(b.vy) < 40, 'nichts explodiert');
});

test('Entfernen weckt, was obenauf lag', () => {
  const w = new World();
  ground(w);
  const bottom = w.add({ x: 0, y: 0.5, box: [1, 1] });
  const top = w.add({ x: 0, y: 1.5, box: [1, 1] });
  run(w, 2);
  assert.equal(top.awake, false);
  w.remove(bottom);
  run(w, 1);
  assert.ok(top.y < 0.6, `fällt nach unten (${top.y})`);
});

test('schlafende Bauten wachen bei Berührung auf', () => {
  const w = new World();
  ground(w);
  const posts = [w.add({ x: 0, y: 1, box: [0.5, 2], asleep: true }), w.add({ x: 0, y: 2.25, box: [3, 0.5], asleep: true })];
  run(w, 0.5);
  assert.ok(posts.every((b) => !b.awake), 'bleiben ruhig');
  const ball = w.add({ x: -4, y: 2.3, circle: 0.4, density: 4 });
  ball.vx = 15;
  run(w, 2);
  assert.ok(posts[1].x > 0.5 || posts[1].y < 2, 'Planke bewegt sich');
});
