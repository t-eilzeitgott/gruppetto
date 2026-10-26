/**
 * WebGL-Renderer für „Abfahrt“ (three.js).
 * Die Strecke wird in Abschnitten (Chunks) als echte 3D-Geometrie gebaut: Fahrbahn mit Texturen,
 * Bankett, Markierungen, Gelände links und rechts (Wiese, Fels, Schnee, Wald, Seeufer), Leitplanken,
 * Häuserzeilen, Tunnel, Bäume und Requisiten. Dazu Himmel, ferne Berge, Talboden, Licht nach Tageszeit,
 * 3D-Fahrer und eine 2D-Ebene für Punkte-Popups.
 */
import * as THREE from 'three';
import { EDGE, ROAD_HALF, SEG, Track, type Seg, type Side, type Sprite, type BiomeId, type Banner } from './track';
import { BIOME_PALETTES, lightAt, mixRGB, type RGB, type Light } from './palette';
import { SpriteBank, cloud, roadArrow, roadText } from './sprites';
import { adCell, adsTex, AD_COUNT, SIGN_COUNT, asphaltTex, bannerTex, cobbleTex, detailTex, facadeTex, FACADE_BANDS, fieldsTex, gravelTex, roundTex, vergeTex } from './tex3d';
import { GB, RiderModel, lin, lin255, propGeometries, type Prop3D, type RGBf } from './models3d';
import type { Abfahrt, Opp, Friend } from './engine';
import { Act, KINDS, STRIDE, crowdGeometry, crowdMaterial, disposeCrowdGeometry, needs, packPerson, randomPerson, type Person, type Zone } from './crowd3d';
import { mulberry32 } from './rng';

const CH = 40;            // Segmente je Abschnitt (80 m)
const AHEAD = 560;        // so weit voraus wird gebaut (m)
const BEHIND = 30;
const CAM_BACK = 6.2;
const CAM_UP = 2.75;

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
interface CrowdBatch { near: THREE.Mesh[]; far: THREE.Mesh[]; c: THREE.Vector3; r: number; lod: number }
interface Chunk { idx: number; group: THREE.Group; dispose: () => void; glow: THREE.Points | null; crowd: CrowdBatch[] }
interface Runner { z: number; x: number; v: number; go: boolean; p: Person; act: number }
interface AtlasEntry { u0: number; v0: number; u1: number; v1: number; w: number; h: number; du: number }

export class Renderer3D {
  quality = 1;
  dark = false;
  accent = '#ff5fa2';
  readonly gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, 1, 0.2, 6000);
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
  private valley: THREE.Mesh;
  private valleyMat: THREE.MeshLambertMaterial;
  private clouds: THREE.Sprite[] = [];

  // Materialien
  private mats!: {
    asphalt: THREE.MeshLambertMaterial; fresh: THREE.MeshLambertMaterial; cobble: THREE.MeshLambertMaterial; gravel: THREE.MeshLambertMaterial;
    verge: THREE.MeshLambertMaterial; marks: THREE.MeshLambertMaterial; terrain: THREE.MeshLambertMaterial; portal: THREE.MeshLambertMaterial; barrier: THREE.MeshLambertMaterial;
    water: THREE.MeshPhongMaterial; tunnel: THREE.MeshBasicMaterial; facade: THREE.MeshLambertMaterial; roof: THREE.MeshLambertMaterial;
    props: THREE.MeshLambertMaterial; ads: THREE.MeshLambertMaterial; billboard: THREE.MeshLambertMaterial; glow: THREE.PointsMaterial; lampGlow: THREE.MeshBasicMaterial;
  };
  private props!: Record<Prop3D, THREE.BufferGeometry>;
  private atlas = new Map<string, AtlasEntry>();
  private bank = new SpriteBank();
  private labelTex = new Map<string, THREE.Texture>();
  private shadowTex!: THREE.Texture;
  private time = { value: 0 };

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
  private runners: Runner[] = [];
  private runBuf = new THREE.InstancedInterleavedBuffer(new Float32Array(6 * STRIDE), STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
  private runMeshes: THREE.Mesh[] = [];
  private runNext = 0;
  private adsGB: GB | null = null;
  private w2 = { x: 0, y: 0, z: 0, th: 0 };

  // Kamera
  private cam = { x: 0, y: 0, z: 0, th: 0, init: false, fov: 70 };
  playerScreen = { x: 0, y: 0, s: 60 };
  /** nur für Tests: feste Kamera [x, y, z, Blickziel x, y, z] */
  debugCam: number[] | null = null;
  private w = { x: 0, y: 0, z: 0, th: 0 };

  constructor(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: dpr < 1.5, powerPreference: 'high-performance', alpha: false, stencil: false });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.overlayCv = overlay;
    this.overlay = overlay.getContext('2d')!;
    this.scene.fog = this.fog;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.objRoot);

    // Himmel
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, below: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() }, sunCol: { value: new THREE.Color() }, sunSize: { value: 1 },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 below; uniform vec3 sunDir; uniform vec3 sunCol; uniform float sunSize;
        varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(horizon, below, clamp(-h * 6.0, 0.0, 1.0));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          c += sunCol * (pow(s, 900.0) * 3.0 * sunSize + pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.12);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), this.skyMat);
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);


    // Talboden
    const fields = new THREE.CanvasTexture(fieldsTex());
    fields.wrapS = fields.wrapT = THREE.RepeatWrapping;
    fields.repeat.set(26, 26);
    fields.colorSpace = THREE.SRGBColorSpace;
    fields.anisotropy = 4;
    this.valleyMat = new THREE.MeshLambertMaterial({ map: fields });
    this.valley = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), this.valleyMat);
    this.valley.rotation.x = -Math.PI / 2;
    this.scene.add(this.valley);

    // Wolken
    const cTex = [cloud(1), cloud(2), cloud(3)].map((c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; });
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
    const pt = new THREE.CanvasTexture(roundTex('rgba(255,255,255,1)', 'rgba(255,255,255,0)'));
    this.parts = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.35, map: pt, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }));
    this.parts.frustumCulled = false;
    this.scene.add(this.parts);

    this.initMaterials();
    this.resize();
  }

  private tex(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(c);
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, this.gl.capabilities.getMaxAnisotropy());
    return t;
  }

  private initMaterials() {
    const L = (opts: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(opts);
    const facade = this.tex(facadeTex(false));
    facade.wrapT = THREE.ClampToEdgeWrapping;
    const facadeLit = this.tex(facadeTex(true));
    facadeLit.wrapT = THREE.ClampToEdgeWrapping;
    const detail = this.tex(detailTex());
    this.shadowTex = new THREE.CanvasTexture(roundTex('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)', 64));
    const glowTex = new THREE.CanvasTexture(roundTex('rgba(255,210,140,1)', 'rgba(255,170,80,0)', 64));
    this.mats = {
      asphalt: L({ map: this.tex(asphaltTex(false)) }),
      fresh: L({ map: this.tex(asphaltTex(true)) }),
      cobble: L({ map: this.tex(cobbleTex()) }),
      gravel: L({ map: this.tex(gravelTex()) }),
      verge: L({ map: this.tex(vergeTex()) }),
      marks: L({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      terrain: L({ vertexColors: true, flatShading: true, map: detail }),
      portal: L({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }),
      barrier: L({ vertexColors: true, side: THREE.DoubleSide }),
      water: new THREE.MeshPhongMaterial({ color: 0x2f7fb5, shininess: 90, specular: 0x88aacc, transparent: true, opacity: 0.92, flatShading: true }),
      tunnel: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      facade: L({ map: facade, emissiveMap: facadeLit, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0 }),
      roof: L({ vertexColors: true, flatShading: true }),
      props: L({ vertexColors: true, flatShading: true }),
      ads: L({ vertexColors: true, side: THREE.DoubleSide }),
      billboard: L({ alphaTest: 0.5, side: THREE.DoubleSide }),
      glow: new THREE.PointsMaterial({ size: 3.2, map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 0 }),
      lampGlow: new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }),
    };
    this.props = propGeometries();
    // Banden und Schilder: vorn bedruckt, hinten schlichte Farbe (Eckpunktfarbe)
    this.mats.ads.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>',
        '#ifdef USE_COLOR\nif (!gl_FrontFacing) diffuseColor.rgb = vColor.rgb;\n#endif');
    };
    this.mats.ads.customProgramCacheKey = () => 'ads-1';
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
    const t = this.tex(cv, false);
    t.premultiplyAlpha = false;
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
    const dpr = Math.min(2, window.devicePixelRatio || 1) * this.quality;
    this.W = W;
    this.H = H;
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(W, H, false);
    const odpr = Math.min(2, window.devicePixelRatio || 1);
    this.overlayCv.width = Math.round(W * odpr);
    this.overlayCv.height = Math.round(H * odpr);
    this.overlay.setTransform(odpr, 0, 0, odpr, 0, 0);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ Bild

  draw(g: Abfahrt, dt: number) {
    this.time.value += dt;
    if (this.track !== g.track) this.reset(g.track);
    const fk = g.friends.map((f) => `${f.userId}:${f.meters}`).join('|');
    if (fk !== this.friendsKey) { this.friendsKey = fk; this.clearChunks(); }
    const p = g.p;
    const track = g.track;
    const seg = track.segAt(p.z);
    const biome = track.sections[seg.sec].biome;

    this.updateLight(g, biome, seg, dt);
    this.updateChunks(g);
    this.updateCamera(g, dt);
    if (this.debugCam) {
      const d = this.debugCam;
      this.camera.position.set(d[0], d[1], d[2]);
      this.camera.lookAt(d[3], d[4], d[5]);
    }
    this.updateEnvironment(biome, dt);
    this.updateRiders(g);
    this.updateCrowd(g, dt);
    this.updateObjects(g);
    this.updateParticles(g);
    this.gl.render(this.scene, this.camera);
    this.drawOverlay(g);
  }

  private reset(track: Track) {
    this.track = track;
    const old = this.mats.ads.map;
    this.mats.ads.map = this.tex(adsTex(track.names));
    this.mats.ads.map.wrapS = this.mats.ads.map.wrapT = THREE.ClampToEdgeWrapping;
    this.mats.ads.needsUpdate = true;
    old?.dispose();
    this.clearChunks();
    this.cam.init = false;
    this.runners = [];
    this.runNext = 0;
  }

  private clearChunks() {
    for (const c of this.chunks.values()) { this.scene.remove(c.group); c.dispose(); }
    this.chunks.clear();
  }

  private updateLight(g: Abfahrt, biome: BiomeId, seg: Seg, dt: number) {
    const z = g.p.z;
    const tod = this.dark ? 0.6 + Math.min(0.4, z / 11000) : Math.min(0.8, z / 10000);
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
    this.fog.density = 0.0021 + L.hazeAmt * 0.0008;
    const tint = new THREE.Color().setRGB(L.tint[0] / 255, L.tint[1] / 255, L.tint[2] / 255, THREE.SRGBColorSpace);
    const dayK = 1 - L.lights * 0.75;
    this.hemi.color.setRGB(0.78, 0.86, 1, THREE.SRGBColorSpace).multiply(tint);
    this.hemi.groundColor.setRGB(0.36, 0.4, 0.3, THREE.SRGBColorSpace).multiply(tint);
    this.hemi.intensity = (0.75 + 0.35 * dayK) * dim;
    const sunC = new THREE.Color().setRGB(L.sun[0] / 255, L.sun[1] / 255, L.sun[2] / 255, THREE.SRGBColorSpace);
    this.sun.color.copy(sunC);
    this.sun.intensity = Math.max(0.12, Math.min(1.9, (L.sunY + 0.08) * 6)) * dayK * dim;
    // Sonnenstand: fester Kurs in der Welt
    const el = Math.max(-0.2, L.sunY) * 1.4 + 0.05;
    const sd = new THREE.Vector3(Math.cos(el) * Math.sin(0.6), Math.sin(el), -Math.cos(el) * Math.cos(0.6)).normalize();
    this.sun.position.copy(this.camera.position).addScaledVector(sd, 200);
    this.sun.target.position.copy(this.camera.position);
    const u = this.skyMat.uniforms;
    const top = mixRGB(L.skyTop, pal.skyTop, 0.35 * (1 - L.t));
    const hz = mixRGB(L.skyHorizon, pal.skyHorizon, 0.35 * (1 - L.t));
    (u.top.value as THREE.Color).setRGB(top[0] / 255, top[1] / 255, top[2] / 255, THREE.SRGBColorSpace);
    (u.horizon.value as THREE.Color).setRGB(hz[0] / 255, hz[1] / 255, hz[2] / 255, THREE.SRGBColorSpace);
    (u.below.value as THREE.Color).copy(fogC);
    (u.sunDir.value as THREE.Vector3).copy(sd);
    (u.sunCol.value as THREE.Color).copy(sunC).multiplyScalar(L.sunY > -0.1 ? 1 : 0);
    this.mats.facade.emissiveIntensity = L.lights * 1.1;
    this.mats.glow.opacity = Math.max(0, L.lights - 0.2) * 1.1 + this.tunnelDim * 0.4;
    const valleyC = pal.valley;
    this.valleyMat.color.setRGB(valleyC[0] / 160, valleyC[1] / 160, valleyC[2] / 160, THREE.SRGBColorSpace);
    if (biome === 'lake') this.valleyMat.color.setRGB(0.35, 0.55, 0.75, THREE.SRGBColorSpace);
    const water = pal.water;
    this.mats.water.color.setRGB(water[0] / 255, water[1] / 255, water[2] / 255, THREE.SRGBColorSpace);
  }

  private updateCamera(g: Abfahrt, dt: number) {
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
    const back = CAM_BACK;
    const behindY = track.heightAt(Math.max(0, p.z - back));
    const ty = Math.max(behindY, roadY) + CAM_UP + air * 0.35;
    if (!cam.init || g.phase === 'ready' || g.phase === 'countdown') {
      cam.th = yaw;
      cam.y = ty;
      cam.init = true;
    }
    let d = yaw - cam.th;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    cam.th += d * Math.min(1, dt * 6);
    cam.y += (ty - cam.y) * Math.min(1, dt * 7);
    const fx = Math.sin(cam.th);
    const fz = -Math.cos(cam.th);
    const shake = g.shake * 0.04;
    this.camera.position.set(rx - fx * back + (Math.random() - 0.5) * shake, cam.y + (Math.random() - 0.5) * shake, rz - fz * back);
    const look = 15;
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
    this.valley.position.set(cp.x, cp.y - 210, cp.z);
    if (biome !== this.mtnBiome) {
      if (this.mtnOld) { this.scene.remove(this.mtnOld); this.mtnOld.geometry.dispose(); (this.mtnOld.material as THREE.Material).dispose(); }
      this.mtnOld = this.mtn;
      this.mtn = this.buildMountains(biome);
      this.scene.add(this.mtn);
      this.mtnFade = this.mtnOld ? 0 : 1;
      this.mtnBiome = biome;
    }
    this.mtnFade = Math.min(1, this.mtnFade + dt / 2.5);
    for (const [m, a] of [[this.mtn, this.mtnFade], [this.mtnOld, 1 - this.mtnFade]] as [THREE.Mesh | null, number][]) {
      if (!m) continue;
      m.position.set(cp.x, cp.y - 240, cp.z);
      (m.material as THREE.MeshLambertMaterial).opacity = a;
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

  /**
   * Berge rund um den Horizont: ein Höhenfeld-Ring mit Graten aus „Ridged Noise“.
   * Schnee nur auf flacheren Stellen, steile Flanken bleiben Fels, unten Wald und Matten,
   * mit der Entfernung zunehmender Dunst – so wirkt die Kulisse wie ein echtes Panorama.
   */
  private buildMountains(biome: BiomeId): THREE.Mesh {
    const pal = BIOME_PALETTES[biome];
    let seed = 7;
    for (const ch of biome) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const cfg: Record<BiomeId, { amp: number; snow: number; tree: number; sharp: number }> = {
      pass: { amp: 1750, snow: 0.3, tree: 0.15, sharp: 1.5 },
      alpine: { amp: 1650, snow: 0.36, tree: 0.28, sharp: 1.4 },
      forest: { amp: 950, snow: 0.68, tree: 0.6, sharp: 1.1 },
      village: { amp: 1450, snow: 0.42, tree: 0.34, sharp: 1.3 },
      lake: { amp: 1350, snow: 0.44, tree: 0.36, sharp: 1.3 },
      vineyard: { amp: 430, snow: 2, tree: 0.9, sharp: 0.8 },
    };
    const c = cfg[biome];
    // Wertrauschen mit weicher Interpolation
    const hh = (x: number, y: number) => {
      let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const noise = (x: number, y: number) => {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const fx = x - xi;
      const fy = y - yi;
      const u = fx * fx * (3 - 2 * fx);
      const v = fy * fy * (3 - 2 * fy);
      const a = hh(xi, yi) + (hh(xi + 1, yi) - hh(xi, yi)) * u;
      const b = hh(xi, yi + 1) + (hh(xi + 1, yi + 1) - hh(xi, yi + 1)) * u;
      return a + (b - a) * v;
    };
    // Grate: 1 - |n|, geschärft, mehrere Oktaven, feinere Oktaven folgen den groben
    const ridged = (x: number, y: number) => {
      let sum = 0;
      let amp = 0.55;
      let f = 1;
      let w = 1;
      for (let o = 0; o < 5; o++) {
        let n = 1 - Math.abs(noise(x * f, y * f) * 2 - 1);
        n = Math.pow(n, 2.2);
        sum += n * amp * w;
        w = Math.min(1, n * 1.6);
        f *= 2.03;
        amp *= 0.5;
      }
      return sum;
    };
    const R0 = 1250;
    const R1 = 4800;
    const NA = 240;
    const NR = 30;
    const pos: number[] = [];
    const rad: number[] = [];
    const heights: number[] = [];
    for (let i = 0; i < NR; i++) {
      const t = i / (NR - 1);
      const r = R0 * Math.pow(R1 / R0, t);
      // Anstieg vom Tal, ganz hinten etwas niedriger, damit die Gipfel davor die Silhouette bilden
      const env = Math.min(1, Math.max(0, (r - R0) / 900)) ** 1.4 * (1 - 0.35 * Math.max(0, (r - 3600) / (R1 - 3600)));
      for (let j = 0; j <= NA; j++) {
        const a = (j / NA) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const ridge = ridged(x / 1500 + 11, z / 1500 - 7);
        const massif = 0.55 + 0.45 * noise(x / 3800 + 3, z / 3800 + 5);
        const hgt = -120 + c.amp * env * massif * (0.12 + Math.pow(ridge, c.sharp) * 1.25);
        pos.push(x, hgt, z);
        rad.push(r);
        heights.push(hgt);
      }
    }
    const idx: number[] = [];
    const W = NA + 1;
    for (let i = 0; i < NR - 1; i++) {
      for (let j = 0; j < NA; j++) {
        const a = i * W + j;
        const b = a + W;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const nrm = geo.getAttribute('normal');
    const snow = lin('#f4f7fb');
    const snowShade = lin('#cdd8e6');
    const rock = rgbLin(mixRGB(pal.far, [128, 126, 122], 0.55));
    const rockDark = rgbLin(mixRGB(pal.far, [86, 84, 82], 0.6));
    const forest = rgbLin(mixRGB(pal.mid, [40, 70, 45], 0.45));
    const meadow = rgbLin(mixRGB(pal.mid, pal.valley, 0.5));
    const haze = rgbLin(pal.haze);
    const mix = (p: RGBf, q: RGBf, t: number): RGBf => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
    const sm = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    const col: number[] = [];
    for (let k = 0; k < heights.length; k++) {
      const h = heights[k];
      const ny = nrm.getY(k);
      const rel = (h + 120) / c.amp;
      const jitter = (noise(pos[k * 3] / 140, pos[k * 3 + 2] / 140) - 0.5) * 0.12;
      const steep = 1 - sm(0.55, 0.85, ny);
      // Fels, unten Wald und Matten
      let cc = mix(rock, rockDark, steep * 0.7);
      const veg = 1 - sm(c.tree - 0.06, c.tree + 0.06, rel + jitter);
      cc = mix(cc, mix(forest, meadow, sm(0.7, 0.95, ny) * 0.6), veg * (1 - steep * 0.6));
      // Schnee: über der Schneegrenze, nur wo es nicht zu steil ist
      const sn = sm(c.snow - 0.06, c.snow + 0.06, rel + jitter) * sm(0.28, 0.58, ny);
      cc = mix(cc, mix(snowShade, snow, sm(0.6, 0.95, ny)), sn);
      // Luftperspektive: weiter weg und weiter unten mehr Dunst
      const far = sm(R0, R1, rad[k]);
      const low = 1 - sm(-60, c.amp * 0.35, h);
      cc = mix(cc, haze, Math.min(0.85, 0.1 + far * 0.5 + low * 0.25));
      col.push(cc[0], cc[1], cc[2]);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 1 }));
    mesh.renderOrder = -5;
    mesh.frustumCulled = false;
    return mesh;
  }

  // ------------------------------------------------------------------ Abschnitte

  private updateChunks(g: Abfahrt) {
    const z = g.p.z;
    const from = Math.max(0, Math.floor((z - BEHIND) / SEG / CH));
    const to = Math.floor((z + AHEAD) / SEG / CH);
    for (const [k, c] of this.chunks) {
      if (k < from || k > to + 1) { this.scene.remove(c.group); c.dispose(); this.chunks.delete(k); }
    }
    // beim Start alles auf einmal, danach höchstens zwei pro Bild (nächste zuerst)
    let budget = this.chunks.size === 0 ? 99 : 2;
    for (let k = from; k <= to && budget > 0; k++) {
      if (this.chunks.has(k)) continue;
      const c = this.buildChunk(g, k);
      this.chunks.set(k, c);
      this.scene.add(c.group);
      budget--;
    }
  }

  private row(z: number, seg: Seg): Row {
    const w = this.track!.world(z, 0, 0, this.w);
    return { x: w.x, y: w.y, z: w.z, rx: Math.cos(w.th), rz: Math.sin(w.th), th: w.th, seg };
  }

  private buildChunk(g: Abfahrt, ci: number): Chunk {
    const t = this.track!;
    const i0 = ci * CH;
    const rows: Row[] = [];
    for (let r = 0; r <= CH; r++) rows.push(this.row((i0 + r) * SEG, t.seg(i0 + r)));
    const P = (r: Row, x: number, h: number): number[] => [r.x + r.rx * x, r.y + h, r.z + r.rz * x];
    const lim = this.limits(rows, i0);
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
    const tunnel = new GB();
    const facade = new GB();
    facade.uv = true;
    const roof = new GB();
    const bill = new GB();
    bill.uv = true;
    const ads = new GB();
    ads.uv = true;
    this.adsGB = ads;
    const anim: number[] = [];
    const glows: number[] = [];
    const people: Person[][] = [[], [], [], []];
    const inst = new Map<Prop3D, { m: THREE.Matrix4[]; c: THREE.Color[] }>();
    const white = lin('#f2f2ec');
    const sec = (s: Seg) => t.sections[s.sec];

    for (let r = 0; r < CH; r++) {
      const a = rows[r];
      const b = rows[r + 1];
      const s = a.seg;
      const za = (i0 + r) * SEG;
      const zb = za + SEG;
      // --- Fahrbahn
      if (!s.tunnel || true) {
        const tl = s.surface === 'cobble' ? 2.2 : 5;
        surf[s.surface].quad(P(a, -ROAD_HALF, 0), P(a, ROAD_HALF, 0), P(b, ROAD_HALF, 0), P(b, -ROAD_HALF, 0), [1, 1, 1],
          [[-ROAD_HALF / tl, za / tl], [ROAD_HALF / tl, za / tl], [ROAD_HALF / tl, zb / tl], [-ROAD_HALF / tl, zb / tl]]);
        for (const sg of [-1, 1]) {
          const x0 = sg * ROAD_HALF;
          const x1 = sg * EDGE;
          const q = sg < 0 ? [P(a, x1, -0.04), P(a, x0, 0), P(b, x0, 0), P(b, x1, -0.04)] : [P(a, x0, 0), P(a, x1, -0.04), P(b, x1, -0.04), P(b, x0, 0)];
          const ul = sg < 0 ? [x1, x0] : [x0, x1];
          verge.quad(q[0], q[1], q[2], q[3], [1, 1, 1], [[ul[0] / 3, za / 3], [ul[1] / 3, za / 3], [ul[1] / 3, zb / 3], [ul[0] / 3, zb / 3]]);
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
        for (const sg of [-1, 1]) this.terrainSide(terr, water, a, b, sg, P, sg < 0 ? lim.L[r] : lim.R[r], sg < 0 ? lim.L[r + 1] : lim.R[r + 1]);
      } else {
        this.tunnelPiece(tunnel, a, b, za, P, glows);
      }
      // --- Begrenzungen
      this.barriers(bar, ads, a, b, P);
      // --- Malereien
      if (s.decals) for (const d of s.decals) this.decal(group, disp, marks, rows, r, d, P);
      // --- Häuser
      for (const sg of [-1, 1]) {
        const bld = sg < 0 ? s.bL : s.bR;
        if (bld && bld.start === s.i) this.building(facade, roof, rows, r, bld, sg, P);
      }
      // --- Sprites/Requisiten
      if (s.sprites) {
        for (const sp of s.sprites) {
          const l = sp.x < 0 ? lim.L[r] : lim.R[r];
          if (sp.k === 'crowd') this.crowdPeople(people[Math.min(3, Math.floor(r / 10))], s, sp.x < 0 ? -1 : 1, l, sp.v, Math.abs(sp.x) - EDGE);
          else this.prop(group, disp, inst, bill, anim, glows, a, sp, s, l);
        }
      }
      // --- Banner, Portal
      if (s.banner) this.arch(group, disp, a, s.banner, s.banner.kind === 'gpm' ? this.accent : s.banner.kind === 'sprint' ? '#1f6feb' : '#ffffff');
      for (const f of g.friends) if (Math.floor(f.meters / SEG) === s.i) this.arch(group, disp, a, { kind: 'arch', text: f.userId === 'me' ? 'Deine Bestmarke' : `Bestmarke ${f.name}`, sub: fmtKm(f.meters) }, f.color);
      if (s.portal === 1) this.portal(portal, a, P, sec(s).biome);
    }

    const add = (gb: GB, m: THREE.Material, order = 0) => {
      if (gb.empty) return;
      const geo = gb.build();
      disp.push(geo);
      const mesh = new THREE.Mesh(geo, m);
      mesh.renderOrder = order;
      group.add(mesh);
    };
    add(surf.asphalt, this.mats.asphalt);
    add(surf.fresh, this.mats.fresh);
    add(surf.cobble, this.mats.cobble);
    add(surf.gravel, this.mats.gravel);
    add(verge, this.mats.verge);
    add(marks, this.mats.marks, 1);
    add(terr, this.mats.terrain);
    add(portal, this.mats.portal);
    add(bar, this.mats.barrier);
    add(water, this.mats.water, 2);
    add(tunnel, this.mats.tunnel);
    add(facade, this.mats.facade);
    add(roof, this.mats.roof);
    add(ads, this.mats.ads);
    if (!bill.empty) {
      const geo = bill.build();
      geo.setAttribute('aAnim', new THREE.Float32BufferAttribute(anim, 3));
      disp.push(geo);
      group.add(new THREE.Mesh(geo, this.mats.billboard));
    }
    for (const [kind, list] of inst) {
      const im = new THREE.InstancedMesh(this.props[kind], this.mats.props, list.m.length);
      list.m.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, list.c[i]); });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      group.add(im);
    }
    const crowd: CrowdBatch[] = [];
    const crowdGeos: THREE.BufferGeometry[] = [];
    for (const list of people) {
      if (!list.length) continue;
      const c = new THREE.Vector3();
      for (const pp of list) { c.x += pp.x; c.y += pp.y; c.z += pp.z; }
      c.divideScalar(list.length);
      let rad = 0;
      for (const pp of list) rad = Math.max(rad, Math.hypot(pp.x - c.x, pp.y - c.y, pp.z - c.z));
      const sphere = new THREE.Sphere(c, rad + 4);
      const batch: CrowdBatch = { near: [], far: [], c, r: rad, lod: -1 };
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
          (lod ? batch.far : batch.near).push(m);
        }
      }
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
    return {
      idx: ci, group, glow, crowd,
      dispose: () => {
        for (const d of disp) d.dispose();
        for (const geo of crowdGeos) disposeCrowdGeometry(geo);
        group.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
      },
    };
  }

  /**
   * Wie weit darf das Gelände seitlich reichen? Innen in engen Kurven und dort, wo ein anderer
   * Streckenteil (Serpentine) nahe vorbeiführt, wird es begrenzt – sonst ragt es in die Straße.
   */
  private limits(rows: Row[], i0: number): { L: number[]; R: number[] } {
    const t = this.track!;
    const L: number[] = [];
    const R: number[] = [];
    for (let r = 0; r < rows.length; r++) {
      const i = i0 + r;
      const row = rows[r];
      let l = 60;
      let rr = 60;
      let kmax = 0;
      let ksum = 0;
      for (let d = -16; d <= 16; d += 2) {
        const c = t.seg(Math.max(t.first, i + d)).curve;
        ksum += c;
        kmax = Math.max(kmax, Math.abs(c));
      }
      if (kmax > 0.003) {
        const inner = Math.max(EDGE + 2, 0.7 / kmax);
        if (ksum > 0) rr = Math.min(rr, inner); else l = Math.min(l, inner);
      }
      for (let j = Math.max(t.first, i - 450); j < i + 450; j += 3) {
        if (Math.abs(j - i) < 50) continue;
        const sj = t.seg(j);
        const dx = sj.wx - row.x;
        const dz = sj.wz - row.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 100 * 100) continue;
        const d = Math.sqrt(d2);
        const cap = Math.max(EDGE + 2, d * 0.5 - 2);
        if (dx * row.rx + dz * row.rz > 0) rr = Math.min(rr, cap); else l = Math.min(l, cap);
      }
      L.push(l);
      R.push(rr);
    }
    // weich übergehen lassen
    for (const arr of [L, R]) {
      const c = arr.slice();
      for (let r = 0; r < arr.length; r++) {
        let m = c[r];
        for (let d = -4; d <= 4; d++) { const q = c[r + d]; if (q !== undefined) m = Math.min(m, q + Math.abs(d) * 1.5); }
        arr[r] = m;
      }
    }
    return { L, R };
  }

  /** Querprofil des Geländes neben dem Bankett: Abstände ab Bankettkante und Höhen */
  private profile(side: Side, s: Seg, sg: number, lim = 60): { o: number[]; h: number[]; cols: RGBf[] } {
    const pr = this.rawProfile(side, s, sg);
    const maxO = Math.max(1.5, lim - EDGE);
    const last = pr.o[pr.o.length - 1];
    if (last > maxO) {
      const f = maxO / last;
      const base = side.wall > 0 && side.ground !== 'water' ? side.wall : 0;
      pr.o = pr.o.map((o) => o * f);
      pr.h = pr.h.map((h, k) => (side.wall > 0 && k < 2 ? h : base + (h - base) * f));
    }
    // Höhe begrenzen, damit nichts als Riesenwand in den Himmel ragt
    const capUp = (side.wall > 0 ? side.wall : 0) + 13;
    pr.h = pr.h.map((h) => Math.max(-38, Math.min(capUp, h)));
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
    if (side.ground === 'water') {
      const sand = lin('#b9ad96');
      return { o: [0, 0.4, 2, 10, 60, 200], h: [0, -1.25, -1.6, -2.4, -3, -3], cols: [sand, sand, rgbLin(pal.water), rgbLin(pal.water), rgbLin(pal.water)] };
    }
    if (side.wall > 0) {
      const W = side.wall;
      const snow = side.ground === 'snow';
      const top = side.ground === 'rock' ? 'meadow' : side.ground;
      const o = [0, snow ? 0.6 : 0.3, 1.8, 7, 16, 30];
      const h = [0, W, W + 0.4, W + side.tilt * 7 + n(1) * 1.2, W + side.tilt * 16 + n(2) * 2.5, W + side.tilt * 30 + n(3) * 4];
      const face = snow ? shadeF(lin('#e9f1fa'), 0.92 + n(40) * 0.1) : rock(0);
      return { o, h, cols: [face, snow ? lin('#f4f8fc') : shadeF(rock(1), 1.15), gcol(top, 2), gcol(top, 3), gcol(top, 4)] };
    }
    if (side.drop) {
      const k = Math.max(0.6, -side.tilt);
      return {
        o: [0, 0.9, 3, 7, 12, 18],
        h: [0, -0.5 * k, -3 * k, -8 * k + n(1) * 1.5, -16 * k + n(2) * 2, -26 * k],
        cols: [gcol(side.ground, 0), gcol(side.ground, 1), shadeF(gcol(side.ground, 2), 0.92), shadeF(rock(3), 0.95), rock(4)],
      };
    }
    if (side.ground === 'pavement') {
      const pv = lin('#b9b2a5');
      return { o: [0, 0.02, 3.5, 8, 18, 34], h: [0, 0.13, 0.13, 0.4, 1.5, 3], cols: [lin('#a8a296'), pv, gcol('meadow', 2), gcol('meadow', 3), gcol('meadow', 4)] };
    }
    const tl = side.tilt;
    const o = [0, 1.5, 5, 11, 20, 34];
    const bump = (k: number, amp: number) => n(k) * amp;
    const h = [0, tl * 1.5, tl * 5 + bump(1, 0.4), tl * 11 + bump(2, 1), tl * 20 + bump(3, 2), tl * 34 + bump(4, 3)];
    const g = side.ground;
    return { o, h, cols: [gcol(g, 0), gcol(g, 1), gcol(g, 2), gcol(g, 3), gcol(g, 5)] };
  }

  private terrainSide(terr: GB, water: GB, a: Row, b: Row, sg: number, P: (r: Row, x: number, h: number) => number[], limA: number, limB: number) {
    const sa = sg < 0 ? a.seg.L : a.seg.R;
    const sb = sg < 0 ? b.seg.L : b.seg.R;
    const pa = this.profile(sa, a.seg, sg, limA);
    const pb = this.profile(sb, b.seg, sg, limB);
    for (let k = 0; k < 5; k++) {
      const xa0 = sg * (EDGE + pa.o[k]);
      const xa1 = sg * (EDGE + pa.o[k + 1]);
      const xb0 = sg * (EDGE + pb.o[k]);
      const xb1 = sg * (EDGE + pb.o[k + 1]);
      const A0 = P(a, xa0, pa.h[k] - 0.04);
      const A1 = P(a, xa1, pa.h[k + 1] - 0.04);
      const B0 = P(b, xb0, pb.h[k] - 0.04);
      const B1 = P(b, xb1, pb.h[k + 1] - 0.04);
      const col = pa.cols[k];
      const uv = (v: number[]) => [v[0] / 6, v[2] / 6];
      if (sg > 0) terr.quad(A0, A1, B1, B0, col, [uv(A0), uv(A1), uv(B1), uv(B0)]);
      else terr.quad(A1, A0, B0, B1, col, [uv(A1), uv(A0), uv(B0), uv(B1)]);
    }
    if (sa.ground === 'water' || sb.ground === 'water') {
      const A0 = P(a, sg * (EDGE + 0.3), -1.4);
      const A1 = P(a, sg * Math.max(EDGE + 2, limA), -1.4);
      const B0 = P(b, sg * (EDGE + 0.3), -1.4);
      const B1 = P(b, sg * Math.max(EDGE + 2, limB), -1.4);
      const c: RGBf = [1, 1, 1];
      if (sg > 0) water.quad(A0, A1, B1, B0, c); else water.quad(A1, A0, B0, B1, c);
    }
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

  private tunnelPiece(gb: GB, a: Row, b: Row, za: number, P: (r: Row, x: number, h: number) => number[], glows: number[]) {
    const x = EDGE - 0.35;
    const m = ((za % 12) + 12) % 12;
    const near = Math.min(m, 12 - m);
    const br = 0.45 + 0.55 * Math.max(0, 1 - near / 5);
    const c = (hex: string) => shadeF(lin(hex), br);
    const prof: [number, number][] = [[-x, 0], [-x, 1.3], [-x, 4.3], [-1.7, 5.7], [1.7, 5.7], [x, 4.3], [x, 1.3], [x, 0]];
    const cols = [c('#c4c6c8'), c('#6e7176'), c('#575a5f'), c('#4b4e53'), c('#575a5f'), c('#6e7176'), c('#c4c6c8')];
    for (let k = 0; k < prof.length - 1; k++) {
      const [x0, h0] = prof[k];
      const [x1, h1] = prof[k + 1];
      gb.quad(P(a, x0, h0), P(b, x0, h0), P(b, x1, h1), P(a, x1, h1), cols[k]);
    }
    if (a.seg.lamp) {
      for (const sg of [-1, 1]) {
        const lamp = lin('#fff1c8');
        const p0 = P(a, sg * 1.2 - 0.3, 5.62);
        const p1 = P(a, sg * 1.2 + 0.3, 5.62);
        const p2 = P(b, sg * 1.2 + 0.3, 5.62);
        const p3 = P(b, sg * 1.2 - 0.3, 5.62);
        const mid = (u: number[], v: number[]) => [(u[0] + v[0]) / 2, u[1], (u[2] + v[2]) / 2];
        gb.quad(p0, p1, mid(p1, p2), mid(p0, p3), lamp);
        const g = P(a, sg * 1.2, 5.3);
        glows.push(g[0], g[1], g[2]);
      }
    }
  }

  private portal(gb: GB, a: Row, P: (r: Row, x: number, h: number) => number[], biome: BiomeId) {
    const pal = BIOME_PALETTES[biome];
    const x = EDGE - 0.35;
    const shape = new THREE.Shape();
    shape.moveTo(-60, -3);
    shape.quadraticCurveTo(-48, 10, -30, 19);
    shape.quadraticCurveTo(-12, 27, 0, 27);
    shape.quadraticCurveTo(15, 27, 33, 17);
    shape.quadraticCurveTo(50, 8, 60, -3);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-x, 0);
    hole.lineTo(x, 0);
    hole.lineTo(x, 4.3);
    hole.quadraticCurveTo(x, 5.8, 0, 5.85);
    hole.quadraticCurveTo(-x, 5.8, -x, 4.3);
    hole.closePath();
    shape.holes.push(hole);
    const sg = new THREE.ShapeGeometry(shape, 6);
    const pos = sg.toNonIndexed().getAttribute('position');
    const rock = rgbLin(pal.rock);
    const green = rgbLin(pal.ground.forest[0]);
    for (let i = 0; i < pos.count; i += 3) {
      const tri: number[][] = [];
      let hy = 0;
      for (let k = 0; k < 3; k++) {
        const px = pos.getX(i + k);
        const py = pos.getY(i + k);
        hy += py / 3;
        tri.push(P(a, px, py));
      }
      const col = hy > 12 ? shadeF(green, 0.9 + hash(i) * 0.15) : shadeF(rock, 0.88 + hash(i) * 0.2);
      gb.tri(tri[0], tri[1], tri[2], col);
    }
    sg.dispose();
    // Betonrahmen
    const conc = lin('#c9c4ba');
    const ring = (h0: number, w: number) => {
      const N = 10;
      for (let k = 0; k < N; k++) {
        const t0 = (k / N) * Math.PI;
        const t1 = ((k + 1) / N) * Math.PI;
        const pt = (t: number, r: number) => P(a, Math.cos(t) * r, h0 + Math.sin(t) * 1.6);
        gb.quad(pt(t0, x), pt(t0, x + w), pt(t1, x + w), pt(t1, x), conc);
      }
    };
    ring(4.25, 0.6);
  }

  private building(facade: GB, roof: GB, rows: Row[], r: number, b: NonNullable<Seg['bL']>, sg: number, P: (r: Row, x: number, h: number) => number[]) {
    const a = rows[r];
    const len = b.len * SEG;
    const fx = Math.sin(a.th);
    const fz = -Math.cos(a.th);
    const base = a.y - 2;
    const at = (lat: number, along: number, h: number) => [a.x + a.rx * lat + fx * along, base + 2 + h, a.z + a.rz * lat + fz * along];
    const H = b.height;
    const N = FACADE_BANDS;
    const band = b.style === 2 ? 7 : b.style === 1 ? 6 : b.color % 7;
    const vAt = (h: number) => 1 - (band + 1) / N + (Math.max(0, Math.min(12, (h / H) * 12)) / 12) / N * 0.999;
    const l0 = sg * b.setback;
    const l1 = sg * (b.setback + b.depth);
    // Front zur Straße
    const f0 = at(l0, 0, -2);
    const f1 = at(l0, len, -2);
    const f2 = at(l0, len, H);
    const f3 = at(l0, 0, H);
    const uv = (u: number, h: number) => [u / 4, vAt(h)];
    if (sg < 0) facade.quad(f0, f1, f2, f3, [1, 1, 1], [uv(0, 0), uv(len, 0), uv(len, H), uv(0, H)]);
    else facade.quad(f1, f0, f3, f2, [1, 1, 1], [uv(len, 0), uv(0, 0), uv(0, H), uv(len, H)]);
    // Stirnseite (zur Kamera hin)
    const e0 = at(l0, 0, -2);
    const e1 = at(l1, 0, -2);
    const e2 = at(l1, 0, H);
    const e3 = at(l0, 0, H);
    const dep = b.depth;
    if (sg < 0) facade.quad(e1, e0, e3, e2, [1, 1, 1], [uv(dep, 0), uv(0, 0), uv(0, H), uv(dep, H)]);
    else facade.quad(e0, e1, e2, e3, [1, 1, 1], [uv(0, 0), uv(dep, 0), uv(dep, H), uv(0, H)]);
    // Dach mit First parallel zur Straße
    const roofCol = lin(['#a8492a', '#8a3c24', '#5a4a40'][b.roof]);
    const lm = (l0 + l1) / 2;
    const rh = H + Math.min(3.2, b.depth * 0.38);
    const ov = sg * 0.5;
    const r0 = at(l0 - ov, -0.4, H - 0.15);
    const r1 = at(l0 - ov, len + 0.4, H - 0.15);
    const r2 = at(lm, len + 0.4, rh);
    const r3 = at(lm, -0.4, rh);
    const r4 = at(l1 + ov, -0.4, H - 0.15);
    const r5 = at(l1 + ov, len + 0.4, H - 0.15);
    if (b.style !== 2) {
      roof.quad(r0, r1, r2, r3, roofCol);
      roof.quad(r3, r2, r5, r4, shadeF(roofCol, 0.85));
      const wall = shadeF(lin(['#dca86a', '#e2997c', '#ecdcbc', '#e8c86c', '#d98f8c', '#cc7a55', '#eeeae0'][b.color % 7]), 0.8);
      roof.tri(at(l0, 0, H), at(lm, 0, rh - 0.2), at(l1, 0, H), wall);
      // Unterseite der Traufe
      roof.quad(at(l0, 0, H - 0.1), at(l0 - ov, 0, H - 0.15), at(l0 - ov, len, H - 0.15), at(l0, len, H - 0.1), lin('#4a3226'));
    } else {
      // Kirche: flaches Dach und Turm
      roof.quad(r0, r1, r5, r4, lin('#8a7d6c'));
      const tw = 4;
      const tl0 = l0;
      const tl1 = l0 + sg * tw;
      const stone = lin('#cfc4b0');
      const TH = 24;
      const T = (lat: number, al: number, h: number) => at(lat, al, h);
      const faces = [[T(tl0, 0, 0), T(tl1, 0, 0), T(tl1, 0, TH), T(tl0, 0, TH)], [T(tl0, tw, 0), T(tl0, 0, 0), T(tl0, 0, TH), T(tl0, tw, TH)], [T(tl1, 0, 0), T(tl1, tw, 0), T(tl1, tw, TH), T(tl1, 0, TH)]];
      for (const f of faces) roof.quad(f[0], f[1], f[2], f[3], stone);
      const tc = T((tl0 + tl1) / 2, tw / 2, TH + 5);
      const tr = lin('#9a4a30');
      roof.tri(T(tl0, 0, TH), T(tl1, 0, TH), tc, tr);
      roof.tri(T(tl1, 0, TH), T(tl1, tw, TH), tc, shadeF(tr, 0.85));
      roof.tri(T(tl0, tw, TH), T(tl0, 0, TH), tc, shadeF(tr, 0.9));
      roof.quad(T(tl0, -0.01, 20.5), T(tl1, -0.01, 20.5), T(tl1, -0.01, 22.5), T(tl0, -0.01, 22.5), lin('#3a332c'));
    }
    void P;
  }

  private prop(group: THREE.Group, disp: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[], inst: Map<Prop3D, { m: THREE.Matrix4[]; c: THREE.Color[] }>,
    bill: GB, anim: number[], glows: number[], a: Row, sp: Sprite, s: Seg, lim: number) {
    const sg = sp.x < 0 ? -1 : 1;
    const ax = Math.abs(sp.x);
    let h = sp.h;
    if (ax > EDGE && !s.tunnel) {
      if (ax > lim - 0.5) return;
      const side = sg < 0 ? s.L : s.R;
      const gh = this.groundAt(side, s, sg, ax - EDGE, lim);
      if (gh === null) return;
      h = side.ground === 'water' && ax > EDGE + 2 ? -1.4 : gh;
    }
    const px = a.x + a.rx * sp.x;
    const py = a.y + h;
    const pz = a.z + a.rz * sp.x;
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
      let list = inst.get(kind);
      if (!list) { list = { m: [], c: [] }; inst.set(kind, list); }
      list.m.push(m);
      list.c.push(new THREE.Color(v, v * (0.95 + hash(s.i) * 0.1), v));
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
    const du = flip ? -e.du : e.du;
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
    const rows = group ? [dx0]
      : v === 8 ? [0.45, 1.1] : zone === 'village' ? [0.3, 0.92] : [0.34, 0.98, 1.62];
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
      if (zone === 'tifosi' && ri === 2 && r() < 0.45) continue;
      let u = r() * (group ? 1.2 : 0.45);
      const step = group ? [0.55, 0.6] : ri === 0 ? [0.56, 0.22] : ri === 1 ? [0.62, 0.26] : [0.74, 0.4];
      const end = group ? 1.4 + r() * 2.6 : 4;
      while (u < end) {
        let dx = rows[ri] + (r() - 0.5) * (ri ? 0.26 : 0.1);
        if (EDGE + dx > lim - 0.45) break;
        const kid = ri === 0 && r() < 0.1;
        if (kid) dx -= 0.06;
        const p = randomPerson(r, zone, { row: ri, kid });
        if (!s.crowd && p.act === Act.lean) p.act = Act.idle; // ohne Absperrung lehnt sich niemand an
        if (group && r() < 0.12) p.act = Act.sign;
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
        u += step[0] + r() * step[1] + (!group && r() < 0.06 ? 0.5 + r() * 0.7 : 0);
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
  private updateCrowd(g: Abfahrt, dt: number) {
    const pm = this.player;
    if (pm) this.crowdU.uRider.value.copy(pm.group.position);
    const cp = this.camera.position;
    for (const ch of this.chunks.values()) {
      for (const b of ch.crowd) {
        // nah: volle Figuren; weit: vereinfacht; ganz weit (nur noch Pünktchen): aus
        const d = cp.distanceTo(b.c) - b.r;
        const near = this.quality < 0.8 ? 32 : 55;
        const lod = d < near ? 0 : d < (this.quality < 0.8 ? 200 : 300) ? 1 : 2;
        if (lod === b.lod) continue;
        b.lod = lod;
        for (const m of b.near) m.visible = lod === 0;
        for (const m of b.far) m.visible = lod === 1;
      }
    }
    // Läufer
    const t = g.track;
    const pz = g.p.z;
    if (g.phase === 'playing' || g.phase === 'ready' || g.phase === 'countdown') {
      const ahead = pz + 42;
      if (ahead > this.runNext && this.runners.length < 4 && t.segAt(ahead).crowd && !t.segAt(ahead).tunnel) {
        const r = Math.random;
        const sg = r() < 0.5 ? -1 : 1;
        const zone: Zone = t.sections[t.segAt(ahead).sec].biome === 'pass' ? 'pass' : 'tifosi';
        const p = randomPerson(r, zone, { row: 0, runner: true });
        this.runners.push({ z: ahead, x: sg * (ROAD_HALF + 0.4 + r() * 0.15), v: 0, go: false, p, act: p.act });
        this.runNext = ahead + 22 + r() * 34;
      }
    }
    const w = this.w2;
    let n = 0;
    this.runners = this.runners.filter((ru) => ru.z > pz - 28);
    for (const ru of this.runners) {
      if (!ru.go && ru.z - pz < 15) ru.go = true;
      if (ru.go) {
        ru.v = Math.min(8.2, ru.v + dt * 7);
        ru.z += ru.v * dt;
      }
      t.world(ru.z, ru.x, -0.04, w);
      const p = ru.p;
      p.x = w.x; p.y = w.y; p.z = w.z;
      if (ru.go) {
        p.act = ru.act;
        p.yaw = Math.atan2(Math.sin(w.th), -Math.cos(w.th));
      } else {
        // wartet am Rand und jubelt dem Fahrer entgegen
        p.act = ru.act === Act.runFlag ? Act.flag : Act.cheer;
        p.yaw = Math.atan2(-Math.sin(w.th), Math.cos(w.th)) - Math.sign(ru.x) * 0.6;
      }
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

  private updateRiders(g: Abfahrt) {
    const p = g.p;
    const track = g.track;
    const w = this.w;
    const kitKey = p.kit.jersey + p.kit.helmet;
    if (!this.player || this.playerKit !== kitKey) {
      if (this.player) this.scene.remove(this.player.group);
      this.player = new RiderModel(p.kit, this.shadowTex);
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
    (pm.shadow.material as THREE.MeshBasicMaterial).opacity = 0.55 / (1 + air * 2);
    if (g.phase === 'crash' || g.phase === 'over') pm.crash(g.phaseT, g.crashSpin);
    else {
      pm.resetCrash();
      pm.pose({ lean: p.lean, pedal: p.pedal, tuck: p.tuck, brake: p.brake, light: this.night + this.tunnelDim, roll: p.z / 0.34 });
    }
    // Bildschirmposition für Popups
    const v = new THREE.Vector3(w.x, w.y + air + 1.9, w.z).project(this.camera);
    this.playerScreen.x = (v.x * 0.5 + 0.5) * this.W;
    this.playerScreen.y = (-v.y * 0.5 + 0.5) * this.H;

    // Gegner: die nächsten sichtbaren
    const seen = new Set<number>();
    const list = g.opps.filter((o) => o.z > p.z - 8 && o.z < p.z + 320).sort((a, b) => Math.abs(a.z - p.z) - Math.abs(b.z - p.z)).slice(0, 14);
    for (const o of list) {
      seen.add(o.id);
      let m = this.riders.get(o.id);
      if (!m) {
        m = new RiderModel(o.kit, this.shadowTex);
        this.riders.set(o.id, m);
        this.scene.add(m.group);
      }
      this.placeOpp(m, o, track);
    }
    for (const [id, m] of this.riders) {
      if (!seen.has(id)) { this.scene.remove(m.group); this.riders.delete(id); }
    }
  }

  private placeOpp(m: RiderModel, o: Opp, track: Track) {
    const w = this.w;
    track.world(o.z, o.x, 0, w);
    m.group.position.set(w.x, w.y, w.z);
    m.group.rotation.y = -w.th;
    m.pose({ lean: o.lean, pedal: o.pedal, tuck: o.tuck, brake: o.brake, light: this.night + this.tunnelDim, roll: o.z / 0.34 });
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
      puddle: new THREE.MeshPhongMaterial({ color: 0x8fb4d6, shininess: 120, specular: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }),
      glowB: new THREE.MeshBasicMaterial({ color: 0x59a6ff, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }),
      glowG: new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }),
    };
  }

  private updateObjects(g: Abfahrt) {
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

  private updateParticles(g: Abfahrt) {
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

  private drawOverlay(g: Abfahrt) {
    const c = this.overlay;
    c.clearRect(0, 0, this.W, this.H);
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

  dispose() {
    this.clearChunks();
    this.gl.dispose();
  }
}


function fmtKm(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`;
}

export type { Friend };
