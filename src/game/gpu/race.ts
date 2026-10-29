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
import type { Kit } from '../abfahrt/rider';
import { bakeFlowerDots, bakeSurfaces, type Surface, type SurfaceId } from './bake';
import { Atmo } from './atmo';
import { loadSettings, MOOD_U, MOODS, RACE_DEFAULTS, RACE_KEY, saveSettings, type Settings } from './mood';
import { corridorMaterial, terrainMaterial } from './ground';
import { adsMaterial, marksMaterial, metalMaterial, paintMaterial, roadMaterial, woodMaterial } from './mats';
import { Rider, teamKit } from './rider';
import { EV, Perf, type Report } from './perf';
import { World, AHEAD } from './world';
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

export interface RaceOptions {
  dayKey: string;
  names: string[];
  kit: Kit;
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
/** Kamera hinter dem Fahrer wie im Spiel */
const CAM_BACK = 6.2;
const CAM_UP = 2.75;

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
  settings: Settings = loadSettings(RACE_KEY, RACE_DEFAULTS);
  private track: Track | null = null;
  private world: World | null = null;
  private objects: Objects | null = null;
  private particles: Particles | null = null;
  readonly overlay = new Overlay();
  private rider: Rider | null = null;
  private pool: Rider[] = [];
  private poolOf = new Map<number, number>();
  private poolFree: number[] = [];
  /** laufende Fahrt (auch vor dem Start: Fahrer stehen am Start) */
  private eng: Abfahrt | null = null;
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
  private probe: { from: number; gpu: number; at: number } | null = null;
  readonly perf = new Perf();
  /** Messfahrt fertig */
  onReport: ((r: Report) => void) | null = null;
  /** Prüfhilfe: freie Kamera (Azimut, Höhe in Grad, Abstand in m) um einen Punkt */
  private free: { at: THREE.Vector3; az: number; el: number; dist: number } | null = null;
  private budget = Number(/[?&]budget=([0-9.]+)/.exec(location.search)?.[1] ?? 0);
  private onWinError: ((e: Event) => void) | null = null;
  private errCount = 0;
  private screenPos = new THREE.Vector3();

  constructor(private host: HTMLElement, private opts: RaceOptions) {
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
    this.dpr = this.maxDpr;
    r.setPixelRatio(this.maxDpr);
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 0.62;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
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
    const moodParam = /[?&]mood=([a-z]+)/.exec(location.search)?.[1] as Settings['mood'] | undefined;
    if (moodParam) this.settings = { ...this.settings, mood: moodParam };
    const skySize = Number(/[?&]sky=(\d+)/.exec(location.search)?.[1] ?? 0) || (low ? 128 : 512);
    const atmo = (this.atmo = new Atmo(r, this.scene, this.settings, skySize, false));
    atmo.apply(this.settings, true);
    if (this.disposed) return;

    await step(0.1, 'Strecke');
    const track = (this.track = new Track(this.opts.dayKey, this.opts.names, 'descent'));
    const terrain = new Terrain(track);
    const adsM = adsMaterial(adsTex(this.opts.names));
    const world = (this.world = new World({
      renderer: r, track, terrain, msaa: gpu, low,
      terrainMats: [terrainMaterial(S, 0, dots), terrainMaterial(S, 1), terrainMaterial(S, 2)],
      corridorMats: {
        road: roadMaterial(S), marks: marksMaterial(S), sides: corridorMaterial(S, dots), metal: metalMaterial(), wood: woodMaterial(),
        paint: paintMaterial(), ads: adsM,
      },
      adsMap: adsM.map ?? null,
      surfaces: S,
      crowd: gpu,
    }));
    this.scene.add(world.group);
    world.trees.sunDir.value.copy(atmo.sunDir);
    world.trees.setFar(this.settings.treeFar);
    const objects = (this.objects = new Objects());
    this.scene.add(objects.group);
    const particles = (this.particles = new Particles());
    this.scene.add(particles.mesh);
    // eigener Fahrer (volle Detailstufe) und der Vorrat an Gegnern (Teamtrikots)
    this.rider = new Rider(this.opts.kit, 1, 1, true);
    this.scene.add(this.rider.group);
    for (let i = 0; i < POOL; i++) {
      const R = new Rider(teamKit(i), 0, i * 7.31 + 3, false);
      R.group.visible = false;
      this.pool.push(R);
      this.poolFree.push(POOL - 1 - i);
      this.scene.add(R.group);
    }
    this.eng = this.makeEngine(0);

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
      const done = world.buildUpTo(z0, z0 + AHEAD, performance.now() + 40);
      this.loadFrac = 0.12 + 0.6 * world.progressTo(z0 + AHEAD);
      if (performance.now() - lastLog > 2000) { lastLog = performance.now(); log(`Welt bis ${Math.round(world.builtTo)} m, Bäume ${world.trees.count}`); }
      if (done) break;
      await new Promise((res) => setTimeout(res, 0));
    }
    log(`Welt: ${Math.round(world.builtTo)} m, ${world.trees.count} Bäume, ${world.houses.count} Häuser`);
    await step(0.74, 'Shader werden übersetzt');
    this.place(0);
    this.updateCamera(0);
    await this.warmup((f) => { this.loadFrac = 0.74 + 0.25 * f; });
    if (this.disposed) return;
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
    this.objects?.warm(true);
    this.particles?.warm(true);
    for (const R of this.pool) { R.far(0); R.lamp(true); }
    this.rider?.lamp(true);
    const rt = this.scenePass?.renderTarget ?? null;
    const prev = r.getRenderTarget();
    r.setRenderTarget(rt);
    try {
      await r.compileAsync(this.scene, this.camera, null, (e: ProgressEvent) => progress(0.8 * (e.loaded / Math.max(1, e.total))));
    } catch { /* dann beim ersten Bild */ }
    r.setRenderTarget(prev);
    if (this.disposed) return;
    // zwei echte Bilder (Schattendurchgang, beide Ketten); Gegner einmal nah, einmal fern
    for (let k = 0; k < 3; k++) {
      if (k === 2) for (const R of this.pool) { R.far(1e4); R.lamp(false); }
      this.draw(k === 1 ? this.pipeFlat : this.pipeBloom);
      progress(0.85 + k * 0.05);
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

  private makeEngine(cruise: number): Abfahrt {
    const e = new Abfahrt({
      dayKey: this.opts.dayKey, names: this.opts.names, friends: [], kit: this.opts.kit, best: 0,
      missions: [], missionsDone: new Set(), tutorial: false, cruise: cruise || undefined,
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
    this.rider?.model.resetCrash();
    this.eng!.start();
    this.perf.event(EV.phase, `Start${cruise ? ` Testfahrt ${cruise}×` : ''}`);
  }

  /** zurück an den Start (Startkarte) */
  toStart() {
    this.eng = this.makeEngine(this.cruise);
    for (const [, i] of this.poolOf) { this.pool[i].group.visible = false; this.poolFree.push(i); }
    this.poolOf.clear();
    this.cam.init = false;
    this.paused = false;
    this.rider?.model.resetCrash();
  }

  pointerDown(x: number, y: number) { if (!this.autopilot) this.eng?.pointerDown(x, y); }
  pointerMove(x: number, y: number) { if (!this.autopilot) this.eng?.pointerMove(x, y); }
  pointerUp() { this.eng?.pointerUp(); }
  key(name: 'left' | 'right' | 'up' | 'down', down: boolean) { if (!this.autopilot) this.eng?.key(name, down); }
  hud(): HudState | null { return this.eng?.hud() ?? null; }
  /** Testfahrt: Zeitraffer, Stehenbleiben (Prüfpult wie im Spiel) */
  get dbg() { return this.eng?.dbg ?? null; }

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
    e.tx = clamp(tx, -ROAD_HALF + 0.45, ROAD_HALF - 0.45);
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
    if (e.phase === 'crash' || e.phase === 'over') R.model.crash(e.phaseT, e.crashSpin);
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

  /** Gegner: die nächsten (höchstens so viele wie eingestellt) bekommen ein Modell aus dem Vorrat */
  private placeOpps(dt: number, light: number) {
    const e = this.eng!;
    const t = e.track;
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
        out.pos.set(rx - fx * CAM_BACK + (Math.random() - 0.5) * sh, this.cam.y + (Math.random() - 0.5) * sh, rz - fz * CAM_BACK);
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
        t.world(p.z + 9, this.sideSign * (EDGE + 2.5), 0, w);
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
    const yaw = this.w.th + Math.atan2(p.vx, Math.max(5, p.v)) * 0.3;
    if (!this.cam.init || e.phase === 'ready' || e.phase === 'countdown') { this.cam.th = yaw; this.camFrom = null; this.camBlend = 1; }
    this.cam.th += angDiff(yaw, this.cam.th) * Math.min(1, dt * 6);
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
    this.cam.init = true;
    this.camera.position.copy(A.pos);
    this.camera.lookAt(A.look);
    // Sichtfeld weich (Tempo)
    this.cam.fov += (A.fov - this.cam.fov) * Math.min(1, dt > 0 ? dt * 2 : 1);
    if (Math.abs(this.camera.fov - this.cam.fov) > 0.01) { this.camera.fov = this.cam.fov; this.camera.updateProjectionMatrix(); }
  }

  /** Prüfhilfe: freie Kamera um einen Punkt; null: zurück zum Fahrer */
  orbit(at: { x: number; y: number; z: number } | null, az = 30, el = 12, dist = 30, fov = 50) {
    this.free = at ? { at: new THREE.Vector3(at.x, at.y, at.z), az, el, dist } : null;
    if (at) { this.camera.fov = fov; this.cam.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  /** Schattenausschnitt folgt dem Fahrer, im Lichtraster eingerastet */
  private updateSun() {
    const atmo = this.atmo!;
    const sun = atmo.sun;
    this.world?.trees.sunDir.value.copy(atmo.sunDir);
    const e = this.eng!;
    e.track.world(e.p.z + 22, 0, 0, this.w);
    const c = this.free ? this.free.at.clone() : new THREE.Vector3(this.w.x, this.w.y, this.w.z);
    const d = atmo.sunDir;
    const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, d).normalize();
    const texel = 110 / 2048;
    const a = Math.round(c.dot(right) / texel) * texel;
    const b = Math.round(c.dot(up) / texel) * texel;
    const snapped = right.multiplyScalar(a).add(up.multiplyScalar(b)).addScaledVector(d, c.dot(d));
    sun.target.position.copy(snapped);
    sun.position.copy(snapped).addScaledVector(d, 1500);
    sun.target.updateMatrixWorld();
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
    const sc = this.dpr / this.maxDpr;
    this.scenePass?.setResolutionScale(sc);
    const a = this.atmo;
    if (a) {
      a.sharp.value = sc < 0.97 ? Math.min(0.55, (1 - sc) * 1.4) : 0;
      const w = this.host.clientWidth || window.innerWidth;
      const h = this.host.clientHeight || window.innerHeight;
      a.texel.value.set(1 / Math.max(1, w * this.dpr), 1 / Math.max(1, h * this.dpr));
    }
  }

  /** Auflösung nach der Bildzeit */
  private adapt(dtMs: number, now: number) {
    if (!this.ready || this.analysing) return;
    this.intervals.push(dtMs);
    if (this.intervals.length > 240) this.intervals.shift();
    const mn = Math.min(...this.intervals);
    this.period = mn < 9.6 ? 1000 / 120 : mn < 12.5 ? 1000 / 90 : 1000 / 60;
    if (this.intervals.length < 60 || now - this.lastDprChange < 1200 || this.paused) return;
    // letzter Schritt nach unten hat die Grafikkarte kaum entlastet? Dann zurück zur schärferen Auflösung und
    // nicht wieder darunter: die Kosten hängen dann nicht an den Bildpunkten (unscharf und trotzdem langsam)
    if (this.probe && now - this.probe.at > 1600) {
      const p = this.probe;
      this.probe = null;
      if (this.avgGpu > p.gpu * 0.9) {
        this.dprFloor = p.from;
        this.perf.event(EV.dpr, `${this.dpr.toFixed(2)}→${p.from.toFixed(2)} (kleiner brachte GPU nichts: ${p.gpu.toFixed(1)}→${this.avgGpu.toFixed(1)} ms)`);
        this.setDpr(p.from);
        this.lastDprChange = now;
        this.slowFor = this.fastFor = 0;
        return;
      }
    }
    const cpuBound = this.avgCpu > this.period * 0.75;
    if (this.avgMs > this.period * 1.22 && !cpuBound) { this.slowFor += dtMs; this.fastFor = 0; } else if (this.avgMs < this.period * 1.06) { this.fastFor += dtMs; this.slowFor = 0; } else { this.slowFor = 0; }
    let want = this.dpr;
    if (this.slowFor > 700) want = Math.max(Math.min(Math.max(this.settings.minDpr, this.dprFloor), this.maxDpr), this.dpr - 0.15);
    else if (this.fastFor > 3500) want = Math.min(this.maxDpr, this.dpr + 0.1);
    if (want !== this.dpr) {
      if (want < this.dpr && this.gpuTiming && this.avgGpu > 0) this.probe = { from: this.dpr, gpu: this.avgGpu, at: now };
      this.perf.event(EV.dpr, `${this.dpr.toFixed(2)}→${(Math.round(want * 100) / 100).toFixed(2)}`);
      this.setDpr(Math.round(want * 100) / 100);
      this.lastDprChange = now;
      this.slowFor = this.fastFor = 0;
    }
  }

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
    const known = new Set<THREE.Object3D>([world.field.group, world.trees.group, world.grass.group, world.houses.group, world.life.group, ...(world.crowd ? [world.crowd.group] : [])]);
    const pieces = world.group.children.filter((o) => !known.has(o));
    const groups: [string, THREE.Object3D[]][] = [
      ['trees', [world.trees.group]], ['houses', [world.houses.group]], ['field', [world.field.group]], ['road', pieces],
      ['grass', [world.grass.group]], ['life', [world.life.group]], ['crowd', world.crowd ? [world.crowd.group] : []],
      ['objects', this.objects ? [this.objects.group] : []], ['riders', [this.rider!.group, ...this.pool.map((r) => r.group)]],
    ];
    const vis0 = new Map<THREE.Object3D, boolean>();
    for (const [, l] of groups) for (const o of l) vis0.set(o, o.visible);
    const setDpr = (d: number) => this.setDpr(d);
    const hide = (...names: string[]) => { for (const [k, l] of groups) if (names.includes(k)) for (const o of l) o.visible = false; };
    const base = this.dpr;
    const maxD = this.maxDpr;
    const steps: [string, () => void][] = [
      ['Basis (Auflösung ×' + base.toFixed(2) + ')', () => undefined],
      ['ohne Leuchten (Bloom-Kette)', () => this.applySettings({ ...S0, bloom: false }, true)],
      ['ohne Schattendurchgang', () => { this.atmo!.sun.shadow.autoUpdate = false; }],
      ['ohne Sonnenuntergangs-Licht', () => this.applySettings({ ...S0, sunset: false }, true)],
      ['ohne Fahrer und Gegner', () => hide('riders')],
      ['ohne Zuschauer', () => hide('crowd')],
      ['ohne Blumen, Sträucher, Tiere', () => hide('life')],
      ['ohne Grashalme', () => hide('grass')],
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
    const rows: { name: string; gpu: number; gpu90: number; draw: number; cpu: number; frame: number; calls: number; tris: number; px: string }[] = [];
    const restore = () => {
      if (this.atmo) this.atmo.sun.shadow.autoUpdate = S0.shadows;
      if (JSON.stringify(this.settings) !== JSON.stringify(S0)) this.applySettings(S0, true);
      for (const [o, v] of vis0) o.visible = v;
      setDpr(base);
    };
    try {
      for (let i = 0; i < steps.length && !this.analysisAbort; i++) {
        const [name, set] = steps[i];
        progress?.(i, steps.length, name);
        restore();
        set();
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
        // Szene (kleiner gerechnet) in der Bildgröße
        const sc = this.dpr / this.maxDpr;
        rows.push({ name, gpu: med(g), gpu90: p90(g), draw: med(draw), cpu: med(cpu), frame: med(frame), calls, tris, px: `${Math.round(size.x * sc)}×${Math.round(size.y * sc)} in ${size.x}×${size.y}` });
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
      `Ort z=${Math.round(e?.p.z ?? 0)} m, Kamera ${this._cam}, Stimmung ${this.moodName}, Takt ${(1000 / this.period).toFixed(0)} Hz, MSAA ${S0.msaa}, Einstellungen ${JSON.stringify(Object.fromEntries(Object.entries(S0).filter(([k, v]) => (RACE_DEFAULTS as unknown as Record<string, unknown>)[k] !== v)))}`,
      'Variante | GPU ms (Median, Ersparnis zur Basis) | GPU 90 % | CPU zeichnen ms | CPU gesamt ms | Bildzeit ms | Aufrufe | Dreiecke k | Szene in Bild (Bildpunkte)',
      ...rows.map((r) => `${r.name} | ${f(r.gpu)}${r === b ? '' : d(r.gpu, b.gpu)} | ${f(r.gpu90)} | ${f(r.draw)}${r === b ? '' : d(r.draw, b.draw)} | ${f(r.cpu)} | ${f(r.frame)} | ${r.calls} | ${Math.round(r.tris / 1000)} | ${r.px}`),
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
      world.trees.update(cp);
      P.mark(3);
      world.houses.update(cp);
      P.mark(4);
      world.life.update(cp);
      P.mark(5);
      world.crowd?.update(cp, this.rider.group.position);
      P.mark(6);
      world.grass.update(cp);
      P.mark(7);
      this.objects?.update(e.track, e.p.z, this.time);
      this.particles?.update(e.track, e.parts);
      P.mark(10);
      // Nachladen: kleines Budget je Bild; mehr, wenn die Welt knapp wird, in der Pause oder vor dem Start
      const front = world.builtFrom(e.p.z);
      const lead = front - e.p.z;
      const idle = this.paused || e.phase === 'ready' || e.phase === 'over';
      const ms = this.budget || (idle ? 6 : lead < 450 ? 4 : lead < 750 ? 2.2 : 1.4);
      world.step(e.p.z, performance.now() + ms);
      if (front !== this.lastBuilt) { if (front > this.lastBuilt) P.event(EV.piece, `Welt bis ${Math.round(front)} m`); this.lastBuilt = front; }
      P.mark(9);
    }
    this.adapt(dtMs, t);
    if (this.ready && !this.offscreen) this.draw();
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
      const nf = Math.max(1, this.gpuFrames);
      this.gpuFrames = 0;
      this.renderer.resolveTimestampsAsync('render').then((v) => {
        if (typeof v !== 'number' || !(v > 0)) return;
        P.gpu = v / nf;
        this.gpuMs = v / nf;
        this.avgGpu = this.avgGpu ? this.avgGpu + (v / nf - this.avgGpu) * 0.08 : v / nf;
        this.gpuSamples?.push(v / nf);
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
    const e = this.eng;
    if (e && this.rider && this.world) {
      this.updateCamera(1);
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
    const known = new Set<THREE.Object3D>([w.field.group, w.trees.group, w.grass.group, w.houses.group, w.life.group, ...(w.crowd ? [w.crowd.group] : [])]);
    return {
      trees: [w.trees.group], houses: [w.houses.group], field: [w.field.group], road: w.group.children.filter((o) => !known.has(o)),
      grass: [w.grass.group], life: [w.life.group], crowd: w.crowd ? [w.crowd.group] : [], objects: this.objects ? [this.objects.group] : [],
      riders: [this.rider!.group, ...this.pool.map((r) => r.group)],
    };
  }
  /** Prüfhilfe: Spiel (Engine) */
  get engine(): Abfahrt | null { return this.eng; }

  // ------------------------------------------------------------------ Messfahrt

  private deviceInfo(): Record<string, unknown> {
    const be = this.renderer.backend as unknown as { device?: { adapterInfo?: Record<string, string> }; adapter?: { info?: Record<string, string> } };
    const ai = be.device?.adapterInfo ?? be.adapter?.info;
    const pick = ai ? { vendor: ai.vendor, architecture: ai.architecture, device: ai.device, description: ai.description } : null;
    return {
      ua: navigator.userAgent, bildschirm: `${screen.width}×${screen.height}`, pixeldichte: window.devicePixelRatio, fenster: `${window.innerWidth}×${window.innerHeight}`,
      technik: this.backendName, grafik: pick, gpu_zeitstempel: this.gpuTiming,
      // „aufloesung“ in den Verläufen: Szene (kleiner gerechnet, hochskaliert); das Bild selbst in bild_dpr
      bild_dpr: this.maxDpr, msaa: this.settings.msaa,
    };
  }

  startMeasure(extra: Record<string, unknown> = {}) {
    this.perf.startRec({
      ...extra, ...this.deviceInfo(), spiel: 'Abfahrt WebGPU', kamera_start: this._cam, stimmung: this.moodName,
      gegner_max: this.settings.oppMax, start_z: Math.round(this.eng?.p.z ?? 0), phase: this.eng?.phase, testfahrt: this.cruise, autopilot: this.autopilot,
    });
  }
  get measuring(): boolean { return !!this.perf.rec; }
  stopMeasure(): Report | null { return this.perf.stopRec(); }

  // ------------------------------------------------------------------ Einstellungen

  applySettings(s: Settings, instant = false) {
    const prev = this.settings;
    const diff = (Object.keys(s) as (keyof Settings)[]).filter((k) => s[k] !== prev[k]).map((k) => `${k}=${String(s[k])}`).join(' ');
    if (diff) this.perf.event(EV.settings, diff);
    this.settings = s;
    saveSettings(s, RACE_KEY);
    this.dprFloor = 0;
    this.atmo?.apply(s, instant);
    const md = Math.min(window.devicePixelRatio || 1, s.maxDpr);
    if (md !== this.maxDpr) { this.maxDpr = md; this.renderer.setPixelRatio(md); }
    this.setDpr(Math.max(Math.min(this.dpr, md), Math.min(s.minDpr, md)));
    const w = this.world;
    if (w) {
      if (w.crowd) w.crowd.group.visible = s.crowd;
      w.life.group.visible = s.life;
      w.grass.group.visible = s.grass;
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
    this.atmo?.dispose();
    this.frameRT?.dispose();
    this.renderer.dispose();
  }
}
