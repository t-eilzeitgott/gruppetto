/**
 * Günstiges Licht für alles Große und Unbewegte (Boden, Straße, Häuser, Zuschauer, Gras): Lambert (nur Sonne und
 * Himmelslicht aus den Lichtern der Szene) plus ein „Ambient Cube“ – sechs Farben des vorgefilterten Himmels
 * (oben, unten, vier Seiten), einmal je Stimmung auf der Grafikkarte gemessen (atmo.ts). Das ersetzt je Bildpunkt
 * zwei Zugriffe in den vorgefilterten Himmel samt der Physik dahinter (PBR) – im Bild kaum ein Unterschied, auf
 * dem iPhone ein Bruchteil der Rechenzeit (die Shader werden etwa ein Drittel so lang).
 */
import * as THREE from 'three/webgpu';
import { tsl, type N } from './nodes';
import { terrainSun } from './sunmap';

const { dot, float, max, normalize, positionWorld, select, uniform, vec3 } = tsl;

/** Umgebungslicht je Richtung (schon mit der Stärke der Stimmung und dem Tunnel verrechnet) */
export const AMB = {
  px: uniform(new THREE.Color(0.05, 0.06, 0.08)),
  nx: uniform(new THREE.Color(0.05, 0.06, 0.08)),
  py: uniform(new THREE.Color(0.07, 0.08, 0.1)),
  ny: uniform(new THREE.Color(0.03, 0.03, 0.03)),
  pz: uniform(new THREE.Color(0.05, 0.06, 0.08)),
  nz: uniform(new THREE.Color(0.05, 0.06, 0.08)),
};

/** Sonne (bzw. Mond) für Glanzlichter der günstigen Materialien: Richtung zur Sonne, Farbe × Stärke */
export const SUN = {
  dir: uniform(new THREE.Vector3(0, 1, 0)),
  col: uniform(new THREE.Color(1, 1, 1)),
};

/** Umgebungslicht für die Weltnormale n (Gewichte n², je Achse die passende Seite) */
export function ambientAt(n: N): N {
  const n2 = n.mul(n);
  const cx = select(n.x.greaterThan(0), AMB.px, AMB.nx);
  const cy = select(n.y.greaterThan(0), AMB.py, AMB.ny);
  const cz = select(n.z.greaterThan(0), AMB.pz, AMB.nz);
  return cx.mul(n2.x).add(cy.mul(n2.y)).add(cz.mul(n2.z));
}

/**
 * Licht der günstigen Materialien, ausgeschrieben (keine Lichter der Szene, kein Schattendurchgang): Sonne nach
 * Lambert mal vorberechnetes Sonnenlicht (vis – Berge, Bäume; ohne Angabe aus der Geländelicht-Karte an der
 * Weltlage), dazu das gemessene Himmelslicht mit Verschattung (ao) und zusätzliches Leuchten (extra: Fenster,
 * Laternen). wrap: weiches Licht um die Kante (Laub, Stoff: 0,3 … 0,6)
 */
export function lit(o: { col: N; nWorld: N; ao?: N; vis?: N; extra?: N; wrap?: number }): N {
  const n = normalize(o.nWorld);
  const ndl = dot(n, SUN.dir);
  const diff = o.wrap ? max(float(0), ndl.add(o.wrap).div(1 + o.wrap)) : max(float(0), ndl);
  const vis = o.vis ?? terrainSun(positionWorld.xz);
  let amb: N = ambientAt(n);
  if (o.ao) amb = amb.mul(o.ao);
  const c = o.col.mul(SUN.col.mul(diff.mul(vis)).add(amb));
  return o.extra ? c.add(o.extra) : c;
}

/**
 * Günstiges Material: unbeleuchtet (MeshBasic) mit dem Licht aus lit() – je Bildpunkt nur Rechnungen und ein
 * Zugriff in die Geländelicht-Karte
 */
export function cheapMaterial(o: { col: N; nWorld: N; ao?: N; vis?: N; extra?: N; wrap?: number; params?: THREE.MeshBasicNodeMaterialParameters }): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial(o.params);
  m.colorNode = lit(o);
  return m;
}

/** Richtungen der sechs Messpunkte (Reihenfolge wie AMB) */
export const AMB_DIRS: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const AMB_KEYS = ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const;

/** float(1) für die Typen (falls ein Aufrufer keine Verschattung hat) */
export const ONE: N = float(1);
export const UP: N = vec3(0, 1, 0);
