/**
 * Materialien der Straße für den WebGPU-Test: Asphalt (gebackene Oberfläche, Fahrspuren glatter), Markierungen
 * (Farbe folgt dem Asphalt), verzinkter Stahl, Holz, Anstrich, Banden.
 */
import * as THREE from 'three/webgpu';
import type { Surface, SurfaceId } from './bake';
import { decodeAlbedo, tsl, type N } from './nodes';
import { MOOD_U } from './mood';

const { attribute, float, mix, normalize, normalWorldGeometry, texture, transformNormalToView, uv, vec2, vec3 } = tsl;

type Surfaces = Record<SurfaceId, Surface>;

/** Asphalt: u quer (0 … 1 über die Fahrbahn), v längs; aT = (rechts.x, rechts.z, vorn.x, vorn.z) */
export function roadMaterial(S: Surfaces): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = uv();
  const a = texture(S.asphalt.albedo, p);
  const t = texture(S.asphalt.nra, p);
  // großflächig: Flicken, Abrieb, Sonnenbleiche
  const big = decodeAlbedo(texture(S.asphalt.albedo, p.mul(vec2(0.071, 0.043))).rgb).dot(vec3(0.33, 0.33, 0.34)).div(0.075);
  // nass (Regen): dunkler und spiegelnd
  const wet = MOOD_U.wet as unknown as N;
  m.colorNode = decodeAlbedo(a.rgb).mul(big.mul(0.35).add(0.7)).mul(mix(1, 0.55, wet));
  m.roughnessNode = mix(t.z, t.z.mul(0.45).add(0.08), wet);
  m.metalnessNode = float(0);
  m.aoNode = t.w;
  const T = attribute('aT', 'vec4');
  const R = vec3(T.x, 0, T.y);
  const F = vec3(T.z, 0, T.w);
  const xy = t.xy.mul(2).sub(1);
  m.normalNode = transformNormalToView(normalize(normalize(normalWorldGeometry).add(R.mul(xy.x)).add(F.mul(xy.y))));
  m.name = 'road';
  return m;
}

/** Fahrbahnmarkierung: weiße Farbe, abgefahren, mit den Körnern des Asphalts darunter */
export function marksMaterial(S: Surfaces): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = uv();
  const a = decodeAlbedo(texture(S.asphalt.albedo, p).rgb).dot(vec3(0.33, 0.33, 0.34));
  const wet = MOOD_U.wet as unknown as N;
  m.colorNode = vec3(0.78, 0.78, 0.76).mul(a.div(0.075).mul(0.18).add(0.72)).mul(mix(1, 0.7, wet));
  m.roughnessNode = mix(float(0.55), float(0.15), wet);
  m.name = 'marks';
  return m;
}

export function metalMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true, metalness: 0.85, roughness: 0.36 });
  m.name = 'metal';
  return m;
}

export function woodMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true, metalness: 0, roughness: 0.88 });
  m.name = 'wood';
  return m;
}

export function paintMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true, metalness: 0, roughness: 0.55 });
  m.name = 'paint';
  return m;
}

/** Werbebanden: Atlas aus dem Spiel (Leinwand), leicht glänzende Folie */
export function adsMaterial(atlas: HTMLCanvasElement): THREE.MeshStandardNodeMaterial {
  const tex = new THREE.CanvasTexture(atlas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.MeshStandardNodeMaterial({ map: tex, metalness: 0, roughness: 0.5 });
  m.name = 'ads';
  return m;
}
