/**
 * Der Fahrer aus dem Spiel (RiderModel, riderAnim) im WebGPU-Test: gleiche Geometrie und Bewegung, aber
 * physikalische Materialien – Lack mit Klarlack, Metall, Stoff. Der Glanz je Ecke (Attribut „gloss“: 0 matt,
 * 0,5 Lack, 1 Metall) steuert Rauheit, Metall und Klarlack.
 */
import * as THREE from 'three/webgpu';
import { RiderModel } from '../abfahrt/rider3d';
import { RiderAnim } from '../abfahrt/riderAnim';
import { TEAM_KITS, SKINS, type Kit } from '../abfahrt/rider';
import { tsl } from './nodes';

const { attribute, clamp, float, mix } = tsl;

function convert(root: THREE.Object3D) {
  const cache = new Map<string, THREE.Material>();
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
    let m = cache.get(key);
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
      cache.set(key, m);
    }
    mesh.material = m;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

export class Rider {
  readonly model: RiderModel;
  readonly anim = new RiderAnim(7, true);

  constructor(team = 0) {
    const kit: Kit = { ...TEAM_KITS[team % TEAM_KITS.length], skin: SKINS[1], number: '27' };
    this.model = new RiderModel(kit, new THREE.Texture(), 1);
    this.model.shadow.visible = false;
    convert(this.model.group);
  }

  get group() { return this.model.group; }
}
