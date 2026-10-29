/**
 * Licht, Himmel, Dunst, Wetter und Farbfilter des WebGPU-Tests – gesteuert von Stimmung (mood.ts) und den
 * Einstellungen des Nutzers. Jede Stimmung hat ihren gebackenen Himmel; beim Wechsel wird die Kuppel zwischen
 * zwei Würfeln überblendet und alle Zahlen (Sonne, Dunst, Filter) gleiten in ein paar Sekunden hinüber.
 */
import * as THREE from 'three/webgpu';
import { bloom } from '../../../vendor/three/addons/BloomNode.js';
import { bakeSkyCube, makeDome, makeRain, makeSun, type SkyCube } from './sky';
import { dirOf, LIGHT_KEYS, MOOD_IDS, MOOD_U, MOODS, resolve, type Light, type MoodId, type Settings } from './mood';
import { tsl, h21, type N } from './nodes';

const { cameraPosition, dot, exp, float, fog, max, mix, normalize, positionView, positionWorld, pow, renderOutput, screenUV, screenSize, smoothstep, time, uniform, uv, vec3 } = tsl;

const CYCLE: MoodId[] = ['mittag', 'gold', 'nacht', 'morgen', 'regen'];
/** Wetterwechsel: so lange je Stimmung (s), so lange der Übergang */
const HOLD = 16;
const BLEND = 5;

export class Atmo {
  readonly sun = makeSun();
  readonly hemi = new THREE.HemisphereLight(0x8fa8d6, 0x3a3326, 0);
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  private cubes = {} as Record<MoodId, SkyCube>;
  private dome: ReturnType<typeof makeDome>;
  private rain: ReturnType<typeof makeRain>;
  private glow: THREE.Mesh;
  private glowCol = uniform(new THREE.Color(1, 0.93, 0.82));
  private glowK = uniform(1);
  private fogK = uniform(0.5);
  private fogThin = uniform(1);
  private fogSun = uniform(new THREE.Vector3(0, 1, 0));
  private hazeCol = uniform(new THREE.Color(1, 0.86, 0.68));
  // Farbfilter
  private u = {
    warm: uniform(0), sat: uniform(1), contrast: uniform(1), vignette: uniform(0), grain: uniform(0), split: uniform(0),
    splitS: uniform(new THREE.Vector3(1, 1, 1)), splitH: uniform(new THREE.Vector3(1, 1, 1)), bloom: uniform(0), bthr: uniform(4), grade: uniform(1),
  };
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
  settings: Settings;

  constructor(private renderer: THREE.WebGPURenderer, private scene: THREE.Scene, settings: Settings, size: number) {
    this.settings = settings;
    for (const id of MOOD_IDS) this.cubes[id] = bakeSkyCube(renderer, MOODS[id].sky, size);
    this.shown = settings.mood;
    this.dome = makeDome(this.cubes[this.shown].background, this.cubes[this.shown].background);
    scene.add(this.dome.mesh);
    scene.environment = this.cubes[this.shown].environment;
    scene.add(this.sun, this.sun.target, this.hemi);
    this.rain = makeRain();
    scene.add(this.rain.mesh);
    this.glow = this.makeGlow();
    scene.add(this.glow);
    this.setupFog();
    this.cur = resolve(MOODS[this.shown], settings);
    this.target = { ...this.cur };
    this.from = { ...this.cur };
    this.applyCur();
  }

  /** Nachbearbeitung: Leuchten, dann Tonkurve, dann Farbfilter im Anzeigeraum (wie im Spiel) */
  outputNode(color: N): N {
    const glow = bloom(color, this.u.bloom, 0.3, this.u.bthr);
    let col: N = renderOutput(color.add(glow)).rgb;
    const l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    const g = this.u;
    let gr: N = mix(vec3(l, l, l), col, g.sat);
    gr = gr.sub(0.5).mul(g.contrast).add(0.5);
    gr = gr.mul(vec3(g.warm.mul(0.09).add(1), g.warm.mul(0.02).add(1), float(1).sub(g.warm.mul(0.1))));
    gr = mix(gr, gr.mul(mix(g.splitS, g.splitH, smoothstep(0.12, 0.78, l))), g.split);
    col = mix(col, gr, g.grade);
    const sv = screenUV;
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
    const sky0 = mix(this.dome.cubeA.sample(look).rgb, this.dome.cubeB.sample(look).rgb, this.dome.mixT);
    const skyCol = sky0.div(max(float(1), sky0.dot(vec3(0.3, 0.55, 0.15)).div(1.4)));
    const toSun = pow(max(float(0), dot(dir, this.fogSun)), 12);
    const hz = vec3(this.hazeCol.x, this.hazeCol.y, this.hazeCol.z);
    const col = mix(skyCol.mul(0.9), hz.mul(skyCol.dot(vec3(0.3, 0.5, 0.2))), toSun.mul(0.15));
    const h = positionWorld.y.sub(cameraPosition.y);
    const thin = exp(h.max(-600).mul(float(-0.0012).mul(this.fogThin))).clamp(0.35, 2.2);
    const f = float(1).sub(exp(d.mul(-0.000085).mul(this.fogK).mul(thin))).mul(0.92);
    this.scene.fogNode = fog(col, f);
  }

  /** Einstellungen übernehmen (Stimmung weich wechseln) */
  apply(s: Settings, instant = false) {
    const moodChanged = s.mood !== this.settings.mood || (s.cycle !== this.settings.cycle);
    this.settings = s;
    this.sun.castShadow = s.shadows;
    const sh = this.sun.shadow;
    if (sh.mapSize.x !== s.shadowRes) { sh.mapSize.set(s.shadowRes, s.shadowRes); sh.map?.dispose(); sh.map = null; sh.needsUpdate = true; }
    const sc = sh.camera as THREE.OrthographicCamera;
    if (sc.right !== s.shadowRange) { sc.left = -s.shadowRange; sc.right = s.shadowRange; sc.top = s.shadowRange; sc.bottom = -s.shadowRange; sc.updateProjectionMatrix(); }
    this.u.grade.value = s.grade ? 1 : 0;
    if (!s.cycle && (moodChanged || s.mood !== this.shown)) this.goTo(s.mood, instant ? 0.01 : 1.8);
    else this.retarget(instant);
    if (s.cycle) this.hold = Math.min(this.hold, HOLD);
  }

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
      this.dome.cubeA.value = this.cubes[id].background; this.dome.cubeB.value = this.cubes[id].background; this.dome.mixT.value = 0;
      this.scene.environment = this.cubes[id].environment; this.envSwitched = true;
      this.target = resolve(MOODS[id], this.settings); this.cur = { ...this.target }; this.from = { ...this.cur };
      this.applyCur();
      return;
    }
    if (id === this.shown && !this.next) { this.retarget(false); return; }
    // Kuppel: von der gezeigten (bzw. der gerade erreichten Mischung) zur neuen
    this.dome.cubeA.value = this.cubes[this.next && this.blend > 0.5 ? this.next : this.shown].background;
    this.dome.cubeB.value = this.cubes[id].background;
    this.dome.mixT.value = 0;
    this.shown = this.next && this.blend > 0.5 ? this.next : this.shown;
    this.next = id;
    this.from = { ...this.cur };
    this.target = resolve(MOODS[id], this.settings);
    this.blend = 0;
    this.blendDur = dur;
    this.envSwitched = false;
    this.hold = 0;
  }

  /** je Bild: Wetterwechsel takten, Werte überblenden, Lichter nachführen */
  update(dt: number, camPos: THREE.Vector3) {
    if (this.settings.cycle && this.blend >= 1) {
      this.hold += dt;
      if (this.hold > HOLD) this.goTo(CYCLE[(CYCLE.indexOf(this.shown) + 1) % CYCLE.length], BLEND);
    }
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / this.blendDur);
      const k = this.blend * this.blend * (3 - 2 * this.blend);
      for (const key of LIGHT_KEYS) this.cur[key] = this.from[key] + (this.target[key] - this.from[key]) * k;
      if (this.next) {
        this.dome.mixT.value = k;
        if (!this.envSwitched && k > 0.5) { this.scene.environment = this.cubes[this.next].environment; this.envSwitched = true; }
        if (this.blend >= 1) { this.shown = this.next; this.next = null; this.dome.cubeA.value = this.cubes[this.shown].background; this.dome.mixT.value = 0; }
      }
      this.applyCur();
    }
    this.dome.mesh.position.copy(camPos);
    this.dome.mesh.updateMatrix();
    this.glow.position.copy(camPos).addScaledVector(this.sunDir, 15000);
    this.glow.lookAt(camPos);
    this.glow.scale.setScalar(this.cur.glow > 1.5 ? 700 : 1500);
  }

  private applyCur() {
    const c = this.cur;
    this.sunDir.copy(dirOf(c.elev, c.azim));
    this.fogSun.value.copy(this.sunDir);
    this.sun.intensity = c.sunI;
    this.sun.color.setRGB(c.sunR, c.sunG, c.sunB);
    this.hemi.intensity = c.hemi;
    // Streulicht des Himmels: bei tiefer Sonne in ihrer Farbe (Abendrot), sonst bläulich
    const low = Math.max(0, Math.min(1, 1 - c.elev / 30));
    this.hemi.color.setRGB(0.56 + (c.sunR - 0.56) * low, 0.66 + (c.sunG - 0.66) * low, 0.84 + (c.sunB - 0.84) * low);
    this.scene.environmentIntensity = c.env;
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
    for (const id of MOOD_IDS) this.cubes[id].dispose();
    this.sun.dispose();
    this.hemi.dispose();
    (this.dome.mesh.material as THREE.Material).dispose();
    this.dome.mesh.geometry.dispose();
    (this.rain.mesh.material as THREE.Material).dispose();
    this.rain.mesh.geometry.dispose();
  }
}
