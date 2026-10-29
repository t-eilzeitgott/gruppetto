/**
 * Materialien der Straße für den WebGPU-Test: Asphalt (gebackene Oberfläche, Fahrspuren glatter), Markierungen
 * (Farbe folgt dem Asphalt), verzinkter Stahl, Holz, Anstrich, Banden.
 */
import * as THREE from 'three/webgpu';
import type { Surface, SurfaceId } from './bake';
import { decodeAlbedo, tsl, type N } from './nodes';
import { MOOD_U } from './mood';
import { ambientAt, cheapMaterial, SUN } from './light';

const { attribute, cameraPosition, dot, float, max, mix, normalize, normalWorldGeometry, positionWorld, pow, reflect, texture, uv, varying, vec2, vec3, vertexColor } = tsl;

type Surfaces = Record<SurfaceId, Surface>;

/** Asphalt: u quer (0 … 1 über die Fahrbahn), v längs; aT = (rechts.x, rechts.z, vorn.x, vorn.z) */
export function roadMaterial(S: Surfaces): THREE.MeshLambertNodeMaterial {
  const p = uv();
  const a = texture(S.asphalt.albedo, p);
  const t = texture(S.asphalt.nra, p);
  // großflächig: Flicken, Abrieb, Sonnenbleiche (je Ecke – ändert sich über Meter)
  const big = varying(decodeAlbedo(texture(S.asphalt.albedo, p.mul(vec2(0.071, 0.043))).level(6).rgb).dot(vec3(0.33, 0.33, 0.34)).div(0.075), 'vBig');
  // nass (Regen): dunkler und spiegelnd (Himmel in Spiegelrichtung, zum flachen Winkel stärker)
  const wet = MOOD_U.wet as unknown as N;
  const col = decodeAlbedo(a.rgb).mul(big.mul(0.35).add(0.7)).mul(mix(1, 0.55, wet));
  const T = attribute('aT', 'vec4');
  const R = vec3(T.x, 0, T.y);
  const F = vec3(T.z, 0, T.w);
  const xy = t.xy.mul(2).sub(1);
  const n = normalize(normalize(normalWorldGeometry).add(R.mul(xy.x)).add(F.mul(xy.y)));
  // Glanz ohne PBR: Himmel in Spiegelrichtung (flacher Blick: mehr, Schlick), dazu ein Glanzlicht der Sonne;
  // nass glatter und stärker
  const view = normalize(positionWorld.sub(cameraPosition));
  const refl = reflect(view, n);
  const ndv = max(dot(view.negate(), n), float(0));
  const fres = pow(float(1).sub(ndv), 5).mul(0.96).add(0.04);
  const rough = mix(t.z, t.z.mul(0.45).add(0.08), wet);
  // Spiegelrichtung leicht nach oben (der gemessene Himmel zur Seite enthält den dunklen Boden)
  const up = normalize(vec3(refl.x, max(refl.y, float(0.25)), refl.z));
  const sheen = ambientAt(up).mul(fres).mul(mix(float(0.5), float(1.5), wet)).mul(float(1).sub(rough.mul(0.45)));
  const hv = normalize(SUN.dir.sub(view));
  const glint = pow(max(dot(n, hv), float(0)), mix(float(40), float(140), wet)).mul(fres.mul(0.8).add(0.02)).mul(SUN.col).mul(mix(float(0.12), float(2), wet));
  const m = cheapMaterial({ col, nWorld: n, ao: t.w, extra: sheen.add(glint) });
  m.name = 'road';
  return m;
}

/** Fahrbahnmarkierung: weiße Farbe, abgefahren, mit den Körnern des Asphalts darunter */
export function marksMaterial(S: Surfaces): THREE.MeshLambertNodeMaterial {
  const p = uv();
  const a = decodeAlbedo(texture(S.asphalt.albedo, p).rgb).dot(vec3(0.33, 0.33, 0.34));
  const wet = MOOD_U.wet as unknown as N;
  const m = cheapMaterial({ col: vec3(0.78, 0.78, 0.76).mul(a.div(0.075).mul(0.18).add(0.72)).mul(mix(1, 0.7, wet)), nWorld: normalWorldGeometry });
  m.name = 'marks';
  return m;
}

/** verzinkter Stahl (Leitplanken): spiegelt – bleibt physikalisch */
export function metalMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true, metalness: 0.85, roughness: 0.36 });
  m.name = 'metal';
  return m;
}

export function woodMaterial(): THREE.MeshLambertNodeMaterial {
  const m = cheapMaterial({ col: vertexColor().xyz, nWorld: normalWorldGeometry });
  m.name = 'wood';
  return m;
}

export function paintMaterial(): THREE.MeshLambertNodeMaterial {
  const m = cheapMaterial({ col: vertexColor().xyz, nWorld: normalWorldGeometry });
  m.name = 'paint';
  return m;
}

/** Werbebanden: Atlas aus dem Spiel (Leinwand) */
export function adsMaterial(atlas: HTMLCanvasElement): THREE.MeshLambertNodeMaterial {
  const tex = new THREE.CanvasTexture(atlas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = cheapMaterial({ col: texture(tex, uv()).rgb, nWorld: normalWorldGeometry });
  m.map = tex;
  m.name = 'ads';
  return m;
}
