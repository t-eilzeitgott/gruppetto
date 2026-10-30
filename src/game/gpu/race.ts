/**
 * Abfahrt auf WebGPU (Admin): das ganze Spiel mit der neuen Grafik – endlose Passabfahrt (gestreamt, world.ts),
 * Gegner, Trinkflaschen und Hindernisse, Tunnel, Punkte und Kombos, Sturz, Ergebnis. Die Spiellogik ist die des
 * Spiels (engine.ts); hier wird nur gezeichnet: Fahrer, Welt, Dinge auf der Straße, Partikel, Himmel und Licht
 * (atmo.ts, mit dramatischem Himmel und dezentem Sonnenuntergangs-Licht), dazu die 2D-Ebene (overlay.ts).
 *
 * Nachladen: je Bild ein kleines Zeitbudget für den nächsten Abschnitt voraus (mehr, wenn die Welt knapp wird
 * oder das Spiel pausiert). Vorgewärmt wird alles, was unterwegs vorkommen kann (andere Landschaften, Tunnel,
 * Häuser, Zuschauer, Dinge) – damit unterwegs kein Shader neu übersetzt wird.
 *
 * Ziel wie beim Test: 120 Bilder/s auf einem iPhone 15 Pro; die Auflösung regelt sich nach der Bildzeit.
 */
import * as THREE from 'three/webgpu';
import { Track, SEG, EDGE, ROAD_HALF } from '../abfahrt/track';
import { Terrain } from '../abfahrt/terrain3d';
import { adsTex } from '../abfahrt/tex3d';
import { Abfahrt, type GameEvent, type HudState, type Phase, type RunResult } from '../abfahrt/engine';
import { TimeTrial, type TtEvent, type TtHud, type TtResult } from '../abfahrt/zeitfahren';
import type { StageRef } from '../abfahrt/stageRef';
import type { GhostRider } from '../tt';
import type { Kit } from '../abfahrt/rider';
import { wreckPose, type Wreck } from '../abfahrt/wreck';
import { JOINTS, Ragdoll, type Ground } from '../abfahrt/ragdoll';
import { bakeFlowerDots, bakeSurfaces, type Surface, type SurfaceId } from './bake';
import { Atmo } from './atmo';
import { loadSettings, MOOD_U, MOODS, RACE_DEFAULTS, RACE_KEY, saveSettings, type Settings } from './mood';
import { corridorMaterial, terrainMaterial } from './ground';
import { adsMaterial, marksMaterial, metalMaterial, paintMaterial, roadMaterial, woodMaterial } from './mats';
import { Rider, teamKit } from './rider';
import { Peloton } from './peloton';
import { EV, Perf, type Report } from './perf';
import { World } from './world';
import { SunBake } from './sunbake';
import { SunMaps } from './sunmap';
/** beim Laden so weit voraus bauen (den Rest bis AHEAD holt das Nachladen im Countdown) */
const LOAD_AHEAD = 1100;
import { Objects, Particles } from './objects';
import { Overlay } from './overlay';
import { tsl } from './nodes';

const { pass } = tsl;

export interface RaceStats {
  fps: number;
  ms: number;
  period: number;
  dpr: number;
  cpu: number;
  /** GPU-Zeit je Bild (ms; −1 unbekannt) */
  gpu: number;
  tris: number;
  calls: number;
  loading: number;
  stage: string;
  /** Welt fertig gebaut bis (m), Fahrer bei (m), Bauzeit je Bild (ms) */
  built: number;
  z: number;
  buildMs: number;
  backend: string;
}

/** Zeitfahren statt Abfahrt: Geister der Runde, eigener Name, echte Vorlage (Namen, Gegend) */
export interface TtSetup {
  rider: string;
  ghosts: GhostRider[];
  myBest: number | null;
  town: StageRef | null;
  onEvent?: (e: TtEvent) => void;
  onOver?: (r: TtResult) => void;
}

/** Namensschild über einem Geist (Bildschirmlage in CSS-Pixeln) */
export interface TagView { id: number; text: string; sub: string; color: string; x: number; y: number; k: number }

export interface RaceOptions {
  dayKey: string;
  names: string[];
  kit: Kit;
  /** Zeitfahren (sonst Abfahrt) */
  tt?: TtSetup;
  /** Einstellungen: Schlüssel auf dem Gerät und Standard (Abfahrt und Zeitfahren getrennt) */
  settingsKey?: string;
  defaults?: Settings;
  onStats?: (s: RaceStats) => void;
  onReady?: () => void;
  onError?: (e: unknown) => void;
  onEvent?: (e: GameEvent) => void;
  onOver?: (r: RunResult) => void;
  /** nach jedem Bild (Anzeige schreiben) */
  onFrame?: (dt: number) => void;
}

export type RaceCam = 'chase' | 'low' | 'side' | 'drone';

/** Vorrat an Gegner-Modellen (beim Laden gebaut und vorgewärmt) */
const POOL = 16;
/** Fahrerfeld: volles Modell → einfaches Modell weich zwischen diesen Abständen (m) */
/**
 * Gegner: volles Modell ab PEL_FADE[0] m (Kamera), zurück zum einfachen erst über PEL_FADE[1] – jeder wechselt einmal
 * und blendet dabei PEL_T Sekunden über (früher: ständig halb/halb, solange einer in 26–36 m mitfuhr)
 */
const PEL_FADE: [number, number] = [28, 38];
/** Kostenanalyse: so oft je Bild zeichnen (Grafik ausgelastet, voller Takt) */
const REPEAT = 3;
const PEL_T = 0.4;
/** Fahrerfeld der Abfahrt: so viele Gegner höchstens voraus (in Gruppen); ?field=N zum Ausprobieren */
const FIELD = Number(/[?&]field=(\d+)/.exec(typeof location !== 'undefined' ? location.search : '')?.[1] ?? 60);
/** Kamera hinter dem Fahrer wie im Spiel */
const CAM_BACK = 6.2;
const CAM_UP = 2.75;
/** so weit (m) vor einer Spitzkehre beginnt der Flug zur TV-Kamera */
const TV_LEAD = 70;
/** Hindernis für die Sichtlinie: senkrechter Zylinder (Baum, Haus) bis zur Höhe top */
interface Obstacle { x: number; z: number; r: number; top: number }

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const HAZ = new Set(['rock', 'cone', 'pothole', 'cow']);

export class Race {
  private renderer: THREE.WebGPURenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.3, 24000);
  private pipeBloom: THREE.RenderPipeline | null = null;
  private pipeFlat: THREE.RenderPipeline | null = null;
  private get pipeline(): THREE.RenderPipeline | null { return this.atmo?.bloomOn ? this.pipeBloom : this.pipeFlat; }
  private scenePass: ReturnType<typeof pass> | null = null;
  private atmo: Atmo | null = null;
  settings: Settings;
  private track: Track | null = null;
  private terrain: Terrain | null = null;
  private world: World | null = null;
  private objects: Objects | null = null;
  private particles: Particles | null = null;
  readonly overlay = new Overlay();
  private rider: Rider | null = null;
  private pool: Rider[] = [];
  /** Fahrerfeld in der Ferne (Instanzen; nur Abfahrt) */
  private peloton: Peloton | null = null;
  private poolOf = new Map<number, number>();
  private poolFree: number[] = [];
  /** laufende Fahrt (auch vor dem Start: Fahrer stehen am Start) */
  private eng: Abfahrt | TimeTrial | null = null;
  /** Zeitfahren? */
  get isTt(): boolean { return !!this.opts.tt; }
  /** Intro: Kamera kreist vor dem Start langsam um den Fahrer (Zeitfahren) */
  private introT = 0;
  private cruise = 0;
  /** angehalten (Pausenmenü): Spiel steht, die Welt baut weiter voraus */
  paused = false;
  /** Autopilot (Prüfen ohne Daumen): Linie, ausweichen, Flaschen mitnehmen */
  autopilot = false;
  private disposed = false;
  private ready = false;
  private loadFrac = 0;
  private stage = 'WebGPU startet';
  private last = 0;
  private time = 0;
  private avgMs = 1000 / 60;
  private avgCpu = 0;
  private period = 1000 / 60;
  private intervals: number[] = [];
  private dpr = 1.5;
  private maxDpr = 2;
  /** Auflösung des Bilds (Leinwand): höchstens maxDpr – ist die Szene klein, reicht ×2 (die Nachbearbeitung je Bildpunkt kostet) */
  private canvasDpr = 2;
  private lastDprChange = 0;
  private slowFor = 0;
  private fastFor = 0;
  private offscreen = /[?&]shots\b/.test(location.search);
  private frameRT: THREE.RenderTarget | null = null;
  private w = { x: 0, y: 0, z: 0, th: 0 };
  private _cam: RaceCam = 'chase';
  private camFrom: RaceCam | null = null;
  private camBlend = 1;
  private sideSign = 1;
  private cam = { init: false, th: 0, y: 0, fov: 60 };
  private tunnelK = 0;
  private lampOn = false;
  private cacheN = -1;
  private cacheP = -1;
  private shownVis = '';
  private shownMood = '';
  private lastPhase: Phase | '' = '';
  private lastBuilt = 0;
  private gpuPending = false;
  private gpuFrames = 0;
  private gpuMs = -1;
  /** GPU-Zeit geglättet; Auflösung, unter der es nicht schneller wird (gelernt), laufender Versuch */
  private avgGpu = 0;
  private dprFloor = 0;
  private floorUntil = 0;
  private probe: { from: number; ms: number; gpu: number; at: number } | null = null;
  readonly perf = new Perf();
  /** Messfahrt fertig */
  onReport: ((r: Report) => void) | null = null;
  /** Prüfhilfe: freie Kamera (Azimut, Höhe in Grad, Abstand in m) um einen Punkt */
  private free: { at: THREE.Vector3; az: number; el: number; dist: number } | null = null;
  private budget = Number(/[?&]budget=([0-9.]+)/.exec(location.search)?.[1] ?? 0);
  private onWinError: ((e: Event) => void) | null = null;
  private errCount = 0;
  private screenPos = new THREE.Vector3();
  /** vorberechnetes Sonnenlicht und die Karten von oben */
  private sunBake: SunBake | null = null;
  private maps: SunMaps | null = null;
  private mapFocus = new THREE.Vector3();
  private fieldDone = -1;
  private piecesSeen = -1;
  /** Sonne am eigenen Fahrer (geglättet): Licht der Fahrer und Dinge (PBR) folgt den vorberechneten Schatten */
  private sunHere = 1;

  constructor(private host: HTMLElement, private opts: RaceOptions) {
    // immer Sonnenuntergang, ohne Wetterwechsel und ohne Schattenkarte: die Schatten sind vorberechnet (die Sonne
    // steht fest) – gespeicherte ältere Einstellungen ändern daran nichts
    // Leuchten (Bloom) aus: kostete auf dem iPhone ~6 ms je Bild (Lichthöfe der Laternen und Fenster leuchten selbst)
    this.settings = { ...loadSettings(opts.settingsKey ?? RACE_KEY, opts.defaults ?? RACE_DEFAULTS), mood: 'abend', cycle: false, shadows: false, bloom: false };
    this.renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance', reversedDepthBuffer: true, trackTimestamp: true } as ConstructorParameters<typeof THREE.WebGPURenderer>[0]);
  }

  get isReady() { return this.ready; }
  get backendName(): string { return (this.renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL 2 (Ersatz)'; }
  get gpuTiming(): boolean { return !!(this.renderer.backend as unknown as { trackTimestamp?: boolean }).trackTimestamp; }
  get phase(): Phase { return this.eng?.phase ?? 'ready'; }
  get moodName(): string { return this.atmo ? MOODS[(this.atmo as unknown as { shown: Settings['mood'] }).shown].name : ''; }
  /** Strecke der Fahrt (Titel für die Startkarte) */
  get title(): string { return this.track?.title ?? ''; }

  get camMode(): RaceCam { return this._cam; }
  set camMode(m: RaceCam) {
    if (m === this._cam) return;
    this.perf.event(EV.cam, `${this._cam}→${m}`);
    if (m === 'side') this.sideSign = (this.eng?.p.x ?? 0) > 0 ? -1 : 1;
    this.camFrom = this.cam.init ? this._cam : null;
    this.camBlend = this.camFrom ? 0 : 1;
    this._cam = m;
  }

  // ------------------------------------------------------------------ Aufbau

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
    const log = (m: string) => console.info(`[race] ${m} (${Math.round(performance.now() - t0)} ms)`);
    // Bild in voller Auflösung (Bildschirm, höchstens maxDpr), die Szene darin wird nach Bedarf kleiner gerechnet
    // und beim Hochskalieren nachgeschärft (setDpr) – die Oberfläche (HUD) ist ohnehin HTML und bleibt scharf
    this.maxDpr = Math.min(window.devicePixelRatio || 1, this.settings.maxDpr);
    // Szene anfangs höchstens doppelt (die Regelung geht von dort nach oben oder unten); mit begrenzter Bildrate ab
    // „Szene mindestens“: so wenig Arbeit je Bild wie eingestellt (größer nur mit viel Luft)
    this.dpr = Math.min(this.maxDpr, Math.max(this.settings.minDpr, this.settings.fpsCap > 0 ? 0 : 2));
    this.canvasDpr = this.canvasFor(this.dpr);
    r.setPixelRatio(this.canvasDpr);
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 0.62;
    // keine Schattenkarte: Schatten sind vorberechnet (sunbake.ts, sunmap.ts)
    r.shadowMap.enabled = false;
    r.info.autoReset = false;
    this.host.appendChild(r.domElement);
    r.domElement.style.display = 'block';
    r.domElement.style.width = '100%';
    r.domElement.style.height = '100%';
    this.host.appendChild(this.overlay.canvas);
    this.resize();
    const gpu = !!(r.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend;
    const low = /[?&]lowbake\b/.test(location.search);
    const step = async (frac: number, stage: string) => {
      this.loadFrac = frac;
      this.stage = stage;
      log(stage);
      await new Promise((res) => setTimeout(res, 0));
    };
    r.setAnimationLoop((t) => this.frame(t));
    await step(0.02, 'Oberflächen werden gebacken');
    const S: Record<SurfaceId, Surface> = bakeSurfaces(r, low ? 0.25 : 1);
    const dots = bakeFlowerDots(r, low ? 256 : 512);
    await step(0.06, 'Himmel');
    const skySize = Number(/[?&]sky=(\d+)/.exec(location.search)?.[1] ?? 0) || (low ? 128 : 512);
    const atmo = (this.atmo = new Atmo(r, this.scene, this.settings, skySize, false));
    atmo.staticSun = true;
    atmo.apply(this.settings, true);
    if (this.disposed) return;

    await step(0.1, 'Strecke');
    const track = (this.track = new Track(this.opts.dayKey, this.opts.names, this.opts.tt ? 'tt' : 'descent', this.opts.tt?.town ?? null));
    // Abfahrt mit Fahrerfeld: Straße mal breiter, mal enger (dieselbe Regel wie in der Fahrphysik)
    track.widthVar = !this.opts.tt;
    const terrain = (this.terrain = new Terrain(track));
    terrain.woods = true;
    terrain.rugged = true;
    const adsM = adsMaterial(adsTex(this.opts.names));
    const world = (this.world = new World({
      renderer: r, track, terrain, msaa: gpu && this.settings.msaa > 0, low,
      terrainMats: [terrainMaterial(S, 0, dots, true), terrainMaterial(S, 1, undefined, true), terrainMaterial(S, 2, undefined, true)],
      corridorMats: {
        road: roadMaterial(S), marks: marksMaterial(S), sides: corridorMaterial(S, dots), metal: metalMaterial(), wood: woodMaterial(),
        paint: paintMaterial(), ads: adsM,
      },
      adsMap: adsM.map ?? null,
      surfaces: S,
      crowd: gpu,
      accent: this.opts.kit.jersey,
    }));
    this.scene.add(world.group);
    // Zuschauer als Bilder (fern): Atlas aus den 3D-Menschen backen
    if (world.crowd) await world.crowd.bake(r);
    world.trees.sunDir.value.copy(atmo.sunDir);
    world.trees.setFar(this.settings.treeFar);
    // Sonnenlicht vorberechnen: je Kachel beim Bau (Berge auf Täler), dazu die Karten von oben (Bäume, Häuser, Laternen)
    const sd = atmo.sunDir;
    const bake = (this.sunBake = new SunBake());
    bake.setSun(sd.x, sd.y, sd.z);
    world.field.sun = bake;
    const maps = (this.maps = new SunMaps(r, () => world.field.group));
    maps.setSun(sd);
    maps.sources.push(world.splats);
    const objects = (this.objects = new Objects());
    this.scene.add(objects.group);
    const particles = (this.particles = new Particles());
    this.scene.add(particles.mesh);
    // eigener Fahrer (volle Detailstufe) und der Vorrat an Gegnern (Teamtrikots; im Zeitfahren die Trikots der Geister)
    this.rider = new Rider(this.opts.kit, 1, 1, true);
    this.scene.add(this.rider.group);
    this.eng = this.makeEngine(0);
    const ghostKits = this.eng.opps.map((o) => o.kit);
    for (let i = 0; i < POOL; i++) {
      const R = new Rider(this.opts.tt ? ghostKits[i] ?? teamKit(i) : teamKit(i), 0, i * 7.31 + 3, false);
      R.group.visible = false;
      this.pool.push(R);
      this.poolFree.push(POOL - 1 - i);
      this.scene.add(R.group);
    }
    if (!this.opts.tt) {
      this.peloton = new Peloton(Math.max(64, FIELD + 60));
      this.scene.add(this.peloton.mesh);
    }

    const scenePass = (this.scenePass = pass(this.scene, this.camera, { samples: gpu ? this.settings.msaa : 0 }));
    // Kantenglättung auf den Kacheln der Grafikkarte: die vierfachen Proben nach dem Auflösen verwerfen statt in den
    // Speicher zu schreiben (sonst ~60 MB je Bild bei doppelter Auflösung), Tiefe wird nicht gebraucht
    const srt = scenePass.renderTarget as THREE.RenderTarget & { storeMultisampledColorBuffer?: boolean; storeMultisampledDepthBuffer?: boolean; resolveDepthBuffer?: boolean };
    srt.storeMultisampledColorBuffer = false;
    srt.storeMultisampledDepthBuffer = false;
    srt.resolveDepthBuffer = false;
    const color = scenePass.getTextureNode('output');
    for (const withBloom of [true, false]) {
      const pl = new THREE.RenderPipeline(r);
      pl.outputColorTransform = false;
      pl.outputNode = atmo.outputNode(color, withBloom);
      if (withBloom) this.pipeBloom = pl; else this.pipeFlat = pl;
    }

    // die ersten gut 1,1 km am Stück (danach baut die Fahrt selbst nach)
    this.stage = 'Landschaft';
    const z0 = this.eng.p.z;
    let lastLog = 0;
    for (;;) {
      if (this.disposed) return;
      const done = world.buildUpTo(z0, z0 + LOAD_AHEAD, performance.now() + 40);
      this.loadFrac = 0.12 + 0.6 * world.progressTo(z0 + LOAD_AHEAD);
      if (performance.now() - lastLog > 2000) { lastLog = performance.now(); log(`Welt bis ${Math.round(world.builtTo)} m, Bäume ${world.trees.count}`); }
      if (done) break;
      await new Promise((res) => setTimeout(res, 0));
    }
    log(`Welt: ${Math.round(world.builtTo)} m, ${world.trees.count} Bäume, ${world.houses.count} Häuser`);
    await step(0.74, 'Shader werden übersetzt');
    this.place(0);
    this.updateCamera(0);
    this.updateMaps(true);
    await this.warmup((f) => { this.loadFrac = 0.74 + 0.25 * f; });
    if (this.disposed) return;
    this.orderPunch();
    log('vorgewärmt');
    this.loadFrac = 1;
    this.ready = true;
    this.setDpr(this.dpr);
    this.lastBuilt = world.builtTo;
    this.opts.onReady?.();
  }

  /**
   * Vorwärmen: alles, was unterwegs ins Bild kommen kann, einmal übersetzen und hochladen – Welt (mit den Teilen
   * späterer Landschaften und einem Tunnel), Fahrer und Gegner, Dinge und Partikel, beide Bildketten.
   */
  private async warmup(progress: (f: number) => void) {
    const r = this.renderer;
    const world = this.world!;
    const kit = world.warmKit();
    this.scene.add(kit.group);
    const top = [...this.scene.children];
    const vis = top.map((o) => o.visible);
    for (const o of top) o.visible = false;
    this.draw(this.pipeBloom);
    this.draw(this.pipeFlat);
    top.forEach((o, i) => { o.visible = vis[i]; });
    const saved: [THREE.Object3D, boolean, boolean][] = [];
    this.scene.traverse((o) => { saved.push([o, o.visible, o.frustumCulled]); o.visible = true; o.frustumCulled = false; });
    world.warm(true);
    this.peloton?.warm(true);
    this.objects?.warm(true);
    this.particles?.warm(true);
    this.pool.forEach((R) => { R.far(0); R.lamp(true); R.ghost(0); });
    this.rider?.lamp(true);
    const rt = this.scenePass?.renderTarget ?? null;
    const prev = r.getRenderTarget();
    r.setRenderTarget(rt);
    try {
      await r.compileAsync(this.scene, this.camera, null, (e: ProgressEvent) => progress(0.8 * (e.loaded / Math.max(1, e.total))));
    } catch { /* dann beim ersten Bild */ }
    r.setRenderTarget(prev);
    if (this.disposed) return;
    // echte Bilder (beide Ketten); Gegner nah und fern, jeweils deckend und mit Raster (beide Materialien je Kit)
    const passes: [() => void, THREE.RenderPipeline | null][] = [
      [() => undefined, this.pipeBloom],
      [() => undefined, this.pipeFlat],
      [() => { for (const R of this.pool) R.ghost(0.5); }, this.pipeFlat],
      [() => { for (const R of this.pool) { R.far(1e4); R.lamp(false); } }, this.pipeFlat],
      [() => { for (const R of this.pool) R.ghost(0); }, this.pipeFlat],
    ];
    for (const [k, [set, pl]] of passes.entries()) {
      set();
      this.draw(pl);
      progress(0.85 + (k * 0.14) / passes.length);
      await new Promise((res) => setTimeout(res, 0));
      if (this.disposed) return;
    }
    for (const [o, v, f] of saved) { o.visible = v; o.frustumCulled = f; }
    kit.dispose();
    world.warm(false);
    this.objects?.warm(false);
    this.particles?.warm(false);
    this.rider?.lamp(false);
    for (const R of this.pool) R.group.visible = false;
    this.poolOf.clear();
    this.poolFree = this.pool.map((_, i) => this.pool.length - 1 - i);
    this.place(0);
    world.update(this.camera.position, this.rider!.group.position, true);
    progress(1);
  }

  // ------------------------------------------------------------------ Fahrt

  private makeEngine(cruise: number): Abfahrt | TimeTrial {
    const tt = this.opts.tt;
    if (tt) {
      const e = new TimeTrial({
        dayKey: this.opts.dayKey, names: this.opts.names, rider: tt.rider, kit: this.opts.kit, town: tt.town, ghosts: tt.ghosts, myBest: tt.myBest,
        onEvent: (ev) => tt.onEvent?.(ev), onOver: (res) => tt.onOver?.(res),
      });
      e.setViewport(this.host.clientWidth || window.innerWidth);
      return e;
    }
    const e = new Abfahrt({
      dayKey: this.opts.dayKey, names: this.opts.names, friends: [], kit: this.opts.kit, best: 0,
      missions: [], missionsDone: new Set(), tutorial: false, cruise: cruise || undefined,
      // keine Hindernisse, dafür Massenstürze (zu schnell aufs Hinterrad); ein ganzes Fahrerfeld
      pileups: true,
      field: FIELD,
      onEvent: (ev) => this.opts.onEvent?.(ev),
      onOver: (res) => this.opts.onOver?.(res),
    });
    e.setViewport(this.host.clientWidth || window.innerWidth);
    return e;
  }

  /** neue Fahrt: 0 = richtig (Hindernisse, Sturz), 2/3 = Testfahrt im Zeitraffer ohne Hindernisse */
  go(cruise = 0) {
    const e = this.eng;
    if (!e || e.phase !== 'ready' || cruise !== this.cruise) this.eng = this.makeEngine(cruise);
    this.cruise = cruise;
    for (const [, i] of this.poolOf) { this.pool[i].group.visible = false; this.poolFree.push(i); }
    this.poolOf.clear();
    this.cam.init = false;
    this.paused = false;
    this.resetDirector(e?.phase === 'ready' && cruise === this.cruise);
    this.rider?.model.resetCrash();
    this.eng!.start();
    this.perf.event(EV.phase, `Start${cruise ? ` Testfahrt ${cruise}×` : ''}`);
  }

  /** zurück an den Start (Startkarte) */
  toStart() {
    this.eng = this.makeEngine(this.cruise);
    for (const [, i] of this.poolOf) { this.pool[i].group.visible = false; this.poolFree.push(i); }
    this.poolOf.clear();
    this.resetDirector(false);
    this.cam.init = false;
    this.paused = false;
    this.rider?.model.resetCrash();
  }

  /** Regie zurück: keep = vom Startbild (Kran) aus weiterfliegen */
  private resetDirector(keep: boolean) {
    this.dolls.clear();
    this.tv = null;
    this.tvLast = -1;
    this.crashCam = null;
    this.swing = 0;
    if (!keep) { this.dirLast.ok = false; this.dirKind = 'intro'; this.dirT = 1; }
  }

  pointerDown(x: number, y: number) { if (!this.autopilot) this.eng?.pointerDown(x, y); }
  pointerMove(x: number, y: number) { if (!this.autopilot) this.eng?.pointerMove(x, y); }
  pointerUp() { this.eng?.pointerUp(); }
  key(name: 'left' | 'right' | 'up' | 'down', down: boolean) { if (!this.autopilot) this.eng?.key(name, down); }
  hud(): HudState | TtHud | null { return this.eng?.hud() ?? null; }
  /** Testfahrt: Zeitraffer, Stehenbleiben (Prüfpult wie im Spiel) */
  get dbg() { return this.eng instanceof Abfahrt ? this.eng.dbg : null; }

  /** Namensschilder (Zeitfahren: der nächste Geist voraus) mit Bildschirmlage – die Seite setzt sie als Elemente */
  tags(): TagView[] {
    const e = this.eng;
    if (!e || !('tags' in e) || !e.tags.length || this.free) return [];
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    const out: TagView[] = [];
    for (const tg of e.tags) {
      const i = this.poolOf.get(tg.id);
      if (i === undefined || !this.pool[i].group.visible) continue;
      const g = this.pool[i].group;
      this.screenPos.set(g.position.x, g.position.y + 1.95, g.position.z).project(this.camera);
      if (this.screenPos.z > 1 || Math.abs(this.screenPos.x) > 1.2) continue;
      const d = this.camera.position.distanceTo(g.position);
      out.push({ id: tg.id, text: tg.text, sub: tg.sub ?? '', color: tg.color ?? '#fff', x: (this.screenPos.x * 0.5 + 0.5) * w, y: (0.5 - this.screenPos.y * 0.5) * h, k: clamp(14 / Math.max(6, d), 0.55, 1) });
    }
    return out;
  }

  /** Autopilot: Ideallinie (Krümmung voraus), Hindernissen ausweichen, Flaschen mitnehmen, auf Geraden ducken */
  private steerAuto() {
    const e = this.eng!;
    const t = e.track;
    const p = e.p;
    const curveAt = (z: number) => {
      const i0 = Math.floor(z / SEG);
      let s = 0;
      for (let j = -6; j <= 6; j++) s += t.seg(Math.max(0, i0 + j)).curve * (7 - Math.abs(j));
      return s / 49;
    };
    let tx = 0, wsum = 0;
    for (let j = -10; j <= 10; j += 2) { const ww = 11 - Math.abs(j); tx += clamp(curveAt(p.z + 5 + j * SEG) * 38, -1.5, 1.5) * ww; wsum += ww; }
    tx /= wsum;
    // Flaschen in der Nähe der Linie: hin
    const i0 = Math.floor(p.z / SEG), i1 = Math.floor((p.z + 26) / SEG);
    for (let i = i0; i <= i1; i++) {
      const s = t.seg(i);
      if (!s.objs) continue;
      for (const o of s.objs) if (!o.done && (o.k === 'bidon' || o.k === 'gold') && o.z > p.z + 2 && Math.abs(o.x - tx) < 1.6) tx = o.x;
    }
    // Hindernisse auf der Linie: daneben
    for (let i = i0; i <= i1 + 4; i++) {
      const s = t.seg(i);
      if (!s.objs) continue;
      for (const o of s.objs) {
        if (o.done || !HAZ.has(o.k) || o.z < p.z) continue;
        const need = o.r + 0.75;
        if (Math.abs((o.x + (o.vx ?? 0) * 0.6) - tx) < need) tx = o.x + (o.x > 0 ? -need - 0.2 : need + 0.2);
      }
    }
    for (const o of e.opps) {
      const dz = o.z - p.z;
      if (dz < 0.4 || dz > 16) continue;
      if (Math.abs(o.x - tx) < 1.05 && p.v > o.v - 0.6) tx = o.x + (o.x > tx ? -1.3 : 1.3);
    }
    const hw = ROAD_HALF + e.track.extraAt(e.p.z);
    e.tx = clamp(tx, -hw + 0.45, hw - 0.45);
    e.key('up', Math.abs(curveAt(p.z + 10)) < 0.006 && p.v > 11);
  }

  /** Rücklicht: nachts, bei Regen und im Tunnel */
  private lampLevel(): number { return clamp(MOOD_U.night.value + MOOD_U.rain.value * 0.6 + this.tunnelK, 0, 1); }

  /** Spiel einen Schritt weiter, Fahrer auf die Strecke */
  private place(dt: number) {
    const e = this.eng!;
    if (dt > 0) {
      if (this.autopilot && e.phase === 'playing') this.steerAuto();
      e.update(dt);
    }
    const t = e.track;
    const p = e.p;
    const roadY = t.heightAt(p.z);
    const air = Math.max(0, p.y - roadY);
    t.world(p.z, p.x, 0, this.w);
    const R = this.rider!;
    R.group.position.set(this.w.x, this.w.y + air, this.w.z);
    R.group.rotation.y = -this.w.th;
    const light = this.lampLevel();
    if ((light > 0.05) !== this.lampOn) { this.lampOn = light > 0.05; this.perf.event(EV.vis, this.lampOn ? 'Rücklichter an' : 'Rücklichter aus'); }
    const wk = this.wreck;
    R.blob(!wk);
    if (wk) this.ragdoll(-1, R, wk, dt);
    else if (e.phase === 'crash' || e.phase === 'over') R.model.crash(e.phaseT, e.crashSpin);
    else {
      R.model.resetCrash();
      R.pose({
        lean: p.lean, pedal: p.pedal, tuck: p.tuck, brake: p.brake, stand: p.stand ?? 0, sprint: 0,
        v: p.v, air, surface: t.segAt(p.z).surface, wobble: p.wobble, light, roll: p.z / 0.34,
      }, dt, this.time);
    }
    R.lamp(light > 0.05);
    this.placeOpps(dt, light);
  }

  /** Darstellung je Gegner mit vollem Modell: nah (Modell) seit t; Anteil des einfachen Modells (0 … 1) */
  private pelLod = new Map<number, { near: boolean; t: number }>();
  /** d: Abstand zur Kamera (neu entscheiden) oder −1 (nur den Anteil lesen) */
  private pelShare(id: number, d: number): number {
    const now = performance.now() / 1000;
    let s = this.pelLod.get(id);
    if (!s) { s = { near: d >= 0 && d < (PEL_FADE[0] + PEL_FADE[1]) / 2, t: -1e9 }; this.pelLod.set(id, s); }
    if (d >= 0) {
      if (!s.near && d < PEL_FADE[0]) { s.near = true; s.t = now; } else if (s.near && d > PEL_FADE[1]) { s.near = false; s.t = now; }
    }
    const u = Math.max(0, Math.min(1, (now - s.t) / PEL_T));
    return s.near ? 1 - u : u;
  }

  /** Gegner: die nächsten (höchstens so viele wie eingestellt) bekommen ein Modell aus dem Vorrat */
  private placeOpps(dt: number, light: number) {
    const e = this.eng!;
    const t = e.track;
    const p = e.p;
    // mit Fahrerfeld: alle in der Nähe als volles Modell (das einfache sieht nur von weitem gut aus)
    const max = Math.min(POOL, Math.round(this.peloton ? Math.max(this.settings.oppMax, 14) : this.settings.oppMax));
    // Geister (Zeitfahren) erst, wenn sie eingeblendet sind (vor dem Start steht der Fahrer allein auf der Rampe)
    // mit Fahrerfeld (Instanzen für die übrigen): volles Modell nur für die Nächsten in ~25 m (dort sieht man Details)
    const near = this.peloton ? PEL_FADE[1] + 4 : 300;
    const list = e.opps.filter((o) => o.z > p.z - Math.min(40, near) && o.z < p.z + near && !('ghost' in o && (o as { ghost: number }).ghost <= 0)).sort((a, b) => Math.abs(a.z - p.z) - Math.abs(b.z - p.z)).slice(0, max);
    const keep = new Set(list.map((o) => o.id));
    for (const [id, i] of this.poolOf) {
      if (keep.has(id)) continue;
      this.pool[i].group.visible = false;
      this.poolOf.delete(id);
      this.poolFree.push(i);
      this.pelLod.delete(id);
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
      const ghost = 'ghost' in o ? (o as { ghost: number }).ghost : 0;
      // mit Fahrerfeld: einmal ins volle Modell und zurück (mit Spielraum), dabei kurz überblenden (Raster)
      const fade = this.peloton ? this.pelShare(o.id, d) : 0;
      R.ghost(ghost > 0 ? 1 - ghost : fade);
      R.shadows(d < 45 && ghost <= 0);
      R.blob(!o.wreck);
      if (o.wreck) this.ragdoll(o.id, R, o.wreck, dt);
      else {
        R.model.resetCrash();
        R.pose({
          lean: o.lean, pedal: o.pedal, tuck: o.tuck, brake: o.brake, stand: o.stand ?? 0, sprint: 0,
          v: o.v, air: 0, surface: t.segAt(o.z).surface, wobble: o.bump, light, roll: o.z / 0.34,
        }, dt, this.time);
      }
      R.lamp(light > 0.05);
    }
    // alle übrigen (das Feld voraus und hinter dir) als Instanzen
    const pel = this.peloton;
    if (pel) {
      pel.begin();
      for (const o of e.opps) {
        if (o.z < p.z - 160 || o.z > p.z + 950) continue;
        t.world(o.z, o.x, 0, this.w);
        // mit vollem Modell: nur sein Anteil (beim Wechsel), sonst gar nicht
        const pooled = this.poolOf.has(o.id);
        const share = pooled ? this.pelShare(o.id, -1) : 1;
        if (pooled && share < 0.01) continue;
        const down = !!o.wreck;
        pel.add(this.w.x, this.w.y, this.w.z, this.w.th, down ? (o.x > 0 ? 1.45 : -1.45) : o.lean, o.pedal, o.kit, down, pooled, share);
      }
      pel.commit();
    }
  }

  // ------------------------------------------------------------------ Ragdolls

  /** Körper der Gestürzten (Schlüssel: Gegner-Nummer, −1 = du) mit ihrem Boden */
  private dolls = new Map<number, { d: Ragdoll; g: Ground }>();
  private dollBuf = new Float32Array(JOINTS * 3);
  private gw = { x: 0, y: 0, z: 0, th: 0 };

  /**
   * Sturz darstellen: das Rad nach wreck.ts (kippt, schlittert), der Körper als Ragdoll – beim ersten Bild aus der
   * Fahrhaltung gestartet, danach frei mit Schwerkraft, Aufprall und Reibung, im Takt der Zeitlupe des Spiels
   */
  private ragdoll(key: number, R: Rider, w: Wreck, dt: number) {
    const e = this.eng!;
    const t = e.track;
    let D = this.dolls.get(key);
    if (!D) {
      // Fahrhaltung des letzten Bilds (die Knochen stehen noch so) als Start
      R.model.ragdollJoints(this.dollBuf);
      t.world(w.z0, w.x0, 0, this.gw);
      const th = this.gw.th;
      const fx = Math.sin(th), fz = -Math.cos(th);
      const grade = t.segAt(w.z0).grade;
      const v = w.v0;
      const d = new Ragdoll(this.dollBuf, [fx * v, grade * v, fz * v], [fx, fz], clamp((v - 3) / 14, 0.25, 1), w.side, w.seed);
      // Boden: Straßenhöhe entlang der Fahrtrichtung vom Sturzort aus (die paar Meter Rutschen)
      t.world(w.z0, 0, 0, this.gw);
      const ox = this.gw.x, oz = this.gw.z;
      const g: Ground = (x, z) => t.heightAt(Math.max(0, w.z0 + (x - ox) * fx + (z - oz) * fz));
      D = { d, g };
      this.dolls.set(key, D);
    }
    R.model.crashPose(wreckPose(w));
    const scale = e instanceof Abfahrt ? e.timeScale : 1;
    const others: Ragdoll[] = [];
    for (const x of this.dolls.values()) others.push(x.d);
    D.d.step(dt * scale, D.g, others);
    R.model.ragdollPose(D.d.p);
  }

  /** wie tief im Tunnel (m bis zum nächsten Portal; 0 draußen) */
  private tunnelDepth(z: number): number {
    const t = this.track!;
    const i = Math.max(0, Math.floor(z / SEG));
    if (!t.seg(i).tunnel) return 0;
    let a = i, b = i;
    while (a > i - 60 && a > 0 && t.seg(a - 1).tunnel) a--;
    while (b < i + 60 && t.seg(b + 1).tunnel) b++;
    return Math.max(0, Math.min(z - a * SEG, (b + 1) * SEG - z));
  }

  // ------------------------------------------------------------------ Kamera

  private poseA = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 };
  private poseB = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 };

  private camPose(mode: RaceCam, out: { pos: THREE.Vector3; look: THREE.Vector3; fov: number }, dt: number) {
    const e = this.eng!;
    const t = e.track;
    const p = e.p;
    const w = this.w;
    const roadY = t.heightAt(p.z);
    const air = Math.max(0, p.y - roadY);
    t.world(p.z, p.x, 0, w);
    const rx = w.x, ry = w.y, rz = w.z;
    const aspect = this.camera.aspect;
    const portrait = aspect < 1;
    const fx = Math.sin(this.cam.th), fz = -Math.cos(this.cam.th);
    const sx = Math.cos(this.cam.th), sz = Math.sin(this.cam.th);
    switch (mode) {
      case 'chase': {
        // wie im Spiel: geglättete Fahrtrichtung, 6,2 m dahinter, 2,75 m hoch, Blick 15 m voraus
        const behindY = t.heightAt(Math.max(0, p.z - CAM_BACK));
        const ty = Math.max(behindY, roadY) + CAM_UP + air * 0.35;
        if (!this.cam.init || e.phase === 'ready' || e.phase === 'countdown') this.cam.y = ty;
        this.cam.y += (ty - this.cam.y) * Math.min(1, dt * 7);
        this.cam.y = Math.max(this.cam.y, roadY + 1.2);
        const sh = e.shake * 0.04;
        // in Kurven schwingt die Kamera nach außen (wie ein Motorrad mit Kameramann), auf Geraden zurück hinters Rad
        const sw = this.swing;
        out.pos.set(rx - fx * CAM_BACK + sx * sw + (Math.random() - 0.5) * sh, this.cam.y + (Math.random() - 0.5) * sh, rz - fz * CAM_BACK + sz * sw);
        // nie im Hang: über dem Gelände bleiben und den Fahrer frei sehen (weich anheben, langsam wieder senken)
        // (nicht im Tunnel und an seinen Portalen: dort liegt der Berg über der Straße)
        if (!this.nearTunnel(p.z)) {
          const need = this.needLift(out.pos.x, out.pos.y, out.pos.z, rx, ry + 1.1 + air, rz, 1.1, 6);
          if (dt > 0) this.chaseLift += (need - this.chaseLift) * Math.min(1, dt * (need > this.chaseLift ? 9 : 1.4));
          const floor = Math.max(0, this.hAt(out.pos.x, out.pos.z) + 0.9 - out.pos.y);
          out.pos.y += Math.max(this.chaseLift, floor);
        } else if (dt > 0) this.chaseLift *= Math.max(0, 1 - dt * 3);
        const aheadY = t.heightAt(p.z + 15);
        out.look.set(rx + fx * 15, roadY + (aheadY - roadY) * 0.55 + 0.9 + air * 0.4, rz + fz * 15);
        out.fov = (portrait ? 72 - (aspect - 0.45) * 22 : 56) + Math.min(9, Math.max(0, (p.v - 14) * 0.38));
        break;
      }
      case 'low': {
        const back = 3.4;
        const by = t.heightAt(Math.max(0, p.z - back));
        out.pos.set(rx - fx * back + sx * 0.6, Math.max(by, ry) + 0.55 + air, rz - fz * back + sz * 0.6);
        out.look.set(rx + fx * 6, ry + 0.9 + air, rz + fz * 6);
        out.fov = portrait ? 74 : 60;
        break;
      }
      case 'side': {
        t.world(p.z + 9, this.sideSign * (EDGE + t.extraAt(p.z + 9) + 2.5), 0, w);
        out.pos.set(w.x, Math.max(w.y, t.heightAt(p.z + 9)) + 1.45, w.z);
        out.look.set(rx, ry + 1.0 + air, rz);
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

  private updateCamera(dt: number) {
    if (this.free) {
      const f = this.free;
      const a = (f.az * Math.PI) / 180, el = (f.el * Math.PI) / 180;
      this.camera.position.set(f.at.x + Math.sin(a) * Math.cos(el) * f.dist, f.at.y + Math.sin(el) * f.dist, f.at.z + Math.cos(a) * Math.cos(el) * f.dist);
      this.camera.lookAt(f.at);
      return;
    }
    const e = this.eng!;
    const p = e.p;
    e.track.world(p.z, p.x, 0, this.w);
    // Zeitfahren, vor dem Start: die Kamera kreist langsam um den Fahrer auf der Rampe (Intro); mit dem Countdown
    // blendet sie in die Fahrkamera
    // … und nach dem Ziel kreist sie um den ausrollenden Fahrer (Zieleinlauf)
    if (this.opts.tt && e.phase === 'over') {
      this.introT += dt;
      const R = this.rider!.group.position;
      const a = this.w.th + Math.PI * 0.35 + this.introT * 0.09;
      this.camera.position.set(R.x + Math.sin(a) * 9, R.y + 2.6, R.z + Math.cos(a) * 9);
      this.camera.lookAt(R.x, R.y + 0.9, R.z);
      if (this.camera.fov !== 40) { this.camera.fov = 40; this.cam.fov = 40; this.camera.updateProjectionMatrix(); }
      this.cam.init = false;
      return;
    }
    if (this.opts.tt && e.phase === 'ready') {
      this.introT += dt;
      // auf der Straße vor dem Fahrer (dort steht nichts im Weg), langsam von der einen Seite zur anderen
      const R = this.rider!.group.position;
      const side = Math.sin(this.introT * 0.16) * 2.1;
      e.track.world(p.z + 6.5 - Math.cos(this.introT * 0.16) * 0.8, side, 0, this.w);
      this.camera.position.set(this.w.x, Math.max(this.w.y, R.y) + 1.35 + Math.sin(this.introT * 0.3) * 0.15, this.w.z);
      this.camera.lookAt(R.x, R.y + 1.05, R.z);
      if (this.camera.fov !== 44) { this.camera.fov = 44; this.cam.fov = 44; this.camera.updateProjectionMatrix(); }
      this.cam.init = false;
      return;
    }
    const yaw = this.w.th + Math.atan2(p.vx, Math.max(5, p.v)) * 0.3;
    const still = !this.cam.init || e.phase === 'ready' || e.phase === 'countdown';
    if (still) { this.cam.th = yaw; this.camFrom = null; this.camBlend = 1; }
    const th0 = this.cam.th;
    this.cam.th += angDiff(yaw, this.cam.th) * Math.min(1, dt * 6);
    // Schwung nach außen: aus der Drehgeschwindigkeit der Fahrtrichtung (rechts herum → Kamera nach links)
    const omega = dt > 0 ? angDiff(this.cam.th, th0) / dt : 0;
    const swingT = still || e.phase !== 'playing' ? 0 : clamp(-omega * Math.min(1, p.v / 14) * 2.4, -1.7, 1.7);
    this.swing += (swingT - this.swing) * Math.min(1, dt * 1.6);
    const A = this.poseA;
    this.camPose(this._cam, A, dt);
    if (this.camFrom && this.camBlend < 1) {
      this.camBlend = Math.min(1, this.camBlend + dt / 0.7);
      const B = this.poseB;
      this.camPose(this.camFrom, B, 0);
      const u = this.camBlend;
      const k = u * u * u * (u * (u * 6 - 15) + 10);
      A.pos.lerpVectors(B.pos, A.pos, k);
      A.look.lerpVectors(B.look, A.look, k);
      A.fov = B.fov + (A.fov - B.fov) * k;
      if (this.camBlend >= 1) this.camFrom = null;
    }
    // Regie (nur Verfolger-Kamera): TV-Kran am Start, TV-Kameras an Spitzkehren, Sturz aus der Fernsehperspektive
    if (this._cam === 'chase') this.direct(A, dt);
    this.cam.init = true;
    this.camera.position.copy(A.pos);
    this.camera.lookAt(A.look);
    // leicht in die Kurve legen (Motorradkamera)
    if (this.dirKind === 'chase' && this._cam === 'chase') this.camera.rotateZ(clamp(p.lean, -0.7, 0.7) * 0.07 * (1 - (this.dirT < 1 ? 1 - this.dirT : 0)));
    // Sichtfeld weich (Tempo); bei Regiewechseln folgt es direkt der Überblendung
    const direct = this.dirKind !== 'chase' || this.dirT < 1;
    this.cam.fov += (A.fov - this.cam.fov) * (direct ? 1 : Math.min(1, dt > 0 ? dt * 2 : 1));
    if (Math.abs(this.camera.fov - this.cam.fov) > 0.01) { this.camera.fov = this.cam.fov; this.camera.updateProjectionMatrix(); }
  }

  // ------------------------------------------------------------------ Regie

  /** eigener Sturz im Massensturz (nur Abfahrt) */
  private get wreck() { const e = this.eng; return e instanceof Abfahrt ? e.wreck : null; }

  private dirKind: 'intro' | 'chase' | 'tv' | 'crash' = 'intro';
  private dirFrom = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 };
  private dirLast = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60, ok: false };
  private dirT = 1;
  private dirDur = 1;
  private dirPose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 };
  private lookS = new THREE.Vector3();
  private lookOk = false;
  private swing = 0;
  private chaseLift = 0;
  private camDir = new THREE.Vector3();
  /** Zeit (s) seit dem Ende der letzten TV-Einstellung */
  private tvCool = 99;
  /** Zusatzbogen des laufenden Kameraflugs (m), damit er nicht durch Hang oder Bäume geht */
  private flyArc = 0;
  private flyLift = 0;
  /** TV-Kamera an einer Spitzkehre: Abschnitte der Kehre (von, bis) und Standort */
  private tv: { a: number; b: number; pos: THREE.Vector3; obs: Obstacle[]; hidden: number } | null = null;
  private tvR = new THREE.Vector3();
  private tvLast = -1;
  private crashCam: THREE.Vector3 | null = null;
  private tvV = { x: 0, y: 0, z: 0, th: 0 };

  /** Regie: welche Einstellung jetzt – und weich (geflogen) von der letzten hinüber */
  private direct(A: { pos: THREE.Vector3; look: THREE.Vector3; fov: number }, dt: number) {
    const e = this.eng!;
    this.tvCool += dt > 0 ? dt : 0;
    let want: 'intro' | 'chase' | 'tv' | 'crash' = 'chase';
    if (e.phase === 'ready') want = 'intro';
    else if (this.wreck) want = 'crash';
    else if (e.phase === 'playing' && this.tvShot()) want = 'tv';
    if (!this.dirLast.ok) { this.dirKind = want; this.dirT = 1; }
    if (want !== this.dirKind) {
      // vom aktuellen Bild aus hinüberfliegen
      this.dirFrom.pos.copy(this.dirLast.pos);
      this.dirFrom.look.copy(this.dirLast.look);
      this.dirFrom.fov = this.dirLast.fov;
      // Flüge zur TV-Kamera und zurück lang und weich (früh beginnen statt spät hinüberreißen)
      this.dirDur = this.dirKind === 'intro' ? 2.7 : want === 'tv' ? 2.3 : want === 'crash' ? 0.9 : this.dirKind === 'tv' ? 1.4 : 0.95;
      this.dirKind = want;
      this.dirT = 0;
      this.flyArc = -1;
      this.flyLift = 0;
      this.lookOk = false;
      if (want !== 'crash') this.crashCam = null;
    }
    const D = this.dirPose;
    if (this.dirKind === 'chase') { D.pos.copy(A.pos); D.look.copy(A.look); D.fov = A.fov; } else this.shotPose(this.dirKind, D, dt);
    if (this.dirT < 1) {
      const F = this.dirFrom;
      const span = F.pos.distanceTo(D.pos);
      const base = Math.min(6, span * 0.18);
      const tun = this.nearTunnel(e.p.z);
      if (this.flyArc < 0 && tun) this.flyArc = 0;
      if (this.flyArc < 0) {
        // Bogen so hoch, dass der Flug über Hang und Bäume geht (Gelände entlang der Bahn geprüft)
        let arc = 0;
        for (let i = 1; i < 12; i++) {
          const k = i / 12;
          const s = Math.sin(Math.PI * k);
          const x = F.pos.x + (D.pos.x - F.pos.x) * k, z = F.pos.z + (D.pos.z - F.pos.z) * k;
          const y = F.pos.y + (D.pos.y - F.pos.y) * k + s * base;
          const h = this.hAt(x, z) + 2.2;
          if (h > y) arc = Math.max(arc, (h - y) / Math.max(0.3, s));
        }
        this.flyArc = Math.min(arc, 30);
      }
      this.dirT = Math.min(1, this.dirT + (dt > 0 ? dt : 0) / this.dirDur);
      const u = this.dirT;
      const k = u * u * u * (u * (u * 6 - 15) + 10);
      A.pos.lerpVectors(F.pos, D.pos, k);
      // im Bogen fliegen (nicht durch den Hang)
      A.pos.y += Math.sin(Math.PI * k) * (base + this.flyArc);
      if (!tun) {
        // freie Sicht auf den Fahrer auch unterwegs (der Bogen hebt sich weich, wenn ein Grat dazwischen kommt)
        const R = this.riderAt(this.tvR, 1.0);
        const need = this.needLift(A.pos.x, A.pos.y, A.pos.z, R.x, R.y, R.z, 1.0, 8) * Math.sin(Math.PI * Math.min(1, k * 1.15));
        this.flyLift += (need - this.flyLift) * Math.min(1, (dt > 0 ? dt : 0) * (need > this.flyLift ? 5 : 2));
        A.pos.y += this.flyLift;
      }
      A.look.lerpVectors(F.look, D.look, k);
      // unterwegs den Fahrer im Bild behalten (sonst schaut die Kamera in der Mitte des Flugs auf den Asphalt)
      if (this.dirKind !== 'intro') A.look.lerp(this.riderAt(this.tvR, 1.0), Math.sin(Math.PI * k) * 0.85);
      A.fov = F.fov + (D.fov - F.fov) * k;
    } else {
      A.pos.copy(D.pos);
      A.look.copy(D.look);
      A.fov = D.fov;
    }
    this.dirLast.pos.copy(A.pos);
    this.dirLast.look.copy(A.look);
    this.dirLast.fov = A.fov;
    this.dirLast.ok = true;
  }

  /** Ort des Fahrers in der Welt (Körpermitte) */
  private riderAt(out: THREE.Vector3, up = 1.0): THREE.Vector3 {
    const e = this.eng!;
    e.track.world(e.p.z, e.p.x, 0, this.tvV);
    return out.set(this.tvV.x, this.tvV.y + up, this.tvV.z);
  }

  /** Blick weich auf den Fahrer (die TV-Kamera schwenkt mit wie ein Kameramann) */
  private follow(target: THREE.Vector3, dt: number): THREE.Vector3 {
    if (!this.lookOk) { this.lookS.copy(target); this.lookOk = true; }
    this.lookS.lerp(target, dt > 0 ? Math.min(1, dt * 5) : 1);
    return this.lookS;
  }

  private groundY(x: number, z: number): number {
    try { return this.terrain?.groundAt(x, z) ?? -Infinity; } catch { return -Infinity; }
  }

  /** Tunnel im Bereich hinter bis kurz vor dem Fahrer (dort keine Geländeprüfung der Kamera) */
  private nearTunnel(z: number): boolean {
    const t = this.eng!.track;
    const i0 = Math.max(t.first, Math.floor((z - CAM_BACK - 14) / SEG)), i1 = Math.floor((z + 16) / SEG);
    for (let i = i0; i <= i1; i++) if (t.seg(i).tunnel) return true;
    return false;
  }

  /** Höhe des gezeigten Geländes (schnell: aus den Höhengittern der gebauten Kacheln; sonst die volle Rechnung) */
  private hAt(x: number, z: number): number {
    const h = this.sunBake ? this.sunBake.height(x, z) : NaN;
    return Number.isFinite(h) ? h : this.groundY(x, z);
  }

  /**
   * Wie viel muss die Kamera höher, damit sie über dem Gelände steht (mind. up) und das Ziel frei sieht?
   * Gelände entlang der Sichtlinie (n Proben); obs: zusätzlich Bäume und Häuser als Zylinder.
   */
  private needLift(px: number, py: number, pz: number, tx: number, ty: number, tz: number, up: number, n = 10, obs: Obstacle[] | null = null): number {
    let need = Math.max(0, this.hAt(px, pz) + up - py);
    for (let i = 1; i < n; i++) {
      const k = i / n;
      const x = px + (tx - px) * k, z = pz + (tz - pz) * k;
      const y = py + need + (ty - py - need) * k;
      const h = this.hAt(x, z) + 0.6;
      // Lift wirkt am Ziel nicht, an der Kamera voll: (1 - k)
      if (h > y) need += (h - y) / (1 - k);
    }
    if (obs) for (const o of obs) {
      // nächster Punkt der Sichtlinie (Draufsicht) zum Stamm
      const dx = tx - px, dz = tz - pz;
      const L2 = dx * dx + dz * dz || 1;
      const k = clamp(((o.x - px) * dx + (o.z - pz) * dz) / L2, 0, 1);
      if (k > 0.97) continue;
      const qx = px + dx * k - o.x, qz = pz + dz * k - o.z;
      if (qx * qx + qz * qz > o.r * o.r) continue;
      const y = py + need + (ty - py - need) * k;
      if (o.top > y) need += (o.top - y + 0.5) / (1 - k);
    }
    return Math.min(need, 40);
  }

  /** Bäume und Häuser in einem Rechteck als Hindernisse (für die Wahl der TV-Kamera) */
  private obstacles(x0: number, z0: number, x1: number, z1: number): Obstacle[] {
    const out: Obstacle[] = [];
    this.world?.splats(x0, z0, x1, z1, (x, z, h, r) => { out.push({ x, z, r: r * 0.85, top: this.hAt(x, z) + h }); }, () => {});
    return out;
  }

  private shotPose(kind: 'intro' | 'tv' | 'crash', out: { pos: THREE.Vector3; look: THREE.Vector3; fov: number }, dt: number) {
    const e = this.eng!;
    const t = e.track;
    const R = this.riderAt(new THREE.Vector3(), 1.0);
    const portrait = this.camera.aspect < 1;
    if (kind === 'intro') {
      // TV-Kran vor dem Start: schwenkt langsam vor dem Feld hin und her, Blick auf dich
      t.world(e.p.z, 0, 0, this.tvV);
      const th = this.tvV.th;
      // vor dem Feld, leicht seitlich (über der Straße), schwenkt langsam hin und her; Blick zurück auf dich
      const ang = (e.p.x > 0 ? -1 : 1) * (0.3 + 0.22 * Math.sin(this.time * 0.17));
      const fx = Math.sin(th + ang), fz = -Math.cos(th + ang);
      const r = 9.5;
      const x = R.x + fx * r, z = R.z + fz * r;
      const y = Math.max(R.y + 2.6 + 0.4 * Math.sin(this.time * 0.11), this.groundY(x, z) + 1.8);
      out.pos.set(x, y, z);
      out.look.copy(R).add(new THREE.Vector3(-Math.sin(th) * 3, -0.2, Math.cos(th) * 3));
      out.fov = portrait ? 50 : 38;
      return;
    }
    if (kind === 'tv' && this.tv) {
      out.pos.copy(this.tv.pos);
      out.look.copy(this.follow(R, dt));
      const d = out.pos.distanceTo(R);
      out.fov = clamp((2 * Math.atan((portrait ? 7.5 : 5.5) / d) * 180) / Math.PI, 18, portrait ? 62 : 50);
      return;
    }
    // Sturz: Fernsehbild vom Straßenrand hinter dem Sturz, Blick die Straße hinunter auf den Haufen – die
    // Nachfolgenden fahren an der Kamera vorbei hinein; langsam näher heran (hinten ist die Welt schon abgebaut)
    if (!this.crashCam) {
      const at = (e instanceof Abfahrt ? e.pileAt : null) ?? { z: e.p.z, x: e.p.x };
      const pref = at.x > 0 ? -1 : 1;
      // Standort am Rand hinter dem Sturz: nicht in einem Baum oder Haus und mit freier Sicht auf den Haufen
      t.world(at.z, at.x, 0, this.tvV);
      const tx = this.tvV.x, ty = this.tvV.y + 0.5, tz = this.tvV.z;
      const obs = this.obstacles(tx - 30, tz - 30, tx + 30, tz + 30);
      let best: THREE.Vector3 | null = null;
      for (const [side, back, up] of [[pref, 9, 2.3], [-pref, 9, 2.3], [pref, 14, 3.2], [-pref, 14, 3.2], [pref, 6, 4.5]] as const) {
        const cz = Math.max(0, at.z - back);
        t.world(cz, side * (EDGE + t.extraAt(cz) + 1.8), 0, this.tvV);
        const y = Math.max(t.heightAt(cz) + up, this.hAt(this.tvV.x, this.tvV.z) + 1.6);
        const inTree = obs.some((o) => (o.x - this.tvV.x) ** 2 + (o.z - this.tvV.z) ** 2 < (o.r + 0.8) ** 2 && y < o.top + 1);
        const cand = new THREE.Vector3(this.tvV.x, y, this.tvV.z);
        best ??= cand;
        if (!inTree && this.needLift(cand.x, cand.y, cand.z, tx, ty, tz, 0, 8, obs) < 0.3) { best = cand; break; }
      }
      this.crashCam = best;
    }
    out.pos.copy(this.crashCam!);
    const L = this.riderAt(new THREE.Vector3(), 0.45);
    out.look.copy(this.follow(L, dt));
    const d = out.pos.distanceTo(L);
    const push = clamp(e.phaseT / 4, 0, 1);
    out.fov = clamp((2 * Math.atan(((portrait ? 9 : 6.5) - 2 * push) / d) * 180) / Math.PI, 16, 60);
  }

  /**
   * Spitzkehre voraus? Dann steht dort eine TV-Kamera außen am Scheitel (erhöht), vor der Kehre fliegt die Kamera
   * hinüber, nach der Kehre zurück hinters Rad. Nicht im Tunnel, nicht zweimal dieselbe Kehre.
   */
  private tvShot(): boolean {
    const e = this.eng!;
    const t = e.track;
    const z = e.p.z;
    if (this.tv) {
      const tv = this.tv;
      if (z < tv.b * SEG + 12) {
        if (z < tv.a * SEG - TV_LEAD) return false;
        // läuft: verdeckt der Hang (oder ein Baum) den Fahrer, gleich zurück hinters Rad statt ins Leere zu filmen
        // … auch etwas voraus (wo der Fahrer in einer knappen Sekunde ist): rechtzeitig zurückfliegen, solange
        // die Kamera ihn noch sieht
        if (this.dirKind === 'tv' && this.dirT >= 1) {
          const P = tv.pos;
          const R = this.riderAt(this.tvR, 1.0);
          let hid = this.needLift(P.x, P.y, P.z, R.x, R.y, R.z, 0, 8, tv.obs) > 0.3;
          if (!hid) {
            t.world(z + Math.max(4, e.p.v * 0.9), e.p.x, 0, this.tvV);
            hid = this.needLift(P.x, P.y, P.z, this.tvV.x, this.tvV.y + 1, this.tvV.z, 0, 8, tv.obs) > 0.3;
          }
          tv.hidden = hid ? tv.hidden + 1 : 0;
          if (tv.hidden > 2) { this.tv = null; this.tvCool = 0; return false; }
        }
        return true;
      }
      this.tv = null;
      this.tvCool = 0;
      return false;
    }
    // nach einer TV-Einstellung erst ganz zurück hinters Rad und kurz dort bleiben (kein Hin und Her)
    if (this.dirKind !== 'chase' || this.dirT < 1 || this.tvCool < 1.2) return false;
    const i0 = Math.floor(z / SEG);
    for (let i = i0; i < i0 + Math.ceil((TV_LEAD + 50) / SEG); i++) {
      const s = t.seg(i);
      if (!(s.hairpin > 0) || i <= this.tvLast) continue;
      let a = i;
      while (a > i0 && t.seg(a - 1).hairpin > 0) a--;
      let b = i;
      while (b < i + 40 && t.seg(b + 1).hairpin > 0) b++;
      this.tvLast = b;
      let tunnel = false;
      let m = a, km = 0;
      for (let k = a; k <= b; k++) { const q = t.seg(k); if (q.tunnel) tunnel = true; if (Math.abs(q.curve) > km) { km = Math.abs(q.curve); m = k; } }
      // zu spät (schon fast in der Kehre): auslassen statt mitten hinein zu fliegen
      if (tunnel || b - a < 2 || z > a * SEG - 30) return false;
      const w = this.tvV;
      t.world(m * SEG + SEG / 2, 0, 0, w);
      const ax = w.x, ay = w.y, az = w.z;
      t.world(a * SEG - 20, 0, 0, w);
      const bx = w.x, bz = w.z;
      t.world(b * SEG + 20, 0, 0, w);
      let ox = ax - (bx + w.x) / 2, oz = az - (bz + w.z) / 2;
      const len = Math.hypot(ox, oz);
      if (len < 1) return false;
      ox /= len; oz /= len;
      // Punkte auf der Kehre, die die Kamera sehen soll (Anfahrt, Scheitel, Ausfahrt)
      const look: number[] = [];
      for (let q = a * SEG - 45; q <= b * SEG + 15; q += 6) { t.world(q, 0, 0, w); look.push(w.x, w.y + 1.0, w.z); }
      let lx0 = Infinity, lz0 = Infinity, lx1 = -Infinity, lz1 = -Infinity;
      for (let q = 0; q < look.length; q += 3) { lx0 = Math.min(lx0, look[q]); lx1 = Math.max(lx1, look[q]); lz0 = Math.min(lz0, look[q + 2]); lz1 = Math.max(lz1, look[q + 2]); }
      const obs = this.obstacles(lx0 - 50, lz0 - 50, lx1 + 50, lz1 + 50);
      // Standorte probieren: außen am Scheitel (nah → weiter, niedrig → höher), dann innen; der erste mit freier
      // Sicht auf fast die ganze Kehre gewinnt, sonst der beste
      let best: THREE.Vector3 | null = null, bestS = -1;
      const tryAt = (side: number, r: number, up: number) => {
        const px = ax + ox * r * side, pz = az + oz * r * side;
        const g = this.hAt(px, pz);
        const py = Math.max(ay + up, g + 3.2);
        let ok = 0;
        for (let q = 0; q < look.length; q += 3) if (this.needLift(px, py, pz, look[q], look[q + 1], look[q + 2], 0, 8, obs) < 0.05) ok++;
        const s = ok / (look.length / 3) - (py - ay) * 0.004 - r * 0.002;
        if (s > bestS) { bestS = s; best = new THREE.Vector3(px, py, pz); }
        return ok >= (look.length / 3) * 0.9;
      };
      let found = false;
      for (const [side, r, up] of [[1, EDGE + 11, 6.5], [1, EDGE + 11, 11], [1, EDGE + 20, 9], [1, EDGE + 20, 15], [-1, EDGE + 9, 7], [1, EDGE + 32, 14], [-1, EDGE + 9, 13], [1, EDGE + 32, 22]] as const) {
        if (tryAt(side, r, up)) { found = true; break; }
      }
      // keine brauchbare Sicht: bei der Verfolgerkamera bleiben
      if (!best || (!found && bestS < 0.7)) return false;
      this.tv = { a, b, pos: best, obs, hidden: 0 };
      this.perf.event(EV.cam, `TV-Kamera Kehre ${Math.round(a * SEG)}–${Math.round(b * SEG)} m`);
      return z >= a * SEG - TV_LEAD;
    }
    return false;
  }

  /** Prüfhilfe: freie Kamera um einen Punkt; null: zurück zum Fahrer */
  orbit(at: { x: number; y: number; z: number } | null, az = 30, el = 12, dist = 30, fov = 50) {
    this.free = at ? { at: new THREE.Vector3(at.x, at.y, at.z), az, el, dist } : null;
    if (at) { this.camera.fov = fov; this.cam.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  /**
   * Sonne: steht fest (Sonnenuntergang), ohne Schattenkarte. Das Licht der Fahrer und Dinge (PBR, die einzigen,
   * die noch die Sonne der Szene sehen) folgt dem vorberechneten Sonnenlicht am eigenen Fahrer – im Schatten der
   * Berge wird es weich dunkler
   */
  private updateSun() {
    const atmo = this.atmo!;
    this.world?.trees.sunDir.value.copy(atmo.sunDir);
    const e = this.eng!;
    let want = 1;
    if (this.sunBake && this.rider) {
      const g = this.rider.group.position;
      want = this.sunBake.sunAt(g.x, g.y + 1, g.z, 3);
    }
    this.sunHere += (want - this.sunHere) * 0.08;
    const c = atmo.cur;
    atmo.sun.intensity = c.sunI * (1 - this.tunnelK) * (0.08 + 0.92 * this.sunHere);
    void e;
  }

  /** Karten von oben (Geländelicht, Bodenschatten, Laternen): neu, wenn der Fahrer weit genug ist oder Neues da ist */
  private updateMaps(force: boolean) {
    const maps = this.maps;
    const world = this.world;
    const e = this.eng;
    if (!maps || !world || !e) return;
    // Mittelpunkt etwas voraus (dort liegt das meiste Bild)
    e.track.world(e.p.z + 220, 0, 0, this.w);
    this.mapFocus.set(this.w.x, this.w.y, this.w.z);
    if (world.field.done !== this.fieldDone) { this.fieldDone = world.field.done; maps.terrainChanged(); }
    const pc = world.stats.built + world.stats.dropped * 1000;
    if (pc !== this.piecesSeen) { this.piecesSeen = pc; maps.groundChanged(); }
    maps.update(this.mapFocus, performance.now(), force);
  }

  /** Tunnel: Licht von außen weg (Sonne, Himmel), Lampenlicht; Tageslicht der Portale in der Farbe der Stimmung */
  private updateTunnel(dt: number) {
    const e = this.eng!;
    const camZ = this.free ? e.p.z : e.p.z - (this._cam === 'drone' ? 20 : 4);
    const want = clamp(this.tunnelDepth(camZ) / 22, 0, 1);
    this.tunnelK += (want - this.tunnelK) * (dt > 0 ? Math.min(1, dt * 3) : 1);
    if (this.tunnelK < 0.002 && want === 0) this.tunnelK = 0;
    this.atmo!.setTunnel(this.tunnelK);
    const c = this.atmo!.cur;
    const f = Math.min(1.25, c.sunI / 3.4) * (1 - c.night * 0.85) + 0.08;
    this.world!.tunnels.day.value.setRGB(c.sunR * f, c.sunG * f, c.sunB * f);
  }

  // ------------------------------------------------------------------ Bild

  /**
   * Auflösung der Szene (in Bildpunkten je CSS-Pixel): das Bild bleibt in voller Auflösung, die Szene wird mit
   * dem Faktor dpr / maxDpr gerechnet und hochskaliert; dabei leicht nachgeschärft
   */
  private setDpr(d: number) {
    this.dpr = Math.max(0.3, Math.min(this.maxDpr, d));
    // Leinwand mitführen (selten: mit Spielraum, ein Wechsel legt die Puffer neu an)
    const cd = this.canvasFor(this.dpr);
    if (cd !== this.canvasDpr) { this.canvasDpr = cd; this.renderer.setPixelRatio(cd); }
    const sc = this.dpr / this.canvasDpr;
    this.scenePass?.setResolutionScale(sc);
    const a = this.atmo;
    if (a) {
      a.sharp.value = sc < 0.97 ? Math.min(0.55, (1 - sc) * 1.4) : 0;
      const w = this.host.clientWidth || window.innerWidth;
      const h = this.host.clientHeight || window.innerHeight;
      a.texel.value.set(1 / Math.max(1, w * this.dpr), 1 / Math.max(1, h * this.dpr));
    }
  }

  /** Leinwand zur Szene: bis Szene ×2,0 reicht ×2 (Nachbearbeitung auf halb so vielen Bildpunkten), ab ×2,3 voll */
  private canvasFor(d: number): number {
    const full = this.maxDpr;
    if (full <= 2) return full;
    if (d <= 2.0) return 2;
    if (d >= 2.3) return full;
    return this.canvasDpr === 2 ? 2 : full;
  }

  /**
   * Auflösung der Szene nach der Bildrate. Ziel ist der Takt des Bildschirms (120 Hz: 8,3 ms je Bild). Reicht die
   * Zeit nicht und ist die Grafik der Engpass (GPU-Zeit nahe am Takt), wird die Szene kleiner gerechnet – je
   * Schritt ~20 % weniger Bildpunkte (deutlich zu langsam: ~30 %), bis minDpr; mit viel Luft langsam wieder größer.
   * Ein Schritt nach unten, der weder GPU-Zeit noch Bildzeit verbessert hat, wird zurückgenommen (dann liegt der
   * Engpass woanders). Früher entschied nur die Bildzeit über 0,15er-Schritte: auf 120 Hz verschwand deren Gewinn
   * im Raster der Bildwechsel, jeder Schritt wurde zurückgenommen und die Szene blieb bei voller Auflösung.
   */
  private adapt(dtMs: number, now: number) {
    if (!this.ready || this.analysing) return;
    this.intervals.push(dtMs);
    if (this.intervals.length > 240) this.intervals.shift();
    const mn = Math.min(...(this.rafIv.length >= 30 ? this.rafIv : this.intervals));
    const disp = mn < 9.6 ? 1000 / 120 : mn < 12.5 ? 1000 / 90 : 1000 / 60;
    // Ziel: Takt des Bildschirms, mit Begrenzung deren Takt
    const cap = this.settings.fpsCap;
    this.period = cap > 0 ? Math.max(disp, 1000 / cap) : disp;
    if (this.intervals.length < 60 || this.paused) return;
    const P = this.period;
    const gpu = this.avgGpu > 0 ? this.avgGpu : -1;
    const cpu = this.avgCpu;
    if (this.probe) {
      if (now - this.probe.at < 1500) return;
      const p = this.probe;
      this.probe = null;
      const better = this.avgMs < p.ms * 0.96 || (gpu > 0 && p.gpu > 0 && gpu < p.gpu * 0.93);
      if (!better) {
        this.dprFloor = p.from;
        this.floorUntil = now + 20000;
        this.perf.event(EV.dpr, `${this.dpr.toFixed(2)}→${p.from.toFixed(2)} (kleiner brachte nichts: Bild ${p.ms.toFixed(1)}→${this.avgMs.toFixed(1)} ms, GPU ${p.gpu.toFixed(1)}→${gpu.toFixed(1)} ms)`);
        this.setDpr(p.from);
        this.lastDprChange = now;
        this.slowFor = this.fastFor = 0;
        return;
      }
    }
    if (now - this.lastDprChange < 900) return;
    if (this.dprFloor && now > this.floorUntil) this.dprFloor = 0;
    const cpuBound = cpu > P * 0.8;
    // Safari auf dem iPhone rechnet CPU und Grafik nacheinander (Bildzeit ≈ CPU + GPU): kleiner rechnen hilft schon,
    // wenn die GPU den größeren Teil hat – nicht erst, wenn sie allein den Takt füllt
    const gpuBound = gpu < 0 || gpu > P * 0.8 || (gpu > cpu && gpu + cpu > P * 0.85);
    if (this.avgMs > P * 1.12 && gpuBound && !cpuBound) { this.slowFor += dtMs; this.fastFor = 0; }
    // größer nur mit viel Luft (GPU unter dem halben Takt): auf dem Telefon ist die Wärme die eigentliche Grenze
    else if (this.avgMs < P * 1.04 && (gpu < 0 || (gpu < P * 0.5 && gpu + cpu < P * 0.75))) { this.fastFor += dtMs; this.slowFor = 0; }
    else { this.slowFor = 0; this.fastFor = 0; }
    const lo = Math.min(Math.max(this.settings.minDpr, this.dprFloor), this.maxDpr);
    let want = this.dpr;
    if (this.slowFor > 500) want = Math.max(lo, this.dpr * (this.avgMs > P * 1.8 ? 0.84 : 0.9));
    else if (this.fastFor > 3000) want = Math.min(this.maxDpr, this.dpr * 1.05);
    want = Math.round(want * 100) / 100;
    if (Math.abs(want - this.dpr) >= 0.01) {
      if (want < this.dpr) this.probe = { from: this.dpr, ms: this.avgMs, gpu, at: now };
      this.perf.event(EV.dpr, `${this.dpr.toFixed(2)}→${want.toFixed(2)}`);
      this.setDpr(want);
      this.lastDprChange = now;
      this.slowFor = this.fastFor = 0;
    }
  }

  /** Bildaufrufe des Browsers (auch übersprungene): ihr Abstand ist der Takt des Bildschirms */
  private rafT = 0;
  private rafIv: number[] = [];
  /** Zeitstempel des zuletzt gezeichneten Bilds */
  private drawnT = 0;

  private frame(t: number) {
    if (this.disposed) return;
    if (this.rafT) { this.rafIv.push(t - this.rafT); if (this.rafIv.length > 240) this.rafIv.shift(); }
    this.rafT = t;
    // Bildrate begrenzen (60 auf einem 120-Hz-Bildschirm: jeder zweite Aufruf): weniger Arbeit je Sekunde – das
    // Telefon wird langsamer warm und drosselt später (nicht in der Kostenanalyse, die misst je Bild)
    const cap = this.settings.fpsCap;
    if (cap > 0 && this.ready && !this.analysing && this.drawnT && t - this.drawnT < 1000 / cap - 3) return;
    this.drawnT = t;
    try {
      this.frameBody(t);
    } catch (e) {
      this.noteError('Bild', e);
    } finally {
      if (this.frameWaiters.length) { const w = this.frameWaiters; this.frameWaiters = []; for (const f of w) f(); }
    }
  }

  private frameWaiters: (() => void)[] = [];
  /** nächstes Bild abwarten – höchstens 4 s */
  private nextFrame(): Promise<void> {
    return new Promise((res) => {
      const id = window.setTimeout(res, 4000);
      this.frameWaiters.push(() => { window.clearTimeout(id); res(); });
    });
  }
  abortAnalysis() { this.analysisAbort = true; }
  private analysisAbort = false;
  private analysing = false;
  private gpuSamples: number[] | null = null;

  /**
   * Kostenanalyse: Spiel angehalten, Kamera fest; je Variante (Ebene aus, andere Auflösung) ~50 Bilder messen –
   * GPU-Zeit (Median), CPU fürs Zeichnen, Bildzeit, Aufrufe, Dreiecke. Danach ist alles wie vorher.
   */
  async costAnalysis(progress?: (i: number, n: number, label: string) => void): Promise<string> {
    const S0 = { ...this.settings };
    const paused0 = this.paused;
    const dpr0 = this.dpr;
    const world = this.world!;
    this.paused = true;
    this.analysing = true;
    this.analysisAbort = false;
    const known = new Set<THREE.Object3D>([world.field.group, world.trees.group, world.houses.group, world.life.group, ...(world.crowd ? [world.crowd.group] : [])]);
    const pieces = world.group.children.filter((o) => !known.has(o));
    const groups: [string, THREE.Object3D[]][] = [
      ['trees', [world.trees.group]], ['houses', [world.houses.group]], ['field', [world.field.group]], ['road', pieces],
      ['life', [world.life.group]], ['crowd', world.crowd ? [world.crowd.group] : []],
      ['objects', this.objects ? [this.objects.group] : []], ['riders', [this.rider!.group, ...this.pool.map((r) => r.group)]],
    ];
    const vis0 = new Map<THREE.Object3D, boolean>();
    for (const [, l] of groups) for (const o of l) vis0.set(o, o.visible);
    const setDpr = (d: number) => this.setDpr(d);
    const hide = (...names: string[]) => { for (const [k, l] of groups) if (names.includes(k)) for (const o of l) o.visible = false; };
    // feiner: einzelne Materialien aus (Bäume nah/fern, Zuschauer als Modell/Bild, Lampenhöfe, Kleinteile der Häuser)
    const mats = new Map<string, THREE.Material[]>();
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (!m || Array.isArray(m) || !m.name) return;
      const l = mats.get(m.name) ?? [];
      if (!l.includes(m)) l.push(m);
      mats.set(m.name, l);
    });
    const matVis0 = new Map<THREE.Material, boolean>();
    for (const l of mats.values()) for (const m of l) matVis0.set(m, m.visible);
    const hideMat = (...names: string[]) => { for (const n of names) for (const m of mats.get(n) ?? []) m.visible = false; };
    const base = this.dpr;
    const maxD = this.maxDpr;
    const steps: [string, () => void][] = [
      ['Basis (Auflösung ×' + base.toFixed(2) + ')', () => undefined],
      ['ohne Leuchten (Bloom-Kette)', () => this.applySettings({ ...S0, bloom: false }, true)],
      ['ohne Sonnenuntergangs-Licht', () => this.applySettings({ ...S0, sunset: false }, true)],
      ['ohne Fahrer und Gegner', () => hide('riders')],
      ['ohne Zuschauer', () => hide('crowd')],
      ['ohne Zuschauer-Modelle (nah)', () => hideMat('crowd')],
      ['ohne Zuschauer-Bilder', () => hideMat('crowd-2d')],
      ['ohne Bäume nah (Modelle)', () => hideMat('trees-near')],
      ['ohne Bäume fern (Bilder)', () => hideMat('trees-far')],
      ['ohne Lampenhöfe', () => hideMat('lamps')],
      ['ohne Kleinteile der Häuser', () => hideMat('house-detail')],
      ['ohne Blumen, Sträucher, Tiere', () => hide('life')],
      ['ohne Bäume', () => hide('trees')],
      ['ohne Häuser', () => hide('houses')],
      ['ohne Landschaft (Boden, Berge)', () => hide('field')],
      ['ohne Straße, Rand, Tunnel', () => hide('road')],
      ['ohne Dinge auf der Straße', () => hide('objects')],
      ['nur Himmel + Nachbearbeitung', () => hide(...groups.map(([k]) => k))],
      ['Szene ×1.0', () => setDpr(Math.min(1, maxD))],
      ['Szene ×1.4', () => setDpr(Math.min(1.4, maxD))],
      ...(maxD >= 2 ? [['Szene ×2.0', () => setDpr(2)] as [string, () => void]] : []),
    ];
    const med = (a: number[]) => { if (!a.length) return -1; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const p90 = (a: number[]) => { if (!a.length) return -1; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * 0.9)]; };
    const rows: { name: string; gpu: number; gpu90: number; base: number; draw: number; cpu: number; frame: number; calls: number; tris: number; px: string }[] = [];
    const restore = () => {
      if (JSON.stringify(this.settings) !== JSON.stringify(S0)) this.applySettings(S0, true);
      for (const [o, v] of vis0) o.visible = v;
      for (const [m, v] of matVis0) m.visible = v;
      setDpr(base);
    };
    // ein Block: einschwingen, dann 10 Bilder messen (GPU-Zeitstempel kommen verzögert – die ersten verfallen)
    const block = async (gpu: number[], m?: { draw: number[]; cpu: number[]; frame: number[] }) => {
      for (let k = 0; k < 6; k++) await this.nextFrame();
      this.gpuSamples = [];
      for (let k = 0; k < 10; k++) {
        await this.nextFrame();
        if (m) {
          m.draw.push(this.perf.sec[8] / REPEAT);
          const last = (this.perf.ringAt + 179) % 180;
          m.frame.push(this.perf.ring[last * 2]);
          m.cpu.push(this.perf.ring[last * 2 + 1]);
        }
      }
      for (let k = 0; k < 3; k++) await this.nextFrame();
      gpu.push(...(this.gpuSamples ?? []));
      this.gpuSamples = null;
    };
    try {
      for (let i = 0; i < steps.length && !this.analysisAbort; i++) {
        const [name, set] = steps[i];
        progress?.(i, steps.length, name);
        // paarweise im Wechsel mit der Basis: Apples Grafik ändert ihren Takt mit der Last, so laufen beide
        // Messungen unter denselben Bedingungen
        const gB: number[] = [], gV: number[] = [];
        const m = { draw: [] as number[], cpu: [] as number[], frame: [] as number[] };
        let calls = 0, tris = 0;
        for (let round = 0; round < 3 && !this.analysisAbort; round++) {
          restore();
          await block(gB);
          restore();
          set();
          await block(gV, m);
          calls = Math.round(this.renderer.info.render.drawCalls / REPEAT);
          tris = Math.round(this.renderer.info.render.triangles / REPEAT);
        }
        const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        // Szene (kleiner gerechnet) in der Bildgröße
        const sc = this.dpr / this.canvasDpr;
        rows.push({ name, gpu: med(gV), gpu90: p90(gV), base: med(gB), draw: med(m.draw), cpu: med(m.cpu), frame: med(m.frame), calls, tris, px: `${Math.round(size.x * sc)}×${Math.round(size.y * sc)} in ${size.x}×${size.y}` });
      }
    } finally {
      this.gpuSamples = null;
      restore();
      setDpr(dpr0);
      this.paused = this.offscreen ? paused0 : paused0;
      this.analysing = false;
    }
    if (!rows.length) return 'Kostenanalyse abgebrochen';
    const b = rows[0];
    const f = (x: number) => (x < 0 ? '–' : x.toFixed(2));
    const d = (x: number, y: number) => (x < 0 || y < 0 ? '' : ` (${y - x >= 0 ? '−' : '+'}${Math.abs(y - x).toFixed(2)})`);
    const e = this.eng;
    const lines = [
      `gruppetto Abfahrt-WebGPU Kostenanalyse · ${new Date().toISOString()} · ${this.backendName} · GPU-Zeitstempel ${this.gpuTiming ? 'ja' : 'nein'}`,
      `Gerät: ${navigator.userAgent}`,
      `Ort z=${Math.round(e?.p.z ?? 0)} m, Kamera ${this._cam}, Stimmung ${this.moodName}, Takt ${(1000 / this.period).toFixed(0)} Hz, Bildrate höchstens ${S0.fpsCap > 0 ? S0.fpsCap : 'frei'}, MSAA ${S0.msaa}, Bild ×${this.canvasDpr}, Einstellungen ${JSON.stringify(Object.fromEntries(Object.entries(S0).filter(([k, v]) => ((this.opts.defaults ?? RACE_DEFAULTS) as unknown as Record<string, unknown>)[k] !== v)))}`,
      'Hinweis: ein warmes Telefon drosselt – dann sind alle Zeiten bis gut doppelt so hoch. Nur im selben Zustand vergleichen (am besten kühl).',
      `Variante | GPU ms je Bild (Median; gemessen bei ${REPEAT}× Zeichnen je Bild, damit die Grafik voll taktet; Ersparnis zur Basis im Wechsel gemessen) | GPU 90 % | CPU zeichnen ms | CPU gesamt ms | Bildzeit ms (beim Messen) | Aufrufe | Dreiecke k | Szene in Bild (Bildpunkte)`,
      ...rows.map((r) => `${r.name} | ${f(r.gpu)}${r === b ? '' : d(r.gpu, r.base)} | ${f(r.gpu90)} | ${f(r.draw)}${r === b ? '' : d(r.draw, b.draw)} | ${f(r.cpu)} | ${f(r.frame)} | ${r.calls} | ${Math.round(r.tris / 1000)} | ${r.px}`),
    ];
    return lines.join('\n');
  }

  noteError(where: string, e: unknown) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    this.perf.event(EV.error, `${where}: ${msg.slice(0, 200)}`);
    if (this.errCount++ < 20) console.error(`[race] ${where}:`, e);
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
    const world = this.world;
    const e = this.eng;
    if (this.ready && world && e && this.rider) {
      const run = !this.paused;
      if (run) this.time += dt;
      this.place(run ? dt : 0);
      if (e.phase !== this.lastPhase) { if (this.lastPhase) P.event(EV.phase, e.phase); this.lastPhase = e.phase; }
      P.mark(0);
      this.updateCamera(run ? dt : 0);
      P.mark(1);
      this.updateTunnel(run ? dt : 0);
      this.atmo?.update(run ? dt : 0, this.camera.position, this.camera);
      this.atmo?.setSpeed(e.phase === 'playing' && !this.paused && !this.free ? (e.p.v - 21) / 14 : 0);
      this.updateSun();
      const mood = this.moodName;
      if (mood !== this.shownMood) { if (this.shownMood) P.event(EV.mood, mood); this.shownMood = mood; }
      P.mark(2);
      const cp = this.camera.position;
      const cd = this.camera.getWorldDirection(this.camDir);
      world.trees.update(cp);
      P.mark(3);
      world.houses.update(cp, false, cd, this.camera);
      P.mark(4);
      world.life.update(cp);
      P.mark(5);
      world.crowd?.update(cp, this.rider.group.position, false, cd, this.camera);
      P.mark(6);
      P.mark(7);
      this.objects?.update(e.track, e.p.z, this.time);
      this.particles?.update(e.track, e.parts);
      P.mark(10);
      // Nachladen: kleines Budget je Bild; mehr, wenn die Welt knapp wird, in der Pause oder vor dem Start
      const front = world.builtFrom(e.p.z);
      const lead = front - e.p.z;
      const idle = this.paused || e.phase === 'ready' || e.phase === 'over';
      // gleichmäßig wenig statt stoßweise viel: auf dem iPhone laufen CPU und Grafik nacheinander, jede Millisekunde
      // hier fehlt dem Bild. Die Welt wird dafür früher (1,35 km voraus) angefangen; im Mittel braucht ein
      // Abschnitt ~0,15 ms je Bild – erst wenn sie knapp wird, mehr
      const ms = this.budget || (idle ? 6 : lead < 450 ? 4 : lead < 700 ? 2.2 : lead < 950 ? 1 : 0.5);
      world.step(e.p.z, performance.now() + ms);
      // Dorfstraßen auch in der Strecke der Fahrphysik (Wiese statt Abgrund am Rand)
      world.villages.patch(e.track);
      if (front !== this.lastBuilt) { if (front > this.lastBuilt) P.event(EV.piece, `Welt bis ${Math.round(front)} m`); this.lastBuilt = front; }
      this.updateMaps(false);
      if (++this.punchAt >= 30) { this.punchAt = 0; this.orderPunch(); }
      P.mark(9);
    }
    this.adapt(dtMs, t);
    // Kostenanalyse: die Grafik mehrfach je Bild arbeiten lassen – nur ausgelastet läuft Apples Grafik mit vollem
    // Takt, sonst messen die Zeitstempel ihr Heruntertakten mit
    if (this.ready && !this.offscreen) {
      const n = this.analysing ? REPEAT : 1;
      for (let k = 0; k < n; k++) {
        // die Szene rendert nur einmal je Bild der Knoten: für jede Wiederholung ein neues (sonst nur die Nachbearbeitung)
        if (k > 0) (this.renderer as unknown as { _nodes: { nodeFrame: { update(): void } } })._nodes.nodeFrame.update();
        // Zähler nur einmal je Bild zurücksetzen: sonst bekämen die Zeitstempel der Wiederholungen dieselben Namen
        this.draw(this.pipeline, k === 0);
      }
    }
    P.mark(8);
    // 2D-Ebene (Hinweise, Tempo-Linien)
    if (this.ready && e && this.rider) {
      this.screenPos.copy(this.rider.group.position).setY(this.rider.group.position.y + 1.6).project(this.camera);
      const w = this.host.clientWidth || window.innerWidth;
      this.overlay.draw({ popups: e.popups, v: e.p.v, playing: e.phase === 'playing' && !this.paused, px: (this.screenPos.x * 0.5 + 0.5) * w, time: this.time });
      this.opts.onFrame?.(dt);
    }
    P.mark(10);
    if (this.ready) this.avgCpu += (performance.now() - t0 - this.avgCpu) * 0.05;
    const be = this.renderer.backend as unknown as { trackTimestamp?: boolean };
    if (this.ready && !this.offscreen) this.gpuFrames++;
    if (this.ready && be.trackTimestamp && this.gpuFrames > 0 && !this.gpuPending) {
      this.gpuPending = true;
      this.gpuFrames = 0;
      const rep = this.analysing ? REPEAT : 1;
      // three.js liefert die GPU-Zeit des letzten Bilds der Abfrage (nicht die Summe aller Bilder seit der vorigen)
      this.renderer.resolveTimestampsAsync('render').then((v) => {
        if (typeof v !== 'number' || !(v > 0)) return;
        if (rep > 1) { this.gpuSamples?.push(v / rep); return; }
        P.gpu = v;
        this.gpuMs = v;
        this.avgGpu = this.avgGpu ? this.avgGpu + (v - this.avgGpu) * 0.08 : v;
        this.gpuSamples?.push(v);
      }).catch(() => undefined).finally(() => { this.gpuPending = false; });
    }
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
        dt: rawMs, period: this.period, calls: info.drawCalls, tris: info.triangles, dpr: this.dpr, z: e?.p.z ?? 0, v: e?.p.v ?? 0,
        cam: ['chase', 'low', 'side', 'drone'].indexOf(this._cam), opps: this.poolOf.size,
      });
    }
    this.opts.onStats?.({
      fps: 1000 / this.avgMs, ms: this.avgMs, period: this.period, dpr: this.dpr, cpu: this.avgCpu, gpu: this.gpuMs,
      tris: info.triangles, calls: info.drawCalls, loading: this.ready ? 1 : this.loadFrac, stage: this.stage,
      built: world && e ? world.builtFrom(e.p.z) : 0, z: e?.p.z ?? 0, buildMs: world?.stats.ms ?? 0, backend: this.backendName,
    });
  }

  private punchAt = 0;
  /**
   * Zeichenfolge für die Kachel-Grafik (Apple): erst alles Deckende, dann alles, was Bildpunkte ausstanzt (Raster
   * der Stufenwechsel, Alphatest der Bilder). Ausstanzen schaltet dort das Weglassen verdeckter Bildpunkte ab; danach
   * gezeichnet, prüft es nur noch gegen die fertige Tiefe der deckenden Dinge.
   */
  private orderPunch() {
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || o.renderOrder !== 0) return;
      const m = mesh.material as THREE.Material & { alphaTestNode?: unknown };
      if (!m || Array.isArray(m) || m.transparent) return;
      if (m.alphaTestNode || m.alphaTest > 0 || m.alphaToCoverage) o.renderOrder = 1;
    });
  }

  private draw(pl: THREE.RenderPipeline | null = this.pipeline, reset = true) {
    if (!pl) return;
    if (reset) this.renderer.info.reset();
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
    const e = this.eng;
    if (e && this.rider && this.world) {
      // läuft die Kamera schon, nichts weiterschieben (sonst springt eine Regie-Überblendung im Prüfbild)
      this.updateCamera(this.cam.init ? 0 : 1);
      this.updateTunnel(0);
      this.atmo?.update(0, this.camera.position, this.camera);
      this.updateSun();
      this.world.update(this.camera.position, this.rider.group.position, true);
      this.objects?.update(e.track, e.p.z, this.time);
      this.particles?.update(e.track, e.parts);
    }
    const size = new THREE.Vector2();
    r.getDrawingBufferSize(size);
    const rt = new THREE.RenderTarget(size.x, size.y, { depthBuffer: false });
    r.setRenderTarget(rt);
    this.pipeline?.render();
    r.setRenderTarget(null);
    const inf = r.info.render;
    console.info(`[race] Bild: ${inf.drawCalls} Aufrufe, ${Math.round(inf.triangles / 1000)}k Dreiecke`);
    const px = (await r.readRenderTargetPixelsAsync(rt, 0, 0, size.x, size.y)) as Uint8Array;
    rt.dispose();
    const cv = document.createElement('canvas');
    cv.width = size.x;
    cv.height = size.y;
    const c = cv.getContext('2d')!;
    const img = c.createImageData(size.x, size.y);
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

  /** Prüfhilfe: Welt-Stand (für Tests ohne Bildschirm) */
  get worldStats() { return { ...this.world?.stats, builtTo: this.world && this.eng ? this.world.builtFrom(this.eng.p.z) : 0, z: this.eng?.p.z ?? 0, phase: this.eng?.phase, trees: this.world?.trees.count, houses: this.world?.houses.count, steps: this.world?.stepMax }; }
  /** Prüfhilfe: Szene (welche Materialien/Geometrien sind sichtbar) */
  get debugScene(): THREE.Scene { return this.scene; }
  get debugRenderer(): THREE.WebGPURenderer { return this.renderer; }
  /** Prüfhilfe: liegt das Objekt im Sichtkegel der Kamera? */
  get debugFrustum(): (o: THREE.Object3D) => boolean {
    const f = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    return (o) => { const m = o as THREE.Mesh; const bs = m.geometry?.boundingSphere; if (!bs) return true; const s = bs.clone().applyMatrix4(m.matrixWorld); return f.intersectsSphere(s); };
  }
  /** Prüfhilfe (ohne Bildschirm): n Bilder zeichnen und auf die Grafik warten – Zeit je Bild (ms) */
  async benchDraw(n = 5): Promise<number> {
    const e = this.eng;
    if (e && this.rider && this.world) { this.updateCamera(0); this.atmo?.update(0, this.camera.position, this.camera); this.updateSun(); this.world.update(this.camera.position, this.rider.group.position, true); }
    this.draw();
    if (this.frameRT) await this.renderer.readRenderTargetPixelsAsync(this.frameRT, 0, 0, 1, 1);
    const t0 = performance.now();
    for (let k = 0; k < n; k++) this.draw();
    if (this.frameRT) await this.renderer.readRenderTargetPixelsAsync(this.frameRT, 0, 0, 1, 1);
    return (performance.now() - t0) / n;
  }
  /** Prüfhilfe: Gruppen der Welt für die Kostenmessung */
  get debugGroups(): Record<string, THREE.Object3D[]> {
    const w = this.world!;
    const known = new Set<THREE.Object3D>([w.field.group, w.trees.group, w.houses.group, w.life.group, ...(w.crowd ? [w.crowd.group] : [])]);
    return {
      trees: [w.trees.group], houses: [w.houses.group], field: [w.field.group], road: w.group.children.filter((o) => !known.has(o)),
      life: [w.life.group], crowd: w.crowd ? [w.crowd.group] : [], objects: this.objects ? [this.objects.group] : [],
      riders: [this.rider!.group, ...this.pool.map((r) => r.group)],
    };
  }
  /** Prüfhilfe: Spiel (Engine) */
  get engine(): Abfahrt | TimeTrial | null { return this.eng; }

  // ------------------------------------------------------------------ Messfahrt

  private deviceInfo(): Record<string, unknown> {
    const be = this.renderer.backend as unknown as { device?: { adapterInfo?: Record<string, string> }; adapter?: { info?: Record<string, string> } };
    const ai = be.device?.adapterInfo ?? be.adapter?.info;
    const pick = ai ? { vendor: ai.vendor, architecture: ai.architecture, device: ai.device, description: ai.description } : null;
    return {
      ua: navigator.userAgent, bildschirm: `${screen.width}×${screen.height}`, pixeldichte: window.devicePixelRatio, fenster: `${window.innerWidth}×${window.innerHeight}`,
      technik: this.backendName, grafik: pick, gpu_zeitstempel: this.gpuTiming,
      // „aufloesung“ in den Verläufen: Szene (kleiner gerechnet, hochskaliert); das Bild selbst in bild_dpr
      bild_dpr: this.canvasDpr, msaa: this.settings.msaa, fps_grenze: this.settings.fpsCap || null,
    };
  }

  startMeasure(extra: Record<string, unknown> = {}) {
    if (this.world) this.world.stepMax = {};
    this.perf.startRec({
      ...extra, ...this.deviceInfo(), spiel: 'Abfahrt WebGPU', kamera_start: this._cam, stimmung: this.moodName,
      gegner_max: this.settings.oppMax, start_z: Math.round(this.eng?.p.z ?? 0), phase: this.eng?.phase, testfahrt: this.cruise, autopilot: this.autopilot,
    });
  }
  get measuring(): boolean { return !!this.perf.rec; }
  stopMeasure(): Report | null {
    // längste Einzelschritte beim Nachladen der Welt (je Teil) – Kandidaten für Ruckler
    const sm = this.world?.stepMax ?? {};
    const top = Object.fromEntries(Object.entries(sm).sort((a, b) => b[1] - a[1]).slice(0, 12));
    return this.perf.stopRec({ welt_schritte_max_ms: top });
  }

  // ------------------------------------------------------------------ Einstellungen

  applySettings(s: Settings, instant = false) {
    const prev = this.settings;
    const diff = (Object.keys(s) as (keyof Settings)[]).filter((k) => s[k] !== prev[k]).map((k) => `${k}=${String(s[k])}`).join(' ');
    if (diff) this.perf.event(EV.settings, diff);
    this.settings = s;
    saveSettings(s, this.opts.settingsKey ?? RACE_KEY);
    this.dprFloor = 0;
    this.atmo?.apply(s, instant);
    const md = Math.min(window.devicePixelRatio || 1, s.maxDpr);
    if (md !== this.maxDpr) { this.maxDpr = md; this.canvasDpr = this.canvasFor(Math.min(this.dpr, md)); this.renderer.setPixelRatio(this.canvasDpr); }
    // Begrenzung neu an: wie beim Start ab „Szene mindestens“
    if (s.fpsCap > 0 && s.fpsCap !== prev.fpsCap) this.dpr = s.minDpr;
    this.setDpr(Math.max(Math.min(this.dpr, md), Math.min(s.minDpr, md)));
    const w = this.world;
    if (w) {
      if (w.crowd) w.crowd.group.visible = s.crowd;
      w.life.group.visible = s.life;
      if (s.treeFar !== prev.treeFar) w.trees.setFar(s.treeFar);
    }
  }

  resize() {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.overlay.resize(w, h);
    this.eng?.setViewport(w);
    this.setDpr(this.dpr);
  }

  dispose() {
    this.disposed = true;
    if (this.onWinError) { window.removeEventListener('error', this.onWinError); window.removeEventListener('unhandledrejection', this.onWinError); }
    this.renderer.setAnimationLoop(null);
    this.renderer.domElement.remove();
    this.overlay.dispose();
    this.world?.dispose();
    this.objects?.dispose();
    this.particles?.dispose();
    this.rider?.dispose();
    for (const R of this.pool) R.dispose();
    this.peloton?.dispose();
    this.atmo?.dispose();
    this.maps?.dispose();
    this.frameRT?.dispose();
    this.renderer.dispose();
  }
}
