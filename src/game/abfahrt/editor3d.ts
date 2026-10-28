/**
 * Marker des Welt-Editors in der 3D-Szene: Fähnchen für Notizen, Ringe für Hügel und Mulden,
 * ein kleiner Kegel über gesetzten Requisiten – mit Beschriftung, die immer zur Kamera zeigt.
 * Nur im Editor sichtbar; die Spiele legen nie Marker an.
 */
import * as THREE from 'three';

export type MarkerKind = 'note' | 'bump' | 'sprite' | 'cursor';
export interface Marker {
  id: string;
  kind: MarkerKind;
  x: number;
  y: number;
  z: number;
  /** Ring: Radius in m */
  r?: number;
  label?: string;
  active?: boolean;
}

const COLOR: Record<MarkerKind, number> = { note: 0xff5fa2, bump: 0x4cc9f0, sprite: 0xffd23f, cursor: 0xffffff };

function labelTexture(text: string, color: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d')!;
  const font = '600 28px system-ui, -apple-system, sans-serif';
  ctx.font = font;
  const w = Math.min(420, Math.ceil(ctx.measureText(text).width) + 28);
  cv.width = w;
  cv.height = 48;
  ctx.font = font;
  ctx.fillStyle = 'rgba(12, 14, 20, 0.78)';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, 48, 12);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 6, 48);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 16, 25, w - 24);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class EditorMarkers {
  readonly group = new THREE.Group();
  private items = new Map<string, { obj: THREE.Object3D; sig: string; disp: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] }>();
  private cone = new THREE.ConeGeometry(0.45, 1.4, 8);
  private ball = new THREE.SphereGeometry(0.35, 10, 8);
  private pole = new THREE.CylinderGeometry(0.06, 0.06, 1, 6);
  private mats = new Map<string, THREE.MeshBasicMaterial>();

  constructor() {
    this.group.name = 'editor-markers';
    this.group.userData.nopick = true;
    this.group.renderOrder = 50;
  }

  private mat(c: number, active: boolean): THREE.MeshBasicMaterial {
    const k = `${c}:${active}`;
    let m = this.mats.get(k);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: active ? 1 : 0.8, depthTest: false });
      this.mats.set(k, m);
    }
    return m;
  }

  /** Marker auf den Stand bringen (Neuaufbau nur, wenn sich etwas an einem Marker geändert hat) */
  set(list: Marker[]) {
    const seen = new Set<string>();
    for (const m of list) {
      seen.add(m.id);
      const sig = `${m.kind}|${m.x.toFixed(2)}|${m.y.toFixed(2)}|${m.z.toFixed(2)}|${m.r ?? ''}|${m.label ?? ''}|${m.active ? 1 : 0}`;
      const cur = this.items.get(m.id);
      if (cur?.sig === sig) continue;
      if (cur) this.drop(m.id);
      const obj = this.build(m);
      this.items.set(m.id, obj);
      this.group.add(obj.obj);
    }
    for (const id of [...this.items.keys()]) if (!seen.has(id)) this.drop(id);
  }

  private drop(id: string) {
    const it = this.items.get(id);
    if (!it) return;
    this.group.remove(it.obj);
    for (const d of it.disp) d.dispose();
    this.items.delete(id);
  }

  private build(m: Marker): { obj: THREE.Object3D; sig: string; disp: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] } {
    const g = new THREE.Group();
    g.position.set(m.x, m.y, m.z);
    const disp: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
    const col = COLOR[m.kind];
    const mat = this.mat(col, !!m.active);
    if (m.kind === 'note') {
      const pole = new THREE.Mesh(this.pole, mat);
      pole.scale.y = 3;
      pole.position.y = 1.5;
      const flag = new THREE.Mesh(this.ball, mat);
      flag.position.y = 3.1;
      g.add(pole, flag);
    } else if (m.kind === 'bump') {
      const r = Math.max(1, m.r ?? 5);
      const geo = new THREE.RingGeometry(r * 0.94, r, 48);
      disp.push(geo);
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.4;
      const mid = new THREE.Mesh(this.ball, mat);
      mid.position.y = 0.6;
      g.add(ring, mid);
    } else if (m.kind === 'sprite') {
      const c = new THREE.Mesh(this.cone, mat);
      c.rotation.x = Math.PI;
      c.position.y = 2.6;
      g.add(c);
    } else {
      const geo = new THREE.RingGeometry(0.5, 0.65, 24);
      disp.push(geo);
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.15;
      g.add(ring);
    }
    if (m.label) {
      const tex = labelTexture(m.label, `#${col.toString(16).padStart(6, '0')}`);
      const sm = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      disp.push(tex, sm);
      const s = new THREE.Sprite(sm);
      const w = tex.image.width / 48;
      s.scale.set(w * 1.1, 1.1, 1);
      s.position.y = m.kind === 'note' ? 4.3 : m.kind === 'sprite' ? 3.8 : 1.8;
      s.center.set(0, 0.5);
      g.add(s);
    }
    g.traverse((o) => { o.userData.nopick = true; o.renderOrder = 50; });
    const sig = `${m.kind}|${m.x.toFixed(2)}|${m.y.toFixed(2)}|${m.z.toFixed(2)}|${m.r ?? ''}|${m.label ?? ''}|${m.active ? 1 : 0}`;
    return { obj: g, sig, disp };
  }

  dispose() {
    for (const id of [...this.items.keys()]) this.drop(id);
    this.cone.dispose();
    this.ball.dispose();
    this.pole.dispose();
    for (const m of this.mats.values()) m.dispose();
  }
}
