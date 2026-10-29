/**
 * Bodenmaterialien für den WebGPU-Test: Wiese, Waldboden, Fels, Schnee, Kies, Beton – aus den gebackenen
 * Oberflächen gemischt. Gewichte und Grundfarben kommen je Ecke aus der Landschaft (terrain3d) bzw. aus dem
 * Querprofil der Straße (Korridor). Fels wird von drei Seiten projiziert (keine gestreckten Texturen an Wänden).
 */
import * as THREE from 'three/webgpu';
import type { Surface, SurfaceId } from './bake';
import { decodeAlbedo, planar, planarN, triplanar, tsl, type N } from './nodes';
import { cheapMaterial } from './light';

const { attribute, cameraPosition, float, fwidth, max, mix, normalize, normalWorldGeometry, positionWorld, smoothstep, texture, transformNormalToView, varying, vec3, vertexColor } = tsl;

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
  /** ganz fern (grobe Stufe): Fels nur von oben */
  far?: boolean;
  /** Straßenrand (Kies und Beton) */
  road?: boolean;
}

const meanOf = (s: Surface): N => vec3(s.mean.r, s.mean.g, s.mean.b);

/** grobes Waldgewicht (Felsköpfe nicht mitten im Wald) */
const foBase = (m: Mix): N => smoothstep(0.1, 0.5, m.fo);

/**
 * Großflächiges je Ecke (im Vertex-Shader, aus kleinen Mipmaps der gebackenen Texturen): Farbzonen der Wiese,
 * trockene Stellen, Baumgrenze, Felsköpfe, Wandpartien, Schneeflecken, Blütendichte. Das ändert sich über ein paar
 * Meter kaum – je Bildpunkt gelesen kostete es sieben Texturzugriffe. spacing: Abstand der Ecken (m).
 */
function perVertex(S: Surfaces, detail: boolean, spacing: number) {
  const pos = positionWorld;
  const lvl = (t: THREE.Texture, scale: number) => {
    const w = (t.image as { width?: number } | undefined)?.width ?? 1024;
    return Math.max(0, Math.log2((w * spacing) / scale));
  };
  const smp = (s: Surface, scale: number): N => texture(s.albedo, pos.xz.div(scale)).level(lvl(s.albedo, scale));
  const nzv = (scale: number): N => texture(S.noise.albedo, pos.xz.div(scale)).level(lvl(S.noise.albedo, scale)).rgb;
  const gm = meanOf(S.grass);
  return {
    /** Wiese grob (29 m), relativ zum Mittel */
    gC: varying(decodeAlbedo(smp(S.grass, 29).rgb).div(gm), 'vGC') as N,
    /** sehr groß (173 m): trockene und satte Flächen */
    macro: varying(smp(S.grass, 173).rgb, 'vMacro') as N,
    /** Baumgrenze ausfransen (97 m) */
    wob: varying(decodeAlbedo(smp(S.grass, 97).rgb).div(gm).y.sub(1), 'vWob') as N,
    /** Felsköpfe und Erdflecken */
    rk2: varying(nzv(detail ? 41 : 160), 'vRk2') as N,
    /** Wandpartien (hell/dunkel, rötlich), Grasbänder */
    zone: varying(nzv(detail ? 140 : 520), 'vZone') as N,
    /** Schneeflecken */
    patchy: varying(smoothstep(0.35, 0.75, nzv(330).z.mul(0.7).add(nzv(70).y.mul(0.3))), 'vPatch') as N,
    /** Blütendichte */
    many: varying(smoothstep(0.3, 0.7, decodeAlbedo(smp(S.grass, 53).rgb).x.div(gm.x).mul(0.5)), 'vMany') as N,
  };
}

/**
 * Schattierung aus den Gewichten: Farbe, Verschattung, Weltnormale. Je Bildpunkt nah höchstens zwölf
 * Texturzugriffe (Wiese, Blüten, Kies, Fels von drei Seiten, Schnee), fern fünf bis acht.
 */
function shade(S: Surfaces, m: Mix, spacing: number) {
  const pos = positionWorld;
  const nG = normalize(normalWorldGeometry);
  const V = perVertex(S, m.detail, spacing);
  const gm = meanOf(S.grass);
  // Wiese fein (3,2 m): nur nah
  const gF = m.detail ? planar(S.grass.albedo, S.grass.nra, pos.xz.div(3.2), nG, 0.9) : null;
  const gC: N = V.gC;
  const gDet: N = gF ? decodeAlbedo(gF.col).div(gm) : gC;
  const macro: N = V.macro;
  const dryW = smoothstep(0.42, 0.6, macro.y.mul(macro.y).div(gm.y).mul(0.5));
  const meadow = vec3(MEADOW.r, MEADOW.g, MEADOW.b);
  const base = mix(mix(vec3(m.tint.dot(vec3(0.3, 0.55, 0.15))), m.tint, 0.78).mul(0.9), meadow, 0.55);
  const flat = smoothstep(0.5, 0.82, nG.y);
  const steepG = float(1).sub(smoothstep(0.72, 0.95, nG.y));
  const tint = mix(base, base.mul(vec3(1.25, 1.05, 0.62)), dryW.mul(0.55).add(steepG.mul(0.3)).min(0.8)).mul(macro.x.mul(0.6).add(0.75).clamp(0.7, 1.25));
  let grassCol: N = tint.mul(m.detail ? mix(gC.mul(0.35).add(0.65), gDet.mul(0.7).add(gC.mul(0.3)), flat) : mix(float(1), gC.mul(0.6).add(0.4), flat));
  const camD = pos.sub(cameraPosition).length();
  if (m.dots) {
    const fd = texture(m.dots, pos.xz.div(3));
    const many = V.many.mul(flat);
    const texPx = fwidth(pos.x).add(fwidth(pos.z)).mul(0.5).div(3).mul(512);
    const near = float(1).sub(smoothstep(3, 8, texPx)).mul(float(1).sub(smoothstep(40, 80, camD)));
    const thr = many.mul(0.29);
    const show = float(1).sub(smoothstep(thr.sub(0.02), thr, fd.a)).mul(near);
    grassCol = mix(grassCol, decodeAlbedo(fd.rgb).mul(0.85), show);
    grassCol = mix(grassCol, grassCol.add(vec3(0.022, 0.02, 0.008)), many.mul(float(1).sub(near)).mul(0.5));
  }
  let col: N = grassCol;
  let ao: N = gF ? mix(float(1), gF.ao, flat) : float(1);
  let n: N = gF ? normalize(mix(nG, gF.n, flat)) : normalize(mix(nG, planarN(S.grass.nra, pos.xz.div(m.canopy ? 47 : 23), nG, 3.2), 0.7));
  const rk2: N = V.rk2;
  // ein Kieszugriff für Erde, Geröll und Bankett
  const gv = m.detail || m.sc ? planar(S.gravel.albedo, S.gravel.nra, pos.xz.div(m.detail ? 1.6 : 9), nG, m.detail ? 0.8 : 1.4) : null;
  if (m.detail && gv) {
    const dirt = smoothstep(0.8, 0.9, rk2.y.add(steepG.mul(0.12))).mul(0.8);
    const soil = mix(vec3(0.075, 0.058, 0.04), decodeAlbedo(gv.col).mul(0.55), smoothstep(0.85, 1.2, decodeAlbedo(gv.col).x.div(meanOf(S.gravel).x)));
    col = mix(col, soil, dirt);
    n = normalize(mix(n, gv.n, dirt));
  }
  // Wald: nah Waldboden, fern Kronendach (Buckel aus der groben Wiese)
  const crown = gC.dot(vec3(0.3, 0.5, 0.2));
  const canopyCol = mix(vec3(0.03, 0.052, 0.024), vec3(0.095, 0.13, 0.052), crown.mul(0.6).clamp(0, 1)).mul(gC.y.mul(0.35).add(0.82));
  const floorCol = mix(m.tint.mul(0.55), mix(vec3(0.07, 0.06, 0.035), vec3(0.09, 0.075, 0.045), gDet.x.mul(0.5).clamp(0, 1)), 0.6).mul(gDet.mul(0.5).add(0.5));
  const forestCol = m.canopy ? canopyCol : mix(floorCol, canopyCol, smoothstep(110, 260, camD));
  const fo = smoothstep(0.25, 0.75, m.fo.add(V.wob.mul(0.45)));
  const clumps = smoothstep(0.62, 0.8, crown.mul(0.5)).mul(smoothstep(0.02, 0.3, m.fo)).mul(0.8);
  const foW = max(fo, clumps);
  col = mix(col, forestCol, foW);
  // Kies und Beton (Bankett, Rinne, Mauerkrone)
  if (m.detail && gv && m.road) {
    const gravelCol = decodeAlbedo(gv.col).mul(0.62);
    col = mix(col, gravelCol, m.gr);
    ao = mix(ao, gv.ao, m.gr);
    n = mix(n, gv.n, m.gr);
    const concrete = vec3(0.3, 0.29, 0.27).mul(decodeAlbedo(gv.col).div(meanOf(S.gravel)).mul(0.25).add(0.75));
    col = mix(col, concrete, m.cc);
    n = mix(n, mix(nG, gv.n, 0.25), m.cc);
  }
  // Geröll unter den Wänden
  const screeCol: N = gv ? decodeAlbedo(gv.col).div(meanOf(S.gravel)).mul(m.rockTint).mul(1.05) : null;
  if (gv && m.sc) {
    col = mix(col, screeCol, m.sc);
    ao = mix(ao, gv.ao, m.sc);
    n = normalize(mix(n, gv.n, m.sc));
  }
  // Fels: nah und mittel von drei Seiten (Wände mit Schichtbänken, von oben Blöcke), ganz fern nur von oben
  const outcrop = smoothstep(0.72, 0.82, rk2.x.add(steepG.mul(0.15))).mul(steepG).mul(float(1).sub(foBase(m)));
  const rkW = max(m.rk, outcrop.mul(0.9));
  const zone: N = V.zone;
  let rockCol: N;
  let rockN: N;
  let rockAo: N;
  if (m.far) {
    const t = texture(S.rock.albedo, pos.xz.div(60));
    rockCol = decodeAlbedo(t.rgb).div(meanOf(S.rock)).mul(m.rockTint).mul(0.95);
    rockN = n;
    rockAo = float(1);
  } else {
    const top = { albedo: S.rock.albedo, nra: S.rock.nra };
    const r = triplanar(S.cliff.albedo, S.cliff.nra, pos, nG, m.detail ? 9 : 27, 10, top, m.detail ? 1.5 : 2);
    const rRaw = decodeAlbedo(r.col).div(meanOf(S.cliff));
    rockCol = rRaw.mul(m.rockTint).mul(0.6).add(rRaw.mul(vec3(0.2, 0.19, 0.17)).mul(0.4)).mul(1.15);
    rockN = r.n;
    rockAo = r.ao;
  }
  rockCol = rockCol.mul(zone.z.mul(0.45).add(0.8)).mul(mix(vec3(1, 1, 1), vec3(1.12, 1.0, 0.84), smoothstep(0.55, 0.85, zone.x)));
  const ledgeG = smoothstep(0.82, 0.95, normalize(rockN).y).mul(float(1).sub(smoothstep(0.05, 0.4, m.sn))).mul(smoothstep(0.3, 0.6, zone.y.add(0.15)));
  const rkV = rkW.mul(float(1).sub(ledgeG.mul(0.85)));
  col = mix(col, rockCol, rkV);
  ao = mix(ao, rockAo, rkV);
  n = mix(n, rockN, rkW);
  if (gv && m.sc) {
    const sr = rkV.mul(smoothstep(0.6, 0.82, nG.y)).mul(smoothstep(0.3, 0.6, zone.y)).mul(0.85);
    col = mix(col, screeCol, sr);
    n = mix(n, gv.n, sr);
  }
  // Schnee: Altschnee in Flecken; auf Fels nur auf Simsen
  const sA = decodeAlbedo(texture(S.snow.albedo, pos.xz.div(m.detail ? 6 : 17)).rgb).div(meanOf(S.snow));
  const ledge = smoothstep(0.72, 0.9, normalize(rockN).y);
  const snowRaw = m.sn.mul(V.patchy.mul(0.9).add(0.2)).mul(mix(float(1), ledge, rkW.mul(0.7)));
  const sn = smoothstep(0.36, 0.46, snowRaw);
  const snowCol = sA.mul(vec3(0.83, 0.86, 0.9)).mul(sA.x.mul(0.25).add(0.75).clamp(0.6, 1.2));
  col = mix(col, snowCol, sn);
  ao = mix(ao, float(0.95), sn);
  n = mix(n, normalize(mix(nG, n, 0.35)), sn);
  return { col, ao, n: normalize(n) };
}

function apply(o: ReturnType<typeof shade>, name: string): THREE.MeshLambertNodeMaterial {
  const mat = cheapMaterial({ col: o.col, nWorld: o.n, ao: o.ao });
  mat.name = name;
  return mat;
}

/**
 * Landschaft (Kacheln aus terrain3d): Farbe = Wiese der Gegend, aMat = (Wald, Fels, Schnee, Rauschen),
 * aRock = Felsfarbe, aNz = großflächiges Rauschen. lv 0 mit echten Bäumen, darüber Kronendach.
 */
export function terrainMaterial(S: Surfaces, lv: number, dots?: THREE.Texture): THREE.MeshLambertNodeMaterial {
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
  const spacing = [4, 16, 64][lv] ?? 16;
  const mat = apply(shade(S, {
    tint: vertexColor(), rockTint: attribute('aRock', 'vec3'),
    fo, rk, sn, sc, gr: float(0), cc: float(0), canopy: lv > 0, detail: lv === 0, far: lv >= 2, dots: lv === 0 ? dots : undefined,
  }, spacing), `terrain${lv}`);
  // Prüfmodus: Stufen einfärben (?lvcolor)
  if (/[?&]lvcolor\b/.test(location.search)) mat.colorNode = vec3(lv === 0 ? 0.6 : 0.05, lv === 1 ? 0.6 : 0.05, lv === 2 ? 0.6 : 0.05);
  if (/[?&]dbgmat\b/.test(location.search)) { mat.colorNode = vec3(fo, rk, sn).mul(0.5).add(0.02); mat.normalNode = transformNormalToView(normalize(normalWorldGeometry)); }
  if (/[?&]dbgcol\b/.test(location.search)) { mat.colorNode = vertexColor(); mat.normalNode = transformNormalToView(normalize(normalWorldGeometry)); }
  return mat;
}

/** Straßenrand (Korridor): Farbe der Gegend je Ecke, Gewichte aW = (Wald, Fels, Schnee, Kies), aC = (Beton, Felsfarbe) */
export function corridorMaterial(S: Surfaces, dots?: THREE.Texture): THREE.MeshLambertNodeMaterial {
  const w = attribute('aW', 'vec4');
  const c = attribute('aC', 'vec4');
  return apply(shade(S, {
    tint: vertexColor(), rockTint: c.yzw, fo: w.x, rk: w.y, sn: w.z, gr: w.w, cc: c.x, canopy: false, detail: true, road: true, dots,
  }, 3), 'corridor');
}
