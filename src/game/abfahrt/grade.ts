/**
 * Bildlook: Neutral-Tonwertkurve, dazu eine leichte Filmkurve (etwas Kontrast), etwas mehr Farbe und
 * Split-Toning – Schatten kühl, Lichter warm. Läuft in jedem Material im selben Durchgang, kostet also kaum etwas.
 * Wird beim Import einmal in three.js eingesetzt (Renderer mit toneMapping = CustomToneMapping).
 */
import * as THREE from 'three';

const GRADE = `vec3 CustomToneMapping( vec3 color ) {
	vec3 c = NeutralToneMapping( color );
	vec3 p = pow( max( c, vec3( 0.0 ) ), vec3( 0.4545 ) );
	p = mix( p, p * p * ( 3.0 - 2.0 * p ), 0.2 );
	c = pow( p, vec3( 2.2 ) );
	float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
	c = max( mix( vec3( l ), c, 1.1 ), vec3( 0.0 ) );
	c *= mix( vec3( 0.965, 0.99, 1.05 ), vec3( 1.035, 1.0, 0.95 ), smoothstep( 0.015, 0.45, l ) );
	return clamp( c, 0.0, 1.0 );
}`;

const chunk = THREE.ShaderChunk as unknown as Record<string, string>;
chunk.tonemapping_pars_fragment = chunk.tonemapping_pars_fragment.replace('vec3 CustomToneMapping( vec3 color ) { return color; }', GRADE);

/**
 * Luftperspektive mit Höhe: unter der Kamera (Täler) liegt der Dunst dichter, über ihr (Gipfel) ist die Luft klarer.
 * Die Höhe relativ zur Kamera kommt aus der Ansichtsposition (Zeile y der Ansichtsmatrix) – so gilt es für jedes
 * Material, auch für eigene Shader, die nur mvPosition kennen.
 *
 * Dazu Dunst mit Sonne: zur Sonne hin leuchtet der Dunst in ihrer Farbe (Streulicht), gegenüber bleibt er kühl –
 * das gibt dem Licht eine Richtung und dem Abend sein Glühen. Richtung und Farbe kommen aus ATMO (von allen
 * Materialien geteilt, der Renderer setzt sie je Bild); Materialien ohne diese Uniforms (Wert 0) bleiben wie bisher.
 */
export const ATMO = {
  fogSunDir: { value: new THREE.Vector3(0, 1, 0) },
  fogSunCol: { value: new THREE.Color(0, 0, 0) },
};
chunk.fog_pars_vertex = chunk.fog_pars_vertex.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying float vFogRel;\n\tvarying vec3 vFogDir;');
chunk.fog_vertex = chunk.fog_vertex.replace('vFogDepth = - mvPosition.z;', 'vFogDepth = - mvPosition.z;\n\tvFogRel = dot( viewMatrix[1].xyz, mvPosition.xyz );\n\tvFogDir = mvPosition.xyz * mat3( viewMatrix );');
chunk.fog_pars_fragment = chunk.fog_pars_fragment.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying float vFogRel;\n\tvarying vec3 vFogDir;\n\tuniform vec3 fogSunDir;\n\tuniform vec3 fogSunCol;');
chunk.fog_fragment = chunk.fog_fragment
  .replace(
    'float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );',
    'float fogK = fogDensity * ( 1.0 + 0.85 * clamp( - vFogRel / 170.0, - 0.45, 1.5 ) );\n\t\tfloat fogFactor = 1.0 - exp( - fogK * fogK * vFogDepth * vFogDepth );',
  )
  .replace(
    'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
    'float fogSun = pow( max( dot( normalize( vFogDir ), fogSunDir ), 0.0 ), 5.0 );\n\tgl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor + fogSunCol * fogSun, fogFactor );',
  );
