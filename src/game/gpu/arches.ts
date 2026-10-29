/**
 * Torbögen über der Straße (Start, Zwischenzeit-Stationen, Côte, Flamme Rouge, Ziel, Gipfel): zwei Masten und ein
 * Spruchband wie im Spiel (`render3d.arch`), hier aus einem Atlas: alle Spruchbänder liegen in einer Leinwand
 * (Zellen 512 × 80), damit alle Bögen ein Material und einen Shader teilen – ein neuer Bogen unterwegs kostet
 * keine Übersetzung, nur das Nachladen der Leinwand (2,6 MB, beim Bau des Abschnitts weit voraus).
 */
import * as THREE from 'three/webgpu';
import { EDGE, SEG, type Banner, type Track } from '../abfahrt/track';
import { bannerTex } from '../abfahrt/tex3d';
import { cheapMaterial } from './light';
import { tsl } from './nodes';

const { normalWorldGeometry, texture, uv } = tsl;

const CW = 512;
const CH = 80;
const CELLS = 16;
/** unten eine Palette: Masten grau, Stirnseiten in der Bandfarbe kommen aus der Zelle selbst */
const PAL_H = 16;
const AH = CELLS * CH + PAL_H;

export class Arches {
  readonly mat: THREE.MeshLambertNodeMaterial;
  private canvas: HTMLCanvasElement;
  private tex: THREE.CanvasTexture;
  private slots = new Map<string, number>();
  private pole: THREE.BufferGeometry;

  constructor(private track: Track, private accent: string) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CW;
    this.canvas.height = AH;
    const c = this.canvas.getContext('2d')!;
    c.fillStyle = '#9aa0a8';
    c.fillRect(0, AH - PAL_H, CW, PAL_H);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.tex.flipY = true;
    const m = cheapMaterial({ col: texture(this.tex, uv()).rgb, nWorld: normalWorldGeometry });
    m.map = this.tex;
    m.name = 'arches';
    this.mat = m;
    this.pole = new THREE.CylinderGeometry(0.08, 0.1, 5.8, 8);
    this.pole.translate(0, 2.9, 0);
  }

  /** Farbe des Bandes wie im Spiel */
  private colorOf(k: Banner['kind']): string {
    return k === 'gpm' || k === 'finish' || k === 'start' ? this.accent : k === 'sprint' ? '#1f6feb' : k === 'flamme' ? '#d63031' : k === 'split' ? '#ffd23f' : '#ffffff';
  }

  /** Zelle für ein Band (wird bei Bedarf gemalt) */
  private slot(b: Banner): number {
    const color = this.colorOf(b.kind);
    const main = b.kind === 'gpm' ? `GPM · ${b.text}` : b.kind === 'welcome' ? `Benvenuti a ${b.text}` : b.text;
    const key = `${main}|${b.sub ?? ''}|${color}`;
    let s = this.slots.get(key);
    if (s !== undefined) return s;
    s = this.slots.size % CELLS;
    this.slots.set(key, s);
    const light = color === '#ffffff' || color === '#ffd23f';
    const src = bannerTex(main.toUpperCase(), b.sub ?? '', color, light ? '#1a1a1a' : '#ffffff');
    const c = this.canvas.getContext('2d')!;
    c.drawImage(src, 0, s * CH, CW, CH);
    this.tex.needsUpdate = true;
    return s;
  }

  /** ein Bogen: Masten und Band als ein Netz (ein Zeichenaufruf) */
  private build(i: number, b: Banner): THREE.Mesh {
    const s = this.slot(b);
    const w = { x: 0, y: 0, z: 0, th: 0 };
    this.track.world(i * SEG, 0, 0, w);
    const span = EDGE * 2 + 0.6;
    const pos: number[] = [], nor: number[] = [], uvs: number[] = [], idx: number[] = [];
    const cs = Math.cos(w.th), sn = Math.sin(w.th);
    // Weltlage: lokal x quer zur Straße, z längs; Drehung −th um y wie im Spiel
    const put = (lx: number, ly: number, lz: number) => [w.x + lx * cs + lz * sn, w.y + ly, w.z - lx * sn + lz * cs];
    const add = (g: THREE.BufferGeometry, ox: number, u0: number, v0: number, u1: number, v1: number, fixed: boolean) => {
      const base = pos.length / 3;
      const P = g.getAttribute('position'), Nn = g.getAttribute('normal'), U = g.getAttribute('uv');
      for (let k = 0; k < P.count; k++) {
        pos.push(...put(P.getX(k) + ox, P.getY(k), P.getZ(k)));
        const nx = Nn.getX(k), nz = Nn.getZ(k);
        nor.push(nx * cs + nz * sn, Nn.getY(k), -nx * sn + nz * cs);
        if (fixed) uvs.push(u0, (v0 + v1) / 2);
        else uvs.push(u0 + (u1 - u0) * U.getX(k), v0 + (v1 - v0) * U.getY(k));
      }
      const ix = g.index!;
      for (let k = 0; k < ix.count; k++) idx.push(ix.getX(k) + base);
    };
    // Palette (grau) für die Masten
    const pv = 1 - (AH - PAL_H / 2) / AH;
    add(this.pole, -span / 2, 0.5, pv, 0.5, pv, true);
    add(this.pole, span / 2, 0.5, pv, 0.5, pv, true);
    // Band: Vorder- und Rückseite mit Schrift, Stirnseiten in der Bandfarbe (Rand der Zelle)
    const box = new THREE.BoxGeometry(span, 1.3, 0.18);
    box.translate(0, 5.1, 0);
    const v0 = 1 - ((s + 1) * CH - 2) / AH, v1 = 1 - (s * CH + 2) / AH;
    const groups = box.groups;
    const sub = (gi: number, fixed: boolean) => {
      const g = groups[gi];
      const part = new THREE.BufferGeometry();
      part.setAttribute('position', box.getAttribute('position'));
      part.setAttribute('normal', box.getAttribute('normal'));
      part.setAttribute('uv', box.getAttribute('uv'));
      const ia = box.index!.array as ArrayLike<number>;
      part.setIndex(Array.from({ length: g.count }, (_, k) => ia[g.start + k]));
      // Stirnseiten: linker Rand der Zelle (Bandfarbe ohne Schrift)
      add(part, 0, 0.004, v0, 0.996, v1, fixed);
    };
    // Reihenfolge der Box-Gruppen: +x, −x, +y, −y, +z, −z
    for (let gi = 0; gi < 4; gi++) sub(gi, true);
    sub(4, false);
    sub(5, false);
    box.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Streaming: Bögen der Segmente i0 … i1 (halboffen) in die Gruppe des Abschnitts */
  addRange(group: THREE.Group, i0: number, i1: number) {
    for (let i = i0; i < i1; i++) {
      const b = this.track.seg(i).banner;
      if (!b || b.kind === 'gate') continue;
      group.add(this.build(i, b));
    }
  }

  /** Vorwärmen: ein Bogen, damit der Shader beim Laden übersetzt wird */
  warm(): THREE.Mesh { return this.build(2, { kind: 'arch', text: 'gruppetto' }); }

  dispose() {
    this.mat.dispose();
    this.tex.dispose();
    this.pole.dispose();
  }
}
