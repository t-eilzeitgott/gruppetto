/**
 * Ortsdurchfahrten für die WebGPU-Welt: die Häuserzeilen der Strecke (Building, links und rechts) als einzelne
 * Häuser wie im Spiel (house3d.ts: eigene Höhe, Wandfarbe, Fensterart, Dachform, Läden mit Schildern und Markisen,
 * Balkone mit Geranien, Fensterbänke, Kamine), dahinter eine zweite und dritte Reihe auf dem Gelände, Kirche mit
 * Campanile, Rathaus mit Fahnen, Palazzi mit Laubengang, Wimpelketten quer über die Gasse, Stadttor. Dazu das
 * Leben auf dem Gehsteig: Laternen, Cafés mit Schirmen, Tischen und Stühlen, Brunnen, Fahnenmasten, Bäume,
 * Blumenkübel, Bänke.
 *
 * Zeichnen: alles eines Abschnitts liegt in wenigen Netzen je 128 m (Fassaden mit Atlas, Ziegel, Einfarbiges,
 * Schilder, Kleinteile) – Kleinteile (Balkone, Blumen, Fensterbänke) nur in der Nähe. Licht wie die übrige Welt
 * (light.ts); nachts leuchten Fenster und Schilder.
 */
import * as THREE from 'three/webgpu';
import { EDGE, SEG, type Building, type Seg, type Sprite, type Track } from '../abfahrt/track';
import { TOWN_ZONE, type Terrain } from '../abfahrt/terrain3d';
import type { TreeSpot } from '../abfahrt/terrain3d';
import { buildHouse, hash, rowUnits, roofColor, roofKind, wallSet, type At, type Town } from '../abfahrt/house3d';
import { FAC_M, STYLE, STYLE_PITCH, STYLE_ROOF, STYLE_WALL, TINTABLE, WALL_PAL, badgeUV, facU, facV, facadeAtlas, roofTex, signAtlas, signUV, type FacPart } from '../abfahrt/facade';
import { flatNormals, GB, lin, type RGBf } from '../abfahrt/models3d';
import { MOOD_U } from './mood';
import { lit } from './light';
import { tsl, type N } from './nodes';
import { lampHalos } from './lamps';

const { floor, frontFacing, normalize, normalWorldGeometry, select, texture, uniformArray, uv, vertexColor, clamp, int } = tsl;

type TRegion = ReturnType<Terrain['region']>;
interface Row { x: number; y: number; z: number; rx: number; rz: number; th: number; seg: Seg }

const shadeF = (c: RGBf, f: number): RGBf => [c[0] * f, c[1] * f, c[2] * f];
/** Zeichenstücke je 64 Segmente (128 m): Kamera- und Schattenausschnitt schneiden gröber, aber Aufrufe bleiben wenige */
const CHUNK = 64;
/** Kleinteile nur bis hier (m vom Rand ihres Stücks) */
const DETAIL_FAR = 150;

/** Materialien der Orte (einmal für die ganze Welt) */
export interface TownMats { facade: THREE.Material; tiles: THREE.Material; plain: THREE.Material; signs: THREE.Material }

/** günstiges Licht (light.ts: Sonne × vorberechnetes Sonnenlicht, Himmel), beidseitig richtig (Rückseiten: Normale gewendet) */
function lambert(col: N, opts: { side?: THREE.Side; emissive?: N } = {}): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ side: opts.side ?? THREE.FrontSide });
  const n0 = normalize(normalWorldGeometry);
  const n = opts.side === THREE.DoubleSide ? select(frontFacing, n0, n0.negate()) : n0;
  m.colorNode = lit({ col, nWorld: n, extra: opts.emissive });
  return m;
}

export function townMaterials(): TownMats {
  const fa = facadeAtlas();
  const fac = new THREE.DataTexture(fa.data, fa.w, fa.h, THREE.RGBAFormat);
  fac.colorSpace = THREE.SRGBColorSpace;
  fac.wrapS = THREE.RepeatWrapping;
  fac.magFilter = THREE.LinearFilter;
  fac.minFilter = THREE.LinearMipmapLinearFilter;
  fac.generateMipmaps = true;
  fac.anisotropy = 4;
  fac.needsUpdate = true;
  const lit = new THREE.CanvasTexture(fa.night);
  lit.colorSpace = THREE.SRGBColorSpace;
  lit.wrapS = THREE.RepeatWrapping;
  // abends: Fenster und Leuchtschilder an (Lichter der Stimmung)
  const night = MOOD_U.lights as unknown as N;
  // Wandfarbe je Haus: ganzzahliger Anteil von u (Index in WALL_PAL), Maske im Alpha des Atlas
  const pal = uniformArray(WALL_PAL.map((h) => new THREE.Color(h)), 'color');
  const p = uv();
  const t = texture(fac, p);
  const wi = clamp(int(floor(p.x)), int(0), int(WALL_PAL.length - 1));
  const col: N = vertexColor().xyz.mul(t.rgb.add(t.a.mul(pal.element(wi))));
  const facade = lambert(col, { emissive: texture(lit, p).rgb.mul(night.mul(1.25)) });
  facade.name = 'town-facade';
  const rt = new THREE.CanvasTexture(roofTex());
  rt.colorSpace = THREE.SRGBColorSpace;
  rt.wrapS = rt.wrapT = THREE.RepeatWrapping;
  rt.anisotropy = 4;
  const tiles = lambert(vertexColor().xyz.mul(texture(rt, uv()).rgb), { side: THREE.DoubleSide });
  tiles.name = 'town-tiles';
  const plain = lambert(vertexColor().xyz, { side: THREE.DoubleSide });
  plain.name = 'town-plain';
  const st = new THREE.CanvasTexture(signAtlas());
  st.colorSpace = THREE.SRGBColorSpace;
  st.anisotropy = 4;
  const sc = texture(st, uv()).rgb;
  const signs = lambert(sc, { emissive: sc.mul(night.mul(0.75)) });
  signs.name = 'town-signs';
  return { facade, tiles, plain, signs };
}

/** Ein Zeichenstück: Sammler wie im Spiel */
function newTown(): Town {
  const facade = new GB(); facade.uv = true;
  const tiles = new GB(); tiles.uv = true;
  const signs = new GB(); signs.uv = true;
  return { facade, tiles, plain: new GB(), signs, lanterns: [], bulbs: [], detail: new GB(), occ: [] };
}

/**
 * Sammler → Geometrie in Schritten (wie GB.build, aber zwischen Kopieren, Normalen und Hülle wird abgegeben – ein
 * Ortsstück hat bis 45 000 Ecken, am Stück gut 5 ms). Hülle aus dem Quader der Ecken (ein Durchlauf statt drei).
 */
function* buildGeo(gb: GB): Generator<void, THREE.BufferGeometry, void> {
  const p = gb.p.take();
  const c = gb.c.take();
  const u = gb.uv ? gb.u.take() : null;
  yield;
  const n = flatNormals(p);
  yield;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (u) geo.setAttribute('uv', new THREE.BufferAttribute(u, 2));
  geo.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2);
  return geo;
}

export interface TownPiece {
  group: THREE.Group; details: { mesh: THREE.Mesh; c: THREE.Vector3; r: number }[];
  /** Grundrisse (x, z, Radius) und Lampen (x, y, z) des Abschnitts – für die Bodenkarte (Schatten, Lichtkegel) */
  occ: number[]; lights: number[];
}

export interface TownCtx {
  track: Track;
  terrain: Terrain;
  /** Höhe des Straßenrands (über der Fahrbahn) in Abstand dx von der Bankettkante, null jenseits des Profils */
  ground: (s: Seg, sg: number, dx: number) => number | null;
  /** Bäume im Ort (Gehsteig, Lücken zwischen den Häusern) */
  trees: (list: TreeSpot[]) => void;
  /** Tafel mit Schrift (Arches.plate) */
  plate: (group: THREE.Group, i: number, x: number, h: number, text: string, sub: string, w?: number, posts?: boolean) => void;
}

export class Towns {
  readonly mats: TownMats;
  /** Grundrisse aller gebauten Häuser (x, z, Radius) – Bauernhöfe und Tiere halten Abstand */
  readonly occ: number[] = [];
  private pieces = new Map<number, TownPiece>();
  private w = { x: 0, y: 0, z: 0, th: 0 };
  private w2 = { x: 0, y: 0, z: 0, th: 0 };
  private region: TRegion | null = null;
  phase = '';

  constructor(private c: TownCtx) {
    this.mats = townMaterials();
  }

  private row(i: number): Row {
    const t = this.c.track;
    const w = t.world(i * SEG, 0, 0, { x: 0, y: 0, z: 0, th: 0 });
    return { x: w.x, y: w.y, z: w.z, rx: Math.cos(w.th), rz: Math.sin(w.th), th: w.th, seg: t.seg(i) };
  }

  /** gibt es im Bereich überhaupt etwas zu bauen? */
  has(i0: number, i1: number): boolean {
    const t = this.c.track;
    for (let i = i0; i < i1; i++) {
      const s = t.seg(i);
      if (s.bL || s.bR || s.banner?.kind === 'gate') return true;
      if (s.sprites?.some((sp) => TOWN_PROPS.has(sp.k))) return true;
    }
    return false;
  }

  /**
   * Abschnitt bauen (Streaming, in Schritten): Häuser, Gassen-Schmuck, Gehsteig-Leben → Gruppe (oder null).
   * key: Abschnitt (für dispose)
   */
  *buildRange(key: number, i0: number, i1: number, late: () => boolean): Generator<void, THREE.Group | null, void> {
    if (!this.has(i0, i1)) return null;
    const t = this.c.track;
    const a0 = t.world(i0 * SEG, 0, 0, this.w);
    const ax0 = a0.x, az0 = a0.z;
    const a1 = t.world(i1 * SEG, 0, 0, this.w);
    this.phase = 'gebiet';
    this.region = this.c.terrain.region(Math.min(ax0, a1.x) - 160, Math.min(az0, a1.z) - 160, Math.max(ax0, a1.x) + 160, Math.max(az0, a1.z) + 160);
    yield;
    const group = new THREE.Group();
    const piece: TownPiece = { group, details: [], occ: [], lights: [] };
    const treeSpots: TreeSpot[] = [];
    for (let c0 = i0; c0 < i1; c0 += CHUNK) {
      const T = newTown();
      const c1 = Math.min(i1, c0 + CHUNK);
      for (let i = c0; i < c1; i++) {
        const s = t.seg(i);
        const a = this.row(i);
        for (const sg of [-1, 1]) {
          const bld = sg < 0 ? s.bL : s.bR;
          if (bld && bld.start === i) {
            this.phase = 'haeuser';
            if (late()) yield;
            yield* this.building(T, a, bld, sg, this.c.terrain.lim(i)[sg < 0 ? 0 : 1], late);
          }
        }
        if (s.bL && s.bR && s.i % 17 === 9 && !s.banner) this.garland(T, a, s.bL, s.bR);
        if (s.banner?.kind === 'gate') { this.phase = 'tor'; this.gate(T, a, group, s.banner.text); }
        if (s.sprites) {
          for (const sp of s.sprites) {
            if (!TOWN_PROPS.has(sp.k)) continue;
            this.phase = 'gehsteig';
            this.prop(T, group, a, sp, s, treeSpots);
          }
        }
        if (late()) yield;
      }
      this.phase = 'netze';
      yield;
      yield* this.meshes(T, group, piece);
      for (let k = 0; k < T.occ.length; k++) { this.occ.push(T.occ[k]); piece.occ.push(T.occ[k]); }
      for (let k = 0; k < T.lanterns.length; k++) piece.lights.push(T.lanterns[k]);
      yield;
    }
    // Lampen glimmen (abends)
    const halos = lampHalos(piece.lights);
    if (halos) group.add(halos);
    if (treeSpots.length) this.c.trees(treeSpots);
    group.traverse((o) => { o.matrixAutoUpdate = false; });
    group.updateMatrixWorld(true);
    this.pieces.set(key, piece);
    return group.children.length ? group : null;
  }

  /** Sammler eines Stücks → Netze (je Netz ein Schritt: große Sammler brauchen ein paar Millisekunden) */
  private *meshes(T: Town, group: THREE.Group, piece: TownPiece): Generator<void, void, void> {
    const M = this.mats;
    const add = function* (gb: GB, m: THREE.Material, cast: boolean): Generator<void, THREE.Mesh | null, void> {
      if (gb.empty) return null;
      const geo = yield* buildGeo(gb);
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      group.add(mesh);
      yield;
      return mesh;
    };
    yield* add(T.facade, M.facade, true);
    yield* add(T.tiles, M.tiles, true);
    yield* add(T.plain, M.plain, true);
    yield* add(T.signs, M.signs, false);
    const d = yield* add(T.detail, M.plain, true);
    if (d) {
      const bs = d.geometry.boundingSphere!;
      piece.details.push({ mesh: d, c: bs.center.clone(), r: bs.radius });
    }
  }

  /** Schatten der Ortshäuser und Lichtkegel der Lampen für die Bodenkarte (sunmap.ts) */
  splats(x0: number, z0: number, x1: number, z1: number, shadow: (x: number, z: number, h: number, r: number, kind: number) => void, light: (x: number, z: number, r: number, k: number) => void) {
    for (const p of this.pieces.values()) {
      for (let o = 0; o < p.occ.length; o += 3) {
        const x = p.occ[o], z = p.occ[o + 1];
        if (x >= x0 && x <= x1 && z >= z0 && z <= z1) shadow(x, z, 12, p.occ[o + 2] * 0.85, 1);
      }
      for (let o = 0; o < p.lights.length; o += 3) {
        const x = p.lights[o], z = p.lights[o + 2];
        if (x >= x0 && x <= x1 && z >= z0 && z <= z1) light(x, z, p.lights[o + 1] > 0 ? 7 : 7, 0.9);
      }
    }
  }

  /** Mittelpunkte der Ortshäuser (Pflanzen und Tiere halten Abstand) */
  centers(): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    for (let o = 0; o < this.occ.length; o += 3) out.push({ x: this.occ[o], z: this.occ[o + 1] });
    return out;
  }

  /** je Bild: Kleinteile nur in der Nähe */
  update(cam: THREE.Vector3) {
    for (const p of this.pieces.values()) {
      for (const d of p.details) d.mesh.visible = cam.distanceTo(d.c) - d.r < DETAIL_FAR;
    }
  }

  /** Streaming: Abschnitt weg (Gruppe hängt am Abschnitt der Welt und wird dort entsorgt) */
  drop(key: number) {
    this.pieces.delete(key);
  }

  /** Vorwärmen: je Material ein Dreieck (die Shader übersetzen beim Laden) */
  warm(): THREE.Group {
    const g = new THREE.Group();
    const T = newTown();
    const q = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
    T.facade.quad(q[0], q[1], q[2], q[3], [1, 1, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    T.tiles.quad(q[0], q[1], q[2], q[3], [1, 1, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    T.plain.quad(q[0], q[1], q[2], q[3], [1, 1, 1]);
    T.signs.quad(q[0], q[1], q[2], q[3], [1, 1, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    T.detail.quad(q[0], q[1], q[2], q[3], [1, 1, 1]);
    const it = this.meshes(T, g, { group: g, details: [], occ: [], lights: [] });
    while (!it.next().done) { /* am Stück */ }
    return g;
  }

  // ------------------------------------------------------------------ Häuser (wie render3d.ts)

  private heightIn(x: number, z: number): number { return this.c.terrain.heightIn(this.region!, x, z); }
  private roadDist(x: number, z: number): number { return this.c.terrain.roadDist(this.region!, x, z); }

  /**
   * Häuserzeile an der Straße: einzelne Häuser (house3d.ts) mit eigener Höhe, Farbe und Dach, dahinter je nach
   * Ort eine zweite und dritte Reihe auf dem Gelände. Kirche, Rathaus und Palazzi an der Piazza: specialBuilding.
   */
  private *building(T: Town, a: Row, b: Building, sg: number, lim: number, late: () => boolean): Generator<void, void, void> {
    if (b.style === STYLE.kirche || b.style === STYLE.rathaus || b.arcade) { this.specialBuilding(T, a, b, sg); return; }
    const t = this.c.track;
    const z0 = a.seg.i * SEG;
    const e = t.world(z0 + b.len * SEG, 0, 0, this.w2);
    let fx = e.x - a.x;
    let fz = e.z - a.z;
    const L = Math.hypot(fx, fz) || b.len * SEG;
    fx /= L;
    fz /= L;
    const rx = -fz;
    const rz = fx;
    const base = Math.max(a.y, e.y);
    const ax = a.x;
    const az = a.z;
    const at: At = (lat, along, h) => [ax + rx * lat + fx * along, base + h, az + rz * lat + fz * along];
    const lang = t.lang;
    const region = t.region;
    const pal = wallSet(region, lang);
    const units = rowUnits(L, b.style, b.floors, b.seed, pal);
    const village = t.sections[a.seg.sec].biome === 'village';
    const shopUnit = b.sign >= 0 ? Math.max(0, units.findIndex((u) => u.s1 - u.s0 >= 3.99)) : -1;
    const lanternUnit = hash(b.seed + 5) < 0.8 ? Math.floor(hash(b.seed + 6) * units.length) : -1;
    for (let i = 0; i < units.length; i++) {
      if (i > 0 && late()) yield;
      const u = units[i];
      const seed = b.seed + (i + 1) * 7717;
      const free = units.length === 1;
      const depth = b.depth * (0.88 + hash(seed + 5) * 0.24);
      buildHouse(T, at, {
        s0: u.s0, s1: u.s1, setback: b.setback + u.dz, depth, sg, style: u.style, floors: u.floors, seed, tint: u.tint,
        roof: roofKind(u.style, region, lang, free, hash(seed + 3)), roofCol: roofColor(u.style, region, lang, hash(seed + 7)),
        foot: -3.2, ovA: i === 0, ovB: i === units.length - 1, street: true,
        shop: i === shopUnit ? { sign: b.sign, badge: b.badge } : null, lantern: i === lanternUnit,
        annex: hash(seed + 11) < (village ? 0.22 : 0.5),
      }, lang);
      const c = at(sg * (b.setback + depth / 2), (u.s0 + u.s1) / 2, 0);
      T.occ.push(c[0], c[2], 0.45 * Math.hypot(u.s1 - u.s0, depth));
    }
    yield* this.backRows(T, a, b, sg, at, L, base, lim, village, late);
  }

  /** Hinterhäuser: hinter der Straßenzeile eine zweite (im Ort oft auch eine dritte) Reihe auf dem Gelände */
  private *backRows(T: Town, a: Row, b: Building, sg: number, at: At, L: number, base: number, lim: number, village: boolean, late: () => boolean): Generator<void, void, void> {
    const t = this.c.track;
    const side = sg < 0 ? a.seg.L : a.seg.R;
    if (side.ground !== 'pavement') return;
    const ground = (lat: number, along: number): number => {
      const p = at(lat, along, 0);
      const dx = Math.abs(lat) - EDGE;
      if (dx < lim - 0.5) {
        const gh = this.c.ground(a.seg, sg, dx);
        if (gh !== null) return a.y + gh;
      }
      return this.heightIn(p[0], p[2]);
    };
    const h = (k: number) => hash(b.seed * 17 + k * 6151);
    const rows = village ? (h(1) < 0.6 ? 2 : 1) : h(1) < 0.55 ? 1 : 0;
    const lang = t.lang;
    const region = t.region;
    const pal = wallSet(region, lang);
    const alpineFront = b.style === STYLE.chalet || b.style === STYLE.bruchstein;
    const pool = alpineFront ? [STYLE.chalet, STYLE.chalet, STYLE.bruchstein, STYLE.creme] : lang === 'en' ? [STYLE.backstein, STYLE.backstein, STYLE.creme, STYLE.fachwerk] : [STYLE.ocker, STYLE.lachs, STYLE.creme, STYLE.gelb, STYLE.terrakotta, b.style];
    let lat0 = b.setback + b.depth;
    for (let row = 0; row < rows; row++) {
      const s2 = lat0 + 2.6 + h(row * 7 + 2) * 2.8;
      let deepest = 0;
      let x = -1.5 + h(row * 7 + 3) * 2.5;
      let k = 0;
      while (x < L - 3 && k < 4) {
        const q = row * 50 + k * 7;
        k++;
        const w = 5.5 + h(q + 4) * 4;
        const d = 6.5 + h(q + 5) * 3.5;
        const x1 = Math.min(L + 2, x + w);
        const xs = x;
        x = x1 + 1.2 + h(q + 6) * 3.5;
        if (x1 - xs < 4.5 || s2 + d > TOWN_ZONE - 2) continue;
        if (late()) yield;
        let yMax = -Infinity;
        let yMin = Infinity;
        let blocked = false;
        for (const [qq, xx] of [[s2, xs], [s2, x1], [s2 + d, xs], [s2 + d, x1], [s2 + d / 2, (xs + x1) / 2]]) {
          const lat = sg * qq;
          const y = ground(lat, xx);
          yMax = Math.max(yMax, y);
          yMin = Math.min(yMin, y);
          const p = at(lat, xx, 0);
          if (this.roadDist(p[0], p[2]) < EDGE + 3.5) blocked = true;
        }
        if (blocked || yMax - yMin > 5.5) continue;
        const c = at(sg * (s2 + d / 2), (xs + x1) / 2, 0);
        const rad = 0.45 * Math.hypot(x1 - xs, d);
        let hit = false;
        for (let o = 0; o < T.occ.length && !hit; o += 3) {
          if (Math.hypot(T.occ[o] - c[0], T.occ[o + 1] - c[2]) < T.occ[o + 2] + rad) hit = true;
        }
        for (let o = 0; o < this.occ.length && !hit; o += 3) {
          if (Math.hypot(this.occ[o] - c[0], this.occ[o + 1] - c[2]) < this.occ[o + 2] + rad) hit = true;
        }
        if (hit) continue;
        T.occ.push(c[0], c[2], rad);
        deepest = Math.max(deepest, d);
        const style = pool[Math.floor(h(q + 7) * pool.length)];
        const floors = Math.max(1, Math.min(village ? 3 : 2, Math.round((village ? 1.2 : 0.8) + h(q + 8) * 1.9) - row));
        const seed = Math.floor(h(q + 9) * 1e9);
        const tint = pal[Math.floor(h(q + 10) * pal.length)];
        const base2 = yMax + 0.05;
        const at2: At = (lat, along, y) => at(lat, along, y + base2 - base);
        buildHouse(T, at2, {
          s0: xs, s1: x1, setback: s2, depth: d, sg, style, floors, seed, tint,
          roof: roofKind(style, region, lang, true, h(q + 11)), roofCol: roofColor(style, region, lang, h(q + 12)),
          foot: Math.max(-12, yMin - base2 - 0.6), ovA: true, ovB: true, street: true, back: true,
          annex: h(q + 13) < 0.3,
        }, lang);
      }
      if (!deepest) break;
      lat0 = s2 + deepest;
    }
  }

  /** Kirche, Rathaus und Palazzi mit Laubengang (eine Einheit, eigene Teile) – wie render3d.ts */
  private specialBuilding(T: Town, a: Row, b: Building, sg: number) {
    const t = this.c.track;
    const z0 = a.seg.i * SEG;
    const e = t.world(z0 + b.len * SEG, 0, 0, this.w2);
    let fx = e.x - a.x;
    let fz = e.z - a.z;
    const L = Math.hypot(fx, fz) || b.len * SEG;
    fx /= L;
    fz /= L;
    const rx = -fz;
    const rz = fx;
    const base = Math.max(a.y, e.y);
    const at = (lat: number, along: number, h: number) => [a.x + rx * lat + fx * along, base + h, a.z + rz * lat + fz * along];
    const st = b.style;
    const church = st === STYLE.kirche;
    const n = b.floors;
    const GH = FAC_M.ground;
    const UH = FAC_M.upper;
    const H = GH + n * UH + FAC_M.cornice;
    const depth = b.depth;
    const l0 = sg * b.setback;
    const l1 = sg * (b.setback + depth);
    const lo = Math.min(l0, l1);
    const hi = Math.max(l0, l1);
    const hs = (k: number) => hash(b.seed + k * 7919);
    const pieces = (len: number) => Math.max(1, Math.ceil(len / 4 - 0.01));
    const frontPieces = pieces(L);
    const signPiece = frontPieces >= 3 ? 1 : 0;
    const signOk = b.sign >= 0 && L - signPiece * 4 >= 3.99;
    const pal = wallSet(t.region, t.lang);
    const tOff = TINTABLE[st] ? pal[Math.floor(hs(29) * pal.length)] : 0;
    const wallHex = TINTABLE[st] ? WALL_PAL[tOff] : STYLE_WALL[st];
    const wTint = 0.9 + hs(31) * 0.14;
    const warm = (hs(37) - 0.5) * 0.1;
    const ageC = (h: number, k: number): RGBf => {
      let f = h < 0 ? 0.62 : h < 1.4 ? 0.78 + 0.22 * (h / 1.4) : 1;
      if (h > H - 0.9) f *= 0.86;
      f *= wTint * (0.95 + hash(b.seed * 13 + k * 7) * 0.08);
      return [f * (1 + warm), f, f * (1 - warm * 1.2)];
    };
    const wall = (A: [number, number], B: [number, number], variant: (k: number, upper: boolean) => number, onPiece?: (k: number, s0: number, s1: number) => void) => {
      const Lw = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const np = pieces(Lw);
      for (let k = 0; k < np; k++) {
        const s0 = k * 4;
        const s1 = Math.min(Lw, s0 + 4);
        const p0 = [A[0] + (B[0] - A[0]) * (s0 / Lw), A[1] + (B[1] - A[1]) * (s0 / Lw)];
        const p1 = [A[0] + (B[0] - A[0]) * (s1 / Lw), A[1] + (B[1] - A[1]) * (s1 / Lw)];
        const strip = (h0: number, h1: number, part: FacPart, v: number) => {
          const [vb, vt] = facV(st, part);
          const u0 = facU(v, 0) + tOff;
          const u1 = facU(v, s1 - s0) + tOff;
          const c0 = ageC(h0, k);
          const c1 = ageC(h1, k);
          T.facade.quadC(at(p0[0], p0[1], h0), at(p1[0], p1[1], h0), at(p1[0], p1[1], h1), at(p0[0], p0[1], h1), c0, c0, c1, c1, [[u0, vb], [u1, vb], [u1, vt], [u0, vt]]);
        };
        const vg = variant(k, false);
        const vu = variant(k, true);
        strip(-3.2, 0, 'base', vg);
        strip(0, GH, 'ground', vg);
        for (let f = 0; f < n; f++) strip(GH + f * UH, GH + (f + 1) * UH, 'upper', vu);
        strip(H - FAC_M.cornice, H, 'cornice', vu);
        onPiece?.(k, s0, s1);
      }
    };
    const frontVar = (k: number, upper: boolean) => {
      if (upper) return hs(k + 40) < 0.5 ? 1 : 0;
      if (church) return k === Math.floor(frontPieces / 2) ? 0 : 1;
      if (signOk && k === signPiece) return 1;
      return hs(k) < (b.sign >= 0 ? 0.25 : 0.18) ? 1 : 0;
    };
    const sideVar = (k: number, upper: boolean) => (upper ? (hs(k + 90) < 0.3 ? 1 : 0) : 0);
    const out = -sg;
    const frontA: [number, number] = sg < 0 ? [l0, 0] : [l0, L];
    const frontB: [number, number] = sg < 0 ? [l0, L] : [l0, 0];
    wall(frontA, frontB, frontVar, (k, s0) => {
      if (!(signOk && k === signPiece)) return;
      const [u0, v0, u1, v1] = signUV(t.lang, b.sign);
      const along = (s: number) => (sg < 0 ? s : L - s);
      const la = l0 + out * 0.05;
      const a0 = along(s0 + 0.22);
      const a1 = along(s0 + 3.78);
      T.signs.quad(at(la, a0, GH - 0.37), at(la, a1, GH - 0.37), at(la, a1, GH - 0.01), at(la, a0, GH - 0.01), [1, 1, 1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      if (b.badge >= 0) {
        const [bu0, bv0, bu1, bv1] = badgeUV(b.badge);
        const ab = along(s0 + 0.12);
        const q0 = l0 + out * 0.2;
        const q1 = l0 + out * 0.85;
        const h0 = GH + 0.35;
        const h1 = h0 + 0.65;
        const [na, nb] = out > 0 ? [q0, q1] : [q1, q0];
        T.signs.quad(at(na, ab - 0.01, h0), at(nb, ab - 0.01, h0), at(nb, ab - 0.01, h1), at(na, ab - 0.01, h1), [1, 1, 1], [[bu0, bv0], [bu1, bv0], [bu1, bv1], [bu0, bv1]]);
        T.signs.quad(at(nb, ab + 0.01, h0), at(na, ab + 0.01, h0), at(na, ab + 0.01, h1), at(nb, ab + 0.01, h1), [1, 1, 1], [[bu0, bv0], [bu1, bv0], [bu1, bv1], [bu0, bv1]]);
        T.plain.quad(at(l0, ab, h1 + 0.02), at(q1, ab, h1 + 0.02), at(q1, ab, h1 + 0.07), at(l0, ab, h1 + 0.07), lin('#2a2a2c'));
      }
    });
    wall([lo, 0], [hi, 0], sideVar);
    wall([hi, L], [lo, L], sideVar);
    wall(sg < 0 ? [l1, L] : [l1, 0], sg < 0 ? [l1, 0] : [l1, L], sideVar);

    // Dach
    const pitch = STYLE_PITCH[st];
    const chalet = st === STYLE.chalet;
    const ovE = chalet ? 1.1 : 0.42;
    const ovG = chalet ? 0.75 : 0.28;
    const half = depth / 2;
    const rh = H + pitch * half;
    const lm = (l0 + l1) / 2;
    const ee = H - pitch * ovE;
    const eF = l0 - sg * ovE;
    const eB = l1 + sg * ovE;
    const roofCol = shadeF(lin(STYLE_ROOF[st]), 0.9 + hs(3) * 0.18);
    const slopeLen = Math.hypot(half + ovE, rh - ee);
    const g0 = -ovG;
    const g1 = L + ovG;
    const tileQuad = (eave: number) => T.tiles.quad(at(eave, g0, ee), at(eave, g1, ee), at(lm, g1, rh), at(lm, g0, rh), roofCol,
      [[g0 / 2, 0], [g1 / 2, 0], [g1 / 2, slopeLen / 2], [g0 / 2, slopeLen / 2]]);
    tileQuad(eF);
    tileQuad(eB);
    const board = lin(chalet ? '#3e2716' : st === STYLE.backstein || st === STYLE.haussmann ? '#d9d4ca' : '#4a3628');
    const bh = chalet ? 0.3 : 0.18;
    for (const ev of [eF, eB]) T.plain.quad(at(ev, g0, ee - bh), at(ev, g1, ee - bh), at(ev, g1, ee), at(ev, g0, ee), board);
    for (const al of [g0, g1]) for (const ev of [eF, eB]) T.plain.quad(at(ev, al, ee - bh), at(lm, al, rh - bh), at(lm, al, rh), at(ev, al, ee), board);
    T.plain.quad(at(lm - 0.12, g0, rh + 0.02), at(lm - 0.12, g1, rh + 0.02), at(lm + 0.12, g1, rh + 0.02), at(lm + 0.12, g0, rh + 0.02), shadeF(roofCol, 0.75));
    const gable = chalet ? lin('#7a4e2c') : shadeF(lin(wallHex), 0.94);
    T.plain.tri(at(l0, 0, H), at(lm, 0, rh), at(l1, 0, H), gable);
    T.plain.tri(at(l1, L, H), at(lm, L, rh), at(l0, L, H), gable);
    const soffit = lin(chalet ? '#3a2414' : '#3e342c');
    T.plain.quad(at(l0, g0, H - 0.02), at(eF, g0, ee - bh), at(eF, g1, ee - bh), at(l0, g1, H - 0.02), soffit);
    T.plain.quad(at(l1, g0, H - 0.02), at(eB, g0, ee - bh), at(eB, g1, ee - bh), at(l1, g1, H - 0.02), soffit);

    // Laubengang vor dem Erdgeschoss
    if (b.arcade) {
      const AD = 3.0;
      const AH = GH - 0.25;
      const pil = lin('#d8cfbd');
      const pilD = shadeF(pil, 0.82);
      const soff = lin('#b9ae99');
      const dark = lin('#3a3028');
      const lp = l0 + out * AD;
      const np = Math.max(1, Math.round(L / 3.6));
      const step = L / np;
      const PW = 0.55;
      for (let k = 0; k <= np; k++) {
        const cc = Math.min(L - PW / 2, Math.max(PW / 2, k * step));
        const s0 = cc - PW / 2;
        const s1 = cc + PW / 2;
        T.plain.quad(at(lp, s0, -0.5), at(lp, s1, -0.5), at(lp, s1, AH), at(lp, s0, AH), pil);
        T.plain.quad(at(lp - out * PW, s1, -0.5), at(lp - out * PW, s0, -0.5), at(lp - out * PW, s0, AH), at(lp - out * PW, s1, AH), pilD);
        T.plain.quad(at(lp - out * PW, s0, -0.5), at(lp, s0, -0.5), at(lp, s0, AH), at(lp - out * PW, s0, AH), pilD);
        T.plain.quad(at(lp, s1, -0.5), at(lp - out * PW, s1, -0.5), at(lp - out * PW, s1, AH), at(lp, s1, AH), pilD);
        T.plain.quad(at(lp + out * 0.1, s0 - 0.1, AH - 0.3), at(lp + out * 0.1, s1 + 0.1, AH - 0.3), at(lp + out * 0.1, s1 + 0.1, AH), at(lp + out * 0.1, s0 - 0.1, AH), shadeF(pil, 0.92));
      }
      for (let k = 0; k < np; k++) {
        const s0 = Math.min(L, k * step + PW / 2);
        const s1 = Math.min(L, (k + 1) * step - PW / 2);
        const w = s1 - s0;
        if (w < 0.6) continue;
        const cx = (s0 + s1) / 2;
        const R = w / 2;
        const bb = AH - R * 0.95;
        const la = lp + out * 0.02;
        T.plain.quad(at(la, s0, bb), at(la, s1, bb), at(la, s1, GH + 0.2), at(la, s0, GH + 0.2), pil);
        const NN = 8;
        for (let q = 0; q < NN; q++) {
          const q0 = Math.PI * (q / NN);
          const q1 = Math.PI * ((q + 1) / NN);
          const p0 = at(la + out * 0.01, cx - Math.cos(q0) * R, bb + Math.sin(q0) * R * 0.95);
          const p1 = at(la + out * 0.01, cx - Math.cos(q1) * R, bb + Math.sin(q1) * R * 0.95);
          const pc = at(la + out * 0.01, cx, bb);
          if (sg < 0) T.plain.tri(pc, p0, p1, dark); else T.plain.tri(pc, p1, p0, dark);
        }
        T.plain.quad(at(la + out * 0.01, s0, -0.5), at(la + out * 0.01, s1, -0.5), at(la + out * 0.01, s1, bb), at(la + out * 0.01, s0, bb), dark);
      }
      T.plain.quad(at(l0, 0, GH + 0.2), at(l0, L, GH + 0.2), at(lp + out * 0.15, L, GH + 0.2), at(lp + out * 0.15, 0, GH + 0.2), shadeF(pil, 0.96));
      T.plain.quad(at(lp + out * 0.15, 0, GH + 0.2), at(lp + out * 0.15, L, GH + 0.2), at(lp + out * 0.15, L, GH + 1.1), at(lp + out * 0.15, 0, GH + 1.1), pil);
      T.plain.quad(at(lp + out * 0.15, 0, GH + 1.1), at(lp + out * 0.15, L, GH + 1.1), at(lp - out * 0.1, L, GH + 1.1), at(lp - out * 0.1, 0, GH + 1.1), shadeF(pil, 0.9));
      T.plain.quad(at(lp, 0, GH - 0.05), at(lp, L, GH - 0.05), at(l0, L, GH - 0.05), at(l0, 0, GH - 0.05), soff);
    }

    // Kirchturm mit Uhr und Schallarkaden
    if (church) {
      const tw = b.tall ? 5.2 : 4.4;
      const t0 = l0 + out * 0.6;
      const t1 = t0 - out * tw;
      const TH = b.tall ? 34 : 23;
      const stone = lin('#d6ccb8');
      const [ta, tb] = out > 0 ? [t1, t0] : [t0, t1];
      T.plain.quad(at(ta, -0.6, -2), at(tb, -0.6, -2), at(tb, -0.6, TH), at(ta, -0.6, TH), stone);
      T.plain.quad(at(tb, -0.6 + tw, -2), at(ta, -0.6 + tw, -2), at(ta, -0.6 + tw, TH), at(tb, -0.6 + tw, TH), stone);
      T.plain.quad(at(t0, -0.6 + tw, -2), at(t0, -0.6, -2), at(t0, -0.6, TH), at(t0, -0.6 + tw, TH), shadeF(stone, 0.95));
      T.plain.quad(at(t1, -0.6, -2), at(t1, -0.6 + tw, -2), at(t1, -0.6 + tw, TH), at(t1, -0.6, TH), shadeF(stone, 0.9));
      for (const hh of b.tall ? [7.5, 15.5, 24.5] : [7.5, 15.5]) {
        const band = lin('#bfb39c');
        T.plain.quad(at(t0 + out * 0.08, -0.68, hh), at(t0 + out * 0.08, -0.6 + tw + 0.08, hh), at(t0 + out * 0.08, -0.6 + tw + 0.08, hh + 0.35), at(t0 + out * 0.08, -0.68, hh + 0.35), band);
        T.plain.quad(at(ta, -0.68, hh), at(tb, -0.68, hh), at(tb, -0.68, hh + 0.35), at(ta, -0.68, hh + 0.35), band);
      }
      const dark = lin('#2a2420');
      const mid = -0.6 + tw / 2;
      const cm = (ta + tb) / 2;
      for (const [o0, o1] of b.tall ? [[17.2, 20.4], [26.2, 30.4]] : [[17.2, 20.4]]) {
        for (const [w0, w1] of [[mid - 1.3, mid - 0.25], [mid + 0.25, mid + 1.3]]) {
          T.plain.quad(at(t0 + out * 0.02, w1, o0), at(t0 + out * 0.02, w0, o0), at(t0 + out * 0.02, w0, o1), at(t0 + out * 0.02, w1, o1), dark);
        }
        for (const [w0, w1] of [[cm - 1.3, cm - 0.25], [cm + 0.25, cm + 1.3]]) T.plain.quad(at(w0, -0.62, o0), at(w1, -0.62, o0), at(w1, -0.62, o1), at(w0, -0.62, o1), dark);
      }
      const clock = (cx: number, ca: number, nx: number, na: number) => {
        const R = 0.95;
        const ctr = [cx, ca, 12.6];
        const pt = (ang: number, rad: number) => {
          const u = Math.cos(ang) * rad;
          const v = Math.sin(ang) * rad;
          return at(ctr[0] + na * u, ctr[1] - nx * u, ctr[2] + v);
        };
        const white = lin('#f4f0e6');
        for (let k = 0; k < 8; k++) T.plain.tri(at(ctr[0], ctr[1], ctr[2]), pt((k * Math.PI) / 4, R), pt(((k + 1) * Math.PI) / 4, R), white);
        const hand = lin('#1a1a1a');
        T.plain.quad(pt(-0.08 + Math.PI / 2, 0.06), pt(0.08 + Math.PI / 2, 0.06), pt(Math.PI / 2 + 0.02, 0.8), pt(Math.PI / 2 - 0.02, 0.8), hand);
        T.plain.quad(pt(-0.1, 0.06), pt(0.1, 0.06), pt(0.03, 0.55), pt(-0.03, 0.55), hand);
      };
      clock(t0 + out * 0.03, mid, out, 0);
      clock(cm, -0.63, 0, -1);
      const tip = at(cm, mid, TH + (b.tall ? 9 : 7.5));
      const helm = lin(b.tall ? '#8a4a32' : '#4f5a58');
      const cnr = [at(ta, -0.6, TH), at(tb, -0.6, TH), at(tb, -0.6 + tw, TH), at(ta, -0.6 + tw, TH)];
      for (let k = 0; k < 4; k++) T.plain.tri(cnr[k], cnr[(k + 1) % 4], tip, shadeF(helm, 0.85 + k * 0.05));
    }

    // Rathaus: Fahnen in den Landesfarben
    if (st === STYLE.rathaus) {
      const cols = flagCols(t.lang);
      const vertical = t.lang !== 'es';
      for (const s of [L * 0.3, L * 0.7]) {
        const h0 = GH + UH * 0.85;
        const root = at(l0, s, h0);
        const tipP = at(l0 + out * 1.5, s, h0 + 0.9);
        T.plain.quad(root, [root[0], root[1] + 0.05, root[2]], [tipP[0], tipP[1] + 0.05, tipP[2]], tipP, lin('#2a2a2c'));
        for (let k = 0; k < 3; k++) {
          const f0 = k / 3;
          const f1 = (k + 1) / 3;
          const P = (fu: number, fv: number) => at(l0 + out * (0.35 + 1.1 * fu), s + 0.04 * fv, h0 + 0.2 + 0.6 * fu - 0.75 * fv);
          if (vertical) T.plain.quad(P(f0, 0), P(f1, 0), P(f1, 1), P(f0, 1), lin(cols[k]));
          else T.plain.quad(P(0, f0), P(1, f0), P(1, f1), P(0, f1), lin(cols[k]));
        }
      }
    }
    const cc = at((l0 + l1) / 2, L / 2, 0);
    T.occ.push(cc[0], cc[2], 0.5 * Math.hypot(L, depth));
  }

  /** Wimpelkette quer über die Gasse */
  private garland(T: Town, a: Row, bl: Building, br: Building) {
    const lang = this.c.track.lang;
    const fun = ['#ffd23f', '#ff5fa2', '#2f80ed', '#27ae60', '#f4f4f4', '#ff7a30'];
    const cols = hash(a.seg.i * 3) < 0.6 ? flagCols(lang) : fun;
    const h = FAC_M.ground + 2.3 + hash(a.seg.i) * 0.8;
    const x0 = -bl.setback + 0.1;
    const x1 = br.setback - 0.1;
    const NN = 16;
    const sag = 0.9;
    const pt = (k: number) => {
      const f = k / NN;
      const x = x0 + (x1 - x0) * f;
      return [a.x + a.rx * x, a.y + h - sag * 4 * f * (1 - f), a.z + a.rz * x];
    };
    const line = lin('#2a2a2c');
    const fx = Math.sin(a.th) * 0.02;
    const fz = -Math.cos(a.th) * 0.02;
    for (let k = 0; k < NN; k++) {
      const p = pt(k);
      const q = pt(k + 1);
      T.plain.quad(p, q, [q[0], q[1] + 0.03, q[2]], [p[0], p[1] + 0.03, p[2]], line);
      const m = [(p[0] + q[0]) / 2 + fx, (p[1] + q[1]) / 2 - 0.42, (p[2] + q[2]) / 2 + fz];
      T.plain.tri([p[0] + fx, p[1], p[2] + fz], [q[0] + fx, q[1], q[2] + fz], m, lin(cols[k % cols.length]));
    }
  }

  /** Stadttor am Ortseingang: zwei Türme mit Zinnen, Torbogen mit Wehrgang, Wappen und Ortsname */
  private gate(T: Town, a: Row, group: THREE.Group, name: string) {
    const fx = Math.sin(a.th);
    const fz = -Math.cos(a.th);
    const P = (lat: number, al: number, h: number) => [a.x + a.rx * lat + fx * al, a.y + h, a.z + a.rz * lat + fz * al];
    const stone = lin('#b9ab92');
    const stoneD = shadeF(stone, 0.78);
    const stoneL = shadeF(stone, 1.06);
    const dark = lin('#2c2420');
    const TW = 4.2, TD = 4.6, TH = 11.5, AH = 6.2, WH = 8.6;
    const x0 = EDGE + 0.5;
    const box = (la0: number, la1: number, al0: number, al1: number, h0: number, h1: number, col: RGBf) => {
      T.plain.quad(P(la0, al0, h0), P(la1, al0, h0), P(la1, al0, h1), P(la0, al0, h1), col);
      T.plain.quad(P(la1, al1, h0), P(la0, al1, h0), P(la0, al1, h1), P(la1, al1, h1), shadeF(col, 0.9));
      T.plain.quad(P(la0, al1, h0), P(la0, al0, h0), P(la0, al0, h1), P(la0, al1, h1), shadeF(col, 0.84));
      T.plain.quad(P(la1, al0, h0), P(la1, al1, h0), P(la1, al1, h1), P(la1, al0, h1), shadeF(col, 0.84));
      T.plain.quad(P(la0, al0, h1), P(la1, al0, h1), P(la1, al1, h1), P(la0, al1, h1), shadeF(col, 1.04));
    };
    for (const sg of [-1, 1]) {
      const la0 = sg < 0 ? -x0 - TW : x0;
      const la1 = la0 + TW;
      box(la0, la1, -TD / 2, TD / 2, -0.6, TH, stone);
      for (let k = 0; k < 4; k += 2) box(la0 + k * TW / 4, la0 + (k + 1) * TW / 4, -TD / 2, TD / 2, TH, TH + 0.9, stoneL);
      for (const h of [3.5, 7.5]) {
        const c = (la0 + la1) / 2;
        T.plain.quad(P(c - 0.14, -TD / 2 - 0.02, h), P(c + 0.14, -TD / 2 - 0.02, h), P(c + 0.14, -TD / 2 - 0.02, h + 1.1), P(c - 0.14, -TD / 2 - 0.02, h + 1.1), dark);
      }
    }
    const D2 = TD / 2 - 0.6;
    for (const sgn of [-1, 1]) {
      const al = sgn * D2;
      const face = (la0: number, la1: number, h0: number, h1: number, col: RGBf) => {
        if (sgn < 0) T.plain.quad(P(la0, al, h0), P(la1, al, h0), P(la1, al, h1), P(la0, al, h1), col);
        else T.plain.quad(P(la1, al, h0), P(la0, al, h0), P(la0, al, h1), P(la1, al, h1), col);
      };
      face(-x0, x0, AH, WH, sgn < 0 ? stone : stoneD);
      const R = x0;
      for (let q = 0; q < 10; q++) {
        const q0 = Math.PI * (q / 10);
        const q1 = Math.PI * ((q + 1) / 10);
        const p0 = P(-Math.cos(q0) * R, al, AH - R + Math.sin(q0) * R);
        const p1 = P(-Math.cos(q1) * R, al, AH - R + Math.sin(q1) * R);
        const t0 = P(-Math.cos(q0) * R, al, AH);
        const t1 = P(-Math.cos(q1) * R, al, AH);
        if (sgn < 0) T.plain.quad(p0, p1, t1, t0, stone); else T.plain.quad(p1, p0, t0, t1, stoneD);
      }
      for (let k = 0; k < 7; k += 2) face(-x0 + k * (2 * x0) / 7, -x0 + (k + 1) * (2 * x0) / 7, WH, WH + 0.8, sgn < 0 ? stoneL : stone);
    }
    for (let q = 0; q < 10; q++) {
      const R = x0;
      const q0 = Math.PI * (q / 10);
      const q1 = Math.PI * ((q + 1) / 10);
      const l0 = -Math.cos(q0) * R, l1 = -Math.cos(q1) * R;
      const h0 = AH - R + Math.sin(q0) * R, h1 = AH - R + Math.sin(q1) * R;
      T.plain.quad(P(l0, -D2, h0), P(l0, D2, h0), P(l1, D2, h1), P(l1, -D2, h1), shadeF(stone, 0.7));
    }
    T.plain.quad(P(-x0, -D2, WH), P(x0, -D2, WH), P(x0, D2, WH), P(-x0, D2, WH), shadeF(stone, 1.02));
    const cols = flagCols(this.c.track.lang);
    const al = -D2 - 0.06;
    const sw = 1.4, sh = 1.6, hy = AH + 0.4;
    for (let k = 0; k < 3; k++) {
      const u0 = -sw / 2 + (k * sw) / 3;
      const u1 = -sw / 2 + ((k + 1) * sw) / 3;
      T.plain.quad(P(u0, al, hy), P(u1, al, hy), P(u1, al, hy + sh), P(u0, al, hy + sh), lin(cols[k]));
    }
    T.plain.tri(P(-sw / 2, al, hy), P(sw / 2, al, hy), P(0, al, hy - 0.5), lin(cols[1]));
    this.c.plate(group, a.seg.i, 0, hy + sh + 0.25, name.toUpperCase(), '', 3.6, false);
  }

  // ------------------------------------------------------------------ Gehsteig: Laternen, Cafés, Brunnen, Bäume

  private prop(T: Town, group: THREE.Group, a: Row, sp: Sprite, s: Seg, trees: TreeSpot[]) {
    const sg = sp.x < 0 ? -1 : 1;
    const ax = Math.abs(sp.x);
    const dx = ax - EDGE;
    let h = sp.h;
    if (ax > EDGE) {
      const gh = this.c.ground(s, sg, dx);
      if (gh === null) return;
      h = gh;
    }
    const px = a.x + a.rx * sp.x;
    const pz = a.z + a.rz * sp.x;
    const py = a.y + h;
    const fx = Math.sin(a.th), fz = -Math.cos(a.th);
    // lokal: q quer (zur Straße hin negativ: −sg), l längs
    const P = (q: number, l: number, y: number) => [px + a.rx * q + fx * l, py + y, pz + a.rz * q + fz * l];
    const r = (k: number) => hash(s.i * 131 + Math.round(sp.x * 10) * 7 + k * 977);
    const G = T.plain;
    const box = (q0: number, q1: number, l0: number, l1: number, y0: number, y1: number, col: RGBf) => {
      G.quad(P(q0, l0, y0), P(q1, l0, y0), P(q1, l0, y1), P(q0, l0, y1), col);
      G.quad(P(q1, l1, y0), P(q0, l1, y0), P(q0, l1, y1), P(q1, l1, y1), shadeF(col, 0.92));
      G.quad(P(q0, l1, y0), P(q0, l0, y0), P(q0, l0, y1), P(q0, l1, y1), shadeF(col, 0.86));
      G.quad(P(q1, l0, y0), P(q1, l1, y0), P(q1, l1, y1), P(q1, l0, y1), shadeF(col, 0.86));
      G.quad(P(q0, l0, y1), P(q1, l0, y1), P(q1, l1, y1), P(q0, l1, y1), shadeF(col, 1.05));
    };
    /** Zylinder (n Seiten) um (q, l) */
    const cyl = (q: number, l: number, r0: number, r1: number, y0: number, y1: number, n: number, col: RGBf, cap = true) => {
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
        const A0 = P(q + Math.cos(a0) * r0, l + Math.sin(a0) * r0, y0), A1 = P(q + Math.cos(a1) * r0, l + Math.sin(a1) * r0, y0);
        const B0 = P(q + Math.cos(a0) * r1, l + Math.sin(a0) * r1, y1), B1 = P(q + Math.cos(a1) * r1, l + Math.sin(a1) * r1, y1);
        G.quad(A1, A0, B0, B1, shadeF(col, 0.85 + 0.15 * Math.abs(Math.cos(a0 + 0.6))));
        if (cap) G.tri(P(q, l, y1), B1, B0, shadeF(col, 1.04));
      }
    };
    const iron = lin('#26292d');
    switch (sp.k) {
      case 'lamp': {
        // Laterne: Mast mit Sockel, Ausleger zur Straße, Leuchte mit warmem Glas
        cyl(0, 0, 0.16, 0.13, -0.1, 0.55, 8, iron);
        cyl(0, 0, 0.07, 0.05, 0.55, 4.6, 6, iron, false);
        const arm = -sg * 0.75;
        box(Math.min(0, arm), Math.max(0, arm), -0.03, 0.03, 4.45, 4.52, iron);
        cyl(arm, 0, 0.05, 0.22, 3.95, 4.3, 6, lin('#f7e2a8'), false);
        cyl(arm, 0, 0.22, 0.04, 4.3, 4.55, 6, iron);
        T.lanterns.push(...P(arm, 0, 4.1));
        // Blumenampel am Mast
        if (r(1) < 0.5) cyl(0, 0, 0.32, 0.2, 2.7, 3.0, 8, lin(['#d63a3a', '#ef6a8a', '#e8463c', '#c53060'][Math.floor(r(2) * 4)]));
        break;
      }
      case 'parasol': {
        // Café: Schirm, Tisch, Stühle (zwei bis vier), manchmal ein Gast (Kleid in Farbe)
        const cols = ['#f2efe8', '#c8302e', '#2a6f4a', '#e8c46a', '#2f4d7a', '#efe6d2'];
        const cc = lin(cols[Math.floor(r(3) * cols.length)]);
        cyl(0, 0, 0.035, 0.035, 0, 2.35, 5, lin('#d9d6cf'), false);
        const R = 1.35;
        const n = 8;
        for (let k = 0; k < n; k++) {
          const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
          const col = k % 2 && r(4) < 0.5 ? shadeF(cc, 0.82) : cc;
          G.tri(P(0, 0, 2.6), P(Math.cos(a1) * R, Math.sin(a1) * R, 2.2), P(Math.cos(a0) * R, Math.sin(a0) * R, 2.2), col);
          G.quad(P(Math.cos(a0) * R, Math.sin(a0) * R, 2.2), P(Math.cos(a1) * R, Math.sin(a1) * R, 2.2), P(Math.cos(a1) * R, Math.sin(a1) * R, 2.08), P(Math.cos(a0) * R, Math.sin(a0) * R, 2.08), shadeF(col, 0.9));
        }
        cyl(0, 0, 0.36, 0.36, 0.7, 0.74, 10, lin('#e9e6df'));
        cyl(0, 0, 0.05, 0.05, 0, 0.7, 4, iron, false);
        const chairs = 2 + Math.floor(r(5) * 3);
        const chairC = r(6) < 0.5 ? lin('#3a3a3c') : lin('#a0603a');
        for (let k = 0; k < chairs; k++) {
          const ang = (k / chairs) * Math.PI * 2 + r(7);
          const cq = Math.cos(ang) * 0.75, cl = Math.sin(ang) * 0.75;
          box(cq - 0.2, cq + 0.2, cl - 0.2, cl + 0.2, 0.42, 0.46, chairC);
          const bq = Math.cos(ang) * 0.95, bl = Math.sin(ang) * 0.95;
          box(bq - 0.04, bq + 0.04, bl - 0.04, bl + 0.04, 0, 0.9, chairC);
          box(cq - 0.03, cq + 0.03, cl - 0.03, cl + 0.03, 0, 0.42, chairC);
        }
        break;
      }
      case 'fountain': {
        // Brunnen: achteckiges Becken aus Stein, Wasser, Säule mit Schale
        const stone = lin('#b8ad98');
        const R = 1.9 * sp.s;
        const n = 8;
        for (let k = 0; k < n; k++) {
          const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
          const o0 = [Math.cos(a0) * R, Math.sin(a0) * R], o1 = [Math.cos(a1) * R, Math.sin(a1) * R];
          const i0 = [o0[0] * 0.86, o0[1] * 0.86], i1 = [o1[0] * 0.86, o1[1] * 0.86];
          G.quad(P(o1[0], o1[1], -0.1), P(o0[0], o0[1], -0.1), P(o0[0], o0[1], 0.62), P(o1[0], o1[1], 0.62), shadeF(stone, 0.85 + 0.15 * Math.abs(Math.cos(a0))));
          G.quad(P(o0[0], o0[1], 0.62), P(i0[0], i0[1], 0.62), P(i1[0], i1[1], 0.62), P(o1[0], o1[1], 0.62), shadeF(stone, 1.06));
          G.quad(P(i0[0], i0[1], 0.62), P(i0[0], i0[1], 0.3), P(i1[0], i1[1], 0.3), P(i1[0], i1[1], 0.62), shadeF(stone, 0.7));
          G.tri(P(0, 0, 0.45), P(i1[0], i1[1], 0.45), P(i0[0], i0[1], 0.45), lin('#3f6f86'));
        }
        cyl(0, 0, 0.28, 0.22, 0.45, 1.9, 8, stone);
        cyl(0, 0, 0.18, 0.8, 1.9, 2.15, 8, stone);
        cyl(0, 0, 0.12, 0.12, 2.15, 2.6, 6, shadeF(stone, 0.9));
        break;
      }
      case 'flagpole': {
        cyl(0, 0, 0.06, 0.04, 0, 7.5, 6, lin('#d8d8d2'), false);
        const cols = flagCols(this.c.track.lang);
        for (let k = 0; k < 3; k++) {
          const l0 = 0.1 + k * 0.5, l1 = l0 + 0.5;
          G.quad(P(0, l0, 6.2), P(0, l1, 6.15), P(0, l1, 7.2), P(0, l0, 7.25), lin(cols[k]));
        }
        break;
      }
      case 'townSign': {
        this.c.plate(group, s.i, sp.x, h, (sp.text ?? '').toUpperCase(), '');
        break;
      }
      case 'tree': case 'treeRound': case 'cypress': case 'palm': {
        trees.push({ kind: 'tree', x: px, y: py, z: pz, s: Math.max(0.6, sp.s) * 0.8, rot: r(9) * Math.PI * 2, tint: 0.95 + r(10) * 0.1 });
        if ((sg < 0 ? s.L : s.R).ground !== 'pavement') break;
        // Baumscheibe mit Einfassung
        const st = lin('#9a9488');
        box(-0.75, 0.75, -0.75, -0.62, -0.05, 0.12, st);
        box(-0.75, 0.75, 0.62, 0.75, -0.05, 0.12, st);
        box(-0.75, -0.62, -0.62, 0.62, -0.05, 0.12, st);
        box(0.62, 0.75, -0.62, 0.62, -0.05, 0.12, st);
        // Bank daneben
        if (r(11) < 0.6) {
          const bl = 1.3;
          box(-0.25, 0.25, bl - 0.8, bl + 0.8, 0.42, 0.47, lin('#7a5232'));
          box(sg * 0.2 - 0.04, sg * 0.2 + 0.04, bl - 0.8, bl + 0.8, 0.47, 0.9, lin('#7a5232'));
          box(-0.2, 0.2, bl - 0.7, bl - 0.62, 0, 0.42, iron);
          box(-0.2, 0.2, bl + 0.62, bl + 0.7, 0, 0.42, iron);
        }
        break;
      }
    }
    // Blumenkübel neben Laternen und Cafés (stellenweise)
    if ((sp.k === 'lamp' || sp.k === 'parasol') && r(12) < 0.45) {
      const l = sp.k === 'lamp' ? 0.9 : 1.9;
      cyl(0, l, 0.3, 0.36, 0, 0.5, 8, lin(r(13) < 0.5 ? '#a8582e' : '#8a8a86'));
      cyl(0, l, 0.32, 0.12, 0.5, 0.95, 7, lin(['#3f6b2f', '#4d7a34'][Math.floor(r(14) * 2)]));
      cyl(0, l, 0.25, 0.05, 0.85, 1.05, 6, lin(['#d63a3a', '#ef6a8a', '#f2f0ea', '#e8a83a'][Math.floor(r(15) * 4)]));
    }
  }

  dispose() {
    for (const m of Object.values(this.mats)) (m as THREE.Material).dispose();
  }
}

/** Kinder des Gehsteigs, die hier gebaut werden */
const TOWN_PROPS = new Set<string>(['lamp', 'parasol', 'fountain', 'flagpole', 'townSign', 'tree', 'treeRound', 'cypress', 'palm']);

function flagCols(lang: string): string[] {
  return lang === 'fr' ? ['#1f3c9c', '#f4f4f4', '#d6202a'] : lang === 'it' ? ['#1f8a4c', '#f4f4f4', '#d6202a']
    : lang === 'es' ? ['#c8102e', '#ffc400', '#c8102e'] : ['#1f3c9c', '#f4f4f4', '#d6202a'];
}
