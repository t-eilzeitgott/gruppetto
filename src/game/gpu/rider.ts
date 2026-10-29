/**
 * Fahrer aus dem Spiel (RiderModel, RiderAnim) im WebGPU-Test: gleiche Geometrie, gleiches Skinning, gleiche
 * Bewegung – aber physikalische Materialien (Lack mit Klarlack, Metall, Stoff). Der Glanz je Ecke (Attribut
 * „gloss“: 0 matt, 0,5 Lack, 1 Metall) steuert Rauheit, Metall und Klarlack.
 *
 * Die umgewandelten Materialien sind für alle Fahrer gemeinsam (je Ursprungsmaterial eines): die Gegner teilen
 * sich so Shader und meist auch Texturen mit dem eigenen Fahrer – ein Gegner im Bild kostet keine Übersetzung.
 */
import * as THREE from 'three/webgpu';
import { RiderModel } from '../abfahrt/rider3d';
import { RiderAnim, type RiderState } from '../abfahrt/riderAnim';
import { SKINS, TEAM_KITS, type Kit } from '../abfahrt/rider';
import { tsl, type N } from './nodes';

const { attribute, clamp, float, floor, mix, mod, screenCoordinate, select, userData } = tsl;

/** Bayer-Raster 4 × 4 (0 … 1) je Bildpunkt – ordentliches Gitter für die Geister, auf jeder Grafik gleich */
function bayer4(): N {
  const px = floor(screenCoordinate.x), py = floor(screenCoordinate.y);
  const b2 = (x: N, y: N): N => mod(x.mul(2).add(y.mul(3)), 4);
  return b2(mod(px, 2), mod(py, 2)).mul(4).add(b2(mod(floor(px.div(2)), 2), mod(floor(py.div(2)), 2))).add(0.5).div(16);
}

/** Ursprungsmaterial (uuid, mit/ohne Glanz) → Knotenmaterial; gemeinsam für alle Fahrer */
const MATS = new Map<string, THREE.Material>();
function convert(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const src = mesh.material as THREE.Material & {
      color?: THREE.Color; map?: THREE.Texture | null; vertexColors?: boolean; emissive?: THREE.Color; emissiveIntensity?: number;
      isMeshBasicMaterial?: boolean;
    };
    if (src.isMeshBasicMaterial) return;
    const gloss = !!mesh.geometry.getAttribute('gloss');
    const key = `${src.uuid}|${gloss}`;
    let m = MATS.get(key);
    if (!m) {
      const nm = gloss ? new THREE.MeshPhysicalNodeMaterial() : new THREE.MeshStandardNodeMaterial();
      nm.vertexColors = !!src.vertexColors;
      if (src.color) nm.color.copy(src.color);
      nm.map = src.map ?? null;
      nm.transparent = src.transparent;
      nm.opacity = src.opacity;
      nm.side = src.side;
      nm.alphaTest = src.alphaTest;
      nm.depthWrite = src.depthWrite;
      if (src.emissive) { nm.emissive.copy(src.emissive); nm.emissiveIntensity = (src.emissiveIntensity ?? 1) * 2; }
      // Geister (Zeitfahren): halbdurchsichtig als Gitter (Bayer 4 × 4, je Objekt aus userData) – das Material bleibt
      // undurchsichtig (keine Sortierung, ein Shader für alle Fahrer); die Alpha-Abdeckung der Kantenglättung wäre
      // auf mancher Grafik nur ein harter Schwellwert
      if (!src.transparent) {
        const ghost = userData('ghost', 'float');
        nm.opacityNode = select(ghost.lessThan(float(1).sub(bayer4())), float(1), float(0));
        nm.alphaTestNode = float(0.5);
      }
      if (gloss) {
        const g = attribute('gloss', 'float');
        const metal = clamp(g.mul(2).sub(1), 0, 1);
        const diel = clamp(g.mul(2), 0, 1);
        nm.roughnessNode = mix(float(0.72), mix(float(0.24), float(0.3), metal), diel);
        nm.metalnessNode = metal;
        const pm = nm as THREE.MeshPhysicalNodeMaterial;
        pm.clearcoatNode = diel.mul(float(1).sub(metal)).mul(0.9);
        pm.clearcoatRoughnessNode = float(0.06);
      } else {
        // Trikot, Haut, Hose: Stoff, matt mit etwas Schimmer
        nm.roughness = 0.62;
        nm.metalness = 0;
      }
      m = nm;
      MATS.set(key, m);
    }
    mesh.material = m;
    mesh.userData.ghost = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

/** eigener Fahrer wie im Spiel: Trikot in der Akzentfarbe, weiße Seiten und Helm, das Rad aus der Garage */
export function playerKit(accent: string, bike?: string): Kit {
  return { jersey: accent, side: '#ffffff', helmet: '#ffffff', shorts: '#16171a', skin: '#f0c4a0', shoes: '#ffffff', number: '27', bike };
}

/** Teamtrikot Nr. i (Gegner): Farben der Teams, Hautton und Startnummer je Fahrer verschieden, Teamrad */
export function teamKit(i: number): Kit {
  const t = TEAM_KITS[i % TEAM_KITS.length];
  return { ...t, skin: SKINS[(i * 3 + 1) % SKINS.length], number: String(11 + ((i * 37) % 180)) };
}

/** Material des Schlagschattens (Knotenmaterial – das alte Material des Spiels zeichnet die neue Grafik nicht) */
let BLOB_MAT: THREE.MeshBasicNodeMaterial | null = null;
function blobMaterial(): THREE.MeshBasicNodeMaterial {
  if (BLOB_MAT) return BLOB_MAT;
  // undurchsichtig, die Weichheit kommt aus einem feinen Raster (je Bildpunkt eine Schwelle): auf dem Handy mit
  // 2–3 Bildpunkten je Punkt liest sich das als halbdunkler, weicher Fleck. Als durchsichtiges Material erschien der
  // Fleck in der Bildkette der neuen Grafik nicht
  const m = new THREE.MeshBasicNodeMaterial({ transparent: false, depthWrite: false });
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -2;
  // weiche Ellipse (Fläche 1,1 × 2,2 m): Mitte dunkel, zum Rand weich auslaufend
  const d = tsl.uv().sub(0.5).mul(2).length();
  const a = tsl.float(1).sub(tsl.smoothstep(0.1, 1, d)).mul(0.72);
  const sc = tsl.screenCoordinate;
  const ign = tsl.fract(tsl.float(52.9829189).mul(tsl.fract(sc.x.mul(0.06711056).add(sc.y.mul(0.00583715)))));
  m.colorNode = tsl.vec3(0.0, 0.0, 0.0);
  m.opacityNode = tsl.select(a.greaterThan(ign), tsl.float(1), tsl.float(0));
  m.alphaTest = 0.5;
  m.fog = false;
  m.name = 'blob';
  BLOB_MAT = m;
  return m;
}

export class Rider {
  readonly model: RiderModel;
  private anim: RiderAnim;
  private shadowOn = true;
  private small: THREE.Object3D[] = [];
  private ghostK = 0;

  /** Geist: k = wie durchsichtig (0 = fest, 1 = unsichtbar) */
  ghost(k: number) {
    if (Math.abs(k - this.ghostK) < 0.01) return;
    this.ghostK = k;
    this.model.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.userData.ghost = k; });
    // Geister ohne Schlagschatten
    this.model.shadow.visible = k < 0.05;
  }

  /** q = 1: volle Detailstufe (eigener Fahrer: Schriftzüge, Kette, Zähne …), 0: Gegner wie im Spiel */
  constructor(kit: Kit, q: 0 | 1, seed: number, player: boolean) {
    this.anim = new RiderAnim(seed, player);
    this.model = new RiderModel(kit, new THREE.Texture(), q);
    // weicher Schlagschatten unter Rad und Fahrer (zusätzlich zu den Sonnenschatten: hält den Fahrer auch bei tiefer
    // oder verdeckter Sonne sichtbar auf der Straße)
    this.model.shadow.material = blobMaterial();
    // etwas über dem Asphalt (die Fahrbahn der neuen Grafik liegt mit Wölbung und Relief höher als die Mittellinie)
    this.model.shadow.position.y = 0.12;
    this.model.shadow.castShadow = false;
    this.model.shadow.receiveShadow = false;
    convert(this.model.group);
    this.model.lamp.visible = false;
    // kleine Teile werfen keine Schatten (spart Zeichenaufrufe im Schattendurchgang)
    const M = this.model as unknown as { spokes: THREE.Object3D[]; blurs: THREE.Object3D[]; minor: THREE.Object3D[] };
    this.small = [...M.spokes, ...M.blurs, ...M.minor];
    for (const o of this.small) o.traverse((c) => { c.castShadow = false; });
  }

  get group() { return this.model.group; }

  /** neuer Fahrer auf demselben Modell (Vorrat der Gegner): Federn neu, eigene Note */
  reseed(seed: number) { this.anim = new RiderAnim(seed, false); }

  /** Haltung aus dem Zustand der Spiellogik (gefedert, mit Nebenbewegungen) */
  pose(s: RiderState, dt: number, time: number) {
    this.model.pose(this.anim.step(s, Math.max(1e-3, dt), time));
  }

  /** weit weg: kleine Teile (Kurbel, Schuhe, Speichen, Schriftzüge) weglassen – wie im Spiel */
  far(dist: number) {
    const fh = RiderModel.FAR_HIDE;
    this.model.setFar(dist > (this.model.isFar ? fh - 1 : fh));
  }

  /** Rücklicht an (Nacht, Regen) – nach far() aufrufen: das Umschalten der Ferne setzt es sonst wieder sichtbar */
  lamp(on: boolean) {
    this.model.lamp.visible = on && !this.model.isFar;
  }

  /** Schatten werfen (nur nahe Fahrer: der Schattenausschnitt reicht ohnehin nur ~55 m) */
  shadows(on: boolean) {
    if (on === this.shadowOn) return;
    this.shadowOn = on;
    const small = new Set(this.small);
    this.model.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !small.has(m) && m !== this.model.shadow && m !== this.model.lamp) m.castShadow = on;
    });
  }

  dispose() { this.model.dispose(); }
}
