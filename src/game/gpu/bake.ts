/**
 * Oberflächen für den WebGPU-Test, beim Start auf der Grafikkarte gebacken (kein Download, keine Lizenzfragen):
 * Asphalt, Fels, Wiese, Kies und Schnee – je eine Farbtextur und eine gepackte Textur mit Normale, Rauheit und
 * Verschattung. Alle Muster sind kachelbar (Rauschen und Zellen mit Periode).
 *
 * Drei Durchgänge je Oberfläche: Höhe (16 bit), Farbe, daraus Normale + Rauheit + Verschattung. Auf dem iPhone
 * dauert das zusammen deutlich unter einer Zehntelsekunde.
 */
import * as THREE from 'three/webgpu';
import { fbm, h21, tsl, voronoi, type N } from './nodes';

const { Fn, abs, atan, clamp, float, max, mix, normalize, sin, smoothstep, sqrt, texture, uv, vec2, vec3, vec4 } = tsl;

export interface Surface {
  /** Farbe (als Wurzel gespeichert – im Material quadrieren) */
  albedo: THREE.Texture;
  /** Normale xy, Rauheit, Verschattung */
  nra: THREE.Texture;
  /** mittlere Helligkeit der Farbe (linear) – zum Einfärben mit Eckpunktfarben */
  mean: THREE.Color;
}

export type SurfaceId = 'asphalt' | 'rock' | 'grass' | 'gravel' | 'snow';

interface Recipe {
  size: number;
  /** wie stark die Höhe die Normale kippt */
  bump: number;
  /** Radius (Texel) und Stärke der Verschattung in Vertiefungen */
  aoR: number;
  aoK: number;
  mean: [number, number, number];
  make: (p: N) => { h: N; col: N; rough: N };
}

const lin = (r: number, g: number, b: number): N => vec3(r, g, b);

/** Asphalt: helle Splittkörner im dunklen Bitumen, Flickstellen, Teernähte, glattgefahrene Fahrspuren (u quer, v längs) */
const asphalt: Recipe = {
  size: 1024, bump: 3.2, aoR: 2, aoK: 2.2, mean: [0.075, 0.075, 0.078],
  make: (p) => {
    const g1 = voronoi(p.mul(150), 150);
    const g2 = voronoi(p.mul(310).add(0.37), 310);
    const stone1 = smoothstep(0.42, 0.12, g1.f1).mul(h21(vec2(g1.id, 1.3)).mul(0.6).add(0.4));
    const stone2 = smoothstep(0.38, 0.1, g2.f1).mul(0.5);
    const fine = fbm(p.mul(64), 64, 4);
    const big = fbm(p.mul(3), 3, 4);
    // Flicken: großflächig etwas dunkler und frischer
    const patch = smoothstep(0.62, 0.66, fbm(p.mul(2).add(vec2(7.1, 2.3)), 2, 3));
    // Teernähte (Risse, mit Bitumen vergossen)
    const cr = voronoi(p.mul(vec2(2, 3)).add(vec2(fbm(p.mul(9), 9, 3), fbm(p.mul(9).add(4.1), 9, 3)).sub(0.5).mul(0.35)), 3);
    const seam = smoothstep(0.022, 0.0, cr.f2.sub(cr.f1)).mul(smoothstep(0.58, 0.7, fbm(p.mul(5), 5, 2))).mul(0.7);
    // Fahrspuren: glatter und dunkler (Reifenabrieb)
    const u = p.x;
    const lane = smoothstep(0.1, 0.0, abs(u.sub(0.27))).add(smoothstep(0.1, 0.0, abs(u.sub(0.73)))).min(1);
    const stones = max(stone1, stone2).mul(float(1).sub(patch.mul(0.6)));
    const h = stones.mul(0.55).add(fine.mul(0.25)).sub(seam.mul(0.35)).add(0.2);
    const tone = h21(vec2(g1.id, 7.7));
    const stoneCol = mix(lin(0.16, 0.155, 0.15), lin(0.3, 0.29, 0.27), tone).mul(mix(1, 0.75, lane));
    const binder = lin(0.035, 0.036, 0.04).mul(fine.mul(0.5).add(0.75)).mul(big.mul(0.4).add(0.8));
    let col: N = mix(binder, stoneCol, stones.mul(0.75));
    col = mix(col, col.mul(0.7), patch);
    col = mix(col, lin(0.018, 0.018, 0.02), seam);
    const rough = mix(mix(0.86, 0.72, stones), 0.55, lane.mul(0.6)).sub(seam.mul(0.4)).sub(patch.mul(0.06));
    return { h, col, rough };
  },
};

/** Fels: Schichtung, kantige Brocken, Risse, Flechten */
const rock: Recipe = {
  size: 1024, bump: 7, aoR: 4, aoK: 3.5, mean: [0.2, 0.19, 0.17],
  make: (p) => {
    const warp = vec2(fbm(p.mul(4), 4, 3), fbm(p.mul(4).add(3.7), 4, 3)).sub(0.5).mul(0.08);
    const q = p.add(warp);
    const blocks = voronoi(q.mul(vec2(5, 9)), 9);
    const blocks2 = voronoi(q.mul(17).add(0.4), 17);
    const strata = sin(q.y.mul(Math.PI * 2 * 7).add(fbm(q.mul(3), 3, 3).mul(6))).mul(0.5).add(0.5);
    const facet = float(1).sub(blocks.f1.mul(0.9)).add(h21(vec2(blocks.id, 2.1)).mul(0.4));
    const crack = smoothstep(0.06, 0.0, blocks.f2.sub(blocks.f1));
    const crack2 = smoothstep(0.04, 0.0, blocks2.f2.sub(blocks2.f1)).mul(0.6);
    const fine = fbm(q.mul(48), 48, 4);
    const h = facet.mul(0.45).add(strata.mul(0.15)).add(fine.mul(0.3)).sub(crack.mul(0.5)).sub(crack2.mul(0.25)).add(0.15);
    const tone = h21(vec2(blocks.id, 9.3));
    let col: N = mix(lin(0.17, 0.165, 0.155), lin(0.32, 0.3, 0.27), tone.mul(0.6).add(fine.mul(0.4)));
    // rostige Bänder (eisenhaltige Lagen) und dunkle Wasserstreifen
    col = mix(col, lin(0.3, 0.2, 0.12), smoothstep(0.7, 0.95, strata).mul(0.35).mul(fbm(q.mul(6), 6, 2)));
    col = mix(col, col.mul(0.55), smoothstep(0.55, 0.8, fbm(vec2(q.x.mul(14), q.y.mul(1.5)), 14, 3)).mul(0.5));
    // Flechten: kleine gelbgrüne und graue Flecken
    const li = smoothstep(0.62, 0.7, fbm(q.mul(22).add(5.3), 22, 3));
    col = mix(col, mix(lin(0.32, 0.33, 0.12), lin(0.42, 0.42, 0.38), fine), li.mul(0.75));
    col = mix(col, col.mul(0.35), crack);
    const rough = mix(0.8, 0.95, crack).sub(li.mul(0.05));
    return { h, col, rough };
  },
};

/** Wiese von oben: Grasbüschel mit Halmen, Klee, trockene Stellen, ein paar Blüten (wird mit der Gegend eingefärbt) */
const grass: Recipe = {
  size: 1024, bump: 4.5, aoR: 3, aoK: 2.8, mean: [0.16, 0.2, 0.08],
  make: (p) => {
    const t = voronoi(p.mul(46), 46);
    const ang = atan(t.r.y, t.r.x);
    const blades = sin(ang.mul(9).add(t.id.mul(40))).mul(0.5).add(0.5);
    const tuft = smoothstep(0.75, 0.0, t.f1).mul(blades.mul(0.6).add(0.4));
    const t2 = voronoi(p.mul(97).add(0.31), 97);
    const ang2 = atan(t2.r.y, t2.r.x);
    const tuft2 = smoothstep(0.7, 0.0, t2.f1).mul(sin(ang2.mul(7).add(t2.id.mul(30))).mul(0.3).add(0.7));
    const fine = fbm(p.mul(128), 128, 3);
    const dry = smoothstep(0.55, 0.75, fbm(p.mul(4).add(1.7), 4, 4));
    const clover = smoothstep(0.62, 0.68, fbm(p.mul(12).add(8.1), 12, 3));
    const h = max(tuft, tuft2.mul(0.8)).mul(0.7).add(fine.mul(0.3));
    const base = lin(0.05, 0.075, 0.025);
    const tip = mix(lin(0.2, 0.3, 0.07), lin(0.32, 0.33, 0.1), h21(vec2(t.id, 4.4)));
    let col: N = mix(base, tip, h);
    col = mix(col, mix(lin(0.36, 0.3, 0.13), lin(0.27, 0.25, 0.1), fine), dry.mul(0.55).mul(h));
    col = mix(col, lin(0.07, 0.17, 0.04), clover.mul(0.6));
    // Blüten: wenige kleine helle Punkte (weiß, gelb, violett)
    const fl = voronoi(p.mul(70).add(0.71), 70);
    const pick = h21(vec2(fl.id, 3.3));
    const bloom = smoothstep(0.16, 0.08, fl.f1).mul(smoothstep(0.93, 0.95, pick));
    const fc = mix(mix(lin(0.85, 0.82, 0.7), lin(0.8, 0.6, 0.05), smoothstep(0.96, 0.97, pick)), lin(0.35, 0.18, 0.6), smoothstep(0.985, 0.99, pick));
    col = mix(col, fc, bloom);
    const rough = mix(0.95, 0.82, h).add(dry.mul(0.03));
    return { h: h.add(bloom.mul(0.2)), col, rough };
  },
};

/** Kies und Splitt (Bankett, Geröll): Steine in zwei Größen, Staub dazwischen */
const gravel: Recipe = {
  size: 512, bump: 5, aoR: 2, aoK: 3, mean: [0.2, 0.185, 0.16],
  make: (p) => {
    const a = voronoi(p.mul(28), 28);
    const b = voronoi(p.mul(64).add(0.5), 64);
    const sa = sqrt(max(float(0), float(1).sub(a.f1.mul(a.f1).mul(3.2)))).mul(h21(vec2(a.id, 1.1)).mul(0.5).add(0.5));
    const sb = sqrt(max(float(0), float(1).sub(b.f1.mul(b.f1).mul(3.6)))).mul(0.6);
    const dust = fbm(p.mul(32), 32, 3);
    const stones = max(sa, sb);
    const h = stones.mul(0.8).add(dust.mul(0.2));
    const ta = h21(vec2(a.id, 6.2));
    const sc = mix(mix(lin(0.22, 0.21, 0.19), lin(0.42, 0.39, 0.34), ta), lin(0.3, 0.24, 0.17), smoothstep(0.85, 0.95, ta));
    const dc = mix(lin(0.11, 0.095, 0.075), lin(0.17, 0.15, 0.12), dust);
    const col = mix(dc, sc.mul(sb.mul(0.2).add(0.85)), smoothstep(0.05, 0.3, stones));
    const rough = mix(0.95, 0.75, stones);
    return { h, col, rough };
  },
};

/** Schnee: weiche Verwehungen, feine Rippen, glitzernde Körner */
const snow: Recipe = {
  size: 512, bump: 3.2, aoR: 5, aoK: 1.6, mean: [0.8, 0.83, 0.88],
  make: (p) => {
    const soft = fbm(p.mul(3), 3, 5);
    const rip = sin(p.x.mul(Math.PI * 2 * 9).add(fbm(p.mul(5), 5, 3).mul(9)).add(p.y.mul(6.28))).mul(0.5).add(0.5);
    const grain = fbm(p.mul(160), 160, 2);
    const sp = voronoi(p.mul(140), 140);
    const glint = smoothstep(0.12, 0.0, sp.f1).mul(smoothstep(0.8, 0.85, h21(vec2(sp.id, 2.2))));
    const h = soft.mul(0.7).add(rip.mul(0.12)).add(grain.mul(0.18));
    const col = mix(lin(0.72, 0.76, 0.84), lin(0.9, 0.92, 0.95), soft.mul(0.6).add(grain.mul(0.4)));
    const rough = mix(0.62, 0.42, grain).sub(glint.mul(0.35));
    return { h, col, rough };
  },
};

const RECIPES: Record<SurfaceId, Recipe> = { asphalt, rock, grass, gravel, snow };

function target(size: number, type: THREE.TextureDataType, mips: boolean): THREE.RenderTarget {
  const rt = new THREE.RenderTarget(size, size, {
    type,
    generateMipmaps: mips,
    minFilter: mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
  rt.texture.wrapS = rt.texture.wrapT = THREE.RepeatWrapping;
  return rt;
}

/** Backt alle Oberflächen (scale < 1: kleinere Texturen, z. B. für schwache Geräte) */
export function bakeSurfaces(renderer: THREE.WebGPURenderer, scale = 1): Record<SurfaceId, Surface> {
  const out = {} as Record<SurfaceId, Surface>;
  const quad = new THREE.QuadMesh(new THREE.NodeMaterial());
  const prev = renderer.getRenderTarget();
  for (const id of Object.keys(RECIPES) as SurfaceId[]) {
    const R = RECIPES[id];
    const size = Math.max(128, Math.round(R.size * scale));
    // 1) Höhe und Rauheit (16 bit: glatte Normalen ohne Treppen)
    const rtH = target(size, THREE.HalfFloatType, false);
    const mH = new THREE.NodeMaterial();
    mH.fragmentNode = Fn(() => {
      const r = R.make(uv());
      return vec4(r.h, r.rough, 0, 1);
    })();
    quad.material = mH;
    renderer.setRenderTarget(rtH);
    quad.render(renderer);
    // 2) Farbe (Wurzel – mehr Abstufungen im Dunkeln)
    const rtA = target(size, THREE.UnsignedByteType, true);
    const mA = new THREE.NodeMaterial();
    mA.fragmentNode = Fn(() => {
      const r = R.make(uv());
      return vec4(sqrt(clamp(r.col, 0, 1)), 1);
    })();
    quad.material = mA;
    renderer.setRenderTarget(rtA);
    quad.render(renderer);
    // 3) Normale aus der Höhe, Rauheit, Verschattung in Vertiefungen
    const rtN = target(size, THREE.UnsignedByteType, true);
    const mN = new THREE.NodeMaterial();
    const tx = 1 / size;
    mN.fragmentNode = Fn(() => {
      const p = uv();
      const H = (dx: number, dy: number) => texture(rtH.texture, p.add(vec2(dx * tx, dy * tx))).x;
      const hc = H(0, 0);
      const ddx = H(1, 0).sub(H(-1, 0)).mul(0.5 * R.bump * (size / 256));
      const ddy = H(0, 1).sub(H(0, -1)).mul(0.5 * R.bump * (size / 256));
      const n = normalize(vec3(ddx.negate(), ddy.negate(), 1));
      // Verschattung: wie tief liegt der Punkt unter seiner Umgebung?
      let avg: N = float(0);
      const k = R.aoR;
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        avg = avg.add(H(Math.cos(ang) * k, Math.sin(ang) * k));
      }
      avg = avg.div(8);
      const ao = clamp(float(1).sub(max(float(0), avg.sub(hc)).mul(R.aoK)), 0.25, 1);
      const rough = texture(rtH.texture, p).y;
      return vec4(n.x.mul(0.5).add(0.5), n.y.mul(0.5).add(0.5), clamp(rough, 0.04, 1), ao);
    })();
    quad.material = mN;
    renderer.setRenderTarget(rtN);
    quad.render(renderer);
    mH.dispose();
    mA.dispose();
    mN.dispose();
    rtH.dispose();
    out[id] = { albedo: rtA.texture, nra: rtN.texture, mean: new THREE.Color(...R.mean) };
  }
  renderer.setRenderTarget(prev);
  return out;
}

