/**
 * Licht, Himmel, Dunst, Wetter und Farbfilter des WebGPU-Tests – gesteuert von Stimmung (mood.ts) und den
 * Einstellungen des Nutzers. Jede Stimmung hat ihren gebackenen Himmel; beim Wechsel wird die Kuppel zwischen
 * zwei Würfeln überblendet und alle Zahlen (Sonne, Dunst, Filter) gleiten in ein paar Sekunden hinüber.
 */
import * as THREE from 'three/webgpu';
import { bloom } from '../../../vendor/three/addons/BloomNode.js';
import { bakeSkyCube, makeDome, makeRain, makeSun, type CloudLight, type SkyCube } from './sky';
import { dirOf, LIGHT_KEYS, MOOD_IDS, MOOD_U, MOODS, resolve, type Light, type MoodId, type Settings } from './mood';
import { tsl, h21, type N } from './nodes';
import { AMB, AMB_DIRS, AMB_KEYS, SUN } from './light';

const { abs, cameraPosition, cubeTexture, dot, exp, float, floor, fog, max, mix, normalize, pmremTexture, positionView, positionWorld, pow, renderOutput, screenUV, screenSize, select, smoothstep, time, uniform, uv, varying, vec2, vec3, vec4 } = tsl;

const LAMP = new THREE.Color(1, 0.72, 0.42);
const CYCLE: MoodId[] = ['mittag', 'gold', 'nacht', 'morgen', 'regen'];
/** Wetterwechsel: so lange je Stimmung (s), so lange der Übergang */
const HOLD = 16;
const BLEND = 5;

export class Atmo {
  readonly sun = makeSun();
  readonly hemi = new THREE.HemisphereLight(0x8fa8d6, 0x3a3326, 0);
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  /** gebackene Himmel je Stimmung und Variante (dramatisch oder nicht) – erst bei Bedarf gebacken */
  private cubes = new Map<string, SkyCube>();
  private size: number;
  // dezentes Sonnenuntergangs-Licht (Nachbearbeitung): Lage der Sonne im Bild, Stärke
  private sunScr = uniform(new THREE.Vector2(0.5, 0.3));
  private sunsetK = uniform(0);
  /** Tempo-Linien am Bildrand (0 … 1) – im Bild gerechnet statt auf einer 2D-Ebene über allem */
  private speedK = uniform(0);
  private aspect = uniform(1);
  /** im Tunnel (0 draußen … 1 tief drin): Sonne, Himmelslicht und Umgebung gedämpft */
  private tunnelK = 0;
  private tunnelApplied = 0;
  private vTmp = new THREE.Vector3();
  private vFwd = new THREE.Vector3();
  private dome: ReturnType<typeof makeDome>;
  private rain: ReturnType<typeof makeRain>;
  private glow: THREE.Mesh;
  private glowCol = uniform(new THREE.Color(1, 0.93, 0.82));
  private glowK = uniform(1);
  // Dunst aus dem blanken Himmel (ohne gebackene Wolken), gleiche Überblendung wie die Kuppel
  private fogA: N;
  private fogB: N;
  private fogK = uniform(0.5);
  /** hellster Dunst (Luminanz): gegen die tiefe Sonne sonst fast weiß (Prüfwert: ?fogmax=) */
  private fogMax = uniform(Number(/[?&]fogmax=([0-9.]+)/.exec(location.search)?.[1] ?? 1.4));
  private fogThin = uniform(1);
  private fogSun = uniform(new THREE.Vector3(0, 1, 0));
  private hazeCol = uniform(new THREE.Color(1, 0.86, 0.68));
  /**
   * Umgebungslicht der günstigen Materialien (light.ts): je Stimmung einmal den vorgefilterten Himmel in sechs
   * Richtungen messen (winziges Bild auf der Grafikkarte, dann zurücklesen) – je Bild nur noch Zahlen überblenden
   */
  private ambOf = new Map<MoodId, Float32Array>();
  private ambBusy = new Set<MoodId>();
  private probe: { rt: THREE.RenderTarget; quad: THREE.QuadMesh; env: N } | null = null;
  /** Nachschärfen nach dem Hochskalieren (Szene in kleinerer Auflösung): Stärke, Bildpunktgröße der Szene */
  readonly sharp = uniform(0);
  readonly texel = uniform(new THREE.Vector2(1 / 1000, 1 / 1000));
  // Farbfilter
  private u = {
    warm: uniform(0), sat: uniform(1), contrast: uniform(1), vignette: uniform(0), grain: uniform(0), split: uniform(0),
    splitS: uniform(new THREE.Vector3(1, 1, 1)), splitH: uniform(new THREE.Vector3(1, 1, 1)), bloom: uniform(0), bthr: uniform(4), grade: uniform(1),
  };
  /** was gerade sichtbar ist (für die Messfahrt: Regen, Sonnenhof) */
  get visState(): string { return `regen ${this.rain.mesh.visible ? 'an' : 'aus'}, hof ${this.glow.visible ? 'an' : 'aus'}`; }
  /** Leuchten sichtbar? (sonst die Bildkette ohne Weichzeichner) */
  get bloomOn(): boolean { return this.u.bloom.value > 0.004; }
  /** aktuelle (überblendete) Werte */
  cur: Light;
  private target: Light;
  private from: Light;
  private blend = 1;
  private blendDur = 1.5;
  private shown: MoodId;
  private next: MoodId | null = null;
  private envSwitched = true;
  private hold = 0;
  /**
   * Umgebungslicht als fester Knoten, dessen Textur getauscht wird: ein neues scene.environment ließe three.js
   * alle Materialien neu bauen (knapp 1 s Stillstand auf dem iPhone mitten im Stimmungswechsel)
   */
  private envNode: N;
  settings: Settings;

  /**
   * @param eager alle Himmel gleich backen (Testbild: Stimmungswechsel ohne Wartezeit); sonst nur den gezeigten,
   *   die übrigen kurz vor Gebrauch
   */
  constructor(private renderer: THREE.WebGPURenderer, private scene: THREE.Scene, settings: Settings, size: number, eager = true) {
    this.settings = settings;
    this.size = size;
    this.shown = settings.mood;
    if (eager || settings.cycle) for (const id of MOOD_IDS) this.cube(id);
    this.dome = makeDome(this.cube(this.shown).background, this.cube(this.shown).background);
    this.fogA = cubeTexture(this.cube(this.shown).plain);
    this.fogB = cubeTexture(this.cube(this.shown).plain);
    scene.add(this.dome.mesh);
    this.envNode = pmremTexture(this.cube(this.shown).environment);
    scene.environmentNode = this.envNode;
    scene.add(this.sun, this.sun.target, this.hemi);
    this.rain = makeRain();
    scene.add(this.rain.mesh);
    this.glow = this.makeGlow();
    scene.add(this.glow);
    this.setupFog();
    this.measureAmbient(this.shown);
    this.cur = resolve(MOODS[this.shown], settings);
    this.target = { ...this.cur };
    this.from = { ...this.cur };
    this.applyCur();
  }

  /** Himmel einer Stimmung in der eingestellten Variante (gebacken beim ersten Gebrauch) */
  private cube(id: MoodId, drama = this.settings.drama): SkyCube {
    const key = `${id}|${drama ? 1 : 0}`;
    let c = this.cubes.get(key);
    if (!c) {
      const m = MOODS[id];
      const L: CloudLight | undefined = drama ? { elev: m.light.elev, azim: m.light.azim, r: m.light.sunR, g: m.light.sunG, b: m.light.sunB } : undefined;
      c = bakeSkyCube(this.renderer, m.sky, this.size, L);
      this.cubes.set(key, c);
    }
    return c;
  }

  /** Umgebungslicht einer Stimmung messen – im nächsten Bild (direkt nach dem Backen kam das Zurücklesen nie an) */
  private ambQueue = new Set<MoodId>();
  private measureAmbient(id: MoodId) {
    if (this.ambOf.has(id) || this.ambBusy.has(id) || this.ambQueue.has(id)) return;
    this.ambQueue.add(id);
    // außerhalb des Bildaufrufs (dort wurde das Zurücklesen in Chrome nie fertig)
    window.setTimeout(() => { this.ambQueue.delete(id); if (!this.disposed) this.runAmbient(id); }, 30);
  }
  private disposed = false;

  private runAmbient(id: MoodId) {
    if (this.ambOf.has(id) || this.ambBusy.has(id)) return;
    const r = this.renderer;
    const envTex = this.cube(id).environment;
    if (!this.probe) {
      const rt = new THREE.RenderTarget(6, 1, { type: THREE.FloatType, depthBuffer: false });
      const ix = floor(uv().x.mul(6));
      const d = AMB_DIRS.map(([x, y, z]) => vec3(x, y, z));
      const dir = select(ix.lessThan(0.5), d[0], select(ix.lessThan(1.5), d[1], select(ix.lessThan(2.5), d[2], select(ix.lessThan(3.5), d[3], select(ix.lessThan(4.5), d[4], d[5])))));
      const env = pmremTexture(envTex, dir, float(1));
      const m = new THREE.MeshBasicNodeMaterial();
      m.fragmentNode = vec4(env.rgb, 1);
      this.probe = { rt, quad: new THREE.QuadMesh(m), env };
    }
    const P = this.probe;
    P.env.value = envTex;
    const prev = r.getRenderTarget();
    r.setRenderTarget(P.rt);
    P.quad.render(r);
    r.setRenderTarget(prev);
    this.ambBusy.add(id);
    // falls das Zurücklesen hängt: nach 8 s neu versuchen (hinter dem Backen eines Himmels kann es dauern)
    const retry = window.setTimeout(() => { if (this.ambBusy.delete(id)) this.measureAmbient(id); }, 8000);
    void r.readRenderTargetPixelsAsync(P.rt, 0, 0, 6, 1).then((px) => {
      window.clearTimeout(retry);
      if (!this.ambBusy.has(id)) return;
      const a = px as unknown as ArrayLike<number>;
      const f = new Float32Array(18);
      for (let i = 0; i < 6; i++) for (let c = 0; c < 3; c++) f[i * 3 + c] = Math.max(0, Number(a[i * 4 + c]) || 0);
      this.ambOf.set(id, f);
      this.ambBusy.delete(id);
      this.updateAmbient();
    }).catch((e: unknown) => { this.ambBusy.delete(id); console.warn("[atmo] Umgebungslicht nicht gemessen", e); });
  }

  /** Umgebungslicht (AMB) aus den gemessenen Stimmungen, überblendet, mit Stärke der Stimmung und Tunnel */
  private updateAmbient() {
    const a = this.ambOf.get(this.shown) ?? this.ambOf.get(this.next ?? this.shown);
    const b = this.next ? this.ambOf.get(this.next) ?? a : a;
    if (!a || !b) return;
    const k = this.next ? this.dome.mixT.value : 0;
    const env = this.cur.env * (1 - 0.8 * this.tunnelApplied);
    AMB_KEYS.forEach((key, i) => {
      const c = AMB[key].value as THREE.Color;
      c.setRGB((a[i * 3] + (b[i * 3] - a[i * 3]) * k) * env, (a[i * 3 + 1] + (b[i * 3 + 1] - a[i * 3 + 1]) * k) * env, (a[i * 3 + 2] + (b[i * 3 + 2] - a[i * 3 + 2]) * k) * env);
    });
  }

  /** Nachbearbeitung: Leuchten, dann Tonkurve, dann Farbfilter im Anzeigeraum (wie im Spiel) */
  outputNode(color: N, withBloom = true): N {
    const glow = withBloom ? bloom(color, this.u.bloom, 0.3, this.u.bthr) : null;
    // Szene kleiner gerechnet als angezeigt: beim Hochskalieren leicht nachschärfen (vier Nachbarn)
    const t = this.texel;
    const nb = color.sample(screenUV.add(vec2(t.x, 0))).add(color.sample(screenUV.sub(vec2(t.x, 0))))
      .add(color.sample(screenUV.add(vec2(0, t.y)))).add(color.sample(screenUV.sub(vec2(0, t.y))));
    const sharp = color.add(color.sub(nb.mul(0.25)).mul(this.sharp)).max(0);
    let col: N = renderOutput(glow ? sharp.add(glow) : sharp).rgb;
    const l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    const g = this.u;
    let gr: N = mix(vec3(l, l, l), col, g.sat);
    gr = gr.sub(0.5).mul(g.contrast).add(0.5);
    gr = gr.mul(vec3(g.warm.mul(0.09).add(1), g.warm.mul(0.02).add(1), float(1).sub(g.warm.mul(0.1))));
    gr = mix(gr, gr.mul(mix(g.splitS, g.splitH, smoothstep(0.12, 0.78, l))), g.split);
    col = mix(col, gr, g.grade);
    const sv = screenUV;
    // Sonnenuntergangs-Licht: warmer Schein um die tiefe Sonne, ein feiner waagrechter Lichtstreif durch sie und
    // ein Hauch Wärme im ganzen Bild – nur Rechnungen mit festen Werten, kein weiterer Durchgang (aus = Stärke 0)
    const sk = this.sunsetK;
    const dd = sv.sub(this.sunScr).mul(vec2(this.aspect, 1));
    const halo = exp(dd.length().mul(-2.4)).mul(0.6).add(exp(dd.length().mul(-9)).mul(0.5));
    const streak = exp(abs(dd.y).mul(-46)).mul(exp(abs(dd.x).mul(-1.4))).mul(0.4);
    const wc = vec3(1, 0.6, 0.3);
    col = col.add(wc.mul(halo.add(streak)).mul(sk.mul(0.22)).mul(float(1).sub(l.mul(0.55))));
    col = mix(col, col.mul(vec3(1.05, 0.995, 0.93)), sk.mul(0.7));
    // Tempo-Linien (wie im Spiel): helle Striche, die vom Bildrand nach außen fliegen; unten in der Mitte (Fahrer) keine
    {
      const c = sv.sub(vec2(0.5, 0.42)).mul(vec2(this.aspect, 1));
      const r = c.length();
      const ang = tsl.atan(c.y, c.x).div(Math.PI * 2).add(0.5);
      const N = 44;
      const sec = ang.mul(N);
      const id = tsl.floor(sec);
      const h = h21(vec2(id, 3.1));
      const h2 = h21(vec2(id, 7.7));
      const ph = tsl.fract(time.mul(h.mul(1.1).add(1.4)).add(h2));
      const r0 = ph.mul(0.45).add(0.42);
      const len = this.speedK.mul(0.07).add(0.05);
      const seg = smoothstep(r0, r0.add(0.012), r).mul(float(1).sub(smoothstep(r0.add(len).sub(0.02), r0.add(len), r)));
      const dl = abs(tsl.fract(sec).sub(0.5)).mul((Math.PI * 2) / N).mul(r).mul(screenSize.y);
      const thin = float(1).sub(smoothstep(0.6, 1.4, dl));
      const below = smoothstep(0.15, 0.25, c.y.div(max(r, float(1e-3)))).mul(float(1).sub(smoothstep(0.45, 0.55, abs(c.x).div(max(r, float(1e-3))))));
      const on = smoothstep(0.7, 0.72, h);
      col = col.add(vec3(1, 1, 1).mul(this.speedK.mul(0.2)).mul(on).mul(seg).mul(thin).mul(float(1).sub(below)));
    }
    const v = smoothstep(1.25, 0.4, sv.sub(0.5).mul(vec3(1, 1.3, 0).xy).length());
    col = col.mul(mix(float(1), v, g.vignette));
    const n = h21(sv.mul(screenSize).add(time.fract().mul(vec3(31.7, 17.3, 0).xy))).sub(0.5);
    col = col.add(n.mul(g.grain).mul(0.09).mul(float(1).sub(l.mul(0.6))));
    return tsl.vec4(col.clamp(0, 1), 1);
  }

  /** Sonne/Mond: helle Scheibe mit weichem Hof, weit weg in Lichtrichtung */
  private makeGlow(): THREE.Mesh {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    m.fog = false;
    const r = uv().sub(0.5).mul(2).length();
    const core = smoothstep(0.085, 0.06, r).mul(60);
    const halo = exp(r.mul(-7)).mul(1.1).add(exp(r.mul(-22)).mul(5));
    m.colorNode = vec3(this.glowCol.x, this.glowCol.y, this.glowCol.z).mul(core.add(halo).mul(float(1).sub(smoothstep(0.85, 1, r)))).mul(this.glowK);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    return mesh;
  }

  /** Luftperspektive: Dunst in der Farbe des Himmels in Blickrichtung (zur Sonne hin wärmer), mit der Höhe dünner */
  private setupFog() {
    const dir = normalize(positionWorld.sub(cameraPosition));
    const d = positionView.length();
    const look = vec3(dir.x, max(dir.y, float(0.03)), dir.z).normalize();
    const sky0 = mix(this.fogA.sample(look).rgb, this.fogB.sample(look).rgb, this.dome.mixT);
    const skyCol = sky0.div(max(float(1), sky0.dot(vec3(0.3, 0.55, 0.15)).div(this.fogMax)));
    const toSun = pow(max(float(0), dot(dir, this.fogSun)), 12);
    const hz = vec3(this.hazeCol.x, this.hazeCol.y, this.hazeCol.z);
    const col = mix(skyCol.mul(0.9), hz.mul(skyCol.dot(vec3(0.3, 0.5, 0.2))), toSun.mul(0.15));
    const h = positionWorld.y.sub(cameraPosition.y);
    const thin = exp(h.max(-600).mul(float(-0.0012).mul(this.fogThin))).clamp(0.35, 2.2);
    const f = float(1).sub(exp(d.mul(-0.000085).mul(this.fogK).mul(thin))).mul(0.92);
    // je Ecke gerechnet (Dunst ändert sich über eine Fläche kaum): spart je Bildpunkt zwei Würfelzugriffe
    this.scene.fogNode = fog(varying(col, 'vFogCol'), varying(f, 'vFogF'));
  }

  /** Einstellungen übernehmen (Stimmung weich wechseln) */
  apply(s: Settings, instant = false) {
    const moodChanged = s.mood !== this.settings.mood || (s.cycle !== this.settings.cycle);
    const dramaChanged = s.drama !== this.settings.drama;
    this.settings = s;
    if (dramaChanged) this.swapVariant();
    // Schatten an/aus ohne Neubau der Materialien: die Karte bleibt angeschlossen, aus = Stärke 0 und kein Durchgang
    this.sun.castShadow = true;
    this.sun.shadow.intensity = s.shadows ? 1 : 0;
    this.sun.shadow.autoUpdate = s.shadows;
    const sh = this.sun.shadow;
    // three.js passt die Schattenkarte selbst an (nicht wegwerfen: sie steckt noch im laufenden Bild)
    if (sh.mapSize.x !== s.shadowRes) sh.mapSize.set(s.shadowRes, s.shadowRes);
    const sc = sh.camera as THREE.OrthographicCamera;
    if (sc.right !== s.shadowRange) { sc.left = -s.shadowRange; sc.right = s.shadowRange; sc.top = s.shadowRange; sc.bottom = -s.shadowRange; sc.updateProjectionMatrix(); }
    this.u.grade.value = s.grade ? 1 : 0;
    if (!s.cycle && (moodChanged || s.mood !== this.shown)) this.goTo(s.mood, instant ? 0.01 : 1.8);
    else this.retarget(instant);
    if (s.cycle) this.hold = Math.min(this.hold, HOLD);
  }

  /** Kuppel und Dunst: Würfel A (von) und B (nach) setzen */
  private setSky(a: MoodId, b: MoodId) {
    const ca = this.cube(a), cb = this.cube(b);
    this.dome.cubeA.value = ca.background; this.dome.cubeB.value = cb.background;
    this.fogA.value = ca.plain; this.fogB.value = cb.plain;
  }

  /** dramatischer Himmel an/aus: die Würfel der gezeigten (und kommenden) Stimmung sofort tauschen */
  private swapVariant() {
    this.setSky(this.shown, this.next ?? this.shown);
    this.envNode.value = this.cube(this.envSwitched && this.next ? this.next : this.shown).environment;
  }

  /** Tempo-Linien: 0 aus … 1 voll */
  setSpeed(k: number) { this.speedK.value = Math.max(0, Math.min(1, k)); }

  /** Tunnel: 0 draußen … 1 tief drin (Licht von außen weg, Lampenlicht warm) */
  setTunnel(k: number) { this.tunnelK = Math.max(0, Math.min(1, k)); }

  /** Zielwerte neu aus Stimmung + Reglern (der Himmel bleibt) */
  private retarget(instant: boolean) {
    const id = this.next ?? this.shown;
    this.target = resolve(MOODS[id], this.settings);
    if (instant || this.blend >= 1) { this.from = { ...this.cur }; this.blend = instant ? 1 : 0; this.blendDur = 0.6; }
    if (instant) { this.cur = { ...this.target }; this.applyCur(); }
  }

  private goTo(id: MoodId, dur: number) {
    if (dur <= 0.02) {
      // sofort (Prüfbilder, Start)
      this.shown = id; this.next = null; this.blend = 1; this.hold = 0;
      this.setSky(id, id); this.dome.mixT.value = 0;
      this.envNode.value = this.cube(id).environment; this.envSwitched = true;
      this.measureAmbient(id);
      this.target = resolve(MOODS[id], this.settings); this.cur = { ...this.target }; this.from = { ...this.cur };
      this.applyCur();
      return;
    }
    if (id === this.shown && !this.next) { this.retarget(false); return; }
    // Kuppel: von der gezeigten (bzw. der gerade erreichten Mischung) zur neuen
    this.setSky(this.next && this.blend > 0.5 ? this.next : this.shown, id);
    this.dome.mixT.value = 0;
    this.shown = this.next && this.blend > 0.5 ? this.next : this.shown;
    this.next = id;
    this.from = { ...this.cur };
    this.target = resolve(MOODS[id], this.settings);
    this.blend = 0;
    this.blendDur = dur;
    this.envSwitched = false;
    this.hold = 0;
    this.measureAmbient(id);
  }

  /** je Bild: Wetterwechsel takten, Werte überblenden, Lichter nachführen (cam: für das Sonnenuntergangs-Licht) */
  update(dt: number, camPos: THREE.Vector3, cam?: THREE.PerspectiveCamera) {
    if (this.settings.cycle && this.blend >= 1) {
      this.hold += dt;
      const nextId = CYCLE[(CYCLE.indexOf(this.shown) + 1) % CYCLE.length];
      // den nächsten Himmel ein paar Sekunden vorher backen (nicht im Moment des Wechsels)
      if (this.hold > HOLD - 3) { this.cube(nextId); this.measureAmbient(nextId); }
      if (this.hold > HOLD) this.goTo(nextId, BLEND);
    }
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / this.blendDur);
      const k = this.blend * this.blend * (3 - 2 * this.blend);
      for (const key of LIGHT_KEYS) this.cur[key] = this.from[key] + (this.target[key] - this.from[key]) * k;
      if (this.next) {
        this.dome.mixT.value = k;
        if (!this.envSwitched && k > 0.5) { this.envNode.value = this.cube(this.next).environment; this.envSwitched = true; }
        if (this.blend >= 1) { this.shown = this.next; this.next = null; this.setSky(this.shown, this.shown); this.dome.mixT.value = 0; }
      }
      this.applyCur();
    } else if (Math.abs(this.tunnelK - this.tunnelApplied) > 0.003) this.applyCur();
    if (cam) this.updateSunset(cam, dt);
    this.dome.mesh.position.copy(camPos);
    this.dome.mesh.updateMatrix();
    this.glow.position.copy(camPos).addScaledVector(this.sunDir, 15000);
    this.glow.lookAt(camPos);
    this.glow.scale.setScalar(this.cur.glow > 1.5 ? 700 : 1500);
  }

  /** Sonnenuntergangs-Licht: Sonne ins Bild rechnen, Stärke nach Sonnenhöhe, Blickrichtung, Schalter, Tunnel */
  private updateSunset(cam: THREE.PerspectiveCamera, dt: number) {
    const c = this.cur;
    const lowK = Math.max(0, Math.min(1, 1 - (c.elev - 3) / 22)) * Math.max(0, Math.min(1, (c.elev + 4) / 5));
    const isSun = c.glow > 0.01 && c.glow < 1.5 ? 1 : 0;
    cam.getWorldDirection(this.vFwd);
    const facing = this.vFwd.dot(this.sunDir);
    const vis = Math.max(0, Math.min(1, (facing + 0.15) / 0.6));
    const k = (this.settings.sunset ? 1 : 0) * lowK * isSun * (1 - c.rain) * (1 - this.tunnelK) * (0.35 + 0.65 * vis);
    // weich nachführen (Kamerawechsel), ohne Zeit (Prüfbild, Start) sofort
    this.sunsetK.value = dt <= 0 ? k : this.sunsetK.value + (k - this.sunsetK.value) * Math.min(1, dt * 5);
    if (this.sunsetK.value < 0.002 && k === 0) this.sunsetK.value = 0;
    this.vTmp.copy(cam.position).addScaledVector(this.sunDir, 1000).project(cam);
    // hinter der Kamera: Richtung beibehalten, weit aus dem Bild schieben
    if (facing < 0) this.vTmp.multiplyScalar(-4);
    this.sunScr.value.set(this.vTmp.x * 0.5 + 0.5, 0.5 - this.vTmp.y * 0.5);
    this.aspect.value = cam.aspect;
  }

  private applyCur() {
    const c = this.cur;
    const tk = (this.tunnelApplied = this.tunnelK);
    this.sunDir.copy(dirOf(c.elev, c.azim));
    this.fogSun.value.copy(this.sunDir);
    this.sun.intensity = c.sunI * (1 - tk);
    this.sun.color.setRGB(c.sunR, c.sunG, c.sunB);
    // im Tunnel: das Himmelslicht wird zum warmen Lampenlicht
    this.hemi.intensity = c.hemi * (1 - tk) + 0.55 * tk;
    // Streulicht des Himmels: bei tiefer Sonne in ihrer Farbe (Abendrot), sonst bläulich
    const low = Math.max(0, Math.min(1, 1 - c.elev / 30));
    this.hemi.color.setRGB(0.56 + (c.sunR - 0.56) * low, 0.66 + (c.sunG - 0.66) * low, 0.84 + (c.sunB - 0.84) * low).lerp(LAMP, tk);
    this.scene.environmentIntensity = c.env * (1 - 0.8 * tk);
    this.updateAmbient();
    SUN.dir.value.copy(this.sunDir);
    (SUN.col.value as THREE.Color).setRGB(c.sunR, c.sunG, c.sunB).multiplyScalar(c.sunI * (1 - tk));
    this.renderer.toneMappingExposure = c.exposure;
    this.fogK.value = c.fog;
    this.fogThin.value = c.fogThin;
    this.hazeCol.value.setRGB(c.sunR, c.sunG * 0.9, c.sunB * 0.75);
    const u = this.u;
    u.warm.value = c.warm; u.sat.value = c.sat; u.contrast.value = c.contrast; u.vignette.value = c.vignette; u.grain.value = c.grain;
    u.split.value = c.split; u.splitS.value.set(c.sR, c.sG, c.sB); u.splitH.value.set(c.hR, c.hG, c.hB);
    u.bloom.value = c.bloom; u.bthr.value = c.bthr;
    this.dome.night.value = c.night;
    MOOD_U.night.value = c.night;
    MOOD_U.wet.value = c.wet;
    MOOD_U.rain.value = c.rain;
    this.rain.strength.value = c.rain;
    this.rain.mesh.visible = c.rain > 0.01;
    this.glowK.value = c.glow > 1.5 ? 0.35 : c.glow;
    this.glowCol.value.setRGB(c.glow > 1.5 ? 0.85 : 1, c.glow > 1.5 ? 0.9 : 0.93, c.glow > 1.5 ? 1 : 0.82);
    this.glow.visible = c.glow > 0.01;
  }

  dispose() {
    this.disposed = true;
    for (const c of this.cubes.values()) c.dispose();
    this.cubes.clear();
    this.sun.dispose();
    this.hemi.dispose();
    (this.dome.mesh.material as THREE.Material).dispose();
    this.dome.mesh.geometry.dispose();
    (this.rain.mesh.material as THREE.Material).dispose();
    this.rain.mesh.geometry.dispose();
  }
}
