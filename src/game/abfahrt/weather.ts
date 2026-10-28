/**
 * Wetter und Licht der Spielwelten: Tageszeit, Sonnenschatten und eine Nachbearbeitung zwischen Szene und Leinwand.
 *
 * Drei Stimmungen, die sich über den Tag abwechseln (siehe weatherForRun):
 *  - Goldene Stunde: tiefe Sonne, lange Schatten, Leuchten, Lichtstrahlen, warme Lichter und kühle Schatten
 *  - Wetterumschwung: Gewitterdecke, ziehende Wolkenschatten, Nebel im Tal, kalt und entsättigt
 *  - Nebel am Pass: Nebelbänke, weiches Licht, gedämpfte Farben
 *
 * Aufbau: Die Szene wird in ein Bild mit Tiefe gezeichnet. Daraus entstehen in Viertelauflösung das Leuchten
 * (helle Anteile, zweimal weichgezeichnet) und die Lichtstrahlen (Himmelsmaske, radial zur Sonne verwischt).
 * Der letzte Durchgang setzt alles zusammen: Himmel mit Wolken und Sonne (wo das Tiefenbild leer ist),
 * Wolkenschatten und Nebelbänke (aus der Weltposition je Bildpunkt), Leuchten, Strahlen, dann Tonwertkurve,
 * Farbkorrektur, Vignette und Korn.
 *
 * Ein- und ausschaltbar im Pausenmenü (gfxOpts.ts), anfangs aus: „Lichtfilter & Wetter“ (alles hier außer den
 * Schatten – ausgeschaltet gilt das Licht des Spiels ohne Wetter) und „Sonnenschatten“. Umschalten übersetzt
 * die Shader neu (ein kurzer Halt im Menü, nicht während der Fahrt).
 *
 * Leistung: je nach gespeicherter Grafikstufe des Geräts (quality.ts) – hoch: Schatten 2048 und Nachbearbeitung
 * mit 4× Kantenglättung; mittel: Schatten 1024, 2×; niedrig: Schatten 1024, nur Licht und Tageszeit, keine
 * Nachbearbeitung. Sinkt die Auflösung während der Fahrt stark, schaltet die Nachbearbeitung ab.
 */
import * as THREE from 'three';
import type { RaceView } from './engine';
import { MOUNTAIN_FINISH, SPRINT_FINISH } from './track';
import { berlinDayKey } from './rng';
import { storedQuality } from './quality';
import { gfxOn, onGfxChange } from './gfxOpts';

export type WeatherId = 'gold' | 'storm' | 'nebel';

export interface Weather {
  id: WeatherId;
  name: string;
  /** Tageszeit am Start und am Ende der Fahrt (0 Mittag … 0,7 Sonnenuntergang) */
  tod: [number, number];
  bloom: number;
  bloomThreshold: number;
  rays: number;
  clouds: number;
  /** 0 Himmel wie im Spiel, 1 Quellwolken und tiefes Blau, 2 Gewitterdecke */
  sky: 0 | 1 | 2;
  fogBank: number;
  fogBankH: number;
  exposure: number;
  contrast: number;
  sat: number;
  warm: number;
  split: number;
  splitS: [number, number, number];
  splitH: [number, number, number];
  vignette: number;
  grain: number;
}

export const WEATHERS: Record<WeatherId, Weather> = {
  gold: {
    id: 'gold', name: 'Goldene Stunde', tod: [0.4, 0.56],
    bloom: 0.3, bloomThreshold: 0.85, rays: 0.8, clouds: 0.3, sky: 1, fogBank: 0, fogBankH: 10,
    exposure: 1.02, contrast: 1.18, sat: 1.06, warm: 0.45, split: 0.6, splitS: [0.86, 0.93, 1.12], splitH: [1.1, 1.0, 0.86],
    vignette: 0.4, grain: 0.12,
  },
  storm: {
    id: 'storm', name: 'Wetterumschwung', tod: [0.5, 0.6],
    bloom: 0.25, bloomThreshold: 0.8, rays: 1.0, clouds: 1.0, sky: 2, fogBank: 0.4, fogBankH: 12,
    exposure: 0.95, contrast: 1.26, sat: 0.74, warm: -0.6, split: 0.7, splitS: [0.82, 0.9, 1.1], splitH: [1.0, 0.98, 0.9],
    vignette: 0.55, grain: 0.2,
  },
  nebel: {
    id: 'nebel', name: 'Nebel am Pass', tod: [0.5, 0.58],
    bloom: 0.3, bloomThreshold: 0.75, rays: 0.9, clouds: 0.3, sky: 2, fogBank: 1.0, fogBankH: 16,
    exposure: 1.0, contrast: 1.05, sat: 0.8, warm: -0.2, split: 0, splitS: [1, 1, 1], splitH: [1, 1, 1],
    vignette: 0.4, grain: 0.12,
  },
};

// ------------------------------------------------------------------ Reihenfolge über den Tag

/** Abfolge je Tag: fünf Fahrten Goldene Stunde, dann Wetterumschwung und Nebel je zweimal im Wechsel, dann von vorn */
const CYCLE: WeatherId[] = ['gold', 'gold', 'gold', 'gold', 'gold', 'storm', 'nebel', 'storm', 'nebel'];

/** Wetter der n-ten Fahrt des Tages (1 = erste) */
export function weatherForRun(n: number): WeatherId {
  return CYCLE[(Math.max(1, Math.floor(n)) - 1) % CYCLE.length];
}

/** Name des Wetters der nächsten Fahrt (für die Startkarte), null wenn abgeschaltet */
export function nextWeatherName(): string | null {
  const fixed = weatherOverride();
  if (fixed === 'none' || (!fixed && !gfxOn('licht'))) return null;
  // ohne Nachbearbeitung gibt es nur das Licht der Goldenen Stunde (siehe WeatherFx.choose)
  const id = gfxTier() === 'low' ? 'gold' : fixed ?? weatherForRun(runsToday() + 1);
  return WEATHERS[id].name;
}

const LS_DAY = 'gruppetto.wetter.day';
const LS_RUNS = 'gruppetto.wetter.runs';

/** bisher gestartete Fahrten heute (alle Spiele zusammen) */
export function runsToday(day = berlinDayKey()): number {
  try {
    if (localStorage.getItem(LS_DAY) !== day) return 0;
    return Number(localStorage.getItem(LS_RUNS)) || 0;
  } catch { return 0; }
}

export function noteRunStart(day = berlinDayKey()): number {
  const n = runsToday(day) + 1;
  try { localStorage.setItem(LS_DAY, day); localStorage.setItem(LS_RUNS, String(n)); } catch { /* kein Speicher */ }
  return n;
}

/** feste Vorgabe aus der Adresse (?wetter=gold|storm|nebel|none), sonst null */
export function weatherOverride(): WeatherId | 'none' | null {
  const m = /[?&]wetter=(gold|storm|nebel|none)\b/.exec(window.location.search);
  return m ? (m[1] as WeatherId | 'none') : null;
}

// ------------------------------------------------------------------ Grafikstufe

export type GfxTier = 'high' | 'mid' | 'low';

export function gfxTier(): GfxTier {
  if (/[?&](lowgfx|nogl)\b/.test(window.location.search)) return 'low';
  const q = storedQuality();
  return q >= 0.8 ? 'high' : q >= 0.6 ? 'mid' : 'low';
}

// ------------------------------------------------------------------ Shader

const VERT = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

const NOISE = `
float hash21( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
float vnoise( vec2 p ) {
	vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
	float a = hash21( i ), b = hash21( i + vec2( 1.0, 0.0 ) ), c = hash21( i + vec2( 0.0, 1.0 ) ), d = hash21( i + vec2( 1.0, 1.0 ) );
	return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
float fbm( vec2 p ) { float s = 0.0; float a = 0.5; for ( int i = 0; i < 4; i ++ ) { s += a * vnoise( p ); p = p * 2.03 + vec2( 17.1, 9.7 ); a *= 0.5; } return s; }`;

const GEOM = `
uniform mat4 uInvProj, uCamWorld;
uniform vec3 uCamPos;
uniform float uNear, uFar;
float linZ( float d ) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / ( uFar + uNear - z * ( uFar - uNear ) ); }
vec3 worldAt( vec2 uv, float d ) { vec4 v = uInvProj * vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 ); v /= v.w; return ( uCamWorld * vec4( v.xyz, 1.0 ) ).xyz; }
/* einzelne Bildpunkte der Szene können ungültig sein (NaN) – die dürfen sich übers Leuchten nicht ausbreiten */
vec3 fixc( vec3 c ) { if ( any( isnan( c ) ) || any( isinf( c ) ) ) return vec3( 0.0 ); return clamp( c, 0.0, 64.0 ); }
vec3 sceneAt( sampler2D t, vec2 uv ) { return fixc( texture2D( t, uv ).rgb ); }`;

/** Viertelbild: helle Anteile (fürs Leuchten) im RGB, Himmelsmaske mit Sonnenglühen (für Strahlen) im Alpha */
const DOWN_FRAG = `${GEOM}
uniform sampler2D tScene, tDepth; uniform vec3 uSunDir; uniform float uThreshold; uniform vec2 uTexel; varying vec2 vUv;
void main() {
	vec3 c = ( sceneAt( tScene, vUv + uTexel * vec2( -0.5, -0.5 ) ) + sceneAt( tScene, vUv + uTexel * vec2( 0.5, -0.5 ) )
		+ sceneAt( tScene, vUv + uTexel * vec2( -0.5, 0.5 ) ) + sceneAt( tScene, vUv + uTexel * vec2( 0.5, 0.5 ) ) ) * 0.25;
	float l = max( max( c.r, c.g ), c.b );
	vec3 b = c * smoothstep( uThreshold, uThreshold + 0.6, l );
	float d = texture2D( tDepth, vUv ).r;
	float m = 0.0;
	if ( d >= 0.99999 ) { vec3 dir = normalize( worldAt( vUv, d ) - uCamPos ); float sd = max( dot( dir, uSunDir ), 0.0 ); m = 0.22 + 1.3 * pow( sd, 10.0 ); }
	gl_FragColor = vec4( b, m );
}`;

const BLUR_FRAG = `uniform sampler2D tIn; uniform vec2 uDir; varying vec2 vUv;
void main() {
	vec4 s = texture2D( tIn, vUv ) * 0.227;
	s += ( texture2D( tIn, vUv + uDir ) + texture2D( tIn, vUv - uDir ) ) * 0.194;
	s += ( texture2D( tIn, vUv + uDir * 2.0 ) + texture2D( tIn, vUv - uDir * 2.0 ) ) * 0.121;
	s += ( texture2D( tIn, vUv + uDir * 3.0 ) + texture2D( tIn, vUv - uDir * 3.0 ) ) * 0.054;
	s += ( texture2D( tIn, vUv + uDir * 4.0 ) + texture2D( tIn, vUv - uDir * 4.0 ) ) * 0.017;
	gl_FragColor = s;
}`;

const RAYS_FRAG = `uniform sampler2D tIn; uniform vec2 uSun; uniform vec4 uChan; uniform float uDensity, uDecay, uWeight; varying vec2 vUv;
void main() {
	vec2 d = ( vUv - uSun ) * uDensity / 24.0;
	vec2 p = vUv; float w = 1.0; float s = 0.0;
	for ( int i = 0; i < 24; i ++ ) { p -= d; s += dot( texture2D( tIn, p ), uChan ) * w; w *= uDecay; }
	gl_FragColor = vec4( s * uWeight, 0.0, 0.0, 1.0 );
}`;

const COMP_FRAG = `${GEOM}
${NOISE}
#include <common>
uniform sampler2D tScene, tDepth, tBloom, tRays;
uniform vec2 uRes, uSunUv;
uniform vec3 uSunDir, uSunCol, uFogCol, uSkyTop, uSkyHz, uSplitS, uSplitH;
uniform float uSunVis, uTime;
uniform float uBloom, uRays, uClouds, uSky, uFogBank, uFogBankH;
uniform float uExposure, uContrast, uSat, uWarm, uSplit, uVignette, uGrain;
varying vec2 vUv;

vec3 skyDrama( vec3 base, vec3 dir ) {
	float e = clamp( dir.y, 0.0, 1.0 );
	float sd = max( dot( dir, uSunDir ), 0.0 );
	bool storm = uSky > 1.5;
	vec3 top = storm ? vec3( 0.075, 0.085, 0.11 ) : uSkyTop * vec3( 0.5, 0.66, 1.0 );
	vec3 hz = storm ? uSkyHz * vec3( 0.72, 0.74, 0.78 ) : uSkyHz;
	vec3 c = mix( hz, top, pow( e, 0.5 ) );
	vec2 cp = dir.xz / max( dir.y, 0.05 ) * 1.4 + uTime * vec2( 0.012, 0.005 );
	float n = fbm( cp * 1.2 );
	float cov = storm ? smoothstep( 0.28, 0.6, n ) : smoothstep( 0.5, 0.74, n );
	float shade = fbm( cp * 2.6 + 3.0 );
	vec3 cloud = storm ? mix( vec3( 0.09, 0.1, 0.12 ), vec3( 0.42, 0.42, 0.45 ), shade ) : mix( vec3( 0.62, 0.66, 0.74 ), vec3( 1.25, 1.2, 1.1 ), shade );
	cloud *= 0.55 + 0.7 * sd;
	float fadeH = smoothstep( 0.015, 0.16, e );
	c = mix( c, cloud, cov * fadeH );
	c += uSunCol * ( pow( sd, 400.0 ) * 8.0 + pow( sd, 14.0 ) * 0.5 + pow( sd, 3.0 ) * 0.1 ) * ( storm ? 0.55 : 1.0 ) * uSunVis;
	return mix( base, c, smoothstep( 0.0, 0.1, e ) );
}

void main() {
	vec2 uv = vUv;
	float d = texture2D( tDepth, uv ).r;
	bool sky = d >= 0.99999;
	float dist = linZ( d );
	vec3 wp = worldAt( uv, d );
	vec3 col = sceneAt( tScene, uv );
	if ( sky ) {
		if ( uSky > 0.0 ) col = skyDrama( col, normalize( wp - uCamPos ) );
	} else {
		if ( uClouds > 0.0 ) {
			float n = fbm( wp.xz * 0.0026 + uTime * vec2( 0.011, 0.006 ) );
			col *= 1.0 - uClouds * 0.55 * smoothstep( 0.42, 0.66, n );
		}
		if ( uFogBank > 0.0 ) {
			float h = wp.y - ( uCamPos.y - uFogBankH );
			float layer = exp( - max( h, 0.0 ) / 10.0 );
			float n = fbm( wp.xz * 0.012 + uTime * vec2( 0.05, 0.02 ) ) * 0.7 + vnoise( vec2( wp.y * 0.12, dist * 0.015 ) + uTime * 0.08 ) * 0.3;
			float dens = layer * smoothstep( 0.3, 0.78, n ) * ( 1.0 - exp( - dist * 0.025 ) );
			col = mix( col, uFogCol * 1.12, clamp( dens * uFogBank, 0.0, 0.9 ) );
		}
	}
	col += texture2D( tBloom, uv ).rgb * uBloom;
	col += texture2D( tRays, uv ).r * uRays * uSunCol * uSunVis;
	col *= uExposure;
	col = toneMapping( col );
	col = sRGBTransferOETF( vec4( col, 1.0 ) ).rgb;
	// Farbkorrektur im Anzeigeraum
	float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
	col = mix( vec3( l ), col, uSat );
	col = ( col - 0.5 ) * uContrast + 0.5;
	col *= vec3( 1.0 + uWarm * 0.09, 1.0 + uWarm * 0.02, 1.0 - uWarm * 0.1 );
	col = mix( col, col * mix( uSplitS, uSplitH, smoothstep( 0.12, 0.78, l ) ), uSplit );
	float v = smoothstep( 1.25, 0.4, length( ( uv - 0.5 ) * vec2( 1.0, 1.3 ) ) );
	col *= mix( 1.0, v, uVignette );
	float g = hash21( uv * uRes + fract( uTime ) * vec2( 31.7, 17.3 ) ) - 0.5;
	col += g * uGrain * 0.09 * ( 1.0 - l * 0.6 );
	gl_FragColor = vec4( clamp( col, 0.0, 1.0 ), 1.0 );
}`;

// ------------------------------------------------------------------ Anbindung an den Renderer

/** was der Renderer dem Bildstil zur Verfügung stellt (Renderer3D.weatherEnv) */
export interface WeatherEnv {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  fog: THREE.FogExp2;
  /** Himmel-Uniforms (top, horizon) */
  sky: Record<string, THREE.IUniform>;
  /** Himmelskugel – wirft und empfängt keine Schatten */
  skyMesh: THREE.Object3D;
  /** Fahrer in der Ferne als Bilder – werfen keine Schatten (ihr Tiefenbild wäre falsch) */
  noCast: THREE.Material[];
}

export interface WeatherHost {
  readonly weatherEnv: WeatherEnv;
  debugTod: number | null;
  quality: number;
  /** Nachbearbeitung: zeichnet die Szene (draw) in ein Bild und setzt das Endbild zusammen */
  post: ((draw: () => void, g: RaceView) => void) | null;
}

export class WeatherFx {
  /** aktuelles Wetter (null = aus) */
  weather: Weather | null = null;
  readonly tier: GfxTier;
  private rt: THREE.WebGLRenderTarget | null = null;
  private small: THREE.WebGLRenderTarget[] = [];
  private quad = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mesh: THREE.Mesh;
  private down: THREE.ShaderMaterial;
  private blur: THREE.ShaderMaterial;
  private rays: THREE.ShaderMaterial;
  private comp: THREE.ShaderMaterial;
  private time = 0;
  private last = performance.now();
  private lastPhase = '';
  private frames = 0;
  private flagged = new WeakSet<THREE.Object3D>();
  private fixed: WeatherId | 'none' | null;
  private env: WeatherEnv;
  private shadows = false;
  private off: () => void;

  constructor(private host: WeatherHost) {
    this.env = host.weatherEnv;
    this.tier = gfxTier();
    this.fixed = weatherOverride();
    const geomU = () => ({
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
      uNear: { value: 0.25 }, uFar: { value: 15000 },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.mesh.frustumCulled = false;
    this.quad.add(this.mesh);
    this.down = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: DOWN_FRAG, depthTest: false, depthWrite: false, uniforms: {
      ...geomU(), tScene: { value: null }, tDepth: { value: null }, uSunDir: { value: new THREE.Vector3() }, uThreshold: { value: 0.9 }, uTexel: { value: new THREE.Vector2() },
    } });
    this.blur = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false, uniforms: { tIn: { value: null }, uDir: { value: new THREE.Vector2() } } });
    this.rays = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: RAYS_FRAG, depthTest: false, depthWrite: false, uniforms: {
      tIn: { value: null }, uSun: { value: new THREE.Vector2() }, uChan: { value: new THREE.Vector4(0, 0, 0, 1) }, uDensity: { value: 0.9 }, uDecay: { value: 0.93 }, uWeight: { value: 0.07 },
    } });
    this.comp = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: COMP_FRAG, depthTest: false, depthWrite: false, uniforms: {
      ...geomU(), tScene: { value: null }, tDepth: { value: null }, tBloom: { value: null }, tRays: { value: null },
      uRes: { value: new THREE.Vector2() }, uSunUv: { value: new THREE.Vector2() }, uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() },
      uFogCol: { value: new THREE.Color() }, uSkyTop: { value: new THREE.Color() }, uSkyHz: { value: new THREE.Color() },
      uSplitS: { value: new THREE.Vector3(1, 1, 1) }, uSplitH: { value: new THREE.Vector3(1, 1, 1) },
      uSunVis: { value: 0 }, uTime: { value: 0 },
      uBloom: { value: 0 }, uRays: { value: 0 }, uClouds: { value: 0 }, uSky: { value: 0 }, uFogBank: { value: 0 }, uFogBankH: { value: 10 },
      uExposure: { value: 1 }, uContrast: { value: 1 }, uSat: { value: 1 }, uWarm: { value: 0 }, uSplit: { value: 0 }, uVignette: { value: 0 }, uGrain: { value: 0 },
    } });
    if (gfxOn('schatten')) this.setShadows(true);
    this.choose(runsToday() + 1);
    host.post = (draw, g) => this.frame(draw, g);
    // im Pausenmenü umgeschaltet
    this.off = onGfxChange((k, on) => {
      if (k === 'schatten') this.setShadows(on);
      // mitten in der Fahrt: deren Wetter (sie ist schon gezählt), sonst das der nächsten
      else if (k === 'licht') this.choose(['', 'ready', 'over'].includes(this.lastPhase) ? runsToday() + 1 : Math.max(1, runsToday()));
    });
  }

  /** Wetter der n-ten Fahrt des Tages einstellen (oder die feste Vorgabe aus der Adresse) */
  private choose(n: number) {
    // Lichtfilter aus: Licht des Spiels ohne Wetter (die Vorgabe aus der Adresse gilt trotzdem – zum Prüfen)
    if (!this.fixed && !gfxOn('licht')) { this.weather = null; return; }
    const id = this.fixed ?? weatherForRun(n);
    // ohne Nachbearbeitung wären Gewitter und Nebel nur eine tiefe Sonne: dann bleibt es bei der Goldenen Stunde
    this.weather = id === 'none' ? null : WEATHERS[this.tier === 'low' && id !== 'gold' ? 'gold' : id];
  }

  /**
   * Sonnenschatten an oder aus. three.js übersetzt dann alle beleuchteten Shader neu (die Zahl der Lichter mit
   * Schatten gehört zum Shader) – beim Anlegen vor dem Vorwärmen, sonst im Pausenmenü.
   */
  private setShadows(on: boolean) {
    if (on === this.shadows) return;
    this.shadows = on;
    const { gl, sun } = this.env;
    if (!on) {
      gl.shadowMap.enabled = false;
      sun.castShadow = false;
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      return;
    }
    const high = this.tier === 'high';
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFShadowMap;
    sun.castShadow = true;
    sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.06;
    const half = high ? 80 : 48;
    const sc = sun.shadow.camera;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 10; sc.far = 520;
    sc.updateProjectionMatrix();
    this.flagShadows();
  }

  /** alle Flächen empfangen Schatten, feste Körper werfen welche; neue Objekte (Landschaft, Fahrer) werden nachgezogen */
  private flagShadows() {
    const { scene, skyMesh, noCast } = this.env;
    scene.traverse((o) => {
      if (this.flagged.has(o)) return;
      const m = o as THREE.Mesh;
      if (!m.isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) return;
      this.flagged.add(o);
      if (o === skyMesh) return;
      const mat = m.material as THREE.Material;
      if (!mat || (mat as THREE.ShaderMaterial).isShaderMaterial || (mat as THREE.SpriteMaterial).isSpriteMaterial) return;
      m.receiveShadow = true;
      m.castShadow = !noCast.includes(mat) && !mat.transparent;
    });
  }

  /** ein Bild: Fahrtzähler und Tageszeit pflegen, dann zeichnen – direkt oder über die Nachbearbeitung */
  private frame(draw: () => void, g: RaceView) {
    // Fahrt gestartet: zählen; auf der Startkarte und nach dem Ziel schon den Stil der nächsten Fahrt zeigen
    const phase = g.phase as string;
    if (phase !== this.lastPhase) {
      if (phase === 'countdown') this.choose(noteRunStart());
      else if (phase === 'ready' || phase === 'over') this.choose(runsToday() + 1);
      this.lastPhase = phase;
    }
    // neue Objekte (Landschaft, Fahrer) werfen und empfangen Schatten
    if (this.shadows && (++this.frames & 7) === 0) this.flagShadows();
    const L = this.weather;
    if (!L) {
      this.host.debugTod = null;
      draw();
      return;
    }
    // Tageszeit über die Fahrt (die Strecke des Spiels gibt die Länge vor)
    const fin = g.track.kind === 'sprint' ? SPRINT_FINISH : g.track.kind === 'mountain' ? MOUNTAIN_FINISH : 7500;
    const k = Math.max(0, Math.min(1, g.p.z / fin));
    this.host.debugTod = L.tod[0] + (L.tod[1] - L.tod[0]) * k * k * (3 - 2 * k);
    // Nachbearbeitung nur mit genug Leistung (die Qualitätsregelung senkt die Auflösung, wenn es eng wird)
    if (this.tier === 'low' || this.host.quality < 0.55) { draw(); return; }
    this.render(draw, L);
  }

  private ensure(w: number, h: number) {
    if (this.rt && this.rt.width === w && this.rt.height === h) return;
    this.rt?.dispose();
    for (const s of this.small) s.dispose();
    const depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    this.rt = new THREE.WebGLRenderTarget(w, h, { depthTexture, samples: this.tier === 'high' ? 4 : 2, type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace });
    const sw = Math.max(8, Math.round(w / 4));
    const sh = Math.max(8, Math.round(h / 4));
    this.small = [0, 1, 2, 3].map(() => new THREE.WebGLRenderTarget(sw, sh, { type: THREE.HalfFloatType, depthBuffer: false, colorSpace: THREE.LinearSRGBColorSpace }));
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.mesh.material = mat;
    this.env.gl.setRenderTarget(target);
    this.env.gl.render(this.quad, this.quadCam);
  }

  private sd = new THREE.Vector3();
  private sp = new THREE.Vector3();
  private size = new THREE.Vector2();

  private render(draw: () => void, L: Weather) {
    const { gl, sun, fog, sky, camera } = this.env;
    const size = gl.getDrawingBufferSize(this.size);
    this.ensure(size.x, size.y);
    const rt = this.rt!;
    const now = performance.now();
    this.time += Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    // Szene mit Tiefe
    gl.setRenderTarget(rt);
    draw();
    // Sonne auf dem Bildschirm
    const sd = this.sd.subVectors(sun.position, sun.target.position).normalize();
    const sp = this.sp.copy(camera.position).addScaledVector(sd, 2000).project(camera);
    const sunVis = sp.z < 1 && sp.z > -1 ? 1 : 0;
    const geom = (m: THREE.ShaderMaterial) => {
      const u = m.uniforms;
      (u.uInvProj.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
      (u.uCamWorld.value as THREE.Matrix4).copy(camera.matrixWorld);
      (u.uCamPos.value as THREE.Vector3).copy(camera.position);
      u.uNear.value = camera.near; u.uFar.value = camera.far;
    };
    const [s0, s1, s2, s3] = this.small;
    geom(this.down);
    const du = this.down.uniforms;
    du.tScene.value = rt.texture; du.tDepth.value = rt.depthTexture; du.uThreshold.value = L.bloomThreshold;
    (du.uSunDir.value as THREE.Vector3).copy(sd);
    (du.uTexel.value as THREE.Vector2).set(1 / size.x, 1 / size.y);
    this.pass(this.down, s0);
    // Leuchten: zweimal weich (eng, dann weit)
    const bu = this.blur.uniforms;
    bu.tIn.value = s0.texture; (bu.uDir.value as THREE.Vector2).set(1.6 / s0.width, 0); this.pass(this.blur, s1);
    bu.tIn.value = s1.texture; (bu.uDir.value as THREE.Vector2).set(0, 1.6 / s0.height); this.pass(this.blur, s2);
    bu.tIn.value = s2.texture; (bu.uDir.value as THREE.Vector2).set(3.2 / s0.width, 0); this.pass(this.blur, s1);
    bu.tIn.value = s1.texture; (bu.uDir.value as THREE.Vector2).set(0, 3.2 / s0.height); this.pass(this.blur, s2);
    // Strahlen: zweimal radial zur Sonne (nur wenn sie im Bild steht)
    if (sunVis && L.rays > 0) {
      const ru = this.rays.uniforms;
      (ru.uSun.value as THREE.Vector2).set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
      ru.tIn.value = s0.texture; (ru.uChan.value as THREE.Vector4).set(0, 0, 0, 1); ru.uDensity.value = 0.55; ru.uDecay.value = 0.95; ru.uWeight.value = 0.085; this.pass(this.rays, s3);
      ru.tIn.value = s3.texture; (ru.uChan.value as THREE.Vector4).set(1, 0, 0, 0); ru.uDensity.value = 0.9; ru.uDecay.value = 0.9; ru.uWeight.value = 0.1; this.pass(this.rays, s1);
    }
    // Zusammensetzen
    geom(this.comp);
    const cu = this.comp.uniforms;
    cu.tScene.value = rt.texture; cu.tDepth.value = rt.depthTexture; cu.tBloom.value = s2.texture; cu.tRays.value = s1.texture;
    (cu.uRes.value as THREE.Vector2).set(size.x, size.y);
    (cu.uSunUv.value as THREE.Vector2).set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
    (cu.uSunDir.value as THREE.Vector3).copy(sd);
    (cu.uSunCol.value as THREE.Color).copy(sun.color).multiplyScalar(Math.min(1.4, sun.intensity * 0.6));
    (cu.uFogCol.value as THREE.Color).copy(fog.color);
    (cu.uSkyTop.value as THREE.Color).copy(sky.top.value as THREE.Color);
    (cu.uSkyHz.value as THREE.Color).copy(sky.horizon.value as THREE.Color);
    cu.uSunVis.value = sunVis; cu.uTime.value = this.time;
    cu.uBloom.value = L.bloom; cu.uRays.value = sunVis ? L.rays : 0; cu.uClouds.value = L.clouds; cu.uSky.value = L.sky;
    cu.uFogBank.value = L.fogBank; cu.uFogBankH.value = L.fogBankH;
    cu.uExposure.value = L.exposure; cu.uContrast.value = L.contrast; cu.uSat.value = L.sat; cu.uWarm.value = L.warm; cu.uSplit.value = L.split;
    cu.uVignette.value = L.vignette; cu.uGrain.value = L.grain;
    (cu.uSplitS.value as THREE.Vector3).fromArray(L.splitS); (cu.uSplitH.value as THREE.Vector3).fromArray(L.splitH);
    this.pass(this.comp, null);
  }

  dispose() {
    this.rt?.dispose();
    for (const s of this.small) s.dispose();
    this.down.dispose(); this.blur.dispose(); this.rays.dispose(); this.comp.dispose();
    this.mesh.geometry.dispose();
    this.off();
    this.host.post = null;
  }
}

/** Wetter an einen Renderer hängen (einmal je Bühne, vor dem ersten Bild) */
export function attachWeather(host: WeatherHost): WeatherFx | null {
  try {
    return new WeatherFx(host);
  } catch {
    return null;
  }
}
