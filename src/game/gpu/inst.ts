/**
 * Instanzen ohne InstancedMesh (WebGPU-Test). three.js übersetzt für jedes InstancedMesh ein eigenes
 * Shaderprogramm (die Instanzdaten hängen am Objekt) – das ruckelt jedes Mal, wenn eine neue Baumgruppe oder ein
 * neues Grasstück ins Bild kommt (und beim Kamerawechsel gleich mehrfach). Hier stehen die Instanzdaten als
 * Attribute in der Geometrie: Ort und Drehung um die Hochachse (iP), Größe je Achse (iS), Farbe (iC). Alle Gruppen
 * mit demselben Material teilen sich so ein einziges Programm.
 */
import * as THREE from 'three/webgpu';
import { tsl, type N } from './nodes';

const { attribute, cameraPosition, cos, float, normalGeometry, normalize, positionGeometry, sin, smoothstep, transformNormalToView, varying, vec3 } = tsl;

/** Floats je Instanz: iP (x, y, z, Drehung), iS (Größe x, y, z, frei), iC (r, g, b, frei) */
export const STRIDE = 12;

export interface InstGroup {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  data: Float32Array;
  buf: THREE.InstancedInterleavedBuffer;
}

/** Gruppe für bis zu cap Instanzen einer Grundform; sphere: Hülle aller Instanzen (für das Wegschneiden) */
export function instGroup(base: THREE.BufferGeometry, mat: THREE.Material, cap: number, sphere: THREE.Sphere): InstGroup {
  const geo = new THREE.InstancedBufferGeometry();
  for (const k of Object.keys(base.attributes)) geo.setAttribute(k, base.attributes[k]);
  if (base.index) geo.setIndex(base.index);
  const data = new Float32Array(Math.max(1, cap) * STRIDE);
  const buf = new THREE.InstancedInterleavedBuffer(data, STRIDE, 1);
  buf.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iP', new THREE.InterleavedBufferAttribute(buf, 4, 0));
  geo.setAttribute('iS', new THREE.InterleavedBufferAttribute(buf, 4, 4));
  geo.setAttribute('iC', new THREE.InterleavedBufferAttribute(buf, 4, 8));
  geo.instanceCount = 0;
  geo.boundingSphere = sphere;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  return { mesh, geo, data, buf };
}

/** Anzahl setzen und die Daten neu hochladen */
export function commit(g: InstGroup, count: number) {
  g.geo.instanceCount = count;
  g.mesh.visible = count > 0;
  g.buf.needsUpdate = true;
}

/** Gruppe freigeben (die Grundform bleibt – sie gehört allen) */
export function disposeGroup(g: InstGroup) {
  g.mesh.removeFromParent();
  g.geo.dispose();
}

/**
 * Knoten einer Instanz: Ecke in Weltkoordinaten (ohne Wind), Normale für das Material, Farbe der Instanz,
 * Ort der Instanz. Drehung wie Matrix4.makeRotationY. fade: zwischen diesen Abständen zur Kamera (m) schrumpft
 * die Instanz auf null (fern weglassen, ohne Aufploppen).
 */
export function instNodes(fade?: [number, number]) {
  const iP = attribute('iP', 'vec4');
  const iS = attribute('iS', 'vec4');
  const c = cos(iP.w);
  const s = sin(iP.w);
  const rotY = (v: N): N => vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s)));
  let scale: N = iS.xyz;
  if (fade) scale = scale.mul(float(1).sub(smoothstep(fade[0], fade[1], iP.xz.sub(cameraPosition.xz).length())));
  const world: N = rotY(positionGeometry.mul(scale)).add(iP.xyz);
  const nWorld: N = varying(rotY(normalGeometry), 'vInstN');
  return { world, nWorld, rot: rotY, normal: transformNormalToView(normalize(nWorld)), color: attribute('iC', 'vec4').xyz as N, at: iP.xyz as N, extra: iS.w as N };
}
