/**
 * Bodenmaterialien für den WebGPU-Test: Wiese, Waldboden, Fels, Schnee, Kies, Beton – aus den gebackenen
 * Oberflächen gemischt. Gewichte und Grundfarben kommen je Ecke aus der Landschaft (terrain3d) bzw. aus dem
 * Querprofil der Straße (Korridor). Fels wird von drei Seiten projiziert (keine gestreckten Texturen an Wänden).
 */
import * as THREE from 'three/webgpu';
import type { Surface, SurfaceId } from './bake';
import { decodeAlbedo, planar, triplanar, tsl, type N } from './nodes';

const { attribute, cameraPosition, float, max, mix, normalize, normalWorldGeometry, positionWorld, smoothstep, texture, transformNormalToView, vec3, vertexColor } = tsl;

type Surfaces = Record<SurfaceId, Surface>;

/** gemeinsame Wiesenfarbe: Landschaft und Straßenrand kommen aus verschiedenen Farbtabellen – beide ziehen hierhin */
export const MEADOW = new THREE.Color(0.2, 0.32, 0.085);

interface Mix {
  tint: N;       // Grundfarbe Wiese (linear)
  rockTint: N;   // Felsfarbe der Gegend
  fo: N;         // Wald (Waldboden bzw. Kronendach)
  rk: N;         // Fels
  sn: N;         // Schnee
  gr: N;         // Kies / Bankett
  cc: N;         // Beton / Mauer
  canopy: boolean; // keine echten Bäume: Wald als Kronendach färben
  detail: boolean; // feine Texturen (nah) – sonst nur die großen
}

const meanOf = (s: Surface): N => vec3(s.mean.r, s.mean.g, s.mean.b);

/** Schattierung aus den Gewichten: Farbe, Rauheit, Verschattung, Weltnormale */
function shade(S: Surfaces, m: Mix) {
  const pos = positionWorld;
  const nG = normalize(normalWorldGeometry);
  // Wiese: fein (3,2 m) und grob (29 m) gegen sichtbares Kacheln
  const gF = planar(S.grass.albedo, S.grass.nra, pos.xz.div(3.2), nG, 0.9);
  const gC = decodeAlbedo(texture(S.grass.albedo, pos.xz.div(29)).rgb).div(meanOf(S.grass));
  const gDet = decodeAlbedo(gF.col).div(meanOf(S.grass));
  // großflächig: trockene, gelbliche und satte, dunkle Stellen
  const macro = texture(S.grass.albedo, pos.xz.div(173)).rgb;
  const dryW = smoothstep(0.42, 0.6, macro.y.mul(macro.y).div(meanOf(S.grass).y).mul(0.5));
  // Farbe der Gegend etwas zurücknehmen (echte Almwiesen sind weniger bunt), dazu trockene Stellen
  const meadow = vec3(MEADOW.r, MEADOW.g, MEADOW.b);
  const base = mix(mix(vec3(m.tint.dot(vec3(0.3, 0.55, 0.15))), m.tint, 0.78).mul(0.9), meadow, 0.55);
  const tint = mix(base, base.mul(vec3(1.25, 1.05, 0.62)), dryW.mul(0.55)).mul(macro.x.mul(0.6).add(0.75).clamp(0.7, 1.25));
  // von oben projiziert: an steilen Hängen wäre das Muster senkrecht gestreckt – dort nur die ruhige Grundfarbe
  const flat = smoothstep(0.5, 0.82, nG.y);
  const grassCol = tint.mul(m.detail ? mix(gC.mul(0.35).add(0.65), gDet.mul(0.7).add(gC.mul(0.3)), flat) : mix(float(1), gC.mul(0.6).add(0.4), flat));
  let col: N = grassCol;
  let rough: N = m.detail ? gF.rough : float(0.92);
  let ao: N = m.detail ? mix(float(1), gF.ao, flat) : float(1);
  let n: N = m.detail ? normalize(mix(nG, gF.n, flat)) : nG;
  // Wald: nah Waldboden (Nadeln, Moos), fern Kronendach – auf der feinen Stufe mit dem Abstand übergeblendet, damit
  // ein Wald dort, wo die 3D-Bäume aufhören, nicht als Rechteck anders aussieht
  // Kronendach: Kronen als Buckel (Muster der Wiese, groß), hell besonnt, dunkle Lücken dazwischen
  const crownT = planar(S.grass.albedo, S.grass.nra, pos.xz.div(m.detail ? 11 : 30), nG, 2.6);
  const crown = decodeAlbedo(crownT.col).div(meanOf(S.grass)).dot(vec3(0.3, 0.5, 0.2));
  const canopyCol = mix(vec3(0.03, 0.052, 0.024), vec3(0.095, 0.13, 0.052), crown.mul(0.6).clamp(0, 1)).mul(gC.y.mul(0.35).add(0.82));
  const floorCol = mix(m.tint.mul(0.55), mix(vec3(0.07, 0.06, 0.035), vec3(0.09, 0.075, 0.045), gDet.x.mul(0.5).clamp(0, 1)), 0.6).mul(gDet.mul(0.5).add(0.5));
  const camD = pos.sub(cameraPosition).length();
  const forestCol = m.canopy ? canopyCol : mix(floorCol, canopyCol, smoothstep(110, 260, camD));
  // Baumgrenze: unregelmäßig (große Zungen und Lücken), oberhalb einzelne Baumgruppen
  const wob = decodeAlbedo(texture(S.grass.albedo, pos.xz.div(97)).rgb).div(meanOf(S.grass)).y.sub(1);
  const fo = smoothstep(0.25, 0.75, m.fo.add(wob.mul(0.45)));
  const clumps = smoothstep(0.62, 0.8, crown.mul(0.5)).mul(smoothstep(0.02, 0.3, m.fo)).mul(0.8);
  const foW = max(fo, clumps);
  col = mix(col, forestCol, foW);
  rough = mix(rough, float(0.95), foW);
  if (m.canopy) n = mix(n, crownT.n, foW);
  // Kies und Beton (Bankett, Rinne, Mauerkrone)
  if (m.detail) {
    const g = planar(S.gravel.albedo, S.gravel.nra, pos.xz.div(1.1), nG, 0.8);
    const gravelCol = decodeAlbedo(g.col).mul(0.62);
    col = mix(col, gravelCol, m.gr);
    rough = mix(rough, g.rough, m.gr);
    ao = mix(ao, g.ao, m.gr);
    n = mix(n, g.n, m.gr);
    const concrete = vec3(0.3, 0.29, 0.27).mul(decodeAlbedo(g.col).div(meanOf(S.gravel)).mul(0.25).add(0.75));
    col = mix(col, concrete, m.cc);
    rough = mix(rough, float(0.8), m.cc);
    n = mix(n, mix(nG, g.n, 0.25), m.cc);
  }
  // Fels von drei Seiten (fern zusätzlich grob: Rinnen und Bänder bleiben auch auf großen Wänden sichtbar)
  const r = triplanar(S.rock.albedo, S.rock.nra, pos, nG, m.detail ? 7 : 22, 4);
  let rockCol: N = decodeAlbedo(r.col).div(meanOf(S.rock)).mul(m.rockTint).mul(0.55).add(decodeAlbedo(r.col).mul(0.45));
  let rockN: N = r.n;
  if (!m.detail) {
    const r2 = triplanar(S.rock.albedo, S.rock.nra, pos, nG, 140, 3);
    rockCol = rockCol.mul(decodeAlbedo(r2.col).div(meanOf(S.rock)).mul(0.6).add(0.4));
    rockN = normalize(r.n.add(r2.n).sub(nG));
  }
  col = mix(col, rockCol, m.rk);
  rough = mix(rough, r.rough, m.rk);
  ao = mix(ao, r.ao, m.rk);
  n = mix(n, rockN, m.rk);
  // Schnee obendrauf: fleckig (Altschnee im Sommer), nah an der Straße grau vom Spritzwasser
  const s = planar(S.snow.albedo, S.snow.nra, pos.xz.div(6), nG, 1);
  const patchy = smoothstep(0.3, 0.62, decodeAlbedo(texture(S.grass.albedo, pos.xz.div(41)).rgb).x.div(meanOf(S.grass).x).mul(0.5));
  m = { ...m, sn: m.sn.mul(patchy.mul(0.65).add(0.35)) };
  const snowCol = decodeAlbedo(s.col).mul(mix(vec3(0.74, 0.78, 0.84), vec3(0.92, 0.92, 0.92), patchy));
  col = mix(col, snowCol, m.sn);
  rough = mix(rough, s.rough, m.sn);
  ao = mix(ao, max(s.ao, 0.8), m.sn);
  n = mix(n, s.n, m.sn);
  return { col, rough, ao, n: normalize(n) };
}

function apply(mat: THREE.MeshStandardNodeMaterial, o: ReturnType<typeof shade>) {
  mat.colorNode = o.col;
  mat.roughnessNode = o.rough;
  mat.metalnessNode = float(0);
  mat.aoNode = o.ao;
  mat.normalNode = transformNormalToView(o.n);
}

/**
 * Landschaft (Kacheln aus terrain3d): Farbe = Wiese der Gegend, aMat = (Wald, Fels, Schnee, Rauschen),
 * aRock = Felsfarbe, aNz = großflächiges Rauschen. lv 0 mit echten Bäumen, darüber Kronendach.
 */
export function terrainMaterial(S: Surfaces, lv: number): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  const aMat = attribute('aMat', 'vec4');
  const aNz = attribute('aNz', 'vec2');
  // Waldrand und Baumgrenze ausgefranst (sonst eine gerade Höhenlinie quer über den Berg)
  const fo = smoothstep(0.38, 0.66, aMat.x.add(aMat.w.sub(0.5).mul(0.4)).add(aNz.x.sub(0.5).mul(0.8)));
  const rk = smoothstep(0.32, 0.62, aMat.y.add(aNz.y.sub(0.5).mul(0.3)));
  const sn = smoothstep(0.42, 0.6, aMat.z.add(aNz.y.sub(0.5).mul(0.45)));
  apply(mat, shade(S, {
    tint: vertexColor(), rockTint: attribute('aRock', 'vec3'),
    fo, rk, sn, gr: float(0), cc: float(0), canopy: lv > 0, detail: lv === 0,
  }));
  mat.name = `terrain${lv}`;
  // Prüfmodus: Stufen einfärben (?lvcolor)
  if (/[?&]lvcolor\b/.test(location.search)) mat.colorNode = vec3(lv === 0 ? 0.6 : 0.05, lv === 1 ? 0.6 : 0.05, lv === 2 ? 0.6 : 0.05);
  if (/[?&]dbgmat\b/.test(location.search)) { mat.colorNode = vec3(fo, rk, sn).mul(0.5).add(0.02); mat.normalNode = transformNormalToView(normalize(normalWorldGeometry)); }
  if (/[?&]dbgcol\b/.test(location.search)) { mat.colorNode = vertexColor(); mat.normalNode = transformNormalToView(normalize(normalWorldGeometry)); }
  return mat;
}

/** Straßenrand (Korridor): Farbe der Gegend je Ecke, Gewichte aW = (Wald, Fels, Schnee, Kies), aC = (Beton, Felsfarbe) */
export function corridorMaterial(S: Surfaces): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  const w = attribute('aW', 'vec4');
  const c = attribute('aC', 'vec4');
  apply(mat, shade(S, {
    tint: vertexColor(), rockTint: c.yzw, fo: w.x, rk: w.y, sn: w.z, gr: w.w, cc: c.x, canopy: false, detail: true,
  }));
  mat.name = 'corridor';
  return mat;
}
