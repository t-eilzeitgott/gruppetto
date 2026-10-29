/**
 * WebGPU-Test: ein Stück Passabfahrt mit three.js' WebGPU-Renderer – physikalische Materialien, gebackene
 * Oberflächen, Himmel als Umgebungslicht, weiche Sonnenschatten, Luftperspektive, Bloom, Kantenglättung.
 * Dieselbe Strecke und Landschaft wie im Spiel (Track, terrain3d), nur anders gezeichnet. Der Fahrer fährt
 * von selbst; die Kamera wechselt auf Tippen.
 *
 * Ziel: 120 Bilder/s auf einem iPhone 15 Pro. Die Auflösung regelt sich nach der gemessenen Bildzeit.
 */
import * as THREE from 'three/webgpu';
import { Track, SEG, EDGE, ROAD_HALF } from '../abfahrt/track';
import { Terrain } from '../abfahrt/terrain3d';
import { adsTex } from '../abfahrt/tex3d';
import { bakeFlowerDots, bakeSurfaces, type Surface, type SurfaceId } from './bake';
import { Atmo } from './atmo';
import { DEFAULT_SETTINGS, loadSettings, MOOD_U, MOODS, saveSettings, type Settings } from './mood';
import { corridorMaterial, terrainMaterial } from './ground';
import { adsMaterial, marksMaterial, metalMaterial, paintMaterial, roadMaterial, woodMaterial } from './mats';
import { Corridor } from './corridor';
import { Field, type RouteSample } from './field';
import { Trees } from './trees';
import { Rider, playerKit, teamKit } from './rider';
import { EV, Perf, type Report } from './perf';
import { Abfahrt, type HudState } from '../abfahrt/engine';
import type { Kit } from '../abfahrt/rider';
import { Grass } from './grass';
import { ForestEdge } from './forest';
import { Houses } from './houses';
import { Crowd } from './crowd';
import { Life } from './life';
import { tsl } from './nodes';

const { float, frontFacing, pass, select, texture, uv, vec3 } = tsl;

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
  /** eigener Fahrer (Trikot, Rad aus der Garage) – wie im Spiel */
  kit?: Kit;
  onStats?: (s: ShowcaseStats) => void;
  onReady?: () => void;
  onError?: (e: unknown) => void;
}

export type CamMode = 'chase' | 'side' | 'drone' | 'low';
/** Fahren: Autopilot (Linie und Ducken von selbst) oder selbst – beides mit der Fahrlogik des Spiels */
export type DriveMode = 'auto' | 'manual';

/** Vorrat an Gegner-Modellen (beim Laden gebaut und vorgewärmt – unterwegs entsteht keiner neu) */
const POOL = 20;

/** Teststrecke: über die Almwiesen mit den vier Kehren hinunter in den Bergwald (dicht ab ~1,6 km und 2,6–3,3 km) */
const Z0 = 600;
const Z1 = 3350;

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class Showcase {
  private renderer: THREE.WebGPURenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.3, 24000);
  /** Bildketten: mit Leuchten (Weichzeichner) und ohne – gewählt nach der Stärke des Leuchtens */
  private pipeBloom: THREE.RenderPipeline | null = null;
  private pipeFlat: THREE.RenderPipeline | null = null;
  private get pipeline(): THREE.RenderPipeline | null { return this.atmo?.bloomOn ? this.pipeBloom : this.pipeFlat; }
  private atmo: Atmo | null = null;
  settings: Settings = loadSettings();
  private track: Track | null = null;
  private corridor: Corridor | null = null;
  private field: Field | null = null;
  private trees: Trees | null = null;
  private rider: Rider | null = null;
  private grass: Grass | null = null;
  private houses: Houses | null = null;
  private crowd: Crowd | null = null;
  private life: Life | null = null;
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

  // Fahrt: die Spiellogik des Spiels (Abfahrt, als Testfahrt ohne Hindernisse und Sturz)
  private eng: Abfahrt | null = null;
  private _drive: DriveMode = 'auto';
  private z = Z0;
  private x = 0;
  private v = 14;
  /** Ideallinie und Krümmung (für den Autopiloten) */
  private kProf: Float32Array = new Float32Array(0);
  private xProf: Float32Array = new Float32Array(0);
  private profI0 = 0;
  private time = 0;
  /** Gegner: Vorrat an Modellen, Zuordnung Fahrer-Kennung → Modell */
  private pool: Rider[] = [];
  private poolOf = new Map<number, number>();
  private poolFree: number[] = [];
  private w = { x: 0, y: 0, z: 0, th: 0 };
  private cam = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camInit = false;
  private camTh = 0;
  /** angehalten (Prüfbilder) */
  paused = false;
  /** Messfahrt: Zeiten je Bild und Baustein (perf.ts) */
  readonly perf = new Perf();
  /** Messfahrt über eine Runde: endet von selbst am Ende der Strecke */
  private measureLap = false;
  /** Bericht fertig (Runde zu Ende) */
  onReport: ((r: Report) => void) | null = null;
  /** Live-Kurve sichtbar: GPU-Zeit auch ohne Messung abfragen */
  graph = false;
  private gpuPending = false;
  /** Bilder seit Beginn der letzten GPU-Abfrage (eine Abfrage kann mehrere Bilder umfassen) */
  private gpuFrames = 0;
  /** Kostenanalyse: GPU-Zeiten sammeln */
  private gpuSamples: number[] | null = null;
  private shownMood = '';
  private shownVis = '';
  private lampOn = false;
  private cacheN = -1;
  private cacheP = -1;
  /** Fahrt von vorn: Bäume sofort ganz neu verteilen */
  private wrapped = false;

  constructor(private host: HTMLElement, private opts: ShowcaseOptions) {
    // Zeitstempel (GPU-Zeit je Bild für die Messfahrt) – nur, wenn das Gerät sie kann; sonst ohne Wirkung
    this.renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance', reversedDepthBuffer: true, trackTimestamp: true } as ConstructorParameters<typeof THREE.WebGPURenderer>[0]);
  }

  get camMode(): CamMode { return this._cam; }
  /** Kamera wechseln: weich in 0,7 s von der alten Einstellung hinüber (beide fahren dabei mit) */
  set camMode(m: CamMode) {
    if (m === this._cam) return;
    this.perf.event(EV.cam, `${this._cam}→${m}`);
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

  /** Testhilfe: an eine Stelle der Strecke springen (m) */
  jump(z: number) { this.startRun(clamp(z, Z0, Z1 - 60)); this.camInit = false; this.place(0); }

  /** Testhilfe: freie Kamera um einen Punkt (Azimut, Höhe in Grad, Abstand in m); null: zurück zum Fahrer */
  private free: { at: THREE.Vector3; az: number; el: number; dist: number } | null = null;
  orbit(at: { x: number; y: number; z: number } | null, az = 30, el = 12, dist = 30, fov = 50) {
    this.free = at ? { at: new THREE.Vector3(at.x, at.y, at.z), az, el, dist } : null;
    if (at) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }
  /** Testhilfe: der i-te Baum (nach Abstand zum Punkt) */
  tree(i: number, x: number, z: number) {
    const l = [...(this.trees?.allSpots() ?? [])].sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    return l[i] ?? null;
  }
  /** Testhilfe: Platz eines Hauses */
  house(i: number) { return (this.houses as unknown as { spots: { x: number; y: number; z: number; rot: number }[] } | null)?.spots[i] ?? null; }

  /** Testhilfe: Kamera sofort (ohne Überblenden) */
  cut(m: CamMode) { this._cam = m; this.camFrom = null; this.camBlend = 1; if (m === 'side') this.sideSign = this.x > 0 ? -1 : 1; }

  async start() {
    const r = this.renderer;
    await r.init();
    if (this.disposed) return;
    const dev = (r.backend as unknown as { device?: { lost?: Promise<{ reason: string; message: string }> } }).device;
    dev?.lost?.then((i) => { if (i.reason !== 'destroyed') { this.noteError('Grafik verloren', i.message || i.reason); this.opts.onError?.(`Grafik abgestürzt: ${i.message || i.reason}`); } });
    (r as unknown as { onError: (e: { message?: string; type?: string }) => void }).onError = (e) => this.noteError(`WebGPU ${e.type ?? ''}`, e.message ?? e);
    this.onWinError = (ev: Event) => {
      const er = ev as ErrorEvent & PromiseRejectionEvent;
      this.noteError(ev.type === 'unhandledrejection' ? 'Promise' : 'Seite', er.error ?? er.reason ?? er.message);
    };
    window.addEventListener('error', this.onWinError);
    window.addEventListener('unhandledrejection', this.onWinError);
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
    const dots = bakeFlowerDots(r, low ? 256 : 512);
    await step(0.06, 'Himmel (fünf Stimmungen)');
    const moodParam = /[?&]mood=([a-z]+)/.exec(location.search)?.[1] as Settings['mood'] | undefined;
    if (moodParam) this.settings = { ...this.settings, mood: moodParam };
    const atmo = (this.atmo = new Atmo(r, this.scene, this.settings, Number(new URLSearchParams(location.search).get('sky')) || (low ? 96 : 256)));
    this.maxDpr = Math.min(window.devicePixelRatio || 1, this.settings.maxDpr);
    if (this.disposed) return;

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
    const adsM = adsMaterial(adsTex(this.opts.names));
    const corridor = (this.corridor = new Corridor(track, terrain, {
      road: roadMaterial(S), marks: marksMaterial(S), sides: corridorMaterial(S, dots), metal: metalMaterial(), wood: woodMaterial(),
      paint: paintMaterial(), ads: adsM,
    }));
    const grass = (this.grass = new Grass());
    if (!this.param('nograss', 0)) corridor.onTufts = (t) => grass.addChunk(t);
    corridor.build(i0, i1);
    this.scene.add(grass.group);
    this.scene.add(corridor.group);
    // Zuschauer wie im Spiel (Bewegung in WGSL – nur mit WebGPU)
    if ((r.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend && !this.param('nocrowd', 0)) {
      const crowd = (this.crowd = new Crowd());
      crowd.build(track, (sg0, sg, dx) => corridor.edgeHeight(sg0, sg, dx), (i, sg) => terrain.lim(i)[sg < 0 ? 0 : 1], i0, i1);
      this.scene.add(crowd.group);
      if (crowd.signs.pos.length) this.scene.add(signMesh(crowd.signs, adsM.map!));
      log(`Zuschauer: ${crowd.count}, ${crowd.signs.pos.length / 18} Schilder`);
    }
    const trees = (this.trees = new Trees(r, !!(r.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend, low));
    trees.sunDir.value.copy(atmo.sunDir);
    this.scene.add(trees.group);
    const field = (this.field = new Field(terrain, route, [terrainMaterial(S, 0, dots), terrainMaterial(S, 1), terrainMaterial(S, 2)], {
      onTrees: (_k, list, cx, cz) => trees.addTile(list, cx, cz),
    }));
    field.dropK = this.param('drop', 1);
    this.scene.add(field.group);
    // eigener Fahrer (Trikot und Rad wie im Spiel, volle Detailstufe), Gegner aus dem Vorrat (Teamtrikots)
    this.rider = new Rider(this.opts.kit ?? playerKit('#ff5fa2'), 1, 1, true);
    this.scene.add(this.rider.group);
    for (let i = 0; i < POOL; i++) {
      const R = new Rider(teamKit(i), 0, i * 7.31 + 3, false);
      R.group.visible = false;
      this.pool.push(R);
      this.poolFree.push(POOL - 1 - i);
      this.scene.add(R.group);
    }
    this.eng = this.makeEngine(track);
    this.startRun(Z0);
    this.place(0);

    // Kantenglättung 4× (auf Apples Kacheln billig); im WebGL-Ersatz ohne (dort scheitert das Umkopieren oft)
    const gpu = !!(r.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend;
    const scenePass = (this.scenePass = pass(this.scene, this.camera, { samples: gpu ? this.settings.msaa : 0 }));
    const color = scenePass.getTextureNode('output');
    // Leuchten, Tonkurve und Farbfilter in einem Durchgang (atmo.ts); ohne Leuchten ohne die Weichzeichner-Kette
    for (const withBloom of [true, false]) {
      const pl = new THREE.RenderPipeline(r);
      pl.outputColorTransform = false;
      pl.outputNode = atmo.outputNode(color, withBloom);
      if (withBloom) this.pipeBloom = pl; else this.pipeFlat = pl;
    }

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
    // Wald bis an die Straße, wo dahinter dichter Wald steht
    await step(0.71, 'Wald');
    const forest = new ForestEdge(track, terrain, i0 * SEG, i1 * SEG);
    forest.measure(trees.allSpots());
    const edge = forest.fill(trees.allSpots());
    trees.addSpots(edge);
    log(`Waldrand: ${edge.length} Bäume, Wald links/rechts auf ${forest.coverage.map((c) => Math.round(c * 100)).join('/')} % der Strecke`);
    // Häuser: oft entlang der Strecke, auf Wiesen (Bäume am Platz weichen)
    await step(0.72, 'Häuser');
    const houses = (this.houses = new Houses(S, !!(r.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend));
    houses.place(track, terrain, trees, Z0, Z1);
    this.scene.add(houses.group);
    log(`Häuser: ${houses.count} (je ${houses.tris.map((t) => Math.round(t)).join(' / ')} Dreiecke)`);
    // Leben: Blumen, Sträucher, Farne, Kühe, Schafe, Vögel
    await step(0.725, 'Wiesen und Tiere');
    const life = (this.life = new Life(!!(r.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend));
    life.build({ track, terrain, forest, trees, houses: houses.positions, z0: Z0, z1: Z1, msaa: !!(r.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend });
    this.scene.add(life.group);
    log(`Leben: ${Object.entries(life.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    await step(0.73, 'Bäume');
    this.updateCamera(0);
    field.merge();
    for (const g of field.geometries(0)) forest.boost(g, 'aMat');
    corridor.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry.getAttribute('aW')) forest.boost(m.geometry, 'aW');
    });
    trees.update(this.camera.position, true);
    houses.update(this.camera.position, true);
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
    // beide Bildketten (mit und ohne Leuchten) – der Wechsel unterwegs übersetzt dann nichts
    this.draw(this.pipeBloom);
    this.draw(this.pipeFlat);
    top.forEach((o, i) => { o.visible = vis[i]; });
    // 2) alles sichtbar, nichts wegschneiden
    const saved: [THREE.Object3D, boolean, boolean][] = [];
    this.scene.traverse((o) => { saved.push([o, o.visible, o.frustumCulled]); o.visible = true; o.frustumCulled = false; });
    this.trees?.warm(true);
    this.grass?.warm();
    this.houses?.warm(true);
    this.life?.warm(true);
    this.crowd?.warm(true);
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
      this.draw(k ? this.pipeFlat : this.pipeBloom);
      progress(0.9 + k * 0.05);
      await new Promise((res) => setTimeout(res, 0));
      if (this.disposed) return;
    }
    for (const [o, v, f] of saved) { o.visible = v; o.frustumCulled = f; }
    this.trees?.warm(false);
    this.trees?.update(this.camera.position, true);
    this.houses?.warm(false);
    this.life?.warm(false);
    this.life?.update(this.camera.position, true);
    this.houses?.update(this.camera.position, true);
    this.crowd?.warm(false);
    if (this.rider) this.crowd?.update(this.camera.position, this.rider.group.position, true);
    this.grass?.update(this.camera.position);
    progress(1);
  }

  /** Linienprofil für den Autopiloten: geglättete Krümmung, Ideallinie in Kurven innen */
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
    // Linie: in Kurven innen, sanft
    const xl = new Float32Array(n);
    for (let q = 0; q < n; q++) {
      let s = 0, w = 0;
      for (let j = -10; j <= 10; j++) { const qq = clamp(q + j, 0, n - 1); const ww = 11 - Math.abs(j); s += clamp(ks[qq] * 38, -1.5, 1.5) * ww; w += ww; }
      xl[q] = s / w;
    }
    this.kProf = ks;
    this.xProf = xl;
    this.profI0 = i0;
  }

  private prof(arr: Float32Array, z: number): number {
    const f = z / SEG - this.profI0;
    const q = clamp(Math.floor(f), 0, arr.length - 2);
    const u = clamp(f - q, 0, 1);
    return arr[q] * (1 - u) + arr[q + 1] * u;
  }

  /** Spiellogik wie im Spiel; die Strecke (und ihre Landschaft) liegt fest – nichts wird verworfen */
  private makeEngine(track: Track): Abfahrt {
    const e = new Abfahrt({
      dayKey: this.opts.dayKey, names: this.opts.names, friends: [], kit: this.opts.kit ?? playerKit('#ff5fa2'), best: 0,
      missions: [], missionsDone: new Set(), tutorial: false, cruise: 1,
    });
    // dieselbe Strecke wie die Darstellung (gleicher Tag, gleiche Namen): ohne Hindernisse (die zeigt der Test nicht),
    // und sie wird nie gekürzt – die Fahrt beginnt am Ende wieder vorn
    track.dropHazards();
    (track as unknown as { trim: (b: number) => void }).trim = () => undefined;
    e.track = track;
    e.setViewport(window.innerWidth);
    return e;
  }

  /** Fahrt (neu) beginnen bei z: Fahrer auf der Straße, eine kleine Gruppe vorweg, weitere setzt die Spiellogik */
  private startRun(z: number) {
    const e = this.eng!;
    const t = this.track!;
    const E = e as unknown as { txs: number; nextSpawn: number; oppId: number; rng: () => number };
    const p = e.p;
    Object.assign(p, { z, x: 0.9, vx: 0, v: 11, y: t.heightAt(z), vy: 0, air: false, airT: 0, lean: 0, tuck: 0, brake: 0, wobble: 0, slip: 0, slick: 0 });
    e.tx = p.x;
    E.txs = p.x;
    e.opps = [];
    const r = E.rng;
    for (let i = 0; i < 5; i++) {
      const x = (i % 2 ? -0.55 : 0.65) + (r() - 0.5) * 0.3;
      e.opps.push({
        id: E.oppId++, z: z + 14 + i * 2.4, x, vx: 0, v: 10.5, tx: x, f: 0.64 + r() * 0.06, kit: teamKit(i), pedal: r() * 6,
        lean: 0, tuck: 0, brake: 0, passed: false, group: -2, bump: 0, attacker: false,
      });
    }
    E.nextSpawn = z + 50;
    e.phase = 'playing';
    e.phaseT = 10;
    for (const [, i] of this.poolOf) { this.pool[i].group.visible = false; this.poolFree.push(i); }
    this.poolOf.clear();
  }

  /** Fahren: Autopilot oder selbst (Daumen wie im Spiel, Pfeiltasten) */
  get drive(): DriveMode { return this._drive; }
  set drive(m: DriveMode) {
    if (m === this._drive) return;
    this.perf.event(EV.drive, m);
    this._drive = m;
    const e = this.eng;
    if (!e) return;
    e.pointerUp();
    for (const k of ['left', 'right', 'up', 'down'] as const) e.key(k, false);
    if (m === 'manual') this.camMode = 'chase';
  }
  /** Daumen (Bildschirmkoordinaten): seitlich ziehen lenkt, hoch schieben duckt, runter ziehen bremst */
  pointerDown(x: number, y: number) { if (this._drive === 'manual') this.eng?.pointerDown(x, y); }
  pointerMove(x: number, y: number) { if (this._drive === 'manual') this.eng?.pointerMove(x, y); }
  pointerUp() { this.eng?.pointerUp(); }
  key(name: 'left' | 'right' | 'up' | 'down', down: boolean) { if (this._drive === 'manual') this.eng?.key(name, down); }
  /** Anzeige: Tempo, Ducken, Bremsen, Windschatten (wie im Spiel) */
  hud(): HudState | null { return this.eng?.hud() ?? null; }

  /** Autopilot: Ideallinie, an Gegnern vorbei, auf Geraden ducken – bremsen tut der Bremsassistent des Spiels */
  private autopilot() {
    const e = this.eng!;
    const p = e.p;
    let tx = this.prof(this.xProf, p.z + 5);
    for (const o of e.opps) {
      const dz = o.z - p.z;
      if (dz < 0.4 || dz > 16) continue;
      if (Math.abs(o.x - tx) < 1.05 && p.v > o.v - 0.6) tx = o.x + (o.x > tx ? -1.3 : 1.3);
    }
    e.tx = clamp(tx, -ROAD_HALF + 0.5, ROAD_HALF - 0.5);
    const k = this.prof(this.kProf, p.z + 10);
    e.key('up', Math.abs(k) < 0.006 && p.v > 11);
  }

  /** Rücklicht: nachts und bei Regen */
  private lampLevel(): number { return clamp(MOOD_U.night.value + MOOD_U.rain.value * 0.6, 0, 1); }

  /** Fahrer bewegen (Spiellogik) und alle Fahrer auf die Strecke stellen */
  private place(dt: number) {
    const e = this.eng!;
    const t = this.track!;
    const p = e.p;
    if (dt > 0) {
      if (this._drive === 'auto') this.autopilot();
      e.update(dt);
      if (p.z > Z1 - 40) {
        this.perf.event(EV.wrap, 'Runde zu Ende, wieder vorn');
        if (this.measureLap) this.finishMeasure();
        this.startRun(Z0);
        this.camInit = false;
        this.wrapped = true;
      }
    }
    this.z = p.z;
    this.x = p.x;
    this.v = p.v;
    const roadY = t.heightAt(p.z);
    const air = Math.max(0, p.y - roadY);
    t.world(p.z, p.x, 0, this.w);
    const R = this.rider!;
    R.group.position.set(this.w.x, this.w.y + air, this.w.z);
    R.group.rotation.y = -this.w.th;
    const light = this.lampLevel();
    if ((light > 0.05) !== this.lampOn) { this.lampOn = light > 0.05; this.perf.event(EV.vis, this.lampOn ? 'Rücklichter an' : 'Rücklichter aus'); }
    R.pose({
      lean: p.lean, pedal: p.pedal, tuck: p.tuck, brake: p.brake, stand: p.stand ?? 0, sprint: 0,
      v: p.v, air, surface: t.segAt(p.z).surface, wobble: p.wobble, light, roll: p.z / 0.34,
    }, dt, this.time);
    R.lamp(light > 0.05);
    this.placeOpps(dt, light);
  }

  /** Gegner: die nächsten (höchstens so viele wie eingestellt) bekommen ein Modell aus dem Vorrat */
  private placeOpps(dt: number, light: number) {
    const e = this.eng!;
    const t = this.track!;
    const p = e.p;
    const max = Math.min(POOL, Math.round(this.settings.oppMax));
    const list = e.opps.filter((o) => o.z > p.z - 40 && o.z < p.z + 300).sort((a, b) => Math.abs(a.z - p.z) - Math.abs(b.z - p.z)).slice(0, max);
    const keep = new Set(list.map((o) => o.id));
    for (const [id, i] of this.poolOf) {
      if (keep.has(id)) continue;
      this.pool[i].group.visible = false;
      this.poolOf.delete(id);
      this.poolFree.push(i);
    }
    const cp = this.camera.position;
    for (const o of list) {
      let i = this.poolOf.get(o.id);
      if (i === undefined) {
        i = this.poolFree.pop();
        if (i === undefined) continue;
        this.poolOf.set(o.id, i);
        this.pool[i].reseed(o.id * 7.31 + 3);
        this.perf.event(EV.opp, `Gegner ${o.id} im Bild (${Math.round(o.z - p.z)} m)`);
      }
      const R = this.pool[i];
      R.group.visible = true;
      t.world(o.z, o.x, 0, this.w);
      R.group.position.set(this.w.x, this.w.y, this.w.z);
      R.group.rotation.y = -this.w.th;
      const d = cp.distanceTo(R.group.position);
      R.far(d);
      R.shadows(d < 45);
      R.pose({
        lean: o.lean, pedal: o.pedal, tuck: o.tuck, brake: o.brake, stand: o.stand ?? 0, sprint: 0,
        v: o.v, air: 0, surface: t.segAt(o.z).surface, wobble: o.bump, light, roll: o.z / 0.34,
      }, dt, this.time);
      R.lamp(light > 0.05);
    }
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
    if (this.free) {
      const f = this.free;
      const a = (f.az * Math.PI) / 180, e = (f.el * Math.PI) / 180;
      this.camera.position.set(f.at.x + Math.sin(a) * Math.cos(e) * f.dist, f.at.y + Math.sin(e) * f.dist, f.at.z + Math.cos(a) * Math.cos(e) * f.dist);
      this.camera.lookAt(f.at);
      return;
    }
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
    const atmo = this.atmo!;
    const sun = atmo.sun;
    if (this.trees) this.trees.sunDir.value.copy(atmo.sunDir);
    const t = this.track!;
    t.world(this.z + 22, 0, 0, this.w);
    const c = this.free ? this.free.at.clone() : new THREE.Vector3(this.w.x, this.w.y, this.w.z);
    const d = atmo.sunDir;
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
    if (!this.ready || this.analysing) return;
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
    if (this.slowFor > 700) want = Math.max(Math.min(this.settings.minDpr, this.maxDpr), this.dpr - 0.15);
    else if (this.fastFor > 3500) want = Math.min(this.maxDpr, this.dpr + 0.1);
    if (want !== this.dpr) {
      this.perf.event(EV.dpr, `${this.dpr.toFixed(2)}→${(Math.round(want * 100) / 100).toFixed(2)}`);
      this.dpr = Math.round(want * 100) / 100;
      this.renderer.setPixelRatio(this.dpr);
      this.lastDprChange = now;
      this.slowFor = this.fastFor = 0;
    }
  }

  /** ein Bild: Fehler darin halten nichts an (werden in der Messfahrt vermerkt), Wartende kommen immer weiter */
  private frame(t: number) {
    if (this.disposed) return;
    try {
      this.frameBody(t);
    } catch (e) {
      this.noteError('Bild', e);
    } finally {
      if (this.frameWaiters.length) { const w = this.frameWaiters; this.frameWaiters = []; for (const f of w) f(); }
    }
  }

  private errCount = 0;
  /** Fehler vermerken (Messfahrt) und ins Protokoll – höchstens 20 je Sitzung, damit nichts überläuft */
  noteError(where: string, e: unknown) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    this.perf.event(EV.error, `${where}: ${msg.slice(0, 200)}`);
    if (this.errCount++ < 20) console.error(`[gpu] ${where}:`, e);
  }

  private frameBody(t: number) {
    const P = this.perf;
    P.begin(t);
    const t0 = performance.now();
    const rawMs = this.last ? t - this.last : 16.7;
    const dtMs = Math.min(100, rawMs);
    this.last = t;
    this.avgMs += (dtMs - this.avgMs) * 0.05;
    const dt = Math.min(0.05, dtMs / 1000);
    this.time += dt;
    if (this.ready && this.track && this.rider) {
      if (!this.paused) this.place(dt);
      P.mark(0);
      this.updateCamera(dt);
      P.mark(1);
      this.atmo?.update(this.paused ? 0 : dt, this.camera.position, this.camera);
      this.updateSun();
      const mood = this.moodName;
      if (mood !== this.shownMood) { if (this.shownMood) P.event(EV.mood, mood); this.shownMood = mood; }
      P.mark(2);
      this.trees?.update(this.camera.position, this.wrapped);
      P.mark(3);
      this.houses?.update(this.camera.position);
      P.mark(4);
      this.life?.update(this.camera.position);
      P.mark(5);
      this.crowd?.update(this.camera.position, this.rider.group.position);
      P.mark(6);
      this.wrapped = false;
      this.grass?.update(this.camera.position);
    }
    this.adapt(dtMs, t);
    P.mark(7);
    // Prüfbilder: nur auf Abruf zeichnen (Software-Grafik ist zu langsam für jedes Bild); beim Laden gar nicht
    if (this.ready && !this.offscreen) this.draw();
    P.mark(8);
    if (this.ready) this.avgCpu += (performance.now() - t0 - this.avgCpu) * 0.05;
    // GPU-Zeit (nur mit Zeitstempeln): während der Messung oder bei sichtbarer Kurve, höchstens eine Abfrage offen
    const be = this.renderer.backend as unknown as { trackTimestamp?: boolean };
    if (this.ready && !this.offscreen) this.gpuFrames++;
    // nur, wenn seit der letzten Abfrage gezeichnet wurde (sonst liefert three.js den alten Wert)
    if (this.ready && be.trackTimestamp && this.gpuFrames > 0 && (P.rec || this.graph || this.gpuSamples) && !this.gpuPending) {
      this.gpuPending = true;
      const nf = Math.max(1, this.gpuFrames);
      this.gpuFrames = 0;
      this.renderer.resolveTimestampsAsync('render').then((ms) => {
        if (typeof ms !== 'number' || !(ms > 0)) return;
        P.gpu = ms / nf;
        this.gpuSamples?.push(ms / nf);
      }).catch(() => undefined).finally(() => { this.gpuPending = false; });
    }
    // neue Shader/Pipelines (Materialaufbau in three.js, Pipeline beim Grafiktreiber) und Sichtbarkeitswechsel
    if (this.ready) {
      const ri = this.renderer as unknown as { _nodes?: { nodeBuilderCache?: Map<unknown, unknown> }; _pipelines?: { caches?: Map<unknown, unknown> } };
      const nb = ri._nodes?.nodeBuilderCache?.size ?? 0;
      const pc = ri._pipelines?.caches?.size ?? 0;
      if (this.cacheN >= 0 && (nb !== this.cacheN || pc !== this.cacheP)) P.event(EV.shader, `Materialaufbau ${nb - this.cacheN >= 0 ? '+' : ''}${nb - this.cacheN}, Pipelines ${pc - this.cacheP >= 0 ? '+' : ''}${pc - this.cacheP} (jetzt ${nb}/${pc})`);
      this.cacheN = nb;
      this.cacheP = pc;
      const vs = this.atmo?.visState ?? '';
      if (vs !== this.shownVis) { if (this.shownVis) P.event(EV.vis, vs); this.shownVis = vs; }
    }
    const info = this.renderer.info.render;
    if (this.ready) {
      P.end({
        dt: rawMs, period: this.period, calls: info.drawCalls, tris: info.triangles, dpr: this.dpr, z: this.z, v: this.v,
        cam: ['chase', 'low', 'side', 'drone'].indexOf(this._cam), opps: this.poolOf.size,
      });
    }
    this.opts.onStats?.({
      fps: 1000 / this.avgMs, ms: this.avgMs, period: this.period, dpr: this.dpr, backend: this.backendName,
      tris: info.triangles, calls: info.drawCalls, cpu: this.avgCpu, loading: this.ready ? 1 : this.loadFrac, stage: this.stage,
      note: this.ready && this.period > 14 ? 'Safari begrenzt auf 60 Hz (siehe Hinweis)' : '',
    });
  }

  private frameWaiters: (() => void)[] = [];
  /** nächstes Bild abwarten – höchstens 4 s (falls die Schleife hängt, geht die Analyse trotzdem weiter) */
  private nextFrame(): Promise<void> {
    return new Promise((res) => {
      const id = window.setTimeout(res, 4000);
      this.frameWaiters.push(() => { window.clearTimeout(id); res(); });
    });
  }
  /** laufende Kostenanalyse abbrechen */
  abortAnalysis() { this.analysisAbort = true; }
  private analysisAbort = false;
  /** Kostenanalyse läuft: Auflösung bleibt fest */
  private analysing = false;

  /**
   * Kostenanalyse: Fahrt angehalten, Kamera fest; je Variante (Ebene aus, andere Auflösung) ~50 Bilder messen –
   * GPU-Zeit (Median, wenn das Gerät Zeitstempel kann), CPU fürs Zeichnen, Bildzeit, Aufrufe, Dreiecke. Danach
   * ist alles wie vorher. Die Unterschiede zur Basis zeigen, was jede Ebene kostet.
   */
  async costAnalysis(progress?: (i: number, n: number, label: string) => void): Promise<string> {
    const S0 = { ...this.settings };
    const paused0 = this.paused;
    const dpr0 = this.dpr;
    this.paused = true;
    this.analysing = true;
    this.analysisAbort = false;
    const groups: [string, THREE.Object3D | undefined][] = [
      ['trees', this.trees?.group], ['houses', this.houses?.group], ['field', this.field?.group], ['corridor', this.corridor?.group],
      ['grass', this.grass?.group], ['life', this.life?.group], ['crowd', this.crowd?.group],
    ];
    const vis0 = groups.map(([, g]) => g?.visible ?? false);
    const setDpr = (d: number) => { this.dpr = d; this.renderer.setPixelRatio(d); };
    const hide = (...names: string[]) => { for (const [k, g] of groups) if (g && names.includes(k)) g.visible = false; };
    const base = Math.min(1, this.maxDpr);
    const maxD = Math.min(2, window.devicePixelRatio || 1);
    const steps: [string, () => void][] = [
      ['Basis (Auflösung ×' + base.toFixed(2) + ')', () => undefined],
      ['ohne Leuchten (Bloom-Kette)', () => this.applySettings({ ...S0, bloom: false }, true)],
      // nur den Schattendurchgang aussetzen (Karte bleibt stehen): Schatten aus- und einschalten baut alle Materialien neu
      ['ohne Schattendurchgang', () => { this.atmo!.sun.shadow.autoUpdate = false; }],
      ['ohne Gegner', () => this.applySettings({ ...S0, oppMax: 0 }, true)],
      ['ohne Zuschauer', () => hide('crowd')],
      ['ohne Blumen, Sträucher, Tiere', () => hide('life')],
      ['ohne Grashalme', () => hide('grass')],
      ['ohne Bäume', () => hide('trees')],
      ['ohne Häuser', () => hide('houses')],
      ['ohne Landschaft (Boden, Berge)', () => hide('field')],
      ['ohne Straße und Rand', () => hide('corridor')],
      ['nur Himmel + Nachbearbeitung', () => hide('trees', 'houses', 'field', 'corridor', 'grass', 'life', 'crowd')],
      ['Auflösung ×0.7', () => setDpr(0.7)],
      ['Auflösung ×1.5', () => setDpr(Math.min(1.5, maxD))],
      ...(maxD >= 2 ? [['Auflösung ×2.0', () => setDpr(2)] as [string, () => void]] : []),
    ];
    const med = (a: number[]) => { if (!a.length) return -1; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const p90 = (a: number[]) => { if (!a.length) return -1; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * 0.9)]; };
    const rows: { name: string; gpu: number; gpu90: number; draw: number; cpu: number; frame: number; calls: number; tris: number; px: string }[] = [];
    const restore = () => {
      if (this.atmo) this.atmo.sun.shadow.autoUpdate = S0.shadows;
      if (JSON.stringify(this.settings) !== JSON.stringify(S0)) this.applySettings(S0, true);
      groups.forEach(([, g], i) => { if (g) g.visible = vis0[i]; });
      setDpr(base);
    };
    try {
      for (let i = 0; i < steps.length && !this.analysisAbort; i++) {
        const [name, set] = steps[i];
        progress?.(i, steps.length, name);
        restore();
        set();
        this.place(0);
        // einschwingen (beim Umschalten der Schatten übersetzt three.js einmal neu)
        for (let k = 0; k < 14; k++) await this.nextFrame();
        this.gpuSamples = [];
        const draw: number[] = [], cpu: number[] = [], frame: number[] = [];
        let calls = 0, tris = 0;
        for (let k = 0; k < 50; k++) {
          await this.nextFrame();
          draw.push(this.perf.sec[8]);
          const last = (this.perf.ringAt + 179) % 180;
          frame.push(this.perf.ring[last * 2]);
          cpu.push(this.perf.ring[last * 2 + 1]);
          calls = this.renderer.info.render.drawCalls;
          tris = this.renderer.info.render.triangles;
        }
        for (let k = 0; k < 4; k++) await this.nextFrame();
        const g = this.gpuSamples;
        this.gpuSamples = null;
        const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        rows.push({ name, gpu: med(g), gpu90: p90(g), draw: med(draw), cpu: med(cpu), frame: med(frame), calls, tris, px: `${size.x}×${size.y}` });
      }
    } finally {
      this.gpuSamples = null;
      restore();
      setDpr(dpr0);
      this.place(0);
      // im Prüfbild-Modus bleibt es angehalten, sonst geht die Fahrt immer weiter
      this.paused = this.offscreen ? paused0 : false;
      this.analysing = false;
    }
    if (!rows.length) return 'Kostenanalyse abgebrochen';
    const b = rows[0];
    const f = (x: number) => (x < 0 ? '–' : x.toFixed(2));
    const d = (x: number, y: number) => (x < 0 || y < 0 ? '' : ` (${y - x >= 0 ? '−' : '+'}${Math.abs(y - x).toFixed(2)})`);
    const lines = [
      `gruppetto WebGPU-Kostenanalyse · ${new Date().toISOString()} · ${this.backendName} · GPU-Zeitstempel ${this.gpuTiming ? 'ja' : 'nein'}`,
      `Gerät: ${navigator.userAgent}`,
      `Ort z=${Math.round(this.z)} m, Kamera ${this._cam}, Stimmung ${this.moodName}, Takt ${(1000 / this.period).toFixed(0)} Hz, MSAA ${S0.msaa}, Einstellungen ${JSON.stringify(Object.fromEntries(Object.entries(S0).filter(([k, v]) => (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[k] !== v)))}`,
      'Variante | GPU ms (Median, Ersparnis zur Basis) | GPU 90 % | CPU zeichnen ms | CPU gesamt ms | Bildzeit ms | Aufrufe | Dreiecke k | Bildpunkte',
      ...rows.map((r) => `${r.name} | ${f(r.gpu)}${r === b ? '' : d(r.gpu, b.gpu)} | ${f(r.gpu90)} | ${f(r.draw)}${r === b ? '' : d(r.draw, b.draw)} | ${f(r.cpu)} | ${f(r.frame)} | ${r.calls} | ${Math.round(r.tris / 1000)} | ${r.px}`),
    ];
    return lines.join('\n');
  }

  /** GPU-Zeitstempel verfügbar? (Gerät und Browser) */
  get gpuTiming(): boolean { return !!(this.renderer.backend as unknown as { trackTimestamp?: boolean }).trackTimestamp; }

  /** Gerät und Grafik für den Bericht */
  private deviceInfo(): Record<string, unknown> {
    const be = this.renderer.backend as unknown as { device?: { adapterInfo?: Record<string, string> }; adapter?: { info?: Record<string, string> } };
    const ai = be.device?.adapterInfo ?? be.adapter?.info;
    const pick = ai ? { vendor: ai.vendor, architecture: ai.architecture, device: ai.device, description: ai.description } : null;
    return {
      ua: navigator.userAgent, bildschirm: `${screen.width}×${screen.height}`, pixeldichte: window.devicePixelRatio, fenster: `${window.innerWidth}×${window.innerHeight}`,
      technik: this.backendName, grafik: pick, gpu_zeitstempel: this.gpuTiming,
    };
  }

  /**
   * Messfahrt starten: eine Runde von vorn (lap) oder ab hier bis „Stopp“. extra: Angaben der Seite (Version,
   * geänderte Einstellungen …)
   */
  startMeasure(lap: boolean, extra: Record<string, unknown> = {}) {
    if (lap) { this.startRun(Z0); this.camInit = false; this.wrapped = true; }
    this.measureLap = lap;
    this.perf.startRec({
      ...extra, ...this.deviceInfo(), fahren: this._drive, kamera_start: this._cam, stimmung: this.moodName,
      gegner_max: this.settings.oppMax, start_z: Math.round(this.z), runde: lap,
    });
  }

  get measuring(): boolean { return !!this.perf.rec; }

  /** Messfahrt beenden: Bericht (oder null, wenn zu kurz) */
  stopMeasure(): Report | null {
    this.measureLap = false;
    return this.perf.stopRec();
  }

  private finishMeasure() {
    const r = this.stopMeasure();
    if (r) this.onReport?.(r);
  }

  private draw(pl: THREE.RenderPipeline | null = this.pipeline) {
    if (!pl) return;
    this.renderer.info.reset();
    if (this.offscreen) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      if (!this.frameRT || this.frameRT.width !== size.x || this.frameRT.height !== size.y) {
        this.frameRT?.dispose();
        this.frameRT = new THREE.RenderTarget(size.x, size.y, { depthBuffer: false });
      }
      this.renderer.setRenderTarget(this.frameRT);
      pl.render();
      this.renderer.setRenderTarget(null);
    } else pl.render();
  }

  /** Prüfbild: ein Bild in eine Textur zeichnen und zurücklesen (Tests ohne Bildschirm) */
  async snapshot(): Promise<string> {
    const r = this.renderer;
    r.info.reset();
    if (this.track && this.rider) { this.updateCamera(1); this.atmo?.update(0, this.camera.position, this.camera); this.updateSun(); this.trees?.update(this.camera.position, true); this.grass?.update(this.camera.position); this.houses?.update(this.camera.position, true); this.life?.update(this.camera.position, true); this.crowd?.update(this.camera.position, this.rider.group.position, true); }
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

  /** Einstellungen aus dem Menü übernehmen und merken */
  applySettings(s: Settings, instant = false) {
    const prev = this.settings;
    const diff = (Object.keys(s) as (keyof Settings)[]).filter((k) => s[k] !== prev[k]).map((k) => `${k}=${String(s[k])}`).join(' ');
    if (diff) this.perf.event(EV.settings, diff);
    this.settings = s;
    saveSettings(s);
    this.atmo?.apply(s, instant);
    this.maxDpr = Math.min(window.devicePixelRatio || 1, s.maxDpr);
    if (this.dpr > this.maxDpr) { this.dpr = this.maxDpr; this.renderer.setPixelRatio(this.dpr); }
    if (this.crowd) this.crowd.group.visible = s.crowd;
    if (this.life) this.life.group.visible = s.life;
    if (this.grass) this.grass.group.visible = s.grass;
    // Sonnenschatten: atmo.apply (Stärke und Durchgang) – shadowMap.enabled bleibt an, sonst baut three.js alles neu
    void prev;
  }

  /** aktuelle Stimmung (beim Wetterwechsel die gezeigte) */
  get moodName(): string { return this.atmo ? MOODS[(this.atmo as unknown as { shown: Settings['mood'] }).shown].name : ''; }

  resize() {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.eng?.setViewport(w);
  }

  private onWinError: ((e: Event) => void) | null = null;

  dispose() {
    this.disposed = true;
    if (this.onWinError) { window.removeEventListener('error', this.onWinError); window.removeEventListener('unhandledrejection', this.onWinError); }
    this.renderer.setAnimationLoop(null);
    this.renderer.domElement.remove();
    this.field?.dispose();
    this.corridor?.dispose();
    this.trees?.dispose();
    this.grass?.dispose();
    this.houses?.dispose();
    this.life?.dispose();
    this.crowd?.dispose();
    this.rider?.dispose();
    for (const R of this.pool) R.dispose();
    this.atmo?.dispose();
    this.frameRT?.dispose();
    this.renderer.dispose();
  }
}

/** Pappschilder der Zuschauer: Atlas der Banden vorn, Pappe hinten */
function signMesh(sg: { pos: number[]; uv: number[] }, map: THREE.Texture): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(sg.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(sg.uv, 2));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  m.colorNode = select(frontFacing, texture(map, uv()).rgb, vec3(0.3, 0.2, 0.11));
  m.roughnessNode = float(0.85);
  m.metalnessNode = float(0);
  m.name = 'signs';
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}
