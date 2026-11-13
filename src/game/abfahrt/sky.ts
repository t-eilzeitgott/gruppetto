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
/*
 * Rechenzeit (die Kuppel deckt ein Drittel des Bilds): Was nur von Uniforms abhängt (Sonnenrichtung, Sonnenlicht,
 * Drehung der Schleierwolken, Richtung der Front), rechnet der Eckenshader – einmal je Ecke statt je Bildpunkt, als
 * flache Varyings. Die Wolken rechnen ihr Relief (acht weitere Texturzugriffe) und ihr Licht nur, wo eine Wolke zu
 * sehen ist; unter dem Horizont und im blauen Himmel dazwischen entfällt das. (Texturen in diesen Zweigen mit der
 * gewohnten Mip-Wahl: am Rand eines Zweigs ist die Wolke durchsichtig – eine abweichende Stufe dort sieht man nicht;
 * so hielten es auch Türme und Regenvorhänge schon.)
 */
export const SKY_VERT = `
uniform vec3 sunDir; uniform vec3 sunCol; uniform float uWarm, uSeed;
varying vec3 vDir;
flat varying vec3 vSd;
/* x: Sonne über dem Horizont, y: tiefe Sonne in den Wolkenbäuchen, z: tiefe Sonne (dramatischer Himmel) */
flat varying vec3 vSun;
flat varying vec3 vSunLit;
/* Drehung der Schleierwolken (cos, sin), Richtung der Front */
flat varying vec4 vRot;
void main(){
	vDir = normalize(position);
	vec3 sd = normalize( sunDir );
	vSd = sd;
	float sunUp = clamp( sd.y * 6.0 + 0.3, 0.0, 1.0 );
	vSun = vec3( sunUp, ( 1.0 - smoothstep( 0.06, 0.32, sd.y ) ) * sunUp, clamp( 1.0 - ( degrees( asin( clamp( sd.y, - 1.0, 1.0 ) ) ) - 4.0 ) / 26.0, 0.0, 1.0 ) );
	/* mittags weiß, erst zum Abend hin in der Farbe der Sonne */
	vSunLit = mix( vec3( 1.0 ), sunCol, 0.3 + 0.7 * uWarm ) * ( 1.15 + 0.4 * uWarm ) * sunUp;
	float ca = uSeed * 0.7;
	vRot = vec4( cos( ca ), sin( ca ), cos( uSeed * 1.7 ), sin( uSeed * 1.7 ) );
	vec4 cp = projectionMatrix * modelViewMatrix * vec4(position,1.0);
	gl_Position = vec4(cp.xy, cp.w * 0.99998, cp.w);
}`;

export const SKY_FRAG = `
uniform vec3 top; uniform vec3 horizon; uniform vec3 below; uniform vec3 sunCol; uniform float sunSize; uniform float uHoles;
uniform sampler2D uNoise;
uniform float uTime, uSeed, uCover, uCirrus, uStorm, uOvercast, uTowers, uStars, uWarm, uDrama;
varying vec3 vDir;
flat varying vec3 vSd;
flat varying vec3 vSun;
flat varying vec3 vSunLit;
flat varying vec4 vRot;

float lumF( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }

float hash21( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }

/* Wolkendichte-Rauschen: drei Kanäle der Textur in drei Maßstäben (0 … 1) */
float cloudNoise( vec2 p, float t, out float fine ) {
	float a = texture2D( uNoise, p * 0.055 + vec2( t * 0.004, t * 0.0015 ) ).r;
	float b = texture2D( uNoise, p * 0.17 + vec2( 0.37, 0.11 ) - vec2( t * 0.006, 0.0 ) ).g;
	float c = texture2D( uNoise, p * 0.5 + vec2( 0.71, 0.53 ) + vec2( 0.0, t * 0.01 ) ).b;
	fine = texture2D( uNoise, p * 1.5 + vec2( 0.13, 0.87 ) - vec2( t * 0.012, t * 0.004 ) ).r * 0.06;
	return a * 0.54 + b * 0.28 + c * 0.12 + fine;
}
/* dasselbe ohne die feinste Lage (fürs Relief: zwei Nachbarproben – die feinste Lage trug dort nur Flimmern bei) */
float cloudNoise3( vec2 p, float t ) {
	float a = texture2D( uNoise, p * 0.055 + vec2( t * 0.004, t * 0.0015 ) ).r;
	float b = texture2D( uNoise, p * 0.17 + vec2( 0.37, 0.11 ) - vec2( t * 0.006, 0.0 ) ).g;
	float c = texture2D( uNoise, p * 0.5 + vec2( 0.71, 0.53 ) + vec2( 0.0, t * 0.01 ) ).b;
	return a * 0.54 + b * 0.28 + c * 0.12;
}

void main(){
	vec3 d = normalize( vDir );
	float h = d.y;
	if ( uHoles > 0.5 && h < -0.03 ) { gl_FragColor = vec4( 1.0, 0.0, 1.0, 1.0 ); return; }
	float e = clamp( h, 0.0, 1.0 );
	vec3 sd = vSd;
	float s = max( dot( d, sd ), 0.0 );
	float s2 = s * s;
	float s4 = s2 * s2;
	float s8 = s4 * s4;
	float sunUp = vSun.x;
	/* Front: unter 1 zieht die Decke als Wand von einer Seite auf (Richtung aus uSeed), gegenüber bleibt der Himmel offen */
	float storm = uStorm;
	if ( uStorm > 0.0 && uStorm < 0.999 ) {
		float wall = smoothstep( - 0.35, 0.55, dot( normalize( d.xz + vec2( 0.0001 ) ), vRot.zw ) + 0.15 - e * 0.3 );
		storm = uStorm * mix( wall, 1.0, uStorm * 0.5 );
	} else if ( uStorm >= 0.999 ) storm = 1.0;
	float over = uOvercast;

	/* --- Himmel: am Zenit tiefer und satter, zum Horizont heller; bei Front und Hochnebel grau */
	vec3 zen = top * mix( 1.0, 0.78, uTowers * 0.4 );
	/* Horizont: zur Sonne hin ihre Farbe (Abendrot), von ihr weg der kühle Dunst (below) – dieselbe Staffelung wie im
	   Dunst der Landschaft (grade.ts), so geht die Ferne dort nahtlos in den Himmel über */
	float cosS = dot( d, sd );
	vec3 hz = mix( below, horizon, clamp( cosS * 0.6 + 0.62, 0.0, 1.0 ) );
	float dusk = uWarm;
	zen = mix( zen, zen * vec3( 0.42, 0.47, 0.62 ) + vec3( 0.02, 0.02, 0.05 ), storm * 0.9 );
	hz = mix( hz, hz * vec3( 0.5, 0.52, 0.58 ), storm * 0.85 );
	zen = mix( zen, mix( hz, zen, 0.35 ) * vec3( 0.86, 0.88, 0.9 ), over );
	/* (dramatischer Himmel: das Blau reicht weiter herab – Abendrot nur am Horizont, darüber klares Blau) */
	vec3 c = h > 0.0 ? mix( hz, zen * 0.92, pow( e, mix( 0.42, 0.3, uDrama ) ) ) : mix( hz, below, clamp( - h * 6.0, 0.0, 1.0 ) );
	/* Abendrot: zur Sonne hin färbt sich der Horizont in ihrer Farbe, gegenüber bleibt er kühl; unter einer Front glüht es */
	float toSun = s2 * ( 1.0 - smoothstep( 0.0, 0.5, e ) );
	c += sunCol * toSun * ( 0.08 + 0.32 * dusk + 0.25 * storm ) * sunUp;

	/* --- dramatischer Himmel (Abfahrt, wie in der WebGPU-Abfahrt): Farben wie bei gemalten Wolken – Licht in der Farbe
	   der Sonne, Schatten schieferblau; Helligkeit aus dem blanken Himmel */
	float drama = uDrama * ( 1.0 - storm ) * ( 1.0 - over );
	float dBase = 0.0;
	float dLow = vSun.z;
	vec3 dWarm = vec3( 0.0 );
	vec3 dLit = vec3( 0.0 );
	vec3 dShadow = vec3( 0.0 );
	float facing = 0.0;
	float frontL = 0.0;
	float towerA = 0.0;
	if ( drama > 0.001 ) {
		dBase = max( lumF( zen ) * 0.5 + lumF( hz ) * 0.5, 0.01 );
		dWarm = mix( max( mix( sunCol / max( lumF( sunCol ), 1e-4 ), hz / max( lumF( hz ), 1e-4 ), 0.3 ), 0.0 ), vec3( 1.0 ), 0.22 );
		vec3 dCool = max( mix( zen / max( lumF( zen ), 1e-4 ), vec3( 0.78, 0.74, 0.92 ), 0.45 ), 0.0 );
		dLit = dWarm * dBase * ( 2.1 + dLow * 0.7 );
		dShadow = dCool * dBase * ( 0.36 - dLow * 0.1 );
		/* Blick von der Sonne weg (angestrahlt) … zur Sonne (Gegenlicht) */
		facing = dot( normalize( d.xz + vec2( 1e-5, 0.0 ) ), normalize( sd.xz + vec2( 1e-5, 0.0 ) ) );
		frontL = ( 1.0 - facing ) * 0.5;
		/* Quelltürme rund um den Horizont: breite Wolkenberge (einige je Himmelsrichtung) mit runden Bauschen, um die
		   Sonne eine Lücke; von der Sonne weg angestrahlt (Alpenglühen), zur Sonne hin Schattenrisse mit Lichtsaum,
		   unten im Dunst. Das Profil läuft langsam um den Horizont (früher rasch: Nadeln und Splitter statt Wolken) */
		vec2 cs = normalize( d.xz + vec2( 1e-5, 0.0 ) );
		float ridge = texture2D( uNoise, cs * 0.17 + vec2( 0.31, 0.12 ) ).g * 0.65 + texture2D( uNoise, cs * 0.46 + vec2( 0.73, 0.41 ) ).r * 0.35;
		float region = smoothstep( 0.3, 0.62, texture2D( uNoise, cs * 0.2 + vec2( 0.5, 0.9 ) ).r );
		float gap = 1.0 - smoothstep( 0.86, 0.97, facing ) * 0.85;
		/* (Kuppen statt Spitzen: das Profil oben abgeflacht, die Rundungen kommen von den Bauschen) */
		float rr = 1.0 - ridge * ridge * ( 3.0 - 2.0 * ridge );
		float top = ( 0.018 + ( 1.0 - rr * rr ) * 0.34 * region ) * gap + 0.006;
		/* Bauschen: Rauschen auf den Zylinder um den Horizont gelegt (zwei Projektionen, nach der Richtung gemischt) –
		   gleich fein längs des Horizonts und in der Höhe, also rund statt züngelnd */
		vec2 w2 = cs * cs;
		float hb = h * 2.1;
		/* (alle drei Kanäle einer Probe: grobe Bauschen plus feine Krause, ohne weiteren Texturzugriff) */
		const vec3 BW = vec3( 0.56, 0.28, 0.16 );
		float bill = dot( texture2D( uNoise, vec2( cs.x * 2.1 + 0.11, hb ) ).rgb, BW ) * w2.y + dot( texture2D( uNoise, vec2( cs.y * 2.1 + 0.57, hb + 0.31 ) ).rgb, BW ) * w2.x;
		bill = 0.5 + ( bill - 0.5 ) * inversesqrt( w2.x * w2.x + w2.y * w2.y );
		float edge = top + ( bill - 0.5 ) * ( min( top, 0.16 ) * 0.8 + 0.014 );
		float inside = edge - h;
		towerA = smoothstep( 0.0, 0.022, inside ) * smoothstep( - 0.08, - 0.01, h ) * drama * 0.9;
		if ( towerA > 0.001 ) {
			float h01 = clamp( h / max( top, 0.01 ), 0.0, 1.0 );
			/* unten im eigenen Schatten, oben und auf den Bauschen angestrahlt, in den Falten dazwischen dunkler */
			float tl = clamp( frontL * 0.4 + smoothstep( 0.1, 0.95, h01 ) * 0.42 + ( bill - 0.5 ) * 0.8 - 0.02, 0.0, 1.0 );
			/* (weit weg: die Schatten bleiben hell – tiefe Schieferflecken sahen aus wie Löcher) */
			vec3 tc = mix( dShadow, dLit, 0.3 + 0.7 * smoothstep( 0.1, 0.8, tl ) );
			float rimT = exp( - max( inside, 0.0 ) / 0.006 ) * ( max( facing, 0.0 ) * 0.9 * dLow + 0.2 );
			tc += dWarm * max( lumF( c ), dBase ) * rimT * 0.55;
			/* weit weg: im Dunst des Horizonts (unten ganz, oben noch ein Schleier) */
			tc = mix( tc, c, 0.2 + ( 1.0 - h01 ) * ( 1.0 - h01 ) * 0.74 );
			c = mix( c, tc, towerA );
		}
	}

	/* --- Quellwolken: auf eine Ebene projiziert (Perspektive zum Horizont) */
	float pe = e + 0.09;
	vec2 p = d.xz / pe * 0.75 + uSeed;
	float t = uTime * ( 1.0 + storm * 1.6 );
	/* zum Horizont hin verschwinden die Wolken im Dunst – darunter gar keine. Die flache Schicht läuft früh und weich
	   aus (so tief sähe man Wolken von der Seite, nicht als gestauchte Flecken); Front und Hochnebel reichen als
	   Decke bis hinunter */
	float fadeH = mix( smoothstep( 0.015, 0.2, e ), smoothstep( 0.0, 0.07, e ), max( storm, over ) );
	float alpha = 0.0;
	if ( fadeH > 0.0 ) {
		float fineN;
		float n = cloudNoise( p, t, fineN );
		/* große Wolkenfelder und weite Lücken: eine sehr grobe Welle hebt und senkt die Bedeckung */
		float big = texture2D( uNoise, p * 0.011 + vec2( t * 0.0012, 0.0 ) + vec2( 0.4 ) ).g;
		float cover = clamp( uCover + storm * 0.35 + over + ( big - 0.5 ) * 0.5 * ( 1.0 - over ) * ( 1.0 - storm * 0.5 ), 0.0, 1.0 );
		/* (lockerer als früher: zwischen den Wolken bleibt Himmel – eine fast geschlossene Decke aus hellen Rändern und
		   dunklen Kernen sah aus wie ein Tarnmuster; weichere Ränder) */
		float deck = max( storm, over );
		float lo = 0.64 - cover * mix( 0.38, 0.46, deck );
		float dens = smoothstep( lo, lo + mix( 0.22, 0.17, deck ) + 0.08 * over, n );
		/* dichte Kerne: Hochnebel wird zur glatten Decke */
		dens = mix( dens, clamp( dens * 1.6 + over * 0.6, 0.0, 1.0 ), over );
		alpha = dens * fadeH;
		/* nur wo eine Wolke zu sehen ist: Relief, Licht und Farbe */
		if ( alpha > 0.0 ) {
			/* Plastik: die Dichte als Relief gelesen – jede Beule hat eine Sonnen- und eine Schattenseite (Blumenkohl) */
			float dp = 0.07;
			float n3 = n - fineN;
			float nx = cloudNoise3( p + vec2( dp, 0.0 ), t );
			float ny = cloudNoise3( p + vec2( 0.0, dp ), t );
			float bump = ( 0.9 + 1.1 * uTowers ) * 0.9;
			vec3 N = normalize( vec3( - ( nx - n3 ) / dp * bump, - ( ny - n3 ) / dp * bump, 1.0 ) );
			vec3 Lp = normalize( vec3( sd.x, sd.z, max( sd.y, 0.04 ) + 0.25 ) );
			float lit = clamp( dot( N, Lp ) * 1.15 - 0.05, 0.0, 1.0 );
			/* dicke Kerne (von unten gesehen die grauen Bäuche) und dünne, helle Ränder */
			float thick = smoothstep( lo + 0.05 * ( 1.0 - deck ), lo + 0.44, n );
			float core = thick;
			/* tiefe Sonne scheint von unten in die Wolkenbäuche – das Abendrot der Wolken */
			float lowSun = vSun.y;
			vec3 ambient = mix( hz, zen, 0.5 );
			vec3 sunLit = vSunLit;
			vec3 shadeCol = ambient * ( 0.66 - 0.2 * thick - 0.07 * uTowers );
			/* tagsüber helle, nur leicht graue Bäuche (die Wolke streut ihr eigenes Licht) – dunkle Schieferkerne gibt
			   es erst im Abendlicht und unter der Front */
			shadeCol = mix( shadeCol, ( ambient * 0.5 + vec3( 0.44 ) * lumF( sunLit ) ) * ( 1.0 - 0.28 * thick ), ( 1.0 - dusk ) * 0.9 );
			vec3 litCol = sunLit * ( 0.72 + 0.28 * ( 1.0 - thick ) );
			vec3 cloudCol = mix( shadeCol, litCol, lit * mix( 0.66, 1.0, 1.0 - thick * uTowers ) );
			cloudCol = mix( cloudCol, sunCol * ( 1.1 + 0.3 * dusk ), lowSun * thick * ( 0.3 + 0.3 * lit ) );
			if ( drama > 0.001 ) {
				/* aufgerissenes Wolkenfeld: dünne Ränder zur Sonne leuchten, dicke Kerne bleiben schieferblau; im
				   Gegenlicht Glut in den dünnen Teilen, die dicken als Schattenriss */
				float Lk = clamp( lit * 0.75 + frontL * 0.3 - thick * 0.17 + 0.1, 0.0, 1.0 );
				vec3 dc = mix( dShadow, dLit, Lk );
				float back = pow( cosS * 0.5 + 0.5, 8.0 );
				dc = mix( dc, dShadow * 0.85 + dWarm * max( lumF( c ), dBase ) * ( 1.0 - thick ) * 1.15, back * 0.85 );
				cloudCol = mix( cloudCol, dc, drama );
			}
			/* Silberstreifen: dünne Ränder vor der Sonne leuchten */
			float rim = smoothstep( 0.0, 0.35, dens ) * ( 1.0 - smoothstep( 0.35, 0.95, dens ) );
			cloudCol += sunCol * rim * ( s4 * s2 ) * 1.4 * sunUp;
			if ( storm > 0.0 ) {
				/* Gewitterdecke: dunkelblaugrau, helle Risse nur an den dünnen Stellen */
				vec3 stormCol = mix( vec3( 0.07, 0.08, 0.11 ), vec3( 0.42, 0.42, 0.47 ), lit * 0.45 + ( 1.0 - core ) * 0.55 ) * ( 0.6 + 0.6 * sunUp );
				/* Licht unter der Decke: zur Sonne hin glüht der Rand der Front */
				stormCol += sunCol * ( rim * s8 * 0.6 + s2 * s * ( 1.0 - smoothstep( 0.0, 0.25, e ) ) * 0.45 ) * sunUp;
				cloudCol = mix( cloudCol, stormCol, storm );
			}
			/* Hochnebel: flach, grau, kaum Licht und Schatten */
			cloudCol = mix( cloudCol, mix( hz, zen, 0.3 ) * vec3( 0.84, 0.85, 0.87 ), over * 0.85 );
			/* (zum Horizont hin flacher) */
			float farMix = 1.0 - smoothstep( 0.0, 0.35, e );
			cloudCol = mix( cloudCol, hz, farMix * mix( 0.72, 0.4, deck ) );
			c = mix( c, cloudCol, alpha );
		}
	}

	/* --- Regenvorhänge der Front: senkrechte Schleier unter der Decke, zum Horizont hin */
	if ( storm > 0.01 ) {
		/* um den Horizont herum ohne Naht (über den Winkel gelesen gab es gegenüber eine senkrechte Kante im Schleier) */
		vec2 va = normalize( d.xz + vec2( 1e-5, 0.0 ) ) * 0.3;
		float veil = texture2D( uNoise, va + vec2( uSeed * 0.1, e * 0.35 + t * 0.02 ) ).r;
		veil = smoothstep( 0.45, 0.8, veil ) * ( 1.0 - smoothstep( 0.05, 0.42, e ) ) * smoothstep( -0.02, 0.03, h );
		c = mix( c, mix( hz, vec3( 0.36, 0.38, 0.43 ), 0.6 ), veil * storm * 0.75 );
	}

	/* --- Schleierwolken: hoch, dünn, lang gezogen – fangen das Abendlicht (nur, wo sie zu sehen sein können) */
	{
		vec2 q = d.xz / ( e + 0.28 ) * 0.55;
		q = mat2( vRot.x, - vRot.y, vRot.y, vRot.x ) * q + vec2( uSeed * 3.1, 0.0 );
		q.x *= 0.22;
		float cirW = uCirrus * smoothstep( 0.02, 0.22, e ) * ( 1.0 - storm * 0.8 ) * ( 1.0 - over );
		if ( cirW > 0.0 ) {
			float cn = texture2D( uNoise, q * 0.35 + vec2( t * 0.0025, 0.0 ) ).g * 0.65 + texture2D( uNoise, q * 1.3 + vec2( 0.2, t * 0.004 ) ).r * 0.35;
			float cir = smoothstep( 0.62 - uCirrus * 0.14, 0.86, cn ) * cirW;
			vec3 cirCol = mix( vec3( 1.0, 1.0, 1.0 ) * ( 0.75 + 0.25 * sunUp ), sunCol * 1.35, dusk * 0.85 + s2 * s * 0.3 );
			cirCol = mix( cirCol, mix( hz, zen, 0.5 ), ( 1.0 - sunUp ) * 0.6 );
			c = mix( c, cirCol, cir * 0.55 * ( 1.0 - alpha * 0.8 ) );
		}
	}

	/* --- dramatischer Himmel: Strahlen um die tiefe Sonne – helle Fächer, nach außen auslaufend */
	if ( drama > 0.001 && dLow > 0.05 ) {
		vec3 t1 = normalize( cross( vec3( 0.0, 1.0, 0.0 ), sd ) );
		vec3 b1 = cross( sd, t1 );
		float phi = atan( dot( d, b1 ), dot( d, t1 ) );
		vec2 pc = vec2( cos( phi ), sin( phi ) );
		float rays = smoothstep( 0.5, 0.8, texture2D( uNoise, pc * 2.2 + vec2( 0.2, 0.6 ) ).r ) * ( smoothstep( 0.5, 0.8, texture2D( uNoise, pc * 0.8 + vec2( 0.5, 0.1 ) ).g ) * 0.6 + 0.4 );
		float ang = acos( clamp( cosS, - 1.0, 1.0 ) );
		float fall = exp( - ang * 2.6 ) * smoothstep( 0.03, 0.14, ang ) * smoothstep( - 0.02, 0.05, h );
		c += dWarm * dBase * rays * fall * 0.32 * dLow * drama;
	}

	/* --- Sonne: Scheibe, Hof, Glühen – hinter Wolken verdeckt, vor dem Abendrot weit leuchtend */
	float occ = ( 1.0 - alpha * ( 0.92 - storm * 0.3 ) ) * ( 1.0 - towerA * 0.95 );
	// (gedämpft: Scheibe, enger und weiter Schein blendeten zu sehr)
	c += sunCol * ( pow( s, 900.0 ) * 1.9 * sunSize * occ + ( s8 * s8 * s8 ) * ( 0.18 + 0.24 * dusk ) * ( 0.5 + 0.5 * occ ) + s4 * ( 0.06 + 0.15 * dusk ) ) * sunUp;

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
    /** dramatischer Himmel (Abfahrt): Quelltürme am Horizont, Wolkenfeld mit Lichtkanten, Strahlen um die tiefe Sonne */
    uDrama: { value: 0 },
  };
}
