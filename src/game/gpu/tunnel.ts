/**
 * Tunnel für die WebGPU-Abfahrt, nach dem Vorbild des Spiels (tunnel3d.ts) und mit mehr Details: Röhre mit
 * Hufeisen-Gewölbe, Rinne und Gehwegkante mit Rückstrahlern, helle Wandpaneele über dunklem Sockel, Spritzbeton
 * mit Wasserfahnen und Kalkflecken, Kabeltrassen, Leuchtenreihen mit Gehäuse und Lichthof, Strahlventilatoren,
 * SOS-Nischen mit Tür und Schildern, Notausgangs- und Entfernungsschilder, nasse Fahrspuren. Portale als
 * gemauerte Bögen (Bruchstein, Bogensteine mit Schlussstein, Eckquader, Kämpfer, Gesims) mit Marmortafel
 * (Name und Länge).
 *
 * Licht pro Bildpunkt aus der Lage in der Röhre (aT: seitlich, Höhe, Strecke, Abstand zum Portal; aN:
 * Flächenrichtung in der Röhre): Lichtinseln unter den Leuchten, Tageslicht an den Portalen, das nach innen
 * abnimmt. Keine Sonne in der Röhre, kaum mehr Kosten als eine Farbe.
 */
import * as THREE from 'three/webgpu';
import { SEG, type Track } from '../abfahrt/track';
import { GB } from '../abfahrt/models3d';
import { plaqueTex, TSIGN, tunnelSignTex } from '../abfahrt/tex3d';
import { LAMP_EVERY, LAMP_H, LAMP_X, T_WALL, TB, portalFacade, tunnelName, tunnelRing, type TRow } from '../abfahrt/tunnel3d';
import type { Surface, SurfaceId } from './bake';
import { cheapMaterial } from './light';
import { lampHalos } from './lamps';
import { decodeAlbedo, grain, tsl, unTile, type N } from './nodes';

const { abs, attribute, clamp, dot, exp, float, floor, max, mix, normalize, normalWorldGeometry, positionWorld, select, smoothstep, texture, uniform, uv, vec2, vec3, vertexColor } = tsl;

export { LAMP_EVERY, T_WALL };

type Surfaces = Record<SurfaceId, Surface>;

/** Mittel einer gebackenen Textur (zum Normieren: die Ecke trägt die Farbe, die Textur nur die Struktur) */
const meanOf = (s: Surface): N => vec3(s.mean.r, s.mean.g, s.mean.b);

export class Tunnels {
  /** Wände, Gewölbe, Einbauten */
  readonly mat: THREE.MeshBasicNodeMaterial;
  private roadMat: THREE.MeshBasicNodeMaterial;
  private marksMat: THREE.MeshBasicNodeMaterial;
  private signMat: THREE.MeshBasicNodeMaterial;
  private masMat: THREE.MeshBasicNodeMaterial;
  private trimMat: THREE.MeshBasicNodeMaterial;
  /** Tafeln (Name, Länge) in einem Atlas mit vier Plätzen – ein Material für alle Portale (kein neuer Shader unterwegs) */
  private plaqueCv: HTMLCanvasElement;
  private plaqueTex: THREE.CanvasTexture;
  private plaqueMat: THREE.MeshBasicNodeMaterial;
  private plaqueSlots = new Map<string, number>();
  private plaqueNext = 0;
  /** Vorplätze der zuletzt gebauten Portale (x, z): dort keine Bäume vor der Fassade */
  portals: number[] = [];
  /** Tageslicht an den Portalen (Farbe × Stärke, von der Stimmung) */
  readonly day = uniform(new THREE.Color(1, 0.95, 0.88));
  /** Leuchtenfarbe */
  readonly lamp = uniform(new THREE.Color(1, 0.88, 0.7));

  constructor(private track: Track, _stone: THREE.Material, private S: Surfaces) {
    this.mat = this.tubeMat('wall');
    this.roadMat = this.tubeMat('road');
    this.marksMat = this.tubeMat('marks');
    const sm = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    const st = new THREE.CanvasTexture(tunnelSignTex());
    st.colorSpace = THREE.SRGBColorSpace;
    st.anisotropy = 4;
    // Schilder sind hinterleuchtet (Notruf, Ausgang): leuchten selbst
    sm.colorNode = texture(st, uv()).rgb.mul(1.15);
    sm.polygonOffset = true;
    sm.polygonOffsetFactor = -2;
    sm.polygonOffsetUnits = -2;
    sm.name = 'tunnel-signs';
    this.signMat = sm;
    // Portal: Bruchstein (Textur in Metern / 1,8) und Werkstein, im Licht der Welt
    const mp = unTile(S.noise.albedo, uv(), 0.25);
    const masCol = vertexColor().xyz.mul(decodeAlbedo(texture(S.masonry.albedo, mp).rgb).div(meanOf(S.masonry))).mul(grain(positionWorld.xz.add(positionWorld.y), 0.4, 0.08));
    this.masMat = cheapMaterial({ col: masCol, nWorld: normalWorldGeometry, ao: texture(S.masonry.nra, mp).w, params: { side: THREE.DoubleSide } });
    this.masMat.name = 'tunnel-portal';
    this.trimMat = cheapMaterial({ col: vertexColor().xyz.mul(grain(positionWorld.xz.add(positionWorld.y.mul(1.3)), 0.21, 0.06)), nWorld: normalWorldGeometry, params: { side: THREE.DoubleSide } });
    this.trimMat.name = 'tunnel-trim';
    const cv = (this.plaqueCv = document.createElement('canvas'));
    cv.width = 512;
    cv.height = 120 * 4;
    const ptx = (this.plaqueTex = new THREE.CanvasTexture(cv));
    ptx.colorSpace = THREE.SRGBColorSpace;
    ptx.anisotropy = 4;
    this.plaqueMat = cheapMaterial({ col: texture(ptx, uv()).rgb, nWorld: normalWorldGeometry, params: { side: THREE.DoubleSide } });
    this.plaqueMat.name = 'tunnel-plaque';
  }

  /** Platz im Tafel-Atlas für diese Inschrift (neu gemalt, wenn noch nicht da) */
  private plaqueSlot(name: string, len: string): number {
    const key = `${name}|${len}`;
    let k = this.plaqueSlots.get(key);
    if (k !== undefined) return k;
    k = this.plaqueNext;
    this.plaqueNext = (this.plaqueNext + 1) % 4;
    for (const [kk, v] of this.plaqueSlots) if (v === k) this.plaqueSlots.delete(kk);
    this.plaqueSlots.set(key, k);
    const ctx = this.plaqueCv.getContext('2d');
    if (ctx) { ctx.clearRect(0, k * 120, 512, 120); ctx.drawImage(plaqueTex(name, len), 0, k * 120, 512, 120); }
    this.plaqueTex.needsUpdate = true;
    return k;
  }

  /**
   * Material der Röhre: Grundfarbe (Ecke) × Struktur (Textur, Anteil aK) × Röhrenlicht. aK > 1,5: leuchtet selbst
   * (Leuchten, Rückstrahler). kind: Wand (Putz/Spritzbeton), Fahrbahn (Asphalt, nasse Spuren), Markierung
   */
  private tubeMat(kind: 'wall' | 'road' | 'marks'): THREE.MeshBasicNodeMaterial {
    const S = this.S;
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    const T = attribute('aT', 'vec4');
    const Nn = attribute('aN', 'vec3');
    const K = attribute('aK', 'float');
    const P = vec3(T.x, T.y, T.z);
    const Nr = normalize(Nn);
    // Leuchten: die nächsten drei Reihen links und rechts (wie im Spiel)
    const n = floor(P.z.div(LAMP_EVERY).add(0.5)).mul(LAMP_EVERY);
    let s: N = float(0);
    for (const i of [-1, 0, 1]) {
      for (const lx of [-LAMP_X, LAMP_X]) {
        const d = vec3(lx, LAMP_H, n.add(i * LAMP_EVERY)).sub(P);
        const d2 = dot(d, d).add(0.6);
        const l = d.div(d2.sqrt());
        const cone = clamp(l.y, 0, 1).mul(0.78).add(0.22);
        s = s.add(abs(dot(Nr, l)).mul(cone).div(d2));
      }
    }
    const dp = max(T.w, float(0));
    const dayK = exp(dp.negate().div(clamp(float(1).sub(P.y.div(6)), 0, 1).mul(3).add(8)));
    const light = vec3(0.12, 0.12, 0.13).add(vec3(this.lamp.x, this.lamp.y, this.lamp.z).mul(s)).add(vec3(this.day.x, this.day.y, this.day.z).mul(dayK));
    let base: N = vertexColor().xyz;
    if (kind === 'wall') {
      // Struktur: Putz/Beton (Textur in 3,2-m-Kacheln, verbogen), dazu Wasserfahnen und Kalk im Gewölbe
      const tp = unTile(S.noise.albedo, uv(), 0.3);
      const tx = decodeAlbedo(texture(S.plaster.albedo, tp).rgb).div(meanOf(S.plaster));
      base = base.mul(mix(vec3(1, 1, 1), tx, clamp(K, 0, 1)));
      // senkrechte Fahnen (Sickerwasser): dunkel, unten breiter; Kalkränder heller – nur auf Beton (über dem Sockel)
      const col = floor(P.z.mul(0.9).add(P.x.mul(0.31)));
      const hz = (k: number) => tsl.fract(tsl.sin(col.mul(12.9898).add(k * 78.233)).mul(43758.5453));
      const on = hz(1).greaterThan(0.72);
      const fz = tsl.fract(P.z.mul(0.9).add(P.x.mul(0.31)));
      const w = hz(2).mul(0.25).add(0.12).mul(smoothstep(6.2, 1.0, P.y).mul(0.6).add(0.4));
      const band = smoothstep(w, w.mul(0.3), abs(fz.sub(0.5))).mul(smoothstep(0.4, 1.2, P.y));
      const wet = select(on, band, float(0)).mul(clamp(K, 0, 1));
      base = base.mul(float(1).sub(wet.mul(0.42)));
      // Schmutz unten an den Wänden (Spritzwasser der Reifen)
      base = base.mul(mix(float(0.7), float(1), smoothstep(0.15, 1.1, P.y)));
    } else if (kind === 'road') {
      const rp = unTile(S.noise.albedo, uv(), 0.3);
      const tx = decodeAlbedo(texture(S.asphalt.albedo, rp).rgb).div(meanOf(S.asphalt));
      base = base.mul(tx).mul(vec3(0.075, 0.075, 0.078));
      // Fahrspuren dunkler und glänzend (feucht): Lampen spiegeln sich als helle Flecken darin
      const lane = abs(abs(P.x).sub(1.35));
      const track = smoothstep(0.55, 0.15, lane);
      base = base.mul(float(1).sub(track.mul(0.25)));
      const view = normalize(positionWorld.sub(tsl.cameraPosition));
      void view;
      let gl: N = float(0);
      for (const i of [-1, 0, 1]) {
        const dz = P.z.sub(n.add(i * LAMP_EVERY));
        for (const lx of [-LAMP_X, LAMP_X]) {
          const dx = P.x.sub(lx);
          gl = gl.add(exp(dx.mul(dx).mul(-0.9).sub(dz.mul(dz).mul(0.05))));
        }
      }
      const glint = vec3(this.lamp.x, this.lamp.y, this.lamp.z).mul(gl).mul(track.mul(0.06).add(0.015));
      m.colorNode = select(K.greaterThan(1.5), vertexColor().xyz, base.mul(light).add(glint));
      m.name = 'tunnel-road';
      return m;
    } else {
      m.polygonOffset = true;
      m.polygonOffsetFactor = -2;
      m.polygonOffsetUnits = -2;
    }
    m.colorNode = select(K.greaterThan(1.5), vertexColor().xyz, base.mul(light));
    m.name = kind === 'wall' ? 'tunnel' : 'tunnel-marks';
    void vec2;
    return m;
  }

  private P = (r: TRow, x: number, h: number) => [r.x + r.rx * x, r.y + h, r.z + r.rz * x];

  private row(i: number): TRow {
    const w = this.track.world(i * SEG, 0, 0, { x: 0, y: 0, z: 0, th: 0 });
    return { x: w.x, y: w.y, z: w.z, rx: Math.cos(w.th), rz: Math.sin(w.th), th: w.th };
  }

  /**
   * Streaming: alle Tunnel im Bereich i0 … i1 (halboffen), dazu ihre Portale. null, wenn hier keiner liegt.
   * Ein Tunnel, der vor i0 beginnt, wird ab i0 gebaut (sein Portal liegt dann im vorigen Bereich).
   */
  *buildRange(i0: number, i1: number): Generator<void, THREE.Group | null, void> {
    const t = this.track;
    let any = false;
    for (let i = i0; i < i1; i++) if (t.seg(i).tunnel) { any = true; break; }
    if (!any) return null;
    this.portals = [];
    const wall = new TB(), road = new TB(), marks = new TB();
    wall.base = road.base = marks.base = Math.floor((i0 * SEG) / 60) * 60;
    const signs = new GB(); signs.uv = true;
    const mas = new GB(); mas.uv = true;
    const trim = new GB();
    const lights: number[] = [];
    const out = new THREE.Group();
    let i = i0;
    while (i < i1) {
      while (i < i1 && !t.seg(i).tunnel) i++;
      if (i >= i1) break;
      let j = i;
      while (j < i1 && t.seg(j).tunnel) j++;
      // Lage des ganzen Tunnels (Portalabstand, Länge)
      let a = i;
      while (a > 0 && t.seg(a - 1).tunnel) a--;
      let b = j;
      while (t.seg(b).tunnel) b++;
      const zs = a * SEG, ze = b * SEG, len = ze - zs;
      for (let k = i; k < j; k++) {
        const A = this.row(k), B = this.row(k + 1);
        const za = k * SEG, zb = za + SEG;
        const s = t.seg(k);
        tunnelRing(wall, road, marks, signs, A, B, this.P, { za, zb, dpa: Math.min(za - zs, ze - za), dpb: Math.min(zb - zs, ze - zb), lamp: s.lamp, len });
        // Leuchten: Lichthof unter dem Gehäuse
        if (s.lamp) for (const sg of [-1, 1]) lights.push(...this.P(A, sg * LAMP_X, LAMP_H - 0.02));
        // Entfernungsschild zum Ausgang (alle ~100 m, links)
        if (k % 50 === 25 && Math.min(za - zs, ze - za) > 40 && len > 160) this.distSign(signs, A, za);
      }
      if (i === a) this.portal(out, mas, trim, a, 1, a, b - 1, len);
      if (j === b) this.portal(out, mas, trim, b, -1, a, b - 1, len);
      i = j;
      yield;
    }
    const add = (geo: THREE.BufferGeometry | null, mat: THREE.Material, order = 0) => {
      if (!geo) return;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = order;
      out.add(mesh);
    };
    if (!wall.empty) add(wall.build(), this.mat);
    if (!road.empty) add(road.build(), this.roadMat);
    if (!marks.empty) add(marks.build(), this.marksMat, 1);
    yield;
    if (!signs.empty) add(signs.build(false), this.signMat, 1);
    if (!mas.empty) add(mas.build(), this.masMat);
    if (!trim.empty) add(trim.build(), this.trimMat);
    if (lights.length) { const h = lampHalos(lights, 0.85, 0.5); if (h) out.add(h); }
    return out;
  }

  /** Entfernungsschild an der linken Wand (Atlaszelle „Entfernung“) */
  private distSign(gb: GB, a: TRow, za: number) {
    void za;
    const fx = Math.sin(a.th), fz = -Math.cos(a.th);
    const lat = -(T_WALL - 0.05);
    const at = (h: number, dz: number) => { const q = this.P(a, lat, h); return [q[0] + fx * dz, q[1], q[2] + fz * dz]; };
    const s = 0.36;
    const u0 = TSIGN.dist / 4 + 0.004, u1 = (TSIGN.dist + 1) / 4 - 0.004;
    gb.quad(at(2.95 - s / 2, s / 2), at(2.95 - s / 2, -s / 2), at(2.95 + s / 2, -s / 2), at(2.95 + s / 2, s / 2), [1, 1, 1], [[u0, 0.02], [u1, 0.02], [u1, 0.98], [u0, 0.98]]);
  }

  /** gemauertes Portal an Segment i (dir 1: Einfahrt, −1: Ausfahrt) mit Tafel (Name, Länge) */
  private portal(out: THREE.Group, mas: GB, trim: GB, i: number, dir: 1 | -1, t0: number, t1: number, len: number) {
    const a = this.row(i);
    const { plaque } = portalFacade(mas, trim, a, this.P, dir);
    // Vorplatz: ein Stück vor der Fassade
    this.portals.push(a.x - Math.sin(a.th) * 9 * dir, a.z + Math.cos(a.th) * 9 * dir);
    const t = this.track;
    const name = tunnelName(t.lang, t0 * 7 + t1 * 13 + t.seed);
    const k = this.plaqueSlot(name, `m ${Math.round(len / 2) * 2}`);
    // Platz k: Zeilen von oben (die Leinwand steht im Bild auf dem Kopf: v von unten)
    const v0 = 1 - (k + 1) / 4 + 0.004, v1 = 1 - k / 4 - 0.004;
    const pg = new GB(); pg.uv = true;
    pg.quad(plaque[0], plaque[1], plaque[2], plaque[3], [1, 1, 1], [[0, v0], [1, v0], [1, v1], [0, v1]]);
    const mesh = new THREE.Mesh(pg.build(), this.plaqueMat);
    mesh.matrixAutoUpdate = false;
    out.add(mesh);
  }

  /** Vorwärmen: jedes Material der Tunnel einmal (ein Viereck je Material, weit unten) */
  warm(): THREE.Group {
    const g = new THREE.Group();
    const c = (x: number, h: number) => ({ p: [x, -500 + h, 0], u: 0, v: 0, lat: x, h, z: 0, dp: 0 });
    for (const [mat, k] of [[this.mat, 1], [this.roadMat, 1], [this.marksMat, 0]] as const) {
      const tb = new TB();
      tb.quad(c(0, 0), c(1, 0), c(1, 1), c(0, 1), [1, 1, 1], k);
      g.add(new THREE.Mesh(tb.build(), mat));
    }
    const q = [[0, -500, 0], [1, -500, 0], [1, -499, 0], [0, -499, 0]];
    const uvq = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const gs = new GB(); gs.uv = true; gs.quad(q[0], q[1], q[2], q[3], [1, 1, 1], uvq);
    g.add(new THREE.Mesh(gs.build(false), this.signMat));
    const gm = new GB(); gm.uv = true; gm.quad(q[0], q[1], q[2], q[3], [1, 1, 1], uvq);
    g.add(new THREE.Mesh(gm.build(), this.masMat));
    const gp = new GB(); gp.uv = true; gp.quad(q[0], q[1], q[2], q[3], [1, 1, 1], uvq);
    g.add(new THREE.Mesh(gp.build(), this.plaqueMat));
    const gt = new GB(); gt.quad(q[0], q[1], q[2], q[3], [1, 1, 1]);
    g.add(new THREE.Mesh(gt.build(), this.trimMat));
    return g;
  }

  dispose() {
    for (const m of [this.mat, this.roadMat, this.marksMat, this.signMat, this.masMat, this.trimMat, this.plaqueMat]) m.dispose();
    this.plaqueTex.dispose();
  }
}
