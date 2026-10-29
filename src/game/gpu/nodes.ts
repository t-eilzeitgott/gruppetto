/**
 * Kleine TSL-Bausteine für den WebGPU-Test: kachelbares Rauschen (für die gebackenen Texturen), Zellmuster,
 * Normalen aus gepackten Texturen, Weltprojektionen.
 *
 * Die TSL-Typen von three.js sind sehr generisch (Node<'vec3'> …); die Bausteine hier arbeiten mit beliebigen
 * Knoten – darum der lockere Typ N.
 */
import * as TSL from 'three/tsl';
import type { Texture } from 'three/webgpu';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type N = any;

/** TSL ohne die strengen Knotentypen (die Graphen hier sind zu verschachtelt für sie) */
export const tsl = TSL as unknown as { [K in keyof typeof TSL]: N };
const { abs, dot, float, floor, fract, If, max, mix, normalize, sqrt, texture, vec2, vec3 } = tsl;

/** positiver Rest (x mod m), auch für negative x */
export const pmod = (x: N, m: number | N): N => x.sub(floor(x.div(m)).mul(m));

/**
 * Zufall 0 … 1 aus einem vec2 – ohne sin: die Grafikkarte im iPhone rechnet sin für große Eingaben (Gitterpunkte
 * ab ein paar Tausend) nur grob, der klassische sin-Hash zerfällt dort in Blöcke und Farbsäume. Dieser Hash
 * (Inigo Quilez) bleibt bis in die Zehntausende sauber.
 */
export const h21 = (p: N): N => {
  const q = fract(vec3(p.x, p.y, p.x).mul(0.1031));
  const r = q.add(dot(q, vec3(q.y, q.z, q.x).add(33.33)));
  return fract(r.x.add(r.y).mul(r.z));
};
export const h22 = (p: N): N => {
  const q = fract(vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.103, 0.0973)));
  const r = q.add(dot(q, vec3(q.y, q.z, q.x).add(33.33)));
  return fract(vec2(r.x.add(r.y), r.x.add(r.z)).mul(vec2(r.z, r.y)));
};

/** Periode: gleich in beiden Richtungen oder je Achse (für gestreckte Muster: Klüfte, Wasserstreifen) */
export type Per = number | [number, number];
const perN = (per: Per): N => (typeof per === 'number' ? per : vec2(per[0], per[1]));
const perMul = (per: Per, k: number): Per => (typeof per === 'number' ? per * k : [per[0] * k, per[1] * k]);

/** Wertrauschen, kachelbar mit Periode per (Zellen) */
export function vnoise(p: N, per: Per): N {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const P = perN(per);
  const c = (ox: number, oy: number) => h21(pmod(i.add(vec2(ox, oy)), P));
  return mix(mix(c(0, 0), c(1, 0), u.x), mix(c(0, 1), c(1, 1), u.x), u.y);
}

/** fraktales Rauschen, kachelbar (Periode verdoppelt sich je Oktave) – Ergebnis 0 … 1 */
export function fbm(p: N, per: Per, oct: number, gain = 0.5): N {
  let s: N = float(0);
  let a = 1;
  let norm = 0;
  let q: N = p;
  let pp = per;
  for (let k = 0; k < oct; k++) {
    s = s.add(vnoise(q, pp).mul(a));
    norm += a;
    a *= gain;
    q = q.mul(2);
    pp = perMul(pp, 2);
  }
  return s.div(norm);
}

/** Zellen (Voronoi), kachelbar: Abstand zum nächsten und zweitnächsten Punkt, Zufallswert der Zelle, Lage zur Zellmitte */
export function voronoi(p: N, per: Per): { f1: N; f2: N; id: N; r: N } {
  const P = perN(per);
  const i = floor(p);
  const f = fract(p);
  const d1 = float(9).toVar();
  const d2 = float(9).toVar();
  const id = float(0).toVar();
  const rr = vec2(0, 0).toVar();
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      const g = vec2(x, y);
      const cell = pmod(i.add(g), P);
      const r = g.add(h22(cell).mul(0.85).add(0.075)).sub(f);
      const d = dot(r, r);
      If(d.lessThan(d1), () => {
        d2.assign(d1);
        d1.assign(d);
        id.assign(h21(cell.add(5.17)));
        rr.assign(r);
      }).ElseIf(d.lessThan(d2), () => {
        d2.assign(d);
      });
    }
  }
  return { f1: sqrt(d1), f2: sqrt(d2), id, r: rr };
}

/** gepackte Normale (xy · 0,5 + 0,5) → Tangentenraum-Normale */
export function unpackXY(t: N): N {
  const xy = t.xy.mul(2).sub(1);
  return vec3(xy, sqrt(max(float(0), float(1).sub(dot(xy, xy)))));
}

/**
 * Projektion von drei Seiten (Fels an steilen Wänden): Farbe und Weltnormale.
 * scale: Meter je Kachel. Normalen nach „UDN“: Tangentennormale auf die Fläche der Projektion gekippt.
 */
export function triplanar(albedo: Texture, nra: Texture, pos: N, nGeo: N, scale: number, sharp = 4, top?: { albedo: Texture; nra: Texture }, bump = 1) {
  const w0 = abs(nGeo).pow(float(sharp));
  const w = w0.div(w0.x.add(w0.y).add(w0.z));
  const s = 1 / scale;
  // Seiten: v ist immer die Höhe (Wandmuster wie Schichtbänke und Wasserstreifen stehen richtig)
  const uvX = pos.zy.mul(s);
  const uvY = pos.xz.mul(s);
  const uvZ = pos.xy.mul(s);
  const tA = top?.albedo ?? albedo;
  const tN = top?.nra ?? nra;
  const cX = texture(albedo, uvX);
  const cY = texture(tA, uvY);
  const cZ = texture(albedo, uvZ);
  const nX = texture(nra, uvX);
  const nY = texture(tN, uvY);
  const nZ = texture(nra, uvZ);
  const col = cX.rgb.mul(w.x).add(cY.rgb.mul(w.y)).add(cZ.rgb.mul(w.z));
  const rough = nX.z.mul(w.x).add(nY.z.mul(w.y)).add(nZ.z.mul(w.z));
  const ao = nX.w.mul(w.x).add(nY.w.mul(w.y)).add(nZ.w.mul(w.z));
  const tX = nX.xy.mul(2).sub(1).mul(bump);
  const tY = nY.xy.mul(2).sub(1).mul(bump);
  const tZ = nZ.xy.mul(2).sub(1).mul(bump);
  // je Achse die Neigung der Tangentennormale in Weltrichtungen (gleich, ob die Fläche nach + oder − schaut)
  const dX = vec3(0, tX.y, tX.x);
  const dY = vec3(tY.x, 0, tY.y);
  const dZ = vec3(tZ.x, tZ.y, 0);
  const n = normalize(nGeo.add(dX.mul(w.x)).add(dY.mul(w.y)).add(dZ.mul(w.z)));
  return { col, rough, ao, n };
}

/** von oben projiziert (Wiese, Schnee, Kies): Farbe und Weltnormale */
export function planar(albedo: Texture, nra: Texture, uvN: N, nGeo: N, strength = 1) {
  const c = texture(albedo, uvN);
  const t = texture(nra, uvN);
  const xy = t.xy.mul(2).sub(1).mul(strength);
  const n = normalize(nGeo.add(vec3(xy.x, 0, xy.y)));
  return { col: c.rgb, rough: t.z, ao: t.w, n };
}

/** nur die Weltnormale einer Draufsicht (spart den Farbzugriff) */
export function planarN(nra: Texture, uvN: N, nGeo: N, strength = 1) {
  const xy = texture(nra, uvN).xy.mul(2).sub(1).mul(strength);
  return normalize(nGeo.add(vec3(xy.x, 0, xy.y)));
}

/** gebackene Farbe ist als Wurzel gespeichert (mehr Genauigkeit im Dunkeln) */
export const decodeAlbedo = (c: N): N => c.mul(c);

/** weiche Mischung zweier Ergebnisse */
export const blend = (a: N, b: N, t: N): N => mix(a, b, t);
