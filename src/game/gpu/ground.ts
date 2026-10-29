/**
 * Bodenmaterialien für den WebGPU-Test: Wiese, Waldboden, Fels, Schnee, Kies, Beton – aus den gebackenen
 * Oberflächen gemischt. Gewichte und Grundfarben kommen je Ecke aus der Landschaft (terrain3d) bzw. aus dem
 * Querprofil der Straße (Korridor). Fels wird von drei Seiten projiziert (keine gestreckten Texturen an Wänden).
 */
import * as THREE from 'three/webgpu';
import type { Surface, SurfaceId } from './bake';
import { decodeAlbedo, planar, planarN, triplanar, tsl, type N } from './nodes';

const { attribute, cameraPosition, float, fwidth, max, mix, normalize, normalWorldGeometry, positionWorld, smoothstep, texture, transformNormalToView, vec3, vertexColor } = tsl;

type Surfaces = Record<SurfaceId, Surface>;

/** gemeinsame Wiesenfarbe: Landschaft und Straßenrand kommen aus verschiedenen Farbtabellen – beide ziehen hierhin */
export const MEADOW = new THREE.Color(0.225, 0.315, 0.072);

interface Mix {
  tint: N;       // Grundfarbe Wiese (linear)
  rockTint: N;   // Felsfarbe der Gegend
  fo: N;         // Wald (Waldboden bzw. Kronendach)
  rk: N;         // Fels
  sn: N;         // Schnee
  gr: N;         // Kies / Bankett
  cc: N;         // Beton / Mauer
  /** Geröllhalden unter den Wänden (nur Landschaft) */
  sc?: N;
  canopy: boolean; // keine echten Bäume: Wald als Kronendach färben
  /** Blüten im Gras (gebackene Punkte, Rang im Alpha) */
  dots?: THREE.Texture;
  detail: boolean; // feine Texturen (nah) – sonst nur die großen
}

const meanOf = (s: Surface): N => vec3(s.mean.r, s.mean.g, s.mean.b);

/** grobes Waldgewicht (Felsköpfe nicht mitten im Wald) */
const foBase = (m: Mix): N => smoothstep(0.1, 0.5, m.fo);

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
  // von oben projiziert: an steilen Hängen wäre das Muster senkrecht gestreckt – dort nur die ruhige Grundfarbe
  const flat = smoothstep(0.5, 0.82, nG.y);
  // steile Sonnenhänge trockener und gelblicher (magerer Boden), Mulden satter
  const steepG = float(1).sub(smoothstep(0.72, 0.95, nG.y));
  const tint = mix(base, base.mul(vec3(1.25, 1.05, 0.62)), dryW.mul(0.55).add(steepG.mul(0.3)).min(0.8)).mul(macro.x.mul(0.6).add(0.75).clamp(0.7, 1.25));
  let grassCol: N = tint.mul(m.detail ? mix(gC.mul(0.35).add(0.65), gDet.mul(0.7).add(gC.mul(0.3)), flat) : mix(float(1), gC.mul(0.6).add(0.4), flat));
  const camD0 = pos.sub(cameraPosition).length();
  if (m.dots) {
    // Blumenwiese: fleckig viele oder wenige Blüten, nur auf ebener Wiese, in der Nähe als Punkte, fern als leichter Schimmer
    const fd = texture(m.dots, pos.xz.div(3));
    const many = smoothstep(0.3, 0.7, decodeAlbedo(texture(S.grass.albedo, pos.xz.div(53)).rgb).x.div(meanOf(S.grass).x).mul(0.5)).mul(flat);
    // nur solange ein Punkt auf dem Bildschirm groß genug ist: in den kleinen Mipmaps ist Alpha gemittelt und
    // die Schwelle würde überall „Blüte“ melden (bunter Schleier über der ganzen Wiese)
    const texPx = fwidth(pos.x).add(fwidth(pos.z)).mul(0.5).div(3).mul(512);
    const near = float(1).sub(smoothstep(3, 8, texPx)).mul(float(1).sub(smoothstep(40, 80, camD0)));
    const thr = many.mul(0.29);
    const show = float(1).sub(smoothstep(thr.sub(0.02), thr, fd.a)).mul(near);
    grassCol = mix(grassCol, decodeAlbedo(fd.rgb).mul(0.85), show);
    // fern: leichter Schimmer in der Mischfarbe der Blüten (gelblich, nicht rosa)
    grassCol = mix(grassCol, grassCol.add(vec3(0.022, 0.02, 0.008)), many.mul(float(1).sub(near)).mul(0.5));
  }
  let col: N = grassCol;
  let rough: N = m.detail ? gF.rough : float(0.92);
  let ao: N = m.detail ? mix(float(1), gF.ao, flat) : float(1);
  let n: N = m.detail ? normalize(mix(nG, gF.n, flat)) : nG;
  // Flecken: Rauschmasken (roh gelesen 0 … 1; r mittel, g klein, b groß)
  const nz = (k: number): N => texture(S.noise.albedo, pos.xz.div(k)).rgb;
  const rk2 = nz(m.detail ? 41 : 160);
  if (m.detail) {
    // offene Erde mit Steinchen: kleine Flecken, eher am Hang (Viehtritt) als in der ebenen Wiese
    const g = planar(S.gravel.albedo, S.gravel.nra, pos.xz.div(1.6), nG, 0.7);
    const dirt = smoothstep(0.8, 0.9, rk2.y.add(steepG.mul(0.12))).mul(0.8);
    const soil = mix(vec3(0.075, 0.058, 0.04), decodeAlbedo(g.col).mul(0.55), smoothstep(0.85, 1.2, decodeAlbedo(g.col).x.div(meanOf(S.gravel).x)));
    col = mix(col, soil, dirt);
    if (/[?&]dbgdirt\b/.test(location.search)) col = vec3(rk2.x, dirt, rk2.z);
    rough = mix(rough, float(0.93), dirt);
    n = normalize(mix(n, g.n, dirt));
  } else {
    // ferne Hänge: Buckel und Mulden im Licht (sonst glatt wie Plastik)
    const hum = planarN(S.grass.nra, pos.xz.div(m.canopy ? 47 : 23), nG, 3.2);
    n = normalize(mix(nG, hum, 0.7));
  }
  // Wald: nah Waldboden (Nadeln, Moos), fern Kronendach – auf der feinen Stufe mit dem Abstand übergeblendet, damit
  // ein Wald dort, wo die 3D-Bäume aufhören, nicht als Rechteck anders aussieht
  // Kronendach: Kronen als Buckel (Muster der Wiese, groß), hell besonnt, dunkle Lücken dazwischen
  const crownT = planar(S.grass.albedo, S.grass.nra, pos.xz.div(m.detail ? 11 : 30), nG, 2.6);
  const crown = decodeAlbedo(crownT.col).div(meanOf(S.grass)).dot(vec3(0.3, 0.5, 0.2));
  const canopyCol = mix(vec3(0.03, 0.052, 0.024), vec3(0.095, 0.13, 0.052), crown.mul(0.6).clamp(0, 1)).mul(gC.y.mul(0.35).add(0.82));
  const floorCol = mix(m.tint.mul(0.55), mix(vec3(0.07, 0.06, 0.035), vec3(0.09, 0.075, 0.045), gDet.x.mul(0.5).clamp(0, 1)), 0.6).mul(gDet.mul(0.5).add(0.5));
  const camD = camD0;
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
  // Geröll unter den Wänden: helle Halden aus Schutt (von oben, grob)
  const sg = m.sc ? planar(S.gravel.albedo, S.gravel.nra, pos.xz.div(m.detail ? 2.6 : 11), nG, m.detail ? 1 : 1.6) : null;
  const screeCol: N = sg ? decodeAlbedo(sg.col).div(meanOf(S.gravel)).mul(m.rockTint).mul(1.05) : null;
  if (sg && m.sc) {
    col = mix(col, screeCol, m.sc);
    rough = mix(rough, sg.rough, m.sc);
    ao = mix(ao, sg.ao, m.sc);
    n = normalize(mix(n, sg.n, m.sc));
  }
  // Fels: Wände (Seiten) mit Schichtbänken, Klüften und Wasserstreifen, von oben verwitterte Blöcke.
  // Fern zusätzlich sehr grob (Rinnen und Bänder über ganze Wände) und mit kräftigerem Relief.
  // Felsköpfe brechen an steileren Wiesenhängen durch
  const outcrop = smoothstep(0.72, 0.82, rk2.x.add(steepG.mul(0.15))).mul(steepG).mul(float(1).sub(foBase(m)));
  const rkW = max(m.rk, outcrop.mul(0.9));
  const top = { albedo: S.rock.albedo, nra: S.rock.nra };
  const r = triplanar(S.cliff.albedo, S.cliff.nra, pos, nG, m.detail ? 9 : 27, 10, top, m.detail ? 1.5 : 1.3);
  const rRaw = decodeAlbedo(r.col).div(meanOf(S.cliff));
  let rockCol: N = rRaw.mul(m.rockTint).mul(0.6).add(rRaw.mul(vec3(0.2, 0.19, 0.17)).mul(0.4)).mul(1.15);
  let rockN: N = r.n;
  let rockAo: N = r.ao;
  if (!m.detail) {
    const r2 = triplanar(S.cliff.albedo, S.cliff.nra, pos, nG, 150, 6, top, 2.2);
    rockCol = rockCol.mul(decodeAlbedo(r2.col).div(meanOf(S.cliff)).mul(0.7).add(0.3));
    rockN = normalize(r.n.add(r2.n).sub(nG));
    rockAo = r.ao.mul(r2.ao.mul(0.5).add(0.5));
  }
  // großflächig: hellere, cremefarbene und dunklere, graue Wandpartien, manche leicht rötlich
  const zone = nz(m.detail ? 140 : 520);
  rockCol = rockCol.mul(zone.z.mul(0.45).add(0.8)).mul(mix(vec3(1, 1, 1), vec3(1.12, 1.0, 0.84), smoothstep(0.55, 0.85, zone.x)));
  // Grasbänder: auf breiten Simsen und Absätzen wächst Wiese (nur unterhalb der Schneegrenze)
  const ledgeG = smoothstep(0.82, 0.95, normalize(rockN).y).mul(float(1).sub(smoothstep(0.05, 0.4, m.sn))).mul(smoothstep(0.3, 0.6, zone.y.add(0.15)));
  const rkV = rkW.mul(float(1).sub(ledgeG.mul(0.85)));
  col = mix(col, rockCol, rkV);
  rough = mix(rough, r.rough, rkV);
  ao = mix(ao, rockAo, rkV);
  n = mix(n, rockN, rkW);
  // mittelsteile Felshänge (keine Wand): großteils Schutt mit Felsköpfen statt Schichtbänken
  if (sg) {
    const sr = rkV.mul(smoothstep(0.6, 0.82, nG.y)).mul(smoothstep(0.3, 0.6, zone.y)).mul(0.85);
    col = mix(col, screeCol, sr);
    rough = mix(rough, sg.rough, sr);
    n = mix(n, sg.n, sr);
  }
  // Schnee: Altschnee in Flecken mit klaren Rändern; auf Fels nur auf Simsen und flachen Absätzen
  const s = planar(S.snow.albedo, S.snow.nra, pos.xz.div(m.detail ? 6 : 17), nG, 1);
  // Flecken aus den Rauschmasken (groß, mit ausgefransten Rändern) – das Wiesenmuster würde sprenkeln
  const patchy = smoothstep(0.35, 0.75, nz(330).z.mul(0.7).add(nz(70).y.mul(0.3)));
  const ledge = smoothstep(0.72, 0.9, normalize(rockN).y);
  // Sommer: nur Reste – in Mulden und an flachen Stellen, auf Fels nur auf breiten Simsen
  const snowRaw = m.sn.mul(patchy.mul(0.9).add(0.2)).mul(mix(float(1), ledge, rkW.mul(0.7)));
  const sn = smoothstep(0.36, 0.46, snowRaw);
  const snowCol = decodeAlbedo(s.col).div(meanOf(S.snow)).mul(vec3(0.83, 0.86, 0.9)).mul(s.ao.mul(0.25).add(0.75));
  col = mix(col, snowCol, sn);
  rough = mix(rough, s.rough, sn);
  ao = mix(ao, max(s.ao, 0.85), sn);
  n = mix(n, normalize(mix(nG, s.n, 0.7)), sn);
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
export function terrainMaterial(S: Surfaces, lv: number, dots?: THREE.Texture): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  const aMat = attribute('aMat', 'vec4');
  const aNz = attribute('aNz', 'vec2');
  // Waldrand und Baumgrenze ausgefranst (sonst eine gerade Höhenlinie quer über den Berg)
  const fo = smoothstep(0.38, 0.66, aMat.x.add(aMat.w.sub(0.5).mul(0.4)).add(aNz.x.sub(0.5).mul(0.8)));
  const rk = smoothstep(0.32, 0.62, aMat.y.add(aNz.y.sub(0.5).mul(0.3)));
  const sn = smoothstep(0.42, 0.6, aMat.z.add(aNz.y.sub(0.5).mul(0.45)));
  // Geröllhalden: im Saum der Felsgebiete, wo der Hang flacher wird (Schutt bleibt ab ~40° liegen), fingerförmig
  const ny = normalize(normalWorldGeometry).y;
  const sc = smoothstep(0.1, 0.3, aMat.y.add(aNz.x.sub(0.5).mul(0.35)).add(aMat.w.sub(0.5).mul(0.25)))
    .mul(float(1).sub(rk)).mul(smoothstep(0.6, 0.78, ny)).mul(float(1).sub(fo)).mul(0.9);
  apply(mat, shade(S, {
    tint: vertexColor(), rockTint: attribute('aRock', 'vec3'),
    fo, rk, sn, sc, gr: float(0), cc: float(0), canopy: lv > 0, detail: lv === 0, dots: lv === 0 ? dots : undefined,
  }));
  mat.name = `terrain${lv}`;
  // Prüfmodus: Stufen einfärben (?lvcolor)
  if (/[?&]lvcolor\b/.test(location.search)) mat.colorNode = vec3(lv === 0 ? 0.6 : 0.05, lv === 1 ? 0.6 : 0.05, lv === 2 ? 0.6 : 0.05);
  if (/[?&]dbgmat\b/.test(location.search)) { mat.colorNode = vec3(fo, rk, sn).mul(0.5).add(0.02); mat.normalNode = transformNormalToView(normalize(normalWorldGeometry)); }
  if (/[?&]dbgcol\b/.test(location.search)) { mat.colorNode = vertexColor(); mat.normalNode = transformNormalToView(normalize(normalWorldGeometry)); }
  return mat;
}

/** Straßenrand (Korridor): Farbe der Gegend je Ecke, Gewichte aW = (Wald, Fels, Schnee, Kies), aC = (Beton, Felsfarbe) */
export function corridorMaterial(S: Surfaces, dots?: THREE.Texture): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  const w = attribute('aW', 'vec4');
  const c = attribute('aC', 'vec4');
  apply(mat, shade(S, {
    tint: vertexColor(), rockTint: c.yzw, fo: w.x, rk: w.y, sn: w.z, gr: w.w, cc: c.x, canopy: false, detail: true, dots,
  }));
  mat.name = 'corridor';
  return mat;
}
