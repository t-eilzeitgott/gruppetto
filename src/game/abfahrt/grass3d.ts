/**
 * Gras am Wegrand (PC-Grafik): Büschel aus feinen, gebogenen Halmen auf den Wiesen neben der Straße – zwischen
 * Bankett und Korridorrand, wo das Querprofil der Straße die Höhe genau kennt (die Halme stehen auf dem Boden,
 * nicht darüber oder darin). Je 16 m Straße ein Stück mit einem Zeichenaufruf: gebaut, wenn es voraus in Sicht
 * kommt (höchstens eins je Bild), freigegeben, sobald es hinter der Kamera liegt.
 *
 * Die Halme wiegen im Wind (Böen ziehen als Wellen über die Wiese), werden zur Spitze heller und gelblicher und
 * nehmen die Farbe des Bodens darunter an. In der Ferne schrumpfen sie weich auf null – kein Aufploppen, und die
 * Stücke entstehen dort, wo noch nichts zu sehen ist. Zum Korridorrand hin wird das Gras niedriger und lichter
 * (dahinter geht die Wiese der Landschaft weiter).
 */
import * as THREE from 'three';
import { mulberry32 } from './rng';
import { EDGE, SEG, type Seg, type Track } from './track';

/** Querprofil einer Straßenseite: Abstände ab dem Bankett, Höhen über der Fahrbahn, Bodenfarben (linear) */
export interface VergeProfile { o: number[]; h: number[]; cols: [number, number, number][] }

export interface GrassDeps {
  track: Track;
  /** Querprofil einer Seite an Segment i (sg −1 links, +1 rechts) – null: hier wächst kein Gras */
  verge: (i: number, sg: number) => { pr: VergeProfile; lim: number } | null;
  /** Material aus grassMaterial (einmal je Renderer: das Programm bleibt übersetzt) */
  material: THREE.MeshLambertMaterial;
}

/** Segmente je Stück (16 m) */
const CH = 8;
/** Halme je Büschel, Segmente je Halm */
const BLADES = 7;
const BSEG = 3;
/** Büschel je Quadratmeter (nah am Bankett; zum Rand hin lichter) */
const DENSITY = 3.8;
/** Halme schrumpfen zwischen diesen Abständen zur Kamera auf null (m) */
const FADE: [number, number] = [52, 86];
/** Stücke von so weit hinter bis so weit vor der Kamera (m) */
const BACK = 24;
const AHEAD = 120;

/** ein Büschel: Halme im Kreis, nach außen geneigt und gebogen; Farbe von dunkel (Fuß) zu hell (Spitze) */
function tuftGeometry(): THREE.BufferGeometry {
  const r = mulberry32(17);
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let b = 0; b < BLADES; b++) {
    const a = (b / BLADES) * Math.PI * 2 + r() * 0.8;
    const ca = Math.cos(a), sa = Math.sin(a);
    const h = 0.32 + r() * 0.34;
    const w = 0.022 + r() * 0.014;
    const lean = 0.12 + r() * 0.22;
    const bx = ca * (0.02 + r() * 0.07), bz = sa * (0.02 + r() * 0.07);
    // Halmfläche quer zur Neigung
    const px = -sa, pz = ca;
    const base = pos.length / 3;
    for (let k = 0; k <= BSEG; k++) {
      const t = k / BSEG;
      // Biegung: oben stärker nach außen
      const off = lean * t * t * h;
      const cx = bx + ca * off, cz = bz + sa * off, cy = h * t * (1 - 0.12 * t);
      const ww = w * (1 - t * 0.92);
      // Normale: überwiegend nach oben (wie der Boden), etwas zur Seite – so passt das Licht zur Wiese
      const nx = ca * 0.35, ny = 0.9, nz = sa * 0.35;
      const shade = 0.55 + 0.65 * t;
      const tip = t * t;
      if (k < BSEG) {
        pos.push(cx - px * ww, cy, cz - pz * ww, cx + px * ww, cy, cz + pz * ww);
        nor.push(nx, ny, nz, nx, ny, nz);
        for (let q = 0; q < 2; q++) col.push(shade * (1 + 0.12 * tip), shade * (1 + 0.05 * tip), shade * (1 - 0.18 * tip));
      } else {
        pos.push(cx, cy, cz);
        nor.push(nx, ny, nz);
        col.push(shade * 1.12, shade * 1.05, shade * 0.82);
      }
    }
    for (let k = 0; k < BSEG - 1; k++) {
      const a0 = base + k * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
      idx.push(a0, a1, b0, a1, b1, b0);
    }
    const l0 = base + (BSEG - 1) * 2;
    idx.push(l0, l0 + 1, l0 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** Halme: Wind und weiches Schrumpfen in der Ferne im Shader; beidseitig, aber gleich hell wie die Wiese */
export function grassMaterial(time: { value: number }): THREE.MeshLambertMaterial {
  const fadeU = { value: new THREE.Vector2(FADE[0], FADE[1]) };
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.uniforms.uGFade = fadeU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec2 uGFade;')
      // Wind und Schrumpfen in Weltkoordinaten (nach der Lage des Büschels)
      .replace('#include <project_vertex>', `
        vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
          vec3 root = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
        #else
          vec3 root = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #endif
        wp = modelMatrix * wp;
        float hk = clamp(position.y / 0.62, 0.0, 1.0);
        // Böen: Wellen, die über die Wiese ziehen, dazu feines Zittern je Halm
        float gust = 0.55 + 0.45 * sin(dot(root.xz, vec2(0.11, 0.07)) - uTime * 1.3);
        float ph = uTime * 2.1 + dot(root.xz, vec2(0.37, 0.23)) + position.x * 7.0;
        vec2 sway = (vec2(0.8, 0.45) * gust * 0.11 + vec2(sin(ph), cos(ph * 1.27)) * 0.025) * hk * hk;
        wp.xz += sway;
        wp.y -= dot(sway, sway) * 1.6;
        // in der Ferne weich auf null (Höhe und Breite zum Fuß hin)
        float dc = distance(root.xz, cameraPosition.xz);
        float shrink = 1.0 - smoothstep(uGFade.x, uGFade.y, dc);
        wp.xyz = root + (wp.xyz - root) * shrink;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;`);
    // beidseitig, aber die Normale nie umdrehen: Vorder- und Rückseite eines Halms sind gleich hell
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', `
        float faceDirection = 1.0;
        vec3 normal = normalize( vNormal );
        vec3 nonPerturbedNormal = normal;`);
  };
  m.customProgramCacheKey = () => 'grass-pc-1';
  return m;
}

/** Stellvertreter fürs Vorwärmen (ein Büschel) */
export function grassWarm(material: THREE.MeshLambertMaterial): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(tuftGeometry(), material, 1);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3);
  m.receiveShadow = true;
  return m;
}

export class Grass3D {
  readonly group = new THREE.Group();
  private geo = tuftGeometry();
  private chunks = new Map<number, THREE.InstancedMesh>();
  /** Stück im Bau (über mehrere Bilder verteilt) */
  private gen: { k: number; it: Generator<void, THREE.InstancedMesh, void> } | null = null;
  private readonly d: GrassDeps;
  private readonly W0 = { x: 0, y: 0, z: 0, th: 0 };
  private readonly W1 = { x: 0, y: 0, z: 0, th: 0 };
  /** Puffer fürs Bauen (wachsen bei Bedarf) */
  private mBuf = new Float32Array(16 * 4096);
  private cBuf = new Float32Array(3 * 4096);

  constructor(d: GrassDeps) {
    this.d = d;
    this.group.name = 'grass';
  }

  /**
   * Stücke um die Kamera pflegen; ahead: bis dorthin vorausbauen (m). Gebaut wird in kleinen Schritten mit höchstens
   * budget ms je Bild (mindestens ein Schritt: ein Segment, beide Seiten).
   */
  update(z: number, aheadTo = z + AHEAD, budget = 1) {
    const k0 = Math.floor((z - BACK) / (CH * SEG));
    const k1 = Math.floor(aheadTo / (CH * SEG));
    for (const [k, mesh] of this.chunks) {
      if (k >= k0 && k <= k1) continue;
      this.group.remove(mesh);
      mesh.dispose();
      this.chunks.delete(k);
    }
    if (this.gen && (this.gen.k < k0 || this.gen.k > k1)) this.gen = null;
    if (!this.gen) {
      for (let k = Math.max(k0, Math.floor(this.d.track.first / CH)); k <= k1; k++) {
        if (this.chunks.has(k)) continue;
        this.gen = { k, it: this.buildSteps(k) };
        break;
      }
    }
    if (!this.gen) return;
    const t0 = performance.now();
    let r = this.gen.it.next();
    while (!r.done && performance.now() - t0 < budget) r = this.gen.it.next();
    if (r.done) {
      this.chunks.set(this.gen.k, r.value);
      this.group.add(r.value);
      this.gen = null;
    }
  }

  /** ein Stück in Schritten: Büschel auf beiden Seiten, Höhe und Farbe aus dem Querprofil */
  private *buildSteps(k: number): Generator<void, THREE.InstancedMesh, void> {
    const t = this.d.track;
    const r = mulberry32((k * 7919 + 101) >>> 0);
    let n = 0;
    const prof = new Map<number, ReturnType<GrassDeps['verge']>>();
    const verge = (i: number, sg: number) => {
      const key = i * 2 + (sg > 0 ? 1 : 0);
      if (!prof.has(key)) prof.set(key, this.d.verge(i, sg));
      return prof.get(key)!;
    };
    for (let i = k * CH; i < (k + 1) * CH; i++) {
      // Lage und Querrichtung am Anfang und Ende des Segments (dazwischen gerade)
      const A = t.world(i * SEG, 0, 0, this.W0);
      const B = t.world((i + 1) * SEG, 0, 0, this.W1);
      const ax = A.x, az = A.z, arx = Math.cos(A.th), arz = Math.sin(A.th);
      const bx = B.x, bz = B.z, brx = Math.cos(B.th), brz = Math.sin(B.th);
      const y0 = t.heightAt(i * SEG), y1 = t.heightAt((i + 1) * SEG);
      for (const sg of [-1, 1]) {
        const a = verge(i, sg);
        const b = a && verge(i + 1, sg);
        if (!a || !b) continue;
        const e0 = t.extra(i), e1 = t.extra(i + 1);
        const w = Math.min(a.lim, b.lim) - 0.35;
        if (w < 0.6) continue;
        const cnt = Math.round(SEG * w * DENSITY * (0.85 + r() * 0.3));
        for (let q = 0; q < cnt; q++) {
          const f = r();
          // nah am Bankett dicht, zum Rand hin lichter (Verteilung zur Straße hin verdichtet)
          const u = r();
          const dx = 0.22 + (w - 0.22) * u * (0.55 + 0.45 * u);
          const edgeK = 1 - Math.max(0, (dx - (w - 2.6)) / 2.6);
          if (r() > 0.25 + 0.75 * edgeK) continue;
          const ha = at(a.pr, dx), hb = at(b.pr, dx);
          if (ha === null || hb === null) continue;
          const lx = sg * (EDGE + e0 + (e1 - e0) * f + dx);
          const px = ax + arx * lx + (bx + brx * lx - ax - arx * lx) * f;
          const pz = az + arz * lx + (bz + brz * lx - az - arz * lx) * f;
          const py = y0 + (y1 - y0) * f + ha.h + (hb.h - ha.h) * f - 0.03;
          const sc = (0.7 + r() * 0.6) * (0.55 + 0.45 * edgeK);
          const yaw = r() * Math.PI * 2;
          const cs = Math.cos(yaw), sn = Math.sin(yaw);
          const sx = sc * (0.9 + r() * 0.3), sy = sc * (0.8 + r() * 0.5), sz = sc * (0.9 + r() * 0.3);
          if ((n + 1) * 16 > this.mBuf.length) this.grow();
          const m = this.mBuf;
          const o = n * 16;
          // Drehung um die Hochachse, Größe je Achse, Ort (spaltenweise wie Matrix4.elements)
          m[o] = cs * sx; m[o + 1] = 0; m[o + 2] = -sn * sx; m[o + 3] = 0;
          m[o + 4] = 0; m[o + 5] = sy; m[o + 6] = 0; m[o + 7] = 0;
          m[o + 8] = sn * sz; m[o + 9] = 0; m[o + 10] = cs * sz; m[o + 11] = 0;
          m[o + 12] = px; m[o + 13] = py; m[o + 14] = pz; m[o + 15] = 1;
          // Farbe des Bodens darunter, je Büschel etwas anders (grüner, trockener)
          const c = ha.c;
          const v = 0.85 + r() * 0.3;
          const dry = r() < 0.18 ? 0.12 + r() * 0.12 : 0;
          const co = n * 3;
          this.cBuf[co] = c[0] * v * (1 + dry * 0.9);
          this.cBuf[co + 1] = c[1] * v * (1 + dry * 0.35);
          this.cBuf[co + 2] = c[2] * v * (1 - dry * 0.6);
          n++;
        }
      }
      yield;
    }
    const mesh = new THREE.InstancedMesh(this.geo, this.d.material, Math.max(1, n));
    mesh.count = n;
    if (n) {
      (mesh.instanceMatrix.array as Float32Array).set(this.mBuf.subarray(0, n * 16));
      mesh.instanceColor = new THREE.InstancedBufferAttribute(this.cBuf.slice(0, n * 3), 3);
      // Grenzen fürs Ausblenden außerhalb des Bildes
      mesh.computeBoundingSphere();
    }
    mesh.frustumCulled = n > 0;
    mesh.visible = n > 0;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.userData.noShadow = true;
    return mesh;
  }

  private grow() {
    const m = new Float32Array(this.mBuf.length * 2);
    m.set(this.mBuf);
    this.mBuf = m;
    const c = new Float32Array(this.cBuf.length * 2);
    c.set(this.cBuf);
    this.cBuf = c;
  }

  /** fertige Stücke (für Prüfungen) */
  get size(): number { return this.chunks.size; }

  dispose() {
    for (const m of this.chunks.values()) { this.group.remove(m); m.dispose(); }
    this.chunks.clear();
    this.gen = null;
    this.geo.dispose();
  }
}

/** Höhe und Farbe des Querprofils in Abstand dx ab dem Bankett */
function at(pr: VergeProfile, dx: number): { h: number; c: [number, number, number] } | null {
  const o = pr.o;
  if (dx > o[o.length - 1] + 0.3) return null;
  for (let k = 0; k < o.length - 1; k++) {
    if (dx <= o[k + 1]) {
      const t = Math.max(0, Math.min(1, (dx - o[k]) / Math.max(1e-6, o[k + 1] - o[k])));
      const c0 = pr.cols[k], c1 = pr.cols[k + 1] ?? c0;
      return { h: pr.h[k] + (pr.h[k + 1] - pr.h[k]) * t, c: [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t] };
    }
  }
  const n = o.length - 1;
  return { h: pr.h[n], c: pr.cols[n] ?? pr.cols[0] };
}

export type { Seg };
