/**
 * Alpenhäuser im WebGL-Spiel (wie in der WebGPU-Abfahrt): das Tiroler Bauernhaus (alphouse.ts), Stadel und
 * Dorfkirche (alpbuildings.ts) als Instanzen – je Bauart zwei Stufen (nah ~7 000, fern ~900 Dreiecke) und fünf
 * Materialien (Putz, Holz, Schindeln, Stein, Kleinteile). Alle Häuser zusammen kosten so höchstens 30
 * Zeichenaufrufe. Dazu die Höfe entlang der Strecke: auf Wiesen nahe der Straße und am Talhang, Giebel talwärts,
 * ab und zu zwei, drei beieinander wie ein Weiler.
 *
 * Die Geometrie entsteht vorab in Häppchen (auf der Startkarte), die Texturen (Putz, Bretter, Blockbohlen,
 * Schindeln) werden einmal gemalt.
 */
import * as THREE from 'three';
import { buildHouse, HMATS, type HMat } from './alphouse';
import { buildBarn, buildChurch } from './alpbuildings';
import { masonryTex } from './tex3d';
import type { Terrain } from './terrain3d';
import type { Track } from './track';

/** Bauart: Wohnhaus, Stadel, Kirche */
export const KIND = { house: 0, barn: 1, church: 2 } as const;
const KINDS = 3;

export interface Spot {
  x: number; y: number; z: number; rot: number; tone: number; shut: number;
  /** Strecke (m), für das Abbauen */
  at: number;
  kind?: number; sx?: number; sy?: number; sz?: number;
}

/** was die Platzsuche der Höfe braucht */
export interface FarmCtx {
  track: Track;
  terrain: Terrain;
  /** Abstand zur Straße (alle Stellen der Strecke, auch andere Kehren) */
  roadDist: (x: number, z: number) => number;
  /** Bäume im Umkreis (schon gebaute Landschaft) */
  countTrees: (x: number, z: number, r: number) => number;
  /** Bäume im Umkreis entfernen (gebaute und künftige) */
  clearTrees: (x: number, z: number, r: number) => void;
  /** Grundrisse der Dorfhäuser (x, z, Radius): dort kein Hof */
  occ: number[];
}

const hash = (a: number, b: number) => {
  let x = Math.imul(a ^ 0x2f6b9d1, 0x9e3779b1) ^ Math.imul(b ^ 0x5bd1e995, 0x85ebca77);
  x ^= x >>> 15;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
};

/** Ladenfarben: Tannengrün, Ochsenblut, Taubenblau, Holz natur */
const SHUTTERS: [number, number, number][] = [[0.025, 0.1, 0.04], [0.2, 0.028, 0.022], [0.05, 0.085, 0.12], [0.11, 0.065, 0.032]];

/** Grundriss mit Terrasse und Holzlege (lokal): Ecken für die Hangprüfung */
const FOOT: [number, number][] = [[-5.95, -6.1], [5.95, -6.1], [5.95, 8.7], [-5.95, 8.7], [0, 1.3]];

/** nah → fern (m zur Kamera, mit Spielraum gegen Hin und Her); große Bauten (Kirche) weiter */
const NEAR = 60;
const BIG = 1.6;
/** weiter weg gar nicht (im Dunst) */
const FAR = 2600;

// ---------------------------------------------------------------- Texturen (einmal gemalt)

function cv(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

/** wiederholbares Rauschen in einem Bild (helle und dunkle Flecken) */
function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, a: number, seed: number) {
  for (let k = 0; k < n; k++) {
    const r = hash(seed, k * 3);
    const x = hash(seed, k * 3 + 1) * w, y = hash(seed, k * 3 + 2) * h;
    const s = 1 + hash(seed, k * 7) * 3;
    g.fillStyle = r < 0.5 ? `rgba(0,0,0,${a * (0.5 + r)})` : `rgba(255,255,255,${a * (r - 0.3)})`;
    for (const ox of [0, -w, w]) for (const oy of [0, -h, h]) g.fillRect(x + ox, y + oy, s, s);
  }
}

/** Kalkputz: fast weiß, leicht fleckig */
function plasterTex(): HTMLCanvasElement {
  const { c, g } = cv(256, 256);
  g.fillStyle = '#e9e5dc';
  g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, 2600, 0.05, 11);
  speckle(g, 256, 256, 300, 0.08, 23);
  return c;
}

/** senkrechte Bretter mit Fugen (Giebel, Stadel) – 2 m je Bild */
function boardsTex(): HTMLCanvasElement {
  const { c, g } = cv(256, 256);
  const n = 10;
  for (let k = 0; k < n; k++) {
    const v = 0.82 + hash(5, k) * 0.3;
    g.fillStyle = `rgb(${Math.round(150 * v)},${Math.round(112 * v)},${Math.round(74 * v)})`;
    g.fillRect((k * 256) / n, 0, 256 / n, 256);
    // Maserung
    for (let q = 0; q < 14; q++) {
      g.fillStyle = `rgba(60,38,20,${0.06 + hash(k, q) * 0.08})`;
      g.fillRect((k * 256) / n + 2 + hash(q, k) * (256 / n - 5), 0, 1, 256);
    }
    g.fillStyle = 'rgba(25,15,8,0.85)';
    g.fillRect((k * 256) / n, 0, 2, 256);
  }
  speckle(g, 256, 256, 600, 0.05, 31);
  return c;
}

/** waagrechte Blockbohlen (Obergeschoss) – runde Kanten, dunkle Fugen */
function logsTex(): HTMLCanvasElement {
  const { c, g } = cv(256, 256);
  const n = 8;
  for (let k = 0; k < n; k++) {
    const y0 = (k * 256) / n, hh = 256 / n;
    const v = 0.85 + hash(7, k) * 0.25;
    const grd = g.createLinearGradient(0, y0, 0, y0 + hh);
    grd.addColorStop(0, `rgb(${Math.round(92 * v)},${Math.round(62 * v)},${Math.round(36 * v)})`);
    grd.addColorStop(0.35, `rgb(${Math.round(132 * v)},${Math.round(92 * v)},${Math.round(56 * v)})`);
    grd.addColorStop(1, `rgb(${Math.round(70 * v)},${Math.round(46 * v)},${Math.round(26 * v)})`);
    g.fillStyle = grd;
    g.fillRect(0, y0, 256, hh);
    g.fillStyle = 'rgba(20,12,6,0.9)';
    g.fillRect(0, y0, 256, 2);
  }
  speckle(g, 256, 256, 700, 0.05, 37);
  return c;
}

/** Holzschindeln in Reihen, verwittert grau-braun */
function shinglesTex(): HTMLCanvasElement {
  const { c, g } = cv(256, 256);
  g.fillStyle = '#5a4a3c';
  g.fillRect(0, 0, 256, 256);
  const rows = 12, cols = 9;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (256 / cols / 2);
    for (let k = -1; k <= cols; k++) {
      const v = 0.75 + hash(r * 31 + k, 3) * 0.45;
      const x = off + (k * 256) / cols;
      const y = (r * 256) / rows;
      g.fillStyle = `rgb(${Math.round(104 * v)},${Math.round(88 * v)},${Math.round(72 * v)})`;
      g.fillRect(x + 1, y + 1, 256 / cols - 2, 256 / rows - 1);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x + 1, y + 256 / rows - 3, 256 / cols - 2, 2);
    }
  }
  speckle(g, 256, 256, 900, 0.06, 41);
  return c;
}

function texOf(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  // Texturkoordinaten der Häuser sind Meter: 2 m je Bild
  t.repeat.set(0.5, 0.5);
  t.anisotropy = 2;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- Materialien

function materials(lights: { value: number }): Record<HMat, THREE.MeshLambertMaterial> {
  const vtx = (sh: THREE.WebGLProgramParametersWithUniforms) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float iTone;\nattribute vec3 iShut;\nattribute vec4 aE;\nvarying float vTone;\nvarying vec3 vShut;\nvarying vec4 vE;\nvarying vec3 vHp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTone = iTone;\nvShut = iShut;\nvE = aE;\nvHp = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vTone;\nvarying vec3 vShut;\nvarying vec4 vE;\nvarying vec3 vHp;');
  };
  const L = (o: THREE.MeshLambertMaterialParameters, key: string, frag?: (sh: THREE.WebGLProgramParametersWithUniforms) => void) => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, ...o });
    m.onBeforeCompile = (sh) => { vtx(sh); frag?.(sh); };
    m.customProgramCacheKey = () => `alp-${key}`;
    return m;
  };
  const logs = texOf(logsTex());
  return {
    // Putzfarbe je Haus (weiß bis warmes Cremeweiß), Spritzwasser und Schmutz unten
    plaster: L({ map: texOf(plasterTex()) }, 'plaster', (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(vec3(1.0), vec3(1.02, 0.95, 0.82), vTone) * mix(0.66, 1.0, smoothstep(0.7, 1.7, vHp.y));');
    }),
    // Holz: Bretter oder Blockbohlen (aE.w)
    wood: L({ map: texOf(boardsTex()) }, 'wood', (sh) => {
      sh.uniforms.uLogs = { value: logs };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uLogs;')
        .replace('#include <map_fragment>', `
          #ifdef USE_MAP
            vec4 sampledDiffuseColor = mix(texture2D(map, vMapUv), texture2D(uLogs, vMapUv), vE.w);
            diffuseColor *= sampledDiffuseColor;
          #endif`);
    }),
    roof: L({ map: texOf(shinglesTex()) }, 'roof'),
    stone: L({ map: texOf(masonryTex()) }, 'stone'),
    // Kleinteile: Läden in der Farbe des Hauses (aE.z); abends leuchten die Fenster warm (je Haus verschieden)
    detail: L({ emissive: new THREE.Color(1, 1, 1) }, 'detail', (sh) => {
      sh.uniforms.uLights = lights;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uLights;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vShut, vE.z);')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            float glass = step(vE.x, 0.1) * step(vE.z, 0.5);
            float on = smoothstep(0.05, 0.25, vTone + sin(vHp.x * 0.37 + vHp.z * 0.23) * 0.5) * 0.6 + 0.4;
            totalEmissiveRadiance = vec3(1.0, 0.68, 0.34) * glass * on * uLights * 2.2;
          }`);
    }),
  };
}

// ---------------------------------------------------------------- Häuser

interface Slot {
  /** je Material ein Netz; alle teilen Lage und Instanzwerte */
  meshes: THREE.InstancedMesh[];
  matrix: THREE.InstancedBufferAttribute;
  tone: THREE.InstancedBufferAttribute;
  shut: THREE.InstancedBufferAttribute;
  cap: number;
}

export class Houses3D {
  readonly group = new THREE.Group();
  spots: Spot[] = [];
  /** Fensterlicht 0 … 1 (abends an) */
  readonly lights = { value: 0 };
  private mats: Record<HMat, THREE.MeshLambertMaterial>;
  /** Geometrie je Bauart und Stufe (0 nah, 1 fern) */
  private geos: (Record<HMat, THREE.BufferGeometry> | null)[][] = [[null, null], [null, null], [null, null]];
  private slots: (Slot | null)[][] = [[null, null], [null, null], [null, null]];
  private dirty = true;
  private camAt = new THREE.Vector3(1e9, 0, 0);
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private Y = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.mats = materials(this.lights);
    this.group.name = 'houses';
  }

  /** alle Geometrien fertig? */
  get ready(): boolean { return this.geos.every((r) => r.every(Boolean)); }

  /** eine fehlende Geometrie bauen (auf der Startkarte je Bild eine); true, wenn alles fertig ist */
  buildStep(): boolean {
    for (let k = 0; k < KINDS; k++) for (let l = 0; l < 2; l++) if (!this.geos[k][l]) { this.geo(k, l); return this.ready; }
    return true;
  }

  private geo(kind: number, lod: number): Record<HMat, THREE.BufferGeometry> {
    let g = this.geos[kind][lod];
    if (g) return g;
    const lv = (lod === 0 ? 1 : 2) as 1 | 2;
    g = kind === KIND.church ? buildChurch(lv) : kind === KIND.barn ? buildBarn(lv) : buildHouse(lv);
    // Tangenten braucht hier niemand (keine Normalenkarten)
    for (const m of HMATS) { g[m].deleteAttribute('aTU'); g[m].deleteAttribute('aTV'); }
    this.geos[kind][lod] = g;
    return g;
  }

  /** Netze einer Bauart/Stufe für mindestens n Häuser */
  private slot(kind: number, lod: number, n: number): Slot {
    let s = this.slots[kind][lod];
    if (s && s.cap >= n) return s;
    let cap = 8;
    while (cap < n) cap *= 2;
    if (s) for (const m of s.meshes) { this.group.remove(m); m.dispose(); }
    const g = this.geo(kind, lod);
    const matrix = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16);
    const tone = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    const shut = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    matrix.setUsage(THREE.DynamicDrawUsage);
    const meshes: THREE.InstancedMesh[] = [];
    for (const mk of HMATS) {
      const geo = g[mk];
      if (!geo.getAttribute('position')?.count) continue;
      geo.setAttribute('iTone', tone);
      geo.setAttribute('iShut', shut);
      const m = new THREE.InstancedMesh(geo, this.mats[mk], cap);
      m.instanceMatrix = matrix;
      m.count = 0;
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.castShadow = lod === 0;
      m.matrixAutoUpdate = false;
      this.group.add(m);
      meshes.push(m);
    }
    s = { meshes, matrix, tone, shut, cap };
    this.slots[kind][lod] = s;
    return s;
  }

  /** Häuser geändert (dazu oder weg) */
  touch() { this.dirty = true; }

  /** Häuser weit hinter der Fahrerin weg */
  prune(z: number) {
    const n = this.spots.length;
    this.spots = this.spots.filter((s) => s.at > z);
    if (this.spots.length !== n) this.dirty = true;
  }

  /** Stufen nach dem Abstand zur Kamera neu verteilen (nur wenn sie sich bewegt hat oder Häuser dazukamen) */
  update(cam: THREE.Vector3) {
    if (!this.dirty && cam.distanceToSquared(this.camAt) < 16) return;
    this.dirty = false;
    this.camAt.copy(cam);
    const lists: Spot[][][] = [[[], []], [[], []], [[], []]];
    for (const sp of this.spots) {
      const k = sp.kind ?? KIND.house;
      const d = Math.hypot(sp.x - cam.x, sp.z - cam.z);
      const big = k === KIND.church ? BIG : 1;
      if (d > FAR * big) continue;
      lists[k][d < NEAR * big ? 0 : 1].push(sp);
    }
    for (let k = 0; k < KINDS; k++) {
      for (let l = 0; l < 2; l++) {
        const list = lists[k][l];
        const have = this.slots[k][l];
        if (!list.length) { if (have) for (const m of have.meshes) m.count = 0; continue; }
        const s = this.slot(k, l, list.length);
        const ma = s.matrix.array as Float32Array, ta = s.tone.array as Float32Array, sa = s.shut.array as Float32Array;
        list.forEach((sp, i) => {
          this.q.setFromAxisAngle(this.Y, sp.rot);
          this.m4.compose(this.v.set(sp.x, sp.y, sp.z), this.q, this.s.set(sp.sx ?? 1, sp.sy ?? 1, sp.sz ?? 1));
          this.m4.toArray(ma, i * 16);
          ta[i] = sp.tone;
          const c = SHUTTERS[sp.shut % SHUTTERS.length];
          sa[i * 3] = c[0]; sa[i * 3 + 1] = c[1]; sa[i * 3 + 2] = c[2];
        });
        s.matrix.clearUpdateRanges();
        s.matrix.addUpdateRange(0, list.length * 16);
        s.matrix.needsUpdate = true;
        s.tone.needsUpdate = true;
        s.shut.needsUpdate = true;
        for (const m of s.meshes) m.count = list.length;
      }
    }
  }

  /** Höfe zwischen z0 und z1 (Strecke) suchen und setzen */
  *addFarms(c: FarmCtx, z0: number, z1: number, late: () => boolean): Generator<void, void, void> {
    const { track, terrain, roadDist } = c;
    const w = { x: 0, y: 0, z: 0, th: 0 };
    const reg = { r: null as ReturnType<Terrain['region']> | null, x: 1e9, z: 1e9 };
    const h = (px: number, pz: number) => {
      if (!reg.r || Math.abs(px - reg.x) > 120 || Math.abs(pz - reg.z) > 120) { reg.r = terrain.region(px - 160, pz - 160, px + 160, pz + 160); reg.x = px; reg.z = pz; }
      return terrain.heightIn(reg.r, px, pz);
    };
    const tryAt = (x: number, z: number, seed: number, minGap: number, minRoad: number, toward: { x: number; z: number } | null, at: number): Spot | null => {
      if (roadDist(x, z) < minRoad) return null;
      for (const s of this.spots) if ((s.x - x) ** 2 + (s.z - z) ** 2 < minGap * minGap) return null;
      const occ = c.occ;
      for (let o = 0; o < occ.length; o += 3) if (Math.hypot(occ[o] - x, occ[o + 1] - z) < occ[o + 2] + 14) return null;
      if (c.countTrees(x, z, 14) > 3) return null;
      const gx = (h(x + 7, z) - h(x - 7, z)) / 14;
      const gz = (h(x, z + 7) - h(x, z - 7)) / 14;
      const g = Math.hypot(gx, gz);
      if (g > 0.42) return null;
      let rot: number;
      if (toward) rot = Math.atan2(toward.x - x, toward.z - z);
      else if (g > 0.04) rot = Math.atan2(-gx, -gz);
      else { track.world(at, 0, 0, w); rot = Math.atan2(w.x - x, w.z - z); }
      rot += (hash(seed, 3) - 0.5) * (toward ? 0.12 : 0.35);
      const cs = Math.cos(rot), sn = Math.sin(rot);
      let hi = -Infinity, lo = Infinity;
      for (const [lx, lz] of FOOT) {
        const y = h(x + cs * lx + sn * lz, z - sn * lx + cs * lz);
        hi = Math.max(hi, y);
        lo = Math.min(lo, y);
      }
      if (hi - lo > 4.4) return null;
      return { x, y: hi - 0.35, z, rot, tone: hash(seed, 5), shut: Math.floor(hash(seed, 7) * SHUTTERS.length), at };
    };
    const put = (sp: Spot) => { this.spots.push(sp); c.clearTrees(sp.x, sp.z, 12.5); this.dirty = true; };
    const lats = [27, 34, 44, 58, 75, 96, 122, 150, 185];
    for (let z = Math.ceil(z0 / 24) * 24; z < z1; z += 24) {
      if (late()) yield;
      const s = track.segAt(z);
      if (s.tunnel) continue;
      // Ortsdurchfahrten (Häuserzeilen der Strecke): dort keine Höfe
      if (track.sections[s.sec].biome === 'village') continue;
      for (const side of [-1, 1]) {
        for (let li = 0; li < lats.length; li++) {
          if (li % 3 === 2 && late()) yield;
          const seed = Math.round(z) * 31 + li * 7 + (side > 0 ? 3 : 0);
          if (hash(seed, 1) > 0.75) continue;
          track.world(z, side * lats[li], 0, w);
          const sp = tryAt(w.x, w.z, seed, 70, 25, null, z);
          if (!sp) continue;
          put(sp);
          // Weiler: ein, zwei Nachbarn hangparallel daneben
          const n = hash(seed, 11) < 0.45 ? 1 + (hash(seed, 13) < 0.4 ? 1 : 0) : 0;
          for (let q = 0; q < n; q++) {
            const dir = (q % 2 ? -1 : 1) * (24 + hash(seed, 17 + q) * 8);
            const nx = sp.x + Math.cos(sp.rot) * dir + Math.sin(sp.rot) * (hash(seed, 19 + q) - 0.5) * 8;
            const nz = sp.z - Math.sin(sp.rot) * dir + Math.cos(sp.rot) * (hash(seed, 19 + q) - 0.5) * 8;
            const nb = tryAt(nx, nz, seed + 1000 * (q + 1), 20, 25, null, z);
            if (nb) put(nb);
          }
          break;
        }
      }
    }
  }

  /** Programme der Materialien vorab übersetzen (ein Stellvertreter je Material) */
  warmObjects(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3));
    for (const mk of HMATS) {
      const m = new THREE.InstancedMesh(g, this.mats[mk], 1);
      m.setMatrixAt(0, new THREE.Matrix4());
      out.push(m);
    }
    return out;
  }
}
