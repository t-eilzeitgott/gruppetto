/**
 * Himmel und Licht für den WebGPU-Test: physikalischer Himmel (Preetham, mit Wolken) je Stimmung einmal in eine
 * Würfeltextur gerendert – als Hintergrund (Kuppel, die zwei Stimmungen überblenden kann) und, vorgefiltert, als
 * Umgebungslicht. Dazu Sonne/Mond als gerichtetes Licht mit Schatten, Himmelslicht (Hemisphäre), Sterne für die
 * Nacht und Regenstreifen.
 */
import * as THREE from 'three/webgpu';
import { SkyMesh } from '../../../vendor/three/addons/SkyMesh.js';
import { dirOf, type SkyParams } from './mood';
import { tsl, h21, type N } from './nodes';

const { attribute, cameraPosition, cameraViewMatrix, cubeTexture, float, fract, mix, normalize, positionGeometry, positionWorld, smoothstep, time, uniform, vec2, vec3, vec4 } = tsl;

export interface SkyCube { background: THREE.Texture; environment: THREE.Texture; dispose(): void }

/** Himmel einer Stimmung backen: Würfel (ohne Sonnenscheibe) und vorgefiltertes Umgebungslicht */
export function bakeSkyCube(renderer: THREE.WebGPURenderer, p: SkyParams, size: number): SkyCube {
  const sky = new SkyMesh();
  sky.scale.setScalar(4000);
  sky.turbidity.value = p.turbidity;
  sky.rayleigh.value = p.rayleigh;
  sky.mieCoefficient.value = p.mie;
  sky.mieDirectionalG.value = p.mieG;
  sky.sunPosition.value.copy(dirOf(p.elev, p.azim));
  sky.cloudCoverage.value = p.cover;
  sky.cloudDensity.value = p.density;
  sky.cloudElevation.value = p.cloudElev;
  sky.cloudScale.value = 0.00022;
  sky.showSunDisc.value = 0;
  const skyScene = new THREE.Scene();
  skyScene.add(sky);
  const cubeRT = new THREE.CubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cubeCam = new THREE.CubeCamera(1, 10000, cubeRT);
  skyScene.add(cubeCam);
  (cubeCam as unknown as { update(r: unknown, s: unknown): void }).update(renderer, skyScene);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(skyScene as unknown as THREE.Scene, 0, 1, 10000);
  pmrem.dispose();
  sky.geometry.dispose();
  (sky.material as THREE.Material).dispose();
  return { background: cubeRT.texture, environment: envRT.texture, dispose() { cubeRT.dispose(); envRT.dispose(); } };
}

/** Sonne (oder Mond): gerichtetes Licht mit Schatten */
export function makeSun(): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 3;
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  // weit nach hinten: mit umgekehrter Tiefe galt alles hinter der fernen Ebene als verschattet (Täler schwarz)
  sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 6000;
  return sun;
}

/**
 * Himmelskuppel: mischt zwei Würfel (Stimmung A → B) mit dem Faktor t, darüber Sterne bei Nacht.
 * Die Würfel lassen sich austauschen (cubeA.value = …).
 */
export function makeDome(texA: THREE.Texture, texB: THREE.Texture) {
  const cubeA = cubeTexture(texA);
  const cubeB = cubeTexture(texB);
  const mixT = uniform(0);
  const night = uniform(0);
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  m.fog = false;
  const dir: N = normalize(positionWorld.sub(cameraPosition));
  const look = vec3(dir.x, dir.y, dir.z);
  const a = cubeA.sample(look).rgb;
  const b = cubeB.sample(look).rgb;
  let col: N = mix(a, b, mixT);
  // Sterne: feste Punkte auf der Kugel (Zellen), funkeln leicht; nur über dem Horizont
  const cell = 90;
  const uv2 = vec2(dir.x.mul(cell).add(dir.z.mul(cell * 0.6)), dir.y.mul(cell).add(dir.z.mul(cell * 0.3)));
  const id = uv2.floor();
  const f = fract(uv2).sub(0.5);
  const h = h21(id);
  const off = vec2(h21(id.add(1.3)), h21(id.add(7.1))).sub(0.5).mul(0.7);
  const d2 = f.sub(off).length();
  const bright = smoothstep(0.92, 1, h);
  const twinkle = float(0.7).add(tsl.sin(time.mul(2).add(h.mul(60))).mul(0.3));
  const star = smoothstep(0.08, 0.0, d2).mul(bright).mul(twinkle).mul(smoothstep(0.02, 0.2, dir.y));
  col = col.add(vec3(0.9, 0.95, 1.1).mul(star).mul(night).mul(3));
  m.colorNode = col;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(9000, 24, 12), m);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.matrixAutoUpdate = false;
  return { mesh, cubeA, cubeB, mixT, night };
}

/**
 * Regen: Streifen um die Kamera als Instanzen (ein Kasten, der mit der Kamera wandert; die Streifen fallen und
 * wickeln sich im Kasten um). Zur Kamera gedreht, leicht im Wind geneigt.
 */
export function makeRain(n = 1400): { mesh: THREE.Mesh; strength: { value: number } } {
  const geo = new THREE.InstancedBufferGeometry();
  // ein schmaler Streifen, 0,6 m lang
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.006, 0, 0, 0.006, 0, 0, 0.006, 0.6, 0, -0.006, 0.6, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const seeds = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { seeds[i * 4] = Math.random(); seeds[i * 4 + 1] = Math.random(); seeds[i * 4 + 2] = Math.random(); seeds[i * 4 + 3] = 0.7 + Math.random() * 0.6; }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = n;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const strength = uniform(0);
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  m.fog = false;
  const s = attribute('aSeed', 'vec4');
  const BOX = vec3(22, 14, 22);
  const fall = time.mul(s.w).mul(9);
  // Lage im Kasten, bezogen auf die (gerasterte) Kamera
  const base = vec3(s.x, s.y, s.z).mul(BOX);
  const wind = vec3(time.mul(0.8), 0, time.mul(0.3));
  const local = tsl.mod(base.add(vec3(0, fall.negate(), 0)).add(wind), BOX).sub(BOX.mul(0.5));
  const center = cameraPosition.add(local);
  const V = cameraViewMatrix;
  const right = vec3(V.element(0).x, V.element(1).x, V.element(2).x);
  const p = positionGeometry;
  const world = center.add(right.mul(p.x)).add(vec3(0.12, 1, 0.05).normalize().mul(p.y));
  m.positionNode = world;
  const dc = local.length().div(14);
  m.colorNode = vec4(0.75, 0.8, 0.9, float(0.28).mul(strength).mul(float(1).sub(smoothstep(0.6, 1, dc))).mul(smoothstep(0, 0.15, p.y)));
  const mesh = new THREE.Mesh(geo, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  mesh.visible = false;
  return { mesh, strength };
}
