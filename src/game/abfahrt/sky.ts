/**
 * Himmel der Spielwelten: eine Himmelskugel mit Wolken, die die Sonne beleuchtet – statt neun flacher Wolkenbilder.
 *
 * Zwei Schichten aus Rauschen (Textur mit drei fertigen Rauschkanälen, drei Abrufe je Schicht – kein teures
 * Rechnen je Bildpunkt): tiefe Quellwolken, zum Horizont hin perspektivisch gestaucht und im Dunst verschwindend,
 * darüber dünne Schleierwolken (Cirren), die als Erste das Abendrot fangen. Jede Wolke hat eine Sonnenseite und
 * eine Schattenseite (Dichte in Richtung Sonne verglichen), dichte Kerne sind dunkler als die Ränder, und steht
 * die Sonne hinter einer Wolke, leuchtet ihr Rand (Silberstreifen). Die Sonne selbst: Scheibe, Hof, Glühen am
 * Horizont – von Wolken verdeckt. Nachts Sterne.
 *
 * Stimmungen (Mood): Bedeckung und Schleier nach dem Tag (jeder Tag ein anderer Himmel – Schäfchenwolken, hohe
 * Türme, ein paar Cirren im Abendlicht); dazu eine Gewitterfront (dunkle Decke mit hellen Rissen, Regenvorhänge
 * am Horizont) und Hochnebel (flache graue Decke) für das Wetter der Fahrt (weather.ts).
 */
import * as THREE from 'three';
import { mulberry32 } from './rng';

export interface SkyMood {
  /** Bedeckung der Quellwolken 0 … 1 */
  cover: number;
  /** Schleierwolken 0 … 1 */
  cirrus: number;
  /** Gewitterfront 0 … 1: dunkle Decke, Regenvorhänge */
  storm: number;
  /** Hochnebel 0 … 1: flache, graue, geschlossene Decke ohne Struktur */
  overcast: number;
  /** wie hoch die Quellwolken türmen 0 … 1 (plastischer, härtere Schatten) */
  towers: number;
}

/** Stimmung des Tages aus dem Streckensamen: jeder Tag und jedes Spiel ein anderer Himmel */
export function dailyMood(seed: number): SkyMood {
  const r = mulberry32((seed ^ 0x5c7) >>> 0);
  const kind = r();
  // ein Viertel der Tage: eine Front zieht auf (dunkle Wolkenwand, aber die Sonne kommt noch durch)
  if (kind < 0.22) return { cover: 0.5 + r() * 0.2, cirrus: 0.2 + r() * 0.3, storm: 0.5 + r() * 0.3, overcast: 0, towers: 0.9 };
  // Schäfchen- und Haufenwolken, hohe Türme oder nur ein paar Cirren
  if (kind < 0.5) return { cover: 0.55 + r() * 0.25, cirrus: 0.3 + r() * 0.5, storm: 0, overcast: 0, towers: 0.7 + r() * 0.3 };
  if (kind < 0.8) return { cover: 0.3 + r() * 0.25, cirrus: 0.4 + r() * 0.6, storm: 0, overcast: 0, towers: 0.4 + r() * 0.4 };
  return { cover: 0.12 + r() * 0.18, cirrus: 0.7 + r() * 0.3, storm: 0, overcast: 0, towers: 0.3 };
}

/* Die Kugel wird nach allem Festen gezeichnet und liegt in der Tiefe ganz hinten (z = w): nur Bildpunkte, an denen
   wirklich Himmel zu sehen ist, rechnen die Wolken – nicht der ganze Bildschirm, der dann von Landschaft überdeckt wird */
export const SKY_VERT = 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 cp = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = vec4(cp.xy, cp.w * 0.99998, cp.w); }';

export const SKY_FRAG = `
uniform vec3 top; uniform vec3 horizon; uniform vec3 below; uniform vec3 sunDir; uniform vec3 sunCol; uniform float sunSize; uniform float uHoles;
uniform sampler2D uNoise;
uniform float uTime, uSeed, uCover, uCirrus, uStorm, uOvercast, uTowers, uStars, uWarm;
varying vec3 vDir;

float hash21( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }

/* Wolkendichte-Rauschen: drei Kanäle der Textur in drei Maßstäben (0 … 1) */
float cloudNoise( vec2 p, float t ) {
	float a = texture2D( uNoise, p * 0.055 + vec2( t * 0.004, t * 0.0015 ) ).r;
	float b = texture2D( uNoise, p * 0.17 + vec2( 0.37, 0.11 ) - vec2( t * 0.006, 0.0 ) ).g;
	float c = texture2D( uNoise, p * 0.5 + vec2( 0.71, 0.53 ) + vec2( 0.0, t * 0.01 ) ).b;
	float e = texture2D( uNoise, p * 1.5 + vec2( 0.13, 0.87 ) - vec2( t * 0.012, t * 0.004 ) ).r;
	return a * 0.54 + b * 0.28 + c * 0.12 + e * 0.06;
}

void main(){
	vec3 d = normalize( vDir );
	float h = d.y;
	if ( uHoles > 0.5 && h < -0.03 ) { gl_FragColor = vec4( 1.0, 0.0, 1.0, 1.0 ); return; }
	float e = clamp( h, 0.0, 1.0 );
	vec3 sd = normalize( sunDir );
	float s = max( dot( d, sd ), 0.0 );
	float sunUp = clamp( sd.y * 6.0 + 0.3, 0.0, 1.0 );
	/* Front: unter 1 zieht die Decke als Wand von einer Seite auf (Richtung aus uSeed), gegenüber bleibt der Himmel offen */
	vec2 fd = vec2( cos( uSeed * 1.7 ), sin( uSeed * 1.7 ) );
	float wall = smoothstep( - 0.35, 0.55, dot( normalize( d.xz + vec2( 0.0001 ) ), fd ) + 0.15 - e * 0.3 );
	float storm = uStorm >= 0.999 ? 1.0 : uStorm * mix( wall, 1.0, uStorm * 0.5 );
	float over = uOvercast;

	/* --- Himmel: am Zenit tiefer und satter, zum Horizont heller; bei Front und Hochnebel grau */
	vec3 zen = top * mix( 1.0, 0.78, uTowers * 0.4 );
	vec3 hz = horizon;
	float dusk = uWarm;
	zen = mix( zen, zen * vec3( 0.42, 0.47, 0.62 ) + vec3( 0.02, 0.02, 0.05 ), storm * 0.9 );
	hz = mix( hz, hz * vec3( 0.5, 0.52, 0.58 ), storm * 0.85 );
	zen = mix( zen, mix( hz, zen, 0.35 ) * vec3( 0.86, 0.88, 0.9 ), over );
	vec3 c = h > 0.0 ? mix( hz, zen * 0.92, pow( e, 0.42 ) ) : mix( hz, below, clamp( - h * 6.0, 0.0, 1.0 ) );
	/* Abendrot: zur Sonne hin färbt sich der Horizont in ihrer Farbe, gegenüber bleibt er kühl; unter einer Front glüht es */
	float toSun = pow( s, 2.0 ) * ( 1.0 - smoothstep( 0.0, 0.5, e ) );
	c += sunCol * toSun * ( 0.12 + 0.5 * dusk + 0.35 * storm ) * sunUp;

	/* --- Quellwolken: auf eine Ebene projiziert (Perspektive zum Horizont) */
	float pe = e + 0.09;
	vec2 p = d.xz / pe * 0.75 + uSeed;
	float t = uTime * ( 1.0 + storm * 1.6 );
	float n = cloudNoise( p, t );
	/* große Wolkenfelder und weite Lücken: eine sehr grobe Welle hebt und senkt die Bedeckung */
	float big = texture2D( uNoise, p * 0.011 + vec2( t * 0.0012, 0.0 ) + vec2( 0.4 ) ).g;
	float cover = clamp( uCover + storm * 0.35 + over + ( big - 0.5 ) * 0.5 * ( 1.0 - over ) * ( 1.0 - storm * 0.5 ), 0.0, 1.0 );
	float lo = 0.64 - cover * 0.46;
	float dens = smoothstep( lo, lo + 0.17 + 0.08 * over, n );
	/* dichte Kerne: Hochnebel wird zur glatten Decke */
	dens = mix( dens, clamp( dens * 1.6 + over * 0.6, 0.0, 1.0 ), over );
	/* Plastik: die Dichte als Relief gelesen – jede Beule hat eine Sonnen- und eine Schattenseite (Blumenkohl) */
	float dp = 0.07;
	float nx = cloudNoise( p + vec2( dp, 0.0 ), t );
	float ny = cloudNoise( p + vec2( 0.0, dp ), t );
	float bump = ( 0.9 + 1.1 * uTowers ) * 0.9;
	vec3 N = normalize( vec3( - ( nx - n ) / dp * bump, - ( ny - n ) / dp * bump, 1.0 ) );
	vec3 Lp = normalize( vec3( sd.x, sd.z, max( sd.y, 0.04 ) + 0.25 ) );
	float lit = clamp( dot( N, Lp ) * 1.15 - 0.05, 0.0, 1.0 );
	/* dicke Kerne (von unten gesehen die grauen Bäuche) und dünne, helle Ränder */
	float thick = smoothstep( lo, lo + 0.42, n );
	float core = thick;
	/* tiefe Sonne scheint von unten in die Wolkenbäuche – das Abendrot der Wolken */
	float lowSun = ( 1.0 - smoothstep( 0.06, 0.32, sd.y ) ) * sunUp;
	vec3 ambient = mix( hz, zen, 0.5 );
	/* mittags weiß, erst zum Abend hin in der Farbe der Sonne */
	vec3 sunLit = mix( vec3( 1.0 ), sunCol, 0.3 + 0.7 * dusk ) * ( 1.15 + 0.4 * dusk ) * sunUp;
	vec3 shadeCol = ambient * ( 0.62 - 0.3 * thick - 0.08 * uTowers );
	vec3 litCol = sunLit * ( 0.72 + 0.28 * ( 1.0 - thick ) );
	vec3 cloudCol = mix( shadeCol, litCol, lit * mix( 0.5, 1.0, 1.0 - thick * uTowers ) );
	cloudCol = mix( cloudCol, sunCol * ( 1.1 + 0.3 * dusk ), lowSun * thick * ( 0.3 + 0.3 * lit ) );
	/* Silberstreifen: dünne Ränder vor der Sonne leuchten */
	float rim = smoothstep( 0.0, 0.35, dens ) * ( 1.0 - smoothstep( 0.35, 0.95, dens ) );
	cloudCol += sunCol * rim * pow( s, 6.0 ) * 1.4 * sunUp;
	/* Gewitterdecke: dunkelblaugrau, helle Risse nur an den dünnen Stellen */
	vec3 stormCol = mix( vec3( 0.07, 0.08, 0.11 ), vec3( 0.42, 0.42, 0.47 ), lit * 0.45 + ( 1.0 - core ) * 0.55 ) * ( 0.6 + 0.6 * sunUp );
	/* Licht unter der Decke: zur Sonne hin glüht der Rand der Front */
	stormCol += sunCol * ( rim * pow( s, 8.0 ) * 0.6 + pow( s, 3.0 ) * ( 1.0 - smoothstep( 0.0, 0.25, e ) ) * 0.45 ) * sunUp;
	cloudCol = mix( cloudCol, stormCol, storm );
	/* Hochnebel: flach, grau, kaum Licht und Schatten */
	cloudCol = mix( cloudCol, mix( hz, zen, 0.3 ) * vec3( 0.84, 0.85, 0.87 ), over * 0.85 );
	/* zum Horizont hin verschwinden die Wolken im Dunst (und werden flacher) */
	float fadeH = smoothstep( 0.0, 0.09, e );
	float farMix = 1.0 - smoothstep( 0.0, 0.35, e );
	cloudCol = mix( cloudCol, hz, farMix * 0.4 );
	float alpha = dens * fadeH;
	c = mix( c, cloudCol, alpha );

	/* --- Regenvorhänge der Front: senkrechte Schleier unter der Decke, zum Horizont hin */
	if ( storm > 0.01 ) {
		float ang = atan( d.x, d.z );
		float veil = texture2D( uNoise, vec2( ang * 0.9 + uSeed * 0.1, e * 0.35 + t * 0.02 ) ).r;
		veil = smoothstep( 0.45, 0.8, veil ) * ( 1.0 - smoothstep( 0.05, 0.42, e ) ) * smoothstep( -0.02, 0.03, h );
		c = mix( c, mix( hz, vec3( 0.36, 0.38, 0.43 ), 0.6 ), veil * storm * 0.75 );
	}

	/* --- Schleierwolken: hoch, dünn, lang gezogen – fangen das Abendlicht */
	{
		vec2 q = d.xz / ( e + 0.28 ) * 0.55;
		float ca = uSeed * 0.7;
		q = mat2( cos( ca ), - sin( ca ), sin( ca ), cos( ca ) ) * q + vec2( uSeed * 3.1, 0.0 );
		q.x *= 0.22;
		float cn = texture2D( uNoise, q * 0.35 + vec2( t * 0.0025, 0.0 ) ).g * 0.65 + texture2D( uNoise, q * 1.3 + vec2( 0.2, t * 0.004 ) ).r * 0.35;
		float cir = smoothstep( 0.62 - uCirrus * 0.14, 0.86, cn ) * uCirrus * smoothstep( 0.02, 0.22, e ) * ( 1.0 - storm * 0.8 ) * ( 1.0 - over );
		vec3 cirCol = mix( vec3( 1.0, 1.0, 1.0 ) * ( 0.75 + 0.25 * sunUp ), sunCol * 1.35, dusk * 0.85 + pow( s, 3.0 ) * 0.3 );
		cirCol = mix( cirCol, mix( hz, zen, 0.5 ), ( 1.0 - sunUp ) * 0.6 );
		c = mix( c, cirCol, cir * 0.55 * ( 1.0 - alpha * 0.8 ) );
	}

	/* --- Sonne: Scheibe, Hof, Glühen – hinter Wolken verdeckt, vor dem Abendrot weit leuchtend */
	float occ = 1.0 - alpha * ( 0.92 - storm * 0.3 );
	c += sunCol * ( pow( s, 900.0 ) * 3.0 * sunSize * occ + pow( s, 24.0 ) * ( 0.35 + 0.45 * dusk ) * ( 0.5 + 0.5 * occ ) + pow( s, 4.0 ) * ( 0.12 + 0.3 * dusk ) ) * sunUp;

	/* --- Sterne */
	if ( uStars > 0.01 ) {
		vec3 sp = d * 700.0;
		vec3 sc = floor( sp );
		float st = hash21( sc.xz + sc.y * 13.7 );
		vec3 cp = fract( sp ) - 0.5;
		float pt = 1.0 - smoothstep( 0.0, 0.3, length( cp ) );
		float star = smoothstep( 0.994, 0.999, st ) * pt * pow( e, 0.6 ) * ( 1.0 - alpha );
		c += vec3( 0.9, 0.93, 1.0 ) * star * uStars * ( 0.5 + 0.5 * hash21( sc.zx ) ) * 1.6;
	}

	gl_FragColor = vec4( c, 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

export function skyUniforms(noise: THREE.Texture): Record<string, THREE.IUniform> {
  return {
    top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, below: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() }, sunCol: { value: new THREE.Color() }, sunSize: { value: 1 },
    uHoles: { value: 0 }, uNoise: { value: noise },
    uTime: { value: 0 }, uSeed: { value: 0 }, uCover: { value: 0.4 }, uCirrus: { value: 0.5 }, uStorm: { value: 0 }, uOvercast: { value: 0 },
    uTowers: { value: 0.5 }, uStars: { value: 0 }, uWarm: { value: 0 },
  };
}
