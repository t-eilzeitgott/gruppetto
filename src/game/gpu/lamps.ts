/**
 * Leuchtende Laternen und Wandlampen (Abend): je Lampe ein kleines Bild zur Kamera gedreht – heller Kern, weicher
 * warmer Hof, addiert aufs Bild (ohne Leuchten-Nachbearbeitung, ohne Dunst). Alle Lampen eines Abschnitts in
 * einem Zeichenaufruf (Instanzen), ein Material für alle. Den Lichtkegel auf dem Boden malt die Bodenkarte
 * (sunmap.ts), hier nur das Glimmen der Lampe selbst.
 */
import * as THREE from 'three/webgpu';
import { tsl } from './nodes';
import { MOOD_U } from './mood';
import { commit, instGroup } from './inst';

const { attribute, cameraPosition, cross, exp, float, max, min, normalize, positionGeometry, uv, vec3 } = tsl;

let MAT: THREE.MeshBasicNodeMaterial | null = null;
let QUAD: THREE.BufferGeometry | null = null;

function material(): THREE.MeshBasicNodeMaterial {
  if (MAT) return MAT;
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  m.fog = false;
  const iP = attribute('iP', 'vec4');
  const iS = attribute('iS', 'vec4');
  const c = iP.xyz;
  const toCam = cameraPosition.sub(c);
  const d = toCam.length();
  const f = toCam.div(max(d, float(1e-3)));
  const right = normalize(cross(vec3(0, 1, 0), f));
  const up = cross(f, right);
  // fern etwas größer (bleibt als Lichtpunkt sichtbar), nah klein – aber nicht über 2,4-fach: viele große Höfe
  // übereinander (Blick die Dorfstraße entlang) kosteten die Grafik viel
  const size = iS.x.mul(float(1).add(min(d, float(120)).mul(0.012)));
  const p = positionGeometry;
  m.positionNode = c.add(right.mul(p.x.mul(size))).add(up.mul(p.y.mul(size))).add(f.mul(0.3));
  const r = uv().sub(0.5).mul(2).length();
  const core = exp(r.mul(r).mul(-60)).mul(5);
  const halo = exp(r.mul(-5.5)).mul(0.55);
  // mit der Entfernung schwächer (der Hof soll fern kein Fleck werden)
  const k = float(1).div(d.mul(0.012).add(1)).mul(MOOD_U.lights as unknown as ReturnType<typeof float>).mul(iS.y);
  m.colorNode = vec3(1.0, 0.62, 0.3).mul(core.add(halo)).mul(k);
  m.name = 'lamps';
  MAT = m;
  return m;
}

function quad(): THREE.BufferGeometry {
  if (QUAD) return QUAD;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  QUAD = g;
  return g;
}

/** Lampen (x, y, z je Lampe) als ein Netz; size: Größe des Hofs (m), k: Helligkeit */
export function lampHalos(pts: number[], size = 1.6, k = 1): THREE.Mesh | null {
  const n = pts.length / 3;
  if (!n) return null;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  const sphere = new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 20);
  const g = instGroup(quad(), material(), n, sphere);
  for (let i = 0; i < n; i++) g.data.set([pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], 0, size, k, 0, 0, 1, 1, 1, 0], i * 12);
  commit(g, n);
  g.mesh.renderOrder = 5;
  g.mesh.name = 'lamps';
  return g.mesh;
}

/** Vorwärmen: ein Netz mit einer Lampe weit unten */
export function warmLamps(): THREE.Mesh { return lampHalos([0, -500, 0])!; }
