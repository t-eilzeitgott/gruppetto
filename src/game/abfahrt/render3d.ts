/**
 * WebGL-Renderer für „Abfahrt“ (three.js).
 * Die Strecke wird in Abschnitten (Chunks) als echte 3D-Geometrie gebaut: Fahrbahn mit Texturen,
 * Bankett, Markierungen, Gelände links und rechts (Wiese, Fels, Schnee, Wald, Seeufer), Leitplanken,
 * Häuserzeilen, Tunnel, Bäume und Requisiten. Dazu Himmel, ferne Berge, Talboden, Licht nach Tageszeit,
 * 3D-Fahrer und eine 2D-Ebene für Punkte-Popups.
 */
import * as THREE from 'three';
import { EDGE, MOUNTAIN_FINISH, MOUNTAIN_TOP, ROAD_HALF, SEG, SPRINT_FINISH, Track, type Building, type Seg, type Side, type Sprite, type BiomeId, type Banner } from './track';
import { BIOME_PALETTES, lightAt, mixRGB, type RGB, type Light } from './palette';
import { SpriteBank, cloud, roadArrow, roadText } from './sprites';
import { adCell, adsTex, AD_COUNT, SIGN_COUNT, asphaltTex, bannerTex, canopyTex, fallTex, glowTex, cobbleTex, detailTex, gravelTex, masonryTex, noiseTex, plaqueTex, rockTex, roundTex, shotcreteTex, tunnelSignTex, vergeTex } from './tex3d';
import { SkyLife } from './sky3d';
import { landmarkGeometries, type Landmark } from './landmarks3d';
import { buildPeaks, peakLight, setPeakOpacity } from './peaks3d';
import { FAC_B, FAC_H, FAC_W, TB, portalFacade, tunnelMaterial, tunnelName, tunnelRing, tunnelUniforms, type TunnelUniforms } from './tunnel3d';
import { FAC_M, STYLE, STYLE_PITCH, STYLE_ROOF, STYLE_WALL, badgeUV, facU, facV, facadeAtlas, roofTex, signAtlas, signUV, type FacPart } from './facade';
import { GB, alphaTex, lin, lin255, propGeometries, type Prop3D, type RGBf } from './models3d';
import { RiderModel, riderKitKey } from './rider3d';
import type { RaceView, Opp, Friend } from './engine';
import { LEVELS, LIM_MAX, Terrain, type Region, type TileData } from './terrain3d';
import { Act, KINDS, STRIDE, crowdGeometry, crowdMaterial, disposeCrowdGeometry, needs, packPerson, randomPerson, type Person, type Zone } from './crowd3d';
import { bakeCrowdAtlas, disposeSpriteGeometry, spriteGeometry, spriteMaterial, type CrowdAtlas } from './crowdSprites';
import { NearTrees, TREC, TREE_KINDS, bakeTreeAtlas, billboardMaterial, disposeBillboards, treeBillboards, treeVariant, type TreeAtlas, type TreeSource } from './forest3d';
import { mulberry32 } from './rng';
import './grade';
import { setGlossEnv } from './gloss';

/** Bäume schrumpfen zwischen TREE_FADE und TREE_GONE weg; das Kronendach hebt sich ab CAN_NEAR bis CAN_FULL */
const TREE_FADE = 185;
const TREE_GONE = 245;
const CAN_NEAR = 235;
const CAN_FULL = 420;

const TREES = TREE_KINDS;

const smooth01 = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

const CH = 40;            // Segmente je Abschnitt (80 m)
const AHEAD = 560;        // so weit voraus wird gebaut (m)
const BEHIND = 30;
const CAM_BACK = 6.2;
const CAM_UP = 2.75;
const SPRINT_BACK = 7.4;
const SPRINT_UP = 3.7;

const PROP3D = new Set<string>(['pine', 'pineSnow', 'larch', 'tree', 'treeRound', 'cypress', 'olive', 'bush', 'rock', 'boulder', 'snowpole', 'hay', 'vinerow', 'fence', 'lamp', 'logs', 'palm']);
const BILLBOARD: Record<string, { variants: number; frames: number }> = {
  cow: { variants: 2, frames: 1 }, cowBW: { variants: 2, frames: 1 }, chevron: { variants: 1, frames: 1 },
  dosso: { variants: 1, frames: 1 }, chalet: { variants: 2, frames: 1 }, barn: { variants: 2, frames: 1 }, rifugio: { variants: 1, frames: 1 },
  farmhouse: { variants: 1, frames: 1 }, flowers: { variants: 4, frames: 1 }, grassTuft: { variants: 2, frames: 1 }, sunflowers: { variants: 2, frames: 1 },
  parasol: { variants: 4, frames: 1 }, boat: { variants: 4, frames: 1 }, fountain: { variants: 1, frames: 1 }, flagpole: { variants: 4, frames: 2 },
  campervan: { variants: 4, frames: 1 },
};
const CLOTH = ['#ff5fa2', '#2f80ed', '#ffd23f', '#f4f4f4', '#27ae60'];

const hash = (n: number) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};
const shadeF = (c: RGBf, f: number): RGBf => [c[0] * f, c[1] * f, c[2] * f];
const rgbLin = (c: RGB): RGBf => lin255(c[0], c[1], c[2]);

interface Row { x: number; y: number; z: number; rx: number; rz: number; th: number; seg: Seg }
interface CrowdBatch { near: THREE.Mesh[]; mid: THREE.Mesh[]; spr: THREE.Mesh | null; c: THREE.Vector3; r: number; lod: number }
interface Chunk { idx: number; group: THREE.Group; dispose: () => void; glow: THREE.Points | null; crowd: CrowdBatch[] }
/** Bauteile der Häuser eines Abschnitts */
interface Town { facade: GB; tiles: GB; plain: GB; signs: GB; lanterns: number[]; bulbs: number[] }
interface Runner { z: number; x: number; v: number; go: boolean; p: Person; act: number; yaw: number; flag: boolean }
interface Tile { lv: number; key: string; objs: THREE.Object3D[]; geos: THREE.BufferGeometry[]; tsrc: TreeSource | null; box: [number, number, number, number]; stale?: boolean }
interface AtlasEntry { u0: number; v0: number; u1: number; v1: number; w: number; h: number; du: number }

export class Renderer3D {
  quality = 1;
  dark = false;
  accent = '#ff5fa2';
  readonly gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, 1, 0.25, 15000);
  private overlay: CanvasRenderingContext2D;
  private overlayCv: HTMLCanvasElement;
  private W = 1;
  private H = 1;
  private track: Track | null = null;
  private chunks = new Map<number, Chunk>();
  private friendsKey = '';

  // Licht
  private hemi = new THREE.HemisphereLight(0xffffff, 0x445533, 1.1);
  private sun = new THREE.DirectionalLight(0xffffff, 1.6);
  /** sanftes Gegenlicht: Schattenseiten von Fels und Wänden saufen nicht ab */
  private fill = new THREE.DirectionalLight(0xbcd4ff, 0.5);
  private fog = new THREE.FogExp2(0xcfe0ea, 0.0024);
  private light: Light = lightAt(0);
  private night = 0;
  private tunnelDim = 0;

  // Himmel, Berge, Tal
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private mtn: THREE.Mesh | null = null;
  private mtnOld: THREE.Mesh | null = null;
  private mtnBiome: BiomeId | null = null;
  private mtnFade = 1;
  /** Licht für die Berge am Horizont (eigener Shader) */
  private peakU = peakLight();
  private valley: THREE.Mesh;
  private valleyMat: THREE.MeshLambertMaterial;
  private clouds: THREE.Sprite[] = [];
  /** Adler, Gleitschirme, Ballon, Fernsehhubschrauber */
  private skyLife = new SkyLife();
  private leaderV = new THREE.Vector3();

  // Landschaft (Höhenfeld in drei Stufen)
  private terrain: Terrain | null = null;
  /** Rechenbereich der Landschaft für den gerade gebauten Abschnitt */
  private region: Region | null = null;
  private tiles = new Map<string, Tile>();
  /** Bäume: Bildvorrat, Bildbäume je Kachel/Abschnitt, nahe 3D-Bäume */
  private treeAtlas!: TreeAtlas;
  private bbMat!: THREE.ShaderMaterial;
  private nearTrees!: NearTrees;
  private treeSrc = new Set<TreeSource>();
  /** beim Bau eines Abschnitts: dessen Bäume (TREC je Baum) */
  private cTrees: number[] | null = null;
  private terrMats: THREE.MeshLambertMaterial[] = [];
  private waterMats: THREE.MeshPhongMaterial[] = [];
  /** Gebiet, das eine Stufe vollständig abdeckt (dort wird die nächstgröbere abgesenkt) */
  private lvBox = LEVELS.map(() => new THREE.Vector4(1e9, 1e9, -1e9, -1e9));
  /** Stufe einmal vollständig aufgebaut (danach bleibt die Abdeckung, bis der neue Ring fertig ist) */
  private boxSet = LEVELS.map(() => false);
  private lastTerrCam = new THREE.Vector3(1e9, 0, 0);
  /** Blickrichtung (geglättet, waagrecht): die Kachelringe liegen nach vorn verschoben – vor der Kamera
   *  reicht die feine Stufe weiter, hinter ihr (unsichtbar) weniger weit */
  private terrFwd = new THREE.Vector3(0, 0, -1);
  private terrDir = new THREE.Vector3();
  /** Kachel im Bau (wird über mehrere Bilder verteilt fertiggestellt) */
  private pending: { key: string; lv: number; gen: Generator<void, TileData, void>; ver: number } | null = null;

  // Materialien
  private mats!: {
    asphalt: THREE.MeshLambertMaterial; fresh: THREE.MeshLambertMaterial; cobble: THREE.MeshLambertMaterial; gravel: THREE.MeshLambertMaterial;
    verge: THREE.MeshLambertMaterial; marks: THREE.MeshLambertMaterial; terrain: THREE.MeshLambertMaterial; portal: THREE.MeshLambertMaterial; barrier: THREE.MeshLambertMaterial;
    water: THREE.MeshPhongMaterial; facade: THREE.MeshLambertMaterial; roof: THREE.MeshLambertMaterial;
    tunWall: THREE.MeshBasicMaterial; tunRoad: THREE.MeshBasicMaterial; tunMarks: THREE.MeshBasicMaterial; tunSign: THREE.MeshBasicMaterial; masonry: THREE.MeshLambertMaterial;

    tiles: THREE.MeshLambertMaterial; sign: THREE.MeshLambertMaterial; bulb: THREE.PointsMaterial; lantern: THREE.PointsMaterial;
    props: THREE.MeshLambertMaterial; ads: THREE.MeshLambertMaterial; billboard: THREE.MeshLambertMaterial; glow: THREE.PointsMaterial; lampGlow: THREE.MeshBasicMaterial;
  };
  private props!: Partial<Record<Prop3D, THREE.BufferGeometry>>;
  private treeMat!: THREE.MeshLambertMaterial;
  private markGeo!: Record<Landmark, THREE.BufferGeometry>;
  private markMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  /** Wasserfälle: fließende Gischt (Textur läuft nach unten) */
  private fallMat: THREE.MeshBasicMaterial | null = null;
  private atlas = new Map<string, AtlasEntry>();
  private bank = new SpriteBank();
  private labelTex = new Map<string, THREE.Texture>();
  private shadowTex!: THREE.Texture;
  private time = { value: 0 };
  /** Licht in den Tunnelröhren (Leuchten, Tageslicht an den Portalen) */
  private tunU: TunnelUniforms = tunnelUniforms();
  /** Tunnel: erstes und letztes Segment je Segment im Tunnel */
  private tunSpan = new Map<number, [number, number, number]>();

  // Dynamisches
  private riders = new Map<number, RiderModel>();
  private player: RiderModel | null = null;
  private playerKit = '';
  private objPool: Map<string, THREE.Object3D[]> = new Map();
  private objUsed = new Map<string, number>();
  private objRoot = new THREE.Group();
  private parts: THREE.Points;
  private partPos = new Float32Array(300 * 3);
  private partCol = new Float32Array(300 * 3);
  // Zuschauer
  private crowdU = { uTime: this.time, uRider: { value: new THREE.Vector3() } };
  private crowdMat = crowdMaterial(this.crowdU);
  /** Zuschauer in der Ferne: Bilder aus dem Vorrat (einmal aus den 3D-Figuren gezeichnet) */
  private crowdAtlas!: CrowdAtlas;
  private sprMat!: THREE.MeshLambertMaterial;
  private runners: Runner[] = [];
  private runBuf = new THREE.InstancedInterleavedBuffer(new Float32Array(6 * STRIDE), STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
  private runMeshes: THREE.Mesh[] = [];
  private runNext = 0;
  private adsGB: GB | null = null;
  private w2 = { x: 0, y: 0, z: 0, th: 0 };

  // Kamera
  private cam = { x: 0, y: 0, z: 0, th: 0, init: false, fov: 70, pack: 0 };
  playerScreen = { x: 0, y: 0, s: 60 };
  /** nur für Tests: feste Kamera [x, y, z, Blickziel x, y, z] */
  debugCam: number[] | null = null;
  /** Prüfmodus für Löcher: Himmel unter dem Horizont und die tiefe Rückfallfläche werden magenta */
  set debugHoles(on: boolean) {
    this.skyMat.uniforms.uHoles.value = on ? 1 : 0;
    for (const c of this.clouds) c.visible = !on;
    const vm = this.valleyMat as unknown as THREE.MeshBasicMaterial;
    vm.color.set(on ? 0xff00ff : 0xcfe0ea);
    vm.fog = !on;
    vm.needsUpdate = true;
    this.holeMode = on;
    this.holeU.value = on ? 1 : 0;
  }
  private holeMode = false;
  private holeU = { value: 0 };
  private w = { x: 0, y: 0, z: 0, th: 0 };

  constructor(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement) {
    // Kantenglättung immer an (MSAA): auf Handy-GPUs günstig, Kanten und Linien werden weich
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false, stencil: false });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    // sanfte Tonwertkurve (helle Sonne ohne ausgefressene Farben) plus leichter Filmlook (GRADE)
    this.gl.toneMapping = THREE.CustomToneMapping;
    this.gl.toneMappingExposure = 1.08;
    // Keine Schattenkarte: ein zweiter Zeichendurchgang ist auf älteren Handys zu teuer.
    // Fahrer und Zuschauer haben weiche Bodenschatten.
    this.gl.shadowMap.enabled = false;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.sun.castShadow = false;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -36; sc.right = 36; sc.top = 36; sc.bottom = -36; sc.near = 20; sc.far = 420;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.05;
    this.overlayCv = overlay;
    this.overlay = overlay.getContext('2d')!;
    this.scene.fog = this.fog;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.fill, this.fill.target, this.objRoot, this.skyLife.group);

    // Himmel
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: true,
      uniforms: {
        top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, below: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() }, sunCol: { value: new THREE.Color() }, sunSize: { value: 1 },
        uHoles: { value: 0 },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 below; uniform vec3 sunDir; uniform vec3 sunCol; uniform float sunSize; uniform float uHoles;
        varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          // Prüfmodus: Himmel unterhalb des Horizonts = Loch in der Welt (magenta)
          if (uHoles > 0.5 && h < -0.03) { gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); return; }
          vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(horizon, below, clamp(-h * 6.0, 0.0, 1.0));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          c += sunCol * (pow(s, 900.0) * 3.0 * sunSize + pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.12);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), this.skyMat);
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);


    // Talboden: nur noch Rückfallfläche tief unten (die Landschaft kommt aus dem Höhenfeld)
    this.valleyMat = new THREE.MeshBasicMaterial({ color: 0xcfe0ea, fog: true }) as unknown as THREE.MeshLambertMaterial;
    this.valley = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000), this.valleyMat);
    this.valley.rotation.x = -Math.PI / 2;
    this.scene.add(this.valley);

    // Wolken
    const cTex = [cloud(1), cloud(2), cloud(3)].map((c) => alphaTex(c));
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cTex[i % 3], fog: false, transparent: true, depthWrite: false, opacity: 0.85 }));
      s.scale.set(900 + hash(i) * 700, 350 + hash(i + 9) * 200, 1);
      this.clouds.push(s);
      this.scene.add(s);
    }

    // Partikel
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.partPos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(this.partCol, 3));
    const pt = alphaTex(roundTex('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), [255, 255, 255]);
    this.parts = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.35, map: pt, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }));
    this.parts.frustumCulled = false;
    this.scene.add(this.parts);

    this.initMaterials();
    this.crowdAtlas = bakeCrowdAtlas(this.gl);
    this.treeAtlas = bakeTreeAtlas(this.gl);
    this.bbMat = billboardMaterial(this.treeAtlas, this.peakU, this.time, [TREE_FADE, TREE_GONE]);
    this.nearTrees = new NearTrees(this.treeAtlas, this.treeMat);
    this.scene.add(this.nearTrees.group);
    this.sprMat = spriteMaterial(this.crowdU, this.crowdAtlas);
    this.resize();
  }

  /** Datentextur (Rauschen, Helligkeit): Werte wie gemalt, ohne Farbraum-Umrechnung */
  private dataTex(c: HTMLCanvasElement, aniso: number): THREE.CanvasTexture {
    const t = this.tex(c, true, aniso);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  }

  /** anisotrope Filterung: 4 reicht fast überall (16 kostet auf Handys an flachen Flächen viel Speicherbandbreite) */
  private tex(c: HTMLCanvasElement, repeat = true, aniso = 4): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(c);
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(aniso, this.gl.capabilities.getMaxAnisotropy());
    return t;
  }

  private noiseMap!: THREE.CanvasTexture;

  /**
   * Relieftextur aus einer gemalten Rauschtextur: R = Kanal r, G = Höhe (Kanal ch), B/A = Steigung der Höhe
   * je Texel in u und v (×4, um 0,5). Damit lässt sich Licht auf Rinnen und Buckeln ohne Bildschirm-Ableitungen
   * rechnen; die Mipmaps glätten die Steigung in der Ferne (kein Flimmern).
   */
  private reliefTex(cv: HTMLCanvasElement, ch: number): THREE.DataTexture {
    const w = cv.width;
    const h = cv.height;
    const img = cv.getContext('2d')?.getImageData?.(0, 0, w, h);
    const out = new Uint8Array(w * h * 4).fill(128);
    if (img?.data) {
      const src = img.data;
      const H = (x: number, y: number) => src[(((y + h) % h) * w + ((x + w) % w)) * 4 + ch] / 255;
      const enc = (v: number) => Math.max(0, Math.min(255, Math.round(128 + v * 4 * 255)));
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          out[i] = src[i];
          out[i + 1] = src[i + ch];
          out[i + 2] = enc((H(x + 1, y) - H(x - 1, y)) / 2);
          out[i + 3] = enc((H(x, y + 1) - H(x, y - 1)) / 2);
        }
      }
    }
    const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  }

  private initMaterials() {
    this.noiseMap = this.dataTex(noiseTex(), 1);
    const L = (opts: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(opts);
    const fa = facadeAtlas();
    const facade = this.tex(fa.day, false);
    const facadeLit = this.tex(fa.night, false);
    const signs = this.tex(signAtlas(), false);
    const detail = this.tex(detailTex());
    this.shadowTex = alphaTex(roundTex('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)', 64), [0, 0, 0]);
    const glowMap = new THREE.CanvasTexture(glowTex(255, 205, 135));
    this.mats = {
      asphalt: L({ map: this.tex(asphaltTex(false), true, 8) }),
      fresh: L({ map: this.tex(asphaltTex(true), true, 8) }),
      cobble: L({ map: this.tex(cobbleTex(), true, 8) }),
      gravel: L({ map: this.tex(gravelTex(), true, 8) }),
      verge: L({ map: this.tex(vergeTex()) }),
      marks: L({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      terrain: L({ vertexColors: true, map: detail }),
      portal: L({ vertexColors: true, side: THREE.DoubleSide }),
      barrier: L({ vertexColors: true, side: THREE.DoubleSide }),
      water: new THREE.MeshPhongMaterial({ color: 0x2f7fb5, shininess: 90, specular: 0x88aacc, transparent: true, opacity: 0.92, flatShading: true }),
      tunWall: tunnelMaterial(this.tex(shotcreteTex()), this.tunU, 'wall'),
      tunRoad: tunnelMaterial(this.tex(asphaltTex(false)), this.tunU, 'road'),
      tunMarks: tunnelMaterial(null, this.tunU, 'marks', true),
      tunSign: new THREE.MeshBasicMaterial({ map: this.tex(tunnelSignTex(), false), color: new THREE.Color(1.15, 1.15, 1.15) }),
      masonry: L({ vertexColors: true, map: this.tex(masonryTex()), side: THREE.DoubleSide }),
      facade: L({ map: facade, emissiveMap: facadeLit, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0, vertexColors: true }),
      // Dächer, Giebel, Kamine, Fahnen: beidseitig (Dachüberstände sieht man von unten)
      roof: L({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }),
      tiles: L({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, map: this.tex(roofTex()) }),
      sign: L({ map: signs, emissiveMap: signs, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0 }),
      bulb: new THREE.PointsMaterial({ size: 0.55, map: glowMap, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 0 }),
      lantern: new THREE.PointsMaterial({ size: 1.7, map: glowMap, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 0 }),
      props: L({ vertexColors: true, flatShading: true }),
      ads: L({ vertexColors: true, side: THREE.DoubleSide }),
      billboard: L({ alphaTest: 0.5, side: THREE.DoubleSide }),
      glow: new THREE.PointsMaterial({ size: 3.2, map: glowMap, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 0 }),
      lampGlow: new THREE.MeshBasicMaterial({ map: glowMap, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }),
    };
    // Straßenbeläge und Bankett: großflächige Flecken (Flickstellen, Abrieb, Staub) brechen das Kachelmuster auf,
    // in der Ferne geht die Textur in ihre Mittelfarbe über – kein Flimmern, keine Linien beim Fahren
    const roadU = { uNoise: { value: this.noiseMap } };
    const roadify = (m: THREE.MeshLambertMaterial, key: string, patch: number) => {
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, roadU);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D uNoise;\nvarying vec3 vWP;')
          .replace('#include <map_fragment>', `
            #ifdef USE_MAP
              vec4 sampledDiffuseColor = texture2D(map, vMapUv);
              // Mittelfarbe der Textur (kleinste Mipmap-Stufe)
              vec3 avgC = textureLod(map, vMapUv, 12.0).rgb;
              float rd = distance(vWP, cameraPosition);
              sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, avgC, smoothstep(28.0, 95.0, rd) * 0.8);
              vec3 mn = texture2D(uNoise, vWP.xz / 26.0).rgb;
              sampledDiffuseColor.rgb *= 1.0 + ${patch.toFixed(2)} * ((mn.r * 0.6 + mn.g * 0.4) - 0.5);
              sampledDiffuseColor.rgb *= mix(vec3(1.0), vec3(1.05, 1.0, 0.92), mn.b * 0.8);
              diffuseColor *= sampledDiffuseColor;
            #endif`);
      };
      m.customProgramCacheKey = () => `road-${key}`;
    };
    roadify(this.mats.asphalt, 'a', 0.34);
    roadify(this.mats.fresh, 'f', 0.18);
    roadify(this.mats.cobble, 'c', 0.36);
    roadify(this.mats.gravel, 'g', 0.4);
    roadify(this.mats.verge, 'v', 0.45);
    this.props = propGeometries();
    this.markGeo = landmarkGeometries();
    // Felsschichten an allen steilen Flächen (Landschaft, Wände am Straßenrand, Tunnelportale):
    // Weltkoordinaten statt UV – waagrechte Lagen laufen so über alle Flächen hinweg
    const rockMap = this.tex(rockTex());
    const rockU = { uRock: { value: rockMap } };
    const rockify = (sh: THREE.WebGLProgramParametersWithUniforms) => {
      Object.assign(sh.uniforms, rockU);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRockP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvRockP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uRock;\nvarying vec3 vRockP;')
        .replace('#include <map_fragment>', `
          #ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D(map, vMapUv);
          #else
            vec4 sampledDiffuseColor = vec4(1.0);
          #endif
          {
            // Steilheit aus der Dreiecksfläche; Textur immer (gleichmäßiger Kontrollfluss → richtige Mipmap)
            vec3 px = dFdx(vRockP);
            vec3 py = dFdy(vRockP);
            vec3 fn = normalize(cross(px, py));
            // nur in der Nähe: weiter weg würden die feinen Schichten zu Streifen flimmern
            float steep = (1.0 - smoothstep(0.5, 0.8, abs(fn.y))) * (1.0 - smoothstep(60.0, 180.0, distance(vRockP, cameraPosition)));
            vec2 tu = vec2(-fn.z, fn.x) / max(1e-4, length(fn.xz));
            vec2 ruv = vec2(dot(vRockP.xz, tu), vRockP.y) / 11.0;
            vec2 rux = dFdx(ruv);
            vec2 ruy = dFdy(ruv);
            // nur lesen, wo Fels sichtbar ist (Ableitungen vorher, damit die Mipmap stimmt)
            if (steep > 0.003) sampledDiffuseColor = mix(sampledDiffuseColor, textureGrad(uRock, ruv, rux, ruy), steep);
          }
          diffuseColor *= sampledDiffuseColor;`);
    };
    for (const [m, key] of [[this.mats.terrain, 'rock-terr'], [this.mats.portal, 'rock-portal']] as [THREE.Material, string][]) {
      m.onBeforeCompile = rockify;
      m.customProgramCacheKey = () => key;
    }
    // Landschaft pro Bildpunkt: Wald (Kronendach, organischer Rand), Fels und Schnee aus Gewichten je Ecke,
    // aufgebrochen mit Rauschen – statt verwaschener Eckpunktfarben
    const splatU = {
      // ohne anisotrope Filterung: großflächig, fein genug ohne – und auf schwachen Grafikchips teuer
      uRelief: { value: this.reliefTex(noiseTex(), 1) }, uCanopy: { value: this.dataTex(canopyTex(), 2) },
      uForA: { value: new THREE.Color().setRGB(...lin255(30, 60, 34)) }, uForB: { value: new THREE.Color().setRGB(...lin255(56, 88, 46)) },
      uSnow: { value: new THREE.Color().setRGB(...lin255(240, 245, 250)) },
    };
    // je Stufe nur, was dort sichtbar ist: feine Muster (Kronen, Felstextur, mittleres Rauschen) nur nah;
    // großflächiges Rauschen kommt je Ecke (aNz, vMat.w) statt aus einer Textur
    const splat = (sh: THREE.WebGLProgramParametersWithUniforms, lv: number) => {
      Object.assign(sh.uniforms, splatU);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aMat;\nattribute vec3 aRock;\nattribute float aCan;\nattribute vec2 aNz;\nvarying vec4 vMat;\nvarying vec3 vRk;\nvarying vec3 vTW;\nvarying vec2 vNz;')
        // Kronendach: nah flach (dort stehen Bäume), weiter weg angehoben – stetig mit dem Abstand zur Kamera
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n{ vec3 cw = (modelMatrix * vec4(transformed, 1.0)).xyz; transformed.y += aCan * smoothstep(${CAN_NEAR.toFixed(1)}, ${CAN_FULL.toFixed(1)}, distance(cw.xz, cameraPosition.xz)); }`)
        .replace('#include <project_vertex>', '#include <project_vertex>\nvMat = aMat;\nvRk = aRock;\nvNz = aNz;\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n#define TLV ${lv}\nuniform sampler2D uRelief;\nuniform sampler2D uCanopy;\nuniform vec3 uForA;\nuniform vec3 uForB;\nuniform vec3 uSnow;\nvarying vec4 vMat;\nvarying vec3 vRk;\nvarying vec3 vTW;\nvarying vec2 vNz;`)
        .replace('#include <color_fragment>', `
          // Relief für die Beleuchtung als Steigung in Weltkoordinaten (m/m): Rinnen im Fels, Buckel in der Wiese.
          // Die Steigung kommt aus einer Textur mit Mipmaps (in der Ferne glatt) statt aus Bildschirm-Ableitungen.
          vec3 tGrad = vec3(0.0);
          #ifdef USE_COLOR
            // Normale in Weltkoordinaten (weich zwischen den Ecken)
            vec3 fnT = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
            float camD = distance(vTW, cameraPosition);
            float big = vMat.w;
            #if TLV < 2
              // mittleres Rauschen: r, Höhe g, Steigung von g in b/a (je Texel ×4)
              vec4 nz2 = texture2D(uRelief, vTW.xz / 33.0);
            #else
              vec4 nz2 = vec4(0.5);
            #endif
            // Wiesen: Flecken heller/dunkler, mal saftiger, mal trockener (gelblicher)
            vec3 tCol = vColor.rgb * (0.92 + 0.16 * big);
            tCol = mix(tCol, tCol * vec3(1.1, 1.02, 0.78), smoothstep(0.55, 0.85, big) * 0.5);
            // Fels: Gewicht, Rauschen und die Steilheit dieser Fläche
            float rk = smoothstep(0.42, 0.64, vMat.y + (big - 0.5) * 0.45 + (nz2.r - 0.5) * 0.22 + (1.0 - fnT.y) * 0.45);
            float far = smoothstep(60.0, 220.0, camD);
            float hiF = 1.0 - smoothstep(450.0, 1300.0, camD);
            // Rinnen und Schichten nur an steilen Flächen
            float wallW = 1.0 - smoothstep(0.55, 0.85, fnT.y);
            // Felswände: senkrechte Rinnen (Erosion) – eine Projektion entlang der Wand (waagrecht in Wandrichtung,
            // senkrecht nach Höhe); gelesen nur, wo Fels ist (Ableitungen vorher: richtige Mipmap)
            vec2 tw = vec2(-fnT.z, fnT.x) / max(1e-3, length(fnT.xz));
            vec2 gU = vec2(dot(vTW.xz, tw) / 120.0, vTW.y / 190.0);
            vec2 gUx = dFdx(gU);
            vec2 gUy = dFdy(gU);
            float gul = 0.5;
            if (rk * wallW > 0.01) {
              vec4 ra = textureGrad(uRelief, gU, gUx, gUy);
              gul = mix(0.5, ra.g, wallW);
              // Steigung (Textur hat 256 Texel, Kodierung ×4): Rinnen 18 m tief
              vec2 sa = (ra.ba - 0.5) * 64.0 * 18.0;
              tGrad += (vec3(tw.x, 0.0, tw.y) * (sa.x / 120.0) + vec3(0.0, sa.y / 190.0, 0.0)) * (rk * far * wallW);
            }
            float gul2 = mix(0.5, nz2.g, hiF * wallW);
            vec3 rc = vRk * (0.8 + 0.42 * nz2.r) * mix(1.0, 0.84 + 0.26 * mix(gul, gul2, 0.4), far);
            // auf Absätzen (weniger steil) Gras und Geröll
            rc = mix(rc, vColor.rgb * 0.8, smoothstep(0.62, 0.8, fnT.y) * smoothstep(0.5, 0.72, big) * 0.6);
            // Wald: Rand aus Rauschen; aus der Nähe Waldboden (dort stehen Bäume), weiter weg das Kronendach
            float fo = smoothstep(0.46, 0.58, vMat.x + (big - 0.5) * 0.25 + (vNz.x - 0.5) * 0.6 + (nz2.g - 0.5) * 0.28) * (1.0 - rk);
            float crown = 0.55;
            #if TLV == 0
              vec2 cuv = vTW.xz / 10.0;
              vec2 cux = dFdx(cuv);
              vec2 cuy = dFdy(cuv);
              if (fo > 0.01) crown = textureGrad(uCanopy, cuv, cux, cuy).r;
            #endif
            vec3 fc = mix(uForA, uForB, nz2.r) * (0.42 + crown * 0.72);
            fc = mix(fc, uForA * vec3(0.62, 0.6, 0.5), smoothstep(0.78, 0.45, fnT.y));
            float canopy = smoothstep(${(TREE_GONE - 70).toFixed(1)}, ${TREE_GONE.toFixed(1)}, camD);
            fc = mix(uForA * vec3(0.75, 0.72, 0.6), fc, canopy);
            tCol = mix(tCol, fc, fo);
            tCol = mix(tCol, rc, rk);
            // Schnee: bleibt in den Rinnen länger liegen
            float sn = smoothstep(0.42, 0.6, vMat.z + (vNz.y - 0.5) * 0.55 + (nz2.g - 0.5) * 0.25 + rk * (0.5 - gul) * 0.5) * smoothstep(0.38, 0.7, fnT.y + (nz2.r - 0.5) * 0.3 + (0.5 - gul) * 0.25);
            tCol = mix(tCol, uSnow * (0.9 + 0.12 * nz2.g), sn);
            #if TLV < 2
              // Buckel in Wiese und Wald (3 m auf 33 m)
              tGrad.xz += (nz2.ba - 0.5) * 64.0 * 3.0 / 33.0 * ((1.0 - rk) * far);
            #endif
            // Schnee glättet das Relief
            tGrad *= 1.0 - 0.7 * sn;
            diffuseColor.rgb *= tCol;
          #endif`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            // Relief: Normale gegen die Steigung kippen (nur den Anteil entlang der Fläche)
            vec3 gV = (viewMatrix * vec4(tGrad, 0.0)).xyz;
            normal = normalize(normal - (gV - dot(gV, normal) * normal));
          }`);
    };
    // Landschaftsmaterialien: gröbere Stufen sinken dort ab, wo die feinere liegt
    const lower = <M extends THREE.Material>(m: M, lv: number, drop: number, key: string, rock: boolean): M => {
      const u = { uBox: { value: this.lvBox[Math.max(0, lv - 1)] }, uDrop: { value: drop }, uHole: this.holeU };
      m.onBeforeCompile = (sh) => {
        // Felstextur nur auf der feinsten Stufe (weiter weg ist sie ohnehin ausgeblendet)
        if (rock) { if (lv === 0) rockify(sh); splat(sh, lv); }
        if (lv === 0) return;
        Object.assign(sh.uniforms, u);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform vec4 uBox;\nuniform float uDrop;\nvarying float vLow;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLow = 0.0;\nif (position.x > uBox.x + 0.5 && position.x < uBox.z - 0.5 && position.z > uBox.y + 0.5 && position.z < uBox.w - 0.5) { transformed.y -= uDrop; vLow = 1.0; }');
        // Prüfmodus: abgesenkte gröbere Stufe sichtbar = Loch in der feineren (magenta)
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uHole;\nvarying float vLow;')
          .replace('#include <dithering_fragment>', '#include <dithering_fragment>\nif (uHole > 0.5 && vLow > 0.5) gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);');
      };
      m.customProgramCacheKey = () => `${key}${lv}`;
      return m;
    };
    this.terrMats = LEVELS.map((_, lv) => lower(L({ vertexColors: true, map: lv === 0 ? detail : null }), lv, lv === 1 ? 110 : 380, 'terr', true));
    this.waterMats = LEVELS.map((_, lv) => lower(new THREE.MeshPhongMaterial({ color: 0x2f7fb5, shininess: 70, specular: 0x8fb4d0, transparent: true, opacity: 0.9 }), lv, lv === 1 ? 110 : 380, 'lake', false));
    // Banden und Schilder: vorn bedruckt, hinten schlichte Farbe (Eckpunktfarbe)
    this.mats.ads.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>',
        '#ifdef USE_COLOR\nif (!gl_FrontFacing) diffuseColor.rgb = vColor.rgb;\n#endif');
    };
    this.mats.ads.customProgramCacheKey = () => 'ads-1';
    // Bäume wiegen sich leise im Wind (nur Instanzen; je höher, desto mehr – Felsen und Zäune bleiben ruhig)
    const windT = this.time;
    this.mats.props.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = windT;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
          {
            vec3 ip = instanceMatrix[3].xyz;
            float sw = max(0.0, position.y - 2.0);
            float ph = uTime * 1.1 + ip.x * 0.11 + ip.z * 0.07;
            float g = sin(ph) * 0.6 + sin(ph * 2.3 + 1.7) * 0.4;
            transformed.x += g * sw * sw * 0.0016;
            transformed.z += cos(ph * 0.8) * sw * sw * 0.0011;
          }
          #endif`);
    };
    this.mats.props.customProgramCacheKey = () => 'props-wind';
    // Bäume: weich schattiert (runde Kronen statt Facetten), Wind; die der Landschaft schrumpfen in der Ferne
    // stetig weg (dort übernimmt das Kronendach) – kein Aufploppen, wenn neue Kacheln entstehen
    const treeMat = (fade: boolean) => {
      const m = new THREE.MeshLambertMaterial({ vertexColors: true });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = windT;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            #ifdef USE_INSTANCING
            {
              vec3 ip = instanceMatrix[3].xyz;
              ${fade ? `transformed *= 1.0 - smoothstep(${TREE_FADE.toFixed(1)}, ${TREE_GONE.toFixed(1)}, distance(ip.xz, cameraPosition.xz));` : ''}
              float sw = max(0.0, position.y - 2.0);
              float ph = uTime * 1.1 + ip.x * 0.11 + ip.z * 0.07;
              float g = sin(ph) * 0.6 + sin(ph * 2.3 + 1.7) * 0.4;
              transformed.x += g * sw * sw * 0.0016;
              transformed.z += cos(ph * 0.8) * sw * sw * 0.0011;
            }
            #endif`);
      };
      m.customProgramCacheKey = () => (fade ? 'trees-fade' : 'trees');
      return m;
    };
    this.treeMat = treeMat(false);
    // Billboards: Bild-Atlas mit Animationsrahmen
    this.buildAtlas();
    const timeRef = this.time;
    this.mats.billboard.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = timeRef;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aAnim;\nuniform float uTime;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.x += aAnim.x * step(0.5, fract(uTime * aAnim.z + aAnim.y));\n#endif');
    };
  }

  private buildAtlas() {
    const items: { key: string; frames: HTMLCanvasElement[]; w: number; h: number }[] = [];
    for (const [kind, def] of Object.entries(BILLBOARD)) {
      for (let v = 0; v < def.variants; v++) {
        const frames: HTMLCanvasElement[] = [];
        let w = 1;
        let h = 1;
        for (let f = 0; f < def.frames; f++) {
          const s = this.bank.get(kind as never, v, f);
          if (!s) continue;
          frames.push(s.img);
          w = s.w;
          h = s.h;
        }
        if (frames.length) items.push({ key: `${kind}:${v}`, frames, w, h });
      }
    }
    items.sort((a, b) => b.frames[0].height - a.frames[0].height);
    const AW = 2048;
    let x = 0;
    let y = 0;
    let shelf = 0;
    const placed: { it: typeof items[number]; x: number; y: number }[] = [];
    for (const it of items) {
      const cw = it.frames[0].width * it.frames.length + 4 * it.frames.length;
      const chh = it.frames[0].height + 4;
      if (x + cw > AW) { x = 0; y += shelf; shelf = 0; }
      placed.push({ it, x, y });
      x += cw;
      shelf = Math.max(shelf, chh);
    }
    const AH = Math.pow(2, Math.ceil(Math.log2(y + shelf)));
    const cv = document.createElement('canvas');
    cv.width = AW;
    cv.height = AH;
    const c = cv.getContext('2d')!;
    for (const { it, x: px, y: py } of placed) {
      const fw = it.frames[0].width;
      const fh = it.frames[0].height;
      it.frames.forEach((f, i) => c.drawImage(f, px + 2 + i * (fw + 4), py + 2));
      this.atlas.set(it.key, {
        u0: (px + 2) / AW, u1: (px + 2 + fw) / AW,
        v0: 1 - (py + 2 + fh) / AH, v1: 1 - (py + 2) / AH,
        w: it.w, h: it.h, du: it.frames.length > 1 ? (fw + 4) / AW : 0,
      });
    }
    // Farbe in die durchsichtigen Ränder ausdehnen (sonst mischt die Filterung dort Zufallsfarben hinein)
    const t = alphaTex(cv, 'bleed');
    t.anisotropy = Math.min(4, this.gl.capabilities.getMaxAnisotropy());
    this.mats.billboard.map = t;
  }

  setTheme(accent: string, dark: boolean) {
    this.accent = accent || '#ff5fa2';
    this.dark = dark;
  }

  warm() { /* Grafiken entstehen im Konstruktor */ }

  resize() {
    const rect = this.gl.domElement.getBoundingClientRect();
    const W = Math.max(100, Math.round(rect.width));
    const H = Math.max(100, Math.round(rect.height));
    // höchstens 1,5-fache Pixeldichte: mit Kantenglättung auf Retina kaum sichtbar, spart aber viel Füllrate
    const dpr = Math.min(1.5, window.devicePixelRatio || 1) * this.quality;
    this.W = W;
    this.H = H;
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(W, H, false);
    const odpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.overlayDirty = true;
    this.overlayCv.width = Math.round(W * odpr);
    this.overlayCv.height = Math.round(H * odpr);
    this.overlay.setTransform(odpr, 0, 0, odpr, 0, 0);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
    // (Schatten bleiben aus – nie zur Laufzeit umschalten, das kompiliert alle Shader neu)
  }

  // ------------------------------------------------------------------ Bild

  private lastDt = 0.016;

  /** Startkarte oder Countdown: Zeit, die Landschaft vollständig aufzubauen (niemand fährt) */
  private idleBuild = false;
  /** Rechenzeit für Landschaft und Abschnitte im letzten Bild (ms) */
  private work = 0;
  /** Entsteht gerade Landschaft? (dann zählt das Bild nicht für die Qualitätsregelung) */
  get busy(): boolean { return this.work > 3 || !!this.pending || !this.boxSet.every(Boolean); }

  draw(g: RaceView, dt: number) {
    this.lastDt = dt;
    this.idleBuild = g.phase === 'ready' || g.phase === 'countdown';
    this.time.value += dt;
    if (this.track !== g.track) {
      // gleiche Tagesstrecke (neuer Lauf, nachgeladene Namen): Landschaft behalten – sie ist identisch,
      // ein Neuaufbau würde ruckeln. Nur Namen auf Schildern und Straße ändern sich.
      const old = this.track;
      if (old && old.dayKey === g.track.dayKey && old.kind === g.track.kind) {
        this.track = g.track;
        this.terrain?.setTrack(g.track);
        this.cam.init = false; this.runners = []; this.runNext = 0;
        if (old.names.join('|') !== g.track.names.join('|')) { this.setAds(g.track.names); this.clearChunks(); }
      } else this.reset(g.track);
    }
    const fk = g.friends.map((f) => `${f.userId}:${f.meters}`).join('|');
    if (fk !== this.friendsKey) {
      // nur die Abschnitte neu bauen, in denen sich ein Bestmarken-Bogen ändert
      const was = new Set(this.friendsKey ? this.friendsKey.split('|') : []);
      const now = new Set(fk ? fk.split('|') : []);
      for (const e of [...was, ...now]) {
        if (was.has(e) && now.has(e)) continue;
        const m = Number(e.split(':').pop());
        const k = Math.floor(m / SEG / CH);
        const c = this.chunks.get(k);
        if (c) { this.scene.remove(c.group); c.dispose(); this.chunks.delete(k); }
      }
      this.friendsKey = fk;
    }
    const p = g.p;
    const track = g.track;
    const seg = track.segAt(p.z);
    const biome = track.sections[seg.sec].biome;

    this.updateLight(g, biome, seg, dt);
    // Landschaftsproben zuerst: die Abschnitte fragen beim Bau nach Geländehöhen
    if (this.terrain?.window(Math.max(0, p.z - 520), p.z + 3000)) {
      // neue oder weggefallene Straßenstücke ändern die Höhen ringsum: betroffene Kacheln neu bauen
      for (const [x0, z0, x1, z1] of this.terrain.takeDirty()) {
        for (const t of this.tiles.values()) {
          const b = t.box;
          if (b[0] < x1 && b[2] > x0 && b[1] < z1 && b[3] > z0) t.stale = true;
        }
      }
    }
    const w0 = performance.now();
    this.updateChunks(g);
    this.updateCamera(g, dt);
    if (this.debugCam) {
      const d = this.debugCam;
      this.camera.position.set(d[0], d[1], d[2]);
      this.camera.lookAt(d[3], d[4], d[5]);
    }
    this.updateEnvironment(biome, dt);
    this.updateTerrain(g);
    this.work = performance.now() - w0;
    this.updateRiders(g);
    this.updateSky(g, biome, dt);
    if (this.fallMat?.map) this.fallMat.map.offset.y -= dt * 0.9;
    this.updateCrowd(g, dt);
    this.updateObjects(g);
    this.updateParticles(g);
    // nahe Bäume als 3D (dieselbe Grenze wie im Bildbaum-Shader, dieselbe Kameraposition)
    this.nearTrees.update(this.camera.position.x, this.camera.position.z, this.treeSrc);
    this.gl.render(this.scene, this.camera);
    this.drawOverlay(g);
  }

  /** Himmel: Flieger; in den Finals der Hubschrauber über der Spitze des Feldes */
  private updateSky(g: RaceView, biome: BiomeId, dt: number) {
    const t = g.track;
    let leader: THREE.Vector3 | null = null;
    if (t.kind !== 'descent') {
      let z = g.p.z;
      let x = g.p.x;
      for (const o of g.opps) if (o.z > z) { z = o.z; x = o.x; }
      t.world(z, x, 0, this.w2);
      leader = this.leaderV.set(this.w2.x, this.w2.y, this.w2.z);
    }
    this.skyLife.update(t, g.p.z, this.time.value, dt, biome, this.night, leader, this.camera.position);
  }

  private reset(track: Track) {
    this.track = track;
    this.skyLife.reset();
    this.tunSpan.clear();
    this.clearTiles();
    this.terrain = new Terrain(track);
    this.setAds(track.names);
    this.clearChunks();
    this.cam.init = false;
    this.runners = [];
    this.runNext = 0;
  }

  private setAds(names: string[]) {
    const old = this.mats.ads.map;
    this.mats.ads.map = this.tex(adsTex(names));
    this.mats.ads.map.wrapS = this.mats.ads.map.wrapT = THREE.ClampToEdgeWrapping;
    this.mats.ads.needsUpdate = true;
    old?.dispose();
  }

  private clearTiles() {
    for (const t of this.tiles.values()) this.dropTile(t);
    this.tiles.clear();
    this.pending = null;
    for (const b of this.lvBox) b.set(1e9, 1e9, -1e9, -1e9);
    this.boxSet.fill(false);
  }

  private dropTile(t: Tile) {
    if (t.tsrc) this.treeSrc.delete(t.tsrc);
    for (const o of t.objs) {
      this.scene.remove(o);
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      if (o.userData.bb) disposeBillboards((o as THREE.Mesh).geometry);
    }
    for (const g of t.geos) g.dispose();
  }

  /**
   * Landschaftskacheln rund um die Kamera nachladen: feinste Stufe zuerst, nächstgelegene zuerst,
   * mit Zeitbudget je Bild. Alte Kacheln verschwinden erst, wenn der neue Ring vollständig ist.
   */
  private updateTerrain(g: RaceView) {
    const T = this.terrain;
    if (!T) return;
    void g;
    const cp = this.camera.position;
    const t0 = performance.now();
    // großer Sprung (neuer Lauf): wie beim Start schrittweise neu aufbauen
    const jump = this.lastTerrCam.distanceTo(cp) > 250;
    this.lastTerrCam.copy(cp);
    this.camera.getWorldDirection(this.terrDir);
    this.terrDir.y = 0;
    if (this.terrDir.lengthSq() > 1e-6) {
      this.terrDir.normalize();
      // beim Aufbau und nach Sprüngen sofort, sonst langsam nachziehen (Kehren lösen keinen Sturm von Neubauten aus)
      if (jump || this.tiles.size === 0) this.terrFwd.copy(this.terrDir);
      else this.terrFwd.lerp(this.terrDir, 0.03).normalize();
    }
    const fw = this.terrFwd;
    // Mittelpunkt je Stufe: ein Stück voraus (die gröbste Stufe bleibt mittig – ihr Neubau ist teuer)
    const mid = LEVELS.map((Lv, lv) => { const k = lv === 0 ? 0.75 : lv === 1 ? 0.5 : 0; return [cp.x + fw.x * Lv.size * k, cp.z + fw.z * Lv.size * k]; });
    // nach einem Sprung passen die alten Kacheln nicht mehr zur Strecke (sie stünden als Berge im Bild):
    // weg damit und wie beim Start neu aufbauen
    if (jump && this.tiles.size) this.clearTiles();
    const fresh = this.tiles.size === 0;
    const startup = !this.boxSet.every(Boolean);
    // Aufbau verteilt auf viele Bilder (kein langes Einfrieren beim Laden), beim Start etwas großzügiger.
    // Der Nahbereich (feine und mittlere Stufe) entsteht aber sofort vollständig: sonst schneidet die
    // grobe Stufe (ohne Straßenklemmen) durch Straße und Zuschauer
    // auf der Startkarte großzügig: dort soll die Welt komplett stehen, bevor es losgeht
    const budget = this.idleBuild ? 30 : startup ? 12 : 4;
    if (fresh) {
      this.pending = null;
      for (const lv of [0, 1]) {
        const Lv = LEVELS[lv];
        const cx = Math.floor(mid[lv][0] / Lv.size);
        const cz = Math.floor(mid[lv][1] / Lv.size);
        for (let j = cz - 1; j <= cz + 1; j++) {
          for (let i = cx - 1; i <= cx + 1; i++) if (!this.tiles.has(`${lv}:${i}:${j}`)) this.buildTile(T, lv, i, j, t0, Infinity);
        }
      }
    }
    // angefangene Kachel weiterbauen (nach einem Fensterwechsel neu beginnen: die Proben haben sich geändert)
    if (this.pending && this.pending.ver !== T.version) {
      const [, i, j] = this.pending.key.split(':').map(Number);
      this.pending = { ...this.pending, gen: T.tileSteps(this.pending.lv, i, j), ver: T.version };
    }
    while (this.pending && performance.now() - t0 < budget) {
      const r = this.pending.gen.next();
      if (r.done) { this.putTile(this.pending.key, this.tileObjects(r.value, this.pending.lv, this.pending.key)); this.pending = null; }
    }
    const centers = LEVELS.map((Lv, lv) => [Math.floor(mid[lv][0] / Lv.size), Math.floor(mid[lv][1] / Lv.size)]);
    const ringOf = (lv: number, key: string) => {
      const [, i, j] = key.split(':').map(Number);
      return Math.max(Math.abs(i - centers[lv][0]), Math.abs(j - centers[lv][1]));
    };
    // 1) fehlende Kacheln: beim Start erst der Nahbereich, dann die Ferne (damit nie Leere sichtbar ist),
    //    danach der Rest; nächste zuerst
    const order: [number, number][] = startup ? [[0, 1], [1, 1], [2, 9], [1, 9], [0, 9]] : [[0, 9], [1, 9], [2, 9]];
    let out = !!this.pending;
    for (const [lv, maxR] of order) {
      if (out) break;
      const Lv = LEVELS[lv];
      const [cx, cz] = centers[lv];
      const want: [number, number, number][] = [];
      const R = Math.min(maxR, Lv.ring);
      for (let j = cz - R; j <= cz + R; j++) {
        for (let i = cx - R; i <= cx + R; i++) want.push([i, j, (i + 0.5 - cp.x / Lv.size) ** 2 + (j + 0.5 - cp.z / Lv.size) ** 2]);
      }
      want.sort((a, b) => a[2] - b[2]);
      for (const [i, j] of want) {
        if (this.tiles.has(`${lv}:${i}:${j}`)) continue;
        if (!this.buildTile(T, lv, i, j, t0, budget)) { out = true; break; }
      }
    }
    // 2) Abdeckung je Stufe melden (gröbere Stufe sinkt darunter ab)
    for (let lv = 0; lv < LEVELS.length; lv++) {
      const Lv = LEVELS[lv];
      const [cx, cz] = centers[lv];
      // größter vollständiger Ring um die Kamera
      let rc = -1;
      for (let r = 0; r <= Lv.ring; r++) {
        let ok = true;
        for (let j = cz - r; j <= cz + r && ok; j++) for (let i = cx - r; i <= cx + r && ok; i++) if (!this.tiles.has(`${lv}:${i}:${j}`)) ok = false;
        if (!ok) break;
        rc = r;
      }
      if (!this.boxSet[lv]) {
        // Aufbau: nur der vollständige Teil ist sichtbar, die gröbere Stufe deckt den Rest
        if (rc >= 0) this.lvBox[lv].set((cx - rc) * Lv.size, (cz - rc) * Lv.size, (cx + rc + 1) * Lv.size, (cz + rc + 1) * Lv.size);
        else this.lvBox[lv].set(1e9, 1e9, -1e9, -1e9);
        for (const [key, t] of this.tiles) {
          if (t.lv !== lv) continue;
          const vis = ringOf(lv, key) <= rc;
          for (const o of t.objs) o.visible = vis;
          if (t.tsrc) t.tsrc.on = vis;
        }
        if (rc === Lv.ring) this.boxSet[lv] = true;
      } else if (rc === Lv.ring) {
        this.lvBox[lv].set((cx - rc) * Lv.size, (cz - rc) * Lv.size, (cx + rc + 1) * Lv.size, (cz + rc + 1) * Lv.size);
      }
      // Ring vollständig: Überzähliges entfernen
      if (rc === Lv.ring) {
        for (const [key, t] of this.tiles) {
          if (t.lv === lv && ringOf(lv, key) > Lv.ring) { this.dropTile(t); this.tiles.delete(key); }
        }
      }
    }
    if (out) return;
    // 3) veraltete Kacheln erneuern (die alten bleiben stehen, bis die neuen fertig sind)
    for (let lv = 0; lv < LEVELS.length; lv++) {
      const Lv = LEVELS[lv];
      const [cx, cz] = centers[lv];
      for (let j = cz - Lv.ring; j <= cz + Lv.ring; j++) {
        for (let i = cx - Lv.ring; i <= cx + Lv.ring; i++) {
          if (!this.tiles.get(`${lv}:${i}:${j}`)?.stale) continue;
          if (!this.buildTile(T, lv, i, j, t0, budget)) return;
        }
      }
    }
  }

  /** Kachel beginnen und im Rahmen des Budgets fertigbauen (sonst im nächsten Bild weiter); true = fertig */
  private buildTile(T: Terrain, lv: number, i: number, j: number, t0: number, budget: number): boolean {
    if (performance.now() - t0 > budget) return false;
    const key = `${lv}:${i}:${j}`;
    this.pending = { key, lv, gen: T.tileSteps(lv, i, j), ver: T.version };
    while (this.pending && performance.now() - t0 < budget) {
      const r = this.pending.gen.next();
      if (r.done) { this.putTile(key, this.tileObjects(r.value, lv, key)); this.pending = null; }
    }
    return !this.pending;
  }

  /** fertige Kachel einsetzen (eine veraltete mit gleichem Schlüssel verschwindet erst jetzt) */
  private putTile(key: string, t: Tile) {
    const old = this.tiles.get(key);
    if (old) this.dropTile(old);
    this.tiles.set(key, t);
  }

  private tileObjects(d: TileData, lv: number, key: string): Tile {
    const [, tx, tz] = key.split(':').map(Number);
    const size = LEVELS[lv].size;
    let tsrc: TreeSource | null = null;
    const objs: THREE.Object3D[] = [];
    const geos: THREE.BufferGeometry[] = [d.geo];
    const mesh = new THREE.Mesh(d.geo, this.terrMats[lv]);
    mesh.receiveShadow = lv === 0;
    objs.push(mesh);
    if (d.water) {
      geos.push(d.water);
      const w = new THREE.Mesh(d.water, this.waterMats[lv]);
      w.renderOrder = 2;
      objs.push(w);
    }
    if (d.trees.length) {
      // alle Bäume der Kachel als Bilder in einem Zeichenaufruf; die nächsten zeigt NearTrees als 3D-Modelle
      const rec = new Float32Array(d.trees.length * TREC);
      d.trees.forEach((t, k) => {
        const o = k * TREC;
        // jeder Baum etwas anders: heller/dunkler, gelblicher oder bläulicher
        const hv = ((t.rot * 7.3) % 1) * 2 - 1;
        rec[o] = t.x; rec[o + 1] = t.y; rec[o + 2] = t.z; rec[o + 3] = t.s; rec[o + 4] = t.rot;
        rec[o + 5] = t.tint * (1 + 0.1 * hv); rec[o + 6] = t.tint * (0.98 + 0.05 * Math.abs(hv)); rec[o + 7] = t.tint * (1 - 0.13 * hv);
        rec[o + 8] = treeVariant(t.kind, (t.rot * 13.17) % 1);
      });
      tsrc = { box: [tx * size, tz * size, (tx + 1) * size, (tz + 1) * size], rec, n: d.trees.length, on: true };
      const bg = treeBillboards(tsrc, this.treeAtlas);
      const bm = new THREE.Mesh(bg, this.bbMat);
      bm.userData.bb = true;
      objs.push(bm);
      this.treeSrc.add(tsrc);
    }
    if (d.falls) {
      if (!this.fallMat) {
        const t = alphaTex(fallTex(), [235, 244, 250]);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        this.fallMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(0.95, 0.97, 1) });
      }
      geos.push(d.falls);
      const fm = new THREE.Mesh(d.falls, this.fallMat);
      fm.renderOrder = 3;
      objs.push(fm);
    }
    if (d.marks.length) {
      // alle Landmarken der Kachel in einer Geometrie (ein Zeichenaufruf statt einem je Art)
      let total = 0;
      for (const t of d.marks) {
        const g = this.markGeo[t.kind as Landmark];
        if (g) total += g.index ? g.index.count : g.getAttribute('position').count;
      }
      if (total) {
        const pos = new Float32Array(total * 3);
        const col = new Float32Array(total * 3);
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        const v = new THREE.Vector3();
        const p0 = new THREE.Vector3();
        const sc = new THREE.Vector3();
        let o = 0;
        for (const t of d.marks) {
          const g = this.markGeo[t.kind as Landmark];
          if (!g) continue;
          const P = g.getAttribute('position');
          const C = g.getAttribute('color');
          const ix = g.index;
          const n = ix ? ix.count : P.count;
          q.setFromAxisAngle(up, t.rot);
          m.compose(p0.set(t.x, t.y, t.z), q, sc.set(t.s, t.s, t.s));
          for (let i = 0; i < n; i++) {
            const k = ix ? ix.getX(i) : i;
            v.fromBufferAttribute(P, k).applyMatrix4(m);
            pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
            col[o * 3] = (C ? C.getX(k) : 1) * t.tint; col[o * 3 + 1] = (C ? C.getY(k) : 1) * t.tint; col[o * 3 + 2] = (C ? C.getZ(k) : 1) * t.tint;
            o++;
          }
        }
        const mg = new THREE.BufferGeometry();
        mg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        mg.setAttribute('color', new THREE.BufferAttribute(col, 3));
        mg.computeBoundingSphere();
        geos.push(mg);
        objs.push(new THREE.Mesh(mg, this.markMat));
      }
    }
    for (const o of objs) { o.matrixAutoUpdate = false; o.updateMatrix(); this.scene.add(o); }
    return { lv, key, objs, geos, tsrc, box: [tx * size, tz * size, (tx + 1) * size, (tz + 1) * size] };
  }

  private clearChunks() {
    for (const c of this.chunks.values()) { this.scene.remove(c.group); c.dispose(); }
    this.chunks.clear();
  }

  /** Radlampen erst bei Dunkelheit (und im Tunnel) – nicht schon im Abendlicht der Finals */
  private bikeLight(): number { return Math.max(0, this.night - 0.62) * 2.6 + this.tunnelDim; }

  /** nur für Tests: feste Tageszeit (0 Mittag … 0.7 Sonnenuntergang) */
  debugTod: number | null = null;

  /**
   * Tageszeit über die Fahrt: jede Fahrt beginnt am Nachmittag und endet im Abendlicht – Sprint- und
   * Bergfinale im Sonnenuntergang mit Laternen und hellen Fenstern, die Abfahrt wird mit der Strecke später
   */
  private todAt(g: RaceView): number {
    if (this.debugTod !== null) return this.debugTod;
    const t = this.track!;
    const v = hash(t.seed);
    if (t.kind === 'descent') return 0.1 + v * 0.08 + 0.56 * smooth01(g.p.z / 7500);
    const fin = t.kind === 'sprint' ? SPRINT_FINISH : MOUNTAIN_FINISH;
    const a = 0.16 + v * 0.12;
    const b = 0.62 + hash(t.seed + 7) * 0.05;
    return a + (b - a) * smooth01(g.p.z / fin);
  }

  private updateLight(g: RaceView, biome: BiomeId, seg: Seg, dt: number) {
    const tod = this.todAt(g);
    const L = lightAt(tod);
    this.light = L;
    this.night = L.lights;
    const pal = BIOME_PALETTES[biome];
    const inTunnel = seg.tunnel ? 1 : 0;
    this.tunnelDim += (inTunnel - this.tunnelDim) * Math.min(1, dt * 3);
    const dim = 1 - this.tunnelDim * 0.55;
    const haze = mixRGB(pal.haze, L.hazeMix, L.hazeAmt);
    const fogC = new THREE.Color().setRGB(haze[0] / 255, haze[1] / 255, haze[2] / 255, THREE.SRGBColorSpace);
    this.fog.color.copy(fogC);
    // klare Bergluft: Nahes knackig, Fernes sanft im Dunst
    // Luftperspektive: Fernes verblasst deutlich – gibt den Bergen Tiefe statt einer Wand
    this.fog.density = 0.00085 + L.hazeAmt * 0.0002;
    const tint = new THREE.Color().setRGB(L.tint[0] / 255, L.tint[1] / 255, L.tint[2] / 255, THREE.SRGBColorSpace);
    // abends etwas weniger Licht – aber die Strecke bleibt gut lesbar
    const dayK = 1 - L.lights * 0.45;
    this.hemi.color.setRGB(0.74, 0.84, 1, THREE.SRGBColorSpace).multiply(tint);
    // Bodenlicht: helle Wiesen, Fels und Schnee werfen viel Licht zurück – auch Schattenseiten bleiben freundlich
    this.hemi.groundColor.setRGB(0.64, 0.6, 0.5, THREE.SRGBColorSpace).multiply(tint);
    this.hemi.intensity = (1.0 + 0.35 * dayK) * dim;
    const sunC = new THREE.Color().setRGB(L.sun[0] / 255, L.sun[1] / 255, L.sun[2] / 255, THREE.SRGBColorSpace);
    this.sun.color.copy(sunC);
    this.sun.intensity = Math.max(0.55, Math.min(2.7, (L.sunY + 0.12) * 6.5)) * dayK * dim;
    // Sonnenstand: am Nachmittag schräg von hinten (die Berge vor einem liegen im Licht), zum Abend hin
    // wandert die Sonne nach Westen, steht tiefer und taucht seitlich vor einem ins Abendrot
    const el = Math.max(-0.2, L.sunY) * 1.5 + 0.18;
    const az = Math.PI - 0.6 + Math.min(0.75, L.t) * 2.1;
    const sd = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
    const c = this.shadowCenter(g, sd);
    this.sun.position.copy(c).addScaledVector(sd, 220);
    this.sun.target.position.copy(c);
    // Gegenlicht: von der anderen Seite, flacher, bläulich wie Himmelslicht
    this.fill.position.copy(this.camera.position).add(new THREE.Vector3(-sd.x, 0.45, -sd.z).normalize().multiplyScalar(200));
    this.fill.target.position.copy(this.camera.position);
    this.fill.intensity = 0.62 * dayK * dim;
    // Spiegelungen auf Lack, Chrom und Helmen werden mit dem Licht dunkler
    setGlossEnv(Math.max(0.2, 1 - L.lights * 0.8) * dim);
    const u = this.skyMat.uniforms;
    const top = mixRGB(L.skyTop, pal.skyTop, 0.35 * (1 - L.t));
    const hz = mixRGB(L.skyHorizon, pal.skyHorizon, 0.35 * (1 - L.t));
    (u.top.value as THREE.Color).setRGB(top[0] / 255, top[1] / 255, top[2] / 255, THREE.SRGBColorSpace);
    (u.horizon.value as THREE.Color).setRGB(hz[0] / 255, hz[1] / 255, hz[2] / 255, THREE.SRGBColorSpace);
    (u.below.value as THREE.Color).copy(fogC);
    (u.sunDir.value as THREE.Vector3).copy(sd);
    (u.sunCol.value as THREE.Color).copy(sunC).multiplyScalar(L.sunY > -0.1 ? 1 : 0);
    this.mats.facade.emissiveIntensity = L.lights * 1.25;
    this.mats.sign.emissiveIntensity = L.lights * 0.75;
    const dusk = Math.max(0, Math.min(1, (L.lights - 0.08) / 0.4));
    this.mats.bulb.opacity = dusk;
    this.mats.lantern.opacity = dusk * 0.85;
    this.mats.glow.opacity = Math.max(0, L.lights - 0.2) * 1.1;
    if (!this.holeMode) this.valleyMat.color.copy(fogC);
    // Berge am Horizont: dasselbe Licht wie die Landschaft (Lambert: Lichtfarbe · Stärke / π)
    {
      const P = this.peakU;
      const ip = 1 / Math.PI;
      P.uSunDir.value.copy(sd);
      P.uSunC.value.copy(this.sun.color).multiplyScalar(this.sun.intensity * ip);
      P.uSkyC.value.copy(this.hemi.color).multiplyScalar(this.hemi.intensity * ip);
      P.uGroundC.value.copy(this.hemi.groundColor).multiplyScalar(this.hemi.intensity * ip);
      P.uFillDir.value.set(-sd.x, 0.45, -sd.z).normalize();
      P.uFillC.value.copy(this.fill.color).multiplyScalar(this.fill.intensity * ip);
      P.uHaze.value.copy(fogC);
    }
    // Tunnel: warmweiße Leuchten, an den Portalen Tageslicht in der Farbe des Dunstes
    // Augen gewöhnen sich an das Dunkel: im Tunnel heller belichten – die Röhre bleibt gleich, draußen
    // (am Ausgang) wird es gleißend hell
    const adapt = 1 + this.tunnelDim * 0.55;
    this.gl.toneMappingExposure = 1.08 * adapt;
    this.tunU.uDay.value.copy(fogC).multiplyScalar((0.9 + Math.min(2.7, this.sun.intensity / Math.max(0.2, dim)) * 0.32) / adapt);
    this.tunU.uLamp.value.setRGB(1.0, 0.82, 0.58).multiplyScalar(15 / adapt);
    this.tunU.uAmb.value = 0.06 / adapt;

    const water = pal.water;
    this.mats.water.color.setRGB(water[0] / 255, water[1] / 255, water[2] / 255, THREE.SRGBColorSpace);
    for (const m of this.waterMats) m.color.copy(this.mats.water.color);
  }

  private sc0 = new THREE.Vector3();
  private sAx = new THREE.Vector3();
  private sAy = new THREE.Vector3();
  /** Mittelpunkt des Schattenbereichs: etwas vor dem Fahrer, im Lichtraum auf Texelgröße gerastet */
  private shadowCenter(g: RaceView, sd: THREE.Vector3): THREE.Vector3 {
    const w = this.track!.world(g.p.z + 16, 0, 0, this.w2);
    const c = this.sc0.set(w.x, w.y, w.z);
    const ax = this.sAx.set(0, 1, 0).cross(sd).normalize();
    const ay = this.sAy.copy(sd).cross(ax).normalize();
    const texel = 72 / 1024;
    const u = Math.round(c.dot(ax) / texel) * texel - c.dot(ax);
    const v = Math.round(c.dot(ay) / texel) * texel - c.dot(ay);
    return c.addScaledVector(ax, u).addScaledVector(ay, v);
  }

  private updateCamera(g: RaceView, dt: number) {
    const p = g.p;
    const track = g.track;
    const cam = this.cam;
    const w = this.w;
    const roadY = track.heightAt(p.z);
    const air = Math.max(0, p.y - roadY);
    track.world(p.z, p.x, 0, w);
    const rx = w.x;
    const ry = w.y + air;
    const rz = w.z;
    // Blickrichtung = Fahrtrichtung des Fahrers (Straße plus Querbewegung), geglättet:
    // die Kamera steht immer direkt hinter ihm, er bleibt in der Bildmitte – auch in Kehren
    const yaw = w.th + Math.atan2(p.vx, Math.max(5, p.v)) * 0.3;
    // Rennfinale: höher und weiter hinten (Motorradkamera), damit man über das Feld schaut –
    // im Bergfinale bergab wieder die nahe Abfahrtskamera (weich überblendet)
    const wantPack = track.kind === 'sprint' || (track.kind === 'mountain' && p.z < MOUNTAIN_TOP + 25) ? 1 : 0;
    if (!cam.init || g.phase === 'ready' || g.phase === 'countdown') cam.pack = wantPack;
    else cam.pack += (wantPack - cam.pack) * Math.min(1, dt * 1.2);
    const back = CAM_BACK + (SPRINT_BACK - CAM_BACK) * cam.pack;
    const behindY = track.heightAt(Math.max(0, p.z - back));
    const ty = Math.max(behindY, roadY) + CAM_UP + (SPRINT_UP - CAM_UP) * cam.pack + air * 0.35;
    if (!cam.init || g.phase === 'ready' || g.phase === 'countdown') {
      cam.th = yaw;
      cam.y = ty;
      cam.init = true;
    }
    let d = yaw - cam.th;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    cam.th += d * Math.min(1, dt * 6);
    cam.y += (ty - cam.y) * Math.min(1, dt * 7);
    // nie unter die Straße sinken (z. B. nach einem Sprung nach vorn oder steil bergauf)
    cam.y = Math.max(cam.y, roadY + 1.2);
    const fx = Math.sin(cam.th);
    const fz = -Math.cos(cam.th);
    const shake = g.shake * 0.04;
    this.camera.position.set(rx - fx * back + (Math.random() - 0.5) * shake, cam.y + (Math.random() - 0.5) * shake, rz - fz * back);
    const look = 15 + 2 * cam.pack;
    const aheadY = track.heightAt(p.z + look);
    this.camera.lookAt(rx + fx * look, roadY + (aheadY - roadY) * 0.55 + 0.9 + air * 0.4, rz + fz * look);
    cam.x = rx; cam.z = rz;
    // Sichtfeld: hochkant mehr Höhe, bei Tempo etwas weiter (Geschwindigkeitsgefühl)
    const aspect = this.W / this.H;
    const base = aspect < 1 ? 72 - (aspect - 0.45) * 22 : 56;
    const want = base + Math.min(9, Math.max(0, (p.v - 14) * 0.38));
    cam.fov += (want - cam.fov) * Math.min(1, dt * 2);
    if (Math.abs(this.camera.fov - cam.fov) > 0.01) { this.camera.fov = cam.fov; this.camera.updateProjectionMatrix(); }
    void ry;
  }

  private updateEnvironment(biome: BiomeId, dt: number) {
    const cp = this.camera.position;
    this.sky.position.copy(cp);
    this.valley.position.set(cp.x, cp.y - 1400, cp.z);
    if (biome !== this.mtnBiome) {
      if (this.mtnOld) { this.scene.remove(this.mtnOld); this.mtnOld.geometry.dispose(); (this.mtnOld.material as THREE.Material).dispose(); }
      this.mtnOld = this.mtn;
      this.peakU.uNoise.value ??= this.noiseMap;
      this.mtn = buildPeaks(biome, this.peakU);
      this.scene.add(this.mtn);
      this.mtnFade = this.mtnOld ? 0 : 1;
      this.mtnBiome = biome;
    }
    this.mtnFade = Math.min(1, this.mtnFade + dt / 2.5);
    for (const [m, a] of [[this.mtn, this.mtnFade], [this.mtnOld, 1 - this.mtnFade]] as [THREE.Mesh | null, number][]) {
      if (!m) continue;
      m.position.set(cp.x, cp.y - 240, cp.z);
      setPeakOpacity(m, a);
      m.visible = a > 0.01;
    }
    if (this.mtnFade >= 1 && this.mtnOld) {
      this.scene.remove(this.mtnOld);
      this.mtnOld.geometry.dispose();
      (this.mtnOld.material as THREE.Material).dispose();
      this.mtnOld = null;
    }
    this.clouds.forEach((c, i) => {
      const a = hash(i + 40) * Math.PI * 2 + this.time.value * 0.003;
      const r = 1800 + hash(i + 50) * 1200;
      c.position.set(cp.x + Math.cos(a) * r, cp.y + 380 + hash(i + 60) * 420, cp.z + Math.sin(a) * r);
      (c.material as THREE.SpriteMaterial).opacity = 0.85 * (1 - this.light.stars * 0.6);
      (c.material as THREE.SpriteMaterial).color.setRGB(this.light.tint[0] / 255, this.light.tint[1] / 255, this.light.tint[2] / 255, THREE.SRGBColorSpace);
    });
  }

  // ------------------------------------------------------------------ Abschnitte

  /** Abschnitt im Bau (in Schritten) */
  private chunkGen: { k: number; it: Generator<void, Chunk, void> } | null = null;

  private updateChunks(g: RaceView) {
    const z = g.p.z;
    const from = Math.max(0, Math.floor((z - BEHIND) / SEG / CH));
    const to = Math.floor((z + AHEAD) / SEG / CH);
    for (const [k, c] of this.chunks) {
      if (k < from || k > to + 1) { this.scene.remove(c.group); c.dispose(); this.chunks.delete(k); }
    }
    if (this.chunkGen && (this.chunkGen.k < from || this.chunkGen.k > to + 1)) this.chunkGen = null;
    // beim Start alles auf einmal (die Straße muss im ersten Bild stehen)
    if (this.chunks.size === 0) {
      this.chunkGen = null;
      for (let k = from; k <= to; k++) {
        const c = this.buildChunk(g, k);
        this.chunks.set(k, c);
        this.scene.add(c.group);
      }
      return;
    }
    // der Abschnitt unter dem Fahrer und der nächste müssen stehen (z. B. nach einem Sprung): sofort bauen
    const cur = Math.floor(z / SEG / CH);
    for (let k = Math.max(from, cur); k <= Math.min(to, cur + 1); k++) {
      if (this.chunks.has(k)) continue;
      if (this.chunkGen?.k === k) this.chunkGen = null;
      const c = this.buildChunk(g, k);
      this.chunks.set(k, c);
      this.scene.add(c.group);
    }
    // danach mit Zeitbudget je Bild (nächste zuerst), auf der Startkarte großzügiger
    const t0 = performance.now();
    const budget = this.idleBuild ? 12 : 2.5;
    while (performance.now() - t0 < budget) {
      if (!this.chunkGen) {
        let k = from;
        while (k <= to && this.chunks.has(k)) k++;
        if (k > to) break;
        this.chunkGen = { k, it: this.chunkSteps(g, k) };
      }
      const r = this.chunkGen.it.next();
      if (r.done) {
        this.chunks.set(this.chunkGen.k, r.value);
        this.scene.add(r.value.group);
        this.chunkGen = null;
      }
    }
  }

  private row(z: number, seg: Seg): Row {
    const w = this.track!.world(z, 0, 0, this.w);
    return { x: w.x, y: w.y, z: w.z, rx: Math.cos(w.th), rz: Math.sin(w.th), th: w.th, seg };
  }

  /** Abschnitt in einem Zug bauen (beim Start) */
  private buildChunk(g: RaceView, ci: number): Chunk {
    const it = this.chunkSteps(g, ci);
    for (;;) {
      const r = it.next();
      if (r.done) return r.value;
    }
  }

  /**
   * Abschnitt bauen, in Schritten (alle paar Straßenstücke eine Pause): beim Fahren verteilt sich die Arbeit
   * auf mehrere Bilder, statt eines spürbar zu verlängern
   */
  private *chunkSteps(g: RaceView, ci: number): Generator<void, Chunk, void> {
    const t = this.track!;
    const i0 = ci * CH;
    const rows: Row[] = [];
    for (let r = 0; r <= CH; r++) rows.push(this.row((i0 + r) * SEG, t.seg(i0 + r)));
    const P = (r: Row, x: number, h: number): number[] => [r.x + r.rx * x, r.y + h, r.z + r.rz * x];
    const lim = { L: [] as number[], R: [] as number[] };
    for (let r = 0; r <= CH; r++) { const [l, rr] = this.terrain!.lim(i0 + r); lim.L.push(l); lim.R.push(rr); }
    // Rechenbereich der Landschaft für diesen Abschnitt (Requisiten außerhalb des Korridors, Portale)
    let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
    for (const r of rows) { bx0 = Math.min(bx0, r.x); bz0 = Math.min(bz0, r.z); bx1 = Math.max(bx1, r.x); bz1 = Math.max(bz1, r.z); }
    this.region = this.terrain!.region(bx0 - 90, bz0 - 90, bx1 + 90, bz1 + 90);
    const region = this.region;
    const group = new THREE.Group();
    const disp: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
    const surf: Record<string, GB> = { asphalt: new GB(), fresh: new GB(), cobble: new GB(), gravel: new GB() };
    for (const b of Object.values(surf)) b.uv = true;
    const verge = new GB();
    verge.uv = true;
    const marks = new GB();
    const terr = new GB();
    terr.uv = true;
    const portal = new GB();
    const bar = new GB();
    const water = new GB();
    const tunWall = new TB();
    const tunRoad = new TB();
    const tunMarks = new TB();
    // Strecke in der Röhre ab einem Vielfachen des Leuchtenabstands kurz vor dem Abschnitt (kleine Zahlen)
    tunWall.base = tunRoad.base = tunMarks.base = Math.floor((i0 * SEG) / 60) * 60;
    const tunSigns = new GB();
    tunSigns.uv = true;
    const mas = new GB();
    mas.uv = true;
    const facade = new GB();
    facade.uv = true;
    const roof = new GB();
    const tiles = new GB();
    tiles.uv = true;
    const signGB = new GB();
    signGB.uv = true;
    const town: Town = { facade, tiles, plain: roof, signs: signGB, lanterns: [], bulbs: [] };
    const bill = new GB();
    bill.uv = true;
    const ads = new GB();
    ads.uv = true;
    this.adsGB = ads;
    const anim: number[] = [];
    const glows: number[] = [];
    const people: Person[][] = [[], [], [], []];
    const inst = new Map<Prop3D, { m: THREE.Matrix4[]; c: THREE.Color[] }>();
    this.cTrees = [];
    const cTrees = this.cTrees;
    const white = lin('#f2f2ec');
    const sec = (s: Seg) => t.sections[s.sec];

    for (let r = 0; r < CH; r++) {
      const a = rows[r];
      const b = rows[r + 1];
      const s = a.seg;
      const za = (i0 + r) * SEG;
      const zb = za + SEG;
      // --- Fahrbahn
      if (!s.tunnel) {
        const tl = s.surface === 'cobble' ? 2.2 : 5;
        // Texturkoordinaten ab einem ganzzahligen Versatz je Abschnitt: kleine Zahlen bleiben auf Handys genau
        const vo = Math.floor((i0 * SEG) / tl);
        const va = za / tl - vo;
        const vb = zb / tl - vo;
        surf[s.surface].quad(P(a, -ROAD_HALF, 0), P(a, ROAD_HALF, 0), P(b, ROAD_HALF, 0), P(b, -ROAD_HALF, 0), [1, 1, 1],
          [[-ROAD_HALF / tl, va], [ROAD_HALF / tl, va], [ROAD_HALF / tl, vb], [-ROAD_HALF / tl, vb]]);
        for (const sg of [-1, 1]) {
          const x0 = sg * ROAD_HALF;
          const x1 = sg * EDGE;
          const q = sg < 0 ? [P(a, x1, -0.04), P(a, x0, 0), P(b, x0, 0), P(b, x1, -0.04)] : [P(a, x0, 0), P(a, x1, -0.04), P(b, x1, -0.04), P(b, x0, 0)];
          const ul = sg < 0 ? [x1, x0] : [x0, x1];
          const vv = Math.floor((i0 * SEG) / 3);
          verge.quad(q[0], q[1], q[2], q[3], [1, 1, 1], [[ul[0] / 3, za / 3 - vv], [ul[1] / 3, za / 3 - vv], [ul[1] / 3, zb / 3 - vv], [ul[0] / 3, zb / 3 - vv]]);
        }
        // Markierungen
        const lines = s.surface === 'asphalt' || s.surface === 'fresh';
        const village = sec(s).biome === 'village';
        const H = 0.012;
        const strip = (x0: number, x1: number, col: RGBf) => marks.quad(P(a, x0, H), P(a, x1, H), P(b, x1, H), P(b, x0, H), col);
        if (lines || s.tunnel) {
          if (!village) { strip(-ROAD_HALF + 0.08, -ROAD_HALF + 0.2, white); strip(ROAD_HALF - 0.2, ROAD_HALF - 0.08, white); }
          if (Math.abs(s.curve) > 0.015 || s.hairpin) { strip(-0.17, -0.06, white); strip(0.06, 0.17, white); }
          else if ((s.i & 3) < 2) strip(-0.06, 0.06, white);
        }
      }
      // --- Gelände
      if (!s.tunnel) {
        for (const sg of [-1, 1]) this.terrainSide(terr, mas, a, b, sg, P, sg < 0 ? lim.L[r] : lim.R[r], sg < 0 ? lim.L[r + 1] : lim.R[r + 1]);
      } else {
        const [t0, t1, len] = this.tunnelOf(s.i);
        const zs = t0 * SEG;
        const ze = (t1 + 1) * SEG;
        tunnelRing(tunWall, tunRoad, tunMarks, tunSigns, a, b, P, {
          za, zb, dpa: Math.min(za - zs, ze - za), dpb: Math.min(zb - zs, ze - zb), lamp: s.lamp, len,
        });
      }
      // --- Begrenzungen
      this.barriers(bar, ads, a, b, P);
      // --- Malereien
      if (s.decals) for (const d of s.decals) this.decal(group, disp, marks, rows, r, d, P);
      // --- Häuser
      for (const sg of [-1, 1]) {
        const bld = sg < 0 ? s.bL : s.bR;
        if (bld && bld.start === s.i) this.building(town, a, bld, sg);
      }
      // Wimpel- und Lichterketten quer über die Gasse
      if (s.bL && s.bR && s.i % 17 === 9 && !s.banner) this.garland(town, a, s.bL, s.bR);
      // --- Sprites/Requisiten
      if (s.sprites) {
        for (const sp of s.sprites) {
          const l = sp.x < 0 ? lim.L[r] : lim.R[r];
          if (sp.k === 'crowd') this.crowdPeople(people[Math.min(3, Math.floor(r / 10))], s, sp.x < 0 ? -1 : 1, l, sp.v, Math.abs(sp.x) - EDGE);
          else this.prop(group, disp, inst, bill, anim, glows, a, sp, s, l);
        }
      }
      // --- Banner, Portal
      if (s.banner) {
        const k = s.banner.kind;
        this.arch(group, disp, a, s.banner, k === 'gpm' || k === 'finish' ? this.accent : k === 'sprint' ? '#1f6feb' : k === 'flamme' ? '#d63031' : '#ffffff');
      }
      for (const f of g.friends) if (Math.floor(f.meters / SEG) === s.i) this.arch(group, disp, a, { kind: 'arch', text: f.userId === 'me' ? 'Deine Bestmarke' : `Bestmarke ${f.name}`, sub: fmtKm(f.meters) }, f.color);
      if (s.portal === 1) this.portal(portal, mas, roof, group, disp, a, P, sec(s).biome, 1);
      if (s.portal === 2) this.portal(portal, mas, roof, group, disp, b, P, sec(s).biome, -1);
      if (r % 4 === 3) {
        yield;
        // zwischendurch kann anderes gelaufen sein: gemeinsamen Bauzustand wiederherstellen
        this.region = region;
        this.adsGB = ads;
        this.cTrees = cTrees;
      }
    }
    yield;
    this.region = region;
    this.adsGB = ads;
    this.cTrees = cTrees;

    const add = (gb: GB, m: THREE.Material, order = 0, cast = false) => {
      if (gb.empty) return;
      const geo = gb.build();
      disp.push(geo);
      const mesh = new THREE.Mesh(geo, m);
      mesh.renderOrder = order;
      mesh.receiveShadow = true;
      mesh.castShadow = cast;
      group.add(mesh);
    };
    add(surf.asphalt, this.mats.asphalt);
    add(surf.fresh, this.mats.fresh);
    add(surf.cobble, this.mats.cobble);
    add(surf.gravel, this.mats.gravel);
    add(verge, this.mats.verge);
    add(marks, this.mats.marks, 1);
    // Gelände neben der Straße weich schattiert (keine harten Kanten zwischen den Bändern)
    if (!terr.empty) {
      const geo = terr.buildSmooth(null);
      disp.push(geo);
      const mesh = new THREE.Mesh(geo, this.mats.terrain);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    add(portal, this.mats.portal, 0, true);
    add(bar, this.mats.barrier, 0, true);
    add(water, this.mats.water, 2);
    for (const [tb, m] of [[tunWall, this.mats.tunWall], [tunRoad, this.mats.tunRoad], [tunMarks, this.mats.tunMarks]] as [TB, THREE.Material][]) {
      if (tb.empty) continue;
      const geo = tb.build();
      disp.push(geo);
      group.add(new THREE.Mesh(geo, m));
    }
    add(tunSigns, this.mats.tunSign);
    add(mas, this.mats.masonry, 0, true);
    add(facade, this.mats.facade, 0, true);
    add(roof, this.mats.roof, 0, true);
    add(tiles, this.mats.tiles, 0, true);
    add(signGB, this.mats.sign, 0);
    add(ads, this.mats.ads, 0, true);
    if (!bill.empty) {
      const geo = bill.build();
      geo.setAttribute('aAnim', new THREE.Float32BufferAttribute(anim, 3));
      disp.push(geo);
      group.add(new THREE.Mesh(geo, this.mats.billboard));
    }
    // Bäume am Straßenrand: Bilder in einem Zeichenaufruf (die nächsten als 3D über NearTrees)
    const ct = this.cTrees;
    this.cTrees = null;
    let csrc: TreeSource | null = null;
    let cbm: THREE.Mesh | null = null;
    if (ct && ct.length) {
      const n = ct.length / TREC;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < n; k++) { x0 = Math.min(x0, ct[k * TREC]); x1 = Math.max(x1, ct[k * TREC]); z0 = Math.min(z0, ct[k * TREC + 2]); z1 = Math.max(z1, ct[k * TREC + 2]); }
      csrc = { box: [x0, z0, x1, z1], rec: new Float32Array(ct), n, on: true };
      cbm = new THREE.Mesh(treeBillboards(csrc, this.treeAtlas), this.bbMat);
      group.add(cbm);
      this.treeSrc.add(csrc);
    }
    for (const [kind, list] of inst) {
      const geo = this.props[kind];
      if (!geo) continue;
      const im = new THREE.InstancedMesh(geo, this.mats.props, list.m.length);
      im.castShadow = true;
      im.receiveShadow = true;
      list.m.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, list.c[i]); });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      group.add(im);
    }
    const crowd: CrowdBatch[] = [];
    const crowdGeos: THREE.BufferGeometry[] = [];
    const sprGeos: THREE.BufferGeometry[] = [];
    for (const list of people) {
      if (!list.length) continue;
      const c = new THREE.Vector3();
      for (const pp of list) { c.x += pp.x; c.y += pp.y; c.z += pp.z; }
      c.divideScalar(list.length);
      let rad = 0;
      for (const pp of list) rad = Math.max(rad, Math.hypot(pp.x - c.x, pp.y - c.y, pp.z - c.z));
      const sphere = new THREE.Sphere(c, rad + 4);
      const batch: CrowdBatch = { near: [], mid: [], spr: null, c, r: rad, lod: -1 };
      // nah: echte 3D-Menschen (ganz nah fein, bis 30 m vereinfacht)
      for (const kind of KINDS) {
        const sub = list.filter((pp) => needs(pp, kind));
        if (!sub.length) continue;
        const data = new Float32Array(sub.length * STRIDE);
        sub.forEach((pp, k) => packPerson(pp, data, k));
        for (const lod of [0, 1] as const) {
          const geo = crowdGeometry(kind, lod, data, sub.length);
          if (!geo) continue;
          geo.boundingSphere = sphere.clone();
          crowdGeos.push(geo);
          const m = new THREE.Mesh(geo, this.crowdMat);
          m.visible = false;
          group.add(m);
          (lod ? batch.mid : batch.near).push(m);
        }
      }
      // weiter weg: alle als Bilder in einem Zeichenaufruf
      const sg = spriteGeometry(list);
      sg.boundingSphere = sphere.clone();
      sprGeos.push(sg);
      const sm = new THREE.Mesh(sg, this.sprMat);
      sm.visible = false;
      group.add(sm);
      batch.spr = sm;
      crowd.push(batch);
    }
    let glow: THREE.Points | null = null;
    if (glows.length) {
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(glows, 3));
      disp.push(gg);
      glow = new THREE.Points(gg, this.mats.glow);
      glow.renderOrder = 5;
      group.add(glow);
    }
    for (const [pts, mat] of [[town.lanterns, this.mats.lantern], [town.bulbs, this.mats.bulb]] as const) {
      if (!pts.length) continue;
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      disp.push(gg);
      const pm = new THREE.Points(gg, mat);
      pm.renderOrder = 5;
      group.add(pm);
    }
    // alles im Abschnitt steht still: Matrizen einmal rechnen statt in jedem Bild
    group.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
    group.updateMatrixWorld(true);
    return {
      idx: ci, group, glow, crowd,
      dispose: () => {
        for (const d of disp) d.dispose();
        for (const geo of crowdGeos) disposeCrowdGeometry(geo);
        if (csrc) this.treeSrc.delete(csrc);
        if (cbm) disposeBillboards(cbm.geometry);
        for (const geo of sprGeos) disposeSpriteGeometry(geo);
        group.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
      },
    };
  }

  /** Querprofil des Geländes neben dem Bankett: Abstände ab Bankettkante und Höhen */
  private profile(side: Side, s: Seg, sg: number, lim = LIM_MAX): { o: number[]; h: number[]; cols: RGBf[] } {
    const pr = this.rawProfile(side, s, sg);
    // am Korridorrand abschneiden – dahinter geht die Landschaft mit demselben Querprofil weiter
    const maxO = Math.max(1.5, lim - EDGE);
    for (let k = 1; k < pr.o.length; k++) {
      if (pr.o[k] <= maxO) continue;
      const t = (maxO - pr.o[k - 1]) / Math.max(1e-6, pr.o[k] - pr.o[k - 1]);
      const h = pr.h[k - 1] + (pr.h[k] - pr.h[k - 1]) * Math.max(0, Math.min(1, t));
      for (let q = k; q < pr.o.length; q++) { pr.o[q] = maxO; pr.h[q] = h; }
      break;
    }
    return pr;
  }

  /** Höhe des Geländes in Abstand dx vom Bankett (für Bäume, Häuser, Felsen) */
  private groundAt(side: Side, s: Seg, sg: number, dx: number, lim: number): number | null {
    const pr = this.profile(side, s, sg, lim);
    const o = pr.o;
    if (dx > o[o.length - 1] + 0.5) return null;
    for (let k = 0; k < o.length - 1; k++) {
      if (dx <= o[k + 1]) {
        const t = (dx - o[k]) / Math.max(1e-6, o[k + 1] - o[k]);
        return pr.h[k] + (pr.h[k + 1] - pr.h[k]) * Math.max(0, Math.min(1, t));
      }
    }
    return pr.h[pr.h.length - 1];
  }

  private rawProfile(side: Side, s: Seg, sg: number): { o: number[]; h: number[]; cols: RGBf[] } {
    const t = this.track!;
    const pal = BIOME_PALETTES[t.sections[s.sec].biome];
    // weiches Rauschen entlang der Strecke (keine Zacken von Segment zu Segment)
    const n = (k: number) => {
      const f = s.i / 9;
      const i0 = Math.floor(f);
      let tt = f - i0;
      tt = tt * tt * (3 - 2 * tt);
      const h0 = hash(i0 * 7919 + k * 131 + (sg > 0 ? 17 : 0));
      const h1 = hash((i0 + 1) * 7919 + k * 131 + (sg > 0 ? 17 : 0));
      return h0 + (h1 - h0) * tt - 0.5;
    };
    const gcol = (g: Side['ground'], k: number) => {
      const base = pal.ground[g === 'rock' ? 'rock' : g][0];
      return shadeF(rgbLin(base), 0.92 + n(k + 30) * 0.16);
    };
    const rock = (k: number) => shadeF(rgbLin(pal.rock), 0.85 + n(k + 50) * 0.2);
    // Alle Profile haben 9 Punkte (0–4: Nahzone/Wandfläche, 5–8: Hang), damit Übergänge sauber verbinden
    if (side.ground === 'water') {
      // Ufer bis unter den Seespiegel (der See selbst ist Teil der Landschaft)
      const lr = Math.min(-1.3, this.terrain!.lakeOf(s.sec) - s.y);
      const sand = lin('#b9ad96');
      const wet = lin('#8f8672');
      const bed = shadeF(rgbLin(pal.water), 0.55);
      const m = Math.max(lr + 0.3, -1.2);
      return {
        o: [0, 0.2, 0.4, 1.2, 2, 4, 6, 12, 20],
        h: [0, -0.22, -0.45, (-0.45 + m) / 2, m, (m + lr - 0.8) / 2, lr - 0.8, lr - 2.6, lr - 4.5],
        cols: [sand, sand, sand, wet, wet, bed, bed, bed],
      };
    }
    if (side.wall > 0 && side.stone) {
      // gemauerte Stützmauer mit Abdeckplatte, dahinter der Hang
      const W = side.wall;
      const top = side.ground === 'rock' ? 'meadow' : side.ground;
      const o = [0, 0.025, 0.05, 0.07, 0.075, 0.48, 2.2, 9, 30];
      const h = [0, W * 0.4, W * 0.75, W, W + 0.13, W + 0.13, 0, 0, 0];
      for (let k = 6; k < 9; k++) h[k] = W + 0.13 + side.tilt * (o[k] - 0.48) + (k === 6 ? n(1) * 0.3 : 0);
      const st = shadeF(lin('#c9c0b0'), 0.92 + n(80) * 0.12);
      const cap = shadeF(lin('#dcd5c8'), 0.95 + n(81) * 0.08);
      return { o, h, cols: [st, st, st, cap, shadeF(cap, 1.06), gcol(top, 2), gcol(top, 3), gcol(top, 4)] };
    }
    if (side.wall > 0) {
      // Fels- oder Schneewand: vier Bänder mit leichten Buckeln und Schichtung statt einer glatten Fläche
      const W = side.wall;
      const snow = side.ground === 'snow';
      const top = side.ground === 'rock' ? 'meadow' : side.ground;
      const j = (k: number, amp: number) => n(k + 60) * amp + (hash(s.i * 13 + k * 7 + (sg > 0 ? 3 : 0)) - 0.5) * amp * 0.35;
      const d = snow ? 0.55 : 0.3;
      const o = [0, d * 0.25 + j(1, 0.22), d * 0.5 + j(2, 0.3), d * 0.75 + j(3, 0.26), d, 1.8, 7, 16, 30];
      for (let k = 1; k < 4; k++) o[k] = Math.max(o[k - 1] + 0.01, Math.min(d - 0.01 * (4 - k), o[k] + 0.25));
      const h = [0, W * (0.27 + j(4, 0.06)), W * (0.55 + j(5, 0.06)), W * (0.8 + j(6, 0.05)), W,
        W + 0.4, W + 0.4 + side.tilt * 5.2 + n(1) * 0.4, W + 0.4 + side.tilt * 14.2, W + 0.4 + side.tilt * 28.2];
      const band = (k: number, f: number) => snow
        ? shadeF(lin('#e9f1fa'), f + n(40 + k) * 0.08)
        : shadeF(rgbLin(mixRGB(pal.rock, pal.rockDark, 0.35 + n(50 + k) * 0.6)), f + n(70 + k) * 0.12);
      const lip = snow ? lin('#f4f8fc') : shadeF(rock(1), 1.12);
      return { o, h, cols: [band(0, 0.82), band(1, 0.95), band(2, 0.88), band(3, 1.0), lip, gcol(top, 2), gcol(top, 3), gcol(top, 4)] };
    }
    if (side.drop) {
      const k = Math.max(0.6, -side.tilt);
      return {
        o: [0, 0.3, 0.6, 0.9, 1.9, 3, 7, 12, 18],
        h: [0, -0.17 * k, -0.33 * k, -0.5 * k, -1.7 * k, -3 * k, -8 * k + n(1) * 0.5, -16 * k, -26 * k],
        cols: [gcol(side.ground, 0), gcol(side.ground, 0), gcol(side.ground, 1), gcol(side.ground, 1), shadeF(gcol(side.ground, 2), 0.92), shadeF(gcol(side.ground, 2), 0.92), shadeF(rock(3), 0.95), rock(4)],
      };
    }
    if (side.ground === 'pavement') {
      const pv = lin('#b9b2a5');
      const cu = lin('#a8a296');
      return {
        o: [0, 0.01, 0.02, 1.2, 3.5, 8, 18, 26, 34],
        h: [0, 0.07, 0.13, 0.13, 0.13, 0.4, 1.5, 2.2, 3],
        cols: [cu, cu, pv, pv, gcol('meadow', 2), gcol('meadow', 3), gcol('meadow', 4), gcol('meadow', 4)],
      };
    }
    const tl = side.tilt;
    const o = [0, 0.375, 0.75, 1.125, 1.5, 5, 11, 20, 34];
    const bump = (k: number, amp: number) => n(k) * amp;
    const h = o.map((x) => tl * x);
    h[5] += bump(1, 0.25);
    h[6] += bump(2, 0.35);
    const g = side.ground;
    return { o, h, cols: [gcol(g, 0), gcol(g, 0), gcol(g, 1), gcol(g, 1), gcol(g, 1), gcol(g, 2), gcol(g, 3), gcol(g, 5)] };
  }

  private terrainSide(terr: GB, mas: GB, a: Row, b: Row, sg: number, P: (r: Row, x: number, h: number) => number[], limA: number, limB: number) {
    const sa = sg < 0 ? a.seg.L : a.seg.R;
    // am Tunnelportal läuft das Profil des Einschnitts bis an die Felswand
    const bt = b.seg.tunnel;
    const sb = bt ? sa : sg < 0 ? b.seg.L : b.seg.R;
    const pa = this.profile(sa, a.seg, sg, limA);
    const pb = this.profile(sb, bt ? a.seg : b.seg, sg, bt ? limA : limB);
    for (let k = 0; k < pa.o.length - 1; k++) {
      const xa0 = sg * (EDGE + pa.o[k]);
      const xa1 = sg * (EDGE + pa.o[k + 1]);
      const xb0 = sg * (EDGE + pb.o[k]);
      const xb1 = sg * (EDGE + pb.o[k + 1]);
      const A0 = P(a, xa0, pa.h[k] - 0.04);
      const A1 = P(a, xa1, pa.h[k + 1] - 0.04);
      const B0 = P(b, xb0, pb.h[k] - 0.04);
      const B1 = P(b, xb1, pb.h[k + 1] - 0.04);
      const col = pa.cols[k];
      if (sa.stone && k < 5) {
        // Stützmauer: Bruchstein, Lagen waagrecht entlang der Strecke
        const za = a.seg.i * SEG / 1.8;
        const zb = za + SEG / 1.8;
        const hv = (h: number) => h / 1.8;
        const q = [[za * sg, hv(pa.h[k])], [za * sg, hv(pa.h[k + 1])], [zb * sg, hv(pb.h[k + 1])], [zb * sg, hv(pb.h[k])]];
        if (sg > 0) mas.quad(A0, A1, B1, B0, col, q);
        else mas.quad(A1, A0, B0, B1, col, [q[1], q[0], q[3], q[2]]);
        continue;
      }
      const uv = (v: number[]) => [(v[0] + v[1] * 0.7) / 6, (v[2] - v[1] * 0.7) / 6];
      if (sg > 0) terr.quad(A0, A1, B1, B0, col, [uv(A0), uv(A1), uv(B1), uv(B0)]);
      else terr.quad(A1, A0, B0, B1, col, [uv(A1), uv(A0), uv(B0), uv(B1)]);
    }
    // Schürze am Rand: schließt die Fuge zur Landschaft, aus jeder Richtung
    const ka = pa.o.length - 1;
    const kb = pb.o.length - 1;
    const E0 = P(a, sg * (EDGE + pa.o[ka]), pa.h[ka] - 0.04);
    const E1 = P(b, sg * (EDGE + pb.o[kb]), pb.h[kb] - 0.04);
    const D0 = [E0[0], E0[1] - 3.2, E0[2]];
    const D1 = [E1[0], E1[1] - 3.2, E1[2]];
    const sc = shadeF(pa.cols[pa.cols.length - 1], 0.82);
    terr.quad(E0, D0, D1, E1, sc, [[0, 0], [0, 0.5], [0.3, 0.5], [0.3, 0]]);
    terr.quad(E0, E1, D1, D0, sc, [[0, 0], [0.3, 0], [0.3, 0.5], [0, 0.5]]);
  }

  private barriers(bar: GB, ads: GB, a: Row, b: Row, P: (r: Row, x: number, h: number) => number[]) {
    const s = a.seg;
    if (s.tunnel) return;
    const wallQ = (x: number, h0: number, h1: number, col: RGBf) => bar.quad(P(a, x, h0), P(b, x, h0), P(b, x, h1), P(a, x, h1), col);
    for (const sg of [-1, 1]) {
      const side = sg < 0 ? s.L : s.R;
      if (s.crowd) {
        const cloth = lin(CLOTH[(s.i >> 2) % CLOTH.length]);
        // bedruckte Bande zur Straße, dahinter Stoff
        const x = sg * (EDGE - 0.07);
        const [u0, v0, u1, v1] = adCell(Math.floor(hash(s.i * 2 + (sg > 0 ? 1 : 0)) * AD_COUNT), false);
        const A0 = P(a, x, 0.17); const B0 = P(b, x, 0.17); const A1 = P(a, x, 0.93); const B1 = P(b, x, 0.93);
        const back = shadeF(cloth, 0.9);
        if (sg > 0) ads.quad(B0, A0, A1, B1, back, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
        else ads.quad(A0, B0, B1, A1, back, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
        wallQ(sg * (EDGE - 0.02), 0.15, 0.95, cloth);
        wallQ(sg * (EDGE - 0.05), 0.95, 1.05, lin('#c8cdd2'));
        if ((s.i & 1) === 0) this.box(bar, a, sg * (EDGE - 0.05), 0, 0.05, 1.05, 0.05, lin('#9aa0a6'), P);
        continue;
      }
      if (side.wall > 0) continue;
      if (side.barrier === 'rail') {
        const x = sg * (EDGE - 0.12);
        wallQ(x, 0.46, 0.56, lin('#9aa1a9'));
        wallQ(x, 0.56, 0.68, lin('#d5dadf'));
        wallQ(x, 0.68, 0.74, lin('#b5bcc4'));
        if ((s.i & 1) === 0) this.box(bar, a, sg * (EDGE - 0.02), 0, 0.07, 0.72, 0.07, lin('#6b727a'), P);
      } else if (side.barrier === 'stone') {
        const v = 0.85 + hash(s.i * 3 + sg) * 0.2;
        const st = shadeF(lin('#a89f90'), v);
        wallQ(sg * (EDGE - 0.08), -0.1, 0.62, st);
        const x0 = sg * (EDGE - 0.08);
        const x1 = sg * (EDGE + 0.32);
        const top = [P(a, x0, 0.62), P(a, x1, 0.62), P(b, x1, 0.62), P(b, x0, 0.62)];
        if (sg > 0) bar.quad(top[0], top[1], top[2], top[3], shadeF(lin('#c7beae'), v)); else bar.quad(top[1], top[0], top[3], top[2], shadeF(lin('#c7beae'), v));
      } else if (side.barrier === 'fence') {
        wallQ(sg * (EDGE + 0.15), 0.55, 0.63, lin('#7a5634'));
        wallQ(sg * (EDGE + 0.15), 0.92, 1.0, lin('#7a5634'));
        if ((s.i & 1) === 0) this.box(bar, a, sg * (EDGE + 0.15), 0, 0.1, 1.1, 0.1, lin('#6a4a2c'), P);
      }
    }
  }

  /** kleine Quader (Pfosten), ausgerichtet an der Straße */
  private box(gb: GB, r: Row, x: number, h0: number, w: number, h: number, d: number, col: RGBf, P: (r: Row, x: number, h: number) => number[]) {
    const fx = Math.sin(r.th);
    const fz = -Math.cos(r.th);
    const c = P(r, x, h0);
    const corner = (dx: number, dz: number, y: number) => [c[0] + r.rx * dx + fx * dz, y, c[2] + r.rz * dx + fz * dz];
    const y0 = c[1];
    const y1 = c[1] + h;
    const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[(i + 1) % 4];
      gb.quad(corner(ax, az, y0), corner(bx, bz, y0), corner(bx, bz, y1), corner(ax, az, y1), col);
    }
    gb.quad(corner(-w / 2, -d / 2, y1), corner(w / 2, -d / 2, y1), corner(w / 2, d / 2, y1), corner(-w / 2, d / 2, y1), shadeF(col, 1.1));
  }

  /** Tunnel, in dem Segment i liegt: erstes und letztes Segment, Länge in m */
  private tunnelOf(i: number): [number, number, number] {
    const hit = this.tunSpan.get(i);
    if (hit) return hit;
    const t = this.track!;
    let a = i;
    while (a > t.first && t.seg(a - 1).tunnel) a--;
    let b = i;
    while (t.seg(b + 1).tunnel) b++;
    const out: [number, number, number] = [a, b, (b - a + 1) * SEG];
    for (let k = a; k <= b; k++) this.tunSpan.set(k, out);
    if (this.tunSpan.size > 4000) this.tunSpan.clear();
    return out;
  }

  /**
   * Tunnelportal: Felswand quer zur Straße mit Betonvorbau. Die Wand ist ein feines Gitter mit
   * Relief (Rippen, Absätze), ihre Oberkante folgt der Landschaft, unten reicht sie unter das
   * Gelände – so sieht man nirgends an ihr vorbei. dir = 1: Einfahrt (Vorbau zeigt zur Anfahrt),
   * dir = −1: Ausfahrt (Vorbau zeigt in Fahrtrichtung).
   */
  private portal(gb: GB, mas: GB, trim: GB, group: THREE.Group, disp: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[], a: Row, P: (r: Row, x: number, h: number) => number[], biome: BiomeId, dir: 1 | -1) {
    const pal = BIOME_PALETTES[biome];
    // Felswand: eigene Geometrie mit weichen Normalen (sonst sieht man jedes Dreieck des Reliefs)
    const outer = gb;
    gb = new GB();
    const x = EDGE - 0.35;
    const T = this.terrain!;
    const reg = this.region!;
    const fx = Math.sin(a.th);
    const fz = -Math.cos(a.th);
    const W = 40;
    const NI = 40;           // Spalten (2 m)
    const NJ = 16;           // Zeilen (je Spalte vom Fuß bis zur Oberkante)
    const lat = (i: number) => -W + (2 * W * i) / NI;
    const tops: number[] = [];
    const bots: number[] = [];
    for (let i = 0; i <= NI; i++) {
      const l = lat(i);
      const wp = P(a, l, 0);
      const ht = T.heightIn(reg, wp[0], wp[2]) - a.y;
      // Gelände gleich hinter der Wand (dort beginnt der Berg über der Röhre): die Wand reicht bis darüber
      const hb = T.heightIn(reg, wp[0] + fx * dir * 6, wp[2] + fz * dir * 6) - a.y;
      const al = Math.abs(l);
      const minTop = al < FAC_W + 2 ? FAC_H + 2.4 : al < 26 ? FAC_H + 2.4 - (al - FAC_W - 2) * 0.35 : -Infinity;
      tops.push(Math.max(minTop, ht + 2.2, al < 26 ? hb + 0.8 : -Infinity));
      bots.push(Math.min(-9, ht - 6));
    }
    // Knoten: Lage in der Wand (Seite, Höhe) und Relief (+ in den Berg hinein)
    const hAt = (i: number, j: number) => bots[i] + ((tops[i] - bots[i]) * j) / NJ;
    const nodes: number[][] = [];
    for (let i = 0; i <= NI; i++) {
      for (let j = 0; j <= NJ; j++) {
        const l = lat(i);
        const h = hAt(i, j);
        // Relief erst mit Abstand zur Fassade
        const k = Math.max(0, Math.min(1, (Math.hypot(Math.max(0, Math.abs(l) - FAC_W), Math.max(0, h - FAC_H)) - 0.4) / 5));
        const edge = j === NJ ? 0.4 : 1; // Oberkante ruhiger (schließt an die Landschaft an)
        const v = 1.5 * Math.sin(l * 0.37 + h * 0.21) + 1.1 * Math.sin(l * 0.13 - h * 0.43 + 1.7)
          + 0.6 * Math.sin(l * 0.71 + h * 0.67) + (hash(i * 131 + j * 977 + a.seg.i) - 0.5) * 1.3;
        const r = v * k * edge;
        const q = P(a, l, h);
        nodes.push([q[0] + fx * r * dir, q[1], q[2] + fz * r * dir, l, h]);
      }
    }
    const N = (i: number, j: number) => nodes[i * (NJ + 1) + j];
    // Gesteinsfarbe: Lagen nach Höhe, etwas Rauschen
    const rock = rgbLin(mixRGB(pal.rock, [168, 160, 148], 0.25));
    const rockD = rgbLin(pal.rockDark);
    const colAt = (l: number, h: number, salt: number): RGBf => {
      const band = 0.5 + 0.5 * Math.sin(h * 1.7 + Math.sin(l * 0.15) * 1.2);
      const t = Math.min(1, band * 0.55 + hash(salt) * 0.35);
      const f = 0.9 + hash(salt + 7) * 0.2;
      return [(rock[0] + (rockD[0] - rock[0]) * t) * f, (rock[1] + (rockD[1] - rock[1]) * t) * f, (rock[2] + (rockD[2] - rock[2]) * t) * f];
    };
    // Aussparung um die Öffnung: Zellen, die ihr zu nahe kommen, übernimmt ein Rahmen (unten)
    const near = (i: number, j: number) => {
      const l0 = lat(i);
      const l1 = lat(i + 1);
      const h1 = Math.max(hAt(i, j + 1), hAt(i + 1, j + 1));
      return l1 > -FAC_W - 0.9 && l0 < FAC_W + 0.9 && h1 > FAC_B - 9 && Math.min(hAt(i, j), hAt(i + 1, j)) < FAC_H + 0.7;
    };
    const top = new Array<number>(NI).fill(-1); // je Spalte: höchste ausgesparte Zeile
    for (let i = 0; i < NI; i++) for (let j = 0; j < NJ; j++) if (near(i, j)) top[i] = j;
    for (let i = 0; i < NI; i++) {
      for (let j = 0; j < NJ; j++) {
        if (j <= top[i]) continue;
        const A = N(i, j);
        const B = N(i + 1, j);
        const C = N(i + 1, j + 1);
        const D = N(i, j + 1);
        const col = colAt(A[3], A[4], i * 53 + j * 7 + a.seg.i);
        if (Math.abs(A[1] - C[1]) < Math.abs(B[1] - D[1])) { gb.tri(A, B, C, col); gb.tri(A, C, D, shadeF(col, 0.96)); }
        else { gb.tri(A, B, D, col); gb.tri(B, C, D, shadeF(col, 0.96)); }
      }
    }
    // Rahmen zwischen Treppenrand der ausgesparten Zellen und der Tunnelöffnung (ohne Relief an der Öffnung)
    const cols = [...top.keys()].filter((i) => top[i] >= 0);
    if (cols.length) {
      const i0 = cols[0];
      const i1 = cols[cols.length - 1] + 1;
      const outline: number[][] = [];
      for (let i = i0; i <= i1; i++) outline.push(N(i, 0));                    // unten links → rechts
      for (let j = 1; j <= top[i1 - 1] + 1; j++) outline.push(N(i1, j));       // rechts hinauf
      for (let i = i1 - 1; i >= i0; i--) {                                      // Treppe oben, rechts → links
        const jt = top[i] + 1;
        if (i < i1 - 1) {
          const jr = top[i + 1] + 1;
          if (jt > jr) for (let j = jr + 1; j <= jt; j++) outline.push(N(i + 1, j));
          else for (let j = jr - 1; j >= jt; j--) outline.push(N(i + 1, j));
        }
        outline.push(N(i, jt));
      }
      for (let j = top[i0]; j >= 1; j--) outline.push(N(i0, j));               // links hinunter
      // Aussparung: Rechteck der Fassade (sie steht davor und reicht seitlich in den Fels)
      const hole: number[][] = [[-FAC_W + 0.3, FAC_B], [FAC_W - 0.3, FAC_B], [FAC_W - 0.3, FAC_H - 0.2], [-FAC_W + 0.3, FAC_H - 0.2]];
      const v2 = (pts: number[][]) => pts.map((p) => new THREE.Vector2(p[0], p[1]));
      const contour = v2(outline.map((n) => [n[3], n[4]]));
      const holeV = v2(hole);
      if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse(), outline.reverse();
      if (!THREE.ShapeUtils.isClockWise(holeV)) holeV.reverse(), hole.reverse();
      const faces = THREE.ShapeUtils.triangulateShape(contour, [holeV]);
      const all: number[][] = [...outline, ...hole.map((p) => P(a, p[0], p[1]))];
      for (const [i, j, k] of faces) {
        const A = all[i];
        const B = all[j];
        const C = all[k];
        const cy = (A[1] + B[1] + C[1]) / 3 - a.y;
        gb.tri([A[0], A[1], A[2]], [B[0], B[1], B[2]], [C[0], C[1], C[2]], colAt(0, cy, i * 17 + k));
      }
    }
    // gemauerte Fassade mit Bogen, davor die Inschrift
    const { plaque } = portalFacade(mas, trim, a, P, dir);
    const t = this.track!;
    const [t0, t1, len] = this.tunnelOf(dir > 0 ? a.seg.i : a.seg.i - 1);
    const name = tunnelName(t.lang, t0 * 7 + t1 * 13 + t.seed);
    const key = `plaque:${name}:${len}`;
    let tex = this.labelTex.get(key);
    if (!tex) { tex = this.tex(plaqueTex(name, `m ${Math.round(len / 2) * 2}`), false); this.labelTex.set(key, tex); }
    const pg = new GB();
    pg.uv = true;
    pg.quad(plaque[0], plaque[1], plaque[2], plaque[3], [1, 1, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    const geo = pg.build();
    const mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
    disp.push(geo, mat);
    group.add(new THREE.Mesh(geo, mat));
    if (!gb.empty) {
      const rg = gb.buildSmooth(new THREE.Vector3(-fx * dir, 0.25, -fz * dir));
      disp.push(rg);
      const rm = new THREE.Mesh(rg, this.mats.portal);
      rm.castShadow = true;
      group.add(rm);
    }
    void outer;
    void gb; void x;
  }

  /**
   * Haus an der Straße: Fassaden stockwerksweise aus dem Atlas (alle vier Wände), Satteldach mit
   * Ziegeln, Traufbrettern und Kamin, Ladenschild, Wandlaterne – Kirche mit Turm, Rathaus mit Fahnen.
   * Das Haus folgt der Sehne der Straße (in Kurven stehen beide Enden im gleichen Abstand) und steht am
   * Hang auf der höheren Seite; der Sockel reicht tief genug hinunter.
   */
  private building(T: Town, a: Row, b: Building, sg: number) {
    const t = this.track!;
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

    // Tönung des Hauses (etwas wärmer oder kühler, heller oder dunkler) und Verlauf über die Höhe
    const wTint = 0.9 + hs(31) * 0.14;
    const warm = (hs(37) - 0.5) * 0.1;
    const ageC = (h: number, k: number): RGBf => {
      let f = h < 0 ? 0.62 : h < 1.4 ? 0.78 + 0.22 * (h / 1.4) : 1;
      if (h > H - 0.9) f *= 0.86;
      f *= wTint * (0.95 + hash(b.seed * 13 + k * 7) * 0.08);
      return [f * (1 + warm), f, f * (1 - warm * 1.2)];
    };
    /** Wand von A nach B (von außen gesehen links → rechts) als Streifen je Geschoss */
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
          const u0 = facU(v, 0);
          const u1 = facU(v, s1 - s0);
          // Alter und Schmutz: unten Spritzwasser, unter dem Dach Schatten, jedes Stück und Haus etwas anders
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
    // Front zur Straße: Läden (Variante B) wo ein Schild hängt, sonst gemischt
    const frontVar = (k: number, upper: boolean) => {
      if (upper) return hs(k + 40) < 0.5 ? 1 : 0;
      if (church) return k === Math.floor(frontPieces / 2) ? 0 : 1;
      if (signOk && k === signPiece) return 1;
      return hs(k) < (b.sign >= 0 ? 0.25 : 0.18) ? 1 : 0;
    };
    const sideVar = (k: number, upper: boolean) => (upper ? (hs(k + 90) < 0.3 ? 1 : 0) : 0);
    const out = -sg;   // Richtung zur Straße (quer)
    const frontA: [number, number] = sg < 0 ? [l0, 0] : [l0, L];
    const frontB: [number, number] = sg < 0 ? [l0, L] : [l0, 0];
    wall(frontA, frontB, frontVar, (k, s0) => {
      // Ladenschild über dem Schaufenster
      if (!(signOk && k === signPiece)) return;
      const [u0, v0, u1, v1] = signUV(this.track!.lang, b.sign);
      const along = (s: number) => (sg < 0 ? s : L - s);
      const la = l0 + out * 0.05;
      const a0 = along(s0 + 0.22);
      const a1 = along(s0 + 3.78);
      T.signs.quad(at(la, a0, GH - 0.37), at(la, a1, GH - 0.37), at(la, a1, GH - 0.01), at(la, a0, GH - 0.01), [1, 1, 1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      if (b.badge >= 0) {
        // Steckschild quer zur Fassade (zwei Seiten, damit es von beiden Richtungen lesbar ist)
        const [bu0, bv0, bu1, bv1] = badgeUV(b.badge);
        const ab = along(s0 + 0.12);
        const q0 = l0 + out * 0.2;
        const q1 = l0 + out * 0.85;
        const h0 = GH + 0.35;
        const h1 = h0 + 0.65;
        const [na, nb] = out > 0 ? [q0, q1] : [q1, q0];
        T.signs.quad(at(na, ab - 0.01, h0), at(nb, ab - 0.01, h0), at(nb, ab - 0.01, h1), at(na, ab - 0.01, h1), [1, 1, 1], [[bu0, bv0], [bu1, bv0], [bu1, bv1], [bu0, bv1]]);
        T.signs.quad(at(nb, ab + 0.01, h0), at(na, ab + 0.01, h0), at(na, ab + 0.01, h1), at(nb, ab + 0.01, h1), [1, 1, 1], [[bu0, bv0], [bu1, bv0], [bu1, bv1], [bu0, bv1]]);
        const iron = lin('#2a2a2c');
        T.plain.quad(at(l0, ab, h1 + 0.02), at(q1, ab, h1 + 0.02), at(q1, ab, h1 + 0.07), at(l0, ab, h1 + 0.07), iron);
      }
    });
    wall([lo, 0], [hi, 0], sideVar);
    wall([hi, L], [lo, L], sideVar);
    wall(sg < 0 ? [l1, L] : [l1, 0], sg < 0 ? [l1, 0] : [l1, L], sideVar);

    // ---- Wandlaterne (abends ein warmer Lichtpunkt)
    if (!church && hs(5) < 0.8) {
      const s = L >= 6 ? 4 : L / 2;
      const al = sg < 0 ? s : L - s;
      const h = GH + 0.45;
      const iron = lin('#26262a');
      const p0 = l0 + out * 0.02;
      const p1 = l0 + out * 0.42;
      T.plain.quad(at(p0, al - 0.03, h + 0.26), at(p1, al - 0.03, h + 0.26), at(p1, al + 0.03, h + 0.26), at(p0, al + 0.03, h + 0.26), iron);
      T.plain.quad(at(p0, al, h + 0.2), at(p1, al, h + 0.26), at(p1, al, h + 0.31), at(p0, al, h + 0.26), iron);
      const c = at(p1, al, h);
      const box = (x0: number, x1: number, y0: number, y1: number, col: RGBf) => {
        const q = (pa: number[], pb: number[], pc: number[], pd: number[]) => T.plain.quad(pa, pb, pc, pd, col);
        const P0 = (dl: number, da: number, y: number) => [c[0] + rx * dl + fx * da, c[1] + y, c[2] + rz * dl + fz * da];
        q(P0(x0, x0, y0), P0(x1, x0, y0), P0(x1, x0, y1), P0(x0, x0, y1));
        q(P0(x1, x0, y0), P0(x1, x1, y0), P0(x1, x1, y1), P0(x1, x0, y1));
        q(P0(x1, x1, y0), P0(x0, x1, y0), P0(x0, x1, y1), P0(x1, x1, y1));
        q(P0(x0, x1, y0), P0(x0, x0, y0), P0(x0, x0, y1), P0(x0, x1, y1));
      };
      box(-0.09, 0.09, -0.02, 0.24, lin('#f2d9a0'));
      box(-0.12, 0.12, 0.24, 0.3, iron);
      T.lanterns.push(c[0], c[1] + 0.12, c[2]);
    }

    // ---- Dach
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
    const tint = 0.9 + hs(3) * 0.18;
    const roofCol = shadeF(lin(STYLE_ROOF[st]), tint);
    const slopeLen = Math.hypot(half + ovE, rh - ee);
    const g0 = -ovG;
    const g1 = L + ovG;
    const tileQuad = (eave: number) => T.tiles.quad(at(eave, g0, ee), at(eave, g1, ee), at(lm, g1, rh), at(lm, g0, rh), roofCol,
      [[g0 / 2, 0], [g1 / 2, 0], [g1 / 2, slopeLen / 2], [g0 / 2, slopeLen / 2]]);
    tileQuad(eF);
    tileQuad(eB);
    // First, Trauf- und Ortgangbretter: das Dach bekommt eine sichtbare Stärke
    const board = lin(chalet ? '#3e2716' : st === STYLE.backstein || st === STYLE.haussmann ? '#d9d4ca' : '#4a3628');
    const bh = chalet ? 0.3 : 0.18;
    for (const ev of [eF, eB]) T.plain.quad(at(ev, g0, ee - bh), at(ev, g1, ee - bh), at(ev, g1, ee), at(ev, g0, ee), board);
    for (const al of [g0, g1]) {
      for (const ev of [eF, eB]) T.plain.quad(at(ev, al, ee - bh), at(lm, al, rh - bh), at(lm, al, rh), at(ev, al, ee), board);
    }
    T.plain.quad(at(lm - 0.12, g0, rh + 0.02), at(lm - 0.12, g1, rh + 0.02), at(lm + 0.12, g1, rh + 0.02), at(lm + 0.12, g0, rh + 0.02), shadeF(roofCol, 0.75));
    // Giebeldreiecke (Wandfarbe; Chalet in Holz)
    const gable = chalet ? lin('#7a4e2c') : shadeF(lin(STYLE_WALL[st]), 0.94);
    T.plain.tri(at(l0, 0, H), at(lm, 0, rh), at(l1, 0, H), gable);
    T.plain.tri(at(l1, L, H), at(lm, L, rh), at(l0, L, H), gable);
    // Unterseite des Dachüberstands an der Traufe (dunkler Schatten statt Durchblick)
    const soffit = lin(chalet ? '#3a2414' : '#3e342c');
    T.plain.quad(at(l0, g0, H - 0.02), at(eF, g0, ee - bh), at(eF, g1, ee - bh), at(l0, g1, H - 0.02), soffit);
    T.plain.quad(at(l1, g0, H - 0.02), at(eB, g0, ee - bh), at(eB, g1, ee - bh), at(l1, g1, H - 0.02), soffit);
    // Kamin auf der hinteren Dachhälfte
    if (!church && hs(9) < 0.7) {
      const ca = L * (0.25 + hs(11) * 0.5);
      const cl = lm + sg * half * (0.3 + hs(13) * 0.25);
      const roofH = rh - pitch * Math.abs(cl - lm);
      const cw = 0.32;
      const col = st === STYLE.backstein ? lin('#8a3e2e') : shadeF(lin(STYLE_WALL[st]), 0.85);
      const top = rh + 0.9;
      const P0 = (dl: number, da: number, h: number) => at(cl + dl, ca + da, h);
      const sides: [number, number, number, number][] = [[-cw, -cw, cw, -cw], [cw, -cw, cw, cw], [cw, cw, -cw, cw], [-cw, cw, -cw, -cw]];
      for (const [x0, y0, x1, y1] of sides) T.plain.quad(P0(x0, y0, roofH - 0.6), P0(x1, y1, roofH - 0.6), P0(x1, y1, top), P0(x0, y0, top), col);
      const cap = lin('#3a3632');
      const cc = cw + 0.07;
      T.plain.quad(P0(-cc, -cc, top), P0(cc, -cc, top), P0(cc, cc, top), P0(-cc, cc, top), cap);
      for (const [x0, y0, x1, y1] of sides) T.plain.quad(P0(x0 * 1.22, y0 * 1.22, top - 0.1), P0(x1 * 1.22, y1 * 1.22, top - 0.1), P0(x1 * 1.22, y1 * 1.22, top), P0(x0 * 1.22, y0 * 1.22, top), cap);
    }

    // ---- Kirchturm vorn an der Straße mit Uhr und Schallarkaden
    if (church) {
      const tw = 4.4;
      const t0 = l0 + out * 0.6;
      const t1 = t0 - out * tw;
      const TH = 23;
      const stone = lin('#d6ccb8');
      const T3 = (lat: number, al: number, h: number) => at(lat, al, h);
      const [ta, tb] = out > 0 ? [t1, t0] : [t0, t1];
      // Wände (Außenseite jeweils nach außen)
      T.plain.quad(T3(ta, -0.6, -2), T3(tb, -0.6, -2), T3(tb, -0.6, TH), T3(ta, -0.6, TH), stone);
      T.plain.quad(T3(tb, -0.6 + tw, -2), T3(ta, -0.6 + tw, -2), T3(ta, -0.6 + tw, TH), T3(tb, -0.6 + tw, TH), stone);
      T.plain.quad(T3(t0, -0.6 + tw, -2), T3(t0, -0.6, -2), T3(t0, -0.6, TH), T3(t0, -0.6 + tw, TH), shadeF(stone, 0.95));
      T.plain.quad(T3(t1, -0.6, -2), T3(t1, -0.6 + tw, -2), T3(t1, -0.6 + tw, TH), T3(t1, -0.6, TH), shadeF(stone, 0.9));
      // Gesimse
      for (const h of [7.5, 15.5]) {
        const band = lin('#bfb39c');
        T.plain.quad(T3(t0 + out * 0.08, -0.68, h), T3(t0 + out * 0.08, -0.6 + tw + 0.08, h), T3(t0 + out * 0.08, -0.6 + tw + 0.08, h + 0.35), T3(t0 + out * 0.08, -0.68, h + 0.35), band);
        T.plain.quad(T3(ta, -0.68, h), T3(tb, -0.68, h), T3(tb, -0.68, h + 0.35), T3(ta, -0.68, h + 0.35), band);
      }
      // Schallarkaden (dunkel) und Uhr zur Straße und nach vorn
      const dark = lin('#2a2420');
      const mid = -0.6 + tw / 2;
      for (const [w0, w1] of [[mid - 1.3, mid - 0.25], [mid + 0.25, mid + 1.3]]) {
        T.plain.quad(T3(t0 + out * 0.02, w1, 17.2), T3(t0 + out * 0.02, w0, 17.2), T3(t0 + out * 0.02, w0, 20.4), T3(t0 + out * 0.02, w1, 20.4), dark);
      }
      const cm = (ta + tb) / 2;
      for (const [w0, w1] of [[cm - 1.3, cm - 0.25], [cm + 0.25, cm + 1.3]]) T.plain.quad(T3(w0, -0.62, 17.2), T3(w1, -0.62, 17.2), T3(w1, -0.62, 20.4), T3(w0, -0.62, 20.4), dark);
      const clock = (cx: number, ca: number, nx: number, na: number) => {
        // Zifferblatt als Achteck, Zeiger
        const R = 0.95;
        const ctr = [cx, ca, 12.6];
        const pt = (ang: number, rad: number) => {
          const u = Math.cos(ang) * rad;
          const v = Math.sin(ang) * rad;
          return T3(ctr[0] + na * u, ctr[1] - nx * u, ctr[2] + v);
        };
        const white = lin('#f4f0e6');
        for (let k = 0; k < 8; k++) T.plain.tri(T3(ctr[0], ctr[1], ctr[2]), pt((k * Math.PI) / 4, R), pt(((k + 1) * Math.PI) / 4, R), white);
        const hand = lin('#1a1a1a');
        T.plain.quad(pt(-0.08 + Math.PI / 2, 0.06), pt(0.08 + Math.PI / 2, 0.06), pt(Math.PI / 2 + 0.02, 0.8), pt(Math.PI / 2 - 0.02, 0.8), hand);
        T.plain.quad(pt(-0.1, 0.06), pt(0.1, 0.06), pt(0.03, 0.55), pt(-0.03, 0.55), hand);
      };
      clock(t0 + out * 0.03, mid, out, 0);
      clock(cm, -0.63, 0, -1);
      // Turmhelm
      const tip = T3(cm, mid, TH + 7.5);
      const helm = lin('#4f5a58');
      const cnr = [T3(ta, -0.6, TH), T3(tb, -0.6, TH), T3(tb, -0.6 + tw, TH), T3(ta, -0.6 + tw, TH)];
      for (let k = 0; k < 4; k++) T.plain.tri(cnr[k], cnr[(k + 1) % 4], tip, shadeF(helm, 0.85 + k * 0.05));
      const ball = T3(cm, mid, TH + 7.9);
      T.plain.quad([ball[0] - 0.05, ball[1] - 0.4, ball[2]], [ball[0] + 0.05, ball[1] - 0.4, ball[2]], [ball[0] + 0.05, ball[1] + 0.6, ball[2]], [ball[0] - 0.05, ball[1] + 0.6, ball[2]], lin('#c8a24a'));
    }

    // ---- Rathaus: Fahnen in den Landesfarben
    if (st === STYLE.rathaus) {
      const lang = this.track!.lang;
      const cols: string[] = lang === 'fr' ? ['#1f3c9c', '#f4f4f4', '#d6202a'] : lang === 'it' ? ['#1f8a4c', '#f4f4f4', '#d6202a']
        : lang === 'es' ? ['#c8102e', '#ffc400', '#c8102e'] : ['#1f3c9c', '#f4f4f4', '#d6202a'];
      const vertical = lang !== 'es';
      for (const s of [L * 0.3, L * 0.7]) {
        const h0 = GH + UH * 0.85;
        const root = at(l0, s, h0);
        const tipP = at(l0 + out * 1.5, s, h0 + 0.9);
        const iron = lin('#2a2a2c');
        T.plain.quad(root, [root[0], root[1] + 0.05, root[2]], [tipP[0], tipP[1] + 0.05, tipP[2]], tipP, iron);
        // Tuch hängt am Mast, leicht schräg
        for (let k = 0; k < 3; k++) {
          const f0 = k / 3;
          const f1 = (k + 1) / 3;
          const P = (fu: number, fv: number) => {
            const lat = l0 + out * (0.35 + 1.1 * fu);
            const hh = h0 + 0.2 + 0.6 * fu - 0.75 * fv;
            return at(lat, s + 0.04 * fv, hh);
          };
          if (vertical) T.plain.quad(P(f0, 0), P(f1, 0), P(f1, 1), P(f0, 1), lin(cols[k]));
          else T.plain.quad(P(0, f0), P(1, f0), P(1, f1), P(0, f1), lin(cols[k]));
        }
      }
    }
  }

  /** Wimpelkette mit Glühbirnen quer über die Gasse (abends leuchten die Birnen) */
  private garland(T: Town, a: Row, bl: Building, br: Building) {
    const lang = this.track!.lang;
    const sets: Record<string, string[]> = {
      fr: ['#1f3c9c', '#f4f4f4', '#d6202a'], it: ['#1f8a4c', '#f4f4f4', '#d6202a'], es: ['#c8102e', '#ffc400'], en: ['#1f3c9c', '#f4f4f4', '#d6202a'],
    };
    const fun = ['#ffd23f', '#ff5fa2', '#2f80ed', '#27ae60', '#f4f4f4', '#ff7a30'];
    const cols = hash(a.seg.i * 3) < 0.6 ? sets[lang] : fun;
    const h = FAC_M.ground + 2.3 + hash(a.seg.i) * 0.8;
    const x0 = -bl.setback + 0.1;
    const x1 = br.setback - 0.1;
    const N = 16;
    const sag = 0.9;
    const pt = (k: number) => {
      const f = k / N;
      const x = x0 + (x1 - x0) * f;
      const y = a.y + h - sag * 4 * f * (1 - f);
      return [a.x + a.rx * x, y, a.z + a.rz * x];
    };
    const line = lin('#2a2a2c');
    const fx = Math.sin(a.th) * 0.02;
    const fz = -Math.cos(a.th) * 0.02;
    for (let k = 0; k < N; k++) {
      const p = pt(k);
      const q = pt(k + 1);
      T.plain.quad(p, q, [q[0], q[1] + 0.03, q[2]], [p[0], p[1] + 0.03, p[2]], line);
      // Wimpel: Dreieck unter der Leine
      const m = [(p[0] + q[0]) / 2 + fx, (p[1] + q[1]) / 2 - 0.42, (p[2] + q[2]) / 2 + fz];
      T.plain.tri([p[0] + fx, p[1], p[2] + fz], [q[0] + fx, q[1], q[2] + fz], m, lin(cols[k % cols.length]));
      if (k > 0) T.bulbs.push(p[0], p[1] - 0.06, p[2]);
    }
  }

  private prop(group: THREE.Group, disp: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[], inst: Map<Prop3D, { m: THREE.Matrix4[]; c: THREE.Color[] }>,
    bill: GB, anim: number[], glows: number[], a: Row, sp: Sprite, s: Seg, lim: number) {
    const sg = sp.x < 0 ? -1 : 1;
    const ax = Math.abs(sp.x);
    let h = sp.h;
    const px = a.x + a.rx * sp.x;
    const pz = a.z + a.rz * sp.x;
    // nicht auf eine andere Straße stellen (Serpentinen liegen oft nur 40 m auseinander)
    if (ax > EDGE + 1 && this.terrain!.roadDist(this.region!, px, pz) < Math.min(ax - 0.7, EDGE + 2.8)) return;
    if (ax > EDGE && !s.tunnel) {
      const side = sg < 0 ? s.L : s.R;
      if (side.ground === 'water' && ax > EDGE + 4) {
        if (sp.k !== 'boat') return;
        h = this.terrain!.lakeOf(s.sec) - a.y;            // Boote schwimmen auf dem See
      } else if (ax > lim - 0.5) {
        h = this.terrain!.heightIn(this.region!, px, pz) - 0.3 - a.y;   // auf der Landschaft
      } else {
        const gh = this.groundAt(side, s, sg, ax - EDGE, lim);
        if (gh === null) return;
        h = gh;
      }
    }
    const py = a.y + h;
    const fx = Math.sin(a.th);
    const fz = -Math.cos(a.th);
    if (PROP3D.has(sp.k)) {
      const kind = sp.k as Prop3D;
      let rot = hash(s.i * 31 + Math.round(sp.x * 10)) * Math.PI * 2;
      if (kind === 'fence' || kind === 'vinerow' || kind === 'logs') rot = -a.th;
      if (kind === 'lamp') rot = sp.x < 0 ? Math.atan2(-a.rx, -a.rz) + Math.PI : Math.atan2(a.rx, a.rz) + Math.PI;
      if (kind === 'lamp') rot = sp.x < 0 ? Math.atan2(-Math.cos(a.th), -Math.sin(a.th)) : Math.atan2(Math.cos(a.th), Math.sin(a.th));
      const sc = sp.s * (kind === 'rock' && sp.h > 0.05 ? 1 : 1);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(px, py - 0.05, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(sc, sc * (0.9 + hash(s.i + sp.v) * 0.25), sc));
      const v = 0.85 + hash(s.i * 3 + sp.v) * 0.3;
      if (TREES.has(kind) && this.cTrees) {
        const hv = hash(s.i * 7 + sp.v) * 2 - 1;
        this.cTrees.push(px, py - 0.05, pz, sc, rot, v * (1 + 0.1 * hv), v * (0.95 + hash(s.i) * 0.1), v * (1 - 0.13 * hv), treeVariant(kind, hash(s.i * 13 + sp.v * 7)));
        return;
      }
      let list = inst.get(kind);
      if (!list) { list = { m: [], c: [] }; inst.set(kind, list); }
      list.m.push(m);
      const hv = TREES.has(kind) ? hash(s.i * 7 + sp.v) * 2 - 1 : 0;
      list.c.push(new THREE.Color(v * (1 + 0.1 * hv), v * (0.95 + hash(s.i) * 0.1), v * (1 - 0.13 * hv)));
      if (kind === 'lamp') {
        const ax = Math.sin(rot) * -0.62;
        const az = Math.cos(rot) * -0.62;
        glows.push(px + ax, py + 4.35, pz + az);
      }
      return;
    }
    if (sp.k === 'tornante' || sp.k === 'townSign' || sp.k === 'passSign') {
      const sec = this.track!.sections[s.sec];
      const sub = sp.k === 'passSign' ? `${sec.alt.toLocaleString('de-DE')} m` : '';
      const key = `${sp.k}:${sp.text}:${sub}`;
      let tex = this.labelTex.get(key);
      const img = this.bank.label(sp.k, sp.text ?? '', sub);
      if (!tex) { tex = this.tex(img.img, false); this.labelTex.set(key, tex); }
      const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
      const geo = new THREE.PlaneGeometry(img.w, img.h);
      geo.translate(0, img.h / 2, 0);
      disp.push(mat, geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(px, py, pz);
      mesh.rotation.y = -a.th;
      group.add(mesh);
      return;
    }
    const kind = sp.k === 'chevron' && sp.v === 9 ? 'dosso' : sp.k;
    const def = BILLBOARD[kind];
    if (!def) return;
    const e = this.atlas.get(`${kind}:${sp.v % def.variants}`);
    if (!e) return;
    const w = e.w * sp.s;
    const bh = e.h * sp.s;
    // Karte quer zur Straße, Blick zum Fahrer
    const flip = sp.f;
    const l = [px - a.rx * w / 2, py, pz - a.rz * w / 2];
    const rgt = [px + a.rx * w / 2, py, pz + a.rz * w / 2];
    const u0 = flip ? e.u1 : e.u0;
    const u1 = flip ? e.u0 : e.u1;
    bill.quad(l, rgt, [rgt[0], py + bh, rgt[2]], [l[0], py + bh, l[2]], [1, 1, 1], [[u0, e.v0], [u1, e.v0], [u1, e.v1], [u0, e.v1]]);
    // nächstes Animationsbild liegt im Atlas immer rechts daneben – auch bei gespiegelten Karten
    const du = e.du;
    const speed = kind === 'crowd' ? 0.9 + hash(s.i) * 0.8 : 1.2;
    const phase = hash(s.i * 13 + Math.round(sp.x));
    for (let i = 0; i < 6; i++) anim.push(du, phase, speed);
    void fx; void fz;
  }

  private decal(group: THREE.Group, disp: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[], marks: GB, rows: Row[], r: number, d: NonNullable<Seg['decals']>[number], P: (r: Row, x: number, h: number) => number[]) {
    const len = Math.min(d.len, rows.length - 1 - r);
    if (len <= 0) return;
    const H = 0.016;
    if (d.k === 'text' || d.k === 'arrow') {
      const gb = new GB();
      gb.uv = true;
      for (let k = 0; k < len; k++) {
        const a = rows[r + k];
        const b = rows[r + k + 1];
        const v0 = k / d.len;
        const v1 = (k + 1) / d.len;
        gb.quad(P(a, d.x - d.w, H), P(a, d.x + d.w, H), P(b, d.x + d.w, H), P(b, d.x - d.w, H), [1, 1, 1], [[0, v0], [1, v0], [1, v1], [0, v1]]);
      }
      const key = `${d.k}:${d.text}`;
      let tex = this.labelTex.get(key);
      if (!tex) {
        const cv = d.k === 'text' ? roadText(d.text ?? '') : roadArrow((d.text as 'L' | 'R') ?? 'L');
        tex = this.tex(cv, false);
        this.labelTex.set(key, tex);
      }
      const geo = gb.build();
      const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, opacity: 0.9 });
      disp.push(geo, mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 2;
      group.add(mesh);
      return;
    }
    for (let k = 0; k < len; k++) {
      const a = rows[r + k];
      const b = rows[r + k + 1];
      if (d.k === 'patch') continue;
      if (d.k === 'zebra') for (let q = -2; q <= 2; q++) marks.quad(P(a, q * 1.05 - 0.25, H), P(a, q * 1.05 + 0.25, H), P(b, q * 1.05 + 0.25, H), P(b, q * 1.05 - 0.25, H), lin('#f2f2ec'));
      else if (d.k === 'grid') for (let q = 0; q < 4; q++) {
        const t0 = q / 4;
        const mid = (u: number[], v: number[], t: number) => [u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t, u[2] + (v[2] - u[2]) * t];
        const A0 = P(a, -ROAD_HALF, H);
        const A1 = P(a, ROAD_HALF, H);
        const B0 = P(b, -ROAD_HALF, H);
        const B1 = P(b, ROAD_HALF, H);
        marks.quad(mid(A0, B0, t0), mid(A1, B1, t0), mid(A1, B1, t0 + 0.12), mid(A0, B0, t0 + 0.12), lin('#bfc3c8'));
      } else if (d.k === 'manhole' && k === 0) {
        const c = P(a, d.x, H);
        for (let q = 0; q < 8; q++) {
          const t0 = (q / 8) * Math.PI * 2;
          const t1 = ((q + 1) / 8) * Math.PI * 2;
          marks.tri(c, P(a, d.x + Math.cos(t1) * 0.35, H), P(a, d.x + Math.cos(t0) * 0.35, H), lin('#3a3c40'));
        }
      }
    }
  }

  private arch(group: THREE.Group, disp: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[], a: Row, banner: Banner | { kind: string; text: string; sub?: string }, color: string) {
    const light = color === '#ffffff';
    const main = banner.kind === 'gpm' ? `GPM · ${banner.text}` : banner.kind === 'welcome' ? `Benvenuti a ${banner.text}` : banner.text;
    const key = `arch:${main}:${banner.sub ?? ''}:${color}`;
    let tex = this.labelTex.get(key);
    if (!tex) {
      tex = this.tex(bannerTex(main.toUpperCase(), banner.sub ?? '', color, light ? '#1a1a1a' : '#ffffff'), false);
      this.labelTex.set(key, tex);
    }
    const span = EDGE * 2 + 0.6;
    const g = new THREE.Group();
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a8 });
    const pole = new THREE.CylinderGeometry(0.08, 0.1, 5.8, 8);
    pole.translate(0, 2.9, 0);
    const bannerMat = new THREE.MeshLambertMaterial({ map: tex });
    const sideMat = new THREE.MeshLambertMaterial({ color });
    const box = new THREE.BoxGeometry(span, 1.3, 0.18);
    disp.push(poleMat, pole, bannerMat, sideMat, box);
    for (const sg of [-1, 1]) {
      const m = new THREE.Mesh(pole, poleMat);
      m.position.set(sg * span / 2, 0, 0);
      g.add(m);
    }
    const bm = new THREE.Mesh(box, [sideMat, sideMat, sideMat, sideMat, bannerMat, bannerMat]);
    bm.position.set(0, 5.1, 0);
    g.add(bm);
    g.position.set(a.x, a.y, a.z);
    g.rotation.y = -a.th;
    group.add(g);
  }

  // ------------------------------------------------------------------ Fahrer, Objekte, Partikel

  /**
   * Zuschauer für einen 4-m-Abschnitt: in Fanzonen zwei bis drei lockere Reihen hinter der Absperrung,
   * Kinder vorn, ab und zu ein Kind auf den Schultern; in Kehren (v 8) eine Traube, sonst (v 9) ein
   * kleines Grüppchen am Rand. Immer gleich für dieselbe Stelle.
   */
  private crowdPeople(out: Person[], s: Seg, sg: number, lim: number, v: number, dx0: number) {
    const t = this.track!;
    const biome = t.sections[s.sec].biome;
    const zone: Zone = biome === 'pass' ? 'pass' : biome === 'village' ? 'village' : 'tifosi';
    const r = mulberry32(s.i * 7919 + (sg > 0 ? 104729 : 0));
    const group = v === 9;
    // dichter als früher: in der Ferne sind es Bilder (zwei Dreiecke je Mensch)
    const rows = group ? (r() < 0.55 ? [dx0, dx0 + 0.78] : [dx0])
      : v === 8 ? [0.45, 1.2, 1.95] : zone === 'village' ? [0.32, 1.02, 1.7] : [0.38, 1.1, 1.82, 2.55];
    // La-Ola: in manchen Fanzonen läuft eine Welle die Absperrung entlang (alle 40 m ein Wellenberg)
    const ola = zone === 'tifosi' && s.crowd && !group && hash(Math.floor(s.i / 30) * 31 + 7) < 0.3;
    const side = sg < 0 ? s.L : s.R;
    const w = this.w2;
    const pr = this.profile(side, s, sg, lim);
    const ground = (dx: number) => {
      const o = pr.o;
      for (let k = 0; k < o.length - 1; k++) {
        if (dx <= o[k + 1]) return pr.h[k] + (pr.h[k + 1] - pr.h[k]) * Math.max(0, Math.min(1, (dx - o[k]) / Math.max(1e-6, o[k + 1] - o[k])));
      }
      return pr.h[pr.h.length - 1];
    };
    const place = (p: Person, u: number, dx: number) => {
      const gh = ground(dx);
      t.world(s.i * SEG + u, sg * (EDGE + dx), gh, w);
      p.x = w.x; p.y = w.y; p.z = w.z;
      // Blick zur Straße, etwas dorthin, wo die Fahrer herkommen
      const rx = -sg * Math.cos(w.th);
      const rz = -sg * Math.sin(w.th);
      const bx = -Math.sin(w.th);
      const bz = Math.cos(w.th);
      const k = 0.25 + r() * 0.45;
      const j = (r() - 0.5) * 0.5;
      p.yaw = Math.atan2(rx + bx * k, rz + bz * k) + j;
    };
    for (let ri = 0; ri < rows.length; ri++) {
      if (zone === 'tifosi' && ri === 3 && r() < 0.35) continue;
      // Abstände so, dass sich niemand überschneidet – auch nicht mit dem Nachbarabschnitt (alle 4 m)
      let u = group ? r() * 1.2 : 0.3 + r() * 0.2;
      const step = group ? [0.6, 0.45] : ri === 0 ? [0.66, 0.2] : ri === 1 ? [0.72, 0.26] : ri === 2 ? [0.8, 0.32] : [0.86, 0.38];
      const end = group ? 1.8 + r() * 3.4 : 3.7;
      while (u < end) {
        let dx = rows[ri] + (r() - 0.5) * (ri ? 0.2 : 0.06);
        if (EDGE + dx > lim - 0.45) break;
        const kid = ri === 0 && r() < 0.1;
        if (kid) dx -= 0.06;
        const p = randomPerson(r, zone, { row: ri, kid });
        if (!s.crowd && p.act === Act.lean) p.act = Act.idle; // ohne Absperrung lehnt sich niemand an
        if (group && r() < 0.12) p.act = Act.sign;
        if (ola && p.act !== Act.sign && p.act !== Act.flag && r() < 0.85) {
          p.act = Act.ola;
          // Phase aus dem Ort: die Welle läuft der Straße entlang den Fahrern entgegen
          p.phase = ((s.i * SEG + u) * 0.03) / 37;
        }
        place(p, u, dx);
        out.push(p);
        if (p.act === Act.sign) this.signBoard(p, r);
        // Kind auf den Schultern
        if (ri > 0 && !kid && r() < 0.05) {
          p.act = Act.hold;
          const c = randomPerson(r, zone, { row: ri, kid: true });
          c.act = Act.sit;
          c.height = 0.56 + r() * 0.06;
          c.yaw = p.yaw;
          c.x = p.x - Math.sin(p.yaw) * 0.1 * p.height;
          c.z = p.z - Math.cos(p.yaw) * 0.1 * p.height;
          c.y = p.y + 1.47 * p.height - 0.9 * c.height;
          out.push(c);
        }
        // Fahnen und Schilder brauchen Platz
        const wide = p.act === Act.flag ? 0.4 : p.act === Act.sign ? 0.3 : p.act === Act.wave ? 0.12 : 0;
        u += step[0] + wide + r() * step[1] + (!group && r() < 0.06 ? 0.5 + r() * 0.7 : 0);
      }
    }
  }

  /** Pappschild über dem Kopf eines Fans, zur Straße gedreht; Rückseite Pappe */
  private signBoard(p: Person, r: () => number) {
    const gb = this.adsGB;
    if (!gb) return;
    const h = p.height;
    const w = 0.44 + r() * 0.08;
    const tall = 0.25 + r() * 0.04;
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    const rx = Math.cos(p.yaw);
    const rz = -Math.sin(p.yaw);
    const cx = p.x + fx * 0.36 * h;
    const cz = p.z + fz * 0.36 * h;
    const y0 = p.y + 1.86 * h;
    const y1 = y0 + tall * 2;
    const tilt = 0.06 * h; // oben etwas nach hinten
    const pt = (sx: number, y: number, back: number) => [cx + rx * sx - fx * back, y, cz + rz * sx - fz * back];
    const [u0, v0, u1, v1] = adCell(Math.floor(r() * SIGN_COUNT), true);
    const card: RGBf = lin('#b08a5a');
    gb.quad(pt(-w, y0, 0), pt(w, y0, 0), pt(w, y1, tilt), pt(-w, y1, tilt), card, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  }

  /** Zuschauer schauen dem Fahrer nach; ein paar Fans laufen ein Stück neben ihm her */
  private updateCrowd(g: RaceView, dt: number) {
    const pm = this.player;
    if (pm) this.crowdU.uRider.value.copy(pm.group.position);
    const cp = this.camera.position;
    for (const ch of this.chunks.values()) {
      for (const b of ch.crowd) {
        // nah: echte 3D-Menschen; ab gut 30 m Bilder (dort ist ein Bild nicht größer als im Vorrat gezeichnet)
        // feste Grenze mit etwas Spiel (kein Hin- und Herspringen, nicht von der Qualität abhängig)
        const d = cp.distanceTo(b.c) - b.r;
        const h = b.lod < 0 ? 0 : 2;
        const lod = d < 12 + (b.lod === 0 ? h : -h) ? 0 : d < 30 + (b.lod <= 1 ? h : -h) ? 1 : 2;
        if (lod === b.lod) continue;
        b.lod = lod;
        for (const m of b.near) m.visible = lod === 0;
        for (const m of b.mid) m.visible = lod === 1;
        if (b.spr) b.spr.visible = lod === 2;
      }
    }
    // Läufer: warten jubelnd am Rand, laufen los, wenn der Fahrer kommt, und lassen sich dann zurückfallen
    const t = g.track;
    const pz = g.p.z;
    if (g.phase === 'playing' || g.phase === 'ready' || g.phase === 'countdown') {
      const ahead = pz + 85;
      if (ahead > this.runNext && this.runners.length < 4 && t.segAt(ahead).crowd && !t.segAt(ahead).tunnel) {
        const r = Math.random;
        const sg = r() < 0.5 ? -1 : 1;
        const zone: Zone = t.sections[t.segAt(ahead).sec].biome === 'pass' ? 'pass' : 'tifosi';
        const p = randomPerson(r, zone, { row: 0, runner: true });
        const flag = p.act === Act.runFlag;
        this.runners.push({ z: ahead, x: sg * (ROAD_HALF + 0.42 + r() * 0.12), v: 0, go: false, p, act: p.act, yaw: 0, flag });
        this.runNext = ahead + 26 + r() * 34;
      }
    }
    const w = this.w2;
    let n = 0;
    this.runners = this.runners.filter((ru) => ru.z > pz - 30);
    const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
    for (const ru of this.runners) {
      const gap = ru.z - pz;
      if (!ru.go && gap < 20) ru.go = true;
      if (ru.go) {
        // anlaufen, solange der Fahrer noch dran ist; danach austrudeln
        const passed = gap < -3;
        // flotter Lauf, kein Sprint: der Fahrer zieht zügig vorbei
        const target = passed ? 0 : 6.2;
        const acc = passed ? -2.8 : 3.4;
        ru.v = passed ? Math.max(target, ru.v + acc * dt) : Math.min(target, ru.v + acc * dt);
        ru.z += ru.v * dt;
      }
      t.world(ru.z, ru.x, -0.04, w);
      const p = ru.p;
      p.x = w.x; p.y = w.y; p.z = w.z;
      const fwd = Math.atan2(Math.sin(w.th), -Math.cos(w.th));
      const toRider = Math.atan2(-Math.sin(w.th), Math.cos(w.th)) - Math.sign(ru.x) * 0.6;
      let want = toRider;
      if (ru.v > 1.2) {
        want = fwd;
        p.act = ru.v > 4.2 ? (ru.flag ? Act.runFlag : Act.run) : ru.flag ? Act.jogFlag : Act.jog;
      } else {
        p.act = ru.flag ? Act.flag : Act.cheer;
        if (ru.go && gap < -3) want = fwd; // schaut dem Fahrer nach
      }
      if (!ru.go && ru.yaw === 0) ru.yaw = want;
      ru.yaw += angDiff(want, ru.yaw) * Math.min(1, dt * 5);
      p.yaw = ru.yaw;
      if (n < 6) packPerson(p, this.runBuf.array as Float32Array, n++);
    }
    if (!this.runMeshes.length) {
      for (const kind of KINDS) {
        const geo = crowdGeometry(kind, 0, this.runBuf, 0);
        if (!geo) continue;
        const m = new THREE.Mesh(geo, this.crowdMat);
        m.frustumCulled = false;
        this.runMeshes.push(m);
        this.scene.add(m);
      }
    }
    for (const m of this.runMeshes) {
      (m.geometry as THREE.InstancedBufferGeometry).instanceCount = n;
      m.visible = n > 0;
    }
    if (n) this.runBuf.needsUpdate = true;
  }

  /** Namensschilder im Bild: Position, Deckkraft (weich ein- und ausgeblendet) */
  private tagView = new Map<number, { x: number; y: number; text: string; mate: boolean; a: number; on: boolean }>();
  private tagV = new THREE.Vector3();

  private updateRiders(g: RaceView) {
    const p = g.p;
    const track = g.track;
    const w = this.w;
    for (const t of this.tagView.values()) t.on = false;
    const kitKey = riderKitKey(p.kit);
    if (!this.player || this.playerKit !== kitKey) {
      if (this.player) this.scene.remove(this.player.group);
      this.player = new RiderModel(p.kit, this.shadowTex, 1);
      this.playerKit = kitKey;
      this.scene.add(this.player.group);
    }
    const pm = this.player;
    const roadY = track.heightAt(p.z);
    const air = Math.max(0, p.y - roadY);
    track.world(p.z, p.x, 0, w);
    pm.group.position.set(w.x, w.y + air, w.z);
    pm.group.rotation.y = -w.th;
    pm.shadow.position.y = 0.03 - air;
    (pm.shadow.material as THREE.MeshBasicMaterial).opacity = 0.3 / (1 + air * 2);
    if (g.phase === 'crash' || g.phase === 'over') pm.crash(g.phaseT, g.crashSpin);
    else {
      pm.resetCrash();
      pm.pose({ lean: p.lean, pedal: p.pedal, tuck: p.tuck, brake: p.brake, light: this.bikeLight(), roll: p.z / 0.34, stand: p.stand ?? 0, sprint: track.kind === 'sprint' ? 1 : 0 });
    }
    // Bildschirmposition für Popups
    const v = new THREE.Vector3(w.x, w.y + air + 1.9, w.z).project(this.camera);
    this.playerScreen.x = (v.x * 0.5 + 0.5) * this.W;
    this.playerScreen.y = (-v.y * 0.5 + 0.5) * this.H;

    // Gegner: die nächsten sichtbaren
    const seen = new Set<number>();
    // in den Rennfinals das ganze Feld; Fahrer zwischen Kamera und Spieler werden durchsichtig
    const sprint = track.kind !== 'descent';
    const list = g.opps.filter((o) => o.z > p.z - (sprint ? SPRINT_BACK + 1.5 : 8) && o.z < p.z + 320).sort((a, b) => Math.abs(a.z - p.z) - Math.abs(b.z - p.z)).slice(0, sprint ? 32 : 14);
    for (const o of list) {
      seen.add(o.id);
      let m = this.riders.get(o.id);
      if (m && m.kitKey !== riderKitKey(o.kit)) { this.scene.remove(m.group); m = undefined; }
      if (!m) {
        m = new RiderModel(o.kit, this.shadowTex);
        if (sprint) m.prepareFade();
        this.riders.set(o.id, m);
        this.scene.add(m.group);
      }
      m.group.visible = true;
      this.placeOpp(m, o, track);
      // weit weg (Kamera): kleine Teile weglassen
      m.setFar(this.camera.position.distanceToSquared(m.group.position) > (m.isFar ? 15 * 15 : 18 * 18));
      const tag = g.tags?.find((t) => t.id === o.id);
      if (tag) {
        // über dem Kopf des Fahrers (this.w hält nach placeOpp seine Weltposition)
        const v = this.tagV.set(this.w.x, this.w.y + 2.05, this.w.z).project(this.camera);
        if (v.z < 1) {
          const tv = this.tagView.get(o.id) ?? { x: 0, y: 0, text: '', mate: false, a: 0, on: false };
          tv.x = (v.x * 0.5 + 0.5) * this.W;
          tv.y = (-v.y * 0.5 + 0.5) * this.H;
          tv.text = tag.text;
          tv.mate = !!tag.mate;
          tv.on = true;
          this.tagView.set(o.id, tv);
        }
      }
      if (sprint) {
        const dz = o.z - p.z;
        const block = dz < 0.8 && dz > -SPRINT_BACK - 1 && Math.abs(o.x - p.x) < 1.05 + Math.max(0, -dz) * 0.06;
        m.fade(block ? 0.28 : 1, this.lastDt);
      }
    }
    // alle Fahrer vorab anlegen (ausgeblendet), damit beim Auftauchen nichts gebaut werden muss –
    // in den Finals immer, sonst in Ruhe auf der Startkarte
    if (sprint || this.idleBuild) {
      for (const o of g.opps) {
        if (this.riders.has(o.id)) continue;
        const m = new RiderModel(o.kit, this.shadowTex);
        if (sprint) m.prepareFade();
        m.group.visible = false;
        this.riders.set(o.id, m);
        this.scene.add(m.group);
      }
    }
    const alive = new Set(g.opps.map((o) => o.id));
    for (const [id, m] of this.riders) {
      if (seen.has(id)) continue;
      // außer Sicht: nur ausblenden – kommt der Fahrer zurück, ist er sofort wieder da (kein Neuaufbau, kein Ruckler);
      // wer nicht mehr im Rennen ist, fliegt raus
      if (alive.has(id)) m.group.visible = false;
      else { this.scene.remove(m.group); this.riders.delete(id); }
    }
  }

  private placeOpp(m: RiderModel, o: Opp, track: Track) {
    const w = this.w;
    track.world(o.z, o.x, 0, w);
    m.group.position.set(w.x, w.y, w.z);
    m.group.rotation.y = -w.th;
    m.pose({ lean: o.lean, pedal: o.pedal, tuck: o.tuck, brake: o.brake, light: this.bikeLight(), roll: o.z / 0.34, stand: o.stand ?? 0, sprint: track.kind === 'sprint' ? 1 : 0 });
  }

  private poolGet(kind: string, make: () => THREE.Object3D): THREE.Object3D {
    let list = this.objPool.get(kind);
    if (!list) { list = []; this.objPool.set(kind, list); }
    const used = this.objUsed.get(kind) ?? 0;
    if (used >= list.length) {
      const o = make();
      list.push(o);
      this.objRoot.add(o);
    }
    const o = list[used];
    o.visible = true;
    this.objUsed.set(kind, used + 1);
    return o;
  }

  private objMade = false;
  private objGeo: Record<string, THREE.BufferGeometry> = {};
  private objMat: Record<string, THREE.Material> = {};

  private makeObjAssets() {
    if (this.objMade) return;
    this.objMade = true;
    const bid = new GB();
    const M4 = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
    bid.add(new THREE.CylinderGeometry(0.075, 0.075, 0.22, 10), M4(0, 0, 0), lin('#3d8bfd'));
    bid.add(new THREE.CylinderGeometry(0.076, 0.076, 0.05, 10), M4(0, 0.02, 0), lin('#ffffff'));
    bid.add(new THREE.CylinderGeometry(0.035, 0.05, 0.07, 8), M4(0, 0.14, 0), lin('#1b1d22'));
    const gold = new GB();
    gold.add(new THREE.CylinderGeometry(0.075, 0.075, 0.22, 10), M4(0, 0, 0), lin('#ffd23f'));
    gold.add(new THREE.CylinderGeometry(0.035, 0.05, 0.07, 8), M4(0, 0.14, 0), lin('#b8860b'));
    const cone = new GB();
    cone.add(new THREE.ConeGeometry(0.17, 0.62, 10), M4(0, 0.35, 0), lin('#ff6a13'));
    cone.add(new THREE.CylinderGeometry(0.09, 0.115, 0.12, 10), M4(0, 0.38, 0), lin('#ffffff'));
    cone.add(new THREE.BoxGeometry(0.42, 0.04, 0.42), M4(0, 0.02, 0), lin('#1d1d1f'));
    const rock = new GB();
    rock.add(new THREE.DodecahedronGeometry(0.42, 0), new THREE.Matrix4().makeScale(1, 0.75, 0.9).setPosition(0, 0.25, 0), lin('#8a857c'));
    rock.add(new THREE.DodecahedronGeometry(0.2, 0), M4(0.4, 0.12, 0.2), lin('#7a756d'));
    this.objGeo = {
      bidon: bid.build(), gold: gold.build(), cone: cone.build(), rock: rock.build(),
      disc: new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2),
      ring: new THREE.RingGeometry(0.75, 1, 20).rotateX(-Math.PI / 2),
    };
    this.objMat = {
      v: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      gem: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color(0x553300), flatShading: true }),
      hole: new THREE.MeshBasicMaterial({ color: 0x1c1b1a, transparent: true, opacity: 0.85, depthWrite: false }),
      holeRim: new THREE.MeshBasicMaterial({ color: 0x9a9080, transparent: true, opacity: 0.35, depthWrite: false }),
      puddle: new THREE.MeshPhongMaterial({ color: 0x3d5566, shininess: 140, specular: 0xcfe4f5, transparent: true, opacity: 0.62, depthWrite: false }),
      glowB: new THREE.MeshBasicMaterial({ color: 0x59a6ff, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }),
      glowG: new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }),
    };
  }

  private updateObjects(g: RaceView) {
    this.makeObjAssets();
    for (const list of this.objPool.values()) for (const o of list) o.visible = false;
    this.objUsed.clear();
    const p = g.p;
    const track = g.track;
    const w = this.w;
    const i0 = Math.floor((p.z - 6) / SEG);
    const i1 = Math.floor((p.z + 220) / SEG);
    const geo = this.objGeo;
    const mat = this.objMat;
    for (let i = Math.max(0, i0); i <= i1; i++) {
      const s = track.seg(i);
      if (!s.objs) continue;
      for (const o of s.objs) {
        if (o.done && (o.k === 'bidon' || o.k === 'gold' || o.k === 'cone')) continue;
        track.world(o.z, o.x, 0, w);
        const th = w.th;
        switch (o.k) {
          case 'bidon':
          case 'gold': {
            const m = this.poolGet(o.k, () => {
              const gr = new THREE.Group();
              gr.add(new THREE.Mesh(o.k === 'gold' ? geo.gold : geo.bidon, o.k === 'gold' ? mat.gem : mat.v));
              const ring = new THREE.Mesh(geo.ring, o.k === 'gold' ? mat.glowG : mat.glowB);
              ring.name = 'ring';
              gr.add(ring);
              return gr;
            }) as THREE.Group;
            const bob = Math.sin(this.time.value * 4 + (o.ph ?? 0)) * 0.05;
            const body = m.children[0];
            body.position.set(0, 0.42 + bob, 0);
            body.rotation.set(0, this.time.value * 2.2 + (o.ph ?? 0), 0.25);
            body.scale.setScalar(o.k === 'gold' ? 1.6 : 1.35);
            const ring = m.children[1];
            ring.position.y = 0.03;
            ring.scale.setScalar(o.k === 'gold' ? 0.42 : 0.3);
            m.position.set(w.x, w.y, w.z);
            break;
          }
          case 'pothole': {
            const m = this.poolGet('pothole', () => {
              const gr = new THREE.Group();
              gr.add(new THREE.Mesh(geo.disc, mat.holeRim));
              gr.add(new THREE.Mesh(geo.disc, mat.hole));
              return gr;
            }) as THREE.Group;
            m.children[0].scale.set(o.r * 1.25, 1, o.r * 1.0);
            m.children[0].position.y = 0.02;
            m.children[1].scale.set(o.r * 1.05, 1, o.r * 0.8);
            m.children[1].position.set(0, 0.025, 0.04);
            m.position.set(w.x, w.y, w.z);
            m.rotation.y = -th;
            break;
          }
          case 'puddle': {
            const m = this.poolGet('puddle', () => new THREE.Mesh(geo.disc, mat.puddle));
            m.scale.set(o.r * 1.2, 1, o.r * 1.6);
            m.position.set(w.x, w.y + 0.02, w.z);
            m.rotation.y = -th;
            break;
          }
          case 'rock': {
            const m = this.poolGet('rock', () => new THREE.Mesh(geo.rock, mat.v));
            m.position.set(w.x, w.y, w.z);
            m.rotation.y = o.z;
            break;
          }
          case 'cone': {
            const m = this.poolGet('cone', () => new THREE.Mesh(geo.cone, mat.v));
            m.position.set(w.x, w.y, w.z);
            m.rotation.set(0, 0, 0);
            break;
          }
          case 'cow': {
            const kind = Math.floor(o.z) % 2 ? 'cowBW' : 'cow';
            const e = this.atlas.get(`${kind}:${o.vx ? 0 : 1}`);
            if (!e) break;
            const m = this.poolGet(`cow:${kind}:${o.vx ? 0 : 1}`, () => {
              const pg = new THREE.PlaneGeometry(e.w, e.h);
              pg.translate(0, e.h / 2, 0);
              const uv = pg.getAttribute('uv') as THREE.BufferAttribute;
              for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) ? e.u1 : e.u0, uv.getY(k) ? e.v1 : e.v0);
              const mesh = new THREE.Mesh(pg, this.mats.billboard);
              return mesh;
            }) as THREE.Mesh;
            const step = o.vx ? Math.abs(Math.sin(this.time.value * 6)) * 0.05 : 0;
            m.position.set(w.x, w.y + step, w.z);
            // Kuh von der Seite zeigen: Ebene längs zur Straße, in Laufrichtung gespiegelt
            m.rotation.set(0, -th + Math.PI / 2, 0);
            m.scale.set((o.vx ?? 0) > 0 ? -1 : 1, 1, 1);
            break;
          }
        }
      }
    }
  }

  private updateParticles(g: RaceView) {
    const n = Math.min(300, g.parts.length);
    const w = this.w;
    const col = new THREE.Color();
    for (let i = 0; i < 300; i++) {
      if (i < n) {
        const q = g.parts[i];
        g.track.world(q.z, q.x, q.h, w);
        this.partPos[i * 3] = w.x;
        this.partPos[i * 3 + 1] = w.y;
        this.partPos[i * 3 + 2] = w.z;
        col.set(q.color);
        const a = Math.max(0, q.life / q.max);
        this.partCol[i * 3] = col.r * a;
        this.partCol[i * 3 + 1] = col.g * a;
        this.partCol[i * 3 + 2] = col.b * a;
      } else {
        this.partPos[i * 3 + 1] = -1e6;
      }
    }
    const geo = this.parts.geometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  // ------------------------------------------------------------------ 2D-Ebene: Popups und Tempo-Linien

  /** wurde im letzten Bild etwas auf die Ebene gezeichnet? (sonst muss sie nicht neu gezeichnet werden) */
  private overlayDirty = true;

  private drawOverlay(g: RaceView) {
    const c = this.overlay;
    const busy = (g.p.v > 21 && g.phase === 'playing') || this.tagView.size > 0 || g.popups.length > 0;
    if (!busy && !this.overlayDirty) return;
    this.overlayDirty = busy;
    c.clearRect(0, 0, this.W, this.H);
    // leere Ebene ausblenden: der Browser muss sie dann nicht mehr über das Bild legen
    const vis = busy ? '' : 'hidden';
    if (this.overlayCv.style.visibility !== vis) this.overlayCv.style.visibility = vis;
    if (!busy) return;
    // Tempo-Linien am Rand
    const v = g.p.v;
    if (v > 21 && g.phase === 'playing') {
      const k = Math.min(1, (v - 21) / 14);
      c.strokeStyle = `rgba(255,255,255,${(0.18 * k).toFixed(3)})`;
      c.lineWidth = 1.2;
      const cx = this.W / 2;
      const cy = this.H * 0.42;
      for (let i = 0; i < 12; i++) {
        const a = hash(i * 7 + 1) * Math.PI * 2;
        const ph = (this.time.value * (1.4 + hash(i) * 1.1) + hash(i * 3)) % 1;
        const r0 = Math.max(this.W, this.H) * (0.42 + ph * 0.45);
        const r1 = r0 + 50 + 70 * k;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        if (sa > 0.2 && Math.abs(ca) < 0.5) continue;
        c.beginPath();
        c.moveTo(cx + ca * r0, cy + sa * r0 * 0.8);
        c.lineTo(cx + ca * r1, cy + sa * r1 * 0.8);
        c.stroke();
      }
    }
    // Namensschild über dem Hinterrad, an dem du fährst
    for (const [id, t] of this.tagView) {
      t.a += ((t.on ? 1 : 0) - t.a) * Math.min(1, this.lastDt * 9);
      if (!t.on && t.a < 0.02) { this.tagView.delete(id); continue; }
      this.drawTag(c, t);
    }
    // Hinweise links und rechts über dem Fahrer: nur Schrift, kleine Feder-Animation
    const ps = this.playerScreen;
    const tones: Record<string, string> = { accent: this.accent, gold: '#ffd23f', white: '#ffffff', muted: '#e4e4ea', red: '#ff8a7a', blue: '#9fd4ff' };
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const font = 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", -apple-system, "Segoe UI", Roboto, sans-serif';
    const easeBack = (x: number) => { const k = 1.9; return 1 + (k + 1) * Math.pow(x - 1, 3) + k * Math.pow(x - 1, 2); };
    const top = this.H * 0.36;
    const cx = Math.max(this.W * 0.3, Math.min(this.W * 0.7, ps.x));
    for (const pp of g.popups) {
      const t = pp.age / pp.life;
      const s = t < 0.22 ? Math.max(0.01, easeBack(t / 0.22)) : 1;
      const alpha = t < 0.06 ? t / 0.06 : t > 0.72 ? Math.max(0, (1 - t) / 0.28) : 1;
      const rise = (1 - Math.pow(1 - t, 3)) * 30;
      const drift = (1 - Math.pow(1 - t, 2)) * 10;
      const label = pp.text;
      const big = pp.big;
      const ptsSize = big ? 32 : pp.pts && !label ? 21 : 26;
      const labSize = big ? 17 : 14;
      const onlyText = !pp.pts;
      c.font = `800 ${onlyText ? (big ? 26 : 20) : ptsSize}px ${font}`;
      const w1 = c.measureText(onlyText ? label : pp.pts!).width;
      c.font = `700 ${labSize}px ${font}`;
      const w2 = label && !onlyText ? c.measureText(label).width : 0;
      const half = Math.max(w1, w2) / 2 + 6;
      const off = this.W * (0.2 + pp.dx * 0.07) + half * 0.35;
      const x = Math.max(12 + half, Math.min(this.W - 12 - half, cx + pp.side * off + pp.side * drift));
      const y = top + pp.slot * (big ? 76 : 64) + pp.dy * 10 - rise;
      c.save();
      c.globalAlpha = alpha;
      c.translate(x, y);
      c.rotate(pp.side * (0.07 * (1 - Math.min(1, t * 2.5)) + 0.015));
      c.scale(s, s);
      c.shadowColor = 'rgba(10, 12, 20, 0.55)';
      c.shadowBlur = 10;
      c.shadowOffsetY = 2;
      const col = tones[pp.tone] ?? '#fff';
      if (onlyText) {
        c.font = `800 ${big ? 26 : 20}px ${font}`;
        c.fillStyle = col;
        c.fillText(label, 0, 0);
      } else {
        if (label) {
          c.font = `700 ${labSize}px ${font}`;
          c.fillStyle = 'rgba(255,255,255,0.92)';
          c.fillText(label, 0, -ptsSize * 0.62);
        }
        c.font = `800 ${ptsSize}px ${font}`;
        c.fillStyle = col;
        c.fillText(pp.pts!, 0, label ? 4 : 0);
      }
      if (pp.sub) {
        c.font = `600 12px ${font}`;
        c.fillStyle = 'rgba(255,255,255,0.85)';
        c.fillText(pp.sub, 0, (onlyText ? 16 : ptsSize * 0.75 + 4));
      }
      // kleine Funkelsterne bei Gold und Akzent
      if ((pp.tone === 'gold' || pp.tone === 'accent') && t < 0.55) {
        c.shadowBlur = 0;
        const k = t / 0.55;
        c.globalAlpha = alpha * (1 - k);
        c.fillStyle = col;
        for (let i = 0; i < 4; i++) {
          const a = i * 1.7 + pp.dx * 6;
          const r = half * 0.7 + 8 + k * 16;
          const sx = Math.cos(a) * r;
          const sy = Math.sin(a) * r * 0.55 - 4;
          const sz = 3.2 * (1 - k * 0.6);
          c.beginPath();
          c.moveTo(sx, sy - sz * 1.6); c.lineTo(sx + sz * 0.4, sy - sz * 0.4); c.lineTo(sx + sz * 1.6, sy); c.lineTo(sx + sz * 0.4, sy + sz * 0.4);
          c.lineTo(sx, sy + sz * 1.6); c.lineTo(sx - sz * 0.4, sy + sz * 0.4); c.lineTo(sx - sz * 1.6, sy); c.lineTo(sx - sz * 0.4, sy - sz * 0.4);
          c.closePath();
          c.fill();
        }
      }
      c.restore();
    }
    c.globalAlpha = 1;
  }

  private drawTag(c: CanvasRenderingContext2D, t: { x: number; y: number; text: string; mate: boolean; a: number }) {
    const font = '-apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif';
    c.save();
    c.globalAlpha = t.a * 0.95;
    c.font = `700 12px ${font}`;
    const label = t.text;
    const tw = c.measureText(label).width;
    const dot = t.mate ? 12 : 0;
    const w = tw + 18 + dot;
    const h = 22;
    const x = Math.max(8, Math.min(this.W - 8 - w, t.x - w / 2));
    const y = t.y - h - 8 - (1 - t.a) * 6;
    c.fillStyle = 'rgba(12, 14, 20, 0.74)';
    c.beginPath();
    // abgerundete Pille (ohne roundRect, das ältere Safaris nicht kennen)
    const r = h / 2;
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
    c.lineTo(x + r, y + h);
    c.arc(x + r, y + r, r, Math.PI / 2, (Math.PI * 3) / 2);
    c.closePath();
    c.fill();
    // kleiner Zeiger nach unten zum Fahrer
    const px = Math.max(x + 10, Math.min(x + w - 10, t.x));
    c.beginPath();
    c.moveTo(px - 5, y + h - 0.5);
    c.lineTo(px + 5, y + h - 0.5);
    c.lineTo(px, y + h + 5);
    c.closePath();
    c.fill();
    if (t.mate) {
      c.fillStyle = this.accent;
      c.beginPath();
      c.arc(x + 12, y + h / 2, 3.5, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#fff';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(label, x + 9 + dot, y + h / 2 + 0.5);
    c.restore();
  }

  /** hat der Browser den 3D-Kontext entzogen (App im Hintergrund, Speicherdruck)? */
  get lost(): boolean {
    try { return this.gl.getContext().isContextLost(); } catch { return true; }
  }

  dispose() {
    try { this.clearChunks(); this.skyLife.dispose(); this.crowdAtlas.dispose(); } catch { /* Kontext evtl. schon weg */ }
    try { this.gl.dispose(); } catch { /* egal */ }
    // Kontext sofort freigeben: iOS erlaubt nur wenige gleichzeitig – sonst bleibt ein späteres Spiel schwarz
    try { this.gl.forceContextLoss(); } catch { /* egal */ }
  }
}


function fmtKm(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`;
}

export type { Friend };
