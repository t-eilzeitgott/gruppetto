/**
 * WebGPU-Test: ein Stück Passabfahrt mit three.js' WebGPU-Renderer – physikalische Materialien, gebackene
 * Oberflächen, Himmel als Umgebungslicht, weiche Sonnenschatten, Luftperspektive, Bloom, Kantenglättung.
 * Dieselbe Strecke und Landschaft wie im Spiel (Track, terrain3d), nur anders gezeichnet. Der Fahrer fährt
 * von selbst; die Kamera wechselt auf Tippen.
 *
 * Ziel: 120 Bilder/s auf einem iPhone 15 Pro. Die Auflösung regelt sich nach der gemessenen Bildzeit.
 */
import * as THREE from 'three/webgpu';
import { bloom } from '../../../vendor/three/addons/BloomNode.js';
import { Track, SEG, EDGE } from '../abfahrt/track';
import { Terrain } from '../abfahrt/terrain3d';
import { adsTex } from '../abfahrt/tex3d';
import { bakeSurfaces, type Surface, type SurfaceId } from './bake';
import { buildSky, type SkySetup } from './sky';
import { corridorMaterial, terrainMaterial } from './ground';
import { adsMaterial, marksMaterial, metalMaterial, paintMaterial, roadMaterial, woodMaterial } from './mats';
import { Corridor } from './corridor';
import { Field, type RouteSample } from './field';
import { Trees } from './trees';
import { Rider } from './rider';
import { Grass } from './grass';
import { tsl } from './nodes';

const { cameraPosition, cubeTexture, dot, exp, float, fog, max, mix, normalize, pass, positionView, positionWorld, pow, smoothstep, uniform, uv, vec3 } = tsl;

export interface ShowcaseStats {
  fps: number;
  /** geglättete Bildzeit (ms) */
  ms: number;
  /** Bildschirmtakt (ms) */
  period: number;
  dpr: number;
  backend: string;
  tris: number;
  calls: number;
  /** Rechenzeit je Bild auf der CPU (ms, geglättet) */
  cpu: number;
  /** Aufbau 0 … 1 */
  loading: number;
  /** was gerade geladen wird */
  stage: string;
  note: string;
}

export interface ShowcaseOptions {
  dayKey: string;
  names: string[];
  onStats?: (s: ShowcaseStats) => void;
  onReady?: () => void;
  onError?: (e: unknown) => void;
}

export type CamMode = 'chase' | 'side' | 'drone' | 'low';

/** Teststrecke: Start nach der Zuschauerzone auf der Passhöhe, Ende vor dem nächsten Abschnitt */
const Z0 = 150;
const Z1 = 2540;

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class Showcase {
  private renderer: THREE.WebGPURenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.3, 24000);
  private pipeline: THREE.RenderPipeline | null = null;
  private sky: SkySetup | null = null;
  private track: Track | null = null;
  private corridor: Corridor | null = null;
  private field: Field | null = null;
  private trees: Trees | null = null;
  private rider: Rider | null = null;
  private grass: Grass | null = null;
  private disposed = false;
  private last = 0;
  private avgMs = 1000 / 60;
  private period = 1000 / 60;
  private intervals: number[] = [];
  private dpr = 1.5;
  private maxDpr = 2;
  private lastDprChange = 0;
  private slowFor = 0;
  private fastFor = 0;
  private ready = false;
  private loadFrac = 0;
  private stage = 'WebGPU startet';
  private avgCpu = 0;
  private scenePass: ReturnType<typeof pass> | null = null;
  private _cam: CamMode = 'chase';
  /** Kamerawechsel: von welcher Einstellung, wie weit übergeblendet (0 … 1) */
  private camFrom: CamMode | null = null;
  private camBlend = 1;
  /** Seite des Begleitmotorrads (fest je Wechsel – kein Springen, wenn der Fahrer die Straßenmitte kreuzt) */
  private sideSign = 1;
  /** Prüfbilder ohne Bildschirm (?shots): nie auf die Leinwand zeichnen – nur in Texturen */
  private offscreen = /[?&]shots\b/.test(location.search);
  private frameRT: THREE.RenderTarget | null = null;

  // Fahrt
  private z = Z0;
  private x = 0;
  private v = 14;
  private vProf: Float32Array = new Float32Array(0);
  private kProf: Float32Array = new Float32Array(0);
  private xProf: Float32Array = new Float32Array(0);
  private profI0 = 0;
  private lean = 0;
  private pedal = 0;
  private tuck = 0;
  private brake = 0;
  private time = 0;
  private w = { x: 0, y: 0, z: 0, th: 0 };
  private cam = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camInit = false;
  private camTh = 0;
  /** angehalten (Prüfbilder) */
  paused = false;
  /** Fahrt von vorn: Bäume sofort ganz neu verteilen */
  private wrapped = false;

  constructor(private host: HTMLElement, private opts: ShowcaseOptions) {
    this.renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance', reversedDepthBuffer: true });
  }

  get camMode(): CamMode { return this._cam; }
  /** Kamera wechseln: weich in 0,7 s von der alten Einstellung hinüber (beide fahren dabei mit) */
  set camMode(m: CamMode) {
    if (m === this._cam) return;
    if (m === 'side') this.sideSign = this.x > 0 ? -1 : 1;
    this.camFrom = this.camInit ? this._cam : null;
    this.camBlend = this.camFrom ? 0 : 1;
    this._cam = m;
  }

  get backendName(): string {
    const b = this.renderer.backend as unknown as { isWebGPUBackend?: boolean };
    return b.isWebGPUBackend ? 'WebGPU' : 'WebGL 2 (Ersatz)';
  }

  /** Einstellwert aus der Adresse (?exp=0.5 …) – zum Abstimmen von Licht und Dunst */
  private param(k: string, d: number): number {
    const m = new RegExp(`[?&]${k}=([0-9.]+)`).exec(location.search);
    return m ? Number(m[1]) : d;
  }
  private fogK = 1;

  /** Testhilfe: an eine Stelle der Strecke springen (m) */
  jump(z: number) { this.z = clamp(z, Z0, Z1); this.camInit = false; this.place(0); }

  /** Testhilfe: Kamera sofort (ohne Überblenden) */
  cut(m: CamMode) { this._cam = m; this.camFrom = null; this.camBlend = 1; if (m === 'side') this.sideSign = this.x > 0 ? -1 : 1; }

  async start() {
    const r = this.renderer;
    await r.init();
    if (this.disposed) return;
    const dev = (r.backend as unknown as { device?: { lost?: Promise<{ reason: string; message: string }> } }).device;
    dev?.lost?.then((i) => { if (i.reason !== 'destroyed') this.opts.onError?.(`Grafik abgestürzt: ${i.message || i.reason}`); });
    const t0 = performance.now();
    const log = (m: string) => console.info(`[gpu] ${m} (${Math.round(performance.now() - t0)} ms)`);
    this.maxDpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = Math.min(this.maxDpr, 1.5);
    r.setPixelRatio(this.dpr);
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 0.62;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    // Zähler über alle Durchgänge eines Bilds (Schatten, Szene, Nachbearbeitung) – sonst zählte nur der letzte
    r.info.autoReset = false;
    this.host.appendChild(r.domElement);
    r.domElement.style.display = 'block';
    r.domElement.style.width = '100%';
    r.domElement.style.height = '100%';
    this.resize();

    const low = /[?&]lowbake\b/.test(location.search);
    const step = async (frac: number, stage: string) => {
      this.loadFrac = frac;
      this.stage = stage;
      log(stage);
      await new Promise((res) => setTimeout(res, 0));
    };
    // während des Ladens nichts zeichnen (der Ladeschirm deckt alles zu) – nur die Anzeige läuft weiter
    r.setAnimationLoop((t) => this.frame(t));
    await step(0.02, 'Oberflächen werden gebacken');
    const S: Record<SurfaceId, Surface> = bakeSurfaces(r, low ? 0.25 : 1);
    await step(0.06, 'Himmel');
    this.sky = await buildSky(r, 26, 205, low ? 128 : 512);
    if (this.disposed) return;
    this.scene.background = this.sky.background;
    this.scene.environment = this.sky.environment;
    // abgestimmt: kräftige Sonne, wenig Himmelslicht (Kontrast wie an einem klaren Tag in den Bergen)
    this.scene.environmentIntensity = this.param('env', 0.3);
    this.sky.sun.intensity = this.param('sun', 3.4);
    r.toneMappingExposure = this.param('exp', 0.48);
    this.fogK = this.param('fog', 0.5);
    this.scene.add(this.sky.sun, this.sky.sun.target);
    this.setupFog();
    this.setupSunGlow();

    // Strecke und Landschaft wie im Spiel
    await step(0.09, 'Straße');
    const track = (this.track = new Track(this.opts.dayKey, this.opts.names, 'descent'));
    const terrain = new Terrain(track);
    terrain.window(0, Z1 + 700);
    const i0 = Math.max(0, Math.floor(Z0 / SEG) - 40);
    const i1 = Math.floor(Z1 / SEG) + 160;
    this.profileRide(i0, i1);
    const route: RouteSample[] = [];
    for (let z = i0 * SEG; z <= i1 * SEG; z += 8) {
      track.world(z, 0, 0, this.w);
      route.push({ x: this.w.x, z: this.w.z });
    }
    const corridor = (this.corridor = new Corridor(track, terrain, {
      road: roadMaterial(S), marks: marksMaterial(S), sides: corridorMaterial(S), metal: metalMaterial(), wood: woodMaterial(),
      paint: paintMaterial(), ads: adsMaterial(adsTex(this.opts.names)),
    }));
    const grass = (this.grass = new Grass());
    if (!this.param('nograss', 0)) corridor.onTufts = (t) => grass.addChunk(t);
    corridor.build(i0, i1);
    this.scene.add(grass.group);
    this.scene.add(corridor.group);
    const trees = (this.trees = new Trees());
    trees.sunDir.value.copy(this.sky.sunDir);
    this.scene.add(trees.group);
    const field = (this.field = new Field(terrain, route, [terrainMaterial(S, 0), terrainMaterial(S, 1), terrainMaterial(S, 2)], {
      onTrees: (_k, list, cx, cz) => trees.addTile(list, cx, cz),
    }));
    field.dropK = this.param('drop', 1);
    this.scene.add(field.group);
    this.rider = new Rider(0);
    this.scene.add(this.rider.group);
    this.place(0);

    // Kantenglättung 4× (auf Apples Kacheln billig); im WebGL-Ersatz ohne (dort scheitert das Umkopieren oft)
    const gpu = !!(r.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend;
    const scenePass = (this.scenePass = pass(this.scene, this.camera, { samples: gpu ? 4 : 0 }));
    const color = scenePass.getTextureNode('output');
    this.pipeline = new THREE.RenderPipeline(r);
    // Nachleuchten nur auf Wunsch (?bloom=0.06): kaum sichtbar, kostet aber ein Dutzend Durchgänge je Bild
    const bl = this.param('bloom', 0);
    this.pipeline.outputNode = bl > 0 ? color.add(bloom(color, bl, 0.3, this.param('bthr', 4))) : color;

    // die ganze Landschaft vorab – unterwegs wird nichts mehr gebaut (das ruckelte)
    track.world(this.z, 0, 0, this.w);
    const sx = this.w.x, sz = this.w.z;
    this.stage = 'Landschaft';
    let lastLog = 0;
    while (field.hasWork(sx, sz, Infinity)) {
      if (this.disposed) return;
      this.loadFrac = 0.12 + 0.58 * field.progress;
      field.build(sx, sz, performance.now() + 40);
      if (performance.now() - lastLog > 2000) { lastLog = performance.now(); log(`Landschaft ${field.done}/${field.total}`); }
      await new Promise((res) => setTimeout(res, 0));
    }
    log(`Landschaft: ${field.done} Kacheln, ${trees.count} Bäume`);
    await step(0.71, 'Bäume');
    this.updateCamera(0);
    trees.update(this.camera.position, true);
    field.merge();
    await step(0.74, 'Shader werden übersetzt');
    await this.warmup((f) => { this.loadFrac = 0.74 + 0.24 * f; });
    if (this.disposed) return;
    log('vorgewärmt');
    this.loadFrac = 1;
    this.ready = true;
    this.opts.onReady?.();
  }

  /**
   * Vorwärmen: alles, was unterwegs ins Bild kommen kann (jede Baumgruppe, jedes Grasstück, alle Teile des
   * Fahrers), einmal übersetzen und hochladen – sonst ruckelt es beim ersten Auftauchen (und beim Kamerawechsel).
   */
  private async warmup(progress: (f: number) => void) {
    const r = this.renderer;
    const top = [...this.scene.children];
    // 1) Nachbearbeitung einrichten (ohne Szene – das legt das Bildformat des Szenendurchgangs fest)
    const vis = top.map((o) => o.visible);
    for (const o of top) o.visible = false;
    this.draw();
    top.forEach((o, i) => { o.visible = vis[i]; });
    // 2) alles sichtbar, nichts wegschneiden
    const saved: [THREE.Object3D, boolean, boolean][] = [];
    this.scene.traverse((o) => { saved.push([o, o.visible, o.frustumCulled]); o.visible = true; o.frustumCulled = false; });
    this.trees?.warm(true);
    this.grass?.warm();
    // 3) Shader im Hintergrund übersetzen (für das Bildformat des Szenendurchgangs), Daten hochladen
    const rt = this.scenePass?.renderTarget ?? null;
    const prev = r.getRenderTarget();
    r.setRenderTarget(rt);
    try {
      await r.compileAsync(this.scene, this.camera, null, (e: ProgressEvent) => progress(0.85 * (e.loaded / Math.max(1, e.total))));
    } catch { /* nicht schlimm: dann beim ersten Bild */ }
    r.setRenderTarget(prev);
    if (this.disposed) return;
    // 4) zwei echte Bilder: Schattendurchgang, Rest
    for (let k = 0; k < 2; k++) {
      this.draw();
      progress(0.9 + k * 0.05);
      await new Promise((res) => setTimeout(res, 0));
      if (this.disposed) return;
    }
    for (const [o, v, f] of saved) { o.visible = v; o.frustumCulled = f; }
    this.trees?.warm(false);
    this.trees?.update(this.camera.position, true);
    this.grass?.update(this.camera.position);
    progress(1);
  }

  /** Sonne: helle Scheibe mit weichem Hof, weit weg in Sonnenrichtung (Berge verdecken sie) */
  private sunGlow: THREE.Mesh | null = null;
  private setupSunGlow() {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    m.fog = false;
    const r = uv().sub(0.5).mul(2).length();
    const core = smoothstep(0.085, 0.06, r).mul(60);
    const halo = exp(r.mul(-7)).mul(1.1).add(exp(r.mul(-22)).mul(5));
    m.colorNode = vec3(1, 0.93, 0.82).mul(core.add(halo).mul(float(1).sub(smoothstep(0.85, 1, r))));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    this.sunGlow = mesh;
    this.scene.add(mesh);
  }

  /** Luftperspektive: Dunst in der Farbe des Himmels in Blickrichtung (zur Sonne hin wärmer), mit der Höhe dünner */
  private setupFog() {
    const sky = this.sky!;
    const sun = uniform(sky.sunDir.clone());
    const dir = normalize(positionWorld.sub(cameraPosition));
    const d = positionView.length();
    const look = vec3(dir.x, max(dir.y, float(0.03)), dir.z).normalize();
    // Helligkeit begrenzen: zur Sonne hin ist der Himmel so hell, dass schon wenig Dunst alles grau machte
    const sky0 = cubeTexture(sky.background, look).rgb;
    const skyCol = sky0.div(max(float(1), sky0.dot(vec3(0.3, 0.55, 0.15)).div(1.4)));
    const toSun = pow(max(float(0), dot(dir, sun)), 12);
    const col = mix(skyCol.mul(0.9), vec3(sky.haze.r, sky.haze.g, sky.haze.b).mul(skyCol.dot(vec3(0.3, 0.5, 0.2))), toSun.mul(0.15));
    // dichter in der Tiefe der Täler, dünner nach oben
    const h = positionWorld.y.sub(cameraPosition.y);
    const thin = exp(h.max(-600).mul(-0.0012)).clamp(0.35, 2.2);
    const f = float(1).sub(exp(d.mul(-0.000085 * this.fogK).mul(thin))).mul(0.92);
    this.scene.fogNode = fog(col, f);
  }

  /** Tempo- und Linienprofil der Fahrt: vor Kurven bremsen, Kehren eng, auf Geraden laufen lassen */
  private profileRide(i0: number, i1: number) {
    const t = this.track!;
    const n = i1 - i0 + 1;
    const k = new Float32Array(n);
    for (let q = 0; q < n; q++) k[q] = t.seg(i0 + q).curve;
    // geglättete Krümmung (Einlenkpunkte weich)
    const ks = new Float32Array(n);
    for (let q = 0; q < n; q++) {
      let s = 0, w = 0;
      for (let j = -6; j <= 6; j++) { const qq = clamp(q + j, 0, n - 1); const ww = 7 - Math.abs(j); s += k[qq] * ww; w += ww; }
      ks[q] = s / w;
    }
    const v = new Float32Array(n);
    for (let q = 0; q < n; q++) v[q] = clamp(Math.sqrt(4.6 / Math.max(1e-4, Math.abs(ks[q]))), 6.5, 21);
    // rückwärts: rechtzeitig bremsen; vorwärts: nur langsam beschleunigen
    for (let q = n - 2; q >= 0; q--) v[q] = Math.min(v[q], Math.sqrt(v[q + 1] * v[q + 1] + 2 * 3.2 * SEG));
    for (let q = 1; q < n; q++) v[q] = Math.min(v[q], Math.sqrt(v[q - 1] * v[q - 1] + 2 * 1.3 * SEG));
    // Linie: in Kurven innen, sanft
    const xl = new Float32Array(n);
    for (let q = 0; q < n; q++) {
      let s = 0, w = 0;
      for (let j = -10; j <= 10; j++) { const qq = clamp(q + j, 0, n - 1); const ww = 11 - Math.abs(j); s += clamp(ks[qq] * 38, -1.5, 1.5) * ww; w += ww; }
      xl[q] = s / w;
    }
    this.kProf = ks;
    this.vProf = v;
    this.xProf = xl;
    this.profI0 = i0;
  }

  private prof(arr: Float32Array, z: number): number {
    const f = z / SEG - this.profI0;
    const q = clamp(Math.floor(f), 0, arr.length - 2);
    const u = clamp(f - q, 0, 1);
    return arr[q] * (1 - u) + arr[q + 1] * u;
  }

  /** Fahrer bewegen und auf die Strecke stellen */
  private place(dt: number) {
    const t = this.track!;
    const vT = this.prof(this.vProf, this.z + 6);
    if (dt > 0) {
      const acc = vT > this.v ? 1.2 : -3.4;
      this.v = acc > 0 ? Math.min(vT, this.v + acc * dt) : Math.max(vT, this.v + acc * dt);
      this.brake += ((vT < this.v - 0.4 ? 1 : 0) - this.brake) * Math.min(1, dt * 6);
      this.z += this.v * dt;
      if (this.z > Z1) { this.z = Z0; this.camInit = false; this.wrapped = true; }
    }
    const xT = this.prof(this.xProf, this.z);
    this.x += (xT - this.x) * (dt > 0 ? Math.min(1, dt * 1.5) : 1);
    const k = this.prof(this.kProf, this.z);
    const lean = clamp(Math.atan2(k * this.v * this.v, 9.81) * 0.85, -0.62, 0.62);
    this.lean += (lean - this.lean) * (dt > 0 ? Math.min(1, dt * 4) : 1);
    const straight = Math.abs(k) < 0.006 && this.brake < 0.2;
    this.tuck += ((straight && this.v > 13 ? 1 : 0) - this.tuck) * Math.min(1, dt * 2.5);
    // treten nur aus den Kehren heraus
    if (this.v < 12 && this.brake < 0.2) this.pedal += dt * 1.45;
    t.world(this.z, this.x, 0, this.w);
    const R = this.rider!;
    R.group.position.set(this.w.x, this.w.y, this.w.z);
    R.group.rotation.y = -this.w.th;
    R.model.pose(R.anim.step({
      lean: this.lean, pedal: this.pedal, tuck: this.tuck, brake: this.brake, stand: 0, sprint: 0,
      v: this.v, air: 0, surface: 'asphalt', wobble: 0, light: 0, roll: this.z / 0.34,
    }, Math.max(1e-3, dt), this.time));
  }

  /** Kameraeinstellung je Modus – fest am Fahrer (bzw. an seiner geglätteten Fahrtrichtung), ohne Nachziehen */
  private camPose(mode: CamMode, out: { pos: THREE.Vector3; look: THREE.Vector3; fov: number }) {
    const t = this.track!;
    const w = this.w;
    t.world(this.z, this.x, 0, w);
    const rx = w.x, ry = w.y, rz = w.z;
    const fx = Math.sin(this.camTh), fz = -Math.cos(this.camTh);
    const sx = Math.cos(this.camTh), sz = Math.sin(this.camTh);
    const aspect = this.camera.aspect;
    const portrait = aspect < 1;
    switch (mode) {
      case 'chase': {
        // wie im Spiel: 6,2 m dahinter, 2,75 m hoch, 15 m voraus
        const back = 6.2;
        const by = t.heightAt(Math.max(0, this.z - back));
        out.pos.set(rx - fx * back, Math.max(by, ry) + 2.75, rz - fz * back);
        const ay = t.heightAt(this.z + 15);
        out.look.set(rx + fx * 15, ry + (ay - ry) * 0.55 + 0.9, rz + fz * 15);
        out.fov = (portrait ? 72 - (aspect - 0.45) * 22 : 56) + Math.min(9, Math.max(0, (this.v - 14) * 0.38));
        break;
      }
      case 'low': {
        const back = 3.4;
        const by = t.heightAt(Math.max(0, this.z - back));
        out.pos.set(rx - fx * back + sx * 0.6, Math.max(by, ry) + 0.55, rz - fz * back + sz * 0.6);
        out.look.set(rx + fx * 6, ry + 0.9, rz + fz * 6);
        out.fov = portrait ? 74 : 60;
        break;
      }
      case 'side': {
        // Begleitmotorrad außen, etwas voraus, Teleobjektiv
        t.world(this.z + 9, this.sideSign * (EDGE + 2.5), 0, w);
        out.pos.set(w.x, Math.max(w.y, t.heightAt(this.z + 9)) + 1.45, w.z);
        out.look.set(rx, ry + 1.0, rz);
        out.fov = portrait ? 46 : 32;
        break;
      }
      case 'drone': {
        const back = 26;
        out.pos.set(rx - fx * back + sx * 9, ry + 19, rz - fz * back + sz * 9);
        out.look.set(rx + fx * 30, ry - 6, rz + fz * 30);
        out.fov = portrait ? 70 : 55;
        break;
      }
    }
  }

  private poseA = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 };
  private poseB = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 };

  /** Kamera nachführen; beim Wechsel beide Einstellungen mitfahren lassen und weich überblenden */
  private updateCamera(dt: number) {
    const t = this.track!;
    t.world(this.z, this.x, 0, this.w);
    if (!this.camInit) { this.camTh = this.w.th; this.camFrom = null; this.camBlend = 1; }
    this.camTh += angDiff(this.w.th, this.camTh) * Math.min(1, dt * 5);
    const A = this.poseA;
    this.camPose(this._cam, A);
    if (this.camFrom && this.camBlend < 1) {
      this.camBlend = Math.min(1, this.camBlend + dt / 0.7);
      const B = this.poseB;
      this.camPose(this.camFrom, B);
      const u = this.camBlend;
      const k = u * u * u * (u * (u * 6 - 15) + 10);
      A.pos.lerpVectors(B.pos, A.pos, k);
      A.look.lerpVectors(B.look, A.look, k);
      A.fov = B.fov + (A.fov - B.fov) * k;
      if (this.camBlend >= 1) this.camFrom = null;
    }
    this.camInit = true;
    this.cam.copy(A.pos);
    this.camLook.copy(A.look);
    this.camera.position.copy(A.pos);
    this.camera.lookAt(A.look);
    if (Math.abs(this.camera.fov - A.fov) > 0.01) {
      this.camera.fov = A.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Schattenausschnitt folgt dem Fahrer, im Lichtraster eingerastet (kein Flimmern der Schattenkanten) */
  private updateSun() {
    const sky = this.sky!;
    if (this.sunGlow) {
      this.sunGlow.position.copy(this.camera.position).addScaledVector(sky.sunDir, 15000);
      this.sunGlow.lookAt(this.camera.position);
      this.sunGlow.scale.setScalar(1500);
    }
    const sun = sky.sun;
    const t = this.track!;
    t.world(this.z + 22, 0, 0, this.w);
    const c = new THREE.Vector3(this.w.x, this.w.y, this.w.z);
    const d = sky.sunDir;
    const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, d).normalize();
    const texel = 110 / 2048;
    const a = Math.round(c.dot(right) / texel) * texel;
    const b = Math.round(c.dot(up) / texel) * texel;
    const e = c.dot(d);
    const snapped = right.multiplyScalar(a).add(up.multiplyScalar(b)).addScaledVector(d, e);
    sun.target.position.copy(snapped);
    sun.position.copy(snapped).addScaledVector(d, 1500);
    sun.target.updateMatrixWorld();
  }

  /** Auflösung nach der Bildzeit: zu langsam → kleiner, lange schnell genug → größer */
  private adapt(dtMs: number, now: number) {
    if (!this.ready) return;
    // Bildschirmtakt: kürzester Abstand der letzten ~2 s, auf 120/90/60 Hz gerundet (ProMotion wechselt selbst)
    this.intervals.push(dtMs);
    if (this.intervals.length > 240) this.intervals.shift();
    const mn = Math.min(...this.intervals);
    this.period = mn < 9.6 ? 1000 / 120 : mn < 12.5 ? 1000 / 90 : 1000 / 60;
    if (this.intervals.length < 60 || now - this.lastDprChange < 1200) return;
    // zu langsam, weil die CPU nicht nachkommt? Dann hilft eine kleinere Auflösung nicht – dann bleibt sie
    const cpuBound = this.avgCpu > this.period * 0.75;
    if (this.avgMs > this.period * 1.22 && !cpuBound) { this.slowFor += dtMs; this.fastFor = 0; } else if (this.avgMs < this.period * 1.06) { this.fastFor += dtMs; this.slowFor = 0; } else { this.slowFor = 0; }
    let want = this.dpr;
    if (this.slowFor > 700) want = Math.max(0.7, this.dpr - 0.15);
    else if (this.fastFor > 3500) want = Math.min(this.maxDpr, this.dpr + 0.1);
    if (want !== this.dpr) {
      this.dpr = Math.round(want * 100) / 100;
      this.renderer.setPixelRatio(this.dpr);
      this.lastDprChange = now;
      this.slowFor = this.fastFor = 0;
    }
  }

  private frame(t: number) {
    if (this.disposed) return;
    const t0 = performance.now();
    const dtMs = this.last ? Math.min(100, t - this.last) : 16.7;
    this.last = t;
    this.avgMs += (dtMs - this.avgMs) * 0.05;
    const dt = Math.min(0.05, dtMs / 1000);
    this.time += dt;
    if (this.ready && this.track && this.rider) {
      if (!this.paused) this.place(dt);
      this.updateCamera(dt);
      this.updateSun();
      this.trees?.update(this.camera.position, this.wrapped);
      this.wrapped = false;
      this.grass?.update(this.camera.position);
    }
    this.adapt(dtMs, t);
    // Prüfbilder: nur auf Abruf zeichnen (Software-Grafik ist zu langsam für jedes Bild); beim Laden gar nicht
    if (this.ready && !this.offscreen) this.draw();
    if (this.ready) this.avgCpu += (performance.now() - t0 - this.avgCpu) * 0.05;
    const info = this.renderer.info.render;
    this.opts.onStats?.({
      fps: 1000 / this.avgMs, ms: this.avgMs, period: this.period, dpr: this.dpr, backend: this.backendName,
      tris: info.triangles, calls: info.drawCalls, cpu: this.avgCpu, loading: this.ready ? 1 : this.loadFrac, stage: this.stage,
      note: this.ready && this.period > 14 ? 'Safari begrenzt auf 60 Hz (siehe Hinweis)' : '',
    });
  }

  private draw() {
    if (!this.pipeline) return;
    this.renderer.info.reset();
    if (this.offscreen) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      if (!this.frameRT || this.frameRT.width !== size.x || this.frameRT.height !== size.y) {
        this.frameRT?.dispose();
        this.frameRT = new THREE.RenderTarget(size.x, size.y, { depthBuffer: false });
      }
      this.renderer.setRenderTarget(this.frameRT);
      this.pipeline.render();
      this.renderer.setRenderTarget(null);
    } else this.pipeline.render();
  }

  /** Prüfbild: ein Bild in eine Textur zeichnen und zurücklesen (Tests ohne Bildschirm) */
  async snapshot(): Promise<string> {
    const r = this.renderer;
    r.info.reset();
    if (this.track && this.rider) { this.updateCamera(1); this.updateSun(); this.trees?.update(this.camera.position, true); this.grass?.update(this.camera.position); }
    const size = new THREE.Vector2();
    r.getDrawingBufferSize(size);
    const rt = new THREE.RenderTarget(size.x, size.y, { depthBuffer: false });
    r.setRenderTarget(rt);
    this.pipeline?.render();
    r.setRenderTarget(null);
    const inf = r.info.render;
    console.info(`[gpu] Bild: ${inf.drawCalls} Aufrufe, ${Math.round(inf.triangles / 1000)}k Dreiecke`);
    const px = (await r.readRenderTargetPixelsAsync(rt, 0, 0, size.x, size.y)) as Uint8Array;
    rt.dispose();
    const cv = document.createElement('canvas');
    cv.width = size.x;
    cv.height = size.y;
    const c = cv.getContext('2d')!;
    const img = c.createImageData(size.x, size.y);
    // WebGPU: Zeilen auf 256 Byte aufgefüllt, von oben nach unten; WebGL von unten nach oben
    const gpu = !!(r.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend;
    const stride = gpu ? Math.ceil((size.x * 4) / 256) * 256 : size.x * 4;
    for (let y = 0; y < size.y; y++) {
      const sy = gpu ? y : size.y - 1 - y;
      img.data.set(px.subarray(sy * stride, sy * stride + size.x * 4), y * size.x * 4);
    }
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    c.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  get isReady() { return this.ready; }

  resize() {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.renderer.domElement.remove();
    this.field?.dispose();
    this.corridor?.dispose();
    this.trees?.dispose();
    this.grass?.dispose();
    this.sky?.dispose();
    this.frameRT?.dispose();
    this.renderer.dispose();
  }
}
