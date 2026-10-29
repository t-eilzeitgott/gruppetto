/**
 * Himmel und Licht für den WebGPU-Test: physikalischer Himmel (Preetham, mit Wolken) je Stimmung einmal in eine
 * Würfeltextur gerendert – als Hintergrund (Kuppel, die zwei Stimmungen überblenden kann) und, vorgefiltert, als
 * Umgebungslicht. Dazu Sonne/Mond als gerichtetes Licht mit Schatten, Himmelslicht (Hemisphäre), Sterne für die
 * Nacht und Regenstreifen.
 */
import * as THREE from 'three/webgpu';
import { SkyMesh } from '../../../vendor/three/addons/SkyMesh.js';
import { dirOf, type SkyParams } from './mood';
import { tsl, h21, fbm, vnoise, type N } from './nodes';

const { atan, attribute, cameraPosition, cameraViewMatrix, cubeTexture, dot, exp, float, fract, max, mix, normalize, positionGeometry, positionWorld, pow, smoothstep, time, uniform, vec2, vec3, vec4 } = tsl;

/** background: Kuppel (mit Wolken, wenn dramatisch), plain: blanker Himmel (Dunst), environment: Umgebungslicht */
export interface SkyCube { background: THREE.Texture; plain: THREE.Texture; environment: THREE.Texture; dispose(): void }

/** Licht der Stimmung für die Wolken des dramatischen Himmels (Sonne – oder nachts der Mond) */
export interface CloudLight { elev: number; azim: number; r: number; g: number; b: number }

/**
 * Himmel einer Stimmung backen: Würfel (ohne Sonnenscheibe) und vorgefiltertes Umgebungslicht.
 * Mit `drama` kommen gebackene Wolken dazu (Quelltürme am Horizont, ein aufgerissenes Wolkenfeld mit
 * angestrahlten Kanten, Strahlen um die tiefe Sonne) – nur in die Kuppel: Umgebungslicht und Dunst bleiben beim
 * blanken Himmel, so bleibt die Abstimmung der Stimmung gleich. Die Wolken kosten nur beim Backen; das Spiel liest
 * weiter einen Würfel. Sein Alphakanal hält fest, wie frei der Himmel ist (Sterne nur dort).
 */
export function bakeSkyCube(renderer: THREE.WebGPURenderer, p: SkyParams, size: number, drama?: CloudLight): SkyCube {
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
  const shoot = () => {
    const rt = new THREE.CubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
    const cam = new THREE.CubeCamera(1, 10000, rt);
    skyScene.add(cam);
    (cam as unknown as { update(r: unknown, s: unknown): void }).update(renderer, skyScene);
    skyScene.remove(cam);
    return rt;
  };
  const plainRT = shoot();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(skyScene as unknown as THREE.Scene, 0, 1, 10000);
  pmrem.dispose();
  let bgRT = plainRT;
  const extra: THREE.Mesh[] = [];
  if (drama) {
    // die Wolken nehmen ihre Farben aus dem blanken Himmel
    extra.push(...dramaClouds(plainRT.texture, drama, p));
    for (const m of extra) skyScene.add(m);
    bgRT = shoot();
  }
  sky.geometry.dispose();
  (sky.material as THREE.Material).dispose();
  for (const m of extra) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
  return {
    background: bgRT.texture, plain: plainRT.texture, environment: envRT.texture,
    dispose() { plainRT.dispose(); if (bgRT !== plainRT) bgRT.dispose(); envRT.dispose(); },
  };
}

/**
 * Wolken des dramatischen Himmels (nur fürs Backen – Rechenzeit egal). Helligkeit aus dem blanken Himmel (passt so
 * zu jeder Stimmung), Licht in der Farbe der Stimmung. Beleuchtung wie bei gemalten Wolken: wo die Dichte zur Sonne
 * hin abnimmt, leuchtet die Kante; dicke Kerne und sonnenabgewandte Unterseiten bleiben schieferblau.
 */
function dramaClouds(plain: THREE.Texture, L: CloudLight, p: SkyParams): THREE.Mesh[] {
  const sunV = dirOf(L.elev, L.azim);
  const sh = new THREE.Vector2(sunV.x, sunV.z).normalize();
  const cube = cubeTexture(plain);
  const S = vec3(sunV.x, sunV.y, sunV.z);
  const dir: N = normalize(positionWorld.sub(cameraPosition));
  const lum = (c: N): N => dot(c, vec3(0.2126, 0.7152, 0.0722));
  const samp = (x: number, y: number, z: number): N => cube.sample(vec3(x, y, z).normalize()).rgb;
  const zen = samp(0, 1, 0);
  const hSun = samp(sh.x, 0.08, sh.y);
  const hAnti = samp(-sh.x, 0.15, -sh.y);
  const hSide = samp(-sh.y, 0.15, sh.x);
  // Grundhelligkeit ohne den Glutfleck um die Sonne (nachts ein Rest, damit der Mond die Wolken zeichnet)
  const base: N = max(lum(zen).mul(0.5).add(lum(hSide).mul(0.3)).add(lum(hAnti).mul(0.2)), float(0.01));
  const low = Math.max(0, Math.min(1, 1 - (L.elev - 4) / 26));
  const light = vec3(L.r, L.g, L.b);
  const sunHue: N = hSun.div(max(lum(hSun), float(1e-4)));
  const warm: N = mix(light, sunHue, 0.3).max(0);
  const coolHue: N = mix(hAnti.div(max(lum(hAnti), float(1e-4))), vec3(0.78, 0.74, 0.92), 0.45).max(0);
  const litCol: N = warm.mul(base).mul(2.1 + low * 0.7);
  const shadowCol: N = coolHue.mul(base).mul(0.36 - low * 0.1);
  const behind: N = cube.sample(dir).rgb;
  const el: N = dir.y;
  const dh: N = normalize(vec2(dir.x, dir.z).add(vec2(1e-5, 0)));
  const facing: N = dot(dh, vec2(sh.x, sh.y));
  const cosS: N = dot(dir, S);
  // Gegenlicht: nahe der Sonne sind die Wolken Schattenrisse mit hellem Saum
  const back: N = pow(cosS.mul(0.5).add(0.5), 8);
  const az: N = atan(dir.z, dir.x).div(Math.PI * 2).add(0.5);
  const over = (m: THREE.MeshBasicNodeMaterial) => {
    m.side = THREE.BackSide; m.transparent = true; m.depthWrite = false; m.depthTest = false; m.fog = false;
    // Farbe überblenden, Alpha = wie frei der Himmel bleibt (für die Sterne)
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  };
  const out: THREE.Mesh[] = [];
  const sphere = (r: number, mat: THREE.Material, order: number) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 24), mat);
    mesh.renderOrder = order; mesh.frustumCulled = false;
    out.push(mesh);
  };

  // vorne beleuchtet (Blick von der Sonne weg) … Gegenlicht (Blick zur Sonne)
  const front: N = float(1).sub(facing).mul(0.5);

  // 1) Quelltürme am Horizont: Höhenzug rund um den Horizont, blumenkohlige Kanten; um die Sonne eine Lücke.
  //    Von der Sonne weg angestrahlt (Alpenglühen), zur Sonne hin Schattenrisse mit Lichtsaum; unten schieferblau.
  {
    const m = new THREE.MeshBasicNodeMaterial(); over(m);
    const P = 14;
    const ridge: N = fbm(vec2(az.mul(P), 3.7), [P, 64], 4);
    const region: N = smoothstep(0.3, 0.7, vnoise(vec2(az.mul(5), 1.3), [5, 64]));
    const gap: N = float(1).sub(smoothstep(0.88, 0.98, facing).mul(0.85));
    const top: N = float(0.02).add(pow(ridge, 1.6).mul(0.55).mul(region)).mul(gap).add(0.006);
    const K = 70;
    const q: N = vec2(az.mul(K), el.mul(K / (Math.PI * 2)));
    const bill: N = fbm(q, [K, 4096], 5);
    const edge: N = top.add(bill.sub(0.5).mul(top.mul(0.55).add(0.015)));
    const inside: N = edge.sub(el);
    const mask: N = smoothstep(0, 0.006, inside).mul(smoothstep(-0.08, -0.01, el));
    const h01: N = el.div(max(top, float(0.01))).clamp(0, 1);
    // Wölbungen: liegt über einem Punkt mehr Wolke, ist er im eigenen Schatten
    const above: N = fbm(q.add(vec2(0, 0.6)), [K, 4096], 4);
    const relief: N = bill.sub(above).mul(3).add(0.5).clamp(0, 1);
    const lit: N = front.mul(0.6).add(smoothstep(0.05, 0.9, h01).mul(0.45)).add(relief.sub(0.5).mul(0.4)).sub(0.12).clamp(0, 1);
    let col: N = mix(shadowCol, litCol, smoothstep(0.08, 0.85, lit));
    // Lichtsaum oben an der Kante, im Gegenlicht kräftig
    const rim: N = exp(inside.div(-0.0035)).mul(max(facing, float(0)).mul(0.9 * low).add(0.2));
    col = col.add(warm.mul(max(lum(behind), base)).mul(rim).mul(0.65));
    // unten im Dunst
    col = mix(col, behind, pow(float(1).sub(h01), 3).mul(0.55));
    m.colorNode = col.max(0);
    m.opacityNode = mask;
    sphere(2400, m, 2);
  }

  // 2) aufgerissenes Wolkenfeld (Stratocumulus): Dichte aus verwirbeltem Rauschen, große Massen und Lücken.
  //    Licht: ein paar Schritte durch die Wolke zur Sonne (Beer-Lambert) – dünne Ränder zur Sonne leuchten, dicke
  //    Kerne bleiben dunkel; Unterseiten bei tiefer Sonne glühen nahe der Sonne am stärksten.
  {
    const m = new THREE.MeshBasicNodeMaterial(); over(m);
    const pl: N = vec2(dir.x, dir.z).div(max(el, float(0)).add(0.07));
    const u: N = dot(pl, vec2(sh.x, sh.y));
    const v: N = dot(pl, vec2(-sh.y, sh.x));
    const q0: N = vec2(u.mul(0.85), v.mul(1.2)).mul(1.5).add(vec2(13.7, 4.1));
    const warp: N = vec2(fbm(q0.mul(0.5).add(7.3), 4096, 3), fbm(q0.mul(0.5).add(1.9), 4096, 3)).sub(0.5).mul(1.4);
    const mass: N = fbm(q0.mul(0.22).add(3.3), 4096, 2);
    const cov: N = float(0.56 - p.cover * 0.2).sub(mass.sub(0.5).mul(0.55));
    const qw: N = q0.add(warp);
    const nq: N = fbm(qw, 4096, 5);
    const soft = (n: N): N => smoothstep(cov, cov.add(0.3), n);
    const dens: N = smoothstep(cov, cov.add(0.06), nq);
    const thick: N = soft(nq);
    let od: N = float(0);
    for (let k = 1; k <= 4; k++) od = od.add(soft(fbm(qw.add(vec2(0.12 * k, 0)), 4096, 5)));
    const light: N = exp(od.mul(-0.8));
    // Bauschen: feines Rauschen hellt auf und dunkelt ab
    const det: N = fbm(qw.mul(2.7).add(5.1), 4096, 4);
    const fade: N = smoothstep(0.02, 0.18, el);
    const alpha: N = dens.mul(fade).mul(0.97);
    const Lk: N = light.mul(0.75).add(front.mul(0.3)).add(det.sub(0.5).mul(0.6)).sub(thick.mul(0.25)).add(0.1).clamp(0, 1);
    let col: N = mix(shadowCol, litCol, Lk);
    // Gegenlicht nahe der Sonne: Glut in den dünnen Teilen, dicke Teile als Schattenriss
    const halo: N = max(lum(behind), base);
    col = mix(col, shadowCol.mul(0.85).add(warm.mul(halo).mul(light).mul(1.15)), back.mul(0.85));
    col = mix(col, behind, smoothstep(0.24, 0.03, el).mul(0.55));
    m.colorNode = col.max(0);
    m.opacityNode = alpha;
    sphere(2200, m, 3);
  }

  // 3) Strahlen um die tiefe Sonne (nur abends/morgens): helle Fächer, nach außen auslaufend
  if (low > 0.05) {
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
    m.fog = false;
    const t = new THREE.Vector3(0, 1, 0).cross(sunV).normalize();
    const b = sunV.clone().cross(t).normalize();
    const phi: N = atan(dot(dir, vec3(b.x, b.y, b.z)), dot(dir, vec3(t.x, t.y, t.z))).div(Math.PI * 2).add(0.5);
    const R = 56;
    const rays: N = smoothstep(0.45, 0.8, vnoise(vec2(phi.mul(R), 0.5), [R, 8])).mul(smoothstep(0.5, 0.8, vnoise(vec2(phi.mul(R * 0.25), 3.5), [R / 4, 8])).mul(0.6).add(0.4));
    const ang: N = tsl.acos(cosS.clamp(-1, 1));
    const fall: N = exp(ang.mul(-2.6)).mul(smoothstep(0.03, 0.14, ang)).mul(smoothstep(-0.02, 0.05, el));
    m.colorNode = warm.mul(base).mul(rays).mul(fall).mul(0.5 * low);
    m.opacityNode = float(1);
    sphere(2000, m, 4);
  }
  return out;
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
  const sa = cubeA.sample(look);
  const sb = cubeB.sample(look);
  let col: N = mix(sa.rgb, sb.rgb, mixT);
  // Alpha des Würfels: wie frei der Himmel ist (gebackene Wolken verdecken die Sterne)
  const free: N = mix(sa.a, sb.a, mixT).clamp(0, 1);
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
  col = col.add(vec3(0.9, 0.95, 1.1).mul(star).mul(night).mul(free).mul(3));
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
