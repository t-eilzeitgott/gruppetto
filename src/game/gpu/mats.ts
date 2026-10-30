/**
 * Materialien der Straße für den WebGPU-Test: Asphalt (gebackene Oberfläche, Fahrspuren glatter), Markierungen
 * (Farbe folgt dem Asphalt), verzinkter Stahl, Holz, Anstrich, Banden.
 */
import * as THREE from 'three/webgpu';
import type { Surface, SurfaceId } from './bake';
import { decodeAlbedo, grain, h21, tsl, unTile, vn1, type N } from './nodes';
import { MOOD_U } from './mood';
import { ambientAt, cheapMaterial, SUN } from './light';
import { groundMap, lampLit, terrainSun } from './sunmap';

const { attribute, cameraPosition, clamp, dot, float, floor, fwidth, max, min, mix, normalize, normalWorldGeometry, positionWorld, pow, reflect, select, smoothstep, step, texture, uv, vec2, vec3, vertexColor } = tsl;

type Surfaces = Record<SurfaceId, Surface>;

/** Fahrbahnbreite (m): u läuft quer 0 … 1 darüber, v längs in Fahrbahnbreiten */
const RW = 5.6;

/** Anteil eines Pixels (Breite fw) auf einem Streifen der halben Breite w um d = 0 (Kastenfilter: fern weich statt flimmernd) */
function stripe(d: N, w: number | N): N {
  const fw = max(fwidth(d), float(1e-4));
  const h = fw.mul(0.5);
  return clamp(d.add(w), h.negate(), h).sub(clamp(d.sub(w), h.negate(), h)).div(fw);
}

/** Rechteck [a, b] in einer Richtung, Kanten über die Pixelbreite geglättet */
function span(x: N, a: N, b: N): N {
  const fw = max(fwidth(x), float(1e-4));
  return smoothstep(a.sub(fw), a.add(fw), x).mul(float(1).sub(smoothstep(b.sub(fw), b.add(fw), x)));
}

/**
 * Ausbesserungen und Risse im Straßenraum (nur Rechnen, nichts wiederholt sich): je Abschnitt zufällig gesägte
 * Flicken (eine Spur, die Radspur, die ganze Breite; frisch dunkel oder alt und ausgebleicht) mit vergossener
 * Fuge, Querrisse in unregelmäßigen Abständen, eine Längsfuge in der Mitte stellenweise, dazu großflächig
 * wechselnde Alterung. um, vm: quer und längs in Metern.
 */
function roadWear(um: N, vm: N) {
  const u = um.div(RW);
  // Flicken: zwei Lagen mit verschiedener Abschnittslänge (13 m und 37 m), damit kein Takt entsteht
  const patch = (len: number, seed: number, chance: number) => {
    const c = floor(vm.div(len));
    const h = (k: number) => h21(vec2(c, seed + k * 1.37));
    const on = step(1 - chance, h(0));
    const l = mix(float(2.2), float(len * 0.75), h(1).mul(h(1)));
    const v0 = c.mul(len).add(h(2).mul(float(len).sub(l)));
    // quer: rechte Spur, linke Spur, Radspur, ganze Breite
    const k = h(3);
    const ua = select(k.lessThan(0.3), float(0.5), select(k.lessThan(0.55), float(0.0), select(k.lessThan(0.8), float(0.12).add(h(4).mul(0.5)), float(0))));
    const ub = select(k.lessThan(0.3), float(1), select(k.lessThan(0.55), float(0.5), select(k.lessThan(0.8), ua.add(0.2).add(h(5).mul(0.12)), float(1))));
    const inU = span(u, ua, ub);
    const inV = span(vm, v0, v0.add(l));
    const inside = inU.mul(inV).mul(on);
    // vergossene Fuge rund um den Flicken (3 cm, schwarz glänzend)
    const edge = max(stripe(vm.sub(v0), 0.035).add(stripe(vm.sub(v0.add(l)), 0.035)).mul(inU), stripe(u.sub(ua).mul(RW), 0.035).add(stripe(u.sub(ub).mul(RW), 0.035)).mul(inV)).min(1).mul(on);
    return { inside, edge, fresh: h(6) };
  };
  const A = patch(13, 3.1, 0.45);
  const B = patch(37, 8.3, 0.5);
  // Querrisse: je Abschnitt (7–20 m, unregelmäßig) einer, leicht gewellt, oft nur über einen Teil der Breite
  const cl = 11;
  const cc = floor(vm.div(cl));
  const ch = (k: number) => h21(vec2(cc, 21.7 + k * 2.11));
  const vc = cc.mul(cl).add(ch(0).mul(cl));
  const wav = vn1(um.mul(1.3), 17).v.sub(0.5).mul(0.18).add(um.sub(RW / 2).mul(ch(1).sub(0.5).mul(0.12)));
  const reach = smoothstep(ch(2).mul(0.6), ch(2).mul(0.6).add(0.1), select(ch(3).lessThan(0.5), u, float(1).sub(u)));
  const crack = stripe(vm.sub(vc).sub(wav), 0.018).mul(step(0.35, ch(4))).mul(reach);
  // Längsfuge in der Mitte (Einbau in zwei Bahnen), nur stellenweise offen und vergossen
  const joint = stripe(um.sub(RW / 2).add(vn1(vm.div(3.1), 29).v.sub(0.5).mul(0.05)), 0.02).mul(smoothstep(0.55, 0.65, vn1(vm.div(23), 31).v));
  // großflächige Alterung: ältere Abschnitte heller und grauer, neuere dunkler (50–300 m)
  const age = vn1(vm.div(97), 43).v.mul(0.6).add(vn1(vm.div(271), 47).v.mul(0.4));
  return { A, B, crack, joint, age };
}

/** Asphalt: u quer (0 … 1 über die Fahrbahn), v längs; aT = (rechts.x, rechts.z, vorn.x, vorn.z) */
export function roadMaterial(S: Surfaces): THREE.MeshBasicNodeMaterial {
  const p = uv();
  // Körnung ohne erkennbare Wiederholung (alle 5,6 m dieselben Steine): Koordinaten verbogen
  const pw = unTile(S.noise.albedo, p, 0.3);
  const a = texture(S.asphalt.albedo, pw);
  const t = texture(S.asphalt.nra, pw);
  const W = roadWear(p.x.mul(RW), p.y.mul(RW));
  // nass (Regen): dunkler und spiegelnd (Himmel in Spiegelrichtung, zum flachen Winkel stärker)
  const wet = MOOD_U.wet as unknown as N;
  // fleckig: Bindemittel mal satter, mal heller (über einen Meter und feiner)
  let col: N = decodeAlbedo(a.rgb).mul(grain(p.mul(RW), 1.1, 0.09)).mul(grain(p.mul(RW).add(31.7), 0.23, 0.07));
  // Alterung: heller und grauer (Bindemittel ausgewaschen) oder satt dunkel
  col = mix(col.mul(0.82), col.mul(1.22).add(vec3(0.012, 0.012, 0.011)), W.age);
  // Flicken: frisch = dunkel, kaum Körner; alt = heller, ausgebleicht
  const pa = (P: ReturnType<typeof roadWear>['A'], k: number) => {
    const freshCol = mix(col, vec3(0.03, 0.031, 0.034), 0.72);
    const oldCol = col.mul(1.32).add(vec3(0.014, 0.014, 0.012));
    col = mix(col, select(P.fresh.lessThan(0.55), freshCol, oldCol), P.inside.mul(k));
    col = mix(col, vec3(0.016, 0.016, 0.018), P.edge.mul(0.85));
  };
  pa(W.B, 0.9);
  pa(W.A, 1);
  col = mix(col, vec3(0.014, 0.014, 0.016), W.crack.max(W.joint).mul(0.9));
  col = col.mul(mix(1, 0.55, wet));
  const T = attribute('aT', 'vec4');
  const R = vec3(T.x, 0, T.y);
  const F = vec3(T.z, 0, T.w);
  // Flicken glatter (frisch gewalzt): die Körnung kippt die Normale dort weniger
  const smooth = W.A.inside.max(W.B.inside).mul(0.5);
  const xy = t.xy.mul(2).sub(1).mul(float(1).sub(smooth));
  const n = normalize(normalize(normalWorldGeometry).add(R.mul(xy.x)).add(F.mul(xy.y)));
  // Glanz ohne PBR: Himmel in Spiegelrichtung (flacher Blick: mehr, Schlick), dazu ein Glanzlicht der Sonne;
  // nass glatter und stärker; vergossene Fugen glänzen (Bitumen)
  const view = normalize(positionWorld.sub(cameraPosition));
  const refl = reflect(view, n);
  const ndv = max(dot(view.negate(), n), float(0));
  const fres = pow(float(1).sub(ndv), 5).mul(0.96).add(0.04);
  const tar = W.A.edge.max(W.B.edge).max(W.crack).max(W.joint);
  const rough = min(mix(t.z, t.z.mul(0.45).add(0.08), wet), float(1).sub(tar.mul(0.5)));
  // Spiegelrichtung leicht nach oben (der gemessene Himmel zur Seite enthält den dunklen Boden)
  const up = normalize(vec3(refl.x, max(refl.y, float(0.25)), refl.z));
  const sheen = ambientAt(up).mul(fres).mul(mix(float(0.5), float(1.5), wet)).mul(float(1).sub(rough.mul(0.45)));
  const hv = normalize(SUN.dir.sub(view));
  // vorberechnetes Sonnenlicht: Berge (Geländelicht) und Dinge am Rand (Bodenkarte); Laternen spiegeln warm
  const g = groundMap(positionWorld.xz);
  const vis = terrainSun(positionWorld.xz).mul(g.x);
  const glint = pow(max(dot(n, hv), float(0)), mix(float(40), float(140), wet)).mul(fres.mul(0.8).add(0.02)).mul(SUN.col).mul(mix(float(0.12), float(2), wet)).mul(vis);
  const m = cheapMaterial({ col, nWorld: n, ao: t.w, vis, extra: sheen.add(glint).add(lampLit(col.add(fres.mul(0.05)), g.w)) });
  if (/[?&]dbgroad\b/.test(location.search)) m.colorNode = vec3(W.A.inside.add(W.A.edge), W.B.inside.add(W.B.edge), W.crack.add(W.joint)).mul(0.3).add(0.02);
  m.name = 'road';
  return m;
}

/** Fahrbahnmarkierung: weiße Farbe, abgefahren, mit den Körnern des Asphalts darunter */
export function marksMaterial(S: Surfaces): THREE.MeshBasicNodeMaterial {
  const p = uv();
  const a = decodeAlbedo(texture(S.asphalt.albedo, p).rgb).dot(vec3(0.33, 0.33, 0.34));
  const wet = MOOD_U.wet as unknown as N;
  const col = vec3(0.78, 0.78, 0.76).mul(a.div(0.075).mul(0.18).add(0.72)).mul(mix(1, 0.7, wet));
  const g = groundMap(positionWorld.xz);
  const m = cheapMaterial({ col, nWorld: normalWorldGeometry, vis: terrainSun(positionWorld.xz).mul(g.x), extra: lampLit(col, g.w) });
  m.name = 'marks';
  return m;
}

/** verzinkter Stahl (Leitplanken): spiegelt – bleibt physikalisch */
export function metalMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true, metalness: 0.85, roughness: 0.36 });
  m.name = 'metal';
  return m;
}

export function woodMaterial(): THREE.MeshBasicNodeMaterial {
  const m = cheapMaterial({ col: vertexColor().xyz, nWorld: normalWorldGeometry });
  m.name = 'wood';
  return m;
}

export function paintMaterial(): THREE.MeshBasicNodeMaterial {
  const m = cheapMaterial({ col: vertexColor().xyz, nWorld: normalWorldGeometry });
  m.name = 'paint';
  return m;
}

/** Werbebanden: Atlas aus dem Spiel (Leinwand) */
export function adsMaterial(atlas: HTMLCanvasElement): THREE.MeshBasicNodeMaterial {
  const tex = new THREE.CanvasTexture(atlas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = cheapMaterial({ col: texture(tex, uv()).rgb, nWorld: normalWorldGeometry });
  m.map = tex;
  m.name = 'ads';
  return m;
}
