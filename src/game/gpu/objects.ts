/**
 * Dinge auf der Straße für die WebGPU-Abfahrt (aus der Spiellogik, je Bild): Trinkflaschen und goldene Flaschen
 * (drehen sich, Lichtring am Boden), Hütchen, Steinschlag, Schlaglöcher, Pfützen (spiegeln den Himmel), Kühe,
 * die über die Straße laufen. Jede Art als Instanzen (inst.ts) – ein Zeichenaufruf je Art, nur wenn sichtbar.
 *
 * Dazu die Partikel der Spiellogik (Staub, Funken, Spritzer, Konfetti, Schotter, Schnee) als zur Kamera
 * gedrehte Scheibchen in einem Zeichenaufruf.
 */
import * as THREE from 'three/webgpu';
import { SEG, type Track } from '../abfahrt/track';
import type { Particle } from '../abfahrt/engine';
import { commit, instGroup, instNodes, STRIDE, type InstGroup } from './inst';
import { cowGeometry, herdMaterial } from './life';
import { tsl } from './nodes';

const { attribute, cameraViewMatrix, float, length, max, positionGeometry, smoothstep, uv, vec3, vec4, vertexColor } = tsl;

/** Teile mit Eckpunktfarbe zu einer Geometrie (ohne Index) */
function merge(parts: [THREE.BufferGeometry, number[], THREE.Matrix4][]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();
  for (const [g0, c, m] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    g.computeVertexNormals();
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    nm.getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      nor.push(v.x, v.y, v.z);
      col.push(c[0], c[1], c[2]);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}
const T = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().makeScale(sx, sy, sz).setPosition(x, y, z);
const lin = (hex: string) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

type Kind = 'bottle' | 'ring' | 'cone' | 'rock' | 'hole' | 'puddle' | 'cow';

export class Objects {
  readonly group = new THREE.Group();
  private g = {} as Record<Kind, InstGroup>;
  private cnt = {} as Record<Kind, number>;
  private w = { x: 0, y: 0, z: 0, th: 0 };
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];

  constructor() {
    const std = (name: string, rough: number, metalK = false) => {
      const m = new THREE.MeshStandardNodeMaterial();
      const I = instNodes();
      m.positionNode = I.world;
      m.normalNode = I.normal;
      m.colorNode = vertexColor().xyz.mul(I.color);
      m.roughnessNode = float(rough);
      // Gold glänzt metallisch (Stärke in iS.w)
      m.metalnessNode = metalK ? I.extra : float(0);
      m.name = name;
      this.mats.push(m);
      return m;
    };
    // Flasche: Körper weiß (Farbe aus der Instanz), weißes Band, dunkle Kappe
    const bottle = merge([
      [new THREE.CylinderGeometry(0.075, 0.075, 0.22, 12), [1, 1, 1], T(0, 0, 0)],
      [new THREE.CylinderGeometry(0.077, 0.077, 0.05, 12), [2.2, 2.2, 2.2], T(0, 0.02, 0)],
      [new THREE.CylinderGeometry(0.035, 0.05, 0.07, 8), [0.04, 0.04, 0.05], T(0, 0.14, 0)],
    ]);
    const cone = merge([
      [new THREE.ConeGeometry(0.17, 0.62, 12), lin('#ff5a0a'), T(0, 0.35, 0)],
      [new THREE.CylinderGeometry(0.09, 0.115, 0.12, 12), [0.85, 0.85, 0.82], T(0, 0.38, 0)],
      [new THREE.BoxGeometry(0.42, 0.04, 0.42), [0.02, 0.02, 0.022], T(0, 0.02, 0)],
    ]);
    const rock = merge([
      [new THREE.DodecahedronGeometry(0.42, 1), [0.27, 0.255, 0.23], T(0, 0.25, 0, 1, 0.75, 0.9)],
      [new THREE.DodecahedronGeometry(0.2, 0), [0.22, 0.21, 0.19], T(0.4, 0.12, 0.2)],
      [new THREE.DodecahedronGeometry(0.13, 0), [0.24, 0.23, 0.21], T(-0.35, 0.07, -0.18)],
    ]);
    // Schlagloch: dunkle Mitte, heller ausgefranster Rand (Farben je Ring)
    const hole = (() => {
      const pos: number[] = [];
      const col: number[] = [];
      const N = 18;
      const r0 = 0.72, r1 = 1;
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
        const j0 = 1 + Math.sin(k * 2.7) * 0.08, j1 = 1 + Math.sin((k + 1) * 2.7) * 0.08;
        const c0 = [Math.cos(a0) * j0, Math.sin(a0) * j0], c1 = [Math.cos(a1) * j1, Math.sin(a1) * j1];
        // Mitte
        pos.push(0, -0.03, 0, c1[0] * r0, -0.02, c1[1] * r0, c0[0] * r0, -0.02, c0[1] * r0);
        col.push(0.012, 0.012, 0.012, 0.025, 0.024, 0.022, 0.025, 0.024, 0.022);
        // Rand
        pos.push(c0[0] * r0, -0.02, c0[1] * r0, c1[0] * r0, -0.02, c1[1] * r0, c1[0] * r1, 0, c1[1] * r1);
        pos.push(c0[0] * r0, -0.02, c0[1] * r0, c1[0] * r1, 0, c1[1] * r1, c0[0] * r1, 0, c0[1] * r1);
        col.push(0.05, 0.048, 0.045, 0.05, 0.048, 0.045, 0.11, 0.1, 0.09, 0.05, 0.048, 0.045, 0.11, 0.1, 0.09, 0.11, 0.1, 0.09);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      return g;
    })();
    const disc = merge([[new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), [1, 1, 1], T(0, 0, 0)]]);
    const ring = merge([[new THREE.RingGeometry(0.55, 1, 24).rotateX(-Math.PI / 2), [1, 1, 1], T(0, 0, 0)]]);
    this.geos.push(bottle, cone, rock, hole, disc, ring);

    // Lichtring der Flaschen: additiv, Farbe aus der Instanz, nach außen weich
    const ringMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    {
      const I = instNodes();
      ringMat.positionNode = I.world;
      const r = length(positionGeometry.xz);
      ringMat.colorNode = vec4(I.color.mul(smoothstep(1, 0.6, r).mul(smoothstep(0.55, 0.75, r))), 1);
      ringMat.name = 'obj-ring';
      this.mats.push(ringMat);
    }
    // Schlagloch: matt, leicht unter der Fahrbahn
    const holeMat = std('obj-hole', 0.95);
    holeMat.polygonOffset = true;
    holeMat.polygonOffsetFactor = -2;
    holeMat.polygonOffsetUnits = -2;
    // Pfütze: glatt, dunkel – spiegelt den Himmel (Umgebungslicht)
    const pud = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false });
    {
      const I = instNodes();
      pud.positionNode = I.world;
      pud.normalNode = I.normal;
      pud.colorNode = vec3(0.03, 0.04, 0.05);
      pud.roughnessNode = float(0.04);
      pud.metalnessNode = float(0.1);
      // Rand weich
      const r = length(positionGeometry.xz);
      pud.opacityNode = smoothstep(1, 0.7, r).mul(0.88);
      pud.polygonOffset = true;
      pud.polygonOffsetFactor = -2;
      pud.polygonOffsetUnits = -2;
      pud.name = 'obj-puddle';
      this.mats.push(pud);
    }
    const cowGeo = cowGeometry();
    this.geos.push(cowGeo);
    const cowMat = herdMaterial('obj-cow', [0, 1.3, 0.72], [0, 1.32, -1.0], 0.6, [400, 460]);
    this.mats.push(cowMat);

    const sphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const add = (k: Kind, geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, shadow: boolean) => {
      const g = instGroup(geo, mat, cap, sphere);
      g.mesh.castShadow = shadow;
      g.mesh.receiveShadow = !shadow ? false : true;
      g.mesh.frustumCulled = false;
      this.group.add(g.mesh);
      this.g[k] = g;
      this.cnt[k] = 0;
    };
    add('bottle', bottle, std('obj-bottle', 0.35, true), 96, true);
    add('ring', ring, ringMat, 96, false);
    add('cone', cone, std('obj-cone', 0.6), 64, true);
    add('rock', rock, std('obj-rock', 0.9), 32, true);
    add('hole', hole, holeMat, 32, false);
    add('puddle', disc, pud, 32, false);
    add('cow', cowGeo, cowMat, 16, true);
  }

  private put(k: Kind, x: number, y: number, z: number, rot: number, s: [number, number, number], c: [number, number, number], extra = 0) {
    const g = this.g[k];
    const i = this.cnt[k];
    if ((i + 1) * STRIDE > g.data.length) return;
    g.data.set([x, y, z, rot, s[0], s[1], s[2], extra, c[0], c[1], c[2], 0], i * STRIDE);
    this.cnt[k] = i + 1;
  }

  /** je Bild: Dinge von 6 m hinter bis 220 m vor dem Fahrer (aus der Strecke der Spiellogik) */
  update(track: Track, pz: number, time: number) {
    for (const k of Object.keys(this.cnt) as Kind[]) this.cnt[k] = 0;
    const w = this.w;
    const i0 = Math.max(0, Math.floor((pz - 6) / SEG));
    const i1 = Math.floor((pz + 220) / SEG);
    for (let i = i0; i <= i1; i++) {
      const s = track.seg(i);
      if (!s.objs) continue;
      for (const o of s.objs) {
        if (o.done && (o.k === 'bidon' || o.k === 'gold' || o.k === 'cone')) continue;
        track.world(o.z, o.x, 0, w);
        const th = w.th;
        switch (o.k) {
          case 'bidon':
          case 'gold': {
            const gold = o.k === 'gold';
            const bob = Math.sin(time * 4 + (o.ph ?? 0)) * 0.05;
            const sc = gold ? 1.6 : 1.35;
            this.put('bottle', w.x, w.y + 0.42 + bob - 0.11 * sc, w.z, time * 2.2 + (o.ph ?? 0), [sc, sc, sc], gold ? [1.0, 0.62, 0.08] : [0.05, 0.25, 0.95], gold ? 1 : 0);
            const rs = gold ? 0.55 : 0.4;
            this.put('ring', w.x, w.y + 0.03, w.z, 0, [rs, 1, rs], gold ? [1.4, 0.8, 0.15] : [0.25, 0.55, 1.4]);
            break;
          }
          case 'cone':
            this.put('cone', w.x, w.y, w.z, o.z * 1.7, [1, 1, 1], [1, 1, 1]);
            break;
          case 'rock':
            this.put('rock', w.x, w.y, w.z, o.z, [1, 1, 1], [1, 1, 1]);
            break;
          case 'pothole':
            this.put('hole', w.x, w.y + 0.012, w.z, -th, [o.r * 1.2, 1, o.r * 0.95], [1, 1, 1]);
            break;
          case 'puddle':
            this.put('puddle', w.x, w.y + 0.015, w.z, -th, [o.r * 1.2, 1, o.r * 1.6], [1, 1, 1]);
            break;
          case 'cow': {
            // läuft quer über die Straße (vx) oder steht längs; Fell je Kuh
            const vx = o.vx ?? 0;
            const rx = Math.cos(th), rz = Math.sin(th);
            const rot = vx ? Math.atan2(rx * Math.sign(vx), rz * Math.sign(vx)) : Math.atan2(Math.sin(th), -Math.cos(th)) + (o.z % 1);
            const coat: [number, number, number] = Math.floor(o.z) % 2 ? [0.06, 0.05, 0.045] : [0.26, 0.19, 0.13];
            this.put('cow', w.x, w.y - 0.04, w.z, rot, [1, 1, 1], coat);
            break;
          }
        }
      }
    }
    for (const k of Object.keys(this.cnt) as Kind[]) commit(this.g[k], this.cnt[k]);
  }

  /** Vorwärmen: jede Art einmal zeichnen */
  warm(on: boolean) {
    for (const k of Object.keys(this.g) as Kind[]) {
      const g = this.g[k];
      if (on) { g.geo.instanceCount = Math.max(1, g.geo.instanceCount); g.mesh.visible = true; } else commit(g, 0);
    }
  }

  dispose() {
    for (const g of Object.values(this.g)) { g.mesh.removeFromParent(); g.geo.dispose(); }
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
  }
}

/** Partikel der Spiellogik: zur Kamera gedrehte, weiche Scheibchen (höchstens 300, ein Zeichenaufruf) */
export class Particles {
  readonly mesh: THREE.Mesh;
  private data = new Float32Array(300 * 8);
  private buf: THREE.InstancedInterleavedBuffer;
  private geo: THREE.InstancedBufferGeometry;
  private col = new THREE.Color();
  private w = { x: 0, y: 0, z: 0, th: 0 };

  constructor() {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, 8, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('pP', new THREE.InterleavedBufferAttribute(this.buf, 4, 0));
    geo.setAttribute('pC', new THREE.InterleavedBufferAttribute(this.buf, 4, 4));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geo = geo;
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const P = attribute('pP', 'vec4');
    const C = attribute('pC', 'vec4');
    const V = cameraViewMatrix;
    const right = vec3(V.element(0).x, V.element(1).x, V.element(2).x);
    const up = vec3(V.element(0).y, V.element(1).y, V.element(2).y);
    m.positionNode = P.xyz.add(right.mul(positionGeometry.x.mul(P.w))).add(up.mul(positionGeometry.y.mul(P.w)));
    const r = length(uv().sub(0.5)).mul(2);
    m.colorNode = vec4(C.xyz, C.w.mul(smoothstep(1, 0.35, r)));
    m.opacityNode = C.w.mul(max(float(0), smoothstep(1, 0.35, r)));
    m.name = 'particles';
    this.mesh = new THREE.Mesh(geo, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 15;
    this.mesh.visible = false;
  }

  update(track: Track, parts: Particle[]) {
    const n = Math.min(300, parts.length);
    const w = this.w;
    for (let i = 0; i < n; i++) {
      const q = parts[i];
      track.world(q.z, q.x, q.h, w);
      this.col.set(q.color);
      const a = Math.max(0, q.life / q.max);
      // Größe: das Spiel zeichnet Punkte ~0,35 m; Funken klein, Staub und Spritzer größer
      const size = q.kind === 'spark' ? 0.09 : q.kind === 'confetti' ? 0.12 : q.kind === 'dust' ? 0.55 + (1 - a) * 0.5 : 0.3;
      this.data.set([w.x, w.y, w.z, size, this.col.r, this.col.g, this.col.b, q.kind === 'dust' ? a * 0.45 : a], i * 8);
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    this.buf.needsUpdate = true;
  }

  warm(on: boolean) {
    if (on) { this.geo.instanceCount = Math.max(1, this.geo.instanceCount); this.mesh.visible = true; } else { this.geo.instanceCount = 0; this.mesh.visible = false; }
  }

  dispose() { this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
