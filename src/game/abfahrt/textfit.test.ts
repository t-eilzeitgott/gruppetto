import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitFont } from './textfit';

/** Leinwand-Ersatz: Breite aus Schriftgröße und Textlänge (leicht unregelmäßig wie gerundete Schriften) */
function fake(wobble: number) {
  let size = 0;
  let calls = 0;
  const c = {
    set font(f: string) { size = Number(/([\d.]+)px/.exec(f)![1]); },
    get font() { return `${size}px`; },
    measureText(t: string) { calls += 1; return { width: size * t.length * 0.62 + Math.sin(size * 7.3) * wobble }; },
  };
  return { c: c as unknown as CanvasRenderingContext2D, calls: () => calls, size: () => size };
}

/** die frühere Schleife */
function loop(c: CanvasRenderingContext2D, text: string, maxW: number, start: number, step: number, floor: number) {
  let fs = start;
  c.font = `${fs}px x`;
  while (c.measureText(text).width > maxW && fs > floor) { fs -= step; c.font = `${fs}px x`; }
  return fs;
}

test('Schriftgröße wie die alte Schleife, aber mit wenigen Messungen', () => {
  for (const wobble of [0, 3]) {
    for (let n = 1; n <= 40; n++) {
      const text = 'X'.repeat(n);
      for (const [maxW, start, step, floor] of [[481, 150, 6, 40], [942, 80, 4, 20], [452, 46, 2, 16]] as const) {
        const a = fake(wobble);
        const want = loop(a.c, text, maxW, start, step, floor);
        const b = fake(wobble);
        const got = fitFont(b.c, text, maxW, start, step, floor, (fs) => `${fs}px x`);
        assert.equal(got, want, `${n} Zeichen, Start ${start}`);
        assert.equal(b.size(), got, 'Schrift steht auf dem Ergebnis');
        assert.ok(b.calls() <= 4, `${b.calls()} Messungen`);
      }
    }
  }
});
