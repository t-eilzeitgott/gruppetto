/**
 * Zuschauer als 2D-Bilder für die Ferne (Impostors).
 *
 * Beim Start werden die echten 3D-Zuschauer einmal in einen Bildvorrat gezeichnet: jede Figur
 * (Kappe, Sonnenhut, lange Haare …) mit jeder Bewegung in mehreren Phasen. In den Bildern stehen
 * keine festen Farben, sondern Masken mit Schattierung (Haut, Oberteil, Hose, Haare, Hut/Fahne) –
 * eingefärbt wird erst beim Zeichnen, für jeden Zuschauer anders.
 *
 * Pose und Takt kommen aus denselben Formeln wie bei den 3D-Figuren. Darum sieht man den Wechsel
 * in der Nähe kaum: dort stehen weiter echte 3D-Menschen, ab gut 30 m übernehmen die Bilder.
 * Ein Zuschauer kostet so nur zwei Dreiecke – Platz für deutlich mehr Menschen.
 */
import * as THREE from 'three';
import { Act, CROWD_FLAGS, CROWD_PAL, CROWD_VERT, KINDS, STRIDE, crowdGeometry, disposeCrowdGeometry, needs, packPerson, type Person } from './crowd3d';
import { freezeTarget } from './models3d';

// ------------------------------------------------------------------ Bildvorrat

/** Zelle im Vorrat: Pixel und Meter (Figur 1,75 m, Platz für erhobene Arme und Fahne) */
const CW = 48;
const CH = 96;
const COLS = 32;
const ROWS = 16;
const MW = 1.7;
const MH = 3.4;
/** Füße stehen so weit über dem Zellboden */
const FOOT = 0.06;
/** Blickrichtung im Bild: leicht zur Seite gedreht (Dreiviertelansicht, gespiegelt für die andere Seite) */
const YAW = 0.42;

/** Figuren im Vorrat: Kopfbedeckung und Merkmale (1 kurze Hose, 2 lange Ärmel, 4 lange Haare, 8 Brille).
 * Hutform 4 = Radhelm (Hobby-Radler), 5 = Teufel mit Hörnern und Dreizack */
const VARIANTS: { hatType: number; feat: number; flag: boolean }[] = [
  { hatType: 0, feat: 2, flag: true },
  { hatType: 1, feat: 2, flag: false },
  { hatType: 0, feat: 4 | 2, flag: true },
  { hatType: 2, feat: 1, flag: false },
  { hatType: 3, feat: 2, flag: false },
  { hatType: 0, feat: 1 | 8, flag: true },
  { hatType: 4, feat: 1 | 8, flag: false },
  { hatType: 5, feat: 2, flag: false },
];

/** Bewegungen: Bilder je Takt, Taktlänge (Zeiteinheiten des Shaders), Begeisterung */
const ACTS: { act: number; f: number; c: number; e: number }[] = [
  { act: Act.idle, f: 3, c: 7, e: 0 },
  { act: Act.clap, f: 4, c: 0.5, e: 0.45 },
  { act: Act.wave, f: 6, c: 1 / 1.3, e: 0.45 },
  { act: Act.cheer, f: 6, c: 1 / 1.45, e: 0.45 },
  { act: Act.film, f: 1, c: 1, e: 0.45 },
  { act: Act.flag, f: 8, c: 2, e: 0.45 },
  { act: Act.shout, f: 4, c: 1, e: 0.45 },
  { act: Act.hold, f: 1, c: 1, e: 0.45 },
  { act: Act.sit, f: 4, c: 1 / 1.4, e: 0.45 },
  { act: Act.lean, f: 1, c: 1, e: 0 },
  { act: Act.sign, f: 1, c: 1, e: 0.45 },
  { act: Act.jump, f: 6, c: 0.8, e: 0.45 },
  { act: Act.ola, f: 6, c: 1.2, e: 0.45 },
  { act: Act.dance, f: 6, c: 1, e: 0.45 },
  { act: Act.devil, f: 6, c: 1 / 1.2, e: 0.45 },
];

interface Cell { cell: number; f: number; c: number }
const CELLS = new Map<string, Cell>();
const BAKE: Person[] = [];
{
  let n = 0;
  VARIANTS.forEach((v, vi) => {
    for (const a of ACTS) {
      if (a.act === Act.flag && !v.flag) continue;
      // der Teufel macht nur Teufelssachen – und nur er
      if ((a.act === Act.devil) !== (v.hatType === 5) && a.act !== Act.cheer && a.act !== Act.idle) continue;
      CELLS.set(`${vi}:${a.act}`, { cell: n, f: a.f, c: a.c });
      for (let k = 0; k < a.f; k++) {
        const col = n % COLS;
        const row = Math.floor(n / COLS);
        n++;
        BAKE.push({
          x: (col + 0.5) * MW, y: row * MH + FOOT, z: 0, yaw: YAW,
          height: 1, width: 1, act: a.act, phase: a.f > 1 ? (k / a.f) * a.c : 0.3 * a.c,
          // im Vorrat: Hautfarbe-Feld trägt die Begeisterung (Shader liest es im Vorratsmodus so)
          skin: a.e, top: 0, bottom: 0, hair: 0, hat: 0, hatType: v.hatType, accent: 0, flag: 0,
          shorts: !!(v.feat & 1), sleeves: !!(v.feat & 2), longHair: !!(v.feat & 4), glasses: !!(v.feat & 8), stripe: false,
        });
      }
    }
  });
  if (n > COLS * ROWS) throw new Error('Zuschauer-Vorrat zu klein');
}

/** Rolle jedes Teils im Bild: 0 Haut, 1 Oberteil, 2 Hose, 3 Haare, 4 Hut bzw. 3. Fahnenstreifen, 5/6 Fahnenstreifen, 7 dunkel */
const ROLE = /* glsl */ `
  {
    float slot = color.r;
    float feat = floor(aI3.w / 32.0);
    float role = 7.0;
    if (slot < 0.5) role = 0.0;
    else if (slot < 1.5) role = 1.0;
    else if (slot < 2.5) role = 2.0;
    else if (slot < 3.5) role = 7.0;
    else if (slot < 4.5) role = 3.0;
    else if (slot < 5.5) role = 4.0;
    else if (slot < 6.5) role = 1.0;
    else if (slot < 7.5) role = bit(feat, 1.0) > 0.5 ? 0.0 : 2.0;
    else if (slot < 8.5) role = bit(feat, 2.0) > 0.5 ? 1.0 : 0.0;
    else if (slot < 10.5) role = 7.0;
    else if (slot < 11.5) { float x = mod(color.b, 3.0); role = x < 0.5 ? 5.0 : x < 1.5 ? 6.0 : 4.0; }
    else if (slot < 12.5) role = 4.0;
    else role = 7.0;
    vec4 a = vec4(abs(role) < 0.1 ? 1.0 : 0.0, abs(role - 1.0) < 0.1 ? 1.0 : 0.0, abs(role - 2.0) < 0.1 ? 1.0 : 0.0, abs(role - 3.0) < 0.1 ? 1.0 : 0.0);
    vec4 b = vec4(abs(role - 4.0) < 0.1 ? 1.0 : 0.0, abs(role - 5.0) < 0.1 ? 1.0 : 0.0, abs(role - 6.0) < 0.1 ? 1.0 : 0.0, 1.0);
    vRole = uPass < 0.5 ? a : b;
  }
`;

export interface CrowdAtlas { a: THREE.Texture; b: THREE.Texture; dispose: () => void }

/** Vorrat zeichnen (einmal, beim Anlegen der Grafik) */
export function bakeCrowdAtlas(gl: THREE.WebGLRenderer): CrowdAtlas {
  const W = CW * COLS;
  const H = CH * ROWS;
  const mat = new THREE.ShaderMaterial({
    defines: { CROWD_BAKE: '' },
    vertexColors: true,
    blending: THREE.NoBlending,
    uniforms: {
      uTime: { value: 0 }, uRider: { value: new THREE.Vector3(0, 0, 1e4) },
      uPal: { value: new Float32Array(CROWD_PAL.flat()) }, uFlag: { value: new Float32Array(CROWD_FLAGS.flat()) },
      uPass: { value: 0 },
    },
    vertexShader: `${CROWD_VERT.head}
uniform float uPass;
varying vec3 vPos;
varying vec4 vRole;
void main() {
${CROWD_VERT.begin}
${ROLE}
  vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  vPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `
uniform float uPass;
varying vec3 vPos;
varying vec4 vRole;
void main() {
  // flach schattiert wie die 3D-Figuren; Licht von schräg oben vorn
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  float sh = clamp(0.52 + 0.4 * max(dot(n, normalize(vec3(-0.35, 0.65, 0.68))), 0.0) + 0.08 * n.y, 0.0, 1.0);
  gl_FragColor = uPass < 0.5 ? vRole * sh : vec4(vRole.rgb * sh, 1.0);
}`,
  });
  const scene = new THREE.Scene();
  const geos: THREE.BufferGeometry[] = [];
  for (const kind of KINDS) {
    const sub = BAKE.filter((p) => needs(p, kind));
    if (!sub.length) continue;
    const data = new Float32Array(sub.length * STRIDE);
    sub.forEach((p, i) => packPerson(p, data, i));
    const g = crowdGeometry(kind, 0, data, sub.length);
    if (!g) continue;
    geos.push(g);
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    scene.add(m);
  }
  const cam = new THREE.OrthographicCamera(0, COLS * MW, ROWS * MH, 0, 0.1, 40);
  cam.position.set(0, 0, 20);
  const rt = () => {
    const r = new THREE.WebGLRenderTarget(W, H, {
      samples: 4, type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
      generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true,
    });
    r.texture.colorSpace = THREE.NoColorSpace;
    return r;
  };
  const rts = [rt(), rt()];
  const prevRT = gl.getRenderTarget();
  const prevC = gl.getClearColor(new THREE.Color());
  const prevA = gl.getClearAlpha();
  gl.setClearColor(0x000000, 0);
  for (let pass = 0; pass < 2; pass++) {
    mat.uniforms.uPass.value = pass;
    gl.setRenderTarget(rts[pass]);
    gl.clear(true, true, false);
    gl.render(scene, cam);
  }
  gl.setRenderTarget(prevRT);
  gl.setClearColor(prevC, prevA);
  for (const g of geos) disposeCrowdGeometry(g);
  mat.dispose();
  const a = freezeTarget(gl, rts[0]);
  const b = freezeTarget(gl, rts[1]);
  return { a, b, dispose: () => { a.dispose(); b.dispose(); } };
}

// ------------------------------------------------------------------ Zeichnen

/** Welche Figur im Vorrat passt zu diesem Zuschauer? (Fahnenträger ohne Hut) */
function variantOf(p: Person): number {
  const flag = p.act === Act.flag || p.act === Act.runFlag || p.act === Act.jogFlag;
  if (p.hatType === 5) return 7;
  if (!flag) {
    if (p.hatType === 4) return 6;
    if (p.hatType === 1) return 1;
    if (p.hatType === 2) return 3;
    if (p.hatType === 3) return 4;
  }
  if (p.longHair) return 2;
  if (p.glasses || (p.shorts && !p.sleeves)) return 5;
  return 0;
}

export const SPR_STRIDE = 20;
const NPAL = CROWD_PAL.length;

export function packSprite(p: Person, out: Float32Array, i: number) {
  const v = variantOf(p);
  const act = p.act === Act.runFlag || p.act === Act.jogFlag ? Act.flag : p.act;
  const c = CELLS.get(`${v}:${act}`) ?? CELLS.get(`${v}:${Act.idle}`)!;
  const o = i * SPR_STRIDE;
  const flag = act === Act.flag;
  out[o] = p.x; out[o + 1] = p.y; out[o + 2] = p.z; out[o + 3] = p.yaw;
  out[o + 4] = p.height; out[o + 5] = p.width; out[o + 6] = c.cell; out[o + 7] = c.f;
  out[o + 8] = c.c; out[o + 9] = p.phase; out[o + 10] = act; out[o + 11] = 0;
  out[o + 12] = p.skin; out[o + 13] = p.top; out[o + 14] = p.bottom; out[o + 15] = p.hair;
  out[o + 16] = flag ? NPAL + p.flag * 3 + 2 : p.hat; out[o + 17] = NPAL + p.flag * 3; out[o + 18] = NPAL + p.flag * 3 + 1; out[o + 19] = 0;
}

let QUAD: THREE.BufferGeometry | null = null;
const quad = () => {
  if (!QUAD) {
    QUAD = new THREE.BufferGeometry();
    QUAD.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    QUAD.setIndex([0, 1, 2, 0, 2, 3]);
  }
  return QUAD;
};

/** Alle Zuschauer einer Gruppe als ein Zeichenaufruf */
export function spriteGeometry(people: Person[]): THREE.InstancedBufferGeometry {
  const data = new Float32Array(people.length * SPR_STRIDE);
  people.forEach((p, i) => packSprite(p, data, i));
  const q = quad();
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(q.index);
  g.setAttribute('position', q.getAttribute('position'));
  const buf = new THREE.InstancedInterleavedBuffer(data, SPR_STRIDE, 1);
  for (let k = 0; k < 5; k++) g.setAttribute(`aS${k}`, new THREE.InterleavedBufferAttribute(buf, 4, k * 4));
  g.instanceCount = people.length;
  return g;
}

/** gibt nur die Zuschauerdaten frei – das geteilte Viereck bleibt */
export function disposeSpriteGeometry(g: THREE.BufferGeometry) {
  g.setIndex(null);
  g.deleteAttribute('position');
  g.dispose();
}

export function spriteMaterial(u: { uTime: { value: number } }, atlas: CrowdAtlas): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial();
  // weiche Ränder über die Kantenglättung (Alpha → Abdeckung), ohne Sortieren
  m.alphaToCoverage = true;
  const cols = new Float32Array([...CROWD_PAL, ...CROWD_FLAGS].flat());
  const f = (v: number) => v.toFixed(4);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = u.uTime;
    sh.uniforms.uSprA = { value: atlas.a };
    sh.uniforms.uSprB = { value: atlas.b };
    sh.uniforms.uCol = { value: cols };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aS0; // Ort, Blickrichtung
attribute vec4 aS1; // Größe, Breite, erste Zelle, Bilder
attribute vec4 aS2; // Taktlänge, Phase, Bewegung
attribute vec4 aS3; // Farben: Haut, Oberteil, Hose, Haare
attribute vec4 aS4; // Farben: Hut/Fahne, Fahne, Fahne
uniform float uTime;
varying vec2 vUvA;
varying vec2 vUvB;
varying float vMixF;
varying float vXa;
flat varying vec4 vCa;
flat varying vec3 vCb;`)
      .replace('#include <beginnormal_vertex>', `
  vec3 sprP = aS0.xyz;
  vec2 toC = cameraPosition.xz - sprP.xz;
  // Übergang von den 3D-Figuren (27–32 m): Bildpunkte, die dort noch die Figur zeigt, bleiben frei
  vXa = 1.0 - smoothstep(46.0, 54.0, length(toC));
  if (vXa >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 dC = toC / max(length(toC), 1e-3);
  // zur Kamera gewandt, etwas nach oben: bekommt Himmel und Sonne wie eine Figur
  vec3 objectNormal = normalize(vec3(dC.x, 0.55, dC.y));`)
      .replace('#include <begin_vertex>', `
  float hgt = aS1.x;
  vec3 rightV = vec3(dC.y, 0.0, -dC.x);
  // im Bild schaut die Figur nach rechts; schaut der Zuschauer (von der Kamera aus) nach links: spiegeln
  float rel = mod(aS0.w - atan(dC.x, dC.y) + PI, PI2) - PI;
  vec3 transformed = sprP + rightV * (position.x * ${f(MW)} * hgt * aS1.y) + vec3(0.0, (position.y * ${f(MH)} - ${f(FOOT)}) * hgt, 0.0);
  // Takt wie bei den 3D-Figuren (gleiche Pose beim Wechsel)
  float ph = aS2.y;
  float t = uTime * 0.31 * (0.9 + 0.25 * fract(ph * 7.0)) + ph * 37.0;
  if (aS2.z > 15.5 && aS2.z < 16.5) t = uTime * 0.31 + ph * 37.0;
  float nF = aS1.w;
  float fr = fract(t / aS2.x) * nF;
  float k0 = floor(fr);
  float k1 = mod(k0 + 1.0, nF);
  vMixF = fr - k0;
  float su = position.x + 0.5;
  if (rel < 0.0) su = 1.0 - su;
  su = clamp(su, ${f(0.5 / CW)}, ${f(1 - 0.5 / CW)});
  float sv = clamp(position.y, ${f(0.5 / CH)}, ${f(1 - 0.5 / CH)});
  float c0 = aS1.z + k0;
  float c1 = aS1.z + k1;
  vUvA = vec2((mod(c0, ${COLS}.0) + su) / ${COLS}.0, (floor(c0 / ${COLS}.0 + 0.001) + sv) / ${ROWS}.0);
  vUvB = vec2((mod(c1, ${COLS}.0) + su) / ${COLS}.0, (floor(c1 / ${COLS}.0 + 0.001) + sv) / ${ROWS}.0);
  vCa = aS3;
  vCb = aS4.xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uSprA;
uniform sampler2D uSprB;
uniform vec3 uCol[${CROWD_PAL.length + CROWD_FLAGS.length}];
varying vec2 vUvA;
varying vec2 vUvB;
varying float vMixF;
varying float vXa;
flat varying vec4 vCa;
flat varying vec3 vCb;`)
      .replace('#include <color_fragment>', `
  if (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) < vXa) discard;
  {
    // zwei Bilder des Takts überblenden: flüssige Bewegung trotz weniger Bilder
    vec4 sA = mix(texture2D(uSprA, vUvA), texture2D(uSprA, vUvB), vMixF);
    vec4 sB = mix(texture2D(uSprB, vUvA), texture2D(uSprB, vUvB), vMixF);
    float cov = sB.a;
    // Ränder scharf halten (auch in den kleinen Mipmap-Stufen), weich über die Abdeckung
    float aS = (cov - 0.5) / max(fwidth(cov), 1e-4) + 0.5;
    if (aS <= 0.0) discard;
    vec3 sc = sA.r * uCol[int(vCa.x + 0.5)] + sA.g * uCol[int(vCa.y + 0.5)] + sA.b * uCol[int(vCa.z + 0.5)] + sA.a * uCol[int(vCa.w + 0.5)]
      + sB.r * uCol[int(vCb.x + 0.5)] + sB.g * uCol[int(vCb.y + 0.5)] + sB.b * uCol[int(vCb.z + 0.5)];
    // Masken tragen die Abdeckung mit: herausrechnen; Schattierung im Bild ausgleichen
    diffuseColor = vec4(sc / max(cov, 0.04) * 1.22, clamp(aS, 0.0, 1.0));
  }`);
  };
  m.customProgramCacheKey = () => 'crowd-spr-3';
  return m;
}
