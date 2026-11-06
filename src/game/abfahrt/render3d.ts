/**
 * WebGL-Renderer für „Abfahrt“ (three.js).
 * Die Strecke wird in Abschnitten (Chunks) als echte 3D-Geometrie gebaut: Fahrbahn mit Texturen,
 * Bankett, Markierungen, Gelände links und rechts (Wiese, Fels, Schnee, Wald, Seeufer), Leitplanken,
 * Häuserzeilen, Tunnel, Bäume und Requisiten. Dazu Himmel, ferne Berge, Talboden, Licht nach Tageszeit,
 * 3D-Fahrer und eine 2D-Ebene für Punkte-Popups.
 */
import * as THREE from 'three';
import { EDGE, MOUNTAIN_FINISH, MOUNTAIN_TOP, ROAD_HALF, SEG, SPRINT_FINISH, TT_FINISH, Track, type Building, type Seg, type Side, type Sprite, type BiomeId, type Banner } from './track';
import { BIOME_PALETTES, lightAt, mixRGB, type RGB } from './palette';
import { FLAG_VARIANT, SpriteBank, roadArrow, roadText, warmRoadText } from './sprites';
import { SKY_FRAG, SKY_VERT, dailyMood, skyUniforms, type SkyMood } from './sky';
import { seasonLook, type SeasonLook } from './season';
import { ROOF_SNOW, SeasonAir, roofSnowHook, smokeMaterial, smokePoints } from './season3d';
import { EditorMarkers, type Marker } from './editor3d';
import type { TerrainBump } from './worldEdits';
import * as worldStore from './worldStore';
import { mistTexture, waterTexture } from './falls3d';
import { waterNormalCanvas, waterify, type WaterUniforms } from './water3d';
import { campanile } from './campanile3d';
import { ARC, arcDeTriomphe, eiffelTower, parisProps, sacreCoeur } from './paris3d';
import { albiCathedral, angersCastle, chambord, chateauPau, franceProps, gatteville, geant, mendeCathedral, montStMichel, peyrouAqueduct, saintSernin } from './france3d';
import type { Mark } from './venue';
import { adCell, adsTex, archPostTex, officialBannerTex, roadLineTex, ARCH_LOOK, type ArchStyle, AD_COUNT, TEAM_ADS, SIGN_COUNT, FAN_ASPECT, FAN_CELLS, fanAtlas, fanCell, asphaltTex, bannerTex, canopyTex, glowTex, grassTex, detailTex, gravelTex, masonryTex, noiseTex, plaqueTex, rockTex, roundTex, shotcreteTex, tunnelSignTex } from './tex3d';
import { CURB_CHAMFER, CURB_FACE, CURB_TOP, CURB_V, COVER_PATCH, GUTTER_W, asphaltTex as groundAsphalt, cobbleTex, coverAtlas, curbTex, grainTex, groundCached, gutterTex, vergeTex, walkTex, type GroundTex } from './groundTex';
import { GROUND_STYLES, coverLang } from './groundStyle';
import { SkyLife } from './sky3d';
import { landmarkGeometries, type Landmark } from './landmarks3d';
import { buildPeaks, buildPeaksSteps, isPcPeaks, peakKeepers, peakLight, peakSunUpdate, setPeakOpacity } from './peaks3d';
import { Grass3D, grassMaterial, grassWarm } from './grass3d';
import { TeamCar3D } from './teamcar3d';
import { FAC_B, FAC_H, FAC_W, TB, portalFacade, tunnelMaterial, tunnelName, tunnelRing, tunnelUniforms, type TunnelUniforms } from './tunnel3d';
import { FAC_M, STYLE, STYLE_ROOF, STYLE_WALL, TINTABLE, WALL_PAL, badgeUV, facU, facV, facadeAtlas, roofTex, signAtlas, signUV, type FacPart } from './facade';
import { GB, alphaTex, lin, lin255, propGeometries, type Prop3D, type RGBf } from './models3d';
import { RiderModel, riderKitKey, type RiderPose } from './rider3d';
import { JOINTS, Ragdoll, type Ground } from './ragdoll';
import { wreckPose, wreckTravel, type Wreck } from './wreck';
import { SKINS, TEAM_KITS, type Kit } from './rider';
import { Houses3D } from './houses3d';
import { Villages3D } from './village3d';
import { LAMP_GLSL, LAMP_N, LAMP_U, haloMaterial, lampFrag, lampHalos, pickLamps, warmLamps } from './lamps3d';
import { SunsetGlow } from './sunset3d';
import { TT_PODIUM, TtStart3D, ttCrowdGap } from './ttstart3d';
import { DescentStart3D } from './descstart3d';
import { EV, SEC, type CallsBy, type Perf3D } from './perf3d';
import { uiBusy } from '../uiBusy';
import { RiderAnim } from './riderAnim';
import type { RaceView, Opp, Friend } from './engine';
import { LEVELS, LIM_MAX, TOWN_ZONE, Terrain, grassy, type Region, type TileData } from './terrain3d';
import { Act, KINDS, STRIDE, crowdGeometry, crowdMaterial, disposeCrowdGeometry, packPerson, randomPerson, setCrowdChill, setCrowdHome, type Person, type Zone } from './crowd3d';
import { bakeCrowdAtlas, disposeSpriteGeometry, spriteGeometry, spriteMaterial, type CrowdAtlas } from './crowdSprites';
import { TREC, TREE_KINDS, bakeTreeAtlas, billboardDepthMaterial, billboardMaterial, disposeBillboards, treeBillboards, treeTint, treeVariant, type TreeAtlas, type TreeSource } from './forest3d';
import { mulberry32 } from './rng';
import { ATMO } from './grade';
import { viewRange, viewRangeVersion } from './viewRange';
import { setGlossEnv } from './gloss';
import { apIn, apOut, apQ, appearify, appearifyTree, setAp, setApDiscard } from './appear';
import { RiderSprites, SPRITE_FAR, SPRITE_NEAR, spriteable } from './riderSprites';
import type { WeatherEnv } from './weather';
import { gfxAA, gfxOn, gfxRes, onGfxChange, onGfxSettings } from './gfxOpts';
import { buildHouse, roofPitch, rowUnits, roofColor, roofKind, setTownLook, townLook, wallSet, type At, type Town } from './house3d';
import { TEAMS } from '../teams';
import { menuInset } from '../menuView';

/** geplantes Wahrzeichen: Segment, Lage quer/längs dazu und der Rahmen des Segments (Welt) */
interface VenueMark {
  i: number; kind: Mark; lat: number; along: number; f: { x: number; y: number; z: number; th: number }; sg?: number;
  /** Front zur Straße (Bau um 90° gedreht) und Maßstab */
  face?: boolean; s?: number;
}

/** Kennung der feinen Landschafts-Shader (gfxOpts „details“) im Programmschlüssel */
/** Schlüssel der Bodenshader: Details (ab Stufe 7) und schlichte Böden (Stufe 1–2) übersetzen eigene Fassungen */
const dk = () => (gfxOn('details') ? '+d' : '') + (gfxOn('lite') ? '+l' : '');

/**
 * Bäume lösen sich zwischen TREE_FADE und TREE_GONE weich auf; das Kronendach der Landschaft hebt sich schon
 * vorher (ab CAN_NEAR bis CAN_FULL) – die Wipfel ragen aus ihm heraus, bis nur noch das Dach bleibt
 */
/** Bäume und Kronendach: Abstände kommen aus der Sichtweite (viewRange.ts) als Uniform */
const VR0 = viewRange();

const TREES = TREE_KINDS;

/**
 * Übergang zur gröberen Landschaftsstufe (je Stufe 0, 1): zwischen den beiden Abständen (Tschebyschow, um einen
 * Mittelpunkt bei der Kamera, Stufe 0 etwas voraus) nimmt die feinere Stufe stufenlos Form und Farbe der gröberen
 * an. Am Rand ihres Gebiets ist sie ihr gleich – kommen dort Kacheln hinzu oder fallen weg, sieht man nichts.
 * Der Mittelpunkt liegt nur wenig voraus: in Kehren schwenkt er so kaum (die Berge in der Ferne bleiben ruhig).
 */
const MORPH: [number, number][] = [[...VR0.morph[0]], [...VR0.morph[1]]];
const MORPH_AHEAD = [Math.round(VR0.morph[0][1] * 0.23), 0];
/** kleinster Ring, mit dem eine Stufe bei schneller Fahrt schon weiterrückt */
const RING_MIN = [2, 2, 1];

const smooth01 = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
/** Tageszeit der Abfahrt (palette.ts: 0,58 Abendsonne … 0,7 Sonnenuntergang): fester Abend wie in der WebGPU-Abfahrt */
const DESCENT_TOD = 0.62;
/** Himmel der Abfahrt: aufgerissenes Wolkenfeld mit hohen Türmen und Schleiern (dazu die Schichten des dramatischen Himmels) */
const DESCENT_SKY: SkyMood = { cover: 0.5, cirrus: 0.75, storm: 0, overcast: 0, towers: 1 };

/** Mittelwert eines Kanals – so erscheint die Textur in der Ferne (kleinste Mipmap); sRGB-Bilder linear gemittelt */
function texMean(cv: HTMLCanvasElement, srgb: boolean, ch = 0): number {
  const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
  let s = 0;
  for (let i = ch; i < d.length; i += 4) {
    const v = d[i] / 255;
    s += srgb ? (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) : v;
  }
  return s / (d.length / 4);
}

const CH = 40;            // Segmente je Abschnitt (80 m)
/** Spalten der Fahrbahn quer (für ihr Relief; je etwa 40 cm) */
const ROAD_COLS = 14;
/** so viel stärker zeichnet sich das Relief der Fahrbahn im Licht ab (nur die Normalen) */
const ROAD_SHADE = 3;
let AHEAD = VR0.ahead;        // so weit voraus wird gebaut (m, aus der Sichtweite)
const BEHIND = 30;
/** Wasserfälle liegen auf der feinen Stufe; weiter weg folgen sie der mittleren (aDy.x), dann der gröbsten (aDy.y) */
/**
 * Rauschbausteine wie in der WebGPU-Welt (gpu/nodes.ts): Hash ohne sin (die Grafik im iPhone rechnet sin für große
 * Eingaben nur grob), Wertrauschen in einer Richtung mit Ableitung, 2D-Wertrauschen, feines Korn (blendet aus, wo
 * eine Zelle unter ~2 Bildpunkte fällt)
 */
const NOISE_GLSL = `
float h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec2 vn1(float x, float seed) { float i = floor(x); float f = fract(x); float a = h21(vec2(i, seed)); float b = h21(vec2(i + 1.0, seed)); float s = f * f * (3.0 - 2.0 * f); return vec2(mix(a, b, s), (b - a) * 6.0 * f * (1.0 - f)); }
float vn2(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y); }
float grainF(vec2 p, float cell, float amt) { vec2 q = p / cell; float fw = fwidth(q.x) + fwidth(q.y); return 1.0 + (vn2(q) - 0.5) * amt * 2.0 * (1.0 - smoothstep(0.35, 0.9, fw)); }
`;

/**
 * Relief der Felswände (wie gpu/ground.ts rockRelief) – nur Rechnen, nur wo Fels ist: Rinnen und Rippen die Wand
 * hinab (in der Höhe mäandernd; Runsen 110 m, Rinnen 33 m, Furchen 9,5 m), dunkle Wasserstreifen, Schichtbänke
 * leicht schräg durch den ganzen Berg, Flecken. Ergebnis: Helligkeit k und die Steigung (Welt) für die Normale.
 * lod: 0 nah, 1 mittel (ohne feine Bänke), 2 fern (ohne Furchen und Streifen).
 */
const RELIEF_GLSL = `
vec2 rrGully(float u, float y, float seed, int lod, out float st) {
  float uu = u + (vn1(y / 53.0, seed + 7.0).x - 0.5) * 26.0;
  vec2 a = vn1(uu / 110.0, seed);
  vec2 b = vn1(uu / 33.0, seed + 3.0);
  if (lod >= 2) { st = 0.0; return vec2(a.x * 0.45 + b.x * 0.33 + 0.11, a.y * (16.0 / 110.0) + b.y * (5.0 / 33.0)); }
  vec2 c = vn1(uu / 9.5, seed + 9.0);
  st = vn1(uu / 2.6, seed + 5.0).x;
  return vec2(a.x * 0.45 + b.x * 0.33 + c.x * 0.22, a.y * (16.0 / 110.0) + b.y * (5.0 / 33.0) + c.y * (1.4 / 9.5));
}
float rockRelief(vec3 pos, vec3 nG, float strata, int lod, out vec3 grad) {
  float ax = abs(nG.x), az = abs(nG.z);
  float wx0 = ax * ax * ax * ax, wz0 = az * az * az * az;
  float ws = wx0 + wz0 + 1e-4;
  float wx = wx0 / ws, wz = wz0 / ws;
  float steep = clamp(1.0 - nG.y * nG.y, 0.0, 1.0);
  float stX, stZ;
  vec2 X = rrGully(pos.z, pos.y, 11.0, lod, stX);
  vec2 Z = rrGully(pos.x, pos.y, 23.0, lod, stZ);
  float g = X.x * wx + Z.x * wz;
  float ys = pos.y + pos.x * 0.09 - pos.z * 0.055;
  vec2 s1 = vn1(ys / 5.5, 31.0);
  float sb = s1.x * 0.7 + 0.15;
  float ds = s1.y * (0.7 / 5.5);
  if (lod == 0) { vec2 s2 = vn1(ys / 1.7, 37.0); sb = s1.x * 0.7 + s2.x * 0.3; ds += s2.y * (0.3 / 1.7); }
  ds *= strata;
  float wet = lod >= 2 ? 0.0 : smoothstep(0.66, 0.92, stX * wx + stZ * wz) * smoothstep(0.45, 0.75, vn1(pos.y / 27.0, 41.0).x) * steep;
  float blot = vn2(vec2(pos.z / 83.0, pos.y / 61.0)) * wx + vn2(vec2(pos.x / 83.0 + 17.3, pos.y / 61.0)) * wz;
  grad = vec3(Z.y * wz, 0.0, X.y * wx) * steep + vec3(0.0, ds * steep * 0.9, 0.0);
  return (g * 0.8 + 0.58) * ((sb - 0.5) * strata * 0.5 + 1.0) * (1.0 - wet * 0.45) * (blot * 0.36 + 0.82);
}
`;

/**
 * Ausbesserungen und Risse im Asphalt (wie gpu/mats.ts roadWear): je Abschnitt zufällig gesägte Flicken (eine
 * Spur, die Radspur, die ganze Breite; frisch dunkel oder alt und ausgebleicht) mit vergossener Fuge, Querrisse in
 * unregelmäßigen Abständen, stellenweise eine Längsfuge in der Mitte, großflächig wechselnde Alterung.
 *
 * Fast alle Zufallswerte dafür hängen nur von einer Größe ab: vom Straßenmeter längs (ausgefranste Flickenränder,
 * Fuge, Bitumen, Bröckelrand), vom Meter quer (Flickenenden, Riss) oder von der Nummer des Abschnitts (Lage, Länge
 * und Art jedes Flickens, Risses, Bitumenstreifens). Je Bildpunkt waren das rund hundert Zufallswerte – das
 * teuerste Stück Rechnung im ganzen Bild (die Straße füllt ein Drittel davon). Darum stehen sie in einer Tabelle
 * (WEAR_LUT_FRAG, einmal beim Bau der Bühne mit denselben Funktionen gerechnet): längs alle 3 cm, quer alle 1,6 cm
 * (dazwischen linear), je Abschnitt genau. Die langsame Alterung und die Stärke der Fahrspuren rechnet der
 * Eckenshader (Ecken alle 2 m, Wellen von 41 bis 271 m).
 * um, vm: quer (ab dem linken Rand der Normalbreite) und längs in Metern. Ergebnis: Farbfaktor.
 */
/** Tabelle: 4096 Spalten; Zeilen: je 128 m längs zwei (34 Blöcke bis 4352 m – Abschnitte zählen ab einem Vielfachen
 *  von 4096 m und sind 80 m lang), zwei quer (−16 … 48 m), sieben für die Abschnitte */
const WEAR_W = 4096;
const WEAR_VB = 34;
const WEAR_H = WEAR_VB * 2 + 2 + 7;
const WEAR_TAB = `
uniform sampler2D uWear;
const float WEAR_H = ${WEAR_H.toFixed(1)};
// längs (r = 0: Flickenränder quer, 1: Fuge, Bitumen, Bröckelrand)
vec4 wearV(float vm, float r) {
  float b = clamp(floor(vm / 128.0), 0.0, ${(WEAR_VB - 1).toFixed(1)});
  return textureLod(uWear, vec2(((vm - b * 128.0) * (4095.0 / 128.0) + 0.5) / ${WEAR_W.toFixed(1)}, (b * 2.0 + r + 0.5) / WEAR_H), 0.0);
}
// quer (r = 0: Flickenenden, 1: Riss)
vec4 wearU(float um, float r) {
  return textureLod(uWear, vec2(((um + 16.0) * (4095.0 / 64.0) + 0.5) / ${WEAR_W.toFixed(1)}, (${(WEAR_VB * 2).toFixed(1)} + r + 0.5) / WEAR_H), 0.0);
}
// je Abschnitt (genau, ohne Filter)
vec4 wearC(float c, int row) { return texelFetch(uWear, ivec2(int(mod(c, ${WEAR_W.toFixed(1)})), ${WEAR_VB * 2 + 2} + row), 0); }
`;
/** rechnet die Tabelle (Bildpunkt = Eintrag): dieselben Funktionen, die vorher je Bildpunkt liefen */
const WEAR_LUT_FRAG = `
${NOISE_GLSL}
float wH(float c, float seed, float k) { return h21(vec2(c, seed + k * 1.37)); }
// Ränder, die nicht schnurgerade laufen: zwei Oktaven weiches Rauschen um 0 (−0,68 … 0,68; gespeichert /1,4 + 0,5)
float wWob(float t, float seed) { return vn1(t * 1.7, seed).x - 0.5 + (vn1(t * 6.1, seed + 3.0).x - 0.5) * 0.35; }
vec4 wob4(float t, float a, float b, float c, float d) { return vec4(wWob(t, a), wWob(t, b), wWob(t, c), wWob(t, d)) / 1.4 + 0.5; }
void main() {
  float x = floor(gl_FragCoord.x);
  float row = floor(gl_FragCoord.y);
  vec4 o = vec4(0.0);
  if (row < ${(WEAR_VB * 2).toFixed(1)}) {
    float b = floor(row * 0.5);
    float vm = b * 128.0 + x * (128.0 / 4095.0);
    if (row - b * 2.0 < 0.5) o = wob4(vm, 3.1 + 11.0, 3.1 + 13.0, 8.3 + 11.0, 8.3 + 13.0);
    else o = vec4(
      ((vn1(vm / 3.1, 29.0).x - 0.5) * 0.14 + (vn1(vm / 0.8, 33.0).x - 0.5) * 0.04) * 5.0 + 0.5,
      smoothstep(0.55, 0.65, vn1(vm / 23.0, 31.0).x),
      vn1(vm * 1.7, 71.0).x,
      vn1(vm * 2.3, 73.0).x);
  } else if (row < ${(WEAR_VB * 2 + 2).toFixed(1)}) {
    float um = -16.0 + x * (64.0 / 4095.0);
    if (row < ${(WEAR_VB * 2 + 1).toFixed(1)}) o = wob4(um, 3.1 + 17.0, 3.1 + 19.0, 8.3 + 17.0, 8.3 + 19.0);
    else o = vec4(((vn1(um * 0.9, 17.0).x - 0.5) * 0.6 + (vn1(um * 3.7, 19.0).x - 0.5) * 0.16) / 0.8 + 0.5, 0.0, 0.0, 0.0);
  } else {
    float k = row - ${(WEAR_VB * 2 + 2).toFixed(1)};
    float c = x;
    // Flicken alle 13 m (dazu der Bitumenstreifen im selben Abschnitt), Flicken alle 37 m, Querriss alle 11 m
    if (k < 0.5) o = vec4(wH(c, 3.1, 0.0), wH(c, 3.1, 1.0), wH(c, 3.1, 2.0), wH(c, 3.1, 3.0));
    else if (k < 1.5) o = vec4(wH(c, 3.1, 4.0), wH(c, 3.1, 5.0), wH(c, 3.1, 6.0), h21(vec2(c, 61.3)));
    else if (k < 2.5) o = vec4(h21(vec2(c, 63.1)), h21(vec2(c, 65.7)), h21(vec2(c, 67.9)), h21(vec2(c, 69.2)));
    else if (k < 3.5) o = vec4(wH(c, 8.3, 0.0), wH(c, 8.3, 1.0), wH(c, 8.3, 2.0), wH(c, 8.3, 3.0));
    else if (k < 4.5) o = vec4(wH(c, 8.3, 4.0), wH(c, 8.3, 5.0), wH(c, 8.3, 6.0), 0.0);
    else if (k < 5.5) o = vec4(h21(vec2(c, 21.7)), h21(vec2(c, 23.81)), h21(vec2(c, 25.92)), h21(vec2(c, 28.03)));
    else o = vec4(h21(vec2(c, 30.14)), 0.0, 0.0, 0.0);
  }
  gl_FragColor = o;
}
`;
/** Eckenshader: langsame Alterung (50–300 m) und Stärke der Fahrspuren (41 m) je Ecke */
const WEAR_SLOW_VS = `vWearS = vec2(vn1(aRoad.y / 97.0, 43.0).x * 0.6 + vn1(aRoad.y / 271.0, 47.0).x * 0.4, vn1(aRoad.y / 41.0, 53.0).x);`;
/** Rauschen für den Eckenshader (ohne fwidth) */
const NOISE_VS_GLSL = `
float h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec2 vn1(float x, float seed) { float i = floor(x); float f = fract(x); float a = h21(vec2(i, seed)); float b = h21(vec2(i + 1.0, seed)); float s = f * f * (3.0 - 2.0 * f); return vec2(mix(a, b, s), (b - a) * 6.0 * f * (1.0 - f)); }
`;
const WEAR_GLSL = `
${WEAR_TAB}
float wStripe(float d, float w) { float fw = max(fwidth(d), 1e-4); float h = fw * 0.5; return (clamp(d + w, -h, h) - clamp(d - w, -h, h)) / fw; }
float wSpan(float x, float a, float b) { float fw = max(fwidth(x), 1e-4); return smoothstep(a - fw, a + fw, x) * (1.0 - smoothstep(b - fw, b + fw, x)); }
// Flicken: (innen, Fuge, frisch?) – c: Abschnitt, h0/h1: seine Zufallswerte, wv: Ränder quer (längs gelesen),
// wu: Enden (quer gelesen)
vec3 wPatch(float u, float vm, float len, float chance, float c, vec4 h0, vec4 h1, vec2 wv, vec2 wu) {
  float on = step(1.0 - chance, h0.x);
  // (mit Abstand zu den Zellgrenzen: dort würde der ausgefranste Rand gerade abgeschnitten)
  float l = mix(2.2, len * 0.75 - 0.8, h0.y * h0.y);
  float v0 = c * len + 0.4 + h0.z * (len - l - 0.8);
  float k = h0.w;
  float ua = k < 0.3 ? 0.5 : k < 0.55 ? 0.0 : k < 0.8 ? 0.12 + h1.x * 0.5 : 0.0;
  float ub = k < 0.3 ? 1.0 : k < 0.55 ? 0.5 : k < 0.8 ? ua + 0.2 + h1.y * 0.12 : 1.0;
  // Ränder ausgefranst (sonst ein Rechteck wie mit dem Lineal): quer um bis zu ±12 cm, längs um bis zu ±30 cm
  ua += wv.x * 0.045;
  ub += wv.y * 0.045;
  float va0 = v0 + wu.x * 0.6;
  float va1 = v0 + l + wu.y * 0.6;
  float inU = wSpan(u, ua, ub);
  float inV = wSpan(vm, va0, va1);
  float edge = min(max((wStripe(vm - va0, 0.035) + wStripe(vm - va1, 0.035)) * inU, (wStripe((u - ua) * 5.6, 0.035) + wStripe((u - ub) * 5.6, 0.035)) * inV), 1.0) * on;
  return vec3(inU * inV * on, edge, h1.z);
}
// rd: Abstand zur Kamera (m) – feine Linien (Risse, Fugen, Bitumen, Bröckelrand) nur in der Nähe, Flicken bis gut
// 100 m (weich ausgeblendet; dahinter geht der Belag ohnehin in seine Mittelfarbe über); slow: Alterung, Fahrspuren
vec3 roadWear(vec3 col, float um, float vm, float e, float rd, vec2 slow) {
  float u = um / 5.6;
  // Alterung: ältere Abschnitte heller und grauer, neuere dunkler (50–300 m)
  col *= mix(0.86, 1.16, slow.x);
  // längs: Fuge (Versatz, Maske), Bitumen, Bröckelrand
  vec4 V1 = wearV(vm, 1.0);
  float kP = smoothstep(130.0, 100.0, rd);
  if (kP > 0.0) {
    vec4 V0 = (wearV(vm, 0.0) - 0.5) * 1.4;
    vec4 U0 = (wearU(um, 0.0) - 0.5) * 1.4;
    float cA = floor(vm / 13.0);
    float cB = floor(vm / 37.0);
    vec3 A = wPatch(u, vm, 13.0, 0.45, cA, wearC(cA, 0), wearC(cA, 1), V0.xy, U0.xy);
    vec3 B = wPatch(u, vm, 37.0, 0.5, cB, wearC(cB, 3), wearC(cB, 4), V0.zw, U0.zw);
    // Flicken: frisch dunkel, alt heller und ausgebleicht; Fugen schwarz (Bitumen)
    col = mix(col, B.z < 0.55 ? col * 0.42 : col * 1.3, B.x * 0.9 * kP);
    col = mix(col, col * 0.28, B.y * 0.85 * kP);
    col = mix(col, A.z < 0.55 ? col * 0.42 : col * 1.3, A.x * kP);
    col = mix(col, col * 0.28, A.y * 0.85 * kP);
  }
  float kL = smoothstep(48.0, 36.0, rd);
  if (kL > 0.0) {
    float cc = floor(vm / 11.0);
    vec4 r0 = wearC(cc, 5);
    float vc = cc * 11.0 + r0.x * 11.0;
    float c1 = r0.y, c2 = r0.z, c3 = r0.w, c4 = wearC(cc, 6).x;
    // Querriss: schlängelt sich (zwei Oktaven) und läuft schräg
    float wav = (wearU(um, 1.0).x - 0.5) * 0.8 + (um - 2.8) * (c1 - 0.5) * 0.3;
    float reach = smoothstep(c2 * 0.6, c2 * 0.6 + 0.1, c3 < 0.5 ? u : 1.0 - u);
    float crack = wStripe(vm - vc - wav, 0.018) * step(0.35, c4) * reach;
    float joint = wStripe(um - 2.8 + (V1.x - 0.5) * 0.2, 0.02) * V1.y;
    col = mix(col, col * 0.24, max(crack, joint) * 0.9 * kL);
  }
#ifdef ROAD_RICH
  // Fahrspuren: je Spur zwei glattgefahrene, hellere Radspuren, dazwischen ein dunkler Ölstreifen (stärker und
  // schwächer über die Strecke)
  float lane = mod(um, 2.8);
  float wheel = smoothstep(0.42, 0.0, abs(lane - 0.65)) + smoothstep(0.42, 0.0, abs(lane - 2.15));
  float oil = smoothstep(0.5, 0.0, abs(lane - 1.4));
  float lm = slow.y;
  col *= 1.0 + wheel * 0.11 * (0.4 + lm) - oil * 0.12 * (1.3 - lm);
  // vergossene Risse (Bitumen): wellige, schwarz glänzende Linien schräg über die Fahrbahn
  if (kL > 0.0) {
    float tc = floor(vm / 13.0);
    vec4 t0 = wearC(tc, 2);
    float tv0 = tc * 13.0 + t0.x * 4.0;
    float tlen = 4.0 + t0.y * 8.0;
    float tpath = t0.z * 5.6 + (vm - tv0) * (t0.w - 0.5) * 1.1 + (V1.z - 0.5) * 0.4;
    float tar = wStripe(um - tpath, 0.02) * wSpan(vm, tv0, tv0 + tlen) * step(0.4, wearC(tc, 1).w);
    col = mix(col, vec3(0.04, 0.038, 0.04), tar * 0.72 * kL);
  }
  // ausgefranster Rand: die letzten Dezimeter bröckeln – heller Splitt, dunkle Löcher, unregelmäßig breit
  float ed = min(um + e, 5.6 + e - um) + (V1.w - 0.5) * 0.24;
  float rav = smoothstep(0.34, 0.02, ed);
  float kPit = smoothstep(44.0, 34.0, rd);
  float pit = kPit > 0.0 ? mix(0.4, step(0.6, vn2(vec2(um * 9.0, vm * 7.0))), kPit) : 0.4;
  col = mix(col, col * vec3(1.2, 1.14, 1.02), rav * 0.6);
  col = mix(col, col * 0.42, rav * pit * 0.7);
#endif
  return col;
}
`;

/**
 * Wiese wie in der WebGPU-Welt (uRelief muss vorher erklärt sein): Wiesenarten über ein paar Dutzend Meter (satte
 * Fettwiese, magere Weide, hellere und dunklere Flecken), Gras ohne Kachelmuster (Koordinaten weich verbogen),
 * Viehgangeln (schmale Trittpfade entlang der Höhenlinien an steilen Weiden; nur wo das Muster nicht flimmert)
 */
const MEADOW_GLSL = `
uniform vec4 uSeasonG;
uniform vec4 uSeasonH;
vec3 meadowZones(vec2 xz) { return vec3(texture2D(uRelief, xz / 260.0 + vec2(0.13, 0.71)).rg, texture2D(uRelief, xz / 170.0 + vec2(0.57, 0.29)).r); }
vec3 meadowTint(vec3 mz) {
  float lush = smoothstep(0.3, 0.62, mz.x);
  float lean = smoothstep(0.32, 0.66, mz.y) * (1.0 - lush);
  vec3 t = mix(vec3(1.0), vec3(0.8, 0.97, 0.72), lush * 0.8) * mix(vec3(1.0), vec3(1.17, 1.09, 0.78), lean * 0.85) * (mz.z * 0.32 + 0.9);
  // Jahreszeit (season.ts): strohig im Herbst und Winter (magere Weiden zuerst), frisch und saftig im Frühling
  t *= mix(vec3(1.0), vec3(1.55, 0.98, 0.5), uSeasonG.x * (0.6 + 0.4 * mz.y));
  t *= mix(vec3(1.0), vec3(0.93, 1.09, 0.84), uSeasonG.z * (0.5 + 0.5 * lush));
  return t;
}
vec4 grassTex(sampler2D g, sampler2D nz, vec2 uv) {
  vec2 w = uv + (textureLod(nz, uv * 0.137 + vec2(0.31, 0.77), 4.5).rg - 0.5) * 0.8;
  return textureGrad(g, w, dFdx(uv), dFdy(uv));
}
float cattleTracks(vec3 pos, float ny, float coarse, vec3 mz) {
  float sl = 1.0 - ny;
  float slopeM = smoothstep(0.07, 0.15, sl) * (1.0 - smoothstep(0.32, 0.45, sl));
  float cw = pos.y / 1.5 + coarse * 1.4 + mz.y * 2.5;
  float fr = fract(cw);
  float dl = min(fr, 1.0 - fr);
  float fade = 1.0 - smoothstep(0.1, 0.3, fwidth(cw));
  return (1.0 - smoothstep(0.035, 0.11, dl)) * fade * slopeM * smoothstep(0.2, 0.45, mz.z);
}
`;

const FALL_MORPH = `float fallMorph(vec3 p, vec2 d) {
  return d.x * smoothstep(uMorph0.z, uMorph0.w, max(abs(p.x - uMorph0.x), abs(p.z - uMorph0.y)))
    + d.y * smoothstep(uMorph.z, uMorph.w, max(abs(p.x - uMorph.x), abs(p.z - uMorph.y)));
}`;
/** Böden mit Relief (ab Stufe 7) und die Stärke ihres Reliefs (Höhenunterschied je Bildpunkt; zu viel flimmert) */
const GROUND_BUMP = ['asphalt', 'fresh', 'cobble', 'verge', 'walk', 'walk2', 'curb', 'gutter'] as const;
const BUMP_SCALE: Record<(typeof GROUND_BUMP)[number], number> = { asphalt: 0.35, fresh: 0.25, cobble: 0.9, verge: 0.5, walk: 0.55, walk2: 0.55, curb: 0.5, gutter: 0.7 };
const CAM_BACK = 6.2;
const CAM_UP = 2.75;
const SPRINT_BACK = 7.4;
const SPRINT_UP = 3.7;
/**
 * Stürze bleiben im Bild: Gestürzte werden auch hinter einem noch gezeichnet (bis WRECK_BACK m) und haben bei den
 * Fahrermodellen Vorrang (als lägen sie WRECK_PRIO m näher) – sonst verschwänden Fahrer und Rad mitten im Sturz,
 * sobald man vorbei ist. Zeigt die Kamera den Sturz von außen (Fernsehkamera), auch alle anderen bis TV_BACK m hinter
 * einem: wer in den Sturz hineinfährt, ist schon vorher zu sehen.
 */
const WRECK_BACK = 90;
const WRECK_PRIO = 40;
const TV_BACK = 70;
/**
 * Startkran (Startmenü): Winkel aus der Fahrtrichtung (rad; 0 vor dem Fahrer, π hinter ihm) und wie weit er pendelt,
 * Abstand zum Fahrer, Höhe über seiner Körpermitte, Blickpunkt voraus (m, negativ: hinter ihm) und dessen Höhe,
 * Sichtfeld hochkant. Schräg hinter und über dem Fahrer, der Blick über ihn hinweg auf Rampe, Uhr, Zuschauer und
 * Straße (Finals: über das Feld); mit „Los“ ein kurzer, ruhiger Schwenk hinter ihn – wenig Bewegung im Bild, die
 * Fahrkamera steht, wenn es losgeht. (Vor dem Fahrer wäre hinter ihm nur der leere Platz, und der Bogen um ihn
 * herum führte durch Bögen, Fahnen und Zuschauer.)
 */
interface MenuCam { ang: number; swing: number; r: number; up: number; ahead: number; lookY: number; fov: number }
const MENU_TT: MenuCam = { ang: -2.72, swing: 0.08, r: 9.5, up: 3.3, ahead: 0, lookY: 0.3, fov: 44 };
const MENU_DESC: MenuCam = { ang: -2.6, swing: 0.08, r: 9.5, up: 3.2, ahead: 0, lookY: 0.3, fov: 44 };
const MENU_FIN: MenuCam = { ang: 2.5, swing: 0.08, r: 9.5, up: 2.8, ahead: 3, lookY: 0.6, fov: 46 };
/** Kameraflug vom Startkran hinter den Fahrer: so viel höher in der Mitte des Bogens (über Absperrungen und Leute) */
const ORBIT_LIFT = 1.9;
/** Fahrerfeld: als Bild bis so weit voraus (m), davor weich ausgeblendet */
const FIELD_FAR = 650;
/** so viele der nächsten Gegner werfen einen Sonnenschatten (die übrigen nur ihren Fleck am Boden) */
const SUN_CASTERS = 8;
/**
 * Aussehen der Gegner in der Abfahrt: 16 feste Trikots (Teams, Hautton, Startnummer). Jedes Aussehen baut eigene
 * Netze (~0,6 MB) und eine Trikottextur und behält sie – mit einem neuen je Fahrer kämen im Fahrerfeld Hunderte
 * zusammen, und jedes neue kostete beim Auftauchen einen spürbaren Ruckler. Die 16 entstehen auf der Startkarte.
 */
const LOOKS: Kit[] = Array.from({ length: 16 }, (_, i) => ({ ...TEAM_KITS[i % TEAM_KITS.length], skin: SKINS[(i * 3 + 1) % SKINS.length], number: String(11 + ((i * 37) % 180)) }));
const LOOK_KEYS = new Set(LOOKS.map(riderKitKey));
/**
 * Feste Zuschauergruppen, wie sie an jeder Bergstraße sitzen und stehen – zehn Vorlagen, immer wieder verwendet:
 * Familie mit Kindern, Fanclub mit Fahnen, Wanderer, Picknick, Paar, Radler mit Kindern, Senioren auf der Bank,
 * Party, Fotografen, Clique am Hang. Alle stehen (Sitzende und Klappstühle sahen als Bilder aus wie in der Luft
 * hängend). u: längs der Straße (m), q: vom Bankett weg (m)
 */
const GROUPS: { u: number; q: number; act: number; kid?: boolean }[][] = [
  [{ u: 0, q: 1.2, act: Act.idle }, { u: 0.7, q: 1.3, act: Act.clap }, { u: -0.6, q: 0.8, act: Act.cheer, kid: true }, { u: 1.4, q: 0.8, act: Act.jump, kid: true }, { u: 0.3, q: 2.2, act: Act.wave }],
  [{ u: 0, q: 0.6, act: Act.flag }, { u: 0.9, q: 0.7, act: Act.cheer }, { u: 1.8, q: 0.5, act: Act.flag }, { u: 0.5, q: 1.7, act: Act.cheer }, { u: 1.4, q: 1.8, act: Act.wave }, { u: -0.8, q: 1.0, act: Act.shout }],
  [{ u: 0, q: 1.5, act: Act.idle }, { u: 1.1, q: 1.8, act: Act.clap }, { u: 2.0, q: 1.1, act: Act.clap }],
  [{ u: 0, q: 1.4, act: Act.cheer }, { u: 0.8, q: 1.0, act: Act.wave }, { u: 0.9, q: 2.1, act: Act.idle }, { u: 1.7, q: 1.5, act: Act.clap }],
  [{ u: 0, q: 0.5, act: Act.clap }, { u: 0.6, q: 0.6, act: Act.film }],
  [{ u: 0, q: 0.7, act: Act.cheer }, { u: 0.7, q: 0.6, act: Act.jump, kid: true }, { u: 1.3, q: 0.8, act: Act.wave, kid: true }, { u: 0.4, q: 1.8, act: Act.cheer }],
  [{ u: 0, q: 1.0, act: Act.wave }, { u: 0.65, q: 1.0, act: Act.idle }, { u: 1.3, q: 1.05, act: Act.clap }],
  [{ u: 0, q: 0.8, act: Act.dance }, { u: 0.8, q: 1.1, act: Act.cheer }, { u: 1.6, q: 0.7, act: Act.dance }, { u: 0.4, q: 2.0, act: Act.jump }, { u: 1.3, q: 2.1, act: Act.shout }, { u: 2.3, q: 1.6, act: Act.cheer }],
  [{ u: 0, q: 0.5, act: Act.film }, { u: 1.0, q: 0.9, act: Act.film }, { u: 0.5, q: 1.8, act: Act.wave }],
  [{ u: 0, q: 0.9, act: Act.idle }, { u: 0.7, q: 0.9, act: Act.clap }, { u: 1.4, q: 1.0, act: Act.cheer }, { u: 2.1, q: 0.9, act: Act.wave }, { u: 0.3, q: 2.0, act: Act.cheer }, { u: 1.1, q: 2.1, act: Act.wave }, { u: 1.8, q: 2.1, act: Act.flag }],
];
/** Anteil der Straßenstücke (je Seite) mit einer Gruppe: etwa alle 50 m eine */
const GROUP_P = 1 / 25;
/** Böden, auf denen Gruppen sitzen und stehen */
const GROUP_GROUND = new Set(['meadow', 'field', 'snow', 'pavement']);

/** Zuschauer (Bilder) bis so weit (m) */
const CROWD_FAR = 1300;
const smoothstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** Fan-Bögen: Masten knapp hinter der Absperrung, Spruchband hoch genug für die hohe Finalkamera */
const FAN_SPAN = 2 * (EDGE + 0.12);
const FAN_POLE = 6.1;
const FAN_Y = 5.35;      // Mitte des Bands an den Masten
const FAN_SAG = 0.2;     // so weit hängt das Band in der Mitte durch
const FAN_FIRST = 14;    // erster Bogen 28 m nach dem Anfang einer Zuschauerzone …
const FAN_EVERY = 44;    // … und bei langen Zonen alle 88 m ein weiterer

/** große Bauten am Talrand (france3d.ts): Bau und Radius je Rasterpunkt ohne Bäume */
const FAR_MARKS: Partial<Record<Mark, [(T: Town, at: At) => void, number]>> = {
  gatteville: [gatteville, 14], montStMichel: [montStMichel, 40], chambord: [chambord, 22], angers: [angersCastle, 24],
  albi: [albiCathedral, 18], sernin: [saintSernin, 18], mende: [mendeCathedral, 14], chateauPau: [chateauPau, 14],
  peyrou: [(T, at) => peyrouAqueduct(T, at, 260), 8],
};
/** Grundriss am Bau (quer l0…l1, längs a0…a1), Front zur Straße (face), Maßstab, Lieblingsabstand längs */
interface FarSite { l0: number; l1: number; a0: number; a1: number; face?: boolean; s?: number; ideal?: number }
const FAR_SITES: Partial<Record<Mark, FarSite>> = {
  gatteville: { l0: -30, l1: 22, a0: -6, a1: 14 },
  montStMichel: { l0: -150, l1: 150, a0: -150, a1: 150, s: 0.42, ideal: 700 },
  chambord: { l0: -87, l1: 87, a0: -40, a1: 32, face: true, s: 0.7 },
  angers: { l0: -76, l1: 94, a0: -58, a1: 70, s: 0.6 },
  albi: { l0: -21, l1: 18, a0: -25, a1: 116 },
  sernin: { l0: -36, l1: 36, a0: -2, a1: 118 },
  mende: { l0: -16, l1: 16, a0: -12, a1: 86, face: true },
  chateauPau: { l0: -47, l1: 39, a0: -9, a1: 35, face: true },
  peyrou: { l0: -12, l1: 12, a0: -26, a1: 262, ideal: 250 },
};

const PROP3D = new Set<string>(['pine', 'pineSnow', 'larch', 'tree', 'treeRound', 'cypress', 'olive', 'bush', 'rock', 'boulder', 'snowpole', 'hay', 'vinerow', 'fence', 'lamp', 'logs', 'palm', 'poplar', 'apple', 'plane', 'stonePine', 'lampParis', 'morris', 'kiosk', 'wallace', 'obelisk', 'calvaire', 'menhir', 'fronton', 'elephants', 'marteau']);
const BILLBOARD: Record<string, { variants: number; frames: number }> = {
  cow: { variants: 2, frames: 1 }, cowBW: { variants: 2, frames: 1 }, chevron: { variants: 1, frames: 1 },
  dosso: { variants: 1, frames: 1 }, chalet: { variants: 2, frames: 1 }, barn: { variants: 2, frames: 1 }, rifugio: { variants: 1, frames: 1 },
  farmhouse: { variants: 1, frames: 1 }, flowers: { variants: 4, frames: 1 }, grassTuft: { variants: 2, frames: 1 }, sunflowers: { variants: 2, frames: 1 },
  parasol: { variants: 4, frames: 1 }, boat: { variants: 4, frames: 1 }, fountain: { variants: 1, frames: 1 }, flagpole: { variants: 13, frames: 2 },
  campervan: { variants: 4, frames: 1 },
};
const CLOTH = ['#ff5fa2', '#2f80ed', '#ffd23f', '#f4f4f4', '#27ae60'];

/** Rücksprung der Oberkante einer Felswand (m): je höher, desto weiter zurückgelehnt (etwa 70°) */
export const wallSetback = (w: number, snow: boolean) => (snow ? 0.55 : 0.4) + w * 0.3;

const hash = (n: number) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};
const shadeF = (c: RGBf, f: number): RGBf => [c[0] * f, c[1] * f, c[2] * f];
const rgbLin = (c: RGB): RGBf => lin255(c[0], c[1], c[2]);

/** Netze für die Böden der Orte in einem Abschnitt (Gehwege, Bordstein, Rinne, Deckel) */
interface PaveGB { walk: GB; walk2: GB; curb: GB; gutter: GB; covers: GB }
type PFn = (r: Row, x: number, h: number) => number[];
/** Querprofil neben dem Bankett: Abstände, Höhen, Farben der Bänder; w: bis zu diesem Punkt Gehweg (Ort) */
interface Profile { o: number[]; h: number[]; cols: RGBf[]; w?: number }
const WHITE: RGBf = [1, 1, 1];
/** dunkle Stufe der Asphaltkante zum Bankett */
const ASPH_EDGE: RGBf = lin255(40, 41, 45);
/** weiches Rauschen entlang der Strecke (−0,5 … 0,5) je Segment i und Kanal k – keine Zacken von Segment zu Segment */
const along = (i: number, k: number, per = 5) => {
  const f = i / per;
  const i0 = Math.floor(f);
  let t = f - i0;
  t = t * t * (3 - 2 * t);
  const h0 = hash(i0 * 7919 + k * 131);
  const h1 = hash((i0 + 1) * 7919 + k * 131);
  return h0 + (h1 - h0) * t - 0.5;
};
/** Rinne vor dem Bordstein (innen → außen: Abstand zur Mitte, Höhe, v der Textur): leicht gemuldet */
const GUTTER_PROF: [number, number, number][] = [[EDGE - GUTTER_W, 0, 0], [EDGE - GUTTER_W * 0.45, -0.022, 0.55], [EDGE, -0.032, 1]];

/** Straßenquerschnitt an einem Segmentanfang; e: zusätzliche halbe Fahrbahnbreite (Straße mal breiter, mal enger) */
/** Querschnitt der Straße am Segmentanfang: Mitte (ohne Relief), Querrichtung, Streckenmeter m, Mehrbreite e */
interface Row { x: number; y: number; z: number; rx: number; rz: number; th: number; seg: Seg; e: number; m: number }
/** ab hier (|x|, m) gehört ein Punkt zum Fahrbahnrand und rückt mit der Breite nach außen; die Mitte bleibt */
const EDGE_IN = ROAD_HALF - 0.5;
/** Querlage x an einer Stelle mit zusätzlicher halber Breite e */
/** offizielle Bögen (Wertungen): eigener, auffälliger Aufbau (officialArch) */
const OFFICIAL = new Set(['finish', 'start', 'gpm', 'sprint', 'flamme', 'split']);
const widen = (x: number, e: number) => (x >= EDGE_IN ? x + e : x <= -EDGE_IN ? x - e : x);
/** Zuschauergruppe: 3D-Netze (fein, einfach) für 10 m Straße, die Bilder (spr) decken 20 m (zwei Gruppen teilen sich eins) */
interface CrowdBatch { near: THREE.Mesh[]; mid: THREE.Mesh[]; spr: THREE.Mesh | null; c: THREE.Vector3; r: number; sc: THREE.Vector3; sr: number; lod: number }
interface Chunk { idx: number; group: THREE.Group; dispose: () => void; glow: THREE.Mesh | null; lamps: Float32Array | null; crowd: CrowdBatch[]; detail: Detail | null }
/** Kleinteile der Häuser eines Abschnitts: nur in der Nähe sichtbar */
interface Detail { mesh: THREE.Mesh; c: THREE.Vector3; r: number }
/** bis zu diesem Abstand (m, waagrecht bis zum Rand) zeigen Häuser Balkone, Fensterbänke und Blumen */
const DETAIL_FAR = 150;
/** angestoßene Shader (bis sie fertig sind) */
interface Warm { progs: object[]; t: number }
/** Bauteile der Häuser eines Abschnitts */
interface Runner { z: number; x: number; v: number; go: boolean; p: Person; act: number; yaw: number; flag: boolean }
/** Reihenfolge des Nachladens (Stufe, größter Ring): beim Start erst der Nahbereich, dann die Ferne */
const ORDER_START: [number, number][] = [[0, 1], [1, 1], [2, 9], [1, 9], [0, 9]];
const ORDER_RIDE: [number, number][] = [[0, 9], [1, 9], [2, 9]];
/** Schlüssel einer Kachel als Zahl (Stufe, Spalte, Zeile) – keine Zeichenketten in den Schleifen je Bild */
const TK = 16384;
const tkey = (lv: number, i: number, j: number) => (lv * TK + (i + TK / 2)) * TK + (j + TK / 2);
const tkI = (k: number) => (Math.floor(k / TK) % TK) - TK / 2;
const tkJ = (k: number) => (k % TK) - TK / 2;
interface Tile { lv: number; key: number; objs: THREE.Object3D[]; geos: THREE.BufferGeometry[]; tsrc: TreeSource | null; box: [number, number, number, number]; stale?: boolean; out?: boolean; staged?: boolean; keep?: boolean }

/** so viel kommt je Bild vorab auf die Grafikkarte (Geometrie und Texturen neuer Teile, Bytes) */
const UP_BYTES = 256 * 1024;
/** Anmeldung zum Vorab-Hochladen: Objekte und Texturen, Fortschritt, noch gebraucht?, fertig */
interface UpJob { objs: THREE.Object3D[]; tex: THREE.Texture[]; i: number; ti: number; ai: number; alive: () => boolean; done: () => void }
/** Texturen eines Materials (Bildfelder und Uniforms eigener Shader) */
function texturesOf(m: THREE.Material, out: Set<THREE.Texture>) {
  const mm = m as unknown as Record<string, unknown>;
  for (const k of ['map', 'emissiveMap', 'alphaMap', 'normalMap', 'bumpMap', 'aoMap', 'lightMap', 'specularMap']) {
    const t = mm[k] as THREE.Texture | null | undefined;
    if (t && (t as THREE.Texture).isTexture) out.add(t);
  }
  const u = (m as THREE.ShaderMaterial).uniforms;
  if (u) for (const k in u) { const v = u[k]?.value as THREE.Texture | undefined; if (v && v.isTexture) out.add(v); }
}
/** Überblendung einer neu gebauten Kachel: die neue (inc) erscheint, die alte (out) geht – je Bildpunkt genau eine */
interface TileFade { lv: number; a: number; dur: number; inc: Tile[]; out: Tile[] }
interface AtlasEntry { u0: number; v0: number; u1: number; v1: number; w: number; h: number; du: number }

/** Füllarbeit (Wechseltest): Obergrenze der Schleifen je Bildpunkt */
const HEAT_MAX = 2048;

export class Renderer3D {
  quality = 1;
  /** PC-Grafik (gfxOpts „pc“, gilt ab dem Start): höhere Auflösung, feinere Berge, Gras, alle Fahrer voll detailliert */
  readonly pc = gfxOn('pc');
  /** Kantenglättung (gehört zum Grafikkontext; in allen Stufen an, siehe gfxOpts) */
  readonly aa = gfxAA();
  /** steht die Bühne gerade in einem Spiel (pool.ts)? Sonst wartet das Neuübersetzen nach einer Umschaltung */
  active = false;
  /** Shader nach einer Umschaltung neu anstoßen, sobald die Bühne wieder zeichnet */
  private needWarm = false;
  /** Startrampe, Torbögen und Schilder in einer neuen Farbe der Rundfahrt bauen (beim nächsten Bild) */
  private recolor = false;
  /** eben ein Bild auf den Bildschirm gezeichnet (für blank) */
  private justDrew = false;
  dark = false;
  accent = '#ff5fa2';
  readonly gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, 1, 0.25, 15000);
  private overlay: CanvasRenderingContext2D;
  private overlayCv: HTMLCanvasElement;
  private W = 1;
  private H = 1;
  private track: Track | null = null;
  private chunks = new Map<number, Chunk>();
  private friendsKey = '';

  // Licht
  private hemi = new THREE.HemisphereLight(0xffffff, 0x445533, 1.1);
  private sun = new THREE.DirectionalLight(0xffffff, 1.6);
  /** sanftes Gegenlicht: Schattenseiten von Fels und Wänden saufen nicht ab */
  private fill = new THREE.DirectionalLight(0xbcd4ff, 0.5);
  private fog = new THREE.FogExp2(0xcfe0ea, 0.0024);
  /** Bild mit Kantenglättung (mehrere Abtastpunkte je Bildpunkt) */
  private msaa = true;
  private night = 0;
  private tunnelDim = 0;

  // Himmel, Berge, Tal
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private mtn: THREE.Mesh | null = null;
  private mtnOld: THREE.Mesh | null = null;
  private mtnBiome: BiomeId | null = null;
  /** Berge der nächsten Landschaft im Bau (in Schritten) */
  private mtnGen: { biome: BiomeId; it: Generator<void, THREE.Mesh, void> } | null = null;
  /** Berge der neuen Landschaft: fertig gebaut, werden noch hochgeladen (dann erst überblenden) */
  private mtnWait: { m: THREE.Mesh; biome: BiomeId; ready: boolean } | null = null;
  private mtnFade = 1;
  /** PC-Grafik: Schatten der feinen Berge nach der gewanderten Sonne neu rechnen (in Schritten), dann überblenden */
  private mtnSun: { m: THREE.Mesh; it: Generator<void, boolean, void> } | null = null;
  private mtnSunFade: THREE.Mesh | null = null;
  /** zum Prüfen: Rechenzeit je Bild für den Bau der Berge (ms; null = wie üblich) */
  debugPeakMs: number | null = null;
  /** Teamwagen (teamcar3d.ts): einmal je Teamfarben gebaut (vor dem Start, unsichtbar vorgewärmt) */
  private teamCar: TeamCar3D | null = null;
  private carW = { x: 0, y: 0, z: 0, th: 0 };
  private carLook = new THREE.Vector3();
  /** PC-Grafik: Schattenwurf der Bäume (Bild zur Sonne gedreht, Umriss aus dem Vorrat) */
  private bbDepth: THREE.ShaderMaterial | null = null;
  /** PC-Grafik: Gras am Wegrand (grass3d.ts) – ein Material für alle Strecken (bleibt übersetzt) */
  private grass: Grass3D | null = null;
  private grassMat: THREE.MeshLambertMaterial | null = null;
  /** Licht für die Berge am Horizont (eigener Shader) */
  private peakU = peakLight();
  private valley: THREE.Mesh;
  private valleyMat: THREE.MeshLambertMaterial;
  /** Himmel: Stimmung des Tages (Wolken, Front, Hochnebel), vom Wetter überstimmbar */
  private mood: SkyMood = dailyMood(0);
  /**
   * Jahreszeit der Strecke (season.ts): Bäume (Laubfärbung, kahl, Schnee, Blüte), Boden (strohig, Schnee, frisch,
   * Blumen), dazu Laub am Boden, Herbstwald und kahler Wald – als Uniforms, ohne neue Shader je Jahreszeit
   */
  season: SeasonLook = seasonLook('2027-07-01', 'dolomiten');
  readonly seasonT = { value: new THREE.Vector4(0, 0, 0, 0) };
  readonly seasonG = { value: new THREE.Vector4(0, 0, 0, 1) };
  readonly seasonH = { value: new THREE.Vector4(0, 0, 0, 0) };
  private air!: SeasonAir;
  /** Rauch aus Kaminen (Herbst, Winter) */
  private smokeMat!: THREE.ShaderMaterial;
  private airLight = new THREE.Color();
  private airSun = new THREE.Color();
  private moodOverride: Partial<SkyMood> | null = null;
  /** Adler, Gleitschirme, Ballon, Fernsehhubschrauber */
  private skyLife = new SkyLife();
  private leaderV = new THREE.Vector3();

  // Landschaft (Höhenfeld in drei Stufen)
  private terrain: Terrain | null = null;
  /** Rechenbereich der Landschaft für den gerade gebauten Abschnitt */
  private region: Region | null = null;
  private tiles = new Map<number, Tile>();
  /** Bäume: Bildvorrat, Bildbäume je Kachel/Abschnitt, nahe 3D-Bäume */
  private treeAtlas!: TreeAtlas;
  private bbMat!: THREE.ShaderMaterial;
  private treeSrc = new Set<TreeSource>();
  /** beim Bau eines Abschnitts: dessen Bäume (TREC je Baum) */
  private cTrees: number[] | null = null;
  private terrMats: THREE.MeshLambertMaterial[] = [];
  private waterMats: THREE.MeshPhongMaterial[] = [];
  /** Uniforms des Wassers (Prüfungen: Wellenstärke, Spiegelung zum Einstellen) */
  waterU: WaterUniforms | null = null;
  /** Gebiet, das eine Stufe vollständig abdeckt (dort wird die nächstgröbere abgesenkt) */
  private lvBox = LEVELS.map(() => new THREE.Vector4(1e9, 1e9, -1e9, -1e9));
  /** nach einem Ringwechsel das bisherige Gebiet, solange seine Kacheln noch stehen (sonst gleich lvBox) */
  private lvBoxA = LEVELS.map(() => new THREE.Vector4(1e9, 1e9, -1e9, -1e9));
  private boxTmp = new THREE.Vector4();
  /** Übergang zur gröberen Stufe je Stufe: Mittelpunkt (x, z), Beginn, Ende */
  private morphU = LEVELS.map(() => ({ value: new THREE.Vector4(0, 0, 1e9, 2e9) }));
  private morphC = LEVELS.map(() => new THREE.Vector2(NaN, NaN));
  /** wirksamer Außenradius (wächst beim Aufbau mit dem Gebiet, ohne Sprung) */
  private morphR = LEVELS.map(() => -1);
  private tFades: TileFade[] = [];
  /** Stufe einmal vollständig aufgebaut (danach bleibt die Abdeckung, bis der neue Ring fertig ist) */
  private boxSet = LEVELS.map(() => false);
  private lastTerrCam = new THREE.Vector3(1e9, 0, 0);
  /** Blickrichtung (geglättet, waagrecht): die Kachelringe liegen nach vorn verschoben – vor der Kamera
   *  reicht die feine Stufe weiter, hinter ihr (unsichtbar) weniger weit */
  private terrFwd = new THREE.Vector3(0, 0, -1);
  private terrDir = new THREE.Vector3();
  /** Kachel im Bau (wird über mehrere Bilder verteilt fertiggestellt) */
  private pending: { key: number; lv: number; gen: Generator<void, Tile, void>; ver: number } | null = null;

  // Materialien
  private mats!: {
    asphalt: THREE.MeshLambertMaterial; fresh: THREE.MeshLambertMaterial; cobble: THREE.MeshLambertMaterial; gravel: THREE.MeshLambertMaterial;
    verge: THREE.MeshLambertMaterial; marks: THREE.MeshLambertMaterial; terrain: THREE.MeshLambertMaterial; portal: THREE.MeshLambertMaterial; barrier: THREE.MeshLambertMaterial;
    water: THREE.MeshPhongMaterial; facade: THREE.MeshLambertMaterial; roof: THREE.MeshLambertMaterial;
    tunWall: THREE.MeshBasicMaterial; tunRoad: THREE.MeshBasicMaterial; tunMarks: THREE.MeshBasicMaterial; tunSign: THREE.MeshBasicMaterial; masonry: THREE.MeshLambertMaterial;

    tiles: THREE.MeshLambertMaterial; sign: THREE.MeshLambertMaterial; bulb: THREE.PointsMaterial; lantern: THREE.PointsMaterial;
    props: THREE.MeshLambertMaterial; ads: THREE.MeshLambertMaterial; billboard: THREE.MeshLambertMaterial; glow: THREE.PointsMaterial; lampGlow: THREE.MeshBasicMaterial;
    /** Böden der Orte (groundTex.ts): zwei Gehwege, Bordstein, Rinne, Schachtdeckel */
    walk: THREE.MeshLambertMaterial; walk2: THREE.MeshLambertMaterial; curb: THREE.MeshLambertMaterial; gutter: THREE.MeshLambertMaterial; covers: THREE.MeshLambertMaterial;
  };
  /** Größe einer Kachel (m) der Bodentexturen der aktuellen Gegend */
  private gsz = { asphalt: 5, fresh: 5, cobble: 2.2, gravel: 5, walk: 2, walk2: 2, curb: 8, gutter: 2, verge: 3 };
  /** Böden der Orte im Abschnitt, der gerade entsteht */
  private paveGB: PaveGB | null = null;
  private groundKey = '';
  private groundTexs: THREE.Texture[] = [];
  private props!: Partial<Record<Prop3D, THREE.BufferGeometry>>;
  private markGeo!: Record<Landmark, THREE.BufferGeometry>;
  private markMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  /** Wasserfälle: fließende Gischt (Textur läuft nach unten) */
  private fallMat: THREE.MeshLambertMaterial | null = null;
  private mistMat: THREE.MeshLambertMaterial | null = null;
  private atlas = new Map<string, AtlasEntry>();
  private bank = new SpriteBank();
  private labelTex = new Map<string, THREE.Texture>();
  /** Fan-Bögen: Band (Zelle im Atlas) je Stück, null = keiner – hängt nur an der Strecke */
  private fanCache = new Map<number, number | null>();
  private fanMat: THREE.MeshLambertMaterial | null = null;
  private fanGeo: { pole: THREE.BufferGeometry; pennant: THREE.BufferGeometry; cells: ({ front: THREE.BufferGeometry; back: THREE.BufferGeometry } | undefined)[] } | null = null;
  /** Materialien zu den Beschriftungen: je Textur eines (bleiben wie die Texturen bestehen) */
  private labelMat = new Map<string, THREE.Material>();
  private matFor(key: string, make: () => THREE.Material): THREE.Material {
    let m = this.labelMat.get(key);
    if (!m) { m = make(); this.labelMat.set(key, m); }
    return m;
  }
  private shadowTex!: THREE.Texture;
  private time = { value: 0 };
  /** Licht in den Tunnelröhren (Leuchten, Tageslicht an den Portalen) */
  private tunU: TunnelUniforms = tunnelUniforms();
  /** Tunnel: erstes und letztes Segment je Segment im Tunnel */
  private tunSpan = new Map<number, [number, number, number]>();

  // Dynamisches
  private riders = new Map<number, RiderModel>();
  /** Nebenbewegungen und weiche Übergänge je Gegner (riderAnim.ts) */
  private anims = new Map<number, RiderAnim>();
  /** Fahrer in der Ferne als 2D-Bilder (ein Zeichenaufruf für alle) */
  private rs!: RiderSprites;
  /** ab wo Bilder statt 3D-Fahrer (m; zum Prüfen änderbar) – PC-Grafik: 3D-Fahrer bis gut 80 m */
  spriteNear = this.pc ? 82 : SPRITE_NEAR;
  spriteFar = this.pc ? 98 : SPRITE_FAR;
  /** einfache Grafik (gfxOpts): je Bild gelesen, damit das Umschalten im Pausenmenü sofort wirkt */
  private get lite(): boolean { return gfxOn('lite'); }
  private player: RiderModel | null = null;
  private playerAnim = new RiderAnim(1, true);
  private playerKit = '';
  private objPool: Map<string, THREE.Object3D[]> = new Map();
  private objUsed = new Map<string, number>();
  private objRoot = new THREE.Group();
  private parts: THREE.Points;
  private partPos = new Float32Array(300 * 3);
  private partCol = new Float32Array(300 * 3);
  // Zuschauer
  private crowdU = { uTime: this.time, uRider: { value: new THREE.Vector3() } };
  private crowdMat = crowdMaterial(this.crowdU);
  /** Läufer neben dem Fahrer: immer fein (ohne Detailstufen) */
  private runMat = crowdMaterial(this.crowdU, true);
  /** Zuschauer in der Ferne: Bilder aus dem Vorrat (einmal aus den 3D-Figuren gezeichnet) */
  private crowdAtlas!: CrowdAtlas;
  private sprMat!: THREE.MeshLambertMaterial;
  /** Zeitfahren: Startbereich (Podest, Rampe, Uhr, Personal) */
  private ttStart: TtStart3D | null = null;
  /** Abfahrt: Startort auf der Passhöhe (Piazza, Turm, Café, Menschen, Tauben) – nach dem Ort wieder freigegeben */
  private descStart: DescentStart3D | null = null;
  /** Dinge in der Hand der Menschen (Kameras, Stoppuhr, Tassen): Eckpunktfarben, glatt */
  private gearMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private runners: Runner[] = [];
  private runBuf = new THREE.InstancedInterleavedBuffer(new Float32Array(6 * STRIDE), STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
  private runMeshes: THREE.Mesh[] = [];
  private runNext = 0;
  private adsGB: GB | null = null;
  private w2 = { x: 0, y: 0, z: 0, th: 0 };

  // Kamera
  private cam = { x: 0, y: 0, z: 0, th: 0, init: false, fov: 70, pack: 0 };
  playerScreen = { x: 0, y: 0, s: 60 };
  /** nur für Tests und den Welt-Editor: feste Kamera [x, y, z, Blickziel x, y, z] */
  debugCam: number[] | null = null;
  /** Welt-Editor: den eigenen Fahrer nicht zeigen */
  hidePlayer = false;
  private markers: EditorMarkers | null = null;
  private ray = new THREE.Raycaster();
  private rayV = new THREE.Vector2();

  /** Welt-Editor: Hügel und Mulden haben sich geändert (die Strecke kennt sie) – betroffene Kacheln neu bauen */
  setBumps(changed: TerrainBump[]) {
    for (const b of changed) this.invalidateTerrain(b.x - b.r - 2, b.z - b.r - 2, b.x + b.r + 2, b.z + b.r + 2);
  }

  /** Änderungen aus dem Welt-Editor neu aufgelegt: alles neu bauen (Straße und Landschaft) */
  rebuildAll() {
    if (!this.track) return;
    this.invalidateChunks(0, (this.track.length + 1) * SEG);
    for (const t of this.tiles.values()) t.stale = true;
  }

  /** Welt-Editor: Kacheln in einem Gebiet (Weltkoordinaten) neu bauen */
  invalidateTerrain(x0: number, z0: number, x1: number, z1: number) {
    for (const t of this.tiles.values()) {
      const b = t.box;
      if (b[0] < x1 && b[2] > x0 && b[1] < z1 && b[3] > z0) t.stale = true;
    }
  }

  /** Welt-Editor: Straßenabschnitte zwischen zwei Streckenmetern neu bauen (die alten stehen, bis die neuen da sind) */
  invalidateChunks(z0: number, z1: number) {
    const k0 = Math.max(0, Math.floor(z0 / SEG / CH));
    const k1 = Math.floor(z1 / SEG / CH);
    for (let k = k0; k <= k1; k++) {
      const c = this.chunks.get(k);
      if (!c) continue;
      this.chunks.delete(k);
      const prev = this.chunkOld.get(k);
      if (prev) this.dropChunk(prev);
      this.chunkOld.set(k, c);
    }
    if (this.chunkGen && this.chunkGen.k >= k0 && this.chunkGen.k <= k1) this.chunkGen = null;
  }

  /** Welt-Editor: Marker (Notizen, Hügel, gesetzte Requisiten) */
  setMarkers(list: Marker[]) {
    if (!this.markers) {
      this.markers = new EditorMarkers();
      this.scene.add(this.markers.group);
    }
    this.markers.set(list);
  }

  /**
   * Welt-Editor: Weltpunkt unter einer Bildschirmposition (0…1 von links oben) – Landschaft, Straße und
   * Requisiten; Himmel, Wolken, Fahrer und Marker zählen nicht. null = nichts getroffen.
   */
  pick(u: number, v: number): { x: number; y: number; z: number } | null {
    this.rayV.set(u * 2 - 1, -(v * 2 - 1));
    this.ray.setFromCamera(this.rayV, this.camera);
    this.ray.far = 6000;
    const hits = this.ray.intersectObjects(this.scene.children, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      let skip = !(o as THREE.Mesh).isMesh;
      while (o && !skip) { if (o.userData.nopick || o === this.sky || o === this.valley) skip = true; o = o.parent; }
      if (skip) continue;
      return { x: h.point.x, y: h.point.y, z: h.point.z };
    }
    return null;
  }

  /** Welt-Editor: Geländehöhe an einem Weltpunkt (null, solange keine Strecke da ist) */
  groundY(x: number, z: number): number | null {
    return this.terrain ? this.terrain.groundAt(x, z) : null;
  }

  /** Welt-Editor: Kamera (Position und Blickziel 20 m voraus) für Notizen */
  cameraPose(): [number, number, number, number, number, number] {
    const p = this.camera.position;
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    return [p.x, p.y, p.z, p.x + d.x * 20, p.y + d.y * 20, p.z + d.z * 20];
  }
  /** Prüfmodus für Löcher: Himmel unter dem Horizont und die tiefe Rückfallfläche werden magenta */
  set debugHoles(on: boolean) {
    this.skyMat.uniforms.uHoles.value = on ? 1 : 0;
    const vm = this.valleyMat as unknown as THREE.MeshBasicMaterial;
    vm.color.set(on ? 0xff00ff : 0xcfe0ea);
    vm.fog = !on;
    vm.needsUpdate = true;
    this.holeMode = on;
    this.holeU.value = on ? 1 : 0;
  }
  private holeMode = false;
  private holeU = { value: 0 };
  /** Sichtweite: Abstände der Bäume (Ausblenden) und des Kronendachs (Heben, Farbe) als Uniforms */
  private treeFadeU = { value: new THREE.Vector2(VR0.fade, VR0.gone) };
  private canU = { value: new THREE.Vector4(VR0.canNear, VR0.canFull, VR0.gone - 10, VR0.detail) };
  private range = VR0;
  private rangeVer = 0;
  /** Sichtweite übernehmen (live: Ringe wachsen/schrumpfen über die übliche Ringpflege) */
  private applyRange() {
    if (this.rangeVer === viewRangeVersion()) return;
    this.rangeVer = viewRangeVersion();
    const r = viewRange();
    this.range = r;
    LEVELS.forEach((L, lv) => { L.ring = r.rings[lv]; });
    MORPH[0] = [...r.morph[0]]; MORPH[1] = [...r.morph[1]];
    MORPH_AHEAD[0] = Math.round(r.morph[0][1] * 0.23);
    AHEAD = r.ahead;
    this.treeFadeU.value.set(r.fade, r.gone);
    this.canU.value.set(r.canNear, r.canFull, r.gone - 10, r.detail);
  }
  /** Shader-Programme, die nicht übersetzt haben (0 = alles in Ordnung) */
  shaderErrors = 0;
  private w = { x: 0, y: 0, z: 0, th: 0 };

  constructor(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement) {
    // Kantenglättung (MSAA): auf Handy-GPUs günstig, Kanten und Linien werden weich – nur in den untersten
    // Grafikstufen aus
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: this.aa, powerPreference: 'high-performance', alpha: false, stencil: false });
    { const c = this.gl.getContext(); this.msaa = (c.getParameter(c.SAMPLES) as number) >= 2; }
    // einmal verloren, immer verloren (siehe lost): auch wenn der Browser den Kontext zurückgibt
    canvas.addEventListener('webglcontextlost', () => { this.wasLost = true; });
    // Shader, die nicht übersetzen, bleiben unsichtbar (ganze Landschaftsstufen!): zählen und in der
    // Bildraten-Anzeige zeigen, dazu wie üblich in der Konsole melden
    this.gl.debug.onShaderError = (gl, program, vs, fs) => {
      this.shaderErrors += 1;
      const log = (s: WebGLShader) => (gl.getShaderInfoLog(s) ?? '').trim();
      console.error('Shader übersetzt nicht:', (gl.getProgramInfoLog(program) ?? '').trim(), log(vs), log(fs));
    };
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    // sanfte Tonwertkurve (helle Sonne ohne ausgefressene Farben) plus leichter Filmlook (GRADE)
    this.gl.toneMapping = THREE.CustomToneMapping;
    this.gl.toneMappingExposure = 1.08;
    // Keine Schattenkarte: ein zweiter Zeichendurchgang ist auf älteren Handys zu teuer.
    // Fahrer und Zuschauer haben weiche Bodenschatten.
    this.gl.shadowMap.enabled = false;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.sun.castShadow = false;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -36; sc.right = 36; sc.top = 36; sc.bottom = -36; sc.near = 20; sc.far = 420;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.05;
    this.overlayCv = overlay;
    this.overlay = overlay.getContext('2d')!;
    this.scene.fog = this.fog;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.fill, this.fill.target, this.objRoot, this.skyLife.group);

    // Himmel mit Wolken, Sonne und Sternen (sky.ts); das Rauschen kommt aus derselben Textur wie Straße und Gelände
    this.noiseMap = this.dataTex(noiseTex(), 1);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: true, depthFunc: THREE.LessEqualDepth, fog: false, toneMapped: true,
      uniforms: skyUniforms(this.noiseMap),
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), this.skyMat);
    this.sky.userData.nopick = true;
    // nach allem Festen (siehe SKY_VERT): nur sichtbarer Himmel kostet Rechenzeit
    this.sky.renderOrder = 9;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.scene.add(this.sunset.mesh);


    // Talboden: nur noch Rückfallfläche tief unten (die Landschaft kommt aus dem Höhenfeld)
    this.valleyMat = new THREE.MeshBasicMaterial({ color: 0xcfe0ea, fog: true }) as unknown as THREE.MeshLambertMaterial;
    this.valley = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000), this.valleyMat);
    this.valley.userData.nopick = true;
    this.valley.rotation.x = -Math.PI / 2;
    // nach allem Festen, vor dem Himmel: three.js ordnet Festes nach Material, nicht nach Tiefe – als eines der
    // ersten Materialien rechnete die Fläche sonst über halb des Bildschirms jeden Bildpunkt, den danach die
    // Landschaft überdeckt (Messung: 54 % des Bilds umsonst). Jetzt verwirft der Tiefentest alles Verdeckte.
    this.valley.renderOrder = 8;
    this.scene.add(this.valley);

    // Partikel
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.partPos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(this.partCol, 3));
    const pt = alphaTex(roundTex('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), [255, 255, 255]);
    this.parts = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.35, map: pt, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }));
    this.parts.frustumCulled = false;
    this.scene.add(this.parts);
    // Jahreszeit in der Luft: Herbstlaub, Schnee, Blütenblätter (season3d.ts)
    this.air = new SeasonAir(900);
    this.scene.add(this.air.points);
    this.smokeMat = smokeMaterial(this.time);

    this.initMaterials();
    this.crowdAtlas = bakeCrowdAtlas(this.gl);
    this.treeAtlas = bakeTreeAtlas(this.gl, this.pc ? 1.5 : 1);
    // mit Kantenglättung (Normalfall) blenden die Bäume über sie weich aus
    this.bbMat = billboardMaterial(this.treeAtlas, this.peakU, this.time, this.treeFadeU, this.msaa, this.morphU[0], this.seasonT);
    // PC-Grafik: Bäume werfen Schatten (ihr Bild dreht sich im Schattendurchgang zur Sonne)
    this.bbDepth = this.pc ? billboardDepthMaterial(this.treeAtlas, this.time, this.treeFadeU, this.morphU[0]) : null;
    this.sprMat = spriteMaterial(this.crowdU, this.crowdAtlas);
    this.rs = new RiderSprites(this.peakU, this.msaa);
    this.scene.add(this.rs.mesh);
    this.rs.mesh.userData.nopick = true;
    this.skyLife.group.userData.nopick = true;
    // Landmarken (auf der mittleren Stufe) folgen deren Übergang zur gröbsten
    const mU = this.morphU[1];
    const mU0 = this.morphU[0];
    this.markMat.onBeforeCompile = (sh) => {
      sh.uniforms.uMorph = mU;
      sh.uniforms.uMorph0 = mU0;
      // Felsen der Wasserfälle liegen auf der feinen Stufe: weiter weg folgen sie der mittleren (aD1), dann der gröbsten
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aDy;\nattribute float aD1;\nuniform vec4 uMorph;\nuniform vec4 uMorph0;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += aD1 * smoothstep(uMorph0.z, uMorph0.w, max(abs(position.x - uMorph0.x), abs(position.z - uMorph0.y))) + aDy * smoothstep(uMorph.z, uMorph.w, max(abs(position.x - uMorph.x), abs(position.z - uMorph.y)));');
    };
    this.markMat.customProgramCacheKey = () => 'marks-morph2';
    // weiches Ein- und Ausblenden (Abschnitte, Kacheln, Straßenobjekte): Materialien vor dem ersten Bild vorbereiten
    for (const m of [...Object.values(this.mats), ...this.terrMats, ...this.waterMats, this.markMat, this.crowdMat, this.sprMat]) appearify(m);
    this.resize();
    // im Pausenmenü umgeschaltet (gfxOpts): feine Landschafts-Shader oder Sonnenschatten – die betroffenen Shader
    // gleich neu übersetzen (ein kurzer Halt im Menü statt Ruckler beim ersten Dorf oder Tunnel)
    // neue Auflösung (Schieberegler): wirkt direkt vor dem nächsten Bild
    this.offRes = onGfxSettings(() => this.requestResize());
    this.offGfx = onGfxChange((k) => {
      if (k === 'details' || k === 'lite') {
        const { asphalt, fresh, cobble, gravel, verge, terrain, portal, walk, walk2, curb, gutter, covers } = this.mats;
        for (const m of [asphalt, fresh, cobble, gravel, verge, terrain, portal, walk, walk2, curb, gutter, covers, ...this.terrMats]) m.needsUpdate = true;
      }
      if (k === 'details') {
        // Relief an oder aus: Höhenkarten neu (ein kurzer Halt im Menü)
        for (const g of GROUND_BUMP) this.mats[g].bumpMap = gfxOn('details') ? this.placeholder(true) : null;
        this.groundKey = '';
        if (this.track) this.applyGround(this.track);
      }
      // (nach den anderen Empfängern: das Wetter schaltet die Schatten erst noch um). Im Spiel gleich (ein kurzer
      // Halt im Pausenmenü), eine Bühne im Vorrat erst, wenn sie wieder gebraucht wird – sonst rechnet die Grafik
      // beim Umstellen im Profil oder auf der Startseite im Hintergrund und alles stockt
      if (k === 'licht') return;
      if (this.active) queueMicrotask(() => this.rewarm());
      else this.needWarm = true;
    });
  }

  private offGfx: () => void;
  private offRes: () => void;

  /** nach einer Umschaltung: alle Shader neu anstoßen (Vorwärm-Gruppe und was gerade in der Szene ist) */
  private rewarm() {
    if (this.lost) return;
    try {
      this.progSeen.clear();
      if (this.warmGroup) this.warmUp(this.warmGroup);
      this.warmUp(this.scene);
    } catch (e) { console.error(e); }
  }

  /**
   * Tabelle der Straßenabnutzung (WEAR_GLSL): einmal je Bühne auf der Grafikkarte gerechnet – mit denselben
   * Zufallsfunktionen wie vorher je Bildpunkt, also dieselben Flicken und Risse. Lebt nur im Grafikspeicher (wie
   * die gebackenen Zuschauer): nach einem verlorenen Kontext wird die Bühne ohnehin neu gebaut (lost).
   */
  private wearRT: THREE.WebGLRenderTarget | null = null;
  private wearTable(): THREE.Texture {
    if (this.wearRT) return this.wearRT.texture;
    const rt = new THREE.WebGLRenderTarget(WEAR_W, WEAR_H, {
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
    });
    rt.texture.colorSpace = THREE.NoColorSpace;
    const mat = new THREE.ShaderMaterial({ vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: WEAR_LUT_FRAG, depthTest: false, depthWrite: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    const sc = new THREE.Scene();
    sc.add(quad);
    const prev = this.gl.getRenderTarget();
    this.gl.setRenderTarget(rt);
    this.gl.render(sc, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
    this.gl.setRenderTarget(prev);
    quad.geometry.dispose();
    mat.dispose();
    this.wearRT = rt;
    return rt.texture;
  }

  /** Datentextur (Rauschen, Helligkeit): Werte wie gemalt, ohne Farbraum-Umrechnung */
  private dataTex(c: HTMLCanvasElement, aniso: number): THREE.CanvasTexture {
    const t = this.tex(c, true, aniso);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  }

  /** anisotrope Filterung: 4 reicht fast überall (16 kostet auf Handys an flachen Flächen viel Speicherbandbreite) */
  private tex(c: HTMLCanvasElement, repeat = true, aniso = 4): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(c);
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    // (PC-Grafik: volle anisotrope Filterung – Straße und Hänge bis in die Ferne scharf)
    t.anisotropy = Math.min(this.pc ? Math.max(aniso, 16) : aniso, this.gl.capabilities.getMaxAnisotropy());
    return t;
  }

  private ph: THREE.DataTexture[] = [];
  /** 1 × 1 Stellvertreter (Farbe sRGB, Höhe ohne Farbraum) – bis die Texturen der Gegend da sind */
  private placeholder(data = false): THREE.DataTexture {
    const i = data ? 1 : 0;
    if (!this.ph[i]) {
      const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat);
      t.colorSpace = data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.needsUpdate = true;
      this.ph[i] = t;
    }
    return this.ph[i];
  }

  /**
   * Böden der Gegend (groundStyle.ts): Asphalt im Ton der Region, Pflaster, zwei Gehwege, Bordstein, Rinne,
   * Bankett und Schachtdeckel in der Landessprache. Einmal je Strecke (beim Laden), die Materialien bleiben –
   * nur ihre Texturen wechseln. Mit Relief (Stufe 7+) auch die Höhenkarten.
   */
  private applyGround(track: Track) {
    const st = GROUND_STYLES[track.region] ?? GROUND_STYLES.dolomiten;
    const bump = gfxOn('details');
    const key = `${track.region}|${track.lang}|${bump ? 1 : 0}`;
    if (key === this.groundKey) return;
    this.groundKey = key;
    for (const t of this.groundTexs) t.dispose();
    this.groundTexs = [];
    const put = (k: keyof typeof this.gsz, g: GroundTex, aniso = 8) => {
      const m = this.mats[k as keyof typeof this.mats] as THREE.MeshLambertMaterial;
      const t = this.tex(g.color, true, aniso);
      m.map = t;
      this.groundTexs.push(t);
      if (bump && g.height && m.bumpMap) {
        const h = this.dataTex(g.height, 4);
        m.bumpMap = h;
        this.groundTexs.push(h);
      }
      this.gsz[k] = g.size;
    };
    const b = bump ? '+b' : '';
    const C = groundCached;
    put('asphalt', C(`a:${st.asphalt}${b}`, () => groundAsphalt(false, st.asphalt, bump)));
    put('fresh', C(`f:${st.asphalt}${b}`, () => groundAsphalt(true, st.asphalt, bump)));
    put('cobble', C(`c:${st.cobble}${b}`, () => cobbleTex(st.cobble, bump)));
    put('verge', C(`v:${st.verge}${b}`, () => vergeTex(st.verge, bump)), 4);
    put('walk', C(`w:${st.walk[0]}${b}`, () => walkTex(st.walk[0], bump)), 4);
    put('walk2', C(`w:${st.walk[1]}${b}`, () => walkTex(st.walk[1], bump)), 4);
    put('curb', C(`k:${st.curb}${b}`, () => curbTex(st.curb, bump)), 4);
    put('gutter', C(`g:${st.gutter}${b}`, () => gutterTex(st.gutter, bump)), 4);
    const lang = coverLang(track.lang);
    const cv = this.tex(C(`d:${lang}`, () => coverAtlas(lang)), false, 4);
    this.mats.covers.map = cv;
    this.groundTexs.push(cv);
  }

  private noiseMap!: THREE.CanvasTexture;

  /**
   * Relieftextur aus einer gemalten Rauschtextur: R = Kanal r, G = Höhe (Kanal ch), B/A = Steigung der Höhe
   * je Texel in u und v (×4, um 0,5). Damit lässt sich Licht auf Rinnen und Buckeln ohne Bildschirm-Ableitungen
   * rechnen; die Mipmaps glätten die Steigung in der Ferne (kein Flimmern).
   */
  private reliefTex(cv: HTMLCanvasElement, ch: number): THREE.DataTexture {
    const w = cv.width;
    const h = cv.height;
    const img = cv.getContext('2d')?.getImageData?.(0, 0, w, h);
    const out = new Uint8Array(w * h * 4).fill(128);
    if (img?.data) {
      const src = img.data;
      const H = (x: number, y: number) => src[(((y + h) % h) * w + ((x + w) % w)) * 4 + ch] / 255;
      const enc = (v: number) => Math.max(0, Math.min(255, Math.round(128 + v * 4 * 255)));
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          out[i] = src[i];
          out[i + 1] = src[i + ch];
          out[i + 2] = enc((H(x + 1, y) - H(x - 1, y)) / 2);
          out[i + 3] = enc((H(x, y + 1) - H(x, y - 1)) / 2);
        }
      }
    }
    const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  }

  /**
   * Wiesentextur (tex3d.grassTex): Farbe im RGB (sRGB), Blütenmaske im Alpha – als Datentextur, damit die
   * Farbe unter der Maske nicht verloren geht (Leinwände speichern sie vormultipliziert). Dazu der Mittelwert
   * je Kanal (linear): durch ihn geteilt ist die Textur im Mittel 1 und ändert die Helligkeit nicht – in der
   * Ferne (kleinste Mipmaps) passt sie so von selbst zu den gröberen Stufen ohne Textur.
   */
  private grassTexture(): { tex: THREE.Texture; mean: THREE.Vector3 } {
    const { rgb, flower } = grassTex();
    const w = rgb.width;
    const h = rgb.height;
    const a = rgb.getContext('2d')?.getImageData?.(0, 0, w, h)?.data;
    const m = flower.getContext('2d')?.getImageData?.(0, 0, w, h)?.data;
    const out = new Uint8Array(w * h * 4).fill(128);
    const sum = [0, 0, 0];
    const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    if (a && m) {
      for (let i = 0; i < w * h * 4; i += 4) {
        out[i] = a[i]; out[i + 1] = a[i + 1]; out[i + 2] = a[i + 2]; out[i + 3] = m[i];
        // Mittelwert ohne Blüten (die mischt der Shader über die Maske ein)
        const k = 1 - m[i] / 255;
        sum[0] += lin(a[i]) * k; sum[1] += lin(a[i + 1]) * k; sum[2] += lin(a[i + 2]) * k;
      }
    }
    let wsum = 0;
    if (m) for (let i = 0; i < w * h * 4; i += 4) wsum += 1 - m[i] / 255;
    const mean = wsum > 0 ? new THREE.Vector3(sum[0] / wsum, sum[1] / wsum, sum[2] / wsum) : new THREE.Vector3(0.2, 0.2, 0.2);
    const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(this.pc ? 16 : 2, this.gl.capabilities.getMaxAnisotropy());
    t.needsUpdate = true;
    return { tex: t, mean };
  }

  private initMaterials() {
    this.noiseMap ??= this.dataTex(noiseTex(), 1);
    const L = (opts: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(opts);
    const fa = facadeAtlas();
    // Fassaden: Grundfarbe und Wandmaske als Datentextur; waagrecht wiederholt – der ganzzahlige Anteil von u ist
    // die Wandfarbe des Hauses (WALL_PAL), die Textur selbst sieht nur den Bruchteil
    const facade = new THREE.DataTexture(fa.data, fa.w, fa.h, THREE.RGBAFormat);
    facade.colorSpace = THREE.SRGBColorSpace;
    facade.wrapS = THREE.RepeatWrapping;
    facade.magFilter = THREE.LinearFilter;
    facade.minFilter = THREE.LinearMipmapLinearFilter;
    facade.generateMipmaps = true;
    facade.anisotropy = Math.min(this.pc ? 16 : 4, this.gl.capabilities.getMaxAnisotropy());
    facade.needsUpdate = true;
    const facadeLit = this.tex(fa.night, false);
    facadeLit.wrapS = THREE.RepeatWrapping;
    const signs = this.tex(signAtlas(), false);
    const detailCv = detailTex();
    const detail = this.tex(detailCv);
    // gröbere Landschaftsstufen haben keine Detailtextur: dort ihr Mittelwert (sonst wären sie heller – sichtbare Kante)
    const detailMean = texMean(detailCv, true);
    this.shadowTex = alphaTex(roundTex('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)', 64), [0, 0, 0]);
    const glowMap = new THREE.CanvasTexture(glowTex(255, 205, 135));
    this.mats = {
      // Beläge, Gehwege, Bordstein, Rinne und Deckel bekommen ihre Texturen je Gegend (applyGround); bis dahin
      // ein Stellvertreter (dieselben Shader – der Tausch der Textur übersetzt nichts neu)
      asphalt: L({ map: this.placeholder() }),
      fresh: L({ map: this.placeholder() }),
      cobble: L({ map: this.placeholder() }),
      gravel: L({ map: this.tex(gravelTex(), true, 8) }),
      verge: L({ map: this.placeholder() }),
      walk: L({ map: this.placeholder() }),
      walk2: L({ map: this.placeholder() }),
      curb: L({ map: this.placeholder() }),
      gutter: L({ map: this.placeholder() }),
      covers: L({ map: this.placeholder(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      marks: L({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      terrain: L({ vertexColors: true, map: detail }),
      portal: L({ vertexColors: true, side: THREE.DoubleSide }),
      barrier: L({ vertexColors: true, side: THREE.DoubleSide }),
      water: new THREE.MeshPhongMaterial({ color: 0x2f7fb5, shininess: 90, specular: 0x88aacc, transparent: true, opacity: 0.92, flatShading: true }),
      tunWall: tunnelMaterial(this.tex(shotcreteTex()), this.tunU, 'wall'),
      tunRoad: tunnelMaterial(this.tex(asphaltTex(false)), this.tunU, 'road'),
      tunMarks: tunnelMaterial(null, this.tunU, 'marks', true),
      tunSign: new THREE.MeshBasicMaterial({ map: this.tex(tunnelSignTex(), false), color: new THREE.Color(1.15, 1.15, 1.15) }),
      masonry: L({ vertexColors: true, map: this.tex(masonryTex()), side: THREE.DoubleSide }),
      facade: L({ map: facade, emissiveMap: facadeLit, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0, vertexColors: true }),
      // Dächer, Giebel, Kamine, Fahnen: beidseitig (Dachüberstände sieht man von unten)
      roof: L({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }),
      tiles: L({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, map: this.tex(roofTex()) }),
      sign: L({ map: signs, emissiveMap: signs, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0 }),
      bulb: new THREE.PointsMaterial({ size: 0.55, map: glowMap, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 0 }),
      lantern: new THREE.PointsMaterial({ size: 1.7, map: glowMap, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 0 }),
      props: L({ vertexColors: true, flatShading: true }),
      ads: L({ vertexColors: true, side: THREE.DoubleSide }),
      billboard: L({ alphaTest: 0.5, side: THREE.DoubleSide }),
      glow: new THREE.PointsMaterial({ size: 3.2, map: glowMap, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 0 }),
      lampGlow: new THREE.MeshBasicMaterial({ map: glowMap, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }),
    };
    // Winter: Schnee auf den Dächern (season3d.ts)
    for (const m of [this.mats.roof, this.mats.tiles]) {
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (sh, r) => { prev.call(m, sh, r); roofSnowHook(sh); };
      m.customProgramCacheKey = () => `roof-snow-${m.map ? 't' : 'p'}`;
    }
    // Straßenbeläge und Bankett: großflächige Flecken (Flickstellen, Abrieb, Staub) brechen das Kachelmuster auf,
    // in der Ferne geht die Textur in ihre Mittelfarbe über – kein Flimmern, keine Linien beim Fahren
    // feines Korn für die Nähe (ab Stufe 3): Splitt und Sand, in Weltkoordinaten (keine Kachel erkennbar)
    const grainMap = this.dataTex(grainTex(), 4);
    const grass = this.grassTexture();
    const roadU = { uNoise: { value: this.noiseMap }, uRelief: { value: this.reliefTex(noiseTex(), 1) }, uTime: this.time, uGrain: { value: grainMap }, uGrassE: { value: grass.tex }, uGrassEM: { value: grass.mean }, uWear: { value: this.wearTable() } };
    // wear: Flicken, Risse und Fugen (Asphalt; die Fahrbahn trägt dafür ihre Straßenmeter in aRoad: quer, längs,
    // Mehrbreite); grain: Korn in der Nähe; warp: Koordinaten weich verbogen (keine Wiederholung der Kachel);
    // edge: organischer Übergang am Rand (aX: Farbe des Bodens daneben, Anteil quer 0 … 1) – 'verge' innen zur
    // Fahrbahn und außen zum Gelände, 'walk' außen zum Gelände
    const roadify = (m: THREE.MeshLambertMaterial, key: string, patch: number, wear = false, grain = 0, warp = false, edge: '' | 'verge' | 'walk' = '', sheen = 0) => {
      m.onBeforeCompile = (sh) => {
        const rich = !gfxOn('lite');
        // schlichte Böden (Stufe 1–2): ohne Flicken und Risse, ohne verbogene Koordinaten, ohne Glanz – die Grafik
        // ist dort am Limit, die Straße füllt ein Drittel des Bilds
        const wr = wear && rich, wp = warp && rich, sn = rich ? sheen : 0;
        Object.assign(sh.uniforms, roadU, { uLampP: LAMP_U.uLampP, uLampCol: LAMP_U.uLampCol });
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>\nvarying vec3 vWP;${wr ? `\nattribute vec3 aRoad;\nvarying vec3 vRoad;\nvarying vec2 vWearS;\n${NOISE_VS_GLSL}` : ''}${edge ? '\nattribute vec4 aX;\nvarying vec4 vX;' : ''}`)
          .replace('#include <project_vertex>', `#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;${wr ? `\nvRoad = aRoad;\n${WEAR_SLOW_VS}` : ''}${edge ? '\nvX = aX;' : ''}`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>\n${rich ? '#define ROAD_RICH\n' : ''}uniform sampler2D uNoise;\nuniform sampler2D uRelief;\nuniform sampler2D uGrain;\nuniform float uTime;\nvarying vec3 vWP;${edge ? '\nuniform sampler2D uGrassE;\nuniform vec3 uGrassEM;\nvarying vec4 vX;' : ''}${wr ? `\nvarying vec3 vRoad;\nvarying vec2 vWearS;\n${NOISE_GLSL}\n${WEAR_GLSL}` : ''}\n${LAMP_GLSL}`)
          // Lichtkegel der Laternen auf Straße und Bankett
          .replace('#include <lights_fragment_end>', lampFrag('vWP'))
          // matter Glanz bei flachem Blick: der Himmel (Farbe des Dunstes) spiegelt sich auf dem Belag – so zeichnen
          // sich Wellen, Dach und Querneigung der Fahrbahn in der Ferne ab wie auf einer echten Straße
          .replace('#include <envmap_fragment>', sn > 0 ? `#include <envmap_fragment>
            {
              float sNv = clamp(dot(normal, geometryViewDir), 0.0, 1.0);
              float sF1 = 1.0 - sNv;
              float sF2 = sF1 * sF1;
              float sFr = sF2 * sF2 * sF1 * ${sn.toFixed(2)};
              #ifdef USE_FOG
                vec3 sSky = fogColor;
              #else
                vec3 sSky = vec3(0.6);
              #endif
              outgoingLight = mix(outgoingLight, sSky * 0.8, sFr);
            }` : '#include <envmap_fragment>')
          .replace('#include <map_fragment>', `
            #ifdef USE_MAP
              ${wr || wp ? `// Körnung ohne erkennbare Wiederholung (sonst alle 5 m dieselben Steine): Koordinaten weich verbogen
              vec2 mUv = vMapUv + (textureLod(uNoise, vMapUv * 0.137 + vec2(0.31, 0.77), 4.5).rb - 0.5) * 0.6;
              vec4 sampledDiffuseColor = textureGrad(map, mUv, dFdx(vMapUv), dFdy(vMapUv));` : 'vec4 sampledDiffuseColor = texture2D(map, vMapUv);'}
              ${edge ? `{
                // Rand: keine gerade Linie – Zungen und Flecken des Bodens daneben greifen herein (Rauschen in Weltlage)
                float en = texture2D(uNoise, vWP.xz / 3.3).g * 0.62 + texture2D(uNoise, vWP.xz / 0.9 + 0.43).r * 0.38;
                float mo = smoothstep(${edge === 'verge' ? '0.42, 0.97' : '0.3, 0.97'}, vX.w + (en - 0.5) * ${edge === 'verge' ? '0.75' : '0.6'});
                vec3 gt = texture2D(uGrassE, vWP.xz / 4.2).rgb / uGrassEM;
                vec3 edgeC = vX.rgb * mix(vec3(1.0), gt, 0.75) * (0.88 + 0.24 * en);
                sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, edgeC, mo);
                ${edge === 'verge' ? `// innen: Brocken und Krümel der Asphaltkante auf dem Bankett
                float en2 = texture2D(uNoise, vWP.xz / 1.3 + 0.71).b;
                float mi = smoothstep(0.26, 0.02, vX.w + (en2 - 0.5) * 0.3);
                sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, vec3(0.055, 0.055, 0.06) * (0.75 + 0.6 * en), mi * 0.8);` : ''}
              }` : ''}
              // Mittelfarbe der Textur (kleinste Mipmap-Stufe)
              vec3 avgC = textureLod(map, vMapUv, 12.0).rgb;
              float rd = distance(vWP, cameraPosition);
              sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, avgC, smoothstep(28.0, 95.0, rd) * 0.8);
              ${grain > 0 ? `#ifdef ROAD_RICH
              // (nur in der Nähe – dahinter wäre es ein Texturzugriff für nichts)
              if (rd < 16.0) sampledDiffuseColor.rgb *= mix(1.0, texture2D(uGrain, vWP.xz / 0.7).r * 2.0, ${grain.toFixed(2)} * smoothstep(16.0, 3.0, rd));
              #endif` : ''}
              #ifdef ROAD_RICH
              // großflächige Flecken (Staub, Nässe, Ausbleichen) über die Kachel hinweg: keine Wiederholung sichtbar
              vec3 mn = texture2D(uNoise, vWP.xz / 26.0).rgb;
              vec3 mn2 = texture2D(uNoise, vWP.xz / 7.3 + 0.37).rgb;
              sampledDiffuseColor.rgb *= 1.0 + ${patch.toFixed(2)} * ((mn.r * 0.6 + mn.g * 0.4) - 0.5) + ${(patch * 0.45).toFixed(2)} * (mn2.g - 0.5);
              sampledDiffuseColor.rgb *= mix(vec3(1.0), vec3(1.05, 1.0, 0.92), mn.b * 0.8);
              #endif
              ${wr ? 'sampledDiffuseColor.rgb = roadWear(sampledDiffuseColor.rgb, vRoad.x, vRoad.y, vRoad.z, rd, vWearS);' : ''}
              diffuseColor *= sampledDiffuseColor;
              ${gfxOn('details') ? CLOUD('vWP.xz') : ''}
            #endif`);
      };
      m.customProgramCacheKey = () => `road-${key}${wear ? 'w' : ''}${grain > 0 ? 'k' : ''}${warp ? 'p' : ''}${edge}${sheen > 0 ? 's' : ''}${dk()}${gfxOn('lite') ? '' : '+r'}|L`;
    };
    roadify(this.mats.asphalt, 'a', 0.34, true, 0.45, false, '', 0.14);
    roadify(this.mats.fresh, 'f', 0.18, true, 0.35, false, '', 0.17);
    roadify(this.mats.cobble, 'c', 0.36, false, 0, false, '', 0.2);
    roadify(this.mats.gravel, 'g', 0.4, false, 0.3, false, '', 0.06);
    roadify(this.mats.verge, 'v', 0.45, false, 0.3, true, 'verge');
    roadify(this.mats.walk, 'wk', 0.3, false, 0, false, 'walk');
    roadify(this.mats.walk2, 'wk2', 0.3, false, 0, false, 'walk');
    roadify(this.mats.curb, 'cb', 0.22);
    roadify(this.mats.gutter, 'gt', 0.3);
    roadify(this.mats.covers, 'cv', 0.12);
    // Relief im Licht (ab Stufe 7): Höhenkarten der Böden als Bump-Map (Stellvertreter, bis die Gegend feststeht)
    if (gfxOn('details')) for (const k of GROUND_BUMP) { const m = this.mats[k]; m.bumpMap = this.placeholder(true); m.bumpScale = BUMP_SCALE[k]; }
    this.props = { ...propGeometries(), ...parisProps(), ...franceProps() };
    this.markGeo = landmarkGeometries();
    // Felsschichten an allen steilen Flächen (Landschaft, Wände am Straßenrand, Tunnelportale):
    // Weltkoordinaten statt UV – waagrechte Lagen laufen so über alle Flächen hinweg
    const rockMap = this.tex(rockTex());
    const grassU = { uGrass: { value: grass.tex }, uGrassMean: { value: grass.mean }, uSeasonG: this.seasonG, uSeasonH: this.seasonH };
    const rockU = { uRock: { value: rockMap }, uRelief: { value: this.reliefTex(noiseTex(), 1) }, uTime: this.time, uCanD: this.canU, ...grassU };
    const rockify = (sh: THREE.WebGLProgramParametersWithUniforms) => {
      Object.assign(sh.uniforms, rockU, { uLampP: LAMP_U.uLampP, uLampCol: LAMP_U.uLampCol });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRockP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvRockP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      // (uRelief und uTime erklärt auf der feinsten Landschaftsstufe schon der Landschafts-Shader – nicht doppelt,
      // sonst übersetzt der Shader nicht und die Stufe bleibt unsichtbar)
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform sampler2D uRock;\n#ifndef SPLAT_U\nuniform sampler2D uRelief;\nuniform float uTime;\nuniform vec4 uCanD;\nuniform sampler2D uGrass;\nuniform vec3 uGrassMean;\n${NOISE_GLSL}\n${RELIEF_GLSL}\n${MEADOW_GLSL}\n#endif\nvarying vec3 vRockP;\n${LAMP_GLSL}`)
        // Lichtkegel der Laternen (Hänge am Straßenrand, Portale, feinste Landschaftsstufe)
        .replace('#include <lights_fragment_end>', lampFrag('vRockP'))
        .replace('#include <map_fragment>', `
          #ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D(map, vMapUv);
            #ifdef TMORPH
              // Übergang zur gröberen Stufe: dort gibt es die Detailtextur nicht (nur ihren Mittelwert)
              sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, vec3(${detailMean.toFixed(4)}), vMk);
            #endif
          #else
            vec4 sampledDiffuseColor = vec4(1.0);
          #endif
          #if !defined(SPLAT_U) && defined(USE_COLOR)
          {
            // Hänge neben der Straße: grüne Flächen (Eckpunktfarbe deutlich grün) bekommen dieselbe Wiese wie
            // die Landschaft dahinter – Flecken, Büschel, Blüten; Fels, Schnee, Felder und Kies bleiben
            // (Texturen immer lesen – in einer Verzweigung stimmten die Mipmaps an ihrem Rand nicht)
            // Grenze zwischen grünen und anderen Bändern (Rinne, Kies, Fels, Feld): die Eckfarben gehen dort ineinander
            // über (terrainSide) – Rauschen macht aus dem Verlauf Zungen und Flecken statt einer geraden Linie
            float gg = vColor.g - max(vColor.r, vColor.b);
            ${gfxOn('lite') ? `// schlichte Böden (Stufe 1–2): nur das Gras, ohne Flecken, Wiesenarten und zweiten Maßstab
            float gw = smoothstep(0.012, 0.05, gg);
            vec4 g1 = texture2D(uGrass, vRockP.xz / 4.2);
            sampledDiffuseColor.rgb *= mix(vec3(1.0), g1.rgb / uGrassMean, gw);
            sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, g1.rgb * 0.5 / max(vColor.rgb, vec3(0.02)), min(1.0, g1.a * 0.75 * uSeasonG.w) * gw);` : `
            float gn = texture2D(uRelief, vRockP.xz / 2.7).g * 0.7 + texture2D(uRelief, vRockP.xz / 0.85 + 0.3).g * 0.3;
            float gw = smoothstep(0.012, 0.05, gg + (gn - 0.5) * 0.07 * smoothstep(0.003, 0.02, gg));
            vec3 nzg = texture2D(uRelief, vRockP.xz / 33.0).rgb;
            vec3 gm = mix(vec3(0.92, 0.98, 1.04), vec3(1.06, 1.02, 0.92), smoothstep(0.3, 0.72, nzg.r)) * (0.92 + 0.16 * nzg.g);
            // wie die Landschaft dahinter: Wiesenarten, Gras ohne Kachelmuster, Korn, Trittpfade
            vec3 mz = meadowZones(vRockP.xz);
            gm *= meadowTint(mz);
            vec4 g1 = grassTex(uGrass, uRelief, vRockP.xz / 4.2);
            vec3 g2 = texture2D(uGrass, mat2(0.8, -0.6, 0.6, 0.8) * vRockP.xz / 21.0 + 0.37).rgb;
            gm *= g1.rgb / uGrassMean * mix(vec3(1.0), g2 / uGrassMean, 0.65);
            ${gfxOn('details') ? `gm *= grainF(vRockP.xz, 0.55, 0.11) * grainF(vRockP.xz + 17.3, 0.13, 0.12);
            gm = mix(gm, gm * vec3(0.64, 0.58, 0.48), cattleTracks(vRockP, normalize((vec4(vNormal, 0.0) * viewMatrix).xyz).y, nzg.r, mz) * 0.8);` : ''}
            sampledDiffuseColor.rgb *= mix(vec3(1.0), gm, gw);
            // Blüten: Farbe statt Tönung (geteilt durch die Eckpunktfarbe, die danach noch multipliziert wird)
            sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, g1.rgb * 0.5 / max(vColor.rgb, vec3(0.02)), min(1.0, g1.a * 0.75 * uSeasonG.w) * gw);`}
            // Jahreszeit (season.ts): Herbstlaub auf der Wiese (Flecken aus einzelnen Blättern), Winter: Schnee (in
            // Mulden zuerst, fleckig auslaufend) – als Farbe, geteilt durch die Eckpunktfarbe (die danach noch dazukommt)
            if (uSeasonH.x + uSeasonG.y > 0.0) {
              vec2 sz = texture2D(uRelief, vRockP.xz / 3.3).rg;
              float lf = uSeasonH.x * smoothstep(0.62, 0.72, texture2D(uRelief, vRockP.xz * 0.9 + 0.21).r) * smoothstep(0.2, 0.55, sz.y);
              vec3 lc = mix(vec3(0.5, 0.17, 0.04), vec3(0.72, 0.46, 0.08), texture2D(uRelief, vRockP.xz * 3.1 + 0.5).g) * 0.55;
              sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, lc / max(vColor.rgb, vec3(0.02)), lf * gw * 0.9);
              float snw = smoothstep(0.42, 0.58, uSeasonG.y * 0.9 + (sz.x - 0.5) * 0.5);
              sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, vec3(0.84, 0.88, 0.93) * (0.93 + 0.1 * sz.y) / max(vColor.rgb, vec3(0.02)), snw * gw);
            }
          }
          #endif
          ${gfxOn('details') ? `{
            // Steilheit und Projektionsrichtung aus der weichen Eckennormale (je Dreieck wäre die Textur an jeder
            // Kante gebrochen – die Wand zerfiel in Facetten); Textur immer (gleichmäßiger Kontrollfluss → Mipmap)
            vec3 fn = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
            // nur in der Nähe: weiter weg würden die feinen Schichten zu Streifen flimmern
            float camDR = distance(vRockP, cameraPosition);
            float steep = (1.0 - smoothstep(0.5, 0.8, abs(fn.y))) * (1.0 - smoothstep(220.0 * uCanD.w, 460.0 * uCanD.w, camDR));
            #ifdef TMORPH
              steep *= 1.0 - vMk;
            #endif
            vec2 tu = vec2(-fn.z, fn.x) / max(1e-4, length(fn.xz));
            vec2 ruv = vec2(dot(vRockP.xz, tu), vRockP.y) / 11.0;
            vec2 rux = dFdx(ruv);
            vec2 ruy = dFdy(ruv);
            // nur lesen, wo Fels sichtbar ist (Ableitungen vorher, damit die Mipmap stimmt)
            if (steep > 0.003) {
              // zwei Maßstäbe: Schichten (11 m) und feine Körnung (2,7 m, nur nah) – sonst wirkt die Wand wie verwaschen
              vec4 r1 = textureGrad(uRock, ruv, rux, ruy);
              vec4 r2 = textureGrad(uRock, ruv * 4.1 + 0.37, rux * 4.1, ruy * 4.1);
              float fine = 1.0 - smoothstep(40.0 * uCanD.w, 120.0 * uCanD.w, camDR);
              vec3 rockC = r1.rgb * mix(vec3(1.0), 0.55 + 0.55 * r2.rgb, fine);
              #ifndef SPLAT_U
                // Felsrelief der Wände am Straßenrand (die Landschaft hat ihres im eigenen Teil)
                vec3 rgS;
                rockC *= rockRelief(vRockP, fn, 0.65, 0, rgS) * 1.04;
              #endif
              sampledDiffuseColor = mix(sampledDiffuseColor, vec4(rockC, 1.0), steep);
            }
          }` : ''}
          diffuseColor *= sampledDiffuseColor;
          ${gfxOn('details') ? CLOUD('vRockP.xz') : ''}`);
    };
    for (const [m, key] of [[this.mats.terrain, 'rock-terr'], [this.mats.portal, 'rock-portal']] as [THREE.Material, string][]) {
      m.onBeforeCompile = rockify;
      m.customProgramCacheKey = () => key + dk() + '|L';
    }
    // Landschaft pro Bildpunkt: Wald (Kronendach, organischer Rand), Fels und Schnee aus Gewichten je Ecke,
    // aufgebrochen mit Rauschen – statt verwaschener Eckpunktfarben
    const canCv = canopyTex();
    const canMean = texMean(canCv, false);
    const splatU = {
      ...grassU,
      // ohne anisotrope Filterung: großflächig, fein genug ohne – und auf schwachen Grafikchips teuer
      uRelief: { value: this.reliefTex(noiseTex(), 1) }, uCanopy: { value: this.dataTex(canCv, 2) },
      uForA: { value: new THREE.Color().setRGB(...lin255(32, 58, 38)) }, uForB: { value: new THREE.Color().setRGB(...lin255(58, 86, 52)) },
      uSnow: { value: new THREE.Color().setRGB(...lin255(240, 245, 250)) },
      uTime: this.time, uSunDir: this.peakU.uSunDir, uCanD: this.canU, uWoods: this.woodsU,
    };
    // Wolkenschatten: großflächige, langsam ziehende Flecken (gleiches Rauschen, gleiche Zeit in allen Materialien)
    const CLOUD = (pos: string) => `{ float cloud = smoothstep(0.5, 0.82, texture2D(uRelief, (${pos} + uTime * vec2(6.0, 2.5)) / 700.0).r); diffuseColor.rgb *= 1.0 - 0.3 * cloud; }`;
    // je Stufe nur, was dort sichtbar ist: feine Muster (Kronen, Felstextur, mittleres Rauschen) nur nah;
    // großflächiges Rauschen kommt je Ecke (aNz, vMat.w) statt aus einer Textur
    const splat = (sh: THREE.WebGLProgramParametersWithUniforms, lv: number) => {
      Object.assign(sh.uniforms, splatU);
      // Übergang zur gröberen Stufe (alle außer der gröbsten): je Ecke deren Werte, gemischt nach dem Abstand
      // zum Übergangs-Mittelpunkt – Höhe, Normale, Farbe, Gewichte, Rauschen, Kronendach
      const morph = lv < LEVELS.length - 1;
      if (morph) sh.uniforms.uMorph = this.morphU[lv];
      const MD = morph ? '#define TMORPH\n' : '';
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${MD}uniform vec4 uCanD;\nattribute vec4 aMat;\nattribute vec3 aRock;\nattribute float aCan;\nattribute vec2 aNz;\nvarying vec4 vMat;\nvarying vec3 vRk;\nvarying vec3 vTW;\nvarying vec2 vNz;
          #ifdef TMORPH
          attribute vec4 aC0;\nattribute vec4 aC1;\nattribute vec4 aC2;\nattribute vec4 aC3;\nattribute vec4 aC4;\nuniform vec4 uMorph;\nvarying float vMk;
          #endif`)
        .replace('void main() {', `void main() {
          #ifdef TMORPH
            float mk = smoothstep(uMorph.z, uMorph.w, max(abs(position.x - uMorph.x), abs(position.z - uMorph.y)));
            vMk = mk;
          #endif`)
        .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef TMORPH\nvColor.rgb = mix(color.rgb, aC2.rgb, mk);\n#endif')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n#ifdef TMORPH\nobjectNormal = normalize(mix(objectNormal, aC1.xyz, mk));\n#endif')
        // Kronendach: nah flach (dort stehen Bäume), weiter weg angehoben – stetig mit dem Abstand zur Kamera.
        // Alles additiv (das Absenken unter der feineren Stufe kommt unabhängig davon dazu)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef TMORPH
            transformed.y += (aC0.x - position.y) * mk;
            float canH = mix(aCan, aC0.y, mk);
          #else
            float canH = aCan;
          #endif
          { vec3 cw = (modelMatrix * vec4(transformed, 1.0)).xyz; transformed.y += canH * smoothstep(uCanD.x, uCanD.y, distance(cw.xz, cameraPosition.xz)); }`)
        .replace('#include <project_vertex>', `#include <project_vertex>
          #ifdef TMORPH
            vMat = mix(aMat, aC3, mk);\nvRk = mix(aRock, aC4.rgb, mk);\nvNz = mix(aNz, aC0.zw, mk);
          #else
            vMat = aMat;\nvRk = aRock;\nvNz = aNz;
          #endif
          vTW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${MD}${gfxOn('details') ? '#define TDETAIL\n' : ''}${gfxOn('lite') ? '#define TLITE\n' : ''}#define TLV ${lv}\n#define SPLAT_U\nuniform vec4 uCanD;\nuniform float uTime;\nuniform vec3 uSunDir;\nuniform sampler2D uRelief;\nuniform sampler2D uCanopy;\nuniform sampler2D uGrass;\nuniform vec3 uGrassMean;\nuniform vec3 uForA;\nuniform vec3 uForB;\nuniform vec3 uSnow;\nuniform float uWoods;\nvarying vec4 vMat;\nvarying vec3 vRk;\nvarying vec3 vTW;\nvarying vec2 vNz;\n#ifdef TMORPH\nvarying float vMk;\n#endif\n${NOISE_GLSL}\n${RELIEF_GLSL}\n${MEADOW_GLSL}`)
        .replace('#include <color_fragment>', `
          // Relief für die Beleuchtung als Steigung in Weltkoordinaten (m/m): Rinnen im Fels, Buckel in der Wiese.
          // Die Steigung kommt aus einer Textur mit Mipmaps (in der Ferne glatt) statt aus Bildschirm-Ableitungen.
          vec3 tGrad = vec3(0.0);
          #ifdef USE_COLOR
            // Normale in Weltkoordinaten (weich zwischen den Ecken)
            vec3 fnT = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
            float camD = distance(vTW, cameraPosition);
            float big = vMat.w;
            #if TLV < 2
              // mittleres Rauschen: r, Höhe g, Steigung von g in b/a (je Texel ×4)
              vec4 nz2 = texture2D(uRelief, vTW.xz / 33.0);
              #if TLV == 1 && defined(TMORPH)
                // die gröbste Stufe hat es nicht: im Übergang dorthin ausblenden
                nz2 = mix(nz2, vec4(0.5), vMk);
              #endif
            #else
              vec4 nz2 = vec4(0.5);
            #endif
            // großflächige Flecken (300 m): auf allen Stufen gleich gelesen – so sehen ferne Berge nicht wie eine
            // Fläche aus einem Guss aus, und an der Stufengrenze stimmt die Farbe überein
            float nzF = texture2D(uRelief, vTW.xz / 300.0).r;
            // Wiesen: Flecken heller/dunkler, mal saftiger, mal trockener (gelblicher)
            vec3 tCol = vColor.rgb * (0.92 + 0.16 * big);
            tCol = mix(tCol, tCol * vec3(1.08, 1.02, 0.9), smoothstep(0.55, 0.85, big) * 0.5);
            // Wiesenarten (Flecken von 30–130 m): auf allen Stufen gleich gelesen – an der Stufengrenze ändert sich nichts
            // (schlichte Böden: ihr Mittel statt dreier Texturen je Bildpunkt)
            #ifdef TLITE
              vec3 mz = vec3(0.5);
            #else
              vec3 mz = meadowZones(vTW.xz);
            #endif
            tCol *= meadowTint(mz);
            // Wiese aus der Nähe: Büschel, Flecken, Erde, Blüten (zwei Maßstäbe, gedreht gegeneinander – kein
            // sichtbares Kachelmuster); in der Ferne mitteln die Mipmaps die Textur zu 1
            #if TLV < 2
            {
              // mittelgroße Flecken (33 m): mal satter und kühler, mal trockener und gelber
              tCol *= mix(vec3(0.92, 0.98, 1.04), vec3(1.06, 1.02, 0.92), smoothstep(0.3, 0.72, nz2.r)) * (0.92 + 0.16 * nz2.g);
              #ifndef TLITE
              // (Gras ohne Kachelmuster: Koordinaten weich verbogen)
              vec4 g1 = grassTex(uGrass, uRelief, vTW.xz / 4.2);
              vec3 g2 = texture2D(uGrass, mat2(0.8, -0.6, 0.6, 0.8) * vTW.xz / 21.0 + 0.37).rgb;
              vec3 gt = g1.rgb / uGrassMean * mix(vec3(1.0), g2 / uGrassMean, 0.65);
              float fl = g1.a;
              #if TLV == 1 && defined(TMORPH)
                gt = mix(gt, vec3(1.0), vMk);
                fl *= 1.0 - vMk;
              #endif
              tCol *= gt;
              // Blüten behalten ihre Farbe (etwas gedämpft im Licht der Wiese)
              tCol = mix(tCol, g1.rgb * 0.5, min(1.0, fl * 0.75 * uSeasonG.w));
              #if TLV == 0 && defined(TDETAIL)
                // nah: unregelmäßige Helligkeit über einen halben Meter und feines Korn; Viehgangeln an steilen Weiden
                tCol *= grainF(vTW.xz, 0.55, 0.11) * grainF(vTW.xz + 17.3, 0.13, 0.12);
                tCol = mix(tCol, tCol * vec3(0.64, 0.58, 0.48), cattleTracks(vTW, fnT.y, nz2.r, mz) * 0.8);
              #endif
              #endif
            }
            #endif
            // Fels: Gewicht, Rauschen und die Steilheit dieser Fläche
            float rk = smoothstep(0.42, 0.64, vMat.y + (big - 0.5) * 0.4 + (nz2.r - 0.5) * 0.22 + (1.0 - fnT.y) * 0.3);
            float far = smoothstep(60.0, 220.0, camD);
            float hiF = 1.0 - smoothstep(450.0 * uCanD.w, 1300.0 * uCanD.w, camD);
            // Rinnen und Schichten nur an steilen Flächen
            float wallW = 1.0 - smoothstep(0.55, 0.85, fnT.y);
            // Felswände: senkrechte Rinnen (Erosion) – zwei feste Projektionen (waagrecht entlang z bzw. x, senkrecht
            // nach Höhe), gemischt nach der Wandrichtung. Das Muster hängt so nicht vom Netz ab: jede Landschaftsstufe
            // zeigt dasselbe (eine Projektion entlang der Fläche wurde auf groben Stufen zum Zickzack – beim Wechsel
            // der Stufe sichtbar). Gelesen nur, wo Fels ist (Ableitungen vorher: richtige Mipmap)
            float gul = 0.5;
            #ifdef TDETAIL
            vec2 wxz = fnT.xz * fnT.xz;
            wxz *= wxz;
            wxz /= max(wxz.x + wxz.y, 1e-6);
            vec2 gA = vec2(vTW.z / 120.0, vTW.y / 190.0);
            vec2 gB = vec2(vTW.x / 120.0, vTW.y / 190.0);
            vec2 gAx = dFdx(gA);
            vec2 gAy = dFdy(gA);
            vec2 gBx = dFdx(gB);
            vec2 gBy = dFdy(gB);
            if (rk * wallW > 0.01) {
              vec4 ra = wxz.x > 0.02 ? textureGrad(uRelief, gA, gAx, gAy) : vec4(0.5);
              vec4 rb = wxz.y > 0.02 ? textureGrad(uRelief, gB, gBx, gBy) : vec4(0.5);
              gul = mix(0.5, ra.g * wxz.x + rb.g * wxz.y, wallW);
              // Steigung (Textur hat 256 Texel, Kodierung ×4): Rinnen 18 m tief
              vec2 sa = (ra.ba - 0.5) * 64.0 * 18.0 * wxz.x;
              vec2 sb = (rb.ba - 0.5) * 64.0 * 18.0 * wxz.y;
              tGrad += vec3(sb.x / 120.0, (sa.y + sb.y) / 190.0, sa.x / 120.0) * (rk * far * wallW);
            }
            #endif
            float gul2 = mix(0.5, nz2.g, hiF * wallW);
            vec3 rc = vRk * (0.8 + 0.42 * nz2.r) * mix(1.0, 0.84 + 0.26 * mix(gul, gul2, 0.4), far);
            // großflächig hellere und dunklere Partien (Gesteinswechsel, Flechten) – vor allem in der Ferne
            rc *= 0.86 + 0.3 * nzF;
            // Felsrelief (wie in der WebGPU-Welt): Rinnen, Rippen, Bänke und Wasserstreifen – Helligkeit und Normale
            #ifndef TLITE
            {
              float rkR = rk * (1.0 - smoothstep(0.8, 0.97, fnT.y));
              if (rkR > 0.003) {
                vec3 rg;
                float kR = rockRelief(vTW, fnT, smoothstep(0.25, 0.7, nz2.g) * 0.7 + 0.3, TLV, rg);
                rc *= mix(1.0, kR * 1.04, smoothstep(0.003, 0.2, rkR));
                tGrad += rg * rkR;
              }
            }
            #endif
            // auf Absätzen (weniger steil) Gras und Geröll
            rc = mix(rc, vColor.rgb * 0.8, smoothstep(0.62, 0.8, fnT.y) * smoothstep(0.5, 0.72, big) * 0.6);
            // Felsflecken an bloß steilen Hängen (keine Wand): dunkler und mit Bewuchs durchsetzt – ein heller grauer
            // Fleck mitten im Grün las sich aus der Ferne wie ein Loch
            {
              float cliff = 1.0 - smoothstep(0.3, 0.55, fnT.y);
              rc = mix(mix(rc * 0.8, vColor.rgb * 0.62, 0.45), rc, cliff);
            }
            // Wald: Rand aus Rauschen; aus der Nähe Waldboden (dort stehen Bäume), weiter weg das Kronendach
            // Waldrand weich (kein harter Saum zwischen Wiese und Wald)
            float fo = smoothstep(0.42, 0.62, vMat.x + (big - 0.5) * 0.25 + (vNz.x - 0.5) * 0.6 + (nz2.g - 0.5) * 0.28) * (1.0 - rk);
            // Bergwald: die Maske ist schon die der Bäume (ausgefranst) – Waldboden genau dort, wo sie stehen
            fo = mix(fo, smoothstep(0.3, 0.7, vMat.x + (vNz.y - 0.5) * 0.2) * (1.0 - rk), uWoods);
            // Kronen: auf der feinen und mittleren Stufe aus der Textur (Mipmaps glätten sie in der Ferne von
            // selbst), auf der gröbsten ihr Mittelwert (gleiche Helligkeit an der Grenze)
            float crown = ${canMean.toFixed(4)};
            // Kronen mit Licht- und Schattenseite: das Kronendach ein Stück zur Sonne hin verschoben gelesen –
            // wo die Krone höher ist als die Nachbarin Richtung Sonne, liegt sie im Licht, sonst im Schatten
            float crownL = 0.0;
            #if TLV < 2 && defined(TDETAIL)
              vec2 cuv = vTW.xz / 10.0;
              vec2 cux = dFdx(cuv);
              vec2 cuy = dFdy(cuv);
              if (fo > 0.01) {
                crown = textureGrad(uCanopy, cuv, cux, cuy).r;
                float c2 = textureGrad(uCanopy, cuv + normalize(uSunDir.xz + vec2(1e-4)) * 0.3, cux, cuy).r;
                crownL = clamp((crown - c2) * 2.5, -1.0, 1.0);
              }
              #if TLV == 1 && defined(TMORPH)
                crown = mix(crown, ${canMean.toFixed(4)}, vMk);
                crownL *= 1.0 - vMk;
              #endif
            #endif
            // Waldfarbe: Kronendach mit großflächig hellerem und dunklerem Bestand; an steilen Hängen nur wenig
            // dunkler (sonst liest man einen Hangwald als Loch im Berg)
            vec3 fc = mix(uForA, uForB, nz2.r * 0.6 + nzF * 0.4) * (0.42 + crown * 0.9) * (1.0 + 0.4 * crownL);
            fc = mix(fc, uForA * vec3(0.72, 0.7, 0.58), smoothstep(0.78, 0.45, fnT.y) * 0.22);
            // Jahreszeit (season.ts): Laubwald-Flecken im Herbst bunt, im Winter kahl graubraun, Schnee in den Kronen
            {
              float dec = smoothstep(0.38, 0.72, nzF * 0.7 + nz2.g * 0.3);
              vec3 aut = fc * mix(vec3(2.5, 1.45, 0.42), vec3(2.3, 0.85, 0.3), nz2.b);
              fc = mix(fc, aut, uSeasonH.y * dec * (1.0 - uSeasonH.z * 0.6));
              fc = mix(fc, vec3(0.055, 0.047, 0.04) * (0.6 + crown * 0.7), uSeasonH.z * dec * 0.6);
              fc = mix(fc, uSnow * (0.62 + 0.25 * crown), uSeasonG.y * 0.55 * smoothstep(0.2, 0.7, crown + nz2.r * 0.3));
            }
            float canopy = smoothstep(uCanD.x, uCanD.z, camD);
            // nah: Waldboden aus Nadeln und Moos (bräunlich-oliv statt sattem Grün)
            fc = mix(vec3(0.042, 0.048, 0.026), fc, 0.45 + 0.55 * canopy);
            // Schichtung: wellige waagrechte Lagen (Sedimentbänder) – nur in der Nähe: weiter weg würden daraus
            // Höhenlinien über den ganzen Berg (gerade Streifen); an steilen Flächen kräftig, sonst schwach
            #if TLV < 2 && defined(TDETAIL)
            {
              float lay = sin(vTW.y * 0.72 + (nz2.r - 0.5) * 3.2 + (big - 0.5) * 2.5 + vTW.x * 0.004);
              float band = smoothstep(-0.25, 0.55, lay);
              float strata = 1.0 - smoothstep(200.0 * uCanD.w, 480.0 * uCanD.w, camD);
              rc *= mix(1.0, mix(0.84, 1.1, band) * (1.0 - 0.25 * wallW) + 0.25 * wallW * mix(0.72, 1.16, band), strata);
            }
            #endif
            // Schutthalde am Fuß: wo Fels in Wiese übergeht, graubraunes Geröll statt eines harten Saums
            {
              vec3 scree = mix(vRk, vec3(0.31, 0.28, 0.24) * (0.75 + 0.5 * nz2.r), 0.55);
              float sc = smoothstep(0.22, 0.4, vMat.y + (big - 0.5) * 0.4 + (nz2.g - 0.5) * 0.2) * (1.0 - rk) * (1.0 - fo);
              tCol = mix(tCol, scree, sc * 0.65);
            }
            // Waldsaum: vor dem Waldrand ist die Wiese dunkler (Schatten, höheres Gras) – der Wald steht fest im Boden
            tCol *= 1.0 - smoothstep(0.0, 0.25, vMat.x) * (1.0 - fo) * 0.28;
            tCol = mix(tCol, fc, fo);
            tCol = mix(tCol, rc, rk);
            // Schnee: bleibt in den Rinnen länger liegen
            // (Winter: Schnee bis ins Tal je nach Gegend, uSeasonG.y – season.ts)
            float sn = smoothstep(0.42, 0.6, vMat.z + uSeasonG.y * 0.75 + (vNz.y - 0.5) * 0.55 + (nz2.g - 0.5) * 0.25 + rk * (0.5 - gul) * 0.5) * smoothstep(0.38, 0.7, fnT.y + (nz2.r - 0.5) * 0.3 + (0.5 - gul) * 0.25);
            tCol = mix(tCol, uSnow * (0.9 + 0.12 * nz2.g), sn);
            #if TLV < 2 && defined(TDETAIL)
              // Buckel in Wiese und Wald (3 m auf 33 m)
              tGrad.xz += (nz2.ba - 0.5) * 64.0 * 3.0 / 33.0 * ((1.0 - rk) * far);
            #endif
            // Schnee glättet das Relief
            tGrad *= 1.0 - 0.7 * sn;
            diffuseColor.rgb *= tCol;
            #ifdef TDETAIL
              ${CLOUD('vTW.xz')}
            #endif
            #if TLV > 0
              diffuseColor.rgb *= ${detailMean.toFixed(4)};
            #endif
          #endif`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          #ifdef TDETAIL
          {
            // Relief: Normale gegen die Steigung kippen (nur den Anteil entlang der Fläche)
            vec3 gV = (viewMatrix * vec4(tGrad, 0.0)).xyz;
            normal = normalize(normal - (gV - dot(gV, normal) * normal));
          }
          #endif`);
    };
    // Landschaftsmaterialien: gröbere Stufen sinken dort ab, wo die feinere liegt
    const lower = <M extends THREE.Material>(m: M, lv: number, drop: number, key: string, rock: boolean): M => {
      const f = Math.max(0, lv - 1);
      const u = { uBox: { value: this.lvBox[f] }, uBoxA: { value: this.lvBoxA[f] }, uDrop: { value: drop }, uHole: this.holeU };
      m.onBeforeCompile = (sh) => {
        // Felstextur nur auf der feinsten Stufe (weiter weg ist sie ohnehin ausgeblendet)
        if (rock) { if (lv === 0) rockify(sh); splat(sh, lv); }
        if (lv === 0) return;
        Object.assign(sh.uniforms, u);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform vec4 uBox;\nuniform vec4 uBoxA;\nuniform float uDrop;\nvarying float vLow;')
          // abgesenkt, wo die feinere Stufe liegt (nach einem Ringwechsel: im neuen und im alten Gebiet, bis die
          // herausfallenden Kacheln weg sind – sie haben dann schon genau die Form dieser Stufe)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            vLow = 0.0;
            if ((position.x > uBox.x + 0.5 && position.x < uBox.z - 0.5 && position.z > uBox.y + 0.5 && position.z < uBox.w - 0.5)
              || (position.x > uBoxA.x + 0.5 && position.x < uBoxA.z - 0.5 && position.z > uBoxA.y + 0.5 && position.z < uBoxA.w - 0.5)) { transformed.y -= uDrop; vLow = 1.0; }`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uHole;\nvarying float vLow;')
          // Prüfmodus: abgesenkte gröbere Stufe sichtbar = Loch in der feineren (magenta)
          .replace('#include <dithering_fragment>', '#include <dithering_fragment>\nif (uHole > 0.5 && vLow > 0.5) gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);');
      };
      m.customProgramCacheKey = () => `${key}${lv}${rock ? dk() + (lv === 0 ? '|L' : '') : ''}`;
      return m;
    };
    this.terrMats = LEVELS.map((_, lv) => lower(L({ vertexColors: true, map: lv === 0 ? detail : null }), lv, lv === 1 ? 110 : 380, 'terr', true));
    this.waterMats = LEVELS.map((_, lv) => lower(new THREE.MeshPhongMaterial({ color: 0x2f7fb5, shininess: lv ? 90 : 150, specular: 0xc6dae8, transparent: true, opacity: 0.9 }), lv, lv === 1 ? 110 : 380, 'lake', false));
    // Wasser (Seen, Flüsse, Küsten): Wellen aus einer Normalentextur, gespiegelter Himmel, Sonnenglitzern (water3d.ts)
    const wn = new THREE.CanvasTexture(waterNormalCanvas());
    wn.colorSpace = THREE.NoColorSpace;
    wn.wrapS = wn.wrapT = THREE.RepeatWrapping;
    wn.anisotropy = Math.min(this.pc ? 8 : 4, this.gl.capabilities.getMaxAnisotropy());
    const wU: WaterUniforms = {
      uTime: this.time, uWaveK: { value: 0.2 }, uRefl: { value: 0.68 }, uWaterN: { value: wn },
      uSkyTop: this.skyMat.uniforms.top, uSkyHz: this.skyMat.uniforms.horizon, uSunDir: ATMO.fogSunDir, uSunC: { value: new THREE.Color() }, uLand: { value: new THREE.Color() },
    };
    this.waterU = wU;
    // das Glanzlicht macht der Wasser-Shader selbst (Glitzern auf den Wellen statt eines breiten Glanzes)
    this.mats.water.flatShading = false;
    for (const m of [this.mats.water, ...this.waterMats]) m.specular.set(0x000000);
    waterify(this.mats.water, wU, 'river');
    this.waterMats.forEach((m, lv) => waterify(m, wU, `lake${lv}`));
    // Banden und Schilder: vorn bedruckt, hinten schlichte Farbe (Eckpunktfarbe)
    // Fassaden: Wandfarbe je Haus aus der Palette (Index im ganzzahligen Anteil von u, Maske im Alpha des Atlas)
    const wallPal = { value: WALL_PAL.map((h) => new THREE.Color(h)) };
    this.mats.facade.onBeforeCompile = (sh) => {
      sh.uniforms.uWallPal = wallPal;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform vec3 uWallPal[${WALL_PAL.length}];`)
        .replace('#include <map_fragment>', `
          #ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D(map, vMapUv);
            int wi = clamp(int(floor(vMapUv.x)), 0, ${WALL_PAL.length - 1});
            diffuseColor.rgb *= sampledDiffuseColor.rgb + sampledDiffuseColor.a * uWallPal[wi];
          #endif`);
    };
    this.mats.facade.customProgramCacheKey = () => 'facade-tint';
    this.mats.ads.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>',
        '#ifdef USE_COLOR\nif (!gl_FrontFacing) diffuseColor.rgb = vColor.rgb;\n#endif');
    };
    this.mats.ads.customProgramCacheKey = () => 'ads-1';
    // Bäume wiegen sich leise im Wind (nur Instanzen; je höher, desto mehr – Felsen und Zäune bleiben ruhig)
    const windT = this.time;
    this.mats.props.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = windT;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
          {
            vec3 ip = instanceMatrix[3].xyz;
            float sw = max(0.0, position.y - 2.0);
            float ph = uTime * 1.1 + ip.x * 0.11 + ip.z * 0.07;
            float g = sin(ph) * 0.6 + sin(ph * 2.3 + 1.7) * 0.4;
            transformed.x += g * sw * sw * 0.0016;
            transformed.z += cos(ph * 0.8) * sw * sw * 0.0011;
          }
          #endif`);
    };
    this.mats.props.customProgramCacheKey = () => 'props-wind';
    // Billboards: Bild-Atlas mit Animationsrahmen
    this.buildAtlas();
    const timeRef = this.time;
    this.mats.billboard.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = timeRef;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aAnim;\nuniform float uTime;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.x += aAnim.x * step(0.5, fract(uTime * aAnim.z + aAnim.y));\n#endif');
    };
  }

  private buildAtlas() {
    const items: { key: string; frames: HTMLCanvasElement[]; w: number; h: number }[] = [];
    for (const [kind, def] of Object.entries(BILLBOARD)) {
      for (let v = 0; v < def.variants; v++) {
        const frames: HTMLCanvasElement[] = [];
        let w = 1;
        let h = 1;
        for (let f = 0; f < def.frames; f++) {
          const s = this.bank.get(kind as never, v, f);
          if (!s) continue;
          frames.push(s.img);
          w = s.w;
          h = s.h;
        }
        if (frames.length) items.push({ key: `${kind}:${v}`, frames, w, h });
      }
    }
    items.sort((a, b) => b.frames[0].height - a.frames[0].height);
    const AW = 2048;
    let x = 0;
    let y = 0;
    let shelf = 0;
    const placed: { it: typeof items[number]; x: number; y: number }[] = [];
    for (const it of items) {
      const cw = it.frames[0].width * it.frames.length + 4 * it.frames.length;
      const chh = it.frames[0].height + 4;
      if (x + cw > AW) { x = 0; y += shelf; shelf = 0; }
      placed.push({ it, x, y });
      x += cw;
      shelf = Math.max(shelf, chh);
    }
    const AH = Math.pow(2, Math.ceil(Math.log2(y + shelf)));
    const cv = document.createElement('canvas');
    cv.width = AW;
    cv.height = AH;
    const c = cv.getContext('2d')!;
    for (const { it, x: px, y: py } of placed) {
      const fw = it.frames[0].width;
      const fh = it.frames[0].height;
      it.frames.forEach((f, i) => c.drawImage(f, px + 2 + i * (fw + 4), py + 2));
      this.atlas.set(it.key, {
        u0: (px + 2) / AW, u1: (px + 2 + fw) / AW,
        v0: 1 - (py + 2 + fh) / AH, v1: 1 - (py + 2) / AH,
        w: it.w, h: it.h, du: it.frames.length > 1 ? (fw + 4) / AW : 0,
      });
    }
    // Farbe in die durchsichtigen Ränder ausdehnen (sonst mischt die Filterung dort Zufallsfarben hinein)
    const t = alphaTex(cv, 'bleed');
    t.anisotropy = Math.min(this.pc ? 16 : 4, this.gl.capabilities.getMaxAnisotropy());
    this.mats.billboard.map = t;
  }

  setTheme(accent: string, dark: boolean) {
    const a = accent || '#ff5fa2';
    // andere Farbe als beim Vorwärmen (das Intro färbt die Seite kurz in der Farbe des gezeigten Rennens): Rampe,
    // Torbögen und Schilder beim nächsten Bild in der richtigen Farbe neu bauen
    if (a !== this.accent && this.track) this.recolor = true;
    this.accent = a;
    this.dark = dark;
  }

  /**
   * Kommt das Bild an? Direkt nach dem Zeichnen einen Bildpunkt aus der Mitte lesen (selten – das wartet auf die
   * Grafik). Lauter Nullen, auch im Alphakanal (die Leinwand ist deckend), heißt: der Kontext zeichnet ins Leere.
   */
  blank(): boolean {
    if (this.lost) return true;
    // nur direkt nach einem gezeichneten Bild aussagekräftig (danach ist der Bildpuffer schon wieder leer)
    if (!this.justDrew) return false;
    this.justDrew = false;
    try {
      const c = this.gl.getContext();
      this.gl.setRenderTarget(null);
      const px = this.px1;
      px.fill(0);
      c.readPixels(c.drawingBufferWidth >> 1, c.drawingBufferHeight >> 1, 1, 1, c.RGBA, c.UNSIGNED_BYTE, px);
      return px[0] === 0 && px[1] === 0 && px[2] === 0 && px[3] === 0;
    } catch {
      return false;
    }
  }

  warm() { /* Grafiken entstehen im Konstruktor */ }

  /**
   * Größe der Leinwand sofort anpassen. Achtung: Das leert die Leinwand – ohne Zeichnen direkt danach sähe man ein
   * schwarzes Bild. Während der Fahrt darum setQuality/requestResize (wirkt direkt vor dem nächsten Zeichnen).
   */
  resize() {
    this.pendingResize = false;
    // Größe im Layout, nicht der Kasten auf dem Bildschirm: wird die Bühne per CSS skaliert (früher hinter offenen
    // Menüs um 4 %), bekäme die Leinwand sonst diese Größe und rechnete das ganze Rennen Bildpunkte zu viel
    const cvEl = this.gl.domElement;
    const rect = cvEl.clientWidth > 0 ? { width: cvEl.clientWidth, height: cvEl.clientHeight } : cvEl.getBoundingClientRect();
    const W = Math.max(100, Math.round(rect.width));
    const H = Math.max(100, Math.round(rect.height));
    // Pixeldichte, wie im Schieberegler gewählt (gfxOpts; fest, keine automatische Regelung) – quality ist nur ein
    // Faktor für die Kostenanalyse
    const dpr = gfxRes() * this.quality;
    const cv = this.gl.domElement;
    // unverändert: nichts anfassen (jedes Setzen der Größe leert die Leinwand)
    if (W !== this.W || H !== this.H || dpr !== this.gl.getPixelRatio() || cv.width !== Math.floor(W * dpr) || cv.height !== Math.floor(H * dpr)) {
      this.W = W;
      this.H = H;
      this.gl.setPixelRatio(dpr);
      this.gl.setSize(W, H, false);
    }
    const odpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.overlayDirty = true;
    const ow = Math.round(W * odpr);
    const oh = Math.round(H * odpr);
    if (this.overlayCv.width !== ow || this.overlayCv.height !== oh) {
      this.overlayCv.width = ow;
      this.overlayCv.height = oh;
      this.overlay.setTransform(odpr, 0, 0, odpr, 0, 0);
    }
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
    // (Schatten bleiben aus – nie zur Laufzeit umschalten, das kompiliert alle Shader neu)
  }

  /** Größe/Auflösung erst unmittelbar vor dem nächsten Zeichnen anpassen (kein leeres, schwarzes Bild dazwischen) */
  private pendingResize = false;
  /**
   * Auftakt der Abfahrt: von kurz vor dem Tunnelausgang bis hinter die Spitzkehre (erster Panoramablick) wird nichts
   * gebaut und nichts hochgeladen – alles dafür entsteht vorher auf der Landstraße und im Tunnel (kein Ruckler)
   */
  private calm = false;
  private calmZ: [number, number] | null = null;
  /** Berge am Horizont: im Startort und auf der Landstraße schon die der Kehre (kein Tausch vor dem Panorama) */
  private peakRole: BiomeId | null = null;
  requestResize() { this.pendingResize = true; }
  /** neue Auflösungsstufe (wirkt mit dem nächsten Bild) */
  setQuality(q: number) {
    if (q === this.quality) return;
    this.quality = q;
    this.pendingResize = true;
  }

  // ------------------------------------------------------------------ Bild

  private lastDt = 0.016;
  /** echter Abstand zum vorigen Bild (s): zeigt ausgefallene Bilder (die Spielzeit gleicht sie geglättet aus) */
  private lastRaw = 0.016;

  /** Startkarte oder Countdown: Zeit, die Landschaft vollständig aufzubauen (niemand fährt) */
  private idleBuild = false;
  /**
   * Leerlauf-Arbeit auf der Startkarte (idleBuild): 1 = unsichtbar vorwärmen (große Budgets, egal ob das Bild
   * ruckelt), kleiner, sobald jemand zusieht – das Startblatt und die Kamera sollen sich flüssig bewegen. Solange
   * die Oberfläche sich bewegt (uiBusy.ts: Blatt, Flug, Countdown), tritt die Arbeit fast ganz zurück.
   */
  idleK = 1;
  private uiMoves = false;
  private idleMs(ms: number): number { return ms * this.idleK * (this.uiMoves ? 0.2 : 1); }

  /**
   * Startanimation der Spiele (app/gameIntro.ts): steht die Welt rund um den Start vollständig? Alle Abschnitte in
   * Sichtweite gebaut, alle Ringe der Landschaft da, alles hochgeladen, Probezug und Fahrerbilder fertig. Dann muss
   * beim Kameraschwenk und beim Losfahren nichts mehr entstehen. (Die Strecke in der Ferne baut danach hinter dem
   * Startblatt weiter vor, wie bisher – darauf zu warten hieße oft mehrere Sekunden Animation.)
   */
  settled(g: RaceView): boolean {
    if (this.track !== g.track || this.lost) return false;
    const z = g.p.z;
    const from = Math.max(0, Math.floor((z - BEHIND) / SEG / CH));
    const to = Math.floor((z + AHEAD) / SEG / CH);
    for (let k = from; k <= to; k++) if (!this.chunks.has(k)) return false;
    if (!this.boxSet.every(Boolean)) return false;
    return !this.upQ.length && !this.warmQueue.length && !this.needWarm && this.rs.ready;
  }

  /**
   * Das nächste Bild aus der Fahrkamera zeichnen, wie nach dem Kameraschwenk (Startanimation: ein Probeblick,
   * solange sie die Welt verdeckt – was dort ins Bild kommt, ist danach schon auf der Grafikkarte). Das Bild danach
   * steht wieder wie vorher.
   */
  peekNext() { this.peek = true; }
  private peek = false;
  private peekSave: { cam: Renderer3D['cam']; chaseLift: number } | null = null;
  /** Rechenzeit für Landschaft und Abschnitte im letzten Bild (ms) */
  private work = 0;
  /**
   * Rechenzeit des Bildes ohne Nachladen (geglättet, ms) und ob zuletzt Bilder ausgefallen sind: das Nachladen
   * bekommt nur, was im Bild übrig bleibt – auf langsamen Geräten und in vollen Szenen weniger je Bild (dafür über
   * mehr Bilder verteilt), statt das Bild zu verlängern.
   */
  private baseMs = 5;
  /** Bildschirmtakt (ms): 16,7 bei 60 Hz, 8,3 bei 120 Hz – die Bauzeit je Bild richtet sich danach */
  period = 1000 / 60;
  private room(): number {
    // Ziel ~70 % des Bildschirmtakts Rechenzeit fürs Bild (11,5 ms bei 60 Hz): Platz für Spiellogik, Anzeige,
    // Speicherbereinigung und Hochladen
    let r = this.period * 0.69 - this.baseMs;
    if (this.lastRaw * 1000 > this.period * 1.26) r *= 0.5;
    return r;
  }
  /** Entsteht gerade Landschaft? (dann zählt das Bild nicht für die Qualitätsregelung) */
  get busy(): boolean { return this.work > 3 || !!this.pending || !this.boxSet.every(Boolean); }

  /** dt: Spielzeit dieses Bildes (s); raw: echter Abstand zum vorigen Bild (s), für das Budget beim Nachladen */
  draw(g: RaceView, dt: number, raw = dt) {
    // Kostenanalyse: sie zeichnet selbst (Spiel steht)
    if (this.analysing) return;
    const P = this.prof;
    // Messfahrt: Hochladen und erste Zeichenzustände mitschreiben (nur solange gemessen wird)
    if (P && !this.instr) this.instr = this.instrument(P);
    else if (!P && this.instr) { this.instr(); this.instr = null; }
    this.applyRange();
    const d0 = performance.now();
    // Größenwechsel genau hier: die Leinwand wird gleich danach neu bemalt
    if (this.pendingResize) this.resize();
    this.lastDt = dt;
    this.lastRaw = raw;
    this.idleBuild = g.phase === 'ready' || g.phase === 'countdown';
    this.uiMoves = this.idleK < 1 && uiBusy();
    // scharfes Startbild: am Start und auf den ersten Metern (umgeschaltet wird erst in Fahrt, ein Bild Größenwechsel)
    this.calm = false;
    if (g.track.kind === 'descent') {
      if (!this.calmZ) {
        // Lage der Spitzkehre nach dem Tunnel (der Abschnitt mit der Rolle reveal entsteht spätestens hier)
        g.track.seg(Math.ceil(1200 / SEG));
        const rv = g.track.sections.find((x) => x.role === 'reveal');
        this.calmZ = rv ? [rv.start * SEG - 30, rv.start * SEG + 150] : [Infinity, -Infinity];
        this.peakRole = rv?.biome ?? null;
      }
      this.calm = g.phase === 'playing' && g.p.z > this.calmZ[0] && g.p.z < this.calmZ[1];
    }
    this.time.value += dt;
    if (this.track !== g.track) {
      // diese Welt baut die Fahrbahn mit Relief – alles auf der Straße folgt ihm (Track.lift)
      g.track.relief = true;
      // gleiche Tagesstrecke (neuer Lauf, nachgeladene Namen): Landschaft behalten – sie ist identisch,
      // ein Neuaufbau würde ruckeln. Nur Namen auf Schildern und Straße ändern sich.
      const old = this.track;
      if (old && old.dayKey === g.track.dayKey && old.kind === g.track.kind && old.ramp === g.track.ramp && old.venue?.key === g.track.venue?.key && old.region === g.track.region && old.lang === g.track.lang) {
        this.track = g.track;
        this.terrain?.setTrack(g.track);
        this.cam.init = false; this.runners = []; this.runNext = 0;
        this.camReg = null;
        this.villages?.patch(g.track);
        // neue Fahrt: vom Kran am Start aus weiterfliegen, sonst neu ansetzen (nach einem Sturz nicht quer übers Land)
        this.resetDirector(this.lastPhase === 'ready');
        // neues Rennen: neue Sprüche auf Schildern und Spruchbändern (nur die Bilder im Atlas – kein Neuaufbau)
        this.newSigns(g.track.names);
        if (old.names.join('|') !== g.track.names.join('|')) this.clearChunks();
      } else this.reset(g.track);
    }
    if (this.recolor && this.track) {
      this.recolor = false;
      this.buildStarts(this.track);
      this.clearChunks();
    }
    // Startrampe gehört dazu: fehlt sie (aus welchem Grund auch immer), vor dem Start neu bauen
    if (this.track && this.terrain && !this.ttStart && (this.track.kind === 'tt' || this.track.ramp) && (g.phase === 'ready' || g.phase === 'countdown')) this.buildStarts(this.track);
    if (this.needWarm) { this.needWarm = false; this.rewarm(); }
    // Änderungen aus dem Welt-Editor (Tagesstrecke und „überall“): sobald geladen, alles neu bauen
    if (worldStore.sync(g.track)) this.rebuildAll();
    const fk = g.friends.map((f) => `${f.userId}:${f.meters}`).join('|');
    if (fk !== this.friendsKey) {
      // nur die Abschnitte neu bauen, in denen sich ein Bestmarken-Bogen ändert
      const was = new Set(this.friendsKey ? this.friendsKey.split('|') : []);
      const now = new Set(fk ? fk.split('|') : []);
      for (const e of [...was, ...now]) {
        if (was.has(e) && now.has(e)) continue;
        const m = Number(e.split(':').pop());
        const k = Math.floor(m / SEG / CH);
        const c = this.chunks.get(k);
        // neu bauen; der alte bleibt stehen, bis der neue eingeblendet ist
        if (c) {
          this.chunks.delete(k);
          const prev = this.chunkOld.get(k);
          if (prev) this.dropChunk(prev);
          this.chunkOld.set(k, c);
        }
      }
      this.friendsKey = fk;
    }
    const p = g.p;
    const track = g.track;
    const seg = track.segAt(p.z);
    const biome = track.sections[seg.sec].biome;

    this.updateLight(g, biome, seg, dt);
    if (!this.warmGroup) this.warmAll();
    this.warmStep(g.phase);
    if (!this.rs.ready && this.rs.bakeStep(this.gl, performance.now() + (this.idleBuild ? Math.max(1.5, this.idleMs(8)) : 1.5))) {
      // Material jetzt übersetzen (nicht erst, wenn der erste Fahrer in die Ferne rückt)
      this.rs.mesh.visible = true;
      this.gl.compile(this.scene, this.camera);
      this.rs.mesh.visible = false;
    }
    P?.mark(SEC.licht);
    // Landschaftsproben zuerst: die Abschnitte fragen beim Bau nach Geländehöhen
    if (this.terrain?.window(Math.max(0, p.z - 900), Math.max(p.z + 4600, this.routeEnd))) {
      // neue oder weggefallene Straßenstücke ändern die Höhen ringsum: betroffene Kacheln neu bauen
      for (const [x0, z0, x1, z1] of this.terrain.takeDirty()) {
        for (const t of this.tiles.values()) {
          const b = t.box;
          if (b[0] < x1 && b[2] > x0 && b[1] < z1 && b[3] > z0) t.stale = true;
        }
      }
    }
    // Dörfer weit voraus festlegen (Dorfebene und Dorfstraße, bevor dort Landschaft und Straße entstehen)
    this.villages?.ahead(p.z + 6500);
    if (this.idleBuild && !this.uiMoves && !this.houses.ready) this.houses.buildStep();
    P?.mark(SEC.welt);
    const w0 = performance.now();
    this.updateChunks(g, dt);
    P?.mark(SEC.abschnitte);
    this.updateCamera(g, dt);
    this.houses.prune(p.z - 450);
    this.houses.update(this.camera.position);
    if (this.debugCam) {
      const d = this.debugCam;
      this.camera.position.set(d[0], d[1], d[2]);
      this.camera.lookAt(d[3], d[4], d[5]);
    }
    P?.mark(SEC.kamera);
    this.pickLamps(p.z);
    // Sonnenuntergangs-Licht (Abfahrt am Abend; nicht unter dem Wetter – das hat seine eigene Nachbearbeitung)
    this.sunset.update(this.camera, ATMO.fogSunDir.value, track.kind === 'descent' && this.debugTod === null, this.tunnelDim, dt);
    // im Auftakt (Startort, Landstraße) schon die Berge der Kehre: kein Tausch kurz vor dem ersten Panorama
    const role = track.sections[seg.sec]?.role;
    this.updateEnvironment(this.peakRole && (role === 'top' || role === 'road') ? this.peakRole : biome, dt);
    P?.mark(SEC.umgebung);
    this.updateTerrain(g, dt);
    this.work = performance.now() - w0;
    P?.mark(SEC.landschaft);
    this.updateRiders(g);
    this.ttStart?.update(g, dt);
    this.updateDescStart(g, dt);
    this.updateGrass(g);
    this.updateCar(g, dt);
    P?.mark(SEC.fahrer);
    this.updateSky(g, biome, dt);
    {
      // Laub, Schnee, Blüten in der Luft: im Licht der Szene, auf einfacher Grafik weniger, im Tunnel nichts
      const lc = this.airLight.copy(this.hemi.color).multiplyScalar(this.hemi.intensity * 0.32).add(this.airSun.copy(this.sun.color).multiplyScalar(this.sun.intensity * 0.14));
      lc.r = Math.min(1, lc.r); lc.g = Math.min(1, lc.g); lc.b = Math.min(1, lc.b);
      this.air.update(this.season, this.camera, this.time.value, lc, this.gl.domElement.height, (this.lite ? 0.45 : 1) * (1 - this.tunnelDim));
      const su = this.smokeMat.uniforms;
      (su.uLight.value as THREE.Color).copy(lc);
      su.uScale.value = this.gl.domElement.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
      su.uOn.value = this.season.lamps > 0 ? Math.min(1, 0.4 + this.season.lamps) : 0;
    }
    // Wasser strömt: eine Texturlänge je Sekunde (wie schnell das aussieht, legt die Dichte der Koordinaten fest)
    if (this.fallMat?.map) this.fallMat.map.offset.y = (this.fallMat.map.offset.y - dt) % 1;
    P?.mark(SEC.himmel);
    this.updateCrowd(g, dt);
    P?.mark(SEC.zuschauer);
    this.updateObjects(g);
    this.updateParticles(g);
    P?.mark(SEC.dinge);
    // Messfahrt: etwa alle 1,5 s ein Probebild – vorher auf die Grafik warten (Rückstau), danach auf ihr Ende
    // (Grafikzeit dieses Bildes; WebGL auf dem iPhone kennt keine Zeitstempel)
    // (dazu ein Probebild auf Wunsch der Automatik für Auflösung und Sichtweite, autoGfx.ts: probeNext → gpuProbe)
    const pWant = P?.wantProbe() ?? false;
    const own = this.probeNext;
    this.probeNext = false;
    const probe = pWant || own;
    let tA = 0, tB = 0;
    if (probe) { tA = performance.now(); this.syncGl(); tB = performance.now(); }
    if (this.post) this.post(() => { this.gl.render(this.scene, this.camera); this.takeCounts(); }, g);
    else { this.gl.render(this.scene, this.camera); this.takeCounts(); }
    this.runHeater(probe);
    this.justDrew = true;
    this.instrTick?.();
    if (probe) {
      const tS = performance.now();
      this.syncGl();
      const gpu = performance.now() - tB;
      if (pWant && P) P.setProbe({ drain: tB - tA, submit: tS - tB, gpu });
      if (own) this.gpuProbe = gpu;
    }
    this.drawOverlay(g);
    P?.mark(SEC.zeichnen);
    // neue Teile vorab hochladen (eine Portion je Bild), bevor sie sichtbar werden
    const u0 = performance.now();
    if (!this.calm) this.updateStaging();
    this.updateDispose();
    this.work += performance.now() - u0;
    const rest = performance.now() - d0 - this.work;
    this.baseMs += (Math.min(30, rest) - this.baseMs) * 0.08;
    // neue Shader (auf dem iPhone oft Hunderte Millisekunden)
    const np = this.gl.info.programs?.length ?? 0;
    if (P && np > this.progCount && this.progCount > 0) P.event(EV.shader, `${np - this.progCount} neue Shader (jetzt ${np})`);
    this.progCount = np;
    P?.mark(SEC.hochladen);
  }

  // ------------------------------------------------------------------ Messen (perf3d.ts)

  /** Messfahrt: Bausteine je Bild und Ereignisse (null: keine Messung) */
  prof: Perf3D | null = null;
  /** Messfahrt: Mitschnitt an der Grafikschnittstelle läuft (Aufruf nimmt ihn zurück) */
  private instr: (() => void) | null = null;
  /** schon gezeichnete Zustände (Programm × Geometrie-Aufbau × Mischung/Tiefe × Ziel) – bleiben über Messungen */
  private pipeSeen = new Set<string>();

  /**
   * Messfahrt: an der WebGL-Schnittstelle mitzählen, was auf die Grafikkarte geht (Puffer, Texturen), und jedes
   * erste Zeichnen eines neuen Zustands melden. Für so einen baut der Grafiktreiber (auf dem iPhone Metal) beim
   * ersten Zeichnen eine Pipeline – Arbeit, die weder in der Rechenzeit noch in der Grafikzeit des Spiels auftaucht.
   * Die ersten Bilder lernen still (was schon vor der Messung gezeichnet wurde, ist nicht neu).
   */
  private instrument(P: Perf3D): () => void {
    const ctx = this.gl.getContext() as WebGL2RenderingContext & Record<string, unknown>;
    const undo: (() => void)[] = [];
    // (Texturen ab 64 kB auch als Ereignis mit Größe – kleine Teil-Updates kommen jedes Bild)
    const wrap = (name: string, size: (a: unknown[]) => number, label?: string) => {
      const own = Object.prototype.hasOwnProperty.call(ctx, name);
      const f = ctx[name] as ((...a: unknown[]) => unknown) | undefined;
      if (typeof f !== 'function') return;
      ctx[name] = function (this: unknown, ...a: unknown[]) {
        let b = 0;
        try { b = size(a); } catch { /* egal */ }
        P.upload(b, label && b >= 65536 ? `${label} ${Math.round(b / 1024)} kB` : undefined);
        return f.apply(ctx, a);
      };
      undo.push(() => { if (own) ctx[name] = f; else delete ctx[name]; });
    };
    const bytesOf = (x: unknown) => (x && typeof x === 'object' && 'byteLength' in x ? Number((x as ArrayBufferView).byteLength) : 0);
    const srcPx = (x: unknown) => {
      const o = x as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number } | null;
      if (!o || typeof o !== 'object') return 0;
      return ((o.videoWidth || o.naturalWidth || o.width) ?? 0) * ((o.videoHeight || o.naturalHeight || o.height) ?? 0) * 4;
    };
    wrap('bufferData', (a) => (typeof a[1] === 'number' ? a[1] : bytesOf(a[1])));
    wrap('bufferSubData', (a) => bytesOf(a[2]));
    wrap('texImage2D', (a) => (a.length >= 9 ? Number(a[3]) * Number(a[4]) * 4 : srcPx(a[5])), 'Textur');
    wrap('texSubImage2D', (a) => (a.length >= 9 ? Number(a[4]) * Number(a[5]) * 4 : srcPx(a[6])), 'Textur (Teil)');
    wrap('texImage3D', (a) => Number(a[3]) * Number(a[4]) * Number(a[5]) * 4, 'Texturstapel');
    wrap('texSubImage3D', (a) => Number(a[5]) * Number(a[6]) * Number(a[7]) * 4, 'Texturstapel (Teil)');
    wrap('compressedTexImage2D', (a) => bytesOf(a[6]), 'Textur');
    // erstes Zeichnen je Zustand: je Material × Geometrie nur einmal ausrechnen (je Ziel)
    const gl = this.gl;
    const orig = gl.renderBufferDirect;
    const pairs = new WeakMap<THREE.Material, WeakMap<THREE.BufferGeometry, unknown[]>>();
    const lay = new WeakMap<THREE.BufferGeometry, string>();
    const seen = this.pipeSeen;
    // (Programme, die es beim Start der Messung schon gibt, sind nicht neu)
    const progSeen = new Set<number>((this.gl.info.programs ?? []).map((p) => p.id));
    const by = this.callsBy;
    let quiet = 2;
    gl.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
      orig.call(gl, camera, scene, geometry, material, object, group);
      try {
        const rt = gl.getRenderTarget() as unknown;
        // Aufrufe nach Art (je Bild; Schattendurchgang: Tiefenmaterial ins Zwischenbild)
        if (rt && (material as THREE.Material).type === 'MeshDepthMaterial') by.shadow += 1;
        else {
          const ob = object as THREE.Object3D & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean };
          if (ob.isSkinnedMesh) by.skinned += 1;
          if (ob.isInstancedMesh) by.inst += 1;
          const pos = geometry.attributes.position as THREE.BufferAttribute | undefined;
          if (pos && pos.count < 100) by.tiny += 1;
        }
        let byGeo = pairs.get(material);
        if (!byGeo) { byGeo = new WeakMap(); pairs.set(material, byGeo); }
        let rts = byGeo.get(geometry);
        if (!rts) { rts = []; byGeo.set(geometry, rts); }
        if (rts.includes(rt)) return;
        rts.push(rt);
        let l = lay.get(geometry);
        if (!l) {
          l = Object.keys(geometry.attributes).sort().map((n) => {
            const at = geometry.attributes[n] as THREE.BufferAttribute & { isInstancedBufferAttribute?: boolean; isInterleavedBufferAttribute?: boolean; data?: { stride: number } };
            return `${n}${at.itemSize}${at.isInstancedBufferAttribute ? 'i' : ''}${at.isInterleavedBufferAttribute ? `s${at.data?.stride}` : ''}`;
          }).join(',') + (geometry.index ? '#' : '');
          lay.set(geometry, l);
        }
        const o = object as THREE.Object3D & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean; isPoints?: boolean; isLine?: boolean };
        const prog = (gl.properties.get(material) as { currentProgram?: { id: number } }).currentProgram?.id ?? -1;
        const m = material;
        const key = `${prog}|${l}|${o.isInstancedMesh ? 'I' : ''}${o.isSkinnedMesh ? 'S' : ''}${o.isPoints ? 'P' : ''}${o.isLine ? 'L' : ''}|${m.blending}|${+m.transparent}${+m.depthWrite}${+m.depthTest}${+m.colorWrite}|${m.side}|${rt ? (rt as { texture?: { uuid: string } }).texture?.uuid ?? 'rt' : 'c'}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (quiet > 0) return;
        const name = m.name || m.type.replace('Material', '');
        // neues Programm (Shader übersetzt) oder nur neue Pipeline (Programm × Ziel × Layout)? Dazu die Züge des
        // Materials – damit das Vorwärmen (warmAll) die fehlende Kombination bekommt
        const mm = m as THREE.Material & { map?: unknown; vertexColors?: boolean; emissiveMap?: unknown; alphaMap?: unknown; flatShading?: boolean };
        const traits = [mm.map && 'map', mm.vertexColors && 'vcol', mm.emissiveMap && 'emis', mm.alphaMap && 'amap', mm.flatShading && 'flat', m.transparent && 'transp', m.alphaTest > 0 && 'atest', m.side === THREE.DoubleSide && 'dside', m.alphaToCoverage && 'a2c', o.isInstancedMesh && 'inst', o.isSkinnedMesh && 'skin', !geometry.attributes.normal && 'nonormal', geometry.attributes.color && `col${(geometry.attributes.color as THREE.BufferAttribute).itemSize}`].filter(Boolean).join(' ');
        const newProg = !progSeen.has(prog);
        progSeen.add(prog);
        P.event(EV.pipe, `${name} · ${o.name || o.type}${rt ? ' (Zwischenbild)' : ''} – ${newProg ? 'neues Programm' : 'neue Pipeline'}${traits ? ` [${traits}]` : ''}`);
      } catch { /* Messung darf nie stören */ }
    };
    undo.push(() => { gl.renderBufferDirect = orig; });
    // nach zwei ganzen Bildern zählt jeder neue Zustand; die Aufrufe nach Art je Bild abholen
    this.instrTick = () => {
      if (quiet > 0) quiet--;
      this.lastCallsBy = { ...by };
      by.shadow = 0; by.skinned = 0; by.inst = 0; by.tiny = 0;
    };
    undo.push(() => { this.instrTick = null; });
    return () => { for (const u of undo.reverse()) u(); };
  }
  private instrTick: (() => void) | null = null;
  /** Zeichenaufrufe nach Art (Messfahrt): im laufenden Bild gezählt, nach dem Bild in lastCallsBy */
  private callsBy: CallsBy = { shadow: 0, skinned: 0, inst: 0, tiny: 0 };
  lastCallsBy: CallsBy = { shadow: 0, skinned: 0, inst: 0, tiny: 0 };
  /** Hauptdurchgang des letzten Bilds: Zeichenaufrufe, Dreiecke */
  lastCalls = 0;
  lastTris = 0;
  private progCount = 0;
  /** Kostenanalyse läuft: das Spiel zeichnet nicht */
  analysing = false;
  private px1 = new Uint8Array(4);
  private takeCounts() { const i = this.gl.info.render; this.lastCalls = i.calls; this.lastTris = i.triangles; }
  /** auf die Grafik warten (ein Bildpunkt lesen erzwingt, dass alles Gezeichnete fertig ist) */
  /**
   * Wechseltest „Füllarbeit“ (Messfahrt): so viele ms Grafik je Bild zusätzlich verbrennen (0 = aus). Prüft, ob das
   * iPhone bei kleiner Last seine Grafik heruntertaktet und dann gerade die leichten Bilder verpasst: dieselbe Szene,
   * dieselben Aufrufe, nur mehr Grafikzeit – ein Quadrat mit vielen Rechenschritten je Bildpunkt in ein kleines
   * Ziel. Die Kosten misst er nur in Probebildern nach (die zählen ohnehin nicht als Ruckler) und stellt die
   * Schleifenzahl danach ein
   */
  heaterMs = 0;
  private heater: { rt: THREE.WebGLRenderTarget; scene: THREE.Scene; cam: THREE.OrthographicCamera; mat: THREE.ShaderMaterial; iters: number; frames: number; calibAt: number } | null = null;
  private runHeater(probe: boolean) {
    if (this.heaterMs <= 0) {
      if (this.heater) { this.heater.rt.dispose(); this.heater.mat.dispose(); this.heater = null; }
      return;
    }
    let h = this.heater;
    if (!h) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uN: { value: 64 } },
        vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `uniform int uN; void main() {
          vec2 p = gl_FragCoord.xy * 0.01;
          float v = 0.0;
          for (int i = 0; i < ${HEAT_MAX}; i++) { if (i >= uN) break; v = sin(v * 1.17 + p.x + float(i) * 0.37) * cos(v - p.y * 0.73) + 0.001 * float(i); }
          gl_FragColor = vec4(fract(v), fract(v * 3.1), fract(v * 7.3), 1.0);
        }`,
        depthTest: false, depthWrite: false,
      });
      const scene = new THREE.Scene();
      const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
      q.frustumCulled = false;
      scene.add(q);
      h = this.heater = { rt: new THREE.WebGLRenderTarget(512, 512, { depthBuffer: false, stencilBuffer: false, generateMipmaps: false }), scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mat, iters: 64, frames: 0, calibAt: -1 };
    }
    const gl = this.gl;
    const prev = gl.getRenderTarget();
    // nachmessen (nur in Probebildern, dort wartet die Bühne ohnehin auf die Grafik): zuerst, dann alle 180 Bilder
    const calib = probe && (h.calibAt < 0 || h.frames - h.calibAt >= 180);
    if (calib) this.syncGl();
    const t0 = performance.now();
    gl.setRenderTarget(h.rt);
    gl.render(h.scene, h.cam);
    gl.setRenderTarget(prev);
    if (calib) {
      this.syncGl();
      const cost = Math.max(0.05, performance.now() - t0);
      h.iters = Math.max(1, Math.min(HEAT_MAX, Math.round(h.iters * this.heaterMs / cost)));
      h.mat.uniforms.uN.value = h.iters;
      h.calibAt = h.frames;
      this.prof?.event(EV.probe, `Füllarbeit: ${cost.toFixed(1)} ms – jetzt ${h.iters} Schleifen für ${this.heaterMs} ms`);
    }
    h.frames += 1;
  }

  /** nächstes Bild als Probebild: auf die Grafik warten und ihre Zeit messen (Ergebnis in gpuProbe, ms) */
  probeNext = false;
  gpuProbe: number | null = null;
  private syncGl() {
    const c = this.gl.getContext();
    c.readPixels(0, 0, 1, 1, c.RGBA, c.UNSIGNED_BYTE, this.px1);
  }
  /** Fahrer als volle Modelle im Bild */
  get ridersShown(): number {
    let n = this.player?.group.visible ? 1 : 0;
    for (const m of this.riders.values()) if (m.group.visible) n++;
    return n;
  }
  /** Ort auf der Strecke: 0 freie Strecke, 1 Ortsdurchfahrt (Häuser an der Straße), 2 Dorf */
  placeAt(z: number): number {
    const t = this.track;
    if (!t) return 0;
    const s = t.segAt(z);
    if (s.bL || s.bR) return 1;
    return this.villages?.inside(z, 0) ? 2 : 0;
  }

  /**
   * Kostenanalyse an dieser Stelle (Spiel in der Pause, Kamera steht): je Variante – eine Ebene aus, andere Auflösung –
   * mehrmals zeichnen und dann auf die Grafik warten. Gemessen wird die Zeit je Bild für CPU und Grafik zusammen
   * (WebGL auf dem iPhone kennt keine Zeitstempel), dazu die CPU-Zeit fürs Abschicken. Jede Variante abwechselnd mit der
   * Basis (ein warmes Telefon taktet herunter – so laufen beide unter denselben Bedingungen). Danach ist alles wie vorher.
   */
  async costAnalysis(g: RaceView, meta: string[], progress?: (i: number, n: number, label: string) => void, quick = false): Promise<string> {
    if (this.analysing) return '';
    this.analysing = true;
    const gl = this.gl;
    const M = this.mats;
    const frame = () => new Promise<void>((res) => { requestAnimationFrame(() => res()); });
    // Ebenen nach Materialien (die Welt besteht aus wenigen, geteilten Materialien)
    const cats = new Map<string, Set<THREE.Material>>();
    const add = (k: string, ...ms: (THREE.Material | null | undefined)[]) => {
      let set = cats.get(k);
      if (!set) { set = new Set(); cats.set(k, set); }
      for (const m of ms) if (m) set.add(m);
    };
    add('Landschaft nah (Stufe 0, mit See)', this.terrMats[0], this.waterMats[0]);
    add('Landschaft fern (Stufen 1 und 2, Talboden)', this.terrMats[1], this.terrMats[2], this.waterMats[1], this.waterMats[2], this.valleyMat);
    add('Bäume (Bilder)', this.bbMat);
    add('Straße, Bankett, Mauern, Hänge am Rand', M.asphalt, M.fresh, M.cobble, M.gravel, M.verge, M.marks, M.barrier, M.masonry, M.terrain, M.portal);
    add('Ortshäuser, Dächer, Kleinteile der Dörfer', M.facade, M.roof, M.tiles);
    add('Requisiten (Laternen, Zäune, Felsen, Wahrzeichen)', M.props, this.markMat, this.fallMat, this.mistMat);
    add('Banden, Schilder, Bögen, Spruchbänder', M.ads, M.sign, M.billboard, this.fanMat, ...this.labelMat.values());
    add('Zuschauer (Bilder)', this.sprMat, this.crowdMat, this.runMat);
    add('Halos der Laternen', haloMaterial());
    add('Lichterketten und Lampions', M.bulb, M.lantern, M.glow, M.lampGlow);
    add('Tunnel', M.tunWall, M.tunRoad, M.tunMarks, M.tunSign);
    add('Himmel', this.skyMat);
    const known = new Set<THREE.Material>();
    for (const set of cats.values()) for (const m of set) known.add(m);
    // Gruppen von Objekten
    const objs = new Map<string, THREE.Object3D[]>();
    const riders: THREE.Object3D[] = [this.rs.mesh];
    if (this.player) riders.push(this.player.group);
    for (const m of this.riders.values()) riders.push(m.group);
    if (this.fadeWarm) riders.push(this.fadeWarm.group);
    for (const l of this.riderPool.values()) for (const m of l) riders.push(m.group);
    objs.set('Fahrer und Gegner (Modelle und Bilder)', riders);
    objs.set('Alpenhäuser (Dörfer, Höfe)', [this.houses.group]);
    objs.set('Berge am Horizont', [this.mtn, this.mtnOld].filter((x): x is THREE.Mesh => !!x));
    objs.set('Leben am Himmel, Partikel, Flaschen', [this.skyLife.group, this.parts, this.objRoot]);
    const inObj = new Set<THREE.Object3D>();
    for (const l of objs.values()) for (const o of l) o.traverse((x) => { inObj.add(x); });
    // was keiner Ebene gehört (zur Vollständigkeit)
    const rest = new Set<THREE.Material>();
    const signs = cats.get('Banden, Schilder, Bögen, Spruchbänder')!;
    this.scene.traverseVisible((o) => {
      if (inObj.has(o) || o === this.sunset.mesh) return;
      const ms = (o as THREE.Mesh).material;
      if (!ms) return;
      for (const m of Array.isArray(ms) ? ms : [ms]) if (!known.has(m)) (m.name === 'arch' ? signs : rest).add(m);
    });
    if (rest.size) cats.set(`Sonstiges (${[...rest].map((m) => m.name || m.type).join(', ')})`, rest);
    // Zustand merken und wiederherstellen
    const matVis = new Map<THREE.Material, boolean>();
    const objVis = new Map<THREE.Object3D, boolean>();
    const q0 = this.quality;
    const lampW = LAMP_U.uLampP.value.map((v) => v.w);
    const drama0 = this.skyMat.uniforms.uDrama.value as number;
    const sunVis0 = this.sunset.mesh.visible;
    const shadowAuto0 = gl.shadowMap.autoUpdate;
    let usePost = true;
    const hideMats = (set: Set<THREE.Material> | undefined) => { for (const m of set ?? []) { if (!matVis.has(m)) matVis.set(m, m.visible); m.visible = false; } };
    const hideObjs = (list: THREE.Object3D[] | undefined) => { for (const o of list ?? []) { if (!objVis.has(o)) objVis.set(o, o.visible); o.visible = false; } };
    const setQ = (q: number) => { if (this.quality !== q) { this.quality = q; this.resize(); } };
    const restore = () => {
      for (const [m, v] of matVis) m.visible = v;
      matVis.clear();
      for (const [o, v] of objVis) o.visible = v;
      objVis.clear();
      LAMP_U.uLampP.value.forEach((v, i) => { v.w = lampW[i]; });
      this.skyMat.uniforms.uDrama.value = drama0;
      this.sunset.mesh.visible = sunVis0;
      gl.shadowMap.autoUpdate = shadowAuto0;
      usePost = true;
      setQ(q0);
      setApDiscard(true, this.scene);
    };
    const weather = !!this.post && this.debugTod !== null;
    const steps: [string, () => void][] = [['Basis', () => undefined]];
    for (const [k, set] of cats) steps.push([`ohne ${k}`, () => hideMats(set)]);
    for (const [k, l] of objs) if (l.length) steps.push([`ohne ${k}`, () => hideObjs(l)]);
    steps.push(
      ['ohne Lichtkegel der Laternen am Boden', () => { for (const v of LAMP_U.uLampP.value) v.w = 0; }],
      ['ohne dramatischen Himmel (Wolken, Türme, Strahlen)', () => { this.skyMat.uniforms.uDrama.value = 0; }],
      ['ohne Sonnenuntergangs-Licht', () => { this.sunset.mesh.visible = false; }],
      // (ein Shader, der verwerfen kann, hindert Apple-Grafikchips daran, Verdecktes zu überspringen – appear.ts. Mit
      // Version 253 probeweise nur noch beim Ein- und Ausblenden: brachte gemessen nichts, aber neue Ruckler beim ersten
      // Einblenden – zurückgenommen)
      ['ohne Ausblend-Raster in Straße, Häusern, Dingen (Shader ohne discard)', () => { setApDiscard(false, this.scene); }],
    );
    if (gl.shadowMap.enabled) steps.push(['ohne Schattenkarte (Durchgang je Bild)', () => { gl.shadowMap.autoUpdate = false; gl.shadowMap.needsUpdate = false; }]);
    if (weather) steps.push(['ohne Wetter-Nachbearbeitung', () => { usePost = false; }]);
    steps.push(['nur Himmel', () => { for (const set of cats.values()) if (!set.has(this.skyMat)) hideMats(set); for (const l of objs.values()) hideObjs(l); this.sunset.mesh.visible = false; }]);
    // Auflösung: halb und drei Viertel der gewählten Pixeldichte, und – wo sie darunter liegt – die des Bildschirms
    const res0 = gfxRes();
    const fx = (d: number) => `${d.toFixed(2).replace(/0$/, '').replace('.', ',')}-fach`;
    const qs = [0.5, 0.75];
    const dev = window.devicePixelRatio || 1;
    if (dev > res0 + 0.2) qs.push(dev / res0);
    for (const q of qs) steps.push([`Auflösung ${fx(res0 * q)} (statt ${fx(res0)})`, () => setQ(q)]);
    // (quick: nur für Tests im Emulator – je Variante ein Bild, ohne Wiederholung)
    // Messen: K-mal zeichnen, dann auf die Grafik warten (Zeit je Bild: CPU und Grafik); vorher den Rückstau abwarten
    const K = quick ? 1 : 2;
    let calls = 0, tris = 0;
    const render = () => {
      if (usePost && this.post) this.post(() => { gl.render(this.scene, this.camera); this.takeCounts(); }, g);
      else { gl.render(this.scene, this.camera); this.takeCounts(); }
      calls = this.lastCalls; tris = this.lastTris;
    };
    const block = async (ms: number[], cpu: number[]) => {
      for (let k = 0; k < (quick ? 1 : 2); k++) { await frame(); render(); }
      for (let k = 0; k < (quick ? 1 : 5); k++) {
        await frame();
        this.syncGl();
        const t0 = performance.now();
        for (let j = 0; j < K; j++) render();
        const t1 = performance.now();
        this.syncGl();
        const t2 = performance.now();
        ms.push((t2 - t0) / K);
        cpu.push((t1 - t0) / K);
      }
    };
    const med = (a: number[]) => { if (!a.length) return -1; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
    const rows: { name: string; ms: number; base: number; cpu: number; calls: number; tris: number; size: string }[] = [];
    const size = new THREE.Vector2();
    try {
      for (let i = 0; i < steps.length; i++) {
        const [name, set] = steps[i];
        progress?.(i, steps.length, name);
        const mB: number[] = [], cB: number[] = [], mV: number[] = [], cV: number[] = [];
        let c = 0, t = 0;
        // im Wechsel A B B A: ein Telefon, das während der Messung schneller oder langsamer taktet, verzerrt so
        // den Unterschied nicht (A B A B schöbe jede Drift auf die zweite Messung)
        const runB = async () => { restore(); await block(mB, cB); };
        const runV = async () => { restore(); set(); await block(mV, cV); c = calls; t = tris; };
        for (let round = 0; round < (quick ? 1 : 2); round++) {
          if (round % 2 === 0) { await runB(); await runV(); } else { await runV(); await runB(); }
        }
        gl.getDrawingBufferSize(size);
        rows.push({ name, ms: med(mV), base: med(mB), cpu: med(cV), calls: c, tris: t, size: `${size.x}×${size.y}` });
      }
    } finally {
      restore();
      this.analysing = false;
    }
    const b = rows[0];
    const f = (x: number) => (x < 0 ? '–' : x.toFixed(2));
    // Unterschied zur Basis: − spart so viel, + kostet so viel mehr
    const d = (r: { ms: number; base: number }) => (r.ms < 0 || r.base < 0 ? '–' : `${r.base - r.ms >= 0 ? '−' : '+'}${Math.abs(r.base - r.ms).toFixed(2)}`);
    const mem = gl.info.memory;
    const lines = [
      ...meta,
      `Szene: ${b.calls} Zeichenaufrufe, ${Math.round(b.tris / 1000)}k Dreiecke, ${gl.info.programs?.length ?? 0} Programme, ${mem.geometries} Geometrien, ${mem.textures} Texturen, ${this.chunks.size} Abschnitte, ${this.tiles.size} Kacheln, Schatten ${gl.shadowMap.enabled ? 'an' : 'aus'}, Wetter ${weather ? 'an' : 'aus'}`,
      `Ebenen: ${[...cats.entries()].map(([k, set]) => `${k} = ${set.size} Material${set.size === 1 ? '' : 'ien'}`).join('; ')}`,
      'Hinweis: ein warmes Telefon taktet herunter – dann sind alle Zeiten bis gut doppelt so hoch. Nur im selben Zustand vergleichen (am besten kühl).',
      // die Basis wird in jeder Zeile neu gemessen: wie weit sie schwankt, zeigt, wie viel ein Unterschied bedeutet
      (() => {
        const bs = rows.map((r) => r.base).filter((x) => x >= 0);
        if (bs.length < 3) return '';
        const lo = Math.min(...bs), hi = Math.max(...bs);
        const shaky = hi > lo * 1.3 + 0.5;
        return `Basis je Zeile zwischen ${f(lo)} und ${f(hi)} ms${shaky ? ` – Achtung: das Telefon hat während der Messung seinen Takt geändert; Unterschiede unter ${f((hi - lo) / 2)} ms sagen nichts` : ' – gleichmäßig, die Unterschiede sind belastbar'}`;
      })(),
      `Variante | ms je Bild (CPU + Grafik, Median; ${K}× gezeichnet, dann gewartet) | zur Basis (− spart, + kostet mehr; im Wechsel gemessen) | davon CPU fürs Abschicken | Aufrufe | Dreiecke k | Zeichenfläche`,
      ...rows.map((r) => `${r.name} | ${f(r.ms)} | ${r === b ? '' : d(r)} | ${f(r.cpu)} | ${r.calls} | ${Math.round(r.tris / 1000)} | ${r.size}`),
    ];
    return lines.join('\n');
  }

  /** Himmel: Flieger; in den Finals der Hubschrauber über der Spitze des Feldes */
  private updateSky(g: RaceView, biome: BiomeId, dt: number) {
    const t = g.track;
    let leader: THREE.Vector3 | null = null;
    if (t.kind !== 'descent') {
      let z = g.p.z;
      let x = g.p.x;
      for (const o of g.opps) if (o.z > z) { z = o.z; x = o.x; }
      t.world(z, x, 0, this.w2);
      leader = this.leaderV.set(this.w2.x, this.w2.y, this.w2.z);
    }
    // (einfache Grafik: ohne Vögel und Flieger am Himmel)
    this.skyLife.group.visible = !this.lite;
    if (!this.lite) this.skyLife.update(t, g.p.z, this.time.value, dt, biome, this.night, leader, this.camera.position);
  }

  /** Jahreszeit setzen (reset; zum Ansehen auch von außen) */
  setSeason(s: SeasonLook) {
    this.season = s;
    this.seasonT.value.set(s.autumn, s.bare, s.treeSnow, s.blossom);
    this.seasonG.value.set(s.dry, s.snow, s.fresh, s.flowers);
    this.seasonH.value.set(s.litter, s.autumn, s.bare, 0);
    // Zuschauer: im Herbst teils, im Winter fast alle in Jacke und Mütze
    setCrowdChill(s.id === 'winter' ? 0.9 : s.id === 'autumn' ? 0.25 + 0.35 * s.bare : 0);
    ROOF_SNOW.value = s.id === 'winter' ? Math.min(0.92, 0.3 + s.snow * 0.65) : 0;
  }

  /**
   * Berge am Horizont in der Jahreszeit: im Winter liegt der Schnee tiefer (im Süden nur auf den Gipfeln), Wälder
   * und Matten im Herbst bräunlich-bunt, im Winter verschneit (Uniforms der fertigen Berge, einmal je Wechsel)
   */
  private seasonPeak(m: THREE.Mesh) {
    const s = this.season;
    const key = `${s.id}|${s.snow}|${s.autumn}|${s.bare}`;
    if (m.userData.seasonKey === key) return;
    const u = (m.material as THREE.ShaderMaterial).uniforms;
    if (!u?.uSnow || !u.uForest || !u.uMeadow) return;
    type Base = { snow: number; forest: THREE.Color; meadow: THREE.Color };
    const base = (m.userData.seasonBase ??= { snow: u.uSnow.value as number, forest: (u.uForest.value as THREE.Color).clone(), meadow: (u.uMeadow.value as THREE.Color).clone() }) as Base;
    const lin = (r: number, g: number, b: number) => new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
    u.uSnow.value = s.id === 'winter' ? Math.min(base.snow, 0.18 + (1 - s.snow) * 0.55) : base.snow * (1 - 0.08 * s.autumn);
    const f = (u.uForest.value as THREE.Color).copy(base.forest);
    f.lerp(lin(120, 82, 40), s.autumn * 0.3 * (1 - s.bare * 0.5)).lerp(lin(70, 64, 58), s.bare * 0.25).lerp(lin(200, 208, 218), s.snow * 0.35);
    const mm = (u.uMeadow.value as THREE.Color).copy(base.meadow);
    mm.lerp(lin(150, 132, 84), s.dry * 0.45).lerp(lin(225, 230, 238), s.snow * 0.6).lerp(lin(96, 140, 60), s.fresh * 0.15);
    m.userData.seasonKey = key;
  }

  private reset(track: Track) {
    this.track = track;
    track.relief = true;
    this.setSeason(seasonLook(track.lookDay, track.region));
    this.applyGround(track);
    // Abfahrt: ein fester Abendhimmel (dramatischer Himmel, sky.ts) statt der Stimmung des Tages
    this.mood = track.kind === 'descent' ? { ...DESCENT_SKY } : dailyMood(track.seed);
    this.skyMat.uniforms.uSeed.value = (hash(track.seed + 3) - 0.5) * 40;
    this.skyLife.reset();
    this.tunSpan.clear();
    this.clearTiles();
    this.routeEnd = 0;
    this.pre = null;
    this.terrain = new Terrain(track);
    this.calmZ = null;
    this.peakRole = null;
    // Zeitfahren: hinter dem Startpodest ein ebener Platz auf Höhe seines Fußes (sonst eine Grube unter der Straße);
    // in der Abfahrt liegt die Piazza selbst auf Höhe des Podests
    if (track.kind === 'tt') {
      const w = { x: 0, y: 0, z: 0, th: 0 };
      const yp = track.heightAt(0) - TT_PODIUM;
      const pts: number[] = [];
      for (let f = -0.5; f >= -90; f -= f > -6 ? 0.5 : 2) {
        track.world(f, 0, 0, w);
        pts.push(w.x, yp, w.z, Math.min(1, Math.max(0, (-f - 0.5) / 2.5)));
      }
      this.terrain.addFlat(pts, 34, 1, [], true);
    }
    // Abfahrt mit Startort: der Platz hinter dem Anfang der Strecke (Turm, Palazzi) und rund um die Piazza eben
    if (track.kind === 'descent' && track.startZ > 0) {
      const w = { x: 0, y: 0, z: 0, th: 0 };
      const pts: number[] = [];
      const fEnd = track.startZ + 40;
      for (let f = -110; f <= fEnd; f += 4) {
        track.world(f, 0, 0, w);
        const e = Math.min(1, (f + 110) / 30, (fEnd - f) / 30);
        pts.push(w.x, track.heightAt(Math.max(0, f)) - 0.06 + (f < 0 ? track.heightAt(f) - track.heightAt(0) : 0), w.z, e * e * (3 - 2 * e));
      }
      this.terrain.addFlat(pts, 46, 1, [], true);
    }
    // Abfahrt wie in der WebGPU-Welt: zerklüftete Berge (Grate, Rinnen, Felsbänder) und Bergwald (geschlossene
    // Bestände mit klarem Waldrand statt verstreuter Einzelbäume)
    // (Bergfinale: dieselben Dolomiten – zerklüftete Berge und Bergwald auch dort)
    if (track.kind === 'descent' || track.kind === 'mountain') { this.terrain.rugged = true; this.terrain.woods = true; }
    this.woodsU.value = this.terrain.woods ? 1 : 0;
    // Dörfer und Höfe wie in der WebGPU-Abfahrt (Lage und Dorfebene stehen fest, bevor dort Landschaft entsteht)
    this.houses.spots = [];
    this.houses.touch();
    this.treeBlocks = [];
    this.rdReg = null;
    this.villages = null;
    this.applyLook(track);
    if (track.kind === 'descent') {
      const T = this.terrain;
      this.villages = new Villages3D({
        track, terrain: T, houses: this.houses,
        roadDist: (x, z) => this.roadDistAt(x, z),
        ground: (sg0, sg, dx) => {
          const side = sg < 0 ? sg0.L : sg0.R;
          return this.groundAt(side, sg0, sg, dx, T.lim(sg0.i)[sg < 0 ? 0 : 1] - track.extra(sg0.i));
        },
        clearTrees: (x, z, r) => this.clearTrees(x, z, r),
        invalidate: (x0, z0, x1, z1) => this.invalidateTerrain(x0, z0, x1, z1),
      });
      this.villages.ahead(6500);
    }
    this.planMarks(track);
    this.camReg = null;
    this.newSigns(track.names);
    this.clearChunks();
    this.buildStarts(track);
    if (this.grass) { this.scene.remove(this.grass.group); this.grass.dispose(); this.grass = null; }
    if (this.pc) {
      this.grassMat ??= grassMaterial(this.time);
      this.grass = new Grass3D({ track, material: this.grassMat, verge: (i, sg) => this.grassVerge(i, sg) });
      this.scene.add(this.grass.group);
    }
    this.cam.init = false;
    this.resetDirector(false);
    this.runners = [];
    this.runNext = 0;
  }

  // ---------------------------------------------------------------- Wahrzeichen des Schauplatzes (venue.ts)

  /** Ortsbild des Schauplatzes für alle Häuser (house3d.ts): Dachdeckung, Wandfarben, Dachneigung, Hinterhäuser */
  private applyLook(t: Track) {
    const sc = t.scape;
    if (!sc) { setTownLook(null); return; }
    const pool: number[] = [];
    for (const [k, w] of sc.styles) if (k !== 'chalet') for (let q = 0; q < Math.max(1, Math.round(w * 2)); q++) pool.push(STYLE[k]);
    const south = sc.country === 'it' || sc.country === 'si' || sc.region === 'provence';
    setTownLook({
      roof: sc.roof, walls: sc.walls, pool: pool.length ? pool : undefined,
      alpPool: sc.styles.some(([k]) => k === 'chalet') ? [STYLE.chalet, STYLE.chalet, STYLE.bruchstein, STYLE.creme] : [STYLE.bruchstein, STYLE.bruchstein, STYLE.creme],
      pitch: sc.roof === 'slate' ? 1.25 : sc.roof === 'lauze' ? 1.3 : sc.roof === 'tile' && south ? 0.85 : 1,
    });
  }

  /** geplante Wahrzeichen je Segment (gebaut im Abschnitt, der dieses Segment enthält) */
  private marks = new Map<number, VenueMark[]>();
  /** Bereiche ohne Requisiten und Zuschauer (Pfeiler und Mauern der Wahrzeichen): Segmente i0…i1, |x| in x0…x1 */
  private markClear: { i0: number; i1: number; x0: number; x1: number; sg: number }[] = [];

  /**
   * Wahrzeichen festlegen, sobald die Strecke steht (vor der Landschaft: Ebenen unter den Bauten). Paris: Arc de
   * Triomphe über der Straße hinter dem Ziel, Eiffelturm in der Ferne, Sacré-Cœur auf der Kuppe des Bergfinales.
   */
  private planMarks(t: Track) {
    this.marks = new Map();
    this.markClear = [];
    // Fahnen der Gastgeber im Publikum
    setCrowdHome(t.scape?.flags ?? null);
    const v = t.venue;
    if (!v) return;
    const has = (m: Mark) => v.marks.includes(m);
    const w = { x: 0, y: 0, z: 0, th: 0 };
    const add = (m: VenueMark) => { const l = this.marks.get(m.i) ?? []; l.push(m); this.marks.set(m.i, l); };
    /** Lage eines Punkts quer/längs zum Segment i (wie in den Abschnitten: Querachse cos/sin th, vorwärts sin/−cos) */
    const frame = (i: number) => { t.world(i * SEG, 0, 0, w, true); return { x: w.x, y: w.y, z: w.z, th: w.th }; };
    const finish = t.kind === 'sprint' ? SPRINT_FINISH : t.kind === 'tt' ? TT_FINISH : t.kind === 'mountain' ? MOUNTAIN_FINISH : -1;
    if (finish > 0) {
      const fi = Math.round(finish / SEG);
      t.seg(fi + 170);
      if (has('arc')) {
        // gerades Stück 220–300 m hinter der Linie (hinter dem letzten Haus des Zielorts)
        let best = fi + 125;
        let bc = Infinity;
        for (let i = fi + 108; i <= fi + 150; i++) {
          let c = 0;
          for (let q = -8; q <= 8; q++) { const s = t.seg(i + q); c += Math.abs(s.curve) * 40 + (s.bL || s.bR ? 1 : 0); }
          if (c < bc) { bc = c; best = i; }
        }
        add({ i: best, kind: 'arc', lat: 0, along: 0, f: frame(best) });
        this.markClear.push({ i0: best - 7, i1: best + 7, x0: ARC.mw - 0.6, x1: ARC.W + 4, sg: 0 });
      }
      // Wahrzeichen in der Ferne über dem Zielort: schon auf der Anfahrt über die Felder zu sehen, im Ort über den
      // Dächern – dort, wo das Gelände am tiefsten liegt (die Berge bleiben)
      const town = t.sections.find((x) => x.biome === 'village' && x.start <= fi && x.end > fi);
      const i = Math.max(10, town ? town.start : fi - 300);
      const f = frame(i);
      const T = this.terrain!;
      const pos = (lat: number, along: number) => [f.x + Math.cos(f.th) * lat + Math.sin(f.th) * along, f.z + Math.sin(f.th) * lat - Math.cos(f.th) * along];
      const hAt = (x: number, z: number) => T.heightIn(T.region(x - 2, z - 2, x + 2, z + 2), x, z);
      const taken: number[][] = [];
      /** Platz suchen (frei von Straßen, tief, nicht zu weit seitlich), Gelände darunter ebnen, Wahrzeichen merken */
      const distant = (kind: Mark, o: { lats: number[]; alongs: number[]; ring: number; road: number; flat: number; ideal?: number; span?: number }) => {
        let best = { lat: o.lats[0], along: o.alongs[0], h: f.y, score: Infinity };
        for (const lat of o.lats) for (const along of o.alongs) {
          const [px, pz] = pos(lat, along);
          if (taken.some(([x, z]) => Math.hypot(x - px, z - pz) < o.ring + 150)) continue;
          const reg = T.region(px - 2, pz - 2, px + 2, pz + 2);
          // nie auf oder an einer Straße (die Strecke kann in diese Richtung abbiegen)
          const rd = T.roadDist(reg, px, pz);
          if (rd !== null && rd < o.road) continue;
          // freies, tiefes Land ringsum (nicht in einer Schlucht zwischen Bergen)
          let hMax = hAt(px, pz);
          for (let k = 0; k < 8; k++) hMax = Math.max(hMax, hAt(px + Math.cos(k * 0.785) * o.ring, pz + Math.sin(k * 0.785) * o.ring));
          const score = (hMax - f.y) + Math.abs(lat) * 0.05 + Math.abs(along - (o.ideal ?? 600)) * 0.006;
          if (score < best.score) best = { lat, along, h: hAt(px, pz), score };
        }
        const [px, pz] = pos(best.lat, best.along);
        taken.push([px, pz]);
        const base = Math.min(best.h, f.y + 40);
        const pts: number[] = [];
        const R = o.flat;
        // längliche Bauten (Aquädukt): Ebene längs der Achse
        const span = o.span ?? 0;
        for (let q = 0; q <= Math.max(1, Math.ceil(span / R)); q++) {
          const al = span ? (q * span) / Math.max(1, Math.ceil(span / R)) : 0;
          const [cx, cz] = pos(best.lat, best.along + al);
          for (const [dx, dz] of [[-R, -R], [R, -R], [R, R], [-R, R], [0, 0]]) pts.push(cx + dx * 0.9, base - 0.5, cz + dz * 0.9, 1);
        }
        T.addFlat(pts, R, 1, [], true);
        add({ i, kind, lat: best.lat, along: best.along, f: { ...f, y: base } });
      };
      if (has('eiffel')) distant('eiffel', { lats: [-330, -260, -200, -150, 150, 200, 260, 330], alongs: [200, 350, 500, 650, 800, 950], ring: 75, road: 110, flat: 60 });
      /**
       * Große Bauten am Talrand (die Täler sind schmal, die Berge bleiben): Grundriss (quer l, längs a, am Bau) ganz
       * außerhalb der Ortszeilen, möglichst ebenes Gelände, nicht zu hoch über der Straße; das Gelände unter dem
       * Grundriss wird auf die Höhe der Mitte geebnet (am Hang eine Terrasse wie bei einer Burg).
       */
      const site = (kind: Mark, o: FarSite) => {
        const sc = o.s ?? 1;
        const off = (sg: number, l: number, a: number) => (o.face ? [sg * a * sc, -sg * l * sc] : [l * sc, a * sc]);
        const grid: [number, number][] = [];
        for (let u = 0; u <= 2; u++) for (let v = 0; v <= 2; v++) grid.push([o.l0 + ((o.l1 - o.l0) * u) / 2, o.a0 + ((o.a1 - o.a0) * v) / 2]);
        let best: { lat: number; along: number; sg: number; h: number; score: number } | null = null;
        for (const sg of [-1, 1]) for (const D of [45, 60, 80, 100, 125, 150, 180]) for (let along = 120; along <= 1000; along += 110) {
          // Mitte so, dass die straßennächste Ecke D vom Rand hat
          let near = Infinity;
          for (const [l, a] of grid) near = Math.min(near, sg * off(sg, l, a)[0]);
          const lat = sg * (D - near);
          let ok = true, hMin = Infinity, hMax = -Infinity;
          for (const [l, a] of grid) {
            const [dl, da] = off(sg, l, a);
            const [px, pz] = pos(lat + dl, along + da);
            if (taken.some(([x, z]) => Math.hypot(x - px, z - pz) < 60)) { ok = false; break; }
            const reg = T.region(px - 2, pz - 2, px + 2, pz + 2);
            const rd = T.roadDist(reg, px, pz);
            if (rd !== null && rd < 34) { ok = false; break; }
            const h = T.heightIn(reg, px, pz);
            hMin = Math.min(hMin, h);
            hMax = Math.max(hMax, h);
          }
          if (!ok) continue;
          const [cx, cz] = pos(lat + off(sg, (o.l0 + o.l1) / 2, (o.a0 + o.a1) / 2)[0], along + off(sg, (o.l0 + o.l1) / 2, (o.a0 + o.a1) / 2)[1]);
          const hc = hAt(cx, cz);
          const up = hc - f.y;
          const score = (hMax - hMin) * 1.2 + Math.max(0, up - 22) * 2 + D * 0.05 + Math.abs(along - (o.ideal ?? 450)) * 0.012;
          if (!best || score < best.score) best = { lat, along, sg, h: (hMin + hMax) / 2, score };
        }
        if (!best) return;
        const base = Math.min(best.h, f.y + 45);
        const pts: number[] = [];
        // Raster über den Grundriss (etwa alle 16 m), jeder Punkt eben auf Höhe der Mitte
        const nl = Math.max(1, Math.ceil(((o.l1 - o.l0) * sc) / 16)), na = Math.max(1, Math.ceil(((o.a1 - o.a0) * sc) / 16));
        for (let u = 0; u <= nl; u++) for (let v = 0; v <= na; v++) {
          const [dl, da] = off(best.sg, o.l0 + ((o.l1 - o.l0) * u) / nl, o.a0 + ((o.a1 - o.a0) * v) / na);
          const [px, pz] = pos(best.lat + dl, best.along + da);
          pts.push(px, base - 0.4, pz, 1);
          taken.push([px, pz]);
        }
        T.addFlat(pts, 14, 1, [], true);
        add({ i, kind, lat: best.lat, along: best.along, f: { ...f, y: base }, sg: best.sg, face: o.face, s: sc });
      };
      for (const k of Object.keys(FAR_SITES) as Mark[]) if (has(k)) site(k, FAR_SITES[k]!);
    }
    if (t.kind === 'mountain' && has('geant')) {
      // Géant du Tourmalet auf der Kuppe, gegenüber der Berghütte, Gesicht zur Straße
      const top = Math.round(MOUNTAIN_TOP / SEG);
      t.seg(top + 60);
      let i = top + 6;
      let sg = -1;
      for (let k = top; k < top + 60; k++) {
        const sp = t.seg(k).sprites?.find((x) => x.k === 'rifugio');
        if (sp) { i = k - 4; sg = sp.x < 0 ? 1 : -1; break; }
      }
      const f = frame(i);
      const d0 = EDGE + 5;
      add({ i, kind: 'geant', lat: sg * d0, along: 0, f, sg });
      this.markClear.push({ i0: i - 4, i1: i + 4, x0: d0 - 3, x1: d0 + 4, sg });
    }
    if (t.kind === 'mountain' && has('sacreCoeur')) {
      // auf der Kuppe (Butte Montmartre) an Stelle der Berghütte, mit der Front zur Straße
      const top = Math.round(MOUNTAIN_TOP / SEG);
      t.seg(top + 60);
      let i = top + 26;
      let sg = 1;
      for (let k = top; k < top + 60; k++) {
        const sp = t.seg(k).sprites?.find((x) => x.k === 'rifugio');
        if (sp) { i = k; sg = sp.x < 0 ? -1 : 1; break; }
      }
      const f = frame(i);
      const d0 = EDGE + 16;
      add({ i, kind: 'sacreCoeur', lat: sg * d0, along: 0, f, sg });
      this.markClear.push({ i0: i - 16, i1: i + 16, x0: d0 - 4, x1: d0 + 95, sg });
      const pts: number[] = [];
      for (let a = -10; a <= 90; a += 10) for (const l of [-26, 0, 26]) {
        const lat = sg * (d0 + a);
        const along = sg * l;
        pts.push(f.x + Math.cos(f.th) * lat + Math.sin(f.th) * along, f.y - 0.1, f.z + Math.sin(f.th) * lat - Math.cos(f.th) * along, 1);
      }
      this.terrain!.addFlat(pts, 26, 1, [], true);
    }
  }

  /** liegt eine Requisite (Segment, Querlage) im Grundriss eines Wahrzeichens? */
  private inMark(i: number, x: number): boolean {
    for (const c of this.markClear) {
      if (i < c.i0 || i > c.i1) continue;
      if (c.sg !== 0 && Math.sign(x) !== c.sg) continue;
      const ax = Math.abs(x);
      if (ax >= c.x0 && ax <= c.x1) return true;
    }
    return false;
  }

  /** ein geplantes Wahrzeichen in die Netze des Abschnitts bauen */
  private buildMark(T: Town, m: VenueMark) {
    const { f } = m;
    const rx = Math.cos(f.th), rz = Math.sin(f.th);
    const fx = Math.sin(f.th), fz = -Math.cos(f.th);
    const at0: At = (lat, al, h) => [f.x + rx * (m.lat + lat) + fx * (m.along + al), f.y + h, f.z + rz * (m.lat + lat) + fz * (m.along + al)];
    if (m.kind === 'arc') arcDeTriomphe(T, at0);
    else if (m.kind === 'eiffel') eiffelTower(T.plain, at0);
    else if (m.kind === 'geant') geant(T, at0);
    else if (FAR_MARKS[m.kind]) {
      const [build, r] = FAR_MARKS[m.kind]!;
      const sg = m.sg ?? 1, sc = m.s ?? 1;
      const at: At = m.face ? (l, a, h) => at0(sg * a * sc, -sg * l * sc, h * sc) : (l, a, h) => at0(l * sc, a * sc, h * sc);
      build(T, at);
      // Bäume im Grundriss weg
      const o = FAR_SITES[m.kind]!;
      for (let l = o.l0; l <= o.l1 + 0.1; l += Math.max(10, (o.l1 - o.l0) / 4)) for (let a = o.a0; a <= o.a1 + 0.1; a += Math.max(10, (o.a1 - o.a0) / 4)) {
        const p = at(l, a, 0);
        this.clearTrees(p[0], p[2], r * sc);
      }
    }
    else if (m.kind === 'sacreCoeur') {
      // Front zur Straße: die Tiefe des Baus läuft quer von der Straße weg
      const sg = m.sg ?? 1;
      const at: At = (l, a, h) => at0(sg * a, -sg * l, h);
      sacreCoeur(T, at);
      for (let a = 0; a <= 80; a += 16) { const p = at(0, a, 0); this.clearTrees(p[0], p[2], 34); }
    }
  }

  /** Startrampe (Zeitfahren, Rampenstart) und Start der Abfahrt – in der Farbe der Rundfahrt */
  private buildStarts(track: Track) {
    this.ttStart?.dispose();
    this.ttStart = null;
    const T = this.terrain;
    if (T && (track.kind === 'tt' || track.ramp)) {
      this.ttStart = new TtStart3D({
        f0: track.kind === 'tt' ? 0 : track.rampZ, flush: track.kind === 'descent', count: track.kind === 'tt' ? [5, 0.6] : [3, 0.75],
        track, props: this.mats.props, ads: this.mats.ads, gear: this.gearMat, shadow: this.shadowTex, glow: this.mats.lampGlow.map!,
        accent: this.accent, aniso: Math.min(this.pc ? 16 : 4, this.gl.capabilities.getMaxAnisotropy()),
        side: (f, sg, dx) => {
          const s = track.seg(Math.max(track.first, Math.floor(f / SEG)));
          return this.groundAt(sg < 0 ? s.L : s.R, s, sg, dx, T.lim(s.i)[sg < 0 ? 0 : 1] - track.extra(s.i)) ?? 0;
        },
        pc: this.pc,
      });
      this.scene.add(this.ttStart.root);
      // auch was erst später zu sehen ist (Blitze der Fotografen): Shader gleich (das erste Zeichnen: Probezug)
      this.warmUp(this.ttStart.root);
    }
    this.descStart?.dispose();
    this.descStart = null;
    this.makeDescStart(track);
  }

  private makeDescStart(track: Track) {
    if (track.kind !== 'descent' || track.startZ <= 0 || this.descStart) return;
    this.descStart = new DescentStart3D({
      track, props: this.mats.props, gear: this.gearMat, facade: this.mats.facade, roof: this.mats.roof, tiles: this.mats.tiles, sign: this.mats.sign,
      lantern: this.mats.lantern, bulb: this.mats.bulb, shadow: this.shadowTex, glow: this.mats.lampGlow.map!,
      aniso: Math.min(this.pc ? 16 : 8, this.gl.capabilities.getMaxAnisotropy()), accent: this.accent,
      night: () => this.mats.bulb.opacity, pc: this.pc, ramp: track.ramp,
    });
    this.scene.add(this.descStart.root);
    this.warmUp(this.descStart.root);
  }

  /**
   * PC-Gras pflegen: Stücke voraus bauen, hinten freigeben. Im ruhigen Auftakt der Abfahrt (Tunnelausgang bis hinter
   * die Kehre) entsteht nichts – das Gras dafür wird vorher schon bis hinter die Kehre gebaut.
   */
  private updateGrass(g: RaceView) {
    if (!this.grass || this.calm) return;
    const z = g.p.z;
    let ahead = z + 120;
    const cz = this.calmZ;
    if (cz && isFinite(cz[0]) && z > cz[0] - 240 && z < cz[1]) ahead = Math.max(ahead, cz[1] + 100);
    // (vor dem Start, wenn niemand fährt, großzügiger)
    this.grass.update(z, ahead, this.debugPeakMs ?? (this.idleBuild ? Math.max(1, this.idleMs(4)) : 1));
  }

  /**
   * Teamwagen: auf Strecken mit Teamwagen-Stellen schon vor dem Start gebaut und vorgewärmt (keine Shader mitten im
   * Rennen), dann neben dem Fahrer gezeigt, solange das Spiel einen Wagen führt
   */
  private updateCar(g: RaceView, dt: number) {
    const t = g.track;
    if (!t.carZones) { if (this.teamCar) this.teamCar.group.visible = false; return; }
    if (this.teamCar && !this.teamCar.fits(g.p.kit)) { this.teamCar.dispose(); this.teamCar = null; }
    if (!this.teamCar) {
      if (!this.idleBuild && !g.car) return;
      this.teamCar = new TeamCar3D(g.p.kit, { props: this.mats.props, shadowTex: this.shadowTex, glow: this.mats.lampGlow.map! });
      this.scene.add(this.teamCar.group);
      this.warmUp(this.teamCar.group);
      this.teamCar.group.visible = false;
    }
    const c = g.car;
    this.teamCar.group.visible = !!c;
    if (!c) return;
    t.world(g.p.z, g.p.x, 1.35, this.carW);
    this.carLook.set(this.carW.x, this.carW.y, this.carW.z);
    this.teamCar.update(c, (z, x) => t.world(z, x, 0, this.carW), this.camera.position, this.carLook, dt);
  }

  /** Querprofil einer Straßenseite fürs Gras – null, wo keine Wiese ist (Tunnel, Brücke, Fels, Ort, Zuschauer) */
  private grassVerge(i: number, sg: number): { pr: { o: number[]; h: number[]; cols: RGBf[] }; lim: number } | null {
    const t = this.track;
    if (!t || i < t.first) return null;
    const s = t.seg(i);
    if (s.tunnel || s.bridge > 0 || s.portal || s.crowd) return null;
    const side = sg < 0 ? s.L : s.R;
    if (side.ground !== 'meadow' || side.wall > 0 || side.barrier === 'crowd') return null;
    // Startort der Abfahrt, Häuser in der Nähe (Straßenzeile), Dörfer: dort Gärten und Pflaster
    if (t.kind === 'descent' && t.startZ > 0 && i * SEG < t.startZ + 160) return null;
    for (let d = -7; d <= 7; d++) { const o = t.seg(Math.max(t.first, i + d)); if (sg < 0 ? o.bL : o.bR) return null; }
    if (this.villages?.inside(i * SEG)) return null;
    const e = t.extra(i);
    const lim = (this.terrain ? this.terrain.lim(i)[sg < 0 ? 0 : 1] : LIM_MAX) - e;
    return { pr: this.profile(side, s, sg, lim), lim: lim - EDGE };
  }

  /** Startort: bewegen; hinter dem Ort (vor Landstraße und Kehre) freigeben, bei einer neuen Fahrt wieder bauen */
  private updateDescStart(g: RaceView, dt: number) {
    const t = g.track;
    if (t.kind !== 'descent' || t.startZ <= 0) return;
    // neue Fahrt (neue Strecke derselben Tagesstrecke): frisch aufbauen (Tauben, Leute wieder am Platz) – aber nur,
    // wenn auf diesem schon losgefahren wurde. Vom Vorwärmen her (oder nach einer Änderung im Startmenü) steht er
    // unberührt: dann nur die neue Strecke übernehmen. Der Neubau ist ein großer Brocken in einem Bild (beim Öffnen
    // der Abfahrt eine halbe Sekunde Stillstand unter der Startanimation).
    if (this.descStart && this.descStart.track !== t && (g.phase === 'ready' || g.phase === 'countdown')) {
      const old = this.descStart.track;
      if (this.descStart.raced || old.dayKey !== t.dayKey || old.ramp !== t.ramp || old.startZ !== t.startZ || old.venue?.key !== t.venue?.key) { this.descStart.dispose(); this.descStart = null; }
      else this.descStart.track = t;
    }
    if (this.descStart && g.phase === 'playing' && g.p.z > t.startZ + 280) { this.descStart.dispose(); this.descStart = null; return; }
    if (!this.descStart && (g.phase === 'ready' || g.phase === 'countdown') && g.p.z < t.startZ + 20) this.makeDescStart(t);
    this.descStart?.update(g, dt, this.camera);
  }

  /** Startwert der Sprüche auf Pappschildern und Spruchbändern – jedes Rennen ein neuer */
  private signSeed = 77;
  private newSigns(names: string[]) {
    this.signSeed = Math.floor(Math.random() * 0x7fffffff);
    this.setAds(names);
    this.setFans(names);
  }

  /** Spruchbänder der Fan-Bögen (mit den Namen der Runde) */
  private setFans(names: string[]) {
    const tex = this.tex(fanAtlas(names, this.signSeed), false);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    if (!this.fanMat) this.fanMat = new THREE.MeshLambertMaterial({ map: tex });
    else {
      const old = this.fanMat.map;
      this.fanMat.map = tex;
      this.fanMat.needsUpdate = true;
      old?.dispose();
    }
  }

  private setAds(names: string[]) {
    const old = this.mats.ads.map;
    this.mats.ads.map = this.tex(adsTex(names, this.signSeed));
    this.mats.ads.map.wrapS = this.mats.ads.map.wrapT = THREE.ClampToEdgeWrapping;
    this.mats.ads.needsUpdate = true;
    old?.dispose();
  }

  private clearTiles() {
    for (const f of this.tFades) for (const t of f.out) if (this.tiles.get(t.key) !== t) this.dropTile(t);
    this.tFades = [];
    for (const c of this.morphC) c.set(NaN, NaN);
    this.morphR.fill(-1);
    for (const t of this.tiles.values()) this.dropTile(t);
    this.tiles.clear();
    for (const t of this.tWait.values()) this.dropTile(t);
    this.tWait.clear();
    this.pending = null;
    for (const b of this.lvBox) b.set(1e9, 1e9, -1e9, -1e9);
    for (const b of this.lvBoxA) b.set(1e9, 1e9, -1e9, -1e9);
    this.boxSet.fill(false);
  }

  private tileAp(t: Tile, code: number | undefined) {
    for (const o of t.objs) setAp(o, code);
  }

  private tileVis(t: Tile, vis: boolean) {
    if (t.objs[0]?.visible === vis) return;
    for (const o of t.objs) o.visible = vis;
    if (t.tsrc) t.tsrc.on = vis;
  }

  /**
   * Neuer Ring einer Stufe (Gebiet nb): die neuen Kacheln erscheinen dort, wo die Stufe schon ganz die Form der
   * gröberen hat (Rand des Übergangs) – unsichtbar. Herausfallende bleiben stehen, bis der Übergangs-Mittelpunkt
   * weit genug weitergewandert ist, dass auch sie ganz die gröbere Form haben; erst dann gehen sie (dropMorphed).
   */
  private ringChange(lv: number, nb: THREE.Vector4) {
    const inside = (b: number[], x: THREE.Vector4) => b[0] >= x.x - 1 && b[1] >= x.y - 1 && b[2] <= x.z + 1 && b[3] <= x.w + 1;
    // ein früherer Wechsel noch nicht abgeschlossen: dessen alte Kacheln jetzt entfernen (selten)
    const old = [...this.tiles.values()].filter((t) => t.lv === lv && t.out);
    for (const t of old) {
      if (inside(t.box, nb)) { t.out = false; continue; }
      if (t.keep) { t.out = false; this.tileVis(t, false); continue; }
      this.dropTile(t);
      this.tiles.delete(t.key);
    }
    this.lvBoxA[lv].copy(this.lvBox[lv]);
    this.lvBox[lv].copy(nb);
    // gröbste Stufe: nichts darunter, das übergehen müsste – Überzähliges entfernt die Ringpflege
    if (lv >= LEVELS.length - 1) { this.lvBoxA[lv].copy(nb); return; }
    let any = false;
    for (const t of this.tiles.values()) {
      if (t.lv !== lv || inside(t.box, nb)) continue;
      t.out = true;
      any = true;
    }
    if (!any) this.lvBoxA[lv].copy(nb);
  }

  /** herausgefallene Kacheln entfernen, sobald sie alle ganz die Form der gröberen Stufe haben */
  private dropMorphed() {
    for (let lv = 0; lv < LEVELS.length - 1; lv++) {
      const m = this.morphU[lv].value;
      let any = false;
      let done = true;
      for (const t of this.tiles.values()) {
        if (t.lv !== lv || !t.out) continue;
        any = true;
        if (Math.max(t.box[0] - m.x, m.x - t.box[2], t.box[1] - m.y, m.y - t.box[3]) < m.w + 1) { done = false; break; }
      }
      if (!any || !done) continue;
      for (const t of [...this.tiles.values()]) {
        if (t.lv !== lv || !t.out) continue;
        // vorgebaute Kacheln bleiben (nur unsichtbar), die anderen gehen
        if (t.keep) { t.out = false; this.tileVis(t, false); continue; }
        this.dropTile(t);
        this.tiles.delete(t.key);
      }
      this.lvBoxA[lv].copy(this.lvBox[lv]);
    }
  }

  /**
   * Übergangs-Mittelpunkt je Stufe: folgt dem Ziel (ein Stück voraus) mit begrenztem Tempo – nie sprunghaft – und
   * bleibt so weit im Gebiet der Stufe, dass ihr Rand immer schon ganz in der gröberen Form liegt.
   */
  private updateMorph(mid: number[][], dt: number, snap: boolean) {
    // mid: Ziel je Stufe (Kamera, ggf. ein Stück voraus)
    for (let lv = 0; lv < LEVELS.length - 1; lv++) {
      const [R0, R1] = MORPH[lv];
      const B = this.lvBox[lv];
      const u = this.morphU[lv].value;
      const c = this.morphC[lv];
      if (B.x > B.z) {
        // Stufe noch gar nicht da: ganz in der gröberen Form
        this.morphR[lv] = -1;
        c.set(mid[lv][0], mid[lv][1]);
        u.set(c.x, c.y, -2, -1);
        continue;
      }
      const half = (B.z - B.x) / 2;
      const bx = (B.x + B.z) / 2;
      const bz = (B.y + B.w) / 2;
      // Außenradius: höchstens bis kurz vor den Rand (beim Aufbau wächst das Gebiet – der Radius zieht stetig nach)
      const want = Math.min(R1, half - LEVELS[lv].size / 2 - 2);
      const rr = this.morphR[lv];
      this.morphR[lv] = snap || rr < 0 || want < rr ? want : Math.min(want, rr + dt * (lv === 0 ? 90 : 300));
      const r1 = this.morphR[lv];
      const h = Math.max(0, half - r1 - 2);
      const tx = Math.max(bx - h, Math.min(bx + h, mid[lv][0]));
      const tz = Math.max(bz - h, Math.min(bz + h, mid[lv][1]));
      if (snap || Number.isNaN(c.x)) c.set(tx, tz);
      else {
        const dx = tx - c.x;
        const dz = tz - c.y;
        const d = Math.hypot(dx, dz);
        const step = dt * (lv === 0 ? 70 : 160);
        if (d > step) { c.x += (dx / d) * step; c.y += (dz / d) * step; } else c.set(tx, tz);
      }
      // Beginn < Ende (sonst ist smoothstep undefiniert); ohne Platz ganz in der gröberen Form
      u.set(c.x, c.y, r1 - Math.max(1, (R1 - R0) * Math.max(0, r1) / R1), r1);
    }
  }

  /** Überblendung beenden: neue Kacheln ganz da, alte weg (außer sie liegen in keep – dann bleiben sie) */
  private endFade(f: TileFade, keep?: THREE.Vector4) {
    const i = this.tFades.indexOf(f);
    if (i >= 0) this.tFades.splice(i, 1);
    for (const t of f.inc) this.tileAp(t, undefined);
    for (const t of f.out) {
      if (keep && t.box[0] >= keep.x - 1 && t.box[1] >= keep.y - 1 && t.box[2] <= keep.z + 1 && t.box[3] <= keep.w + 1 && this.tiles.get(t.key) === t) {
        t.out = false;
        this.tileAp(t, undefined);
        continue;
      }
      this.dropTile(t);
      if (this.tiles.get(t.key) === t) this.tiles.delete(t.key);
    }
  }

  private updateFades(dt: number) {
    for (const f of [...this.tFades]) {
      f.a = Math.min(1, f.a + dt / f.dur);
      if (f.a >= 1) { this.endFade(f); continue; }
      for (const t of f.inc) this.tileAp(t, apIn(f.a));
      for (const t of f.out) this.tileAp(t, apOut(f.a));
    }
  }

  private dropTile(t: Tile) {
    if (t.tsrc) this.treeSrc.delete(t.tsrc);
    for (const o of t.objs) this.scene.remove(o);
    // freigeben erst nach und nach (ein Ringwechsel gibt viele Kacheln auf einmal frei)
    this.dispQ.push(() => {
      for (const o of t.objs) {
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
        if (o.userData.bb) disposeBillboards((o as THREE.Mesh).geometry);
      }
      for (const g of t.geos) g.dispose();
    });
  }

  /** Freigaben, die noch ausstehen: je Bild eine kleine Portion (Puffer auf der Grafikkarte löschen kostet Zeit) */
  private dispQ: (() => void)[] = [];
  private dispI = 0;
  private updateDispose() {
    const t0 = performance.now();
    const lim = this.idleBuild ? Math.max(0.5, this.idleMs(6)) : 0.5;
    while (this.dispI < this.dispQ.length && performance.now() - t0 < lim) this.dispQ[this.dispI++]();
    if (this.dispI >= this.dispQ.length && this.dispI) { this.dispQ.length = 0; this.dispI = 0; }
  }

  /**
   * Landschaftskacheln rund um die Kamera nachladen: feinste Stufe zuerst, nächstgelegene zuerst,
   * mit Zeitbudget je Bild. Alte Kacheln verschwinden erst, wenn der neue Ring vollständig ist.
   */
  private updateTerrain(g: RaceView, dt: number) {
    const T = this.terrain;
    if (!T) return;
    void g;
    this.updateFades(dt);
    this.updateTileWait();
    const cp = this.camera.position;
    const t0 = performance.now();
    // großer Sprung (neuer Lauf): wie beim Start schrittweise neu aufbauen
    const jump = this.lastTerrCam.distanceTo(cp) > 250;
    this.lastTerrCam.copy(cp);
    this.camera.getWorldDirection(this.terrDir);
    this.terrDir.y = 0;
    if (this.terrDir.lengthSq() > 1e-6) {
      this.terrDir.normalize();
      // beim Aufbau und nach Sprüngen sofort, sonst langsam nachziehen (Kehren lösen keinen Sturm von Neubauten aus)
      if (jump || this.tiles.size === 0) this.terrFwd.copy(this.terrDir);
      else this.terrFwd.lerp(this.terrDir, 0.03).normalize();
    }
    const fw = this.terrFwd;
    // Mittelpunkt je Stufe: die Kamera selbst. Die Ringe hängen so nur vom Ort ab, nicht von der Blickrichtung –
    // in Kehren dreht sich die Kamera, ohne dass Kacheln neu gebaut werden müssen. (Voraus reicht die feinste
    // Stufe trotzdem weit genug: ihr Übergang endet spätestens 508 m voraus, ihr Gebiet frühestens nach 512 m.)
    // (Felder wiederverwendet: keine neuen Listen je Bild)
    const mt = this.morphT;
    for (let lv = 0; lv < mt.length; lv++) { mt[lv][0] = cp.x + fw.x * MORPH_AHEAD[lv]; mt[lv][1] = cp.z + fw.z * MORPH_AHEAD[lv]; }
    this.updateMorph(mt, dt, jump);
    this.dropMorphed();
    // nach einem Sprung passen die alten Kacheln nicht mehr zur Strecke (sie stünden als Berge im Bild):
    // weg damit und wie beim Start neu aufbauen
    if (jump && this.tiles.size) this.clearTiles();
    const fresh = this.tiles.size === 0;
    const startup = !this.boxSet.every(Boolean);
    // Aufbau verteilt auf viele Bilder (kein langes Einfrieren beim Laden), beim Start etwas großzügiger.
    // Der Nahbereich (feine und mittlere Stufe) entsteht aber sofort vollständig: sonst schneidet die
    // grobe Stufe (ohne Straßenklemmen) durch Straße und Zuschauer
    // auf der Startkarte großzügig: dort soll die Welt komplett stehen, bevor es losgeht
    // (erster Panoramablick der Abfahrt: nur in winzigen Häppchen weiter – die Ringe stehen schon)
    const budget = this.idleBuild ? Math.max(1.5, this.idleMs(30)) : startup ? 12 : this.calm ? 0.25 : Math.max(1.2, Math.min(this.range.budget, this.room() * 0.62));
    // Korridorbreiten der Strecke vorab in kleinen Portionen (die Kacheln fragen sie dann nur noch ab)
    T.prefetchLim(t0 + (this.idleBuild ? Math.max(0.3, this.idleMs(6)) : 0.3));
    if (fresh) {
      this.pending = null;
      for (const lv of [0, 1]) {
        const Lv = LEVELS[lv];
        const cx = Math.floor(cp.x / Lv.size);
        const cz = Math.floor(cp.z / Lv.size);
        for (let j = cz - 1; j <= cz + 1; j++) {
          for (let i = cx - 1; i <= cx + 1; i++) if (!this.tiles.has(tkey(lv, i, j))) this.buildTile(T, lv, i, j, t0, Infinity);
        }
      }
      // sofort sichtbar (nach einem Sprung wäre sonst ein Bild lang nichts da) – sie laden beim nächsten Zeichnen hoch
      for (const t of this.tiles.values()) t.staged = true;
    }
    // angefangene Kachel weiterbauen (nach einem Fensterwechsel neu beginnen: die Proben haben sich geändert)
    if (this.pending && this.pending.ver !== T.version) {
      const k = this.pending.key;
      this.pending = { ...this.pending, gen: this.tileGen(T, this.pending.lv, k), ver: T.version };
    }
    // der Bau gibt an der Zeitgrenze von selbst ab (feine Häppchen): kein Bild wird spürbar länger
    T.deadline = t0 + budget;
    while (this.pending && performance.now() - t0 < budget) {
      const r = this.pending.gen.next();
      if (r.done) { this.tileDone(this.pending.key, r.value); this.pending = null; }
    }
    const centers = this.cent;
    for (let lv = 0; lv < LEVELS.length; lv++) { centers[lv][0] = Math.floor(cp.x / LEVELS[lv].size); centers[lv][1] = Math.floor(cp.z / LEVELS[lv].size); }
    const ringOf = (lv: number, key: number) => this.ringOf(lv, key);
    // 1) fehlende Kacheln: beim Start erst der Nahbereich, dann die Ferne (damit nie Leere sichtbar ist),
    //    danach der Rest; nächste zuerst
    const order = startup ? ORDER_START : ORDER_RIDE;
    let out = !!this.pending;
    for (const [lv, maxR] of order) {
      if (out) break;
      const Lv = LEVELS[lv];
      const [cx, cz] = centers[lv];
      const R = Math.min(maxR, Lv.ring);
      // meist ist alles da: erst nachsehen (ohne Listen anzulegen), dann sortiert bauen
      let missing = false;
      for (let j = cz - R; j <= cz + R && !missing; j++) for (let i = cx - R; i <= cx + R; i++) if (!this.tiles.has(tkey(lv, i, j))) { missing = true; break; }
      if (!missing) continue;
      const want: [number, number, number][] = [];
      for (let j = cz - R; j <= cz + R; j++) {
        for (let i = cx - R; i <= cx + R; i++) want.push([i, j, (i + 0.5 - cp.x / Lv.size) ** 2 + (j + 0.5 - cp.z / Lv.size) ** 2]);
      }
      want.sort((a, b) => a[2] - b[2]);
      for (const [i, j] of want) {
        if (this.tiles.has(tkey(lv, i, j))) continue;
        if (!this.buildTile(T, lv, i, j, t0, budget)) { out = true; break; }
      }
    }
    // 2) Abdeckung je Stufe melden (gröbere Stufe sinkt darunter ab)
    for (let lv = 0; lv < LEVELS.length; lv++) {
      const Lv = LEVELS[lv];
      const [cx, cz] = centers[lv];
      // größter vollständiger Ring um die Kamera
      let rc = -1;
      for (let r = 0; r <= Lv.ring; r++) {
        let ok = true;
        // (vollständig = gebaut und schon auf der Grafikkarte: ein neuer Ring lädt nicht im Bild seines Erscheinens hoch)
        for (let j = cz - r; j <= cz + r && ok; j++) for (let i = cx - r; i <= cx + r && ok; i++) if (!this.tiles.get(tkey(lv, i, j))?.staged) ok = false;
        if (!ok) break;
        rc = r;
      }
      if (!this.boxSet[lv]) {
        // Aufbau: nur der vollständige Teil ist sichtbar, die gröbere Stufe deckt den Rest
        if (rc >= 0) this.lvBox[lv].set((cx - rc) * Lv.size, (cz - rc) * Lv.size, (cx + rc + 1) * Lv.size, (cz + rc + 1) * Lv.size);
        else this.lvBox[lv].set(1e9, 1e9, -1e9, -1e9);
        this.lvBoxA[lv].copy(this.lvBox[lv]);
        for (const t of this.tiles.values()) {
          if (t.lv !== lv) continue;
          const vis = ringOf(lv, t.key) <= rc;
          for (const o of t.objs) o.visible = vis;
          if (t.tsrc) t.tsrc.on = vis;
        }
        if (rc === Lv.ring) this.boxSet[lv] = true;
      } else {
        // neuer Ring vollständig: neue Kacheln zeigen, herausfallende bleiben bis zum vollständigen Übergang
        // (bei schneller Fahrt kommt der ganze Ring nicht nach: sobald die Kamera die Mitte des alten Gebiets
        // verlassen hat, reicht ein kleinerer vollständiger Ring – sonst stünde die grobe Stufe direkt neben der Straße)
        const bx0 = this.lvBox[lv];
        const left = Math.abs((bx0.x + bx0.z) / 2 / Lv.size - 0.5 - cx) >= 1 || Math.abs((bx0.y + bx0.w) / 2 / Lv.size - 0.5 - cz) >= 1;
        if (rc === Lv.ring || (left && rc >= RING_MIN[lv])) {
          const nb = this.boxTmp.set((cx - rc) * Lv.size, (cz - rc) * Lv.size, (cx + rc + 1) * Lv.size, (cz + rc + 1) * Lv.size);
          if (!nb.equals(this.lvBox[lv])) this.ringChange(lv, nb);
        }
        // neue Kacheln erst zeigen, wenn ihr Ring vollständig ist; herausfallende bleiben, bis sie ganz übergegangen sind
        const bx = this.lvBox[lv];
        for (const t of this.tiles.values()) {
          if (t.lv !== lv) continue;
          this.tileVis(t, !!t.out || (t.box[0] >= bx.x - 1 && t.box[1] >= bx.y - 1 && t.box[2] <= bx.z + 1 && t.box[3] <= bx.w + 1));
        }
      }
      // Ring vollständig: Überzähliges entfernen (außer was noch übergeht)
      if (rc === Lv.ring) {
        for (const t of this.tiles.values()) {
          // (Löschen während des Durchlaufs ist bei Map erlaubt)
          if (t.lv === lv && !t.out && !t.keep && ringOf(lv, t.key) > Lv.ring) { this.dropTile(t); this.tiles.delete(t.key); }
        }
      }
    }
    if (out) return;
    // 3) veraltete Kacheln erneuern (die alten bleiben stehen, bis die neuen fertig sind)
    for (let lv = 0; lv < LEVELS.length; lv++) {
      const Lv = LEVELS[lv];
      const [cx, cz] = centers[lv];
      for (let j = cz - Lv.ring; j <= cz + Lv.ring; j++) {
        for (let i = cx - Lv.ring; i <= cx + Lv.ring; i++) {
          if (!this.tiles.get(tkey(lv, i, j))?.stale) continue;
          if (!this.buildTile(T, lv, i, j, t0, budget)) return;
        }
      }
    }
    // 4) auf der Startkarte: die mittlere und grobe Stufe entlang der ganzen Strecke vorbauen (bleiben dann
    //    unterwegs stehen – kein Nachladen in der Ferne mehr, nur noch die feine Stufe in der Nähe)
    if (this.idleBuild && g.phase === 'ready') this.prebuildRoute(T, g, t0, budget);
  }

  /** vorgebaute Strecke (m): so weit reicht das Probenfenster, so weit stehen mittlere und grobe Stufe */
  private routeEnd = 0;
  private pre: { keys: number[]; idx: number; gen: Generator<void, Tile, void> | null } | null = null;
  private prebuildRoute(T: Terrain, g: RaceView, t0: number, budget: number) {
    if (!this.pre) {
      const t = g.track;
      // Abfahrt: 7 km (so weit fährt kaum jemand), Finals: die ganze Strecke
      this.routeEnd = t.kind === 'descent' ? 7000 : t.kind === 'sprint' ? SPRINT_FINISH + 400 : t.kind === 'tt' ? TT_FINISH + 400 : MOUNTAIN_FINISH + 400;
      const w = this.w2;
      const keys: number[] = [];
      const seen = new Set<number>();
      for (const lv of [2, 1]) {
        const Lv = LEVELS[lv];
        for (let z = 0; z < this.routeEnd; z += 16) {
          t.world(z, 0, 0, w);
          const cx = Math.floor(w.x / Lv.size);
          const cz = Math.floor(w.z / Lv.size);
          for (let j = -Lv.ring; j <= Lv.ring; j++) for (let i = -Lv.ring; i <= Lv.ring; i++) { const k = tkey(lv, cx + i, cz + j); if (!seen.has(k)) { seen.add(k); keys.push(k); } }
        }
      }
      this.pre = { keys, idx: 0, gen: null };
      // die Proben müssen die ganze Strecke abdecken (sonst stimmten die Kacheln später nicht mehr); geänderte
      // Gebiete holt draw() im nächsten Bild ab (betroffene Kacheln werden neu gebaut)
      T.window(Math.max(0, g.p.z - 900), Math.max(g.p.z + 4600, this.routeEnd));
    }
    const pre = this.pre;
    T.deadline = t0 + budget;
    while (performance.now() - t0 < budget) {
      if (!pre.gen) {
        while (pre.idx < pre.keys.length && this.tiles.get(pre.keys[pre.idx])?.keep) pre.idx++;
        if (pre.idx >= pre.keys.length) break;
        const k = pre.keys[pre.idx];
        const have = this.tiles.get(k);
        if (have) { have.keep = true; pre.idx++; continue; }
        pre.gen = this.tileGen(T, Math.floor(k / (TK * TK)), k);
      }
      const r = pre.gen.next();
      if (r.done) {
        const tile = r.value;
        tile.keep = true;
        tile.staged = true;
        this.tileVis(tile, false);
        this.tiles.set(tile.key, tile);
        pre.gen = null;
        pre.idx++;
      }
    }
    T.deadline = Infinity;
  }

  /** Kachel beginnen und im Rahmen des Budgets fertigbauen (sonst im nächsten Bild weiter); true = fertig */
  private buildTile(T: Terrain, lv: number, i: number, j: number, t0: number, budget: number): boolean {
    if (performance.now() - t0 > budget) return false;
    const key = tkey(lv, i, j);
    this.pending = { key, lv, gen: this.tileGen(T, lv, key), ver: T.version };
    T.deadline = t0 + budget;
    while (this.pending && performance.now() - t0 < budget) {
      const r = this.pending.gen.next();
      if (r.done) { this.tileDone(key, r.value); this.pending = null; }
    }
    T.deadline = Infinity;
    return !this.pending;
  }

  /** fertig gebaute Ersatzkacheln, die noch hochgeladen werden (die alte bleibt bis dahin sichtbar) */
  private tWait = new Map<number, Tile>();

  /** Kachel fertig gebaut: einsetzen – ersetzt sie eine sichtbare, erst wenn sie auf der Grafikkarte ist */
  private tileDone(key: number, t: Tile) {
    this.prof?.event(EV.tile);
    const old = this.tiles.get(key);
    if (old && !t.staged && this.boxSet[t.lv] && old.objs[0]?.visible && !old.out) {
      // die alte ist damit nicht mehr veraltet (sonst würde sie gleich noch einmal gebaut)
      old.stale = false;
      const prev = this.tWait.get(key);
      if (prev) this.dropTile(prev);
      this.tileVis(t, false);
      this.tWait.set(key, t);
      return;
    }
    this.putTile(key, t);
  }

  /** wartende Ersatzkacheln einsetzen, sobald sie oben sind */
  private updateTileWait() {
    for (const [key, t] of this.tWait) {
      if (!t.staged) continue;
      this.tWait.delete(key);
      this.putTile(key, t);
    }
  }

  /** Ziel des Übergangs je Stufe und Mittelpunkt (Kachel) je Stufe – wiederverwendet */
  private morphT = MORPH_AHEAD.map(() => [0, 0]);
  private cent = LEVELS.map(() => [0, 0]);
  /** Ring einer Kachel um die Kamera (Tschebyschow-Abstand in Kacheln) */
  private ringOf(lv: number, key: number): number {
    return Math.max(Math.abs(tkI(key) - this.cent[lv][0]), Math.abs(tkJ(key) - this.cent[lv][1]));
  }

  /** fertige Kachel einsetzen (eine veraltete mit gleichem Schlüssel verschwindet erst jetzt) */
  private putTile(key: number, t: Tile) {
    const old = this.tiles.get(key);
    this.tiles.set(key, t);
    if (!old) return;
    // blendet die alte gerade ein: die neue übernimmt ihren Platz in der Überblendung
    const f0 = this.tFades.find((f) => f.inc.includes(old));
    if (f0) {
      f0.inc[f0.inc.indexOf(old)] = t;
      this.tileAp(t, apIn(f0.a));
      this.dropTile(old);
      return;
    }
    // sichtbare Kachel neu gebaut (Straße in der Nähe hat sich geändert): weich überblenden statt umzuspringen
    if (this.boxSet[t.lv] && old.objs[0]?.visible && !old.out) {
      old.out = true;
      this.tileAp(t, apIn(0));
      this.tileAp(old, apOut(0));
      this.tFades.push({ lv: t.lv, a: 0, dur: 1, inc: [t], out: [old] });
      return;
    }
    this.dropTile(old);
  }

  /** Kachel ganz in Häppchen: Landschaft rechnen, dann die Objekte dazu bauen */
  private *tileGen(T: Terrain, lv: number, key: number): Generator<void, Tile, void> {
    const d = yield* T.tileSteps(lv, tkI(key), tkJ(key));
    return yield* this.tileObjects(d, lv, key);
  }

  private *tileObjects(d: TileData, lv: number, key: number): Generator<void, Tile, void> {
    const T = this.terrain!;
    const late = () => T.deadline !== Infinity && performance.now() > T.deadline;
    const tx = tkI(key);
    const tz = tkJ(key);
    const size = LEVELS[lv].size;
    let tsrc: TreeSource | null = null;
    const objs: THREE.Object3D[] = [];
    const geos: THREE.BufferGeometry[] = [d.geo];
    const mesh = new THREE.Mesh(d.geo, this.terrMats[lv]);
    mesh.receiveShadow = lv === 0;
    // gröbere Stufen werfen keine Sonnenschatten: im Schattenkasten liegt ohnehin die feinste Stufe darüber
    mesh.userData.noShadow = lv > 0;
    objs.push(mesh);
    if (d.water) {
      geos.push(d.water);
      const w = new THREE.Mesh(d.water, this.waterMats[lv]);
      w.userData.noShadow = true;
      w.renderOrder = 2;
      objs.push(w);
    }
    if (d.trees.length) {
      // alle Bäume der Kachel als Bilder in einem Zeichenaufruf
      const rec = new Float32Array(d.trees.length * TREC);
      d.trees.forEach((t, k) => {
        const o = k * TREC;
        // jeder Baum etwas anders: heller/dunkler, olivgelb oder bläulich (treeTint)
        const [tr, tg, tb] = treeTint(t.tint, (t.rot * 7.3) % 1, (t.rot * 11.9) % 1);
        rec[o] = t.x; rec[o + 1] = t.y; rec[o + 2] = t.z; rec[o + 3] = t.s; rec[o + 4] = t.rot;
        rec[o + 5] = tr; rec[o + 6] = tg; rec[o + 7] = tb;
        rec[o + 8] = treeVariant(t.kind, (t.rot * 13.17) % 1);
        rec[o + 9] = t.dy ?? 0;
        // wo ein Haus steht (Dorf, Hof): kein Baum
        if (this.treeBlocked(t.x, t.z)) rec[o + 3] = 0;
      });
      tsrc = { box: [tx * size, tz * size, (tx + 1) * size, (tz + 1) * size], rec, n: d.trees.length, on: true };
      const bg = treeBillboards(tsrc, this.treeAtlas);
      this.bbOf.set(tsrc, bg);
      const bm = new THREE.Mesh(bg, this.bbMat);
      bm.userData.bb = true;
      if (this.bbDepth) { bm.customDepthMaterial = this.bbDepth; bm.castShadow = true; }
      objs.push(bm);
    }
    if (d.falls) {
      // Wasser (Strömung) und Gischt; die Felsen kommen zu den Landmarken
      geos.push(d.falls.water, d.falls.mist);
      const fm = new THREE.Mesh(d.falls.water, this.fallMaterial());
      fm.renderOrder = 3;
      objs.push(fm);
      const mm = new THREE.Mesh(d.falls.mist, this.mistMaterial());
      mm.renderOrder = 4;
      objs.push(mm);
    }
    const rock = d.falls?.rock;
    if (d.marks.length || rock?.pos.length) {
      // alle Landmarken der Kachel in einer Geometrie (ein Zeichenaufruf statt einem je Art)
      let total = rock ? rock.pos.length / 3 : 0;
      for (const t of d.marks) {
        const g = this.markGeo[t.kind as Landmark];
        if (g) total += g.index ? g.index.count : g.getAttribute('position').count;
      }
      if (total) {
        const pos = new Float32Array(total * 3);
        const col = new Float32Array(total * 3);
        // Höhenunterschied zur gröbersten Stufe: im Übergang dorthin bleibt die Hütte auf dem Boden
        const dys = new Float32Array(total);
        const d1s = new Float32Array(total);
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        const v = new THREE.Vector3();
        const p0 = new THREE.Vector3();
        const sc = new THREE.Vector3();
        let o = 0;
        let nm = 0;
        for (const t of d.marks) {
          const g = this.markGeo[t.kind as Landmark];
          if (!g) continue;
          // viele Ecken: zwischendurch nachsehen, ob die Zeit des Bildes um ist
          if ((++nm & 3) === 0 && late()) yield;
          const P = g.getAttribute('position');
          const C = g.getAttribute('color');
          const ix = g.index;
          const n = ix ? ix.count : P.count;
          q.setFromAxisAngle(up, t.rot);
          m.compose(p0.set(t.x, t.y, t.z), q, sc.set(t.s, t.s, t.s));
          // dieselbe Farbvarianz wie das Bild desselben Baums in der Ferne
          const [tr, tg, tb] = treeTint(t.tint, (t.rot * 7.3) % 1, (t.rot * 11.9) % 1);
          for (let i = 0; i < n; i++) {
            const k = ix ? ix.getX(i) : i;
            v.fromBufferAttribute(P, k).applyMatrix4(m);
            pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
            col[o * 3] = (C ? C.getX(k) : 1) * tr; col[o * 3 + 1] = (C ? C.getY(k) : 1) * tg; col[o * 3 + 2] = (C ? C.getZ(k) : 1) * tb;
            dys[o] = t.dy ?? 0;
            o++;
          }
        }
        // Felsstufen und Becken der Wasserfälle
        if (rock) {
          pos.set(rock.pos, o * 3);
          col.set(rock.col, o * 3);
          dys.set(rock.dy, o);
          d1s.set(rock.d1, o);
          o += rock.pos.length / 3;
        }
        const mg = new THREE.BufferGeometry();
        mg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        mg.setAttribute('color', new THREE.BufferAttribute(col, 3));
        mg.setAttribute('aDy', new THREE.BufferAttribute(dys, 1));
        mg.setAttribute('aD1', new THREE.BufferAttribute(d1s, 1));
        mg.computeBoundingSphere();
        if (mg.boundingSphere) mg.boundingSphere.radius += 60;
        geos.push(mg);
        objs.push(new THREE.Mesh(mg, this.markMat));
      }
    }
    if (late()) yield;
    for (const o of objs) { appearifyTree(o); o.matrixAutoUpdate = false; o.updateMatrix(); this.scene.add(o); }
    // neue Shader (z. B. der erste Wasserfall) gleich anstoßen: sichtbar wird die Kachel meist erst einige Bilder später
    for (const o of objs) this.warmUp(o);
    if (tsrc) this.treeSrc.add(tsrc);
    const tile: Tile = { lv, key, objs, geos, tsrc, box: [tx * size, tz * size, (tx + 1) * size, (tz + 1) * size] };
    // vorab hochladen; ein neuer Ring erscheint erst, wenn alle seine Kacheln oben sind (auf der Startkarte gleich)
    if (this.idleBuild) tile.staged = true;
    else this.stage(objs, () => { tile.staged = true; });
    return tile;
  }

  private clearChunks() {
    this.signs.clear();
    for (const c of this.chunks.values()) this.dropChunk(c);
    for (const c of this.chunkOld.values()) this.dropChunk(c);
    for (const f of [...this.cFades]) this.dropChunk(f.c);
    this.chunks.clear();
    this.chunkOld.clear();
    this.cFades = [];
    this.fanCache.clear();
  }

  /** Radlampen erst bei Dunkelheit (und im Tunnel) – nicht schon im Abendlicht der Finals */
  private bikeLight(): number { return Math.max(0, this.night - 0.62) * 2.6 + this.tunnelDim; }

  /** feste Tageszeit (0 Mittag … 0.7 Sonnenuntergang): Tests und das Wetter (weather.ts) setzen sie, sonst null */
  debugTod: number | null = null;

  /**
   * Wetter (weather.ts): zeichnet die Szene über eine Nachbearbeitung statt direkt auf die Leinwand.
   * draw() zeichnet die Szene in das gerade gesetzte Ziel; g ist die Fahrt dieses Bildes.
   */
  post: ((draw: () => void, g: RaceView) => void) | null = null;

  /** was das Wetter vom Renderer braucht */
  get weatherEnv(): WeatherEnv {
    return {
      gl: this.gl, scene: this.scene, camera: this.camera, sun: this.sun, fog: this.fog, sky: this.skyMat.uniforms, skyMesh: this.sky, noCast: [this.mats.billboard],
      setMood: (m) => { this.moodOverride = m; },
    };
  }

  /**
   * Tageszeit über die Fahrt: jede Fahrt beginnt am Nachmittag und endet im Abendlicht – Sprint- und
   * Bergfinale im Sonnenuntergang mit Laternen und hellen Fenstern, die Abfahrt wird mit der Strecke später
   */
  private todAt(g: RaceView): number {
    if (this.debugTod !== null) return this.debugTod;
    const t = this.track!;
    const v = hash(t.seed);
    // Abfahrt: Abend wie in der WebGPU-Abfahrt – tiefe Sonne, warmes Licht, die Lichter brennen schon (updateLight)
    // (Herbst und Winter: es dämmert früher – etwas später am Tag, die Fenster brennen schon; season.ts)
    if (t.kind === 'descent') return Math.min(0.68, DESCENT_TOD + this.season.todShift * 0.6);
    const fin = t.kind === 'sprint' ? SPRINT_FINISH : t.kind === 'tt' ? TT_FINISH : MOUNTAIN_FINISH;
    const a = 0.16 + v * 0.12 + this.season.todShift;
    const b = Math.min(0.69, 0.62 + hash(t.seed + 7) * 0.05 + this.season.todShift * 0.5);
    return a + (b - a) * smooth01(g.p.z / fin);
  }

  private updateLight(g: RaceView, biome: BiomeId, seg: Seg, dt: number) {
    const tod = this.todAt(g);
    const L = lightAt(tod);
    this.night = L.lights;
    const pal = BIOME_PALETTES[biome];
    const inTunnel = seg.tunnel ? 1 : 0;
    this.tunnelDim += (inTunnel - this.tunnelDim) * Math.min(1, dt * 3);
    const dim = 1 - this.tunnelDim * 0.55;
    const S = this.season;
    let haze = mixRGB(pal.haze, L.hazeMix, L.hazeAmt);
    // Jahreszeit: Herbstdunst golden-warm, Winterluft kühl und weißlich (season.ts)
    if (S.warm > 0) haze = mixRGB(haze, [236, 206, 168], S.warm * 0.22);
    else if (S.warm < 0) haze = mixRGB(haze, [214, 224, 238], -S.warm * 0.3);
    const fogC = new THREE.Color().setRGB(haze[0] / 255, haze[1] / 255, haze[2] / 255, THREE.SRGBColorSpace);
    this.fog.color.copy(fogC);
    // klare Bergluft: Nahes knackig, Fernes sanft im Dunst
    // Luftperspektive: Fernes verblasst deutlich – gibt den Bergen Tiefe statt einer Wand
    this.fog.density = (0.00085 + L.hazeAmt * 0.0002) * this.range.fog * (1 + S.haze * 0.55);
    const tint = new THREE.Color().setRGB(L.tint[0] / 255, L.tint[1] / 255, L.tint[2] / 255, THREE.SRGBColorSpace);
    // abends etwas weniger Licht – aber die Strecke bleibt gut lesbar
    const dayK = 1 - L.lights * 0.45;
    this.hemi.color.setRGB(0.74, 0.84, 1, THREE.SRGBColorSpace).multiply(tint);
    // Bodenlicht: helle Wiesen, Fels und Schnee werfen viel Licht zurück – auch Schattenseiten bleiben freundlich
    this.hemi.groundColor.setRGB(0.64, 0.6, 0.5, THREE.SRGBColorSpace).multiply(tint);
    // Himmels- und Bodenlicht: Schattenseiten (Felswände, Hänge weg von der Sonne) bleiben lesbar, aber deutlich
    // dunkler als die Sonnenseite – Licht mit Richtung statt gleichmäßiger Helligkeit
    this.hemi.intensity = (1.7 + 0.55 * dayK) * dim;
    const sunRGB = S.warm > 0 ? mixRGB(L.sun, [255, 196, 128], S.warm * 0.2) : S.warm < 0 ? mixRGB(L.sun, [228, 236, 255], -S.warm * 0.25) : L.sun;
    const sunC = new THREE.Color().setRGB(sunRGB[0] / 255, sunRGB[1] / 255, sunRGB[2] / 255, THREE.SRGBColorSpace);
    this.sun.color.copy(sunC);
    // Winter: kühleres Himmelslicht, Schnee wirft viel Licht zurück
    if (S.warm < 0) { this.hemi.color.lerp(new THREE.Color(0.8, 0.88, 1.0), -S.warm * 0.25); this.hemi.groundColor.lerp(new THREE.Color(0.78, 0.82, 0.9), S.snow * 0.35); }
    this.sun.intensity = Math.max(0.6, Math.min(3.0, (L.sunY + 0.14) * 7.0)) * dayK * dim;
    // Sonnenstand: am Nachmittag schräg von hinten und von der Seite (die Berge vor einem liegen im Licht, Hänge
    // bekommen Licht- und Schattenseite), zum Abend hin wandert die Sonne nach Westen, steht tiefer und taucht
    // seitlich vor einem ins Abendrot
    const el = Math.max(-0.2, L.sunY) * 1.5 + 0.18;
    const az = Math.PI - 0.95 + Math.min(0.75, L.t) * 2.1;
    const sd = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
    // Dunst zur Sonne hin in ihrer Farbe: nachmittags zart, am Abend ein Glühen (siehe grade.ts)
    ATMO.fogSunDir.value.copy(sd);
    ATMO.fogSunCol.value.copy(sunC).multiplyScalar((0.18 + 0.55 * L.hazeAmt) * Math.max(0, Math.min(1, 1 - L.stars * 1.5)) * dim);
    this.peakU.uGlow.value.copy(ATMO.fogSunCol.value);
    // Glitzern auf dem Wasser: Sonnenlicht, nachts (Sterne) fast nichts
    if (this.waterU) {
      this.waterU.uSunC.value.copy(sunC).multiplyScalar(this.sun.intensity * Math.max(0.08, Math.min(1, 1 - L.stars * 1.2)));
      // im Wasser gespiegelte Hänge: näherer Höhenzug im Dunst, im Licht der Tageszeit
      const land = mixRGB(mixRGB(pal.mid, pal.far, 0.5), haze, 0.25);
      this.waterU.uLand.value.setRGB(land[0] / 255, land[1] / 255, land[2] / 255, THREE.SRGBColorSpace).multiply(tint).multiplyScalar(0.85 * dayK * dim);
    }
    const c = this.shadowCenter(g, sd);
    this.sun.position.copy(c).addScaledVector(sd, this.pc ? 450 : 220);
    this.sun.target.position.copy(c);
    // Gegenlicht: von der anderen Seite, flacher, bläulich wie Himmelslicht
    this.fill.position.copy(this.camera.position).add(new THREE.Vector3(-sd.x, 0.45, -sd.z).normalize().multiplyScalar(200));
    this.fill.target.position.copy(this.camera.position);
    this.fill.intensity = 0.7 * dayK * dim;
    // Spiegelungen auf Lack, Chrom und Helmen werden mit dem Licht dunkler
    setGlossEnv(Math.max(0.2, 1 - L.lights * 0.8) * dim);
    const u = this.skyMat.uniforms;
    const top = mixRGB(L.skyTop, pal.skyTop, 0.35 * (1 - L.t));
    const hz = mixRGB(L.skyHorizon, pal.skyHorizon, 0.35 * (1 - L.t));
    (u.top.value as THREE.Color).setRGB(top[0] / 255, top[1] / 255, top[2] / 255, THREE.SRGBColorSpace);
    (u.horizon.value as THREE.Color).setRGB(hz[0] / 255, hz[1] / 255, hz[2] / 255, THREE.SRGBColorSpace);
    (u.below.value as THREE.Color).copy(fogC);
    (u.sunDir.value as THREE.Vector3).copy(sd);
    (u.sunCol.value as THREE.Color).copy(sunC).multiplyScalar(L.sunY > -0.1 ? 1 : 0);
    // Wolken: Stimmung des Tages, vom Wetter der Fahrt überstimmt
    const M = { ...this.mood, ...(this.moodOverride ?? {}) };
    u.uTime.value = this.time.value;
    u.uCover.value = M.cover; u.uCirrus.value = M.cirrus; u.uStorm.value = M.storm; u.uOvercast.value = M.overcast; u.uTowers.value = M.towers;
    u.uStars.value = L.stars; u.uWarm.value = Math.max(0, Math.min(1, (L.t - 0.3) / 0.4));
    // (einfache Grafik: ruhiger Himmel ohne Wolkentürme und Strahlen)
    u.uDrama.value = this.track?.kind === 'descent' && !this.lite ? 1 : 0;
    // Fenster, Laternen, Lichterketten: in der Abfahrt (Abend) überall an, sonst mit der Tageszeit
    // (Herbst und Winter: Fenster und Laternen brennen früher – gemütlich; season.ts)
    const lampsOn = this.track?.kind === 'descent' && this.debugTod === null ? 1 : Math.max(L.lights, S.lamps);
    this.mats.facade.emissiveIntensity = lampsOn * 1.25;
    this.houses.lights.value = lampsOn;
    this.mats.sign.emissiveIntensity = lampsOn * 0.75;
    const dusk = Math.max(0, Math.min(1, (lampsOn - 0.08) / 0.4));
    this.mats.bulb.opacity = dusk;
    this.mats.lantern.opacity = dusk * 0.85;
    this.mats.glow.opacity = Math.max(0, lampsOn - 0.2) * 1.1;
    // Halos und Lichtkegel der Laternen (lamps3d.ts)
    LAMP_U.uLampK.value = Math.max(0, Math.min(1, (lampsOn - 0.12) / 0.55));
    if (!this.holeMode) this.valleyMat.color.copy(fogC);
    // Berge am Horizont: dasselbe Licht wie die Landschaft (Lambert: Lichtfarbe · Stärke / π)
    {
      const P = this.peakU;
      const ip = 1 / Math.PI;
      P.uSunDir.value.copy(sd);
      P.uSunC.value.copy(this.sun.color).multiplyScalar(this.sun.intensity * ip);
      P.uSkyC.value.copy(this.hemi.color).multiplyScalar(this.hemi.intensity * ip);
      P.uGroundC.value.copy(this.hemi.groundColor).multiplyScalar(this.hemi.intensity * ip);
      P.uFillDir.value.set(-sd.x, 0.45, -sd.z).normalize();
      P.uFillC.value.copy(this.fill.color).multiplyScalar(this.fill.intensity * ip);
      P.uHaze.value.copy(fogC);
    }
    // Tunnel: warmweiße Leuchten, an den Portalen Tageslicht in der Farbe des Dunstes
    // Augen gewöhnen sich an das Dunkel: im Tunnel heller belichten – die Röhre bleibt gleich, draußen
    // (am Ausgang) wird es gleißend hell
    const adapt = 1 + this.tunnelDim * 0.55;
    this.gl.toneMappingExposure = 1.08 * adapt;
    this.tunU.uDay.value.copy(fogC).multiplyScalar((0.9 + Math.min(2.7, this.sun.intensity / Math.max(0.2, dim)) * 0.32) / adapt);
    this.tunU.uLamp.value.setRGB(1.0, 0.82, 0.58).multiplyScalar(15 / adapt);
    this.tunU.uAmb.value = 0.06 / adapt;

    const water = pal.water;
    this.mats.water.color.setRGB(water[0] / 255, water[1] / 255, water[2] / 255, THREE.SRGBColorSpace);
    for (const m of this.waterMats) m.color.copy(this.mats.water.color);
  }

  private sc0 = new THREE.Vector3();
  private sAx = new THREE.Vector3();
  private sAy = new THREE.Vector3();
  /** Mittelpunkt des Schattenbereichs: etwas vor dem Fahrer, im Lichtraum auf Texelgröße gerastet */
  private shadowCenter(g: RaceView, sd: THREE.Vector3): THREE.Vector3 {
    // (PC-Grafik: die große Schattenkarte reicht weiter voraus – Mitte 60 m vor dem Fahrer)
    const w = this.track!.world(g.p.z + (this.pc ? 60 : 16), 0, 0, this.w2);
    const c = this.sc0.set(w.x, w.y, w.z);
    const ax = this.sAx.set(0, 1, 0).cross(sd).normalize();
    const ay = this.sAy.copy(sd).cross(ax).normalize();
    // auf ganze Texel der Schattenkarte springen (sonst flimmern die Schattenkanten beim Fahren)
    const sc = this.sun.shadow.camera;
    const texel = (sc.right - sc.left) / Math.max(1, this.sun.shadow.mapSize.x);
    const u = Math.round(c.dot(ax) / texel) * texel - c.dot(ax);
    const v = Math.round(c.dot(ay) / texel) * texel - c.dot(ay);
    return c.addScaledVector(ax, u).addScaledVector(ay, v);
  }

  private updateCamera(g: RaceView, dt: number) {
    // Probeblick (peekNext) vorbei: Kamera wie vorher
    if (this.peekSave) {
      Object.assign(this.cam, this.peekSave.cam);
      this.chaseLift = this.peekSave.chaseLift;
      this.peekSave = null;
    }
    const peek = this.peek;
    this.peek = false;
    if (peek) this.peekSave = { cam: { ...this.cam }, chaseLift: this.chaseLift };
    const p = g.p;
    const track = g.track;
    const cam = this.cam;
    const w = this.w;
    const roadY = track.heightAt(p.z);
    const air = Math.max(0, p.y - roadY);
    track.world(p.z, p.x, 0, w);
    const rx = w.x;
    const ry = w.y + air;
    const rz = w.z;
    // Blickrichtung = Fahrtrichtung des Fahrers (Straße plus Querbewegung), geglättet:
    // die Kamera steht immer direkt hinter ihm, er bleibt in der Bildmitte – auch in Kehren
    const yaw = w.th + Math.atan2(p.vx, Math.max(5, p.v)) * 0.3;
    // Rennfinale: höher und weiter hinten (Motorradkamera), damit man über das Feld schaut –
    // im Bergfinale bergab wieder die nahe Abfahrtskamera (weich überblendet); Zeitfahren: dazwischen (Geister voraus)
    const wantPack = track.kind === 'sprint' || (track.kind === 'mountain' && p.z < MOUNTAIN_TOP + 25) ? 1 : track.kind === 'tt' ? 0.4 : 0;
    const still = !cam.init || g.phase === 'ready' || g.phase === 'countdown';
    if (still) cam.pack = wantPack;
    else cam.pack += (wantPack - cam.pack) * Math.min(1, dt * 1.2);
    // erster Panoramablick (Auftakt der Abfahrt): aus dem Tunnel heraus steigt die Kamera weich höher und weiter
    // zurück, der Blick geht über den Fahrer ins Tal – nach der Spitzkehre wieder die gewohnte Fahrkamera
    const rk = this.revealK(track, p.z);
    const back = CAM_BACK + (SPRINT_BACK - CAM_BACK) * cam.pack + 3.2 * rk;
    const behindY = track.heightAt(Math.max(0, p.z - back));
    // die Kamera fährt wie auf dem Motorrad über dieselben Wellen (etwas gedämpft)
    const bump = track.lift(Math.max(0, p.z - back), p.x) * 0.8;
    const ty = Math.max(behindY, roadY) + bump + CAM_UP + (SPRINT_UP - CAM_UP) * cam.pack + air * 0.35 + 4.2 * rk;
    if (still) {
      cam.th = yaw;
      cam.y = ty;
      cam.init = true;
    }
    let d = yaw - cam.th;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    // (exakt abklingend: gleich weich bei jeder Bildrate)
    const turn = d * (1 - Math.exp(-dt * 6));
    cam.th += turn;
    cam.y += (ty - cam.y) * (1 - Math.exp(-dt * 7));
    // nie unter die Straße sinken (z. B. nach einem Sprung nach vorn oder steil bergauf)
    cam.y = Math.max(cam.y, roadY + 1.2);
    const descent = track.kind === 'descent';
    this.hNear = p.z;
    // Abfahrt: in Kurven schwingt die Kamera nach außen (wie ein Motorrad mit Kameramann), auf Geraden zurück
    // hinters Rad – aus der Drehgeschwindigkeit der Fahrtrichtung (rechts herum → Kamera nach links)
    const omega = dt > 0 ? turn / dt : 0;
    const swingT = !descent || still || g.phase !== 'playing' ? 0 : clamp(-omega * Math.min(1, p.v / 14) * 2.4, -1.7, 1.7);
    this.swing += (swingT - this.swing) * (1 - Math.exp(-dt * 1.6));
    const sw = this.swing;
    const fx = Math.sin(cam.th);
    const fz = -Math.cos(cam.th);
    const sx = Math.cos(cam.th);
    const sz = Math.sin(cam.th);
    const shake = g.shake * 0.04;
    const A = this.camA;
    A.pos.set(rx - fx * back + sx * sw + (Math.random() - 0.5) * shake, cam.y + (Math.random() - 0.5) * shake, rz - fz * back + sz * sw);
    if (descent) {
      // nie im Hang: über dem Gelände bleiben und den Fahrer frei sehen (weich anheben, langsam wieder senken);
      // nicht im Tunnel und an seinen Portalen (dort liegt der Berg über der Straße)
      // (weich in beide Richtungen: der Boden unter der Kamera und die Sichtlinie werden nur an einzelnen Punkten
      // abgetastet – sprang die Kamera direkt mit, zitterte sie in Kurven über Böschungen und Hängen)
      if (!this.nearTunnel(track, p.z)) {
        const need = this.needLift(A.pos.x, A.pos.y, A.pos.z, rx, ry + 1.1, rz, 1.1, 10);
        const floor = Math.max(0, this.hAt(A.pos.x, A.pos.z) + 0.9 - A.pos.y);
        const want = Math.max(need, floor);
        if (dt > 0) this.chaseLift += (want - this.chaseLift) * (1 - Math.exp(-dt * (want > this.chaseLift ? 8 : 1.4)));
        // nie in den Boden (nur wenn er schneller steigt, als die Kamera nachkommt)
        A.pos.y += Math.max(this.chaseLift, floor - 0.35);
      } else if (dt > 0) this.chaseLift *= Math.exp(-dt * 3);
    }
    const look = 15 + 2 * cam.pack + 12 * rk;
    const aheadY = track.heightAt(p.z + look);
    // der Steigung nur zum Teil nachschauen: der Horizont bleibt ruhiger, die Straße steigt sichtbar im Bild an
    // (in der Abfahrt wie bisher – dort geht es um den Blick in die Kurven)
    const follow = descent ? 0.55 : 0.3;
    A.look.set(rx + fx * look, roadY + (aheadY - roadY) * follow + 0.9 + air * 0.4 + 2.2 * rk, rz + fz * look);
    cam.x = rx; cam.z = rz;
    // Sichtfeld: hochkant mehr Höhe, bei Tempo etwas weiter (Geschwindigkeitsgefühl)
    const aspect = this.W / this.H;
    const base = aspect < 1 ? 72 - (aspect - 0.45) * 22 : 56;
    A.fov = base + Math.min(9, Math.max(0, (p.v - 14) * 0.38)) + 9 * rk;
    // Regie: in allen Spielen vor dem Start der TV-Kran schräg hinter dem Fahrer (Startmenü), mit „Los“ schwenkt er
    // im Bogen in die Fahrkamera; der Sturz aus der Fernsehperspektive – Wechsel weich geflogen
    // (Probeblick: gleich die Fahrkamera, ohne Regie)
    if (!peek) this.direct(g, A, dt, true);
    this.camera.position.copy(A.pos);
    this.camera.lookAt(A.look);
    // Startmenü: das Bild verschiebt sich (Shift statt Neigen), damit der Fahrer im freien Teil über dem Menü steht;
    // mit „Los“ gleitet es zurück
    this.applyShift(g, peek, dt);
    // leicht in die Kurve legen (Motorradkamera)
    if (descent && this.dirKind === 'chase') this.camera.rotateZ(clamp(p.lean, -0.7, 0.7) * 0.07 * (this.dirT < 1 ? this.dirT : 1));
    // Sichtfeld weich (Tempo); bei Regiewechseln folgt es direkt der Überblendung
    const direct = this.dirKind !== 'chase' || this.dirT < 1;
    cam.fov += (A.fov - cam.fov) * (direct ? 1 : Math.min(1, dt * 2));
    if (Math.abs(this.camera.fov - cam.fov) > 0.01) { this.camera.fov = cam.fov; this.camera.updateProjectionMatrix(); }
    this.lastPhase = g.phase;
  }

  /** Panoramablick nach dem Tunnel (0–1): steigt kurz vor dem Ausgang an, hält durch die Spitzkehre, klingt danach aus */
  private revealK(t: Track, z: number): number {
    if (t.kind !== 'descent' || !this.calmZ || !isFinite(this.calmZ[0])) return 0;
    const s0 = this.calmZ[0] + 30;
    const sm = (a: number, b: number, x: number) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
    return sm(s0 - 10, s0 + 14, z) * (1 - sm(s0 + 80, s0 + 150, z));
  }

  // ------------------------------------------------------------------ Regie (Abfahrt)

  private camA = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 };
  /** Prüfungen: Startkran von außen einstellen (null: je Spiel der feste) */
  menuCam: MenuCam | null = null;
  /**
   * Bildverschiebung (px, wie camera.setViewOffset): x > 0 schiebt die Welt nach links, y > 0 nach oben. Weich
   * gefedert (kritisch gedämpft) – beginnt und endet ohne Ruck, auch wenn ein Bild einmal länger dauert.
   */
  private shift = { x: 0, y: 0, vx: 0, vy: 0, on: false, set: false };
  private applyShift(g: RaceView, peek: boolean, dt: number) {
    const s = this.shift;
    let tx = 0, ty = 0;
    const mv = g.phase === 'ready' ? menuInset() : null;
    if (mv) {
      // Blickpunkt der Kamera (Bildmitte) in die Mitte des freien Teils
      if (mv.top > 0 && mv.top < this.H) ty = this.H / 2 - mv.top * 0.5;
      if (mv.left > 0 && mv.left < this.W) tx = this.W / 2 - (mv.left + (this.W - mv.left) * 0.5);
    }
    if (!s.set || this.idleK > 0.9) {
      // erstes Bild, Vorwärmen oder unter der Startanimation (idleK, gamePrep.ts): gleich dort
      s.x = tx; s.y = ty; s.vx = 0; s.vy = 0; s.set = true;
    } else {
      // kritisch gedämpfte Feder (ω = 5,5: gut eine Sekunde, weich an- und auslaufend) in kleinen Schritten; ein
      // langes Bild zählt höchstens 50 ms (danach gleitet sie weiter, statt zu springen)
      let rest = Math.min(Math.max(dt, 0), 0.05);
      const w = 5.5;
      while (rest > 1e-6) {
        const h = Math.min(rest, 1 / 60);
        rest -= h;
        for (const [k, v, t] of [['x', 'vx', tx], ['y', 'vy', ty]] as const) {
          const a = w * w * (t - s[k]) - 2 * w * s[v];
          s[v] += a * h;
          s[k] += s[v] * h;
        }
      }
      for (const [k, v, t] of [['x', 'vx', tx], ['y', 'vy', ty]] as const) {
        if (Math.abs(t - s[k]) < 0.05 && Math.abs(s[v]) < 0.05) { s[k] = t; s[v] = 0; }
      }
    }
    // Probeblick: die reine Fahrkamera
    const x = peek ? 0 : s.x, y = peek ? 0 : s.y;
    if (Math.abs(x) < 0.01 && Math.abs(y) < 0.01) {
      if (s.on) { this.camera.clearViewOffset(); s.on = false; }
      return;
    }
    this.camera.setViewOffset(this.W, this.H, x, y, this.W, this.H);
    s.on = true;
  }
  private lastPhase = '';
  private dirKind: 'intro' | 'chase' | 'crash' = 'intro';
  /** woher der laufende Kameraflug kommt (vom Kran: im Bogen um den Fahrer herum) */
  private dirFromKind: 'intro' | 'chase' | 'crash' = 'intro';
  private dirFrom = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 };
  private dirLast = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60, ok: false };
  private dirT = 1;
  private dirDur = 1;
  private dirPose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 };
  private lookS = new THREE.Vector3();
  private lookOk = false;
  private swing = 0;
  private chaseLift = 0;
  /** Zusatzbogen des laufenden Kameraflugs (m), damit er nicht durch Hang oder Bäume geht */
  private flyArc = 0;
  private flyLift = 0;
  private crashCam: THREE.Vector3 | null = null;
  private tvV = { x: 0, y: 0, z: 0, th: 0 };
  private tvR = new THREE.Vector3();

  /** Regie zurück: keep = vom Startbild (Kran) aus weiterfliegen */
  private resetDirector(keep: boolean) {
    this.crashCam = null;
    this.swing = 0;
    this.chaseLift = 0;
    if (!keep) { this.dirLast.ok = false; this.dirKind = 'intro'; this.dirT = 1; }
  }

  /** Regie: welche Einstellung jetzt – und weich (geflogen) von der letzten hinüber */
  private direct(g: RaceView, A: { pos: THREE.Vector3; look: THREE.Vector3; fov: number }, dt: number, intro = true) {
    let want: 'intro' | 'chase' | 'crash' = 'chase';
    if (g.phase === 'ready' && intro) want = 'intro';
    else if (g.wreck) want = 'crash';
    if (!this.dirLast.ok) { this.dirKind = want; this.dirT = 1; }
    if (want !== this.dirKind) {
      // vom aktuellen Bild aus hinüberfliegen
      this.dirFrom.pos.copy(this.dirLast.pos);
      this.dirFrom.look.copy(this.dirLast.look);
      this.dirFrom.fov = this.dirLast.fov;
      // vom Kran in die Fahrkamera: im Lauf des Countdowns (Zeitfahren 5 × 0,6 s, sonst 3 × 0,75 s)
      this.dirDur = this.dirKind === 'intro' ? (g.track.kind === 'tt' ? 2.55 : 2.15) : want === 'crash' ? 0.9 : 0.95;
      this.dirFromKind = this.dirKind;
      this.dirKind = want;
      this.dirT = 0;
      this.flyArc = -1;
      this.flyLift = 0;
      this.lookOk = false;
      if (want !== 'crash') this.crashCam = null;
    }
    const D = this.dirPose;
    if (this.dirKind === 'chase') { D.pos.copy(A.pos); D.look.copy(A.look); D.fov = A.fov; } else this.shotPose(g, this.dirKind, D, dt);
    if (this.dirT < 1) {
      const F = this.dirFrom;
      const span = F.pos.distanceTo(D.pos);
      const base = Math.min(6, span * 0.18);
      const tun = this.nearTunnel(g.track, g.p.z);
      // vom Startkran in die Fahrkamera: im Bogen um den Fahrer herum (auf der Seite, wo der Kran schon steht) statt
      // geradewegs durch ihn oder die Leute am Start; Abstand und Höhe gleiten dabei vom Kran- zum Fahrkamera-Wert
      const orbit = this.dirFromKind === 'intro' && this.dirKind === 'chase';
      const C = orbit ? this.riderAt(g, this.orbC, 1.0) : null;
      if (this.flyArc < 0 && tun) this.flyArc = 0;
      if (this.flyArc < 0) {
        // Bogen so hoch, dass der Flug über Hang und Bäume geht (Gelände entlang der Bahn geprüft)
        let arc = 0;
        for (let i = 1; i < 12; i++) {
          const k = i / 12;
          const s = Math.sin(Math.PI * k);
          const P = C ? this.orbitAt(C, F.pos, D.pos, k, this.orbP) : null;
          const x = P ? P.x : F.pos.x + (D.pos.x - F.pos.x) * k, z = P ? P.z : F.pos.z + (D.pos.z - F.pos.z) * k;
          const y = (P ? P.y : F.pos.y + (D.pos.y - F.pos.y) * k) + s * (C ? ORBIT_LIFT : base);
          const h = this.hAt(x, z) + 2.2;
          if (h > y) arc = Math.max(arc, (h - y) / Math.max(0.3, s));
        }
        this.flyArc = Math.min(arc, 30);
      }
      // (Zeitschritt begrenzt: nach einem langen Bild fliegt die Kamera weiter, statt zu springen)
      this.dirT = Math.min(1, this.dirT + Math.min(Math.max(dt, 0), 1 / 30) / this.dirDur);
      const u = this.dirT;
      const k = u * u * u * (u * (u * 6 - 15) + 10);
      if (C) {
        this.orbitAt(C, F.pos, D.pos, k, A.pos);
        A.pos.y += Math.sin(Math.PI * k) * (ORBIT_LIFT + this.flyArc);
      } else {
        A.pos.lerpVectors(F.pos, D.pos, k);
        // im Bogen fliegen (nicht durch den Hang)
        A.pos.y += Math.sin(Math.PI * k) * (base + this.flyArc);
      }
      if (!tun) {
        // freie Sicht auf den Fahrer auch unterwegs (der Bogen hebt sich weich, wenn ein Grat dazwischen kommt)
        const R = this.riderAt(g, this.tvR, 1.0);
        const need = this.needLift(A.pos.x, A.pos.y, A.pos.z, R.x, R.y, R.z, 1.0, 8) * Math.sin(Math.PI * Math.min(1, k * 1.15));
        this.flyLift += (need - this.flyLift) * Math.min(1, Math.min(Math.max(dt, 0), 1 / 30) * (need > this.flyLift ? 5 : 2));
        A.pos.y += this.flyLift;
      }
      A.look.lerpVectors(F.look, D.look, k);
      // unterwegs den Fahrer im Bild behalten (sonst schaut die Kamera in der Mitte des Flugs auf den Asphalt);
      // im Bogen vom Kran steht er ohnehin in der Mitte – nur halb so stark (sonst blickt sie steil hinab)
      if (this.dirKind !== 'intro') A.look.lerp(this.riderAt(g, this.tvR, 1.0), Math.sin(Math.PI * k) * (C ? 0.5 : 0.85));
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

  /** steht o (Weltpunkt) zwischen Kamera und dem Ziel (Draufsicht, Streifen gut 1 m breit)? */
  private screens(o: { x: number; z: number }, target: THREE.Vector3): boolean {
    const c = this.camera.position;
    const dx = target.x - c.x, dz = target.z - c.z;
    const L2 = dx * dx + dz * dz || 1;
    const k = ((o.x - c.x) * dx + (o.z - c.z) * dz) / L2;
    if (k <= 0.04 || k >= 0.96) return false;
    const qx = c.x + dx * k - o.x, qz = c.z + dz * k - o.z;
    return qx * qx + qz * qz < 1.2 * 1.2;
  }

  private orbC = new THREE.Vector3();
  private orbP = new THREE.Vector3();
  /**
   * Punkt auf dem Bogen um C (Fahrer) von F nach D bei k (0–1): Winkel um die Senkrechte auf dem kürzeren Weg,
   * Abstand und Höhe linear – die Kamera umrundet den Fahrer, statt durch ihn hindurchzufliegen
   */
  private orbitAt(C: THREE.Vector3, F: THREE.Vector3, D: THREE.Vector3, k: number, out: THREE.Vector3): THREE.Vector3 {
    const fx = F.x - C.x, fz = F.z - C.z, dx = D.x - C.x, dz = D.z - C.z;
    const rf = Math.hypot(fx, fz), rd = Math.hypot(dx, dz);
    const af = Math.atan2(fx, fz);
    let da = Math.atan2(dx, dz) - af;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const a = af + da * k;
    // in der Mitte deutlich näher heran (und oben drüber, ORBIT_LIFT): der Kran schwenkt über den Fahrer hinweg,
    // nicht seitlich hinaus zu Fotografen, Absperrungen und Zuschauern
    const r = (rf + (rd - rf) * k) * (1 - 0.4 * Math.sin(Math.PI * k));
    return out.set(C.x + Math.sin(a) * r, F.y + (D.y - F.y) * k, C.z + Math.cos(a) * r);
  }

  /** Ort des Fahrers in der Welt (Körpermitte) */
  private riderAt(g: RaceView, out: THREE.Vector3, up = 1.0): THREE.Vector3 {
    g.track.world(g.p.z, g.p.x, 0, this.tvV);
    return out.set(this.tvV.x, this.tvV.y + up, this.tvV.z);
  }

  /** Blick weich auf den Fahrer (die TV-Kamera schwenkt mit wie ein Kameramann) */
  private follow(target: THREE.Vector3, dt: number): THREE.Vector3 {
    if (!this.lookOk) { this.lookS.copy(target); this.lookOk = true; }
    this.lookS.lerp(target, dt > 0 ? Math.min(1, dt * 5) : 1);
    return this.lookS;
  }

  /** Tunnel im Bereich hinter bis kurz vor dem Fahrer (dort keine Geländeprüfung der Kamera) */
  private nearTunnel(t: Track, z: number): boolean {
    const i0 = Math.max(t.first, Math.floor((z - CAM_BACK - 14) / SEG)), i1 = Math.floor((z + 16) / SEG);
    for (let i = i0; i <= i1; i++) if (t.seg(i).tunnel) return true;
    return false;
  }

  /** Geländehöhe für die Kamera (Rechenbereich um die Kamera, neu erst nach einem Stück Weg) */
  private camReg: { r: Region; x: number; z: number } | null = null;
  private camH(x: number, z: number): number {
    const T = this.terrain;
    if (!T) return -Infinity;
    let c = this.camReg;
    if (!c || Math.abs(x - c.x) > 70 || Math.abs(z - c.z) > 70) c = this.camReg = { r: T.region(x - 100, z - 100, x + 100, z + 100), x, z };
    return T.heightIn(c.r, x, z);
  }

  /** Strecke, um die herum die Kamera Höhen sucht (Fahrer oder Sturz) */
  private hNear = 0;
  private hW = { x: 0, y: 0, z: 0, th: 0 };
  private hT = { z: 0, x: 0 };
  /** Weltpunkt → Strecke z und Querlage x (nächster Punkt der Straße bis 26 m um hNear) */
  private toTrack(t: Track, x: number, z: number): { z: number; x: number } {
    const w = this.hW;
    let best = Infinity, bz = this.hNear;
    for (let d = -26; d <= 26; d += 2) {
      const zz = Math.max(0, this.hNear + d);
      t.world(zz, 0, 0, w);
      const q = (w.x - x) ** 2 + (w.z - z) ** 2;
      if (q < best) { best = q; bz = zz; }
    }
    // (Ausgangspunkt ist der grobe Treffer: ohne genaueren blieb sonst der Wert der vorigen Anfrage stehen – nach
    // einem Neustart der vom Ziel, 3 km entfernt; der Startkran stand dann Hunderte Meter über der Rampe)
    this.hT.z = bz;
    for (let d = -1; d <= 1; d += 0.25) {
      const zz = Math.max(0, bz + d);
      t.world(zz, 0, 0, w);
      const q = (w.x - x) ** 2 + (w.z - z) ** 2;
      if (q < best) { best = q; this.hT.z = zz; }
    }
    t.world(this.hT.z, 0, 0, w);
    this.hT.x = (x - w.x) * Math.cos(w.th) + (z - w.z) * Math.sin(w.th);
    return this.hT;
  }

  /** Höhe der sichtbaren Oberfläche an Strecke z, Querlage x: Fahrbahn, Querprofil (Böschung, Mauer), dahinter Gelände */
  private surfAt(t: Track, z: number, x: number): number {
    const i = Math.max(t.first, Math.floor(z / SEG));
    const s = t.seg(i);
    const e = t.extra(i);
    const dx = Math.abs(x) - e - EDGE;
    if (dx <= 0 || s.tunnel || s.bridge > 0) return t.heightAt(z);
    const sg = x < 0 ? -1 : 1;
    const side = sg < 0 ? s.L : s.R;
    const lim = this.terrain ? this.terrain.lim(i)[sg < 0 ? 0 : 1] - e : LIM_MAX;
    const gh = this.groundAt(side, s, sg, dx, lim);
    if (gh !== null) return t.heightAt(i * SEG) + gh;
    t.world(z, x, 0, this.hW);
    return this.camH(this.hW.x, this.hW.z);
  }

  /** Höhe der sichtbaren Oberfläche an einem Weltpunkt nahe der Straße (um hNear) */
  private hAt(x: number, z: number): number {
    const t = this.track;
    if (!t) return -Infinity;
    const q = this.toTrack(t, x, z);
    return this.surfAt(t, q.z, q.x);
  }

  /**
   * Wie viel muss die Kamera höher, damit sie über dem Gelände steht (mind. up) und das Ziel frei sieht?
   * Gelände entlang der Sichtlinie (n Proben); obs: zusätzlich Bäume als Zylinder.
   */
  private needLift(px: number, py: number, pz: number, tx: number, ty: number, tz: number, up: number, n = 10, obs: { x: number; z: number; r: number; top: number }[] | null = null): number {
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

  /** Bäume in einem Rechteck als Hindernisse (Zylinder) für die Sturzkamera */
  private obstacles(x0: number, z0: number, x1: number, z1: number): { x: number; z: number; r: number; top: number }[] {
    const out: { x: number; z: number; r: number; top: number }[] = [];
    for (const s of this.treeSrc) {
      if (!s.on) continue;
      const b = s.box;
      if (b[2] < x0 || b[0] > x1 || b[3] < z0 || b[1] > z1) continue;
      for (let k = 0; k < s.n; k++) {
        const o = k * TREC;
        const x = s.rec[o], z = s.rec[o + 2];
        if (x < x0 || x > x1 || z < z0 || z > z1) continue;
        const sc = s.rec[o + 3];
        out.push({ x, z, r: 1.6 * sc, top: s.rec[o + 1] + 12 * sc });
      }
    }
    return out;
  }

  private shotPose(g: RaceView, kind: 'intro' | 'crash', out: { pos: THREE.Vector3; look: THREE.Vector3; fov: number }, dt: number) {
    const t = g.track;
    const p = g.p;
    const R = this.riderAt(g, new THREE.Vector3(), 1.0);
    const portrait = this.W < this.H;
    const time = this.time.value;
    if (kind === 'intro') {
      // TV-Kran vor dem Start (Startmenü): schräg hinter und über dem Fahrer, pendelt langsam; Blick auf dich und
      // über dich hinweg (je Spiel MENU_TT, MENU_DESC, MENU_FIN)
      t.world(p.z, 0, 0, this.tvV);
      const th = this.tvV.th;
      const fin = t.kind === 'sprint' || t.kind === 'mountain';
      const tt = t.kind === 'tt';
      const M = this.menuCam ?? (fin ? MENU_FIN : tt ? MENU_TT : MENU_DESC);
      const ang = (p.x > 0 ? -1 : 1) * (M.ang + M.swing * Math.sin(time * 0.17));
      const fx = Math.sin(th + ang), fz = -Math.cos(th + ang);
      const x = R.x + fx * M.r, z = R.z + fz * M.r;
      const y = Math.max(R.y + M.up + 0.3 * Math.sin(time * 0.11), this.hAt(x, z) + 1.8);
      out.pos.set(x, y, z);
      out.look.set(R.x + Math.sin(th) * M.ahead, R.y + M.lookY, R.z - Math.cos(th) * M.ahead);
      out.fov = portrait ? M.fov : 38;
      return;
    }
    // Sturz: Fernsehbild vom Straßenrand hinter dem Sturz, Blick die Straße hinunter auf den Haufen – die
    // Nachfolgenden fahren an der Kamera vorbei hinein; langsam näher heran
    if (!this.crashCam) {
      const at0 = g.pileAt ?? { z: p.z, x: p.x };
      // Finals (ein einzelner Sturz): dort hinschauen, wo der Fahrer liegen bleiben wird – er fliegt und rutscht an
      // der Kamera vorbei; in der Abfahrt auf den Haufen (die Nachfolgenden fahren hinein)
      const at = t.kind !== 'descent' && g.wreck ? { z: g.wreck.z0 + wreckTravel({ t: 30, v0: g.wreck.v0 }).s * 0.85, x: g.wreck.x0 } : at0;
      const pref = at.x > 0 ? -1 : 1;
      this.hNear = at.z;
      // Standort am Rand hinter dem Sturz: nicht unter einem Baum, nicht hinter Hang oder Mauer und mit freier Sicht
      // auf den Haufen; im Tunnel an der Wand der Röhre
      t.world(at.z, at.x, 0, this.tvV);
      const tx = this.tvV.x, ty = this.tvV.y + 0.5, tz = this.tvV.z;
      const tun = t.segAt(at.z).tunnel || t.segAt(Math.max(0, at.z - 9)).tunnel;
      const obs = tun ? [] : this.obstacles(tx - 30, tz - 30, tx + 30, tz + 30);
      let best: THREE.Vector3 | null = null;
      for (const [side, back, up] of [[pref, 9, 2.3], [-pref, 9, 2.3], [pref, 14, 3.2], [-pref, 14, 3.2], [pref, 6, 4.5]] as const) {
        const cz = Math.max(0, at.z - back);
        // auf dem Bankett, gleich neben der Randlinie (dahinter stehen Felsen, Büsche, Pfosten im Bild)
        const cx = side * (tun ? ROAD_HALF + 0.3 : ROAD_HALF + t.extraAt(cz) + 0.55);
        t.world(cz, cx, 0, this.tvV);
        const y = tun ? t.heightAt(cz) + 2.2 : Math.max(t.heightAt(cz) + up, this.surfAt(t, cz, cx) + 1.6);
        const cand = new THREE.Vector3(this.tvV.x, y, this.tvV.z);
        best ??= cand;
        if (tun) break;
        const inTree = obs.some((o) => (o.x - cand.x) ** 2 + (o.z - cand.z) ** 2 < (o.r + 0.8) ** 2 && y < o.top + 1);
        if (!inTree && this.needLift(cand.x, cand.y, cand.z, tx, ty, tz, 0, 8, obs) < 0.3) { best = cand; break; }
      }
      this.crashCam = best;
    }
    out.pos.copy(this.crashCam!);
    // Blick auf den Körper (die Ragdoll liegt nicht immer genau dort, wo die Spiellogik den Fahrer führt)
    const doll = this.dolls.get(-1);
    const L = doll && g.wreck && doll.w === g.wreck
      ? this.tvR.set(doll.d.p[0], doll.d.p[1] + 0.15, doll.d.p[2])
      : this.riderAt(g, new THREE.Vector3(), 0.45);
    out.look.copy(this.follow(L, dt));
    const d = out.pos.distanceTo(L);
    const push = clamp((g.wreck ? g.wreck.t : g.phaseT) / 4, 0, 1);
    // Bildhöhe am Ziel: in der Abfahrt der ganze Haufen, in den Finals näher an den einen Gestürzten
    const half = t.kind === 'descent' ? (portrait ? 9 : 6.5) - 2 * push : (portrait ? 6.5 : 5) - 1.6 * push;
    out.fov = clamp((2 * Math.atan(half / d) * 180) / Math.PI, 12, 60);
  }

  private updateEnvironment(biome: BiomeId, dt: number) {
    const cp = this.camera.position;
    this.sky.position.copy(cp);
    this.valley.position.set(cp.x, cp.y - 1400, cp.z);
    this.peakU.uNoise.value ??= this.noiseMap;
    // neue Landschaft: ihre Berge entstehen über einige Bilder (ein Ring je Schritt), dann überblenden
    // zurück in die Landschaft, deren Berge schon stehen: angefangenen Bau verwerfen
    // (fertig gebaut, aber noch beim Hochladen: zählt schon als die neue Landschaft)
    const waitB = this.mtnWait?.biome;
    const dropWait = () => { if (this.mtnWait) { this.mtnWait.m.geometry.dispose(); (this.mtnWait.m.material as THREE.Material).dispose(); this.mtnWait = null; } };
    if (biome === this.mtnBiome) {
      // PC-Grafik: steht erst die einfache Fassung, kommt die feine derselben Landschaft in Schritten hinterher
      const upgrade = this.pc && !!this.mtn && !isPcPeaks(this.mtn);
      if (!upgrade) {
        this.mtnGen = null;
        dropWait();
      } else {
        if (this.mtnWait && this.mtnWait.biome !== biome) dropWait();
        if (this.mtnGen && this.mtnGen.biome !== biome) this.mtnGen = null;
        if (!this.mtnGen && !this.mtnWait) this.mtnGen = { biome, it: buildPeaksSteps(biome, this.peakU, true) };
      }
    } else if (this.mtnGen?.biome !== biome && waitB !== biome) {
      this.mtnGen = this.mtn ? { biome, it: buildPeaksSteps(biome, this.peakU, this.pc) } : null;
      dropWait();
      if (!this.mtn) {
        // (zuerst immer die einfache Fassung sofort – die feine braucht zu lange für ein Bild)
        this.mtn = buildPeaks(biome, this.peakU);
        this.scene.add(this.mtn);
        this.mtnFade = 1;
        this.mtnBiome = biome;
      }
    }
    if (this.mtnGen && !this.calm) {
      const t0 = performance.now();
      // vor dem Start (niemand fährt) großzügiger: die feinen Berge stehen dann, bevor es losgeht
      const budget = this.debugPeakMs ?? (this.idleBuild ? Math.max(1.2, this.idleMs(8)) : 1.2);
      let r = this.mtnGen.it.next();
      while (!r.done && performance.now() - t0 < budget) r = this.mtnGen.it.next();
      if (r.done) {
        // erst hochladen (gut 0,7 MB), dann überblenden
        const w = { m: r.value, biome: this.mtnGen.biome, ready: this.idleBuild };
        this.mtnWait = w;
        this.mtnGen = null;
        if (!w.ready) this.stage([w.m], () => { w.ready = true; }, () => this.mtnWait === w);
      }
    }
    if (this.mtnWait?.ready && !this.calm) {
      this.prof?.event(EV.mtn, `Berge am Horizont getauscht (${this.mtnWait.biome})`);
      if (this.mtnOld) { this.scene.remove(this.mtnOld); this.mtnOld.geometry.dispose(); (this.mtnOld.material as THREE.Material).dispose(); }
      this.mtnOld = this.mtn;
      this.mtn = this.mtnWait.m;
      this.scene.add(this.mtn);
      this.mtnFade = 0;
      this.mtnBiome = this.mtnWait.biome;
      this.mtnWait = null;
    }
    this.mtnFade = Math.min(1, this.mtnFade + dt / 2.5);
    if (this.pc) this.peakSun(dt);
    for (const [m, a] of [[this.mtn, this.mtnFade], [this.mtnOld, 1 - this.mtnFade]] as [THREE.Mesh | null, number][]) {
      if (!m) continue;
      this.seasonPeak(m);
      m.position.set(cp.x, cp.y - 240, cp.z);
      setPeakOpacity(m, a);
      m.visible = a > 0.01;
    }
    if (this.mtnFade >= 1 && this.mtnOld) {
      this.scene.remove(this.mtnOld);
      this.mtnOld.geometry.dispose();
      (this.mtnOld.material as THREE.Material).dispose();
      this.mtnOld = null;
    }
  }

  /**
   * PC-Grafik: Schlagschatten der feinen Berge der Sonne nachführen. Ist sie um gut ein Grad gewandert, wird in
   * Schritten neu gerechnet (nicht im ruhigen Auftakt der Abfahrt) und dann über zwei Sekunden überblendet.
   */
  private peakSun(dt: number) {
    const m = this.mtn;
    if (this.mtnSunFade) {
      const u = (this.mtnSunFade.material as THREE.ShaderMaterial).uniforms.uSunMix;
      u.value = Math.min(1, u.value + dt / 2);
      if (u.value >= 1) this.mtnSunFade = null;
    }
    if (this.mtnSun && this.mtnSun.m !== m) this.mtnSun = null;
    if (!m || !isPcPeaks(m) || this.calm) return;
    if (!this.mtnSun) {
      const at = m.userData.sunAt as THREE.Vector3;
      if (at.angleTo(this.peakU.uSunDir.value) < 0.021) return;
      this.mtnSun = { m, it: peakSunUpdate(m, this.peakU.uSunDir.value) };
    }
    const t0 = performance.now();
    let r = this.mtnSun.it.next();
    while (!r.done && performance.now() - t0 < (this.debugPeakMs ?? (this.idleBuild ? Math.max(1, this.idleMs(6)) : 1))) r = this.mtnSun.it.next();
    if (r.done) {
      this.mtnSun = null;
      if (r.value) this.mtnSunFade = m;
    }
  }

  // ------------------------------------------------------------------ Abschnitte

  /** Abschnitt im Bau (in Schritten) */
  private chunkGen: { k: number; it: Generator<void, Chunk, void>; cpu: number; frames: number } | null = null;
  /** Zeitgrenze für den Bau in Häppchen (performance.now(); Infinity: am Stück) */
  private deadline = Infinity;
  /** Beginn des Bauens in diesem Bild */
  private dlStart = 0;
  private late(): boolean {
    return this.deadline !== Infinity && performance.now() > this.deadline;
  }
  /**
   * Reicht der Rest des Budgets nicht für etwas, das etwa ms dauert (neue Schrift malen, Haus, großes Teil)? Dann erst
   * im nächsten Bild beginnen – nie gleich zu Beginn des Bauens im Bild, sonst ginge es nicht voran.
   */
  private soon(ms: number): boolean {
    if (this.deadline === Infinity) return false;
    const now = performance.now();
    if (now - this.dlStart > 0.25 && now + ms > this.deadline) {
      // für dieses Bild Schluss (der Bau gibt ab, die Schleife ruft ihn nicht gleich wieder auf)
      this.deadline = 0;
      return true;
    }
    return false;
  }

  /** Abschnitte, die gerade ein- oder ausgeblendet werden */
  private cFades: { c: Chunk; a: number; dur: number; out: boolean }[] = [];
  /** ersetzte Abschnitte (z. B. neue Bestmarken-Bögen): bleiben stehen, bis der Nachfolger eingeblendet ist */
  private chunkOld = new Map<number, Chunk>();

  /**
   * fertigen Abschnitt einsetzen; fade: weich einblenden (ein ersetzter Vorgänger blendet gegengleich aus).
   * wait: braucht er neue Shader, erscheint er erst, wenn sie fertig übersetzt sind (im Hintergrund) – sonst
   * stockte das erste Bild mit ihm, bis der Grafiktreiber fertig ist.
   */
  private addChunk(k: number, c: Chunk, fade: boolean, wait = false) {
    appearifyTree(c.group);
    this.chunks.set(k, c);
    this.scene.add(c.group);
    const show = () => {
      const old = this.chunkOld.get(k);
      if (old) {
        this.chunkOld.delete(k);
        this.fadeChunk(old, true);
        fade = true;
      }
      if (fade) this.fadeChunk(c, false);
    };
    const w = wait ? this.warmUp(c.group) : null;
    // im Hintergrund gebaut: erst zeigen, wenn auch die Geometrie (portionsweise) auf der Grafikkarte ist
    // (sichtbare Startkarte: auch dort portionsweise – sonst stockt das Bild beim ersten Zeichnen)
    const up = wait && (!this.idleBuild || this.idleK < 1);
    if (w || up) {
      c.group.visible = false;
      const e = { w, show, staged: !up };
      this.chunkWarm.set(c, e);
      if (up) this.stage([c.group], () => { e.staged = true; });
      return;
    }
    show();
  }

  /** Abschnitte, deren Shader noch übersetzt werden oder die noch hochgeladen werden (unsichtbar bis dahin) */
  private chunkWarm = new Map<Chunk, { w: Warm | null; show: () => void; staged: boolean }>();

  private updateChunkWarm(cur: number) {
    for (const [c, e] of this.chunkWarm) {
      // gleich unter dem Fahrer: nicht länger warten
      const urgent = c.idx <= cur + 1;
      if (!urgent && (!e.staged || (e.w && this.warmPending(e.w)))) continue;
      this.chunkWarm.delete(c);
      if (this.chunks.get(c.idx) !== c) continue;
      c.group.visible = true;
      e.show();
    }
  }

  /** Wasserfälle: strömendes Wasser (Farbe und Deckkraft je Ecke, folgt den Übergängen zu den gröberen Stufen) */
  private fallMaterial(): THREE.MeshLambertMaterial {
    if (!this.fallMat) {
      // beidseitig in einem Durchgang (sonst zeichnet three.js durchsichtige Flächen zweimal und baut das Material jedes Mal neu auf)
      const m = new THREE.MeshLambertMaterial({ map: waterTexture(), vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, emissive: new THREE.Color(0.3, 0.31, 0.32) });
      const mU = this.morphU[1];
      const mU0 = this.morphU[0];
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uMorph = mU;
        sh.uniforms.uMorph0 = mU0;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>\nattribute float aAlpha;\nattribute vec2 aDy;\nuniform vec4 uMorph;\nuniform vec4 uMorph0;\nvarying float vAlpha;\n${FALL_MORPH}`)
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;\ntransformed.y += fallMorph(position, aDy);');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
          .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vAlpha;')
          // Eigenleuchten nur so hell wie das Wasser selbst: weiße Gischt strahlt, dunkles Bachwasser bleibt dunkel
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= diffuseColor.rgb;');
      };
      m.customProgramCacheKey = () => 'falls-water2';
      this.fallMat = m;
    }
    return this.fallMat;
  }

  /** Gischt über den Aufschlägen: Wolken, die sich zur Kamera drehen, aufsteigen, wachsen und vergehen */
  private mistMaterial(): THREE.MeshLambertMaterial {
    if (!this.mistMat) {
      const m = new THREE.MeshLambertMaterial({ map: mistTexture(), transparent: true, depthWrite: false, color: new THREE.Color(0.95, 0.97, 1), emissive: new THREE.Color(0.16, 0.17, 0.18) });
      const mU = this.morphU[1];
      const mU0 = this.morphU[0];
      const T = this.time;
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uMorph = mU;
        sh.uniforms.uMorph0 = mU0;
        sh.uniforms.uTime = T;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>\nattribute vec2 aCorner;\nattribute vec4 aMist;\nattribute vec2 aDy;\nuniform vec4 uMorph;\nuniform vec4 uMorph0;\nuniform float uTime;\nvarying float vMistA;\n${FALL_MORPH}`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            float mt = fract(uTime * 0.16 + aMist.x);
            transformed.y += aMist.z * mt + fallMorph(position, aDy);
            vMistA = aMist.w * sin(3.14159 * mt);`)
          .replace('#include <project_vertex>', `#include <project_vertex>
            float mAng = aMist.x * 6.2832 + mt * 0.7;
            vec2 mCor = mat2(cos(mAng), sin(mAng), -sin(mAng), cos(mAng)) * aCorner;
            mvPosition.xy += mCor * aMist.y * (0.55 + 0.75 * mt) * 0.5;
            gl_Position = projectionMatrix * mvPosition;`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vMistA;')
          .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vMistA;');
      };
      m.customProgramCacheKey = () => 'falls-mist';
      this.mistMat = m;
    }
    return this.mistMat;
  }

  /**
   * Einmal zu Beginn (Startkarte): die Shader aller Dinge der Strecke anstoßen – Dörfer, Tunnel, Pflaster, Seen,
   * Schilder, Wasserfälle. Der Grafiktreiber übersetzt sie im Hintergrund; sonst stockte das Spiel beim ersten
   * Dorf oder Tunnel für einen Moment.
   */
  private warmGroup: THREE.Group | null = null;
  private warmAll() {
    const g = new THREE.Group();
    // Ob die Geometrie Normalen hat, gehört zum Shader (three.js r186): je Material die passende Sorte
    const geo = new THREE.PlaneGeometry(1, 1);
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const noNormals = new Set<THREE.Material>([this.mats.tunWall, this.mats.tunRoad, this.mats.tunMarks, this.bbMat, this.sprMat, this.markMat]);
    const tex = this.noiseMap;
    // Beschriftungen (Malereien, Schilder, Tafeln, Bögen) entstehen erst unterwegs – je Art ein Stellvertreter
    const labels: THREE.Material[] = [
      new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, opacity: 0.9 }),
      new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }),
      new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }),
      new THREE.MeshLambertMaterial({ map: tex }),
      new THREE.MeshLambertMaterial({ color: 0x9aa0a8 }),
    ];
    const mats: THREE.Material[] = [...Object.values(this.mats), ...this.terrMats, ...this.waterMats, this.markMat, this.crowdMat, this.sprMat, this.bbMat, this.fallMaterial(), this.mistMaterial(), ...labels];
    // Jahreszeit in der Luft (season3d.ts): ein Shader für Laub, Schnee und Blüten
    g.add(new THREE.Points(pgeo, this.air.material));
    g.add(new THREE.Points(pgeo, this.smokeMat));
    for (const m of mats) {
      if (!(m as THREE.ShaderMaterial).isShaderMaterial) appearify(m);
      if ((m as THREE.PointsMaterial).isPointsMaterial) { g.add(new THREE.Points(pgeo, m)); continue; }
      g.add(new THREE.Mesh(noNormals.has(m) ? pgeo : geo, m));
    }
    // Fahrer als Bilder (ihr Shader wird gebraucht, sobald der Vorrat fertig ist – auch mitten im Rennen)
    g.add(new THREE.Mesh(this.rs.mesh.geometry, this.rs.mesh.material));
    // Alpenhäuser (Dörfer, Höfe)
    for (const o of this.houses.warmObjects()) g.add(o);
    // Halos der Laternen, Sonnenuntergangs-Licht
    g.add(warmLamps());
    // PC-Gras
    if (this.pc) { this.grassMat ??= grassMaterial(this.time); g.add(grassWarm(this.grassMat)); }
    g.add(new THREE.Mesh(this.sunset.mesh.geometry, this.sunset.mesh.material));
    if (!this.houses.group.parent) this.scene.add(this.houses.group);
    // Berge am Horizont: beide Spielarten am Leben halten (Landschaftswechsel tauscht ihr Material)
    this.peakU.uNoise.value ??= this.noiseMap;
    for (const m of peakKeepers(this.peakU, this.pc)) g.add(new THREE.Mesh(geo, m));
    // Requisiten: je Art ein Zeichenaufruf mit eigener Farbe je Exemplar
    const im = new THREE.InstancedMesh(geo, this.mats.props, 1);
    im.receiveShadow = true;
    im.castShadow = true;
    im.setColorAt(0, new THREE.Color());
    g.add(im);
    // Gegner und Geister: ihre Shader (deckend und durchsichtig, mit Ein-/Ausblenden) entstanden sonst erst, wenn der
    // erste auftauchte – im Zeitfahren beim Öffnen des Spiels (die Geister der Runde), unter der Startanimation ein
    // Stocken von mehreren Programmen. Je ein Stellvertreter (deckend, durchsichtig) im Probezug unten.
    const solid = new RiderModel(LOOKS[0], this.shadowTex, this.pc ? 1 : 0);
    appearifyTree(solid.group);
    const ghost = new RiderModel(LOOKS[0], this.shadowTex, this.pc ? 1 : 0);
    appearifyTree(ghost.group);
    ghost.prepareFade();
    ghost.fade(0.5, 1);
    g.add(solid.group, ghost.group);
    // Vögel, Flieger, Hubschrauber; Blitze der Fotografen an den Startaufbauten (dieselben Einstellungen wie dort –
    // ein Programm, eine Pipeline; ein eigenes Material, das mit keinem Startaufbau weggeworfen wird)
    for (const o of this.skyLife.warmObjects()) g.add(o);
    g.add(new THREE.Sprite(new THREE.SpriteMaterial({ map: this.mats.lampGlow.map, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })));
    this.warmUp(g);
    // alles, was schon in der Szene hängt, aber noch nie zu sehen war (Startrampe mit Blitzen der Fotografen,
    // Vögel und Flieger am Himmel …): Shader jetzt statt beim ersten Auftauchen
    this.warmUp(this.scene);
    // ihre Texturen gleich mit hochladen (Fassaden-Atlas, Werbebanden, Böden …): sonst kämen sie erst beim ersten
    // Dorf oder der ersten Bande auf die Grafikkarte – bis 8 MB in einem Bild
    const all: THREE.Material[] = [];
    g.traverse((o) => { const m = (o as THREE.Mesh).material; if (m) all.push(...(Array.isArray(m) ? m : [m])); });
    this.uploadShared(all);
    // (nicht wegwerfen: sonst gäbe three.js die eben übersetzten Programme wieder frei)
    this.warmGroup = g;
    // … und alle einmal wirklich zeichnen (Probezug, unten)
    this.warmQueue = [...g.children];
    warmRoadText();
  }

  /**
   * Probezug: die vorgewärmten Stellvertreter einmal wirklich zeichnen – unsichtbar, tief unter der Welt, aber in
   * der echten Szene mit ihrem Licht, Nebel und Ziel (Schattenkarte, Wetterbild oder Leinwand). compile() übersetzt
   * nur die Shader; Metal legt je Programm × Ziel × Geometrie-Layout erst beim ersten Zeichnen seine Pipeline an –
   * 10–40 ms, unterwegs ein Ruckler je neuem Stück („pipe“ in der Messfahrt, Version 269: fünf von sieben Rucklern).
   * Ein paar je Bild auf der Startkarte (unter der Startanimation viele) und nach dem Ziel; im Countdown (die Kamera
   * schwenkt) und während der Fahrt nie
   */
  private warmQueue: THREE.Object3D[] = [];
  private warmLive: THREE.Object3D[] = [];
  private warmStep(phase: string) {
    for (const o of this.warmLive) { this.scene.remove(o); this.warmGroup?.add(o); }
    this.warmLive = [];
    // (nicht im Countdown: dort schwenkt die Kamera – ein neues Programm kostet beim ersten Zeichnen 10–40 ms)
    if (!this.warmQueue.length || phase === 'playing' || phase === 'countdown' || !this.warmGroup) return;
    // unter der Startanimation (idleK fast 1, nichts zu sehen) mehr je Bild
    const n = Math.min(this.idleK > 0.9 ? 12 : 4, this.warmQueue.length);
    for (let i = 0; i < n; i++) {
      const o = this.warmQueue.shift()!;
      o.position.set(0, -5000, 0);
      o.traverse((x) => {
        x.frustumCulled = false;
        const m = x as THREE.Mesh;
        if (!m.isMesh && !(x as THREE.InstancedMesh).isInstancedMesh) return;
        const mat = m.material as THREE.Material;
        // wie flagShadows (weather.ts): feste Körper werfen Schatten – so entsteht auch der Tiefen-Durchgang je Layout
        m.receiveShadow = true;
        m.castShadow = !!mat && !(mat as THREE.ShaderMaterial).isShaderMaterial && !mat.transparent;
      });
      this.scene.add(o);
      this.warmLive.push(o);
    }
    if (!this.warmQueue.length) this.prof?.event(EV.probe, 'Probezug fertig: alle Stellvertreter einmal gezeichnet');
  }

  /**
   * Kennung, was den Shader eines Objekts bestimmt (ungefähr wie three.js' Programmschlüssel, aber billig): schon
   * gesehene Kombinationen brauchen kein compile() – das kostet je Objekt Rechenzeit, auch wenn nichts Neues entsteht
   */
  private progSeen = new Set<string>();
  private progSig(o: THREE.Object3D, m: THREE.Material): string {
    const mm = m as THREE.Material & { map?: unknown; emissiveMap?: unknown; vertexColors?: boolean; flatShading?: boolean };
    const oo = o as THREE.Object3D & { isInstancedMesh?: boolean; isPoints?: boolean; instanceColor?: unknown; geometry?: THREE.BufferGeometry };
    const at = oo.geometry?.attributes;
    return `${m.type}|${m.customProgramCacheKey().length > 200 ? m.uuid : m.customProgramCacheKey()}|${!!mm.map}|${!!mm.emissiveMap}|${!!mm.vertexColors}|${m.transparent}|${m.alphaTest > 0}|${m.side}|${!!mm.flatShading}|${m.alphaToCoverage}|${!!oo.isInstancedMesh}|${!!oo.isPoints}|${!!oo.instanceColor}|${!!at?.normal}|${at?.color?.itemSize ?? 0}`;
  }

  /** Arbeit des Grafiktreibers (Shader) für neue Objekte vorab anstoßen */
  private parallel: boolean | null = null;
  private warmUp(o: THREE.Object3D): Warm | null {
    let fresh = false;
    o.traverse((x) => {
      const ms = (x as THREE.Mesh).material;
      if (!ms) return;
      for (const m of Array.isArray(ms) ? ms : [ms]) {
        const k = this.progSig(x, m);
        if (this.progSeen.has(k)) continue;
        this.progSeen.add(k);
        fresh = true;
      }
    });
    if (!fresh) return null;
    const info = this.gl.info.programs;
    const n0 = info ? info.length : 0;
    this.gl.compile(o, this.camera, this.scene);
    const list = info ? info.slice(n0) : [];
    if (!list.length) return null;
    this.parallel ??= !!this.gl.extensions.get('KHR_parallel_shader_compile');
    // ohne Rückmeldung des Treibers: nicht warten (sonst bliebe es unsichtbar)
    if (!this.parallel) return null;
    return { progs: list, t: performance.now() };
  }

  /** true, solange noch ein Shader übersetzt wird (höchstens 4 s) */
  private warmPending(w: Warm): boolean {
    if (performance.now() - w.t > 4000) return false;
    w.progs = w.progs.filter((p) => !(p as { isReady?: () => boolean }).isReady?.());
    return w.progs.length > 0;
  }

  // ------------------------------------------------------------------ Vorab hochladen

  /**
   * Neue Teile (Kacheln, Abschnitte, Berge der nächsten Landschaft) kommen vorab in Portionen auf die Grafikkarte,
   * bevor sie sichtbar werden. Sonst lud das erste Bild mit ihnen alles auf einmal hoch – ein Kachelring gut 1 MB,
   * ein Abschnitt mit Zuschauern bis über 2 MB –, ein Ruckler, den kein Zeitbudget sieht. Dafür „zeichnet“ three.js
   * Stellvertreter mit unsichtbarem Material: Es lädt dabei ihre Geometrie hoch, gezeichnet wird nichts.
   */
  private upQ: UpJob[] = [];
  private upScene = new THREE.Scene();
  private upMat = new THREE.MeshBasicMaterial({ visible: false });
  private upMesh: THREE.Mesh[] = [];
  /** schon hochgeladene Geometrien und Texturen */
  private upSeen = new WeakSet<object>();

  /** Teile zum Vorab-Hochladen anmelden; done() kommt, sobald alles oben ist (alive: noch gebraucht?) */
  private stage(roots: THREE.Object3D[], done: () => void, alive: () => boolean = () => roots.every((r) => r.parent !== null)) {
    const objs: THREE.Object3D[] = [];
    const tex = new Set<THREE.Texture>();
    for (const r of roots) {
      r.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.geometry || !(m.isMesh || (o as THREE.Points).isPoints)) return;
        objs.push(o);
        for (const mt of Array.isArray(m.material) ? m.material : [m.material]) if (mt) texturesOf(mt, tex);
      });
    }
    this.upQ.push({ objs, tex: [...tex], i: 0, ti: 0, ai: 0, alive, done });
  }

  /** je Bild (nach dem Zeichnen) eine Portion hochladen; auf der Startkarte alles auf einmal */
  private updateStaging() {
    if (!this.upQ.length) return;
    const budget = this.idleBuild ? (this.idleK >= 1 ? Infinity : UP_BYTES * (this.uiMoves ? 2 : 8)) : UP_BYTES;
    let bytes = 0;
    let nm = 0;
    while (this.upQ.length && bytes < budget) {
      const job = this.upQ[0];
      if (!job.alive()) { this.upQ.shift(); continue; }
      while (job.ti < job.tex.length && bytes < budget) {
        const t = job.tex[job.ti++];
        if (this.upSeen.has(t)) continue;
        this.upSeen.add(t);
        const img = t.image as { width?: number; height?: number } | null;
        bytes += (img?.width ?? 0) * (img?.height ?? 0) * 4;
        this.gl.initTexture(t);
      }
      // je Eigenschaft der Geometrie einzeln (eine Landschaftskachel hat gut 600 kB in 13 Eigenschaften – am Stück
      // ging das in einem Bild hoch, und das Bild kam zu spät): ein Stellvertreter mit nur dieser Eigenschaft
      while (job.i < job.objs.length && bytes < budget) {
        const geo = (job.objs[job.i] as THREE.Mesh).geometry;
        if (this.upSeen.has(geo)) { job.i++; job.ai = 0; continue; }
        const names = Object.keys(geo.attributes);
        while (job.ai < names.length && bytes < budget) {
          const at = geo.attributes[names[job.ai++]] as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
          const key: object = (at as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (at as THREE.InterleavedBufferAttribute).data : at;
          if (this.upSeen.has(key)) continue;
          this.upSeen.add(key);
          bytes += ((key as { array: ArrayBufferView }).array).byteLength;
          let p = this.upMesh[nm];
          if (!p) { p = new THREE.Mesh(new THREE.BufferGeometry(), this.upMat); p.frustumCulled = false; this.upMesh.push(p); this.upScene.add(p); }
          p.geometry.attributes = { a: at };
          p.visible = true;
          nm += 1;
        }
        if (job.ai >= names.length) { this.upSeen.add(geo); job.i++; job.ai = 0; }
      }
      if (job.ti >= job.tex.length && job.i >= job.objs.length) { this.upQ.shift(); job.done(); }
    }
    if (nm) {
      const ac = this.gl.autoClear;
      this.gl.autoClear = false;
      this.gl.render(this.upScene, this.camera);
      this.gl.autoClear = ac;
      // nichts festhalten (die Eigenschaften gehören den Teilen)
      for (let k = 0; k < nm; k++) { this.upMesh[k].geometry.attributes = {}; this.upMesh[k].visible = false; }
    }
  }

  /** gemeinsame Texturen (Atlanten, Böden, Fassaden) beim Start hochladen – sonst erst beim ersten Dorf (bis 8 MB auf einmal) */
  private uploadShared(mats: THREE.Material[]) {
    const tex = new Set<THREE.Texture>();
    for (const m of mats) texturesOf(m, tex);
    for (const t of tex) {
      if (this.upSeen.has(t)) continue;
      this.upSeen.add(t);
      this.gl.initTexture(t);
    }
  }

  private fadeChunk(c: Chunk, out: boolean) {
    this.cFades = this.cFades.filter((f) => f.c !== c);
    setAp(c.group, out ? apOut(0) : apIn(0));
    this.cFades.push({ c, a: 0, dur: out ? 0.6 : 0.9, out });
  }

  private dropChunk(c: Chunk) {
    this.cFades = this.cFades.filter((f) => f.c !== c);
    this.scene.remove(c.group);
    // freigeben erst nach und nach (siehe updateDispose)
    this.dispQ.push(c.dispose);
  }

  private updateChunkFades(dt: number) {
    for (const f of [...this.cFades]) {
      f.a = Math.min(1, f.a + dt / f.dur);
      if (f.a < 1) { setAp(f.c.group, f.out ? apOut(f.a) : apIn(f.a)); continue; }
      if (f.out) this.dropChunk(f.c);
      else { setAp(f.c.group, undefined); this.cFades.splice(this.cFades.indexOf(f), 1); }
    }
  }

  private updateChunks(g: RaceView, dt: number) {
    const z = g.p.z;
    const from = Math.max(0, Math.floor((z - BEHIND) / SEG / CH));
    const to = Math.floor((z + AHEAD) / SEG / CH);
    this.updateChunkFades(dt);
    for (const [k, c] of this.chunks) {
      if (k < from || k > to + 1) {
        this.chunks.delete(k);
        // hinter der Kamera weich ausblenden (in Kehren sieht man zurück), sonst sofort
        if (k < from) this.fadeChunk(c, true);
        else this.dropChunk(c);
      }
    }
    for (const [k, c] of this.chunkOld) {
      if (k < from || k > to + 1) { this.chunkOld.delete(k); this.dropChunk(c); }
    }
    if (this.chunkGen && (this.chunkGen.k < from || this.chunkGen.k > to + 1)) this.chunkGen = null;
    // beim Start alles auf einmal (die Straße muss im ersten Bild stehen)
    if (this.chunks.size === 0) {
      this.chunkGen = null;
      const t0 = performance.now();
      for (let k = from; k <= to; k++) this.addChunk(k, this.buildChunk(g, k), false);
      this.prof?.event(EV.sync, `alle Abschnitte ${from}–${to} am Stück gebaut: ${(performance.now() - t0).toFixed(1)} ms`);
      return;
    }
    // der Abschnitt unter dem Fahrer und der nächste müssen stehen (z. B. nach einem Sprung): sofort bauen
    const cur = Math.floor(z / SEG / CH);
    this.updateChunkWarm(cur);
    for (let k = Math.max(from, cur); k <= Math.min(to, cur + 1); k++) {
      if (this.chunks.has(k)) continue;
      if (this.chunkGen?.k === k) this.chunkGen = null;
      const t0 = performance.now();
      this.addChunk(k, this.buildChunk(g, k), false);
      this.prof?.event(EV.sync, `Abschnitt ${k} (${Math.round(k * CH * SEG)} m) sofort gebaut: ${(performance.now() - t0).toFixed(1)} ms`);
    }
    // erster Panoramablick (Auftakt der Abfahrt): nichts weiter bauen – alles Nötige steht schon
    if (this.calm) return;
    // danach mit Zeitbudget je Bild (nächste zuerst), auf der Startkarte großzügiger; der Bau gibt an der
    // Zeitgrenze von selbst ab (feine Häppchen)
    const t0 = performance.now();
    let budget = this.idleBuild ? Math.max(0.8, this.idleMs(12)) : Math.max(0.8, Math.min(this.range.chunkBudget, this.room() * 0.38));
    // knapp vor dem Fahrer fehlt noch etwas: dann zügig (sonst müsste es gleich am Stück entstehen – ein Ruckler)
    {
      let k = from;
      while (k <= to && this.chunks.has(k)) k++;
      if (k <= cur + 3) budget = Math.max(budget, 2.5);
    }
    this.deadline = t0 + budget;
    this.dlStart = t0;
    let tl = t0;
    while (performance.now() < this.deadline) {
      if (!this.chunkGen) {
        let k = from;
        while (k <= to && this.chunks.has(k)) k++;
        if (k > to) break;
        this.chunkGen = { k, it: this.chunkSteps(g, k), cpu: 0, frames: 0 };
      }
      const r = this.chunkGen.it.next();
      if (r.done) {
        // weit voraus fertig: weich einblenden (in Kehren liegt er oft schon im Bild)
        this.addChunk(this.chunkGen.k, r.value, true, true);
        const now = performance.now();
        const cg = this.chunkGen;
        this.prof?.event(EV.chunk, `Abschnitt ${cg.k} (${Math.round(cg.k * CH * SEG)} m) fertig: ${(cg.cpu + now - tl).toFixed(1)} ms in ${cg.frames + 1} Bildern`);
        tl = now;
        this.chunkGen = null;
      }
    }
    if (this.chunkGen) { this.chunkGen.cpu += performance.now() - tl; this.chunkGen.frames++; }
    this.deadline = Infinity;
  }

  private row(z: number, seg: Seg): Row {
    // (ohne Relief: das kommt je Punkt quer dazu, siehe P in chunkSteps)
    const w = this.track!.world(z, 0, 0, this.w, true);
    return { x: w.x, y: w.y, z: w.z, rx: Math.cos(w.th), rz: Math.sin(w.th), th: w.th, seg, e: this.track!.extra(seg.i), m: z };
  }

  /**
   * Requisiten je Art (Bäume, Felsen, Zäune …) als InstancedMesh – wiederverwendet statt freigegeben: three.js
   * durchsucht beim Freigeben eines InstancedMesh die Zustände aller Geometrien (bei einem Abschnitt mit mehreren
   * Arten zusammen über 10 ms).
   */
  private imPool = new Map<Prop3D, THREE.InstancedMesh[]>();
  private takeIM(kind: Prop3D, geo: THREE.BufferGeometry, n: number): THREE.InstancedMesh {
    const list = this.imPool.get(kind);
    let im: THREE.InstancedMesh | undefined;
    if (list) {
      const i = list.findIndex((x) => x.instanceMatrix.count >= n);
      if (i >= 0) im = list.splice(i, 1)[0];
    }
    if (!im) {
      let cap = 16;
      while (cap < n) cap *= 2;
      im = new THREE.InstancedMesh(geo, this.mats.props, cap);
      im.castShadow = true;
      im.receiveShadow = true;
      im.userData.kind = kind;
    }
    im.count = n;
    return im;
  }
  private giveIM(im: THREE.InstancedMesh) {
    const kind = im.userData.kind as Prop3D | undefined;
    if (!kind) { im.dispose(); return; }
    im.removeFromParent();
    let list = this.imPool.get(kind);
    if (!list) { list = []; this.imPool.set(kind, list); }
    list.push(im);
  }

  /** Abschnitt in einem Zug bauen (beim Start) */
  private buildChunk(g: RaceView, ci: number): Chunk {
    const it = this.chunkSteps(g, ci);
    for (;;) {
      const r = it.next();
      if (r.done) return r.value;
    }
  }

  /**
   * Abschnitt bauen, in Schritten (alle paar Straßenstücke eine Pause): beim Fahren verteilt sich die Arbeit
   * auf mehrere Bilder, statt eines spürbar zu verlängern
   */
  private *chunkSteps(g: RaceView, ci: number): Generator<void, Chunk, void> {
    const t = this.track!;
    const i0 = ci * CH;
    const rows: Row[] = [];
    for (let r = 0; r <= CH; r++) rows.push(this.row((i0 + r) * SEG, t.seg(i0 + r)));
    // P: alles ab dem Fahrbahnrand (Randlinie, Bankett, Gelände, Begrenzungen) rückt mit der Breite nach außen;
    // P0: unverschoben (Mitte der Fahrbahn: Schriften, Schachtdeckel)
    // Höhe mit dem Relief der Fahrbahn (Dach, Querneigung, Wellen; daneben läuft es aus) – alles folgt ihm
    const P0 = (r: Row, x: number, h: number): number[] => [r.x + r.rx * x, r.y + h + t.lift(r.m, x), r.z + r.rz * x];
    const P = (r: Row, x: number, h: number): number[] => { const xx = widen(x, r.e); return [r.x + r.rx * xx, r.y + h + t.lift(r.m, xx), r.z + r.rz * xx]; };
    // Korridor (Gelände) ab dem verschobenen Bankett gemessen: um die Mehrbreite kürzer
    const lim = { L: [] as number[], R: [] as number[] };
    for (let r = 0; r <= CH; r++) { const [l, rr] = this.terrain!.lim(i0 + r); lim.L.push(l - rows[r].e); lim.R.push(rr - rows[r].e); }
    if (this.late()) yield;
    // Rechenbereich der Landschaft für diesen Abschnitt (Requisiten außerhalb des Korridors, Portale)
    let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
    for (const r of rows) { bx0 = Math.min(bx0, r.x); bz0 = Math.min(bz0, r.z); bx1 = Math.max(bx1, r.x); bz1 = Math.max(bz1, r.z); }
    const region = this.terrain!.region(bx0 - 90, bz0 - 90, bx1 + 90, bz1 + 90);
    if (this.late()) yield;
    this.region = region;
    const group = new THREE.Group();
    const disp: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
    const surf: Record<string, GB> = { asphalt: new GB(), fresh: new GB(), cobble: new GB(), gravel: new GB() };
    for (const b of Object.values(surf)) b.uv = true;
    const verge = new GB();
    verge.uv = true;
    verge.xa = true;
    // Böden der Orte: zwei Gehwege (je Ort einer), Bordstein, Rinne, Schachtdeckel und Abläufe
    const walk = new GB();
    walk.uv = true;
    walk.xa = true;
    const walk2 = new GB();
    walk2.uv = true;
    walk2.xa = true;
    const curb = new GB();
    curb.uv = true;
    const gutter = new GB();
    gutter.uv = true;
    const covers = new GB();
    covers.uv = true;
    const ground: PaveGB = { walk, walk2, curb, gutter, covers };
    this.paveGB = ground;
    const marks = new GB();
    const terr = new GB();
    terr.uv = true;
    const portal = new GB();
    const bar = new GB();
    const water = new GB();
    const tunWall = new TB();
    const tunRoad = new TB();
    const tunMarks = new TB();
    // Strecke in der Röhre ab einem Vielfachen des Leuchtenabstands kurz vor dem Abschnitt (kleine Zahlen)
    tunWall.base = tunRoad.base = tunMarks.base = Math.floor((i0 * SEG) / 60) * 60;
    const tunSigns = new GB();
    tunSigns.uv = true;
    const mas = new GB();
    mas.uv = true;
    const facade = new GB();
    facade.uv = true;
    const roof = new GB();
    const tiles = new GB();
    tiles.uv = true;
    const signGB = new GB();
    signGB.uv = true;
    const fans = new GB();
    fans.uv = true;
    const detailGB = new GB();
    const town: Town = { facade, tiles, plain: roof, signs: signGB, lanterns: [], bulbs: [], detail: detailGB, occ: [], stone: mas, smoke: [] };
    let detail: Detail | null = null;
    const bill = new GB();
    bill.uv = true;
    const ads = new GB();
    ads.uv = true;
    this.adsGB = ads;
    const anim: number[] = [];
    const glows: number[] = [];
    const people: Person[][] = [[], [], [], [], [], [], [], []];
    const inst = new Map<Prop3D, { m: THREE.Matrix4[]; c: THREE.Color[] }>();
    this.cTrees = [];
    const cTrees = this.cTrees;
    const white = lin('#f2f2ec');
    const wBase = Math.floor((i0 * SEG) / 4096) * 4096;
    const sec = (s: Seg) => t.sections[s.sec];
    // nach einer Pause: zwischendurch kann ein anderer Abschnitt gebaut worden sein – gemeinsamen Bauzustand zurück
    const resume = () => { this.region = region; this.adsGB = ads; this.cTrees = cTrees; };

    for (let r = 0; r < CH; r++) {
      const a = rows[r];
      const b = rows[r + 1];
      const s = a.seg;
      const za = (i0 + r) * SEG;
      const zb = za + SEG;
      // --- Fahrbahn
      if (!s.tunnel) {
        const tl = this.gsz[s.surface] ?? 5;
        // Texturkoordinaten ab einem ganzzahligen Versatz je Abschnitt: kleine Zahlen bleiben auf Handys genau
        const vo = Math.floor((i0 * SEG) / tl);
        const va = za / tl - vo;
        const vb = zb / tl - vo;
        // breitere oder engere Stelle: die Textur bleibt in Metern (nicht gestreckt)
        const ha = ROAD_HALF + a.e;
        const hb = ROAD_HALF + b.e;
        // Straßenmeter je Ecke (für Flicken, Risse, Fahrspuren und den bröckelnden Rand im Shader, als aRoad statt
        // der ungenutzten Farbe): quer ab dem linken Rand der Normalbreite, längs ab einem Vielfachen von 4096 m
        // (kleine Zahlen), dazu die Mehrbreite (wo der Rand liegt)
        const za0 = za - wBase, zb0 = zb - wBase;
        const da = EDGE - GUTTER_W - ROAD_HALF;
        const town = (sg: number) => { const x = sg < 0 ? s.L : s.R; const y = sg < 0 ? b.seg.L : b.seg.R; return x.ground === 'pavement' && y.ground === 'pavement' && !(s.bridge > 0); };
        const pl = town(-1) ? da : 0, pr = town(1) ? da : 0;
        // Ränder: die Asphaltkante schwankt (asphEdge), wo kein Gehweg ist
        const wLa = this.asphEdge(a, -1), wRa = this.asphEdge(a, 1), wLb = this.asphEdge(b, -1), wRb = this.asphEdge(b, 1);
        const nx = t.seg(s.i + 1);
        // Fahrbahn in Spalten quer: das Relief (Dach, Querneigung, Wellen, Spurrinnen) braucht Punkte über die Breite.
        // Wechselt der Belag (alt – neu – Pflaster – Schotter), läuft die Grenze nicht als Lineal quer über die Straße,
        // sondern unregelmäßig innerhalb dieses Stücks (je Spalte ein eigener Abstand, weich verbunden).
        // (Immer gleich viele Spalten an gleicher Stelle: die Kanten der Nachbarstücke treffen sich ohne Ritzen.)
        const change = !(nx.tunnel || nx.surface === s.surface || !surf[nx.surface]);
        const N = ROAD_COLS;
        const tlB = change ? this.gsz[nx.surface] ?? 5 : tl;
        const voB = Math.floor((i0 * SEG) / tlB);
        const fq: number[] = [];
        for (let c = 0; c <= N; c++) fq.push(change ? Math.max(0.08, Math.min(0.92, 0.5 + along(c, s.i * 7 + 3, 1.6) * 0.9 + (hash(s.i * 41 + c * 13) - 0.5) * 0.18)) : 1);
        const xl = (wl: number, wr: number, hh: number, f: number) => -hh - wl + (2 * hh + wl + wr) * f;
        const rl = (r: Row, wl: number, wr: number, f: number) => -r.e - wl + (2 * ROAD_HALF + 2 * r.e + wl + wr) * f;
        const cA: number[][] = [], cB: number[][] = [];
        for (let c = 0; c <= N; c++) { cA.push(P0(a, xl(wLa, wRa, ha, c / N), 0)); cB.push(P0(b, xl(wLb, wRb, hb, c / N), 0)); }
        const pt = (c: number, q: number) => {
          const A = cA[c], B = cB[c];
          return q <= 0 ? A : q >= 1 ? B : [A[0] + (B[0] - A[0]) * q, A[1] + (B[1] - A[1]) * q, A[2] + (B[2] - A[2]) * q];
        };
        const ro = (f: number, q: number): RGBf => {
          const xa = rl(a, wLa, wRa, f), xb = rl(b, wLb, wRb, f);
          const ea = a.e + pl + (pr - pl) * f, eb = b.e + pl + (pr - pl) * f;
          return [xa + (xb - xa) * q, za0 + (zb0 - za0) * q, ea + (eb - ea) * q];
        };
        const uvA = (f: number, q: number, tt: number, vo2: number) => {
          const lat = xl(wLa, wRa, ha, f) * (1 - q) + xl(wLb, wRb, hb, f) * q;
          return [lat / tt, (za + (zb - za) * q) / tt - vo2];
        };
        for (let c = 0; c < N; c++) {
          const f0 = c / N, f1 = (c + 1) / N;
          const q0 = fq[c], q1 = fq[c + 1];
          surf[s.surface].quadC(pt(c, 0), pt(c + 1, 0), pt(c + 1, q1), pt(c, q0), ro(f0, 0), ro(f1, 0), ro(f1, q1), ro(f0, q0),
            [uvA(f0, 0, tl, vo), uvA(f1, 0, tl, vo), uvA(f1, q1, tl, vo), uvA(f0, q0, tl, vo)]);
          if (change) {
            surf[nx.surface].quadC(pt(c, q0), pt(c + 1, q1), pt(c + 1, 1), pt(c, 1), ro(f0, q0), ro(f1, q1), ro(f1, 1), ro(f0, 1),
              [uvA(f0, q0, tlB, voB), uvA(f1, q1, tlB, voB), uvA(f1, 1, tlB, voB), uvA(f0, 1, tlB, voB)]);
          }
        }
        for (const sg of [-1, 1]) {
          if (town(sg)) {
            // im Ort: die Fahrbahn reicht bis zur Rinne (gleicher Belag), dann die Rinne vor dem Bordstein
            const xg = EDGE - GUTTER_W;
            const ua = sg * (ha + da) / tl, ub = sg * (hb + da) / tl;
            const ra0 = sg < 0 ? -a.e - da : 2 * ROAD_HALF + a.e, ra1 = sg < 0 ? -a.e : 2 * ROAD_HALF + a.e + da;
            const rb0 = sg < 0 ? -b.e - da : 2 * ROAD_HALF + b.e, rb1 = sg < 0 ? -b.e : 2 * ROAD_HALF + b.e + da;
            const L0a = P(a, sg < 0 ? -xg : ROAD_HALF, 0), L1a = P(a, sg < 0 ? -ROAD_HALF : xg, 0);
            const L0b = P(b, sg < 0 ? -xg : ROAD_HALF, 0), L1b = P(b, sg < 0 ? -ROAD_HALF : xg, 0);
            const uL = sg < 0 ? [ua, -ha / tl] : [ha / tl, ua], uLb = sg < 0 ? [ub, -hb / tl] : [hb / tl, ub];
            surf[s.surface].quadC(L0a, L1a, L1b, L0b, [ra0, za0, a.e + da], [ra1, za0, a.e + da], [rb1, zb0, b.e + da], [rb0, zb0, b.e + da],
              [[uL[0], va], [uL[1], va], [uLb[1], vb], [uLb[0], vb]]);
            const gs = this.gsz.gutter;
            const go = Math.floor((i0 * SEG) / gs);
            this.profQuads(gutter, a, b, sg, P, GUTTER_PROF, GUTTER_PROF, za / gs - go, zb / gs - go);
          } else {
            this.vergeStrip(verge, marks, a, b, sg, P, za, zb, i0);
          }
        }
        // Markierungen
        const lines = s.surface === 'asphalt' || s.surface === 'fresh';
        const village = sec(s).biome === 'village';
        const H = 0.012;
        const strip = (x0: number, x1: number, col: RGBf) => marks.quad(P(a, x0, H), P(a, x1, H), P(b, x1, H), P(b, x0, H), col);
        if (lines || s.tunnel) {
          if (!village) { strip(-ROAD_HALF + 0.08, -ROAD_HALF + 0.2, white); strip(ROAD_HALF - 0.2, ROAD_HALF - 0.08, white); }
          if (Math.abs(s.curve) > 0.015 || s.hairpin) { strip(-0.17, -0.06, white); strip(0.06, 0.17, white); }
          else if ((s.i & 3) < 2) strip(-0.06, 0.06, white);
        }
      }
      // --- Gelände (auf einem Viadukt: Bogenbrücke statt Böschung, unten ein Bach)
      if (s.bridge > 0) {
        this.bridgeSide(mas, water, a, b, P);
      } else if (!s.tunnel) {
        for (const sg of [-1, 1]) this.terrainSide(terr, mas, a, b, sg, P, sg < 0 ? lim.L[r] : lim.R[r], sg < 0 ? lim.L[r + 1] : lim.R[r + 1]);
      } else {
        const [t0, t1, len] = this.tunnelOf(s.i);
        const zs = t0 * SEG;
        const ze = (t1 + 1) * SEG;
        tunnelRing(tunWall, tunRoad, tunMarks, tunSigns, a, b, P, {
          za, zb, dpa: Math.min(za - zs, ze - za), dpb: Math.min(zb - zs, ze - zb), lamp: s.lamp, len,
        });
      }
      // --- Begrenzungen
      this.barriers(bar, ads, a, b, P);
      // --- Malereien (eine neue Schrift zu malen dauert: dann erst am Anfang des nächsten Bildes)
      if (s.decals) {
        for (const d of s.decals) {
          if ((d.k === 'text' || d.k === 'arrow') && !this.labelTex.has(`${d.k}:${d.text}`) && this.soon(2)) { yield; resume(); }
          this.decal(group, disp, marks, rows, r, d, P0);
        }
      }
      // --- Schachtdeckel, Abläufe, Schieberkappen (im Ort dicht, auf dem Land selten)
      if (!s.tunnel && !(s.bridge > 0)) this.coverDecals(covers, a, b, s);
      // --- Häuser (je Haus viele Teile: auch erst mit frischem Budget)
      for (const sg of [-1, 1]) {
        const bld = sg < 0 ? s.bL : s.bR;
        if (bld && bld.start === s.i) {
          if (this.soon(2)) { yield; resume(); }
          yield* this.building(town, a, bld, sg, sg < 0 ? lim.L[r] : lim.R[r], resume);
        }
      }
      // Wimpel- und Lichterketten quer über die Gasse
      if (s.bL && s.bR && s.i % 17 === 9 && !s.banner && !this.fanNear(s.i)) this.garland(town, a, s.bL, s.bR);
      // --- feste Zuschauergruppen am Rand (abseits der Zuschauerzonen; alle als Bilder)
      if (!s.crowd && !s.tunnel && !(s.bridge > 0) && !s.portal && !s.bL && !s.bR) {
        for (const sg of [-1, 1]) {
          const hg = hash(s.i * 2 + (sg > 0 ? 1 : 0) + 7919);
          if (hg >= GROUP_P) continue;
          const side = sg < 0 ? s.L : s.R;
          if (!GROUP_GROUND.has(side.ground) || side.drop || side.wall > 0) continue;
          this.crowdGroup(people[Math.min(7, Math.floor(r / 5))], s, sg, sg < 0 ? lim.L[r] : lim.R[r], Math.floor(hash(s.i * 13 + 5) * GROUPS.length));
        }
      }
      // --- Sprites/Requisiten (Zuschauer: viele Menschen je Stück – nach jedem nachsehen)
      if (s.sprites) {
        for (const sp of s.sprites) {
          if (this.markClear.length && this.inMark(s.i, sp.x)) continue;
          const l = sp.x < 0 ? lim.L[r] : lim.R[r];
          if (sp.k === 'crowd') this.crowdPeople(people[Math.min(7, Math.floor(r / 5))], s, sp.x < 0 ? -1 : 1, l, sp.v, Math.abs(sp.x) - EDGE);
          else this.prop(group, disp, inst, bill, anim, glows, a, sp, s, l);
          if (this.late()) { yield; resume(); }
        }
      }
      // --- Banner, Portal (Schriftzug: erst mit frischem Budget)
      if (s.banner) {
        const k = s.banner.kind;
        if (this.soon(2)) { yield; resume(); }
        if (k === 'gate') this.gate(town, group, disp, a, s.banner.text);
        else this.arch(group, disp, a, s.banner, k === 'gpm' || k === 'finish' || k === 'start' ? this.accent : k === 'sprint' ? '#1f6feb' : k === 'flamme' ? '#d63031' : k === 'split' ? '#ffd23f' : '#ffffff');
      }
      // Wahrzeichen des Schauplatzes (Arc de Triomphe, Eiffelturm, Sacré-Cœur)
      const vm = this.marks.get(s.i);
      if (vm) for (const m of vm) { if (this.soon(2)) { yield; resume(); } this.buildMark(town, m); }
      // Fan-Bogen mit Spruchband (nicht dort, wo die Bestmarke eines Freundes steht)
      const fan = this.fanAt(s.i);
      if (fan !== null && !g.friends.some((f) => Math.abs(Math.floor(f.meters / SEG) - s.i) <= 7)) this.fanArch(fans, roof, a, fan);
      for (const f of g.friends) {
        if (Math.floor(f.meters / SEG) !== s.i) continue;
        if (this.soon(2)) { yield; resume(); }
        this.arch(group, disp, a, { kind: 'arch', text: f.userId === 'me' ? 'Deine Bestmarke' : `Bestmarke ${f.name}`, sub: fmtKm(f.meters) }, f.color);
      }
      if (s.portal) {
        // Portal in Häppchen (die Felswand braucht viele Höhenabfragen)
        yield* this.portalSteps(portal, mas, roof, group, disp, s.portal === 1 ? a : b, P, sec(s).biome, s.portal === 1 ? 1 : -1);
        resume();
      }
      if (this.late()) { yield; resume(); }
    }
    yield;
    resume();
    // Dörfer (Häuserzeilen, Kirche, Dorfplatz, Laternen) und Höfe am Hang – nur in der Abfahrt
    let vgb: GB | null = null;
    if (this.villages) {
      const z0 = i0 * SEG, z1 = (i0 + CH) * SEG;
      const vp = yield* this.villages.buildRange(z0, z1, () => this.late());
      resume();
      if (vp) {
        if (!vp.gb.empty) vgb = vp.gb;
        glows.push(...vp.lights);
        for (const tr of vp.trees) {
          const [cr, cg, cb] = treeTint(1, hash(Math.round(tr.x)), hash(Math.round(tr.z)));
          cTrees.push(tr.x, tr.y - 0.05, tr.z, tr.s, tr.rot, cr, cg, cb, treeVariant(tr.kind, hash(Math.round(tr.x * 3))), 0);
        }
        if (vp.sign) {
          const ri = Math.min(CH - 1, Math.max(0, Math.floor(vp.sign.at / SEG) - i0));
          // Ortsschild rechts am Eingang (Querlage wie bei Normalbreite – prop rückt es mit der Breite nach außen)
          const sp = { k: 'townSign', x: EDGE + 1.7, h: 0, s: 1, v: 0, text: vp.sign.text, f: false } as Sprite;
          this.prop(group, disp, inst, bill, anim, glows, rows[ri], sp, rows[ri].seg, lim.R[ri]);
        }
      }
      yield* this.houses.addFarms({
        track: t, terrain: this.terrain!, roadDist: (x, z) => this.roadDistAt(x, z), occ: this.villages.occ,
        countTrees: (x, z, r) => this.countTrees(x, z, r), clearTrees: (x, z, r) => this.clearTrees(x, z, r),
      }, z0, z1, () => this.late());
      resume();
    }

    const add = (gb: GB, m: THREE.Material, order = 0, cast = false) => {
      if (gb.empty) return;
      const geo = gb.build();
      disp.push(geo);
      const mesh = new THREE.Mesh(geo, m);
      mesh.renderOrder = order;
      mesh.receiveShadow = true;
      mesh.castShadow = cast;
      group.add(mesh);
    };
    // Zusammenbau in Häppchen: nach jedem Teil nachsehen, ob die Zeit des Bildes um ist
    // Fahrbahn: die Eckfarbe trägt die Straßenmeter (aRoad)
    const addRoad = (gb: GB, m: THREE.Material) => {
      if (gb.empty) return;
      // Normalen aus dem Relief (weich, im Licht verstärkt): Dach, Wellen und Querneigung zeichnen sich ab
      const geo = gb.build(false);
      this.roadNormals(geo, wBase);
      geo.setAttribute('aRoad', geo.getAttribute('color'));
      geo.deleteAttribute('color');
      disp.push(geo);
      const mesh = new THREE.Mesh(geo, m);
      mesh.receiveShadow = true;
      group.add(mesh);
    };
    const parts: (() => void)[] = [
      () => addRoad(surf.asphalt, this.mats.asphalt),
      () => addRoad(surf.fresh, this.mats.fresh),
      () => addRoad(surf.cobble, this.mats.cobble),
      () => addRoad(surf.gravel, this.mats.gravel),
      () => add(verge, this.mats.verge),
      () => add(walk, this.mats.walk),
      () => add(walk2, this.mats.walk2),
      () => add(curb, this.mats.curb),
      () => add(gutter, this.mats.gutter),
      // Deckel und Markierungen vor der Fahrbahn (dank Tiefenversatz bleiben sie oben): der Tiefentest verwirft dann
      // die teure Fahrbahn unter ihnen, statt sie zu rechnen und zu übermalen
      () => add(covers, this.mats.covers, -1),
      () => add(marks, this.mats.marks, -1),
      // Gelände neben der Straße weich schattiert (keine harten Kanten zwischen den Bändern)
      () => {
        if (terr.empty) return;
        const geo = terr.buildSmooth(null);
        disp.push(geo);
        const mesh = new THREE.Mesh(geo, this.mats.terrain);
        mesh.receiveShadow = true;
        group.add(mesh);
      },
      () => add(portal, this.mats.portal, 0, true),
      () => add(bar, this.mats.barrier, 0, true),
      () => add(water, this.mats.water, 2),
      () => {
        for (const [tb, m] of [[tunWall, this.mats.tunWall], [tunRoad, this.mats.tunRoad], [tunMarks, this.mats.tunMarks]] as [TB, THREE.Material][]) {
          if (tb.empty) continue;
          const geo = tb.build();
          disp.push(geo);
          group.add(new THREE.Mesh(geo, m));
        }
      },
      () => add(tunSigns, this.mats.tunSign),
      () => add(mas, this.mats.masonry, 0, true),
      () => add(facade, this.mats.facade, 0, true),
      () => add(roof, this.mats.roof, 0, true),
      () => add(tiles, this.mats.tiles, 0, true),
      () => {
        if (detailGB.empty) return;
        const geo = detailGB.build();
        disp.push(geo);
        const mesh = new THREE.Mesh(geo, this.mats.roof);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        group.add(mesh);
        const bs = geo.boundingSphere!;
        detail = { mesh, c: bs.center.clone(), r: bs.radius };
      },
      () => add(signGB, this.mats.sign, 0),
      () => { if (vgb) add(vgb, this.mats.roof, 0, true); },
      () => add(ads, this.mats.ads, 0, true),
      () => { if (this.fanMat) add(fans, this.fanMat, 0, true); },
    ];
    // Zuschauer nur auf gebautem Boden (Bankett, Hang, Gehweg): wer darüber schwebt (Brückenanfang, Mauer, Piazza
    // tiefer als das Querprofil), fällt weg, kleine Abstände rücken auf den Boden; Schilder erst danach (vor dem
    // Bau der Werbenetze, in die sie gehören)
    if (this.soon(2)) yield;
    resume();
    this.groundPeople(people, [terr, verge, walk, walk2, curb, gutter]);
    for (const f of parts) {
      // großes Teil nicht erst kurz vor Schluss des Budgets beginnen
      if (this.soon(1)) yield;
      f();
      if (this.late()) yield;
    }
    if (!bill.empty) {
      const geo = bill.build();
      geo.setAttribute('aAnim', new THREE.Float32BufferAttribute(anim, 3));
      disp.push(geo);
      group.add(new THREE.Mesh(geo, this.mats.billboard));
    }
    // Bäume am Straßenrand: Bilder in einem Zeichenaufruf (die eigene Liste – nicht this.cTrees: dazwischen kann
    // ein anderer Abschnitt gebaut worden sein)
    const ct = cTrees;
    this.cTrees = null;
    let csrc: TreeSource | null = null;
    let cbm: THREE.Mesh | null = null;
    if (ct && ct.length) {
      const n = ct.length / TREC;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < n; k++) { x0 = Math.min(x0, ct[k * TREC]); x1 = Math.max(x1, ct[k * TREC]); z0 = Math.min(z0, ct[k * TREC + 2]); z1 = Math.max(z1, ct[k * TREC + 2]); }
      csrc = { box: [x0, z0, x1, z1], rec: new Float32Array(ct), n, on: true };
      for (let k = 0; k < n; k++) if (this.treeBlocked(csrc.rec[k * TREC], csrc.rec[k * TREC + 2])) csrc.rec[k * TREC + 3] = 0;
      const cbg = treeBillboards(csrc, this.treeAtlas);
      this.bbOf.set(csrc, cbg);
      cbm = new THREE.Mesh(cbg, this.bbMat);
      if (this.bbDepth) { cbm.customDepthMaterial = this.bbDepth; cbm.castShadow = true; }
      group.add(cbm);
      this.treeSrc.add(csrc);
    }
    for (const [kind, list] of inst) {
      if (this.late()) yield;
      const geo = this.props[kind];
      if (!geo) continue;
      // aus dem Vorrat (ein InstancedMesh freizugeben kostet in three.js viel Zeit, siehe takeIM)
      const im = this.takeIM(kind, geo, list.m.length);
      list.m.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, list.c[i]); });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      group.add(im);
    }
    const crowd: CrowdBatch[] = [];
    const crowdGeos: THREE.BufferGeometry[] = [];
    const sprGeos: THREE.BufferGeometry[] = [];
    const sphereOf = (list: Person[]) => {
      const c = new THREE.Vector3();
      for (const pp of list) { c.x += pp.x; c.y += pp.y; c.z += pp.z; }
      c.divideScalar(list.length);
      let rad = 0;
      for (const pp of list) rad = Math.max(rad, Math.hypot(pp.x - c.x, pp.y - c.y, pp.z - c.z));
      return { c, rad };
    };
    // 3D-Menschen in Gruppen je 10 m: so laufen nur für Menschen nahe der Kamera die feinen Netze durch den
    // Shader (der je Person nach Abstand ausblendet – aber erst nach der Arbeit je Ecke); Bilder je 20 m
    for (let pi = 0; pi < people.length; pi++) {
      const list = people[pi];
      if (!list.length) continue;
      if (this.late()) yield;
      const { c, rad } = sphereOf(list);
      const sphere = new THREE.Sphere(c, rad + 4);
      // Bilder: beide 10-m-Hälften zusammen (die zweite Hälfte verweist auf dasselbe Netz)
      const pair = pi % 2 === 0 ? [...list, ...people[pi + 1]] : [...people[pi - 1], ...list];
      const sp = sphereOf(pair);
      const batch: CrowdBatch = { near: [], mid: [], spr: null, c, r: rad, sc: sp.c, sr: sp.rad, lod: -1 };
      void sphere;
      // alle als Bilder in einem Zeichenaufruf (je 20 m; die erste Hälfte baut es, die zweite teilt es) – auch nah:
      // keine 3D-Menschen mehr (spart je Abschnitt viele Netze und Zeichenaufrufe; Platz für viel mehr Zuschauer)
      if (pi % 2 === 0 || !people[pi - 1].length) {
        const sg = spriteGeometry(pair);
        sg.boundingSphere = new THREE.Sphere(sp.c, sp.rad + 4);
        sprGeos.push(sg);
        const sm = new THREE.Mesh(sg, this.sprMat);
        sm.visible = false;
        sm.userData.noShadow = true;
        group.add(sm);
        batch.spr = sm;
      } else batch.spr = crowd[crowd.length - 1].spr;
      crowd.push(batch);
    }
    // Laternen: Halo je Lampe (heller Kern, warmer Hof); ihre Köpfe werfen den Lichtkegel auf den Boden (pickLamps)
    let glow: THREE.Mesh | null = null;
    const lamps = glows.length ? new Float32Array(glows) : null;
    if (glows.length) {
      glow = lampHalos(glows);
      if (glow) { disp.push(glow.geometry); group.add(glow); }
    }
    for (const [pts, mat] of [[town.lanterns, this.mats.lantern], [town.bulbs, this.mats.bulb]] as const) {
      if (!pts.length) continue;
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      disp.push(gg);
      const pm = new THREE.Points(gg, mat);
      pm.renderOrder = 5;
      group.add(pm);
    }
    // Herbst und Winter: Rauch aus den Kaminen (season3d.ts) – gemütlich
    if (town.smoke?.length && this.season.lamps > 0) {
      const sm = smokePoints(town.smoke, this.smokeMat);
      disp.push(sm.geometry);
      group.add(sm);
    }
    // alles im Abschnitt steht still: Matrizen einmal rechnen statt in jedem Bild
    group.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
    group.updateMatrixWorld(true);
    return {
      idx: ci, group, glow, lamps, crowd, detail,
      dispose: () => {
        for (const d of disp) d.dispose();
        for (const geo of crowdGeos) disposeCrowdGeometry(geo);
        if (csrc) this.treeSrc.delete(csrc);
        if (cbm) disposeBillboards(cbm.geometry);
        for (const geo of sprGeos) disposeSpriteGeometry(geo);
        const ims: THREE.InstancedMesh[] = [];
        group.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) ims.push(o as THREE.InstancedMesh); });
        for (const im of ims) this.giveIM(im);
      },
    };
  }

  /** Querprofil des Geländes neben dem Bankett: Abstände ab Bankettkante und Höhen */
  private profile(side: Side, s: Seg, sg: number, lim = LIM_MAX): Profile {
    const pr = this.rawProfile(side, s, sg);
    // am Korridorrand abschneiden – dahinter geht die Landschaft mit demselben Querprofil weiter
    const maxO = Math.max(1.5, lim - EDGE);
    for (let k = 1; k < pr.o.length; k++) {
      if (pr.o[k] <= maxO) continue;
      const t = (maxO - pr.o[k - 1]) / Math.max(1e-6, pr.o[k] - pr.o[k - 1]);
      const h = pr.h[k - 1] + (pr.h[k] - pr.h[k - 1]) * Math.max(0, Math.min(1, t));
      for (let q = k; q < pr.o.length; q++) { pr.o[q] = maxO; pr.h[q] = h; }
      break;
    }
    return pr;
  }

  /** Höhe des Geländes in Abstand dx vom Bankett (für Bäume, Häuser, Felsen) */
  private groundAt(side: Side, s: Seg, sg: number, dx: number, lim: number): number | null {
    const pr = this.profile(side, s, sg, lim);
    const o = pr.o;
    if (dx > o[o.length - 1] + 0.5) return null;
    for (let k = 0; k < o.length - 1; k++) {
      if (dx <= o[k + 1]) {
        const t = (dx - o[k]) / Math.max(1e-6, o[k + 1] - o[k]);
        return pr.h[k] + (pr.h[k + 1] - pr.h[k]) * Math.max(0, Math.min(1, t));
      }
    }
    return pr.h[pr.h.length - 1];
  }

  private rawProfile(side: Side, s: Seg, sg: number): Profile {
    const t = this.track!;
    const pal = BIOME_PALETTES[t.sections[s.sec].biome];
    // weiches Rauschen entlang der Strecke (keine Zacken von Segment zu Segment)
    const n = (k: number) => {
      const f = s.i / 9;
      const i0 = Math.floor(f);
      let tt = f - i0;
      tt = tt * tt * (3 - 2 * tt);
      const h0 = hash(i0 * 7919 + k * 131 + (sg > 0 ? 17 : 0));
      const h1 = hash((i0 + 1) * 7919 + k * 131 + (sg > 0 ? 17 : 0));
      return h0 + (h1 - h0) * tt - 0.5;
    };
    const gcol = (g: Side['ground'], k: number) => {
      const base = pal.ground[g === 'rock' ? 'rock' : g][0];
      // Grün wie in der Landschaft (terrain3d.grassy): sonst neongrüne Streifen neben der Straße
      const c = g === 'meadow' ? grassy(base)
        // Waldboden: Nadeln und Moos, bräunlich-oliv
        : g === 'forest' ? mixRGB(grassy(base, 0.5), [72, 66, 46], 0.35)
          : g === 'vines' || g === 'sunflower' ? grassy(base, 0.72) : base;
      return shadeF(rgbLin(c), 0.92 + n(k + 30) * 0.16);
    };
    const rock = (k: number) => shadeF(rgbLin(pal.rock), 0.85 + n(k + 50) * 0.2);
    // Alle Profile haben 9 Punkte (0–4: Nahzone/Wandfläche, 5–8: Hang), damit Übergänge sauber verbinden
    if (side.ground === 'water') {
      // Ufer bis unter den Seespiegel (der See selbst ist Teil der Landschaft)
      const lr = Math.min(-1.3, this.terrain!.lakeOf(s.sec) - s.y);
      const sand = lin('#b9ad96');
      const wet = lin('#8f8672');
      // Seegrund: dunkler nasser Boden (das Wasser darüber zeichnet die Landschaft) – kein Blau, das ohne Wasser
      // darüber als blaue Wand neben der Straße stand
      const bed = shadeF(mixRGB(wet, rgbLin(pal.water), 0.25) as RGBf, 0.55);
      const m = Math.max(lr + 0.3, -1.2);
      // liegt die Straße hoch über dem See: Böschung flacher und oberhalb des Wasserspiegels Fels statt
      // Seegrund-Blau (sonst stand eine blaue Wand neben der Straße)
      const k = Math.max(1, -lr / 5);
      const h5 = (m + lr - 0.8) / 2;
      return {
        o: [0, 0.2, 0.4, 1.2, 2, 2 + 2 * k, 2 + 4 * k, 8 + 4 * k, 16 + 4 * k],
        h: [0, -0.22, -0.45, (-0.45 + m) / 2, m, h5, lr - 0.8, lr - 2.6, lr - 4.5],
        cols: [sand, sand, sand, wet, m > lr + 0.5 ? rock(3) : wet, h5 > lr + 0.3 ? rock(4) : bed, bed, bed],
      };
    }
    if (side.wall > 0 && side.stone) {
      // gemauerte Stützmauer mit Abdeckplatte, dahinter der Hang
      const W = side.wall;
      const top = side.ground === 'rock' ? 'meadow' : side.ground;
      const o = [0, 0.025, 0.05, 0.07, 0.075, 0.48, 2.2, 9, 30];
      const h = [0, W * 0.4, W * 0.75, W, W + 0.13, W + 0.13, 0, 0, 0];
      for (let k = 6; k < 9; k++) h[k] = W + 0.13 + side.tilt * (o[k] - 0.48) + (k === 6 ? n(1) * 0.3 : 0);
      const st = shadeF(lin('#c9c0b0'), 0.92 + n(80) * 0.12);
      const cap = shadeF(lin('#dcd5c8'), 0.95 + n(81) * 0.08);
      return { o, h, cols: [st, st, st, cap, shadeF(cap, 1.06), gcol(top, 2), gcol(top, 3), gcol(top, 4)] };
    }
    if (side.wall > 0) {
      // Fels- oder Schneewand: nach hinten geneigt (Felsböschung ~70°, keine senkrechte Platte), mit Bändern,
      // Buckeln und Schichtung – oben gerundet in den Hang statt mit flacher Kante gegen den Himmel
      const W = side.wall;
      const snow = side.ground === 'snow';
      const top = side.ground === 'rock' ? 'meadow' : side.ground;
      // (nur weiches Rauschen entlang der Strecke – Zacken je Segment zerlegten die Wand in dunkle Dreiecke)
      const j = (k: number, amp: number) => n(k + 60) * amp;
      const d = wallSetback(W, snow);
      const o = [0, d * 0.22 + j(1, 0.2 + d * 0.1), d * 0.5 + j(2, 0.25 + d * 0.12), d * 0.78 + j(3, 0.2 + d * 0.1), d, d + 1.4, d + 6, d + 15, d + 29];
      for (let k = 1; k < 4; k++) o[k] = Math.max(o[k - 1] + 0.01, Math.min(d - 0.01 * (4 - k), o[k]));
      const crest = W + 0.5;
      const h = [0, W * (0.3 + j(4, 0.06)), W * (0.58 + j(5, 0.06)), W * (0.82 + j(6, 0.05)), W,
        crest, crest + side.tilt * 4.6 + n(1) * 0.4, crest + side.tilt * 13.6, crest + side.tilt * 27.6];
      const band = (k: number, f: number) => snow
        ? shadeF(lin('#e9f1fa'), f + n(40 + k) * 0.08)
        : shadeF(rgbLin(mixRGB(pal.rock, pal.rockDark, 0.2 + n(50 + k) * 0.5)), f + n(70 + k) * 0.12);
      // Oberkante: Fels geht in Rasen über (Humus liegt auf der Kante)
      const lip = snow ? lin('#f4f8fc') : shadeF(gcol(top, 2), 0.86);
      return { o, h, cols: [band(0, 1.15), band(1, 1.3), band(2, 1.2), band(3, 1.35), lip, gcol(top, 2), gcol(top, 3), gcol(top, 4)] };
    }
    if (side.drop) {
      const k = Math.max(0.6, -side.tilt);
      return {
        o: [0, 0.3, 0.6, 0.9, 1.9, 3, 7, 12, 18],
        h: [0, -0.17 * k, -0.33 * k, -0.5 * k, -1.7 * k, -3 * k, -8 * k + n(1) * 0.5, -16 * k, -26 * k],
        cols: [gcol(side.ground, 0), gcol(side.ground, 0), gcol(side.ground, 1), gcol(side.ground, 1), shadeF(gcol(side.ground, 2), 0.92), shadeF(gcol(side.ground, 2), 0.92), shadeF(rock(3), 0.95), rock(4)],
      };
    }
    if (side.ground === 'pavement') {
      const pv = lin('#b9b2a5');
      const cu = lin('#a8a296');
      // Piazza (und der Startort der Abfahrt bis hinter die Piazza): eben gepflastert bis zu den Häusern
      const sec = this.track!.sections[s.sec];
      const pz = sec?.piazza;
      // Bordstein (Ansicht, Fase, Oberseite – siehe paveSide), dahinter der Gehweg, zur Straße hin leicht geneigt
      const hc = CURB_FACE + CURB_CHAMFER;
      // Boulevard (Paris): breite, ebene Gehwege bis zu den zurückgesetzten Häusern
      const blvd = this.track!.boulevard && sec?.biome === 'village';
      if (blvd || pz && (s.i >= pz[0] - 1 && s.i <= pz[1] + 1 || sec.role === 'top' && s.i <= pz[1] + 3)) {
        return {
          o: [0, 0.005, CURB_TOP, 1.2, 3.5, 8, 18, 26, 34],
          h: [0, hc, hc, hc + 0.015, hc + 0.04, hc + 0.05, hc + 0.05, hc + 0.05, 0.5],
          cols: [cu, cu, pv, pv, pv, pv, pv, shadeF(pv, 0.96)],
          w: 7,
        };
      }
      return {
        o: [0, 0.005, CURB_TOP, 1.2, 3.5, 8, 18, 26, 34],
        h: [0, hc, hc, hc + 0.015, hc + 0.045, 0.4, 1.5, 2.2, 3],
        cols: [cu, cu, pv, pv, gcol('meadow', 2), gcol('meadow', 3), gcol('meadow', 4), gcol('meadow', 4)],
        w: 4,
      };
    }
    const tl = side.tilt;
    const g = side.ground;
    if (tl > 0.08 && !side.drop && g !== 'snow') {
      // Bergseite: Betonrinne am Bankett (Wasser läuft an der Straße entlang), dahinter der Hang
      const o = [0, 0.2, 0.42, 0.62, 1.5, 5, 11, 20, 34];
      const h = [0, -0.11, -0.1, 0.04, tl * 1.4, tl * 5, tl * 11, tl * 20, tl * 34];
      h[5] += n(1) * 0.25;
      h[6] += n(2) * 0.35;
      const con = shadeF(lin('#a9a69f'), 0.95 + n(90) * 0.1);
      return { o, h, cols: [con, shadeF(con, 0.85), con, gcol(g, 1), gcol(g, 1), gcol(g, 2), gcol(g, 3), gcol(g, 5)] };
    }
    const o = [0, 0.375, 0.75, 1.125, 1.5, 5, 11, 20, 34];
    const bump = (k: number, amp: number) => n(k) * amp;
    const h = o.map((x) => tl * x);
    h[5] += bump(1, 0.25);
    h[6] += bump(2, 0.35);
    return { o, h, cols: [gcol(g, 0), gcol(g, 0), gcol(g, 1), gcol(g, 1), gcol(g, 1), gcol(g, 2), gcol(g, 3), gcol(g, 5)] };
  }

  /**
   * Querprofil (innen → außen: Abstand zur Straßenmitte, Höhe, v der Textur) zwischen zwei Querschnitten als
   * Vierecke, u längs der Strecke. Für Rinne, Bordstein, Gehweg und Bankett.
   */
  private profQuads(gb: GB, a: Row, b: Row, sg: number, P: PFn, pa: number[][], pb: number[][], ua: number, ub: number, col: RGBf = WHITE) {
    for (let k = 0; k < pa.length - 1; k++) {
      const A0 = P(a, sg * pa[k][0], pa[k][1]), A1 = P(a, sg * pa[k + 1][0], pa[k + 1][1]);
      const B0 = P(b, sg * pb[k][0], pb[k][1]), B1 = P(b, sg * pb[k + 1][0], pb[k + 1][1]);
      if (gb.xa) {
        // Zusatzwert je Punkt (Spalten 3–6: Farbe daneben, Anteil quer)
        const X = (q: number[]) => [q[3] ?? 1, q[4] ?? 1, q[5] ?? 1, q[6] ?? 0];
        if (sg > 0) gb.quadX(A0, A1, B1, B0, [[ua, pa[k][2]], [ua, pa[k + 1][2]], [ub, pb[k + 1][2]], [ub, pb[k][2]]], [X(pa[k]), X(pa[k + 1]), X(pb[k + 1]), X(pb[k])]);
        else gb.quadX(A1, A0, B0, B1, [[ua, pa[k + 1][2]], [ua, pa[k][2]], [ub, pb[k][2]], [ub, pb[k + 1][2]]], [X(pa[k + 1]), X(pa[k]), X(pb[k]), X(pb[k + 1])]);
        continue;
      }
      if (sg > 0) gb.quad(A0, A1, B1, B0, col, [[ua, pa[k][2]], [ua, pa[k + 1][2]], [ub, pb[k + 1][2]], [ub, pb[k][2]]]);
      else gb.quad(A1, A0, B0, B1, col, [[ua, pa[k + 1][2]], [ua, pa[k][2]], [ub, pb[k][2]], [ub, pb[k + 1][2]]]);
    }
  }

  /**
   * Asphaltkante nicht als Lineal: wie weit der Belag über die Normalbreite hinaus reicht (0 … 12 cm, weich längs
   * der Strecke); im Ort (Gehweg) gerade – dort geht die Fahrbahn bis zur Rinne
   */
  private asphEdge(r: Row, sg: number): number {
    const side = sg < 0 ? r.seg.L : r.seg.R;
    if (side.ground === 'pavement' || r.seg.tunnel) return 0;
    return 0.06 + along(r.seg.i, sg > 0 ? 91 : 97, 1.5) * 0.12;
  }

  /**
   * Bankett neben der Fahrbahn (außerhalb der Orte): die Asphaltkante als kleine dunkle Stufe, dahinter Splitt,
   * Erde und Gras – uneben (zwei Zwischenpunkte steigen und fallen weich längs der Strecke)
   */
  private vergeStrip(gb: GB, marks: GB, a: Row, b: Row, sg: number, P: PFn, za: number, zb: number, i0: number) {
    const sz = this.gsz.verge;
    const vo = Math.floor((i0 * SEG) / sz);
    const k0 = sg > 0 ? 40 : 0;
    const prof = (r: Row): number[][] => {
      // Farbe des Geländes daneben (für den Übergang im Shader) und wo die Asphaltkante liegt
      const c = this.profile(sg < 0 ? r.seg.L : r.seg.R, r.seg, sg).cols[0];
      const w = this.asphEdge(r, sg);
      const pt = (lat: number, h: number): number[] => [lat, h, lat / sz, c[0], c[1], c[2], (lat - ROAD_HALF) / (EDGE - ROAD_HALF)];
      return [
        pt(ROAD_HALF + w, -0.03),
        pt(ROAD_HALF + 0.3, -0.042 + along(r.seg.i, k0 + 1, 3) * 0.045),
        pt(ROAD_HALF + 0.66, -0.05 + along(r.seg.i, k0 + 2, 4) * 0.06),
        pt(EDGE, -0.04),
      ];
    };
    this.profQuads(gb, a, b, sg, P, prof(a), prof(b), za / sz - vo, zb / sz - vo);
    // Asphaltkante: Stufe von der Fahrbahn hinunter aufs Bankett
    const wa = this.asphEdge(a, sg), wb = this.asphEdge(b, sg);
    this.profQuads(marks, a, b, sg, P, [[ROAD_HALF + wa, 0, 0], [ROAD_HALF + wa, -0.03, 0]], [[ROAD_HALF + wb, 0, 0], [ROAD_HALF + wb, -0.03, 0]], 0, 0, ASPH_EDGE);
  }

  /**
   * Bordstein und Gehweg (beide Querschnitte im Ort): Ansicht, Fase und Oberseite des Bordsteins aus einer
   * Steintextur (Steine mit Fugen, Reifenspuren an der Ansicht), dahinter der Gehweg mit dem Belag des Orts –
   * leicht uneben (Platten heben und senken sich), auf dem Platz bis zu den Häusern. Gibt zurück, ab welchem Band
   * das Gelände weitergeht.
   */
  private paveSide(G: PaveGB, a: Row, b: Row, sg: number, P: PFn, pa: Profile, pb: Profile): number {
    const y0 = -0.04;
    const hT = CURB_FACE + CURB_CHAMFER;
    const cs = this.gsz.curb;
    const co = Math.floor((a.seg.i * SEG) / cs / 64) * 64;
    const curbP: number[][] = [
      [EDGE, y0, 0], [EDGE, y0 + CURB_FACE, CURB_FACE / CURB_V],
      [EDGE + CURB_CHAMFER, y0 + hT, (CURB_FACE + CURB_CHAMFER * 1.41) / CURB_V], [EDGE + CURB_TOP, y0 + hT, 1],
    ];
    this.profQuads(G.curb, a, b, sg, P, curbP, curbP, (a.seg.i * SEG) / cs - co, (b.seg.i * SEG) / cs - co);
    // Gehweg: welcher der beiden Beläge, entscheidet der Ort (Abschnitt)
    const two = hash(a.seg.sec * 977 + 13) < 0.5;
    const gb = two ? G.walk2 : G.walk;
    const ws = two ? this.gsz.walk2 : this.gsz.walk;
    const wo = Math.floor((a.seg.i * SEG) / ws / 64) * 64;
    const wa = this.walkProf(a, sg, pa, ws), wb = this.walkProf(b, sg, pb, ws);
    this.profQuads(gb, a, b, sg, P, wa, wb, (a.seg.i * SEG) / ws - wo, (b.seg.i * SEG) / ws - wo);
    return pa.w ?? 4;
  }

  /** Querschnitt des Gehwegs (Abstand zur Mitte, Höhe mit −0,04 wie die Bänder, v = Abstand in Kacheln) */
  private walkProf(r: Row, sg: number, pr: Profile, ws: number): number[][] {
    const w = pr.w ?? 4;
    const k = sg > 0 ? 60 : 20;
    const out: number[][] = [];
    for (let q = 2; q <= w; q++) {
      const lat = EDGE + pr.o[q];
      // die äußerste Ecke bleibt auf dem Profil (dort geht das Gelände weiter), innen sanfte Unebenheiten
      const bump = q > 2 && q < w ? along(r.seg.i, k + q, 3) * 0.028 : 0;
      out.push([lat, pr.h[q] - 0.04 + bump, lat / ws]);
      if (q < w) {
        const mid = EDGE + (pr.o[q] + pr.o[q + 1]) / 2;
        const hm = (pr.h[q] + pr.h[q + 1]) / 2 - 0.04 + along(r.seg.i, k + q + 30, 2) * 0.022;
        out.push([mid, hm, mid / ws]);
      }
    }
    // Übergang zum Gelände dahinter: auf dem letzten Stück greift es organisch herein (Shader, aX)
    const c = pr.cols[Math.min(pr.cols.length - 1, w)];
    for (let i = 0; i < out.length; i++) out[i].push(c[0], c[1], c[2], i === out.length - 1 ? 1 : 0);
    return out;
  }

  /** Höhe des Gehwegs an Abstand lat von der Mitte (wie walkProf), für Deckel darauf */
  private walkHeight(r: Row, sg: number, lat: number): number {
    const pr = this.profile(sg < 0 ? r.seg.L : r.seg.R, r.seg, sg);
    const pts = this.walkProf(r, sg, pr, 1);
    for (let i = 0; i < pts.length - 1; i++) {
      if (lat <= pts[i + 1][0]) {
        const t = Math.max(0, Math.min(1, (lat - pts[i][0]) / Math.max(1e-6, pts[i + 1][0] - pts[i][0])));
        return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
      }
    }
    return pts[pts.length - 1][1];
  }

  /**
   * Schachtdeckel, Abläufe und Schieberkappen: im Ort etwa alle 25 m ein Deckel in einer Fahrspur, alle 18 m ein
   * Ablauf in der Rinne, hin und wieder eine Schieberkappe am Rand und ein Deckel im Gehweg; auf dem Land selten
   * ein Deckel. Nicht in Schriften und Zebrastreifen.
   */
  private coverDecals(gb: GB, a: Row, b: Row, s: Seg) {
    if (s.decals?.some((d) => d.k !== 'manhole' && d.k !== 'patch')) return;
    const h = (k: number) => hash(s.i * 131 + k * 7919 + 3);
    const lanes = [-1.4, 1.4, -0.75, 0.75];
    const townL = s.L.ground === 'pavement' && b.seg.L.ground === 'pavement';
    const townR = s.R.ground === 'pavement' && b.seg.R.ground === 'pavement';
    if (townL || townR) {
      if (h(1) < 1 / 12) this.roundCover(gb, a, b, lanes[Math.floor(h(2) * 4)] + (h(3) - 0.5) * 0.3, 0.5 + h(4), Math.floor(h(5) * 4));
      if (h(6) < 1 / 30) this.roundCover(gb, a, b, (h(7) < 0.5 ? -1 : 1) * (ROAD_HALF - 0.35), 0.5 + h(8), 6, 0.4);
      for (const sg of [-1, 1]) {
        if (!(sg < 0 ? townL : townR)) continue;
        if (h(10 + sg) < 1 / 9) this.grate(gb, a, b, sg, 0.45 + h(12 + sg) * 1.1);
        if (h(20 + sg) < 1 / 24) this.walkCover(gb, a, b, sg, EDGE + 0.75 + h(22 + sg) * 1.4, 0.5 + h(24 + sg), h(26 + sg) < 0.5 ? 4 : 7);
      }
    } else if (s.surface !== 'gravel' && h(1) < 1 / 160) {
      this.roundCover(gb, a, b, lanes[Math.floor(h(2) * 4)], 1, Math.floor(h(5) * 4));
    }
  }

  /** Punkt auf der Fahrbahnebene: quer lat (ohne Verbreiterung), längs al ab dem Querschnitt a (Steigung zu b) */
  private onRoad(a: Row, b: Row, lat: number, al: number, hh: number): number[] {
    const fx = Math.sin(a.th), fz = -Math.cos(a.th);
    return [a.x + a.rx * lat + fx * al, a.y + (b.y - a.y) * (al / SEG) + hh + this.track!.lift(a.m + al, lat), a.z + a.rz * lat + fz * al];
  }

  /** runder Deckel (Zelle 0–3, 6 im Atlas) mit Rahmen und Flicken rundum, k: Größe */
  private roundCover(gb: GB, a: Row, b: Row, lat: number, al: number, cell: number, k = 1) {
    const R = COVER_PATCH * k;
    const cu = ((cell % 4) + 0.5) * 0.25, cv = 1 - (Math.floor(cell / 4) + 0.5) * 0.5;
    const rot = hash(a.seg.i * 17 + cell) * Math.PI * 2;
    const C = this.onRoad(a, b, lat, al, 0.006);
    const N = 16;
    for (let q = 0; q < N; q++) {
      const t0 = (q / N) * Math.PI * 2, t1 = ((q + 1) / N) * Math.PI * 2;
      const p0 = this.onRoad(a, b, lat + Math.cos(t0) * R, al + Math.sin(t0) * R, 0.006);
      const p1 = this.onRoad(a, b, lat + Math.cos(t1) * R, al + Math.sin(t1) * R, 0.006);
      // (gedreht: nicht jeder Deckel zeigt seine Schrift in Fahrtrichtung)
      gb.tri(C, p0, p1, WHITE, [cu, cv], [cu + Math.cos(t0 + rot) * 0.125, cv + Math.sin(t0 + rot) * 0.25], [cu + Math.cos(t1 + rot) * 0.125, cv + Math.sin(t1 + rot) * 0.25]);
    }
  }

  /** Straßenablauf in der Rinne: Gitter längs (folgt der Mulde) */
  private grate(gb: GB, a: Row, b: Row, sg: number, al: number) {
    const L = 0.62;
    // Ausschnitt der Zelle 5 (Bildpunkte in der 128er-Zelle): x längs, y quer
    const u0 = (128 + 4) / 512, u1 = (128 + 124) / 512;
    const v0 = 1 - (128 + 20) / 256, v1 = 1 - (128 + 108) / 256;
    const G = GUTTER_PROF;
    const lat = (k: number) => sg * (G[0][0] + (G[2][0] - G[0][0]) * (0.08 + 0.84 * k / 2));
    const hAt = (k: number) => { const t = 0.08 + 0.84 * k / 2; const x = t * 2; const i = Math.min(1, Math.floor(x)); const f = x - i; return G[i][1] + (G[i + 1][1] - G[i][1]) * f + 0.004; };
    for (let k = 0; k < 2; k++) {
      const A0 = this.onRoad(a, b, widen(lat(k), a.e), al, hAt(k)), A1 = this.onRoad(a, b, widen(lat(k + 1), a.e), al, hAt(k + 1));
      const B0 = this.onRoad(a, b, widen(lat(k), a.e), al + L, hAt(k)), B1 = this.onRoad(a, b, widen(lat(k + 1), a.e), al + L, hAt(k + 1));
      const va = v0 + (v1 - v0) * (k / 2), vb = v0 + (v1 - v0) * ((k + 1) / 2);
      if (sg > 0) gb.quad(A0, A1, B1, B0, WHITE, [[u0, va], [u0, vb], [u1, vb], [u1, va]]);
      else gb.quad(A1, A0, B0, B1, WHITE, [[u0, vb], [u0, va], [u1, va], [u1, vb]]);
    }
  }

  /** Deckel im Gehweg: quadratisch (Zelle 4) oder Kabelschacht (Zelle 7) */
  private walkCover(gb: GB, a: Row, b: Row, sg: number, latAbs: number, al: number, cell: number) {
    const sq = cell === 4;
    const L = sq ? 0.7 : 0.9, D = sq ? 0.7 : 0.55;
    const cx = (cell % 4) * 128, cy = Math.floor(cell / 4) * 128;
    const [px0, py0, px1, py1] = sq ? [8, 8, 120, 120] : [6, 24, 122, 104];
    const u0 = (cx + px0) / 512, u1 = (cx + px1) / 512, v0 = 1 - (cy + py0) / 256, v1 = 1 - (cy + py1) / 256;
    const l0 = latAbs - D / 2, l1 = latAbs + D / 2;
    const h0 = this.walkHeight(a, sg, l0) + 0.005, h1 = this.walkHeight(a, sg, l1) + 0.005;
    const A0 = this.onRoad(a, b, widen(sg * l0, a.e), al, h0), A1 = this.onRoad(a, b, widen(sg * l1, a.e), al, h1);
    const B0 = this.onRoad(a, b, widen(sg * l0, a.e), al + L, h0), B1 = this.onRoad(a, b, widen(sg * l1, a.e), al + L, h1);
    if (sg > 0) gb.quad(A0, A1, B1, B0, WHITE, [[u0, v0], [u0, v1], [u1, v1], [u1, v0]]);
    else gb.quad(A1, A0, B0, B1, WHITE, [[u0, v1], [u0, v0], [u1, v0], [u1, v1]]);
  }

  private terrainSide(terr: GB, mas: GB, a: Row, b: Row, sg: number, P: (r: Row, x: number, h: number) => number[], limA: number, limB: number) {
    const sa = sg < 0 ? a.seg.L : a.seg.R;
    // am Tunnelportal läuft das Profil des Einschnitts bis an die Felswand
    const bt = b.seg.tunnel;
    const sb = bt ? sa : sg < 0 ? b.seg.L : b.seg.R;
    const pa = this.profile(sa, a.seg, sg, limA);
    const pb = this.profile(sb, bt ? a.seg : b.seg, sg, bt ? limA : limB);
    // im Ort (beide Querschnitte): Bordstein und Gehweg als eigene Netze mit Texturen, das Gelände erst dahinter
    const k0 = sa.ground === 'pavement' && sb.ground === 'pavement' && pa.w !== undefined && pa.w === pb.w && this.paveGB ? this.paveSide(this.paveGB, a, b, sg, P, pa, pb) : 0;
    for (let k = k0; k < pa.o.length - 1; k++) {
      const xa0 = sg * (EDGE + pa.o[k]);
      const xa1 = sg * (EDGE + pa.o[k + 1]);
      const xb0 = sg * (EDGE + pb.o[k]);
      const xb1 = sg * (EDGE + pb.o[k + 1]);
      const A0 = P(a, xa0, pa.h[k] - 0.04);
      const A1 = P(a, xa1, pa.h[k + 1] - 0.04);
      const B0 = P(b, xb0, pb.h[k] - 0.04);
      const B1 = P(b, xb1, pb.h[k + 1] - 0.04);
      const col = pa.cols[k];
      if (sa.stone && k < 5) {
        // Stützmauer: Bruchstein, Lagen waagrecht entlang der Strecke
        const za = a.seg.i * SEG / 1.8;
        const zb = za + SEG / 1.8;
        const hv = (h: number) => h / 1.8;
        const q = [[za * sg, hv(pa.h[k])], [za * sg, hv(pa.h[k + 1])], [zb * sg, hv(pb.h[k + 1])], [zb * sg, hv(pb.h[k])]];
        if (sg > 0) mas.quad(A0, A1, B1, B0, col, q);
        else mas.quad(A1, A0, B0, B1, col, [q[1], q[0], q[3], q[2]]);
        continue;
      }
      const uv = (v: number[]) => [(v[0] + v[1] * 0.7) / 6, (v[2] - v[1] * 0.7) / 6];
      // grün neben nicht grün (Rinne → Wiese, Fels → Grasnarbe, Kies → Wiese): innen die Farbe des vorigen Bands, der
      // Shader macht daraus einen ausgefransten Übergang (im Ort übernimmt das der Gehweg)
      const green = (c: RGBf) => c[1] - Math.max(c[0], c[2]) > 0.012;
      if (k > 0 && sa.ground !== 'pavement' && green(pa.cols[k]) !== green(pa.cols[k - 1])) {
        const ca = pa.cols[k - 1], cb = pb.cols[k - 1] ?? ca, cob = pb.cols[k] ?? col;
        if (sg > 0) terr.quadC(A0, A1, B1, B0, ca, col, cob, cb, [uv(A0), uv(A1), uv(B1), uv(B0)]);
        else terr.quadC(A1, A0, B0, B1, col, ca, cb, cob, [uv(A1), uv(A0), uv(B0), uv(B1)]);
        continue;
      }
      if (sg > 0) terr.quad(A0, A1, B1, B0, col, [uv(A0), uv(A1), uv(B1), uv(B0)]);
      else terr.quad(A1, A0, B0, B1, col, [uv(A1), uv(A0), uv(B0), uv(B1)]);
    }
    // Widerlager: grenzt das Profil an ein Viadukt, bliebe seine Stirnseite offen (von der Brücke aus ein
    // schwarzer Keil unter einer schwebenden Böschung). Gemauerte Stirnwand vom Profil bis in den Graben.
    const t = this.track!;
    const prevB = a.seg.i > t.first ? t.seg(a.seg.i - 1).bridge : 0;
    const nextB = b.seg.bridge;
    if (prevB > 0 || nextB > 0) {
      const row = prevB > 0 ? a : b;
      const pr = prevB > 0 ? pa : pb;
      // bis unter die tiefste Stelle des Grabens (am Brückenende ist die Rampe schon fast ausgelaufen)
      let maxB = Math.max(prevB, nextB);
      for (let j = row.seg.i - 40; j <= row.seg.i + 40; j++) maxB = Math.max(maxB, t.seg(Math.max(t.first, j)).bridge);
      const deep = -(maxB + 3);
      const st = shadeF(lin('#b8ae9c'), 0.9);
      const uvS = 1.8;
      for (let k = 0; k < pr.o.length - 1; k++) {
        const x0 = sg * (EDGE + pr.o[k]);
        const x1 = sg * (EDGE + pr.o[k + 1]);
        const T0 = P(row, x0, pr.h[k] - 0.04);
        const T1 = P(row, x1, pr.h[k + 1] - 0.04);
        const D0 = P(row, x0, deep);
        const D1 = P(row, x1, deep);
        const uv = [[x0 / uvS, pr.h[k] / uvS], [x1 / uvS, pr.h[k + 1] / uvS], [x1 / uvS, deep / uvS], [x0 / uvS, deep / uvS]];
        // beidseitig: man sieht sie von der Brücke und aus dem Graben
        mas.quad(T0, T1, D1, D0, st, uv);
        mas.quad(T1, T0, D0, D1, st, [uv[1], uv[0], uv[3], uv[2]]);
      }
      // Stück zwischen Fahrbahnrand und Profilbeginn (unter dem Bankett)
      const E0 = P(row, sg * EDGE, -0.04);
      const E1 = P(row, sg * (EDGE + pr.o[0]), pr.h[0] - 0.04);
      const F0 = P(row, sg * EDGE, deep);
      const F1 = P(row, sg * (EDGE + pr.o[0]), deep);
      mas.quad(E0, E1, F1, F0, st);
      mas.quad(E1, E0, F0, F1, st);
    }
    // Schürze am Rand: schließt die Fuge zur Landschaft, aus jeder Richtung
    const ka = pa.o.length - 1;
    const kb = pb.o.length - 1;
    const E0 = P(a, sg * (EDGE + pa.o[ka]), pa.h[ka] - 0.04);
    const E1 = P(b, sg * (EDGE + pb.o[kb]), pb.h[kb] - 0.04);
    const D0 = [E0[0], E0[1] - 3.2, E0[2]];
    const D1 = [E1[0], E1[1] - 3.2, E1[2]];
    const sc = shadeF(pa.cols[pa.cols.length - 1], 0.82);
    terr.quad(E0, D0, D1, E1, sc, [[0, 0], [0, 0.5], [0.3, 0.5], [0.3, 0]]);
    terr.quad(E0, E1, D1, D0, sc, [[0, 0], [0.3, 0], [0.3, 0.5], [0, 0.5]]);
  }

  /**
   * Steinviadukt: Seitenwände aus Bruchstein vom Fahrbahnrand bis hinunter in den Graben, alle 8 m ein Pfeiler,
   * dazwischen Bögen (durch die man hindurchsieht), unter dem Bogenscheitel läuft ein Bach
   */
  private bridgeSide(mas: GB, water: GB, a: Row, b: Row, P: (r: Row, x: number, h: number) => number[]) {
    const T = this.terrain!;
    const reg = this.region!;
    const s = a.seg;
    const SPAN = 4;            // Segmente je Bogen (8 m)
    const PIER = 0.6;          // halbe Pfeilerbreite (m)
    const RISE = 3.0;          // Stich des Bogens (m)
    const TOP = 1.1;           // Mauer vom Fahrbahnrand bis zum Bogenscheitel (m)
    const st = shadeF(lin('#b8ae9c'), 0.9 + hash(s.i * 5) * 0.14);
    const dark = shadeF(st, 0.62);
    // Unterkante der Wand (Bogenlinie) an einer Stelle u (0..1) im Bogen, relativ zur Fahrbahn
    const arch = (i: number, t: number) => {
      const u = ((i % SPAN) + t) / SPAN;                // 0 = Pfeilermitte
      const d = Math.abs(u - 0.5) * 2;                  // 0 am Scheitel, 1 am Pfeiler
      return -(TOP + RISE * (1 - Math.sqrt(Math.max(0, 1 - d * d))));
    };
    // Boden unter dem Pfeiler (Rand der Fahrbahn), relativ zur Fahrbahn
    const ground = (row: Row, x: number) => { const q = P(row, x, 0); return T.heightIn(reg, q[0], q[2]) - row.y - 0.4; };
    const uvS = 1.8;
    const za = s.i * SEG / uvS;
    const zb = za + SEG / uvS;
    for (const sg of [-1, 1]) {
      const x = sg * (EDGE + 0.25);
      // Wand in 4 Stücken je Segment (die Bogenlinie ist rund)
      const N = 4;
      for (let q = 0; q < N; q++) {
        const t0 = q / N;
        const t1 = (q + 1) / N;
        const r0 = { ...a, m: a.m + (b.m - a.m) * t0, x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0, z: a.z + (b.z - a.z) * t0, rx: a.rx + (b.rx - a.rx) * t0, rz: a.rz + (b.rz - a.rz) * t0 };
        const r1 = { ...a, m: a.m + (b.m - a.m) * t1, x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1, z: a.z + (b.z - a.z) * t1, rx: a.rx + (b.rx - a.rx) * t1, rz: a.rz + (b.rz - a.rz) * t1 };
        const h0 = arch(s.i, t0);
        const h1 = arch(s.i, t1);
        const A0 = P(r0, x, -0.02); const A1 = P(r0, x, h0); const B0 = P(r1, x, -0.02); const B1 = P(r1, x, h1);
        const u0 = za + (zb - za) * t0; const u1 = za + (zb - za) * t1;
        const uv = [[u0 * sg, 0], [u0 * sg, h0 / uvS], [u1 * sg, h1 / uvS], [u1 * sg, 0]];
        if (sg > 0) mas.quad(A0, A1, B1, B0, st, uv); else mas.quad(A1, A0, B0, B1, st, [uv[1], uv[0], uv[3], uv[2]]);
      }
      // Pfeiler: am Anfang jedes Bogens ein Quader bis auf den Boden, über die ganze Breite
      if (s.i % SPAN === 0) {
        const g = Math.min(ground(a, x), ground(a, -x)) - 0.5;
        const top = arch(s.i, 0) + 0.3;
        const xi = sg * (EDGE + 0.25);
        const corners = (dz: number, h: number) => { const r2 = { ...a, m: a.m + (b.m - a.m) * dz, x: a.x + (b.x - a.x) * dz, y: a.y + (b.y - a.y) * dz, z: a.z + (b.z - a.z) * dz, rx: a.rx, rz: a.rz }; return P(r2, xi, h); };
        const d0 = -PIER / SEG; const d1 = PIER / SEG;
        // Außenfläche des Pfeilers (unter der Bogenwand) und seine beiden Flanken
        const F0 = corners(d0, top); const F1 = corners(d1, top); const G0 = corners(d0, g); const G1 = corners(d1, g);
        const uvp = [[(za + d0) * sg, top / uvS], [(za + d0) * sg, g / uvS], [(za + d1) * sg, g / uvS], [(za + d1) * sg, top / uvS]];
        if (sg > 0) mas.quad(F0, G0, G1, F1, st, uvp); else mas.quad(G0, F0, F1, G1, st, [uvp[1], uvp[0], uvp[3], uvp[2]]);
        // Flanken quer zur Straße (zur Mitte hin bis zur anderen Seite)
        const xm = 0;
        const Fi0 = (dz: number, h: number) => { const r2 = { ...a, m: a.m + (b.m - a.m) * dz, x: a.x + (b.x - a.x) * dz, y: a.y + (b.y - a.y) * dz, z: a.z + (b.z - a.z) * dz, rx: a.rx, rz: a.rz }; return P(r2, xm, h); };
        for (const [dz, flip] of [[d0, sg > 0], [d1, sg < 0]] as [number, boolean][]) {
          const o0 = corners(dz, top); const o1 = corners(dz, g); const m0 = Fi0(dz, top); const m1 = Fi0(dz, g);
          const uvf = [[0, top / uvS], [0, g / uvS], [EDGE / uvS, g / uvS], [EDGE / uvS, top / uvS]];
          if (flip) mas.quad(o0, o1, m1, m0, dark, uvf); else mas.quad(o1, o0, m0, m1, dark, [uvf[1], uvf[0], uvf[3], uvf[2]]);
        }
      }
    }
    // Unterseite der Fahrbahnplatte (sieht man vom Graben aus)
    {
      const h = -TOP;
      const A0 = P(a, -EDGE - 0.25, h); const A1 = P(a, EDGE + 0.25, h); const B0 = P(b, -EDGE - 0.25, h); const B1 = P(b, EDGE + 0.25, h);
      mas.quad(A1, A0, B0, B1, dark, [[0, za], [EDGE / uvS, za], [EDGE / uvS, zb], [0, zb]]);
    }
    // Bach im Graben (quer unter der Brücke): eine ebene Wasserfläche auf der Höhe der tiefsten Stelle
    // (nur unter dem hohen Teil und nicht breiter als die Brücke hoch ist – an den Rampen lag die Fläche sonst
    // neben der Straße im Gelände)
    if (s.bridge > 2.5) {
      const t = this.track!;
      let deep = s;
      for (let j = s.i - 24; j <= s.i + 24; j++) { const q = t.seg(Math.max(t.first, j)); if (q.bridge > deep.bridge) deep = q; }
      const yw = deep.y - deep.bridge - 0.9;
      const Wmax = Math.min(40, 4 + (s.bridge - 2.5) * 6);
      // je Seite nur bis zur Grabenwand: dahinter fällt das Gelände oft weiter ab (zur nächsten Serpentine) –
      // dort schwebte die Wasserfläche sonst sichtbar über der Wiese
      const T = this.terrain!;
      const reg = this.region!;
      // −1: kein Ufer gefunden (das Gelände fällt unter den Wasserspiegel) – dann kein Bach
      const reach = (sg: number) => {
        for (let d = EDGE + 2; d <= Wmax; d += 2) {
          const q = P(a, sg * d, 0);
          const h = T.heightIn(reg, q[0], q[2]);
          if (h > yw + 2.5) return Math.min(Wmax, d + 3);
          if (h < yw - 0.5) return -1;
        }
        return -1;
      };
      const WL = reach(-1);
      const WR = reach(1);
      if (WL < 0 || WR < 0) return;
      const A0 = P(a, -WL, 0); const A1 = P(a, WR, 0); const B0 = P(b, -WL, 0); const B1 = P(b, WR, 0);
      for (const q of [A0, A1, B0, B1]) q[1] = yw;
      water.quad(A0, A1, B1, B0, [1, 1, 1]);
    }
  }

  private barriers(bar: GB, ads: GB, a: Row, b: Row, P: (r: Row, x: number, h: number) => number[]) {
    const s = a.seg;
    if (s.tunnel) return;
    const wallQ = (x: number, h0: number, h1: number, col: RGBf) => bar.quad(P(a, x, h0), P(b, x, h0), P(b, x, h1), P(a, x, h1), col);
    for (const sg of [-1, 1]) {
      const side = sg < 0 ? s.L : s.R;
      if (s.crowd) {
        const cloth = lin(CLOTH[(s.i >> 2) % CLOTH.length]);
        // bedruckte Bande zur Straße, dahinter Stoff
        const x = sg * (EDGE - 0.07);
        // wie an echten Rennen: dieselbe Bande mehrmals hintereinander (je 3 Stück), gut die Hälfte davon Teams –
        // aber nur jede dritte Folge trägt Werbung (gedämpft), dazwischen schlichter Stoff
        const run = Math.floor(s.i / 3) * 2 + (sg > 0 ? 1 : 0);
        const hv = hash(run);
        if (hash(run * 11 + 9) < 1 / 3) {
          const cell = hv < 0.55 ? Math.floor(hash(run * 7 + 3) * TEAM_ADS) : TEAM_ADS + Math.floor(hash(run * 5 + 1) * (AD_COUNT - TEAM_ADS));
          const [u0, v0, u1, v1] = adCell(cell, false);
          const A0 = P(a, x, 0.17); const B0 = P(b, x, 0.17); const A1 = P(a, x, 0.93); const B1 = P(b, x, 0.93);
          const back = shadeF(cloth, 0.78);
          if (sg > 0) ads.quad(B0, A0, A1, B1, back, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
          else ads.quad(A0, B0, B1, A1, back, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
        }
        wallQ(sg * (EDGE - 0.02), 0.15, 0.95, cloth);
        wallQ(sg * (EDGE - 0.05), 0.95, 1.05, lin('#c8cdd2'));
        if ((s.i & 1) === 0) this.box(bar, a, sg * (EDGE - 0.05), 0, 0.05, 1.05, 0.05, lin('#9aa0a6'), P);
        continue;
      }
      if (side.wall > 0) continue;
      // Leitpfosten alle 50 m (weiß mit schwarzem Band), wo keine Leitplanke, Mauer oder Zaun steht
      if (side.barrier === 'none' && side.ground !== 'water' && side.ground !== 'pavement' && (s.i + (sg > 0 ? 0 : 12)) % 25 === 0) {
        const x = sg * (EDGE + 0.1);
        this.box(bar, a, x, 0, 0.1, 1.0, 0.1, lin('#eef0ee'), P);
        this.box(bar, a, x, 0.58, 0.112, 0.12, 0.112, lin('#1b1d20'), P);
      }
      if (side.barrier === 'rail') {
        const x = sg * (EDGE - 0.12);
        wallQ(x, 0.46, 0.56, lin('#9aa1a9'));
        wallQ(x, 0.56, 0.68, lin('#d5dadf'));
        wallQ(x, 0.68, 0.74, lin('#b5bcc4'));
        if ((s.i & 1) === 0) this.box(bar, a, sg * (EDGE - 0.02), 0, 0.07, 0.72, 0.07, lin('#6b727a'), P);
      } else if (side.barrier === 'stone') {
        const v = 0.85 + hash(s.i * 3 + sg) * 0.2;
        const st = shadeF(lin('#a89f90'), v);
        const ht = s.bridge > 0 ? 0.95 : 0.62;
        wallQ(sg * (EDGE - 0.08), -0.1, ht, st);
        if (s.bridge > 0) wallQ(sg * (EDGE + 0.32), -0.1, ht, st);
        const x0 = sg * (EDGE - 0.08);
        const x1 = sg * (EDGE + 0.32);
        const top = [P(a, x0, ht), P(a, x1, ht), P(b, x1, ht), P(b, x0, ht)];
        if (sg > 0) bar.quad(top[0], top[1], top[2], top[3], shadeF(lin('#c7beae'), v)); else bar.quad(top[1], top[0], top[3], top[2], shadeF(lin('#c7beae'), v));
      } else if (side.barrier === 'fence') {
        wallQ(sg * (EDGE + 0.15), 0.55, 0.63, lin('#7a5634'));
        wallQ(sg * (EDGE + 0.15), 0.92, 1.0, lin('#7a5634'));
        if ((s.i & 1) === 0) this.box(bar, a, sg * (EDGE + 0.15), 0, 0.1, 1.1, 0.1, lin('#6a4a2c'), P);
      }
    }
  }

  /** kleine Quader (Pfosten), ausgerichtet an der Straße */
  private box(gb: GB, r: Row, x: number, h0: number, w: number, h: number, d: number, col: RGBf, P: (r: Row, x: number, h: number) => number[]) {
    const fx = Math.sin(r.th);
    const fz = -Math.cos(r.th);
    const c = P(r, x, h0);
    const corner = (dx: number, dz: number, y: number) => [c[0] + r.rx * dx + fx * dz, y, c[2] + r.rz * dx + fz * dz];
    const y0 = c[1];
    const y1 = c[1] + h;
    const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[(i + 1) % 4];
      gb.quad(corner(ax, az, y0), corner(bx, bz, y0), corner(bx, bz, y1), corner(ax, az, y1), col);
    }
    gb.quad(corner(-w / 2, -d / 2, y1), corner(w / 2, -d / 2, y1), corner(w / 2, d / 2, y1), corner(-w / 2, d / 2, y1), shadeF(col, 1.1));
  }

  /** Tunnel, in dem Segment i liegt: erstes und letztes Segment, Länge in m */
  private tunnelOf(i: number): [number, number, number] {
    const hit = this.tunSpan.get(i);
    if (hit) return hit;
    const t = this.track!;
    let a = i;
    while (a > t.first && t.seg(a - 1).tunnel) a--;
    let b = i;
    while (t.seg(b + 1).tunnel) b++;
    const out: [number, number, number] = [a, b, (b - a + 1) * SEG];
    for (let k = a; k <= b; k++) this.tunSpan.set(k, out);
    if (this.tunSpan.size > 4000) this.tunSpan.clear();
    return out;
  }

  /**
   * Tunnelportal: Felswand quer zur Straße mit Betonvorbau. Die Wand ist ein feines Gitter mit
   * Relief (Rippen, Absätze), ihre Oberkante folgt der Landschaft, unten reicht sie unter das
   * Gelände – so sieht man nirgends an ihr vorbei. dir = 1: Einfahrt (Vorbau zeigt zur Anfahrt),
   * dir = −1: Ausfahrt (Vorbau zeigt in Fahrtrichtung).
   */
  private *portalSteps(gb: GB, mas: GB, trim: GB, group: THREE.Group, disp: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[], a: Row, P: (r: Row, x: number, h: number) => number[], biome: BiomeId, dir: 1 | -1): Generator<void, void, void> {
    const pal = BIOME_PALETTES[biome];
    // Felswand: eigene Geometrie mit weichen Normalen (sonst sieht man jedes Dreieck des Reliefs)
    const outer = gb;
    gb = new GB();
    const x = EDGE - 0.35;
    const T = this.terrain!;
    const W = 40;
    // eigener, kleiner Rechenbereich (nur die Wand): viel weniger Straßenstücke je Höhenabfrage als im ganzen Abschnitt
    const reg = T.region(a.x - W - 8, a.z - W - 8, a.x + W + 8, a.z + W + 8);
    const fx = Math.sin(a.th);
    const fz = -Math.cos(a.th);
    const NI = 40;           // Spalten (2 m)
    const NJ = 16;           // Zeilen (je Spalte vom Fuß bis zur Oberkante)
    const lat = (i: number) => -W + (2 * W * i) / NI;
    const tops: number[] = [];
    const bots: number[] = [];
    for (let i = 0; i <= NI; i++) {
      const l = lat(i);
      const wp = P(a, l, 0);
      const ht = T.heightIn(reg, wp[0], wp[2]) - a.y;
      // Gelände gleich hinter der Wand (dort beginnt der Berg über der Röhre): die Wand reicht bis darüber
      const hb = T.heightIn(reg, wp[0] + fx * dir * 6, wp[2] + fz * dir * 6) - a.y;
      const al = Math.abs(l);
      const minTop = al < FAC_W + 2 ? FAC_H + 2.4 : al < 26 ? FAC_H + 2.4 - (al - FAC_W - 2) * 0.35 : -Infinity;
      tops.push(Math.max(minTop, ht + 2.2, al < 26 ? hb + 0.8 : -Infinity));
      bots.push(Math.min(-9, ht - 6));
      if (this.late()) yield;
    }
    // Knoten: Lage in der Wand (Seite, Höhe) und Relief (+ in den Berg hinein)
    const hAt = (i: number, j: number) => bots[i] + ((tops[i] - bots[i]) * j) / NJ;
    const nodes: number[][] = [];
    for (let i = 0; i <= NI; i++) {
      for (let j = 0; j <= NJ; j++) {
        const l = lat(i);
        const h = hAt(i, j);
        // Relief erst mit Abstand zur Fassade
        const k = Math.max(0, Math.min(1, (Math.hypot(Math.max(0, Math.abs(l) - FAC_W), Math.max(0, h - FAC_H)) - 0.4) / 5));
        const edge = j === NJ ? 0.4 : 1; // Oberkante ruhiger (schließt an die Landschaft an)
        const v = 1.5 * Math.sin(l * 0.37 + h * 0.21) + 1.1 * Math.sin(l * 0.13 - h * 0.43 + 1.7)
          + 0.6 * Math.sin(l * 0.71 + h * 0.67) + (hash(i * 131 + j * 977 + a.seg.i) - 0.5) * 1.3;
        const r = v * k * edge;
        const q = P(a, l, h);
        nodes.push([q[0] + fx * r * dir, q[1], q[2] + fz * r * dir, l, h]);
      }
    }
    if (this.late()) yield;
    const N = (i: number, j: number) => nodes[i * (NJ + 1) + j];
    // Gesteinsfarbe: Lagen nach Höhe, etwas Rauschen
    const rock = rgbLin(mixRGB(pal.rock, [168, 160, 148], 0.25));
    const rockD = rgbLin(pal.rockDark);
    // (Farbe je Knoten, weich über die Fläche – je Zelle eine eigene Farbe zerlegte die Wand in Facetten)
    const colAt = (l: number, h: number, salt: number): RGBf => {
      const band = 0.5 + 0.5 * Math.sin(h * 1.7 + Math.sin(l * 0.15) * 1.2);
      const n = 0.5 + 0.5 * Math.sin(l * 0.9 + h * 1.3 + salt * 0.37) * Math.sin(l * 0.33 - h * 0.7);
      const t = Math.min(1, band * 0.55 + n * 0.3);
      const f = 0.93 + n * 0.14;
      return [(rock[0] + (rockD[0] - rock[0]) * t) * f, (rock[1] + (rockD[1] - rock[1]) * t) * f, (rock[2] + (rockD[2] - rock[2]) * t) * f];
    };
    const nodeCol = (n: number[]) => colAt(n[3], n[4], a.seg.i % 97);
    // Aussparung um die Öffnung: Zellen, die ihr zu nahe kommen, übernimmt ein Rahmen (unten)
    const near = (i: number, j: number) => {
      const l0 = lat(i);
      const l1 = lat(i + 1);
      const h1 = Math.max(hAt(i, j + 1), hAt(i + 1, j + 1));
      return l1 > -FAC_W - 0.9 && l0 < FAC_W + 0.9 && h1 > FAC_B - 9 && Math.min(hAt(i, j), hAt(i + 1, j)) < FAC_H + 0.7;
    };
    const top = new Array<number>(NI).fill(-1); // je Spalte: höchste ausgesparte Zeile
    for (let i = 0; i < NI; i++) for (let j = 0; j < NJ; j++) if (near(i, j)) top[i] = j;
    for (let i = 0; i < NI; i++) {
      for (let j = 0; j < NJ; j++) {
        if (j <= top[i]) continue;
        const A = N(i, j);
        const B = N(i + 1, j);
        const C = N(i + 1, j + 1);
        const D = N(i, j + 1);
        const cA = nodeCol(A), cB = nodeCol(B), cC = nodeCol(C), cD = nodeCol(D);
        if (Math.abs(A[1] - C[1]) < Math.abs(B[1] - D[1])) { gb.triC(A, B, C, cA, cB, cC); gb.triC(A, C, D, cA, cC, cD); }
        else { gb.triC(A, B, D, cA, cB, cD); gb.triC(B, C, D, cB, cC, cD); }
      }
    }
    if (this.late()) yield;
    // Rahmen zwischen Treppenrand der ausgesparten Zellen und der Tunnelöffnung (ohne Relief an der Öffnung)
    const cols = [...top.keys()].filter((i) => top[i] >= 0);
    if (cols.length) {
      const i0 = cols[0];
      const i1 = cols[cols.length - 1] + 1;
      const outline: number[][] = [];
      for (let i = i0; i <= i1; i++) outline.push(N(i, 0));                    // unten links → rechts
      for (let j = 1; j <= top[i1 - 1] + 1; j++) outline.push(N(i1, j));       // rechts hinauf
      for (let i = i1 - 1; i >= i0; i--) {                                      // Treppe oben, rechts → links
        const jt = top[i] + 1;
        if (i < i1 - 1) {
          const jr = top[i + 1] + 1;
          if (jt > jr) for (let j = jr + 1; j <= jt; j++) outline.push(N(i + 1, j));
          else for (let j = jr - 1; j >= jt; j--) outline.push(N(i + 1, j));
        }
        outline.push(N(i, jt));
      }
      for (let j = top[i0]; j >= 1; j--) outline.push(N(i0, j));               // links hinunter
      // Aussparung: Rechteck der Fassade (sie steht davor und reicht seitlich in den Fels)
      const hole: number[][] = [[-FAC_W + 0.3, FAC_B], [FAC_W - 0.3, FAC_B], [FAC_W - 0.3, FAC_H - 0.2], [-FAC_W + 0.3, FAC_H - 0.2]];
      const v2 = (pts: number[][]) => pts.map((p) => new THREE.Vector2(p[0], p[1]));
      const contour = v2(outline.map((n) => [n[3], n[4]]));
      const holeV = v2(hole);
      if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse(), outline.reverse();
      if (!THREE.ShapeUtils.isClockWise(holeV)) holeV.reverse(), hole.reverse();
      const faces = THREE.ShapeUtils.triangulateShape(contour, [holeV]);
      const all: number[][] = [...outline, ...hole.map((p) => P(a, p[0], p[1]))];
      for (const [i, j, k] of faces) {
        const A = all[i];
        const B = all[j];
        const C = all[k];
        const cy = (A[1] + B[1] + C[1]) / 3 - a.y;
        gb.tri([A[0], A[1], A[2]], [B[0], B[1], B[2]], [C[0], C[1], C[2]], colAt(0, cy, a.seg.i % 97));
      }
    }
    if (this.late()) yield;
    // gemauerte Fassade mit Bogen, davor die Inschrift
    const { plaque } = portalFacade(mas, trim, a, P, dir);
    if (this.late()) yield;
    const t = this.track!;
    const [t0, t1, len] = this.tunnelOf(dir > 0 ? a.seg.i : a.seg.i - 1);
    const name = tunnelName(t.lang, t0 * 7 + t1 * 13 + t.seed);
    const key = `plaque:${name}:${len}`;
    let tex = this.labelTex.get(key);
    if (!tex) {
      // Inschrift malen: erst mit frischem Budget
      if (this.soon(2)) yield;
      tex = this.tex(plaqueTex(name, `m ${Math.round(len / 2) * 2}`), false);
      this.labelTex.set(key, tex);
      if (this.late()) yield;
    }
    const pg = new GB();
    pg.uv = true;
    pg.quad(plaque[0], plaque[1], plaque[2], plaque[3], [1, 1, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    const geo = pg.build();
    const t2 = tex;
    const mat = this.matFor(`plaque|${key}`, () => new THREE.MeshLambertMaterial({ map: t2, side: THREE.DoubleSide }));
    disp.push(geo);
    group.add(new THREE.Mesh(geo, mat));
    if (!gb.empty) {
      if (this.soon(1)) yield;
      const rg = gb.buildSmooth(new THREE.Vector3(-fx * dir, 0.25, -fz * dir));
      disp.push(rg);
      const rm = new THREE.Mesh(rg, this.mats.portal);
      rm.castShadow = true;
      group.add(rm);
    }
    void outer;
    void gb; void x;
  }

  /**
   * Haus an der Straße: Fassaden stockwerksweise aus dem Atlas (alle vier Wände), Satteldach mit
   * Ziegeln, Traufbrettern und Kamin, Ladenschild, Wandlaterne – Kirche mit Turm, Rathaus mit Fahnen.
   * Das Haus folgt der Sehne der Straße (in Kurven stehen beide Enden im gleichen Abstand) und steht am
   * Hang auf der höheren Seite; der Sockel reicht tief genug hinunter.
   */
  /**
   * Häuserzeile an der Straße: einzelne Häuser (house3d.ts) mit eigener Höhe, Farbe und Dach, dahinter je nach
   * Ort eine zweite und dritte Reihe auf dem Gelände. Kirche, Rathaus und Palazzi an der Piazza: specialBuilding.
   */
  private *building(T: Town, a: Row, b: Building, sg: number, lim: number, resume: () => void): Generator<void, void, void> {
    if (b.style === STYLE.kirche || b.style === STYLE.rathaus || b.arcade) { this.specialBuilding(T, a, b, sg); return; }
    const t = this.track!;
    const z0 = a.seg.i * SEG;
    const e = t.world(z0 + b.len * SEG, 0, 0, this.w2);
    let fx = e.x - a.x;
    let fz = e.z - a.z;
    const L = Math.hypot(fx, fz) || b.len * SEG;
    fx /= L;
    fz /= L;
    const rx = -fz;
    const rz = fx;
    const base = Math.max(a.y, e.y);
    const ax = a.x;
    const az = a.z;
    const at: At = (lat, along, h) => [ax + rx * lat + fx * along, base + h, az + rz * lat + fz * along];
    const lang = t.lang;
    const region = t.region;
    const pal = wallSet(region, lang);
    const units = rowUnits(L, b.style, b.floors, b.seed, pal);
    const village = t.sections[a.seg.sec].biome === 'village';
    const shopUnit = b.sign >= 0 ? Math.max(0, units.findIndex((u) => u.s1 - u.s0 >= 3.99)) : -1;
    const lanternUnit = hash(b.seed + 5) < 0.8 ? Math.floor(hash(b.seed + 6) * units.length) : -1;
    for (let i = 0; i < units.length; i++) {
      // je Haus nachsehen, ob die Zeit des Bildes um ist (eine Zeile mit Hinterhäusern sind viele Teile)
      if (i > 0 && this.soon(1)) { yield; resume(); }
      const u = units[i];
      const seed = b.seed + (i + 1) * 7717;
      const free = units.length === 1;
      const depth = b.depth * (0.88 + hash(seed + 5) * 0.24);
      buildHouse(T, at, {
        s0: u.s0, s1: u.s1, setback: b.setback + u.dz, depth, sg, style: u.style, floors: u.floors, seed, tint: u.tint,
        roof: roofKind(u.style, region, lang, free, hash(seed + 3)), roofCol: roofColor(u.style, region, lang, hash(seed + 7)),
        foot: -3.2, ovA: i === 0, ovB: i === units.length - 1, street: true,
        shop: i === shopUnit ? { sign: b.sign, badge: b.badge } : null, lantern: i === lanternUnit,
        annex: hash(seed + 11) < (village ? 0.22 : 0.5),
      }, lang);
      const c = at(sg * (b.setback + depth / 2), (u.s0 + u.s1) / 2, 0);
      T.occ.push(c[0], c[2], 0.45 * Math.hypot(u.s1 - u.s0, depth));
    }
    yield* this.backRows(T, a, b, sg, at, L, base, lim, village, resume);
  }

  /**
   * Hinterhäuser: hinter der Straßenzeile eine zweite (im Ort oft auch eine dritte) Reihe auf dem Gelände – über
   * die Dächer und durch die Lücken sieht man so einen Ort statt einer Kulisse. Nicht auf anderen Straßen, nicht
   * an zu steilen Stellen, nicht ineinander.
   */
  private *backRows(T: Town, a: Row, b: Building, sg: number, at: At, L: number, base: number, lim: number, village: boolean, resume: () => void): Generator<void, void, void> {
    const t = this.track!;
    const side = sg < 0 ? a.seg.L : a.seg.R;
    if (side.ground !== 'pavement') return;
    const ground = (lat: number, along: number): number => {
      const p = at(lat, along, 0);
      const dx = Math.abs(lat) - EDGE;
      if (dx < lim - 0.5) {
        const gh = this.groundAt(side, a.seg, sg, dx, lim);
        if (gh !== null) return a.y + gh;
      }
      return this.terrain!.heightIn(this.region!, p[0], p[2]);
    };
    const h = (k: number) => hash(b.seed * 17 + k * 6151);
    const rows = village ? (h(1) < 0.6 ? 2 : 1) : h(1) < 0.55 ? 1 : 0;
    const lang = t.lang;
    const region = t.region;
    const pal = wallSet(region, lang);
    const alpineFront = b.style === STYLE.chalet || b.style === STYLE.bruchstein;
    const pool = alpineFront ? townLook().alpPool ?? [STYLE.chalet, STYLE.chalet, STYLE.bruchstein, STYLE.creme] : townLook().pool ?? (lang === 'en' ? [STYLE.backstein, STYLE.backstein, STYLE.creme, STYLE.fachwerk] : [STYLE.ocker, STYLE.lachs, STYLE.creme, STYLE.gelb, STYLE.terrakotta, b.style]);
    let lat0 = b.setback + b.depth;
    for (let row = 0; row < rows; row++) {
      const s2 = lat0 + 2.6 + h(row * 7 + 2) * 2.8;
      let deepest = 0;
      let x = -1.5 + h(row * 7 + 3) * 2.5;
      let k = 0;
      while (x < L - 3 && k < 4) {
        const q = row * 50 + k * 7;
        k++;
        const w = 5.5 + h(q + 4) * 4;
        const d = 6.5 + h(q + 5) * 3.5;
        const x1 = Math.min(L + 2, x + w);
        const xs = x;
        x = x1 + 1.2 + h(q + 6) * 3.5;
        if (x1 - xs < 4.5 || s2 + d > TOWN_ZONE - 2) continue;
        if (this.soon(1)) { yield; resume(); }
        // Untergrund: höchste und tiefste Ecke
        let yMax = -Infinity;
        let yMin = Infinity;
        let blocked = false;
        for (const [qq, xx] of [[s2, xs], [s2, x1], [s2 + d, xs], [s2 + d, x1], [s2 + d / 2, (xs + x1) / 2]]) {
          const lat = sg * qq;
          const y = ground(lat, xx);
          yMax = Math.max(yMax, y);
          yMin = Math.min(yMin, y);
          const p = at(lat, xx, 0);
          if (this.terrain!.roadDist(this.region!, p[0], p[2]) < EDGE + 3.5) blocked = true;
        }
        if (blocked || yMax - yMin > 5.5) continue;
        const c = at(sg * (s2 + d / 2), (xs + x1) / 2, 0);
        const rad = 0.45 * Math.hypot(x1 - xs, d);
        let hit = false;
        for (let o = 0; o < T.occ.length && !hit; o += 3) {
          if (Math.hypot(T.occ[o] - c[0], T.occ[o + 1] - c[2]) < T.occ[o + 2] + rad) hit = true;
        }
        if (hit) continue;
        T.occ.push(c[0], c[2], rad);
        deepest = Math.max(deepest, d);
        const style = pool[Math.floor(h(q + 7) * pool.length)];
        const floors = Math.max(1, Math.min(village ? 3 : 2, Math.round((village ? 1.2 : 0.8) + h(q + 8) * 1.9) - row));
        const seed = Math.floor(h(q + 9) * 1e9);
        const tint = pal[Math.floor(h(q + 10) * pal.length)];
        const base2 = yMax + 0.05;
        const at2: At = (lat, along, y) => at(lat, along, y + base2 - base);
        buildHouse(T, at2, {
          s0: xs, s1: x1, setback: s2, depth: d, sg, style, floors, seed, tint,
          roof: roofKind(style, region, lang, true, h(q + 11)), roofCol: roofColor(style, region, lang, h(q + 12)),
          foot: Math.max(-12, yMin - base2 - 0.6), ovA: true, ovB: true, street: true, back: true,
          annex: h(q + 13) < 0.3,
        }, lang);
      }
      if (!deepest) break;
      lat0 = s2 + deepest;
    }
  }

  /** Kirche, Rathaus und Palazzi mit Laubengang (eine Einheit, eigene Teile) */
  private specialBuilding(T: Town, a: Row, b: Building, sg: number) {
    const t = this.track!;
    const z0 = a.seg.i * SEG;
    const e = t.world(z0 + b.len * SEG, 0, 0, this.w2);
    let fx = e.x - a.x;
    let fz = e.z - a.z;
    const L = Math.hypot(fx, fz) || b.len * SEG;
    fx /= L;
    fz /= L;
    const rx = -fz;
    const rz = fx;
    const base = Math.max(a.y, e.y);
    const at = (lat: number, along: number, h: number) => [a.x + rx * lat + fx * along, base + h, a.z + rz * lat + fz * along];
    const st = b.style;
    const church = st === STYLE.kirche;
    const n = b.floors;
    const GH = FAC_M.ground;
    const UH = FAC_M.upper;
    const H = GH + n * UH + FAC_M.cornice;
    const depth = b.depth;
    const l0 = sg * b.setback;
    const l1 = sg * (b.setback + depth);
    const lo = Math.min(l0, l1);
    const hi = Math.max(l0, l1);
    const hs = (k: number) => hash(b.seed + k * 7919);
    const pieces = (len: number) => Math.max(1, Math.ceil(len / 4 - 0.01));
    const frontPieces = pieces(L);
    const signPiece = frontPieces >= 3 ? 1 : 0;
    const signOk = b.sign >= 0 && L - signPiece * 4 >= 3.99;

    // Wandfarbe (Häuser mit eigener Farbe: aus der Palette der Gegend)
    const pal = wallSet(t.region, t.lang);
    const tOff = TINTABLE[st] ? pal[Math.floor(hs(29) * pal.length)] : 0;
    const wallHex = TINTABLE[st] ? WALL_PAL[tOff] : STYLE_WALL[st];
    // Tönung des Hauses (etwas wärmer oder kühler, heller oder dunkler) und Verlauf über die Höhe
    const wTint = 0.9 + hs(31) * 0.14;
    const warm = (hs(37) - 0.5) * 0.1;
    const ageC = (h: number, k: number): RGBf => {
      let f = h < 0 ? 0.62 : h < 1.4 ? 0.78 + 0.22 * (h / 1.4) : 1;
      if (h > H - 0.9) f *= 0.86;
      f *= wTint * (0.95 + hash(b.seed * 13 + k * 7) * 0.08);
      return [f * (1 + warm), f, f * (1 - warm * 1.2)];
    };
    /** Wand von A nach B (von außen gesehen links → rechts) als Streifen je Geschoss */
    const wall = (A: [number, number], B: [number, number], variant: (k: number, upper: boolean) => number, onPiece?: (k: number, s0: number, s1: number) => void) => {
      const Lw = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const np = pieces(Lw);
      for (let k = 0; k < np; k++) {
        const s0 = k * 4;
        const s1 = Math.min(Lw, s0 + 4);
        const p0 = [A[0] + (B[0] - A[0]) * (s0 / Lw), A[1] + (B[1] - A[1]) * (s0 / Lw)];
        const p1 = [A[0] + (B[0] - A[0]) * (s1 / Lw), A[1] + (B[1] - A[1]) * (s1 / Lw)];
        const strip = (h0: number, h1: number, part: FacPart, v: number) => {
          const [vb, vt] = facV(st, part);
          const u0 = facU(v, 0) + tOff;
          const u1 = facU(v, s1 - s0) + tOff;
          // Alter und Schmutz: unten Spritzwasser, unter dem Dach Schatten, jedes Stück und Haus etwas anders
          const c0 = ageC(h0, k);
          const c1 = ageC(h1, k);
          T.facade.quadC(at(p0[0], p0[1], h0), at(p1[0], p1[1], h0), at(p1[0], p1[1], h1), at(p0[0], p0[1], h1), c0, c0, c1, c1, [[u0, vb], [u1, vb], [u1, vt], [u0, vt]]);
        };
        const vg = variant(k, false);
        const vu = variant(k, true);
        strip(-3.2, 0, 'base', vg);
        strip(0, GH, 'ground', vg);
        for (let f = 0; f < n; f++) strip(GH + f * UH, GH + (f + 1) * UH, 'upper', vu);
        strip(H - FAC_M.cornice, H, 'cornice', vu);
        onPiece?.(k, s0, s1);
      }
    };
    // Front zur Straße: Läden (Variante B) wo ein Schild hängt, sonst gemischt
    const frontVar = (k: number, upper: boolean) => {
      if (upper) return hs(k + 40) < 0.5 ? 1 : 0;
      if (church) return k === Math.floor(frontPieces / 2) ? 0 : 1;
      if (signOk && k === signPiece) return 1;
      return hs(k) < (b.sign >= 0 ? 0.25 : 0.18) ? 1 : 0;
    };
    const sideVar = (k: number, upper: boolean) => (upper ? (hs(k + 90) < 0.3 ? 1 : 0) : 0);
    const out = -sg;   // Richtung zur Straße (quer)
    const frontA: [number, number] = sg < 0 ? [l0, 0] : [l0, L];
    const frontB: [number, number] = sg < 0 ? [l0, L] : [l0, 0];
    wall(frontA, frontB, frontVar, (k, s0) => {
      // Ladenschild über dem Schaufenster
      if (!(signOk && k === signPiece)) return;
      const [u0, v0, u1, v1] = signUV(this.track!.lang, b.sign);
      const along = (s: number) => (sg < 0 ? s : L - s);
      const la = l0 + out * 0.05;
      const a0 = along(s0 + 0.22);
      const a1 = along(s0 + 3.78);
      T.signs.quad(at(la, a0, GH - 0.37), at(la, a1, GH - 0.37), at(la, a1, GH - 0.01), at(la, a0, GH - 0.01), [1, 1, 1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      if (b.badge >= 0) {
        // Steckschild quer zur Fassade (zwei Seiten, damit es von beiden Richtungen lesbar ist)
        const [bu0, bv0, bu1, bv1] = badgeUV(b.badge);
        const ab = along(s0 + 0.12);
        const q0 = l0 + out * 0.2;
        const q1 = l0 + out * 0.85;
        const h0 = GH + 0.35;
        const h1 = h0 + 0.65;
        const [na, nb] = out > 0 ? [q0, q1] : [q1, q0];
        T.signs.quad(at(na, ab - 0.01, h0), at(nb, ab - 0.01, h0), at(nb, ab - 0.01, h1), at(na, ab - 0.01, h1), [1, 1, 1], [[bu0, bv0], [bu1, bv0], [bu1, bv1], [bu0, bv1]]);
        T.signs.quad(at(nb, ab + 0.01, h0), at(na, ab + 0.01, h0), at(na, ab + 0.01, h1), at(nb, ab + 0.01, h1), [1, 1, 1], [[bu0, bv0], [bu1, bv0], [bu1, bv1], [bu0, bv1]]);
        const iron = lin('#2a2a2c');
        T.plain.quad(at(l0, ab, h1 + 0.02), at(q1, ab, h1 + 0.02), at(q1, ab, h1 + 0.07), at(l0, ab, h1 + 0.07), iron);
      }
    });
    wall([lo, 0], [hi, 0], sideVar);
    wall([hi, L], [lo, L], sideVar);
    wall(sg < 0 ? [l1, L] : [l1, 0], sg < 0 ? [l1, 0] : [l1, L], sideVar);

    // ---- Wandlaterne (abends ein warmer Lichtpunkt)
    if (!church && hs(5) < 0.8) {
      const s = L >= 6 ? 4 : L / 2;
      const al = sg < 0 ? s : L - s;
      const h = GH + 0.45;
      const iron = lin('#26262a');
      const p0 = l0 + out * 0.02;
      const p1 = l0 + out * 0.42;
      T.plain.quad(at(p0, al - 0.03, h + 0.26), at(p1, al - 0.03, h + 0.26), at(p1, al + 0.03, h + 0.26), at(p0, al + 0.03, h + 0.26), iron);
      T.plain.quad(at(p0, al, h + 0.2), at(p1, al, h + 0.26), at(p1, al, h + 0.31), at(p0, al, h + 0.26), iron);
      const c = at(p1, al, h);
      const box = (x0: number, x1: number, y0: number, y1: number, col: RGBf) => {
        const q = (pa: number[], pb: number[], pc: number[], pd: number[]) => T.plain.quad(pa, pb, pc, pd, col);
        const P0 = (dl: number, da: number, y: number) => [c[0] + rx * dl + fx * da, c[1] + y, c[2] + rz * dl + fz * da];
        q(P0(x0, x0, y0), P0(x1, x0, y0), P0(x1, x0, y1), P0(x0, x0, y1));
        q(P0(x1, x0, y0), P0(x1, x1, y0), P0(x1, x1, y1), P0(x1, x0, y1));
        q(P0(x1, x1, y0), P0(x0, x1, y0), P0(x0, x1, y1), P0(x1, x1, y1));
        q(P0(x0, x1, y0), P0(x0, x0, y0), P0(x0, x0, y1), P0(x0, x1, y1));
      };
      box(-0.09, 0.09, -0.02, 0.24, lin('#f2d9a0'));
      box(-0.12, 0.12, 0.24, 0.3, iron);
      T.lanterns.push(c[0], c[1] + 0.12, c[2]);
    }

    // ---- Dach
    const pitch = roofPitch(st);
    const chalet = st === STYLE.chalet;
    const ovE = chalet ? 1.1 : 0.42;
    const ovG = chalet ? 0.75 : 0.28;
    const half = depth / 2;
    const rh = H + pitch * half;
    const lm = (l0 + l1) / 2;
    const ee = H - pitch * ovE;
    const eF = l0 - sg * ovE;
    const eB = l1 + sg * ovE;
    const tint = 0.9 + hs(3) * 0.18;
    // Ortsbild des Schauplatzes: Palazzi wie die Häuser gedeckt, Kirchen unter Schiefer, Zink und Lauzes dunkel
    const look = townLook().roof;
    const roofCol = !look ? shadeF(lin(STYLE_ROOF[st]), tint)
      : church ? shadeF(lin(look === 'tile' ? STYLE_ROOF[st] : look === 'lauze' ? '#5f5a53' : '#4d5156'), tint)
        : roofColor(st, t.region, t.lang, hs(3));
    const slopeLen = Math.hypot(half + ovE, rh - ee);
    const g0 = -ovG;
    const g1 = L + ovG;
    const tileQuad = (eave: number) => T.tiles.quad(at(eave, g0, ee), at(eave, g1, ee), at(lm, g1, rh), at(lm, g0, rh), roofCol,
      [[g0 / 2, 0], [g1 / 2, 0], [g1 / 2, slopeLen / 2], [g0 / 2, slopeLen / 2]]);
    tileQuad(eF);
    tileQuad(eB);
    // First, Trauf- und Ortgangbretter: das Dach bekommt eine sichtbare Stärke
    const board = lin(chalet ? '#3e2716' : st === STYLE.backstein || st === STYLE.haussmann ? '#d9d4ca' : '#4a3628');
    const bh = chalet ? 0.3 : 0.18;
    for (const ev of [eF, eB]) T.plain.quad(at(ev, g0, ee - bh), at(ev, g1, ee - bh), at(ev, g1, ee), at(ev, g0, ee), board);
    for (const al of [g0, g1]) {
      for (const ev of [eF, eB]) T.plain.quad(at(ev, al, ee - bh), at(lm, al, rh - bh), at(lm, al, rh), at(ev, al, ee), board);
    }
    T.plain.quad(at(lm - 0.12, g0, rh + 0.02), at(lm - 0.12, g1, rh + 0.02), at(lm + 0.12, g1, rh + 0.02), at(lm + 0.12, g0, rh + 0.02), shadeF(roofCol, 0.75));
    // Giebeldreiecke (Wandfarbe; Chalet in Holz)
    const gable = chalet ? lin('#7a4e2c') : shadeF(lin(wallHex), 0.94);
    T.plain.tri(at(l0, 0, H), at(lm, 0, rh), at(l1, 0, H), gable);
    T.plain.tri(at(l1, L, H), at(lm, L, rh), at(l0, L, H), gable);
    // Unterseite des Dachüberstands an der Traufe (dunkler Schatten statt Durchblick)
    const soffit = lin(chalet ? '#3a2414' : '#3e342c');
    T.plain.quad(at(l0, g0, H - 0.02), at(eF, g0, ee - bh), at(eF, g1, ee - bh), at(l0, g1, H - 0.02), soffit);
    T.plain.quad(at(l1, g0, H - 0.02), at(eB, g0, ee - bh), at(eB, g1, ee - bh), at(l1, g1, H - 0.02), soffit);
    // Kamin auf der hinteren Dachhälfte
    if (!church && hs(9) < 0.7) {
      const ca = L * (0.25 + hs(11) * 0.5);
      const cl = lm + sg * half * (0.3 + hs(13) * 0.25);
      const roofH = rh - pitch * Math.abs(cl - lm);
      const cw = 0.32;
      const col = st === STYLE.backstein ? lin('#8a3e2e') : shadeF(lin(wallHex), 0.85);
      const top = rh + 0.9;
      const P0 = (dl: number, da: number, h: number) => at(cl + dl, ca + da, h);
      const sides: [number, number, number, number][] = [[-cw, -cw, cw, -cw], [cw, -cw, cw, cw], [cw, cw, -cw, cw], [-cw, cw, -cw, -cw]];
      for (const [x0, y0, x1, y1] of sides) T.plain.quad(P0(x0, y0, roofH - 0.6), P0(x1, y1, roofH - 0.6), P0(x1, y1, top), P0(x0, y0, top), col);
      const cap = lin('#3a3632');
      const cc = cw + 0.07;
      T.plain.quad(P0(-cc, -cc, top), P0(cc, -cc, top), P0(cc, cc, top), P0(-cc, cc, top), cap);
      for (const [x0, y0, x1, y1] of sides) T.plain.quad(P0(x0 * 1.22, y0 * 1.22, top - 0.1), P0(x1 * 1.22, y1 * 1.22, top - 0.1), P0(x1 * 1.22, y1 * 1.22, top), P0(x0 * 1.22, y0 * 1.22, top), cap);
      T.smoke?.push(...P0(0, 0, top + 0.1));
    }

    // ---- Laubengang vor dem Erdgeschoss: Pfeiler, Rundbögen, Terrasse darüber (Palazzi an der Piazza)
    if (b.arcade) {
      const AD = 3.0;                 // Tiefe des Laubengangs
      const AH = GH - 0.25;           // Oberkante der Bögen
      const pil = lin('#d8cfbd');
      const pilD = shadeF(pil, 0.82);
      const soff = lin('#b9ae99');
      const dark = lin('#3a3028');
      const lp = l0 + out * AD;       // Pfeilerlinie
      const np = Math.max(1, Math.round(L / 3.6));
      const step = L / np;
      const PW = 0.55;
      for (let k = 0; k <= np; k++) {
        const c = Math.min(L - PW / 2, Math.max(PW / 2, k * step));
        const s0 = c - PW / 2;
        const s1 = c + PW / 2;
        // Pfeiler (vier Seiten)
        T.plain.quad(at(lp, s0, -0.5), at(lp, s1, -0.5), at(lp, s1, AH), at(lp, s0, AH), out * sg < 0 ? pil : pil);
        T.plain.quad(at(lp - out * PW, s1, -0.5), at(lp - out * PW, s0, -0.5), at(lp - out * PW, s0, AH), at(lp - out * PW, s1, AH), pilD);
        T.plain.quad(at(lp - out * PW, s0, -0.5), at(lp, s0, -0.5), at(lp, s0, AH), at(lp - out * PW, s0, AH), pilD);
        T.plain.quad(at(lp, s1, -0.5), at(lp - out * PW, s1, -0.5), at(lp - out * PW, s1, AH), at(lp, s1, AH), pilD);
        // Kapitell
        T.plain.quad(at(lp + out * 0.1, s0 - 0.1, AH - 0.3), at(lp + out * 0.1, s1 + 0.1, AH - 0.3), at(lp + out * 0.1, s1 + 0.1, AH), at(lp + out * 0.1, s0 - 0.1, AH), shadeF(pil, 0.92));
      }
      // Bogenfeld: Wand über den Bögen bis zur Terrasse, Bögen als dunkle Öffnungen mit rundem Scheitel
      for (let k = 0; k < np; k++) {
        const s0 = Math.min(L, k * step + PW / 2);
        const s1 = Math.min(L, (k + 1) * step - PW / 2);
        const w = s1 - s0;
        if (w < 0.6) continue;
        const cx = (s0 + s1) / 2;
        const R = w / 2;
        const base = AH - R * 0.95;
        // Zwickel über dem Bogen (helle Wand)
        const la = lp + out * 0.02;
        T.plain.quad(at(la, s0, base), at(la, s1, base), at(la, s1, GH + 0.2), at(la, s0, GH + 0.2), pil);
        // Bogenöffnung als Fächer (dunkel, sieht man in den Gang)
        const N = 8;
        for (let q = 0; q < N; q++) {
          const a0 = Math.PI * (q / N);
          const a1 = Math.PI * ((q + 1) / N);
          const p0 = at(la + out * 0.01, cx - Math.cos(a0) * R, base + Math.sin(a0) * R * 0.95);
          const p1 = at(la + out * 0.01, cx - Math.cos(a1) * R, base + Math.sin(a1) * R * 0.95);
          const pc = at(la + out * 0.01, cx, base);
          if (sg < 0) T.plain.tri(pc, p0, p1, dark); else T.plain.tri(pc, p1, p0, dark);
        }
        T.plain.quad(at(la + out * 0.01, s0, -0.5), at(la + out * 0.01, s1, -0.5), at(la + out * 0.01, s1, base), at(la + out * 0.01, s0, base), dark);
      }
      // Terrasse mit Brüstung über dem Gang
      T.plain.quad(at(l0, 0, GH + 0.2), at(l0, L, GH + 0.2), at(lp + out * 0.15, L, GH + 0.2), at(lp + out * 0.15, 0, GH + 0.2), shadeF(pil, 0.96));
      T.plain.quad(at(lp + out * 0.15, 0, GH + 0.2), at(lp + out * 0.15, L, GH + 0.2), at(lp + out * 0.15, L, GH + 1.1), at(lp + out * 0.15, 0, GH + 1.1), pil);
      T.plain.quad(at(lp + out * 0.15, 0, GH + 1.1), at(lp + out * 0.15, L, GH + 1.1), at(lp - out * 0.1, L, GH + 1.1), at(lp - out * 0.1, 0, GH + 1.1), shadeF(pil, 0.9));
      // Decke des Gangs (von unten sichtbar)
      T.plain.quad(at(lp, 0, GH - 0.05), at(lp, L, GH - 0.05), at(l0, L, GH - 0.05), at(l0, 0, GH - 0.05), soff);
    }

    // ---- Kirchturm vorn an der Straße (campanile3d.ts): ragt etwas vor die Front, Seitenlänge je nach Größe
    if (church) {
      const tw = b.tall ? 5.2 : 4.4;
      const t0 = l0 + out * 0.6;
      const ck = t.scape?.church;
      if (ck !== 'chapel') campanile(T, { at, cl: t0 - (out * tw) / 2, ca: -0.6 + tw / 2, w: tw, tall: !!b.tall, rnd: (k) => hs(60 + k), lang: t.lang, kind: ck === 'clocher' || ck === 'tower' ? ck : 'campanile' });
    }

    // ---- Rathaus: Fahnen in den Landesfarben
    if (st === STYLE.rathaus) {
      const lang = this.track!.lang;
      const cols: string[] = lang === 'fr' ? ['#1f3c9c', '#f4f4f4', '#d6202a'] : lang === 'it' ? ['#1f8a4c', '#f4f4f4', '#d6202a']
        : lang === 'es' ? ['#c8102e', '#ffc400', '#c8102e'] : ['#1f3c9c', '#f4f4f4', '#d6202a'];
      const vertical = lang !== 'es';
      for (const s of [L * 0.3, L * 0.7]) {
        const h0 = GH + UH * 0.85;
        const root = at(l0, s, h0);
        const tipP = at(l0 + out * 1.5, s, h0 + 0.9);
        const iron = lin('#2a2a2c');
        T.plain.quad(root, [root[0], root[1] + 0.05, root[2]], [tipP[0], tipP[1] + 0.05, tipP[2]], tipP, iron);
        // Tuch hängt am Mast, leicht schräg
        for (let k = 0; k < 3; k++) {
          const f0 = k / 3;
          const f1 = (k + 1) / 3;
          const P = (fu: number, fv: number) => {
            const lat = l0 + out * (0.35 + 1.1 * fu);
            const hh = h0 + 0.2 + 0.6 * fu - 0.75 * fv;
            return at(lat, s + 0.04 * fv, hh);
          };
          if (vertical) T.plain.quad(P(f0, 0), P(f1, 0), P(f1, 1), P(f0, 1), lin(cols[k]));
          else T.plain.quad(P(0, f0), P(1, f0), P(1, f1), P(0, f1), lin(cols[k]));
        }
      }
    }
  }

  /** Wimpelkette mit Glühbirnen quer über die Gasse (abends leuchten die Birnen) */
  private garland(T: Town, a: Row, bl: Building, br: Building) {
    const lang = this.track!.lang;
    const sets: Record<string, string[]> = {
      fr: ['#1f3c9c', '#f4f4f4', '#d6202a'], it: ['#1f8a4c', '#f4f4f4', '#d6202a'], es: ['#c8102e', '#ffc400'], en: ['#1f3c9c', '#f4f4f4', '#d6202a'],
    };
    const fun = ['#ffd23f', '#ff5fa2', '#2f80ed', '#27ae60', '#f4f4f4', '#ff7a30'];
    const cols = hash(a.seg.i * 3) < 0.6 ? sets[lang] : fun;
    const h = FAC_M.ground + 2.3 + hash(a.seg.i) * 0.8;
    const x0 = -bl.setback + 0.1;
    const x1 = br.setback - 0.1;
    const N = 16;
    const sag = 0.9;
    const pt = (k: number) => {
      const f = k / N;
      const x = x0 + (x1 - x0) * f;
      const y = a.y + h - sag * 4 * f * (1 - f);
      return [a.x + a.rx * x, y, a.z + a.rz * x];
    };
    const line = lin('#2a2a2c');
    const fx = Math.sin(a.th) * 0.02;
    const fz = -Math.cos(a.th) * 0.02;
    for (let k = 0; k < N; k++) {
      const p = pt(k);
      const q = pt(k + 1);
      T.plain.quad(p, q, [q[0], q[1] + 0.03, q[2]], [p[0], p[1] + 0.03, p[2]], line);
      // Wimpel: Dreieck unter der Leine
      const m = [(p[0] + q[0]) / 2 + fx, (p[1] + q[1]) / 2 - 0.42, (p[2] + q[2]) / 2 + fz];
      T.plain.tri([p[0] + fx, p[1], p[2] + fz], [q[0] + fx, q[1], q[2] + fz], m, lin(cols[k % cols.length]));
      if (k > 0) T.bulbs.push(p[0], p[1] - 0.06, p[2]);
    }
  }

  private prop(group: THREE.Group, disp: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[], inst: Map<Prop3D, { m: THREE.Matrix4[]; c: THREE.Color[] }>,
    bill: GB, anim: number[], glows: number[], a: Row, sp0: Sprite, s: Seg, lim: number) {
    // Schauplatz: Laternen und Brunnen der Gegend (Paris: Kandelaber, Obelisk auf dem Platz, Wallace-Brunnen),
    // keine Berghütte und keine Wohnmobile auf dem Montmartre
    let sp = sp0;
    if (this.track!.scape?.lamp === 'paris') {
      if (sp.k === 'lamp') sp = { ...sp, k: 'lampParis' };
      else if (sp.k === 'fountain') sp = { ...sp, k: sp.s >= 1.2 ? 'obelisk' : 'wallace', s: 1 };
      else if (sp.k === 'rifugio' || sp.k === 'campervan') return;
    }
    // Brunnen auf dem Platz: Elefantenbrunnen (Chambéry), Dampfhammer (Le Creusot)
    const vm = this.track!.venue?.marks;
    if (sp.k === 'fountain' && vm) {
      if (vm.includes('elephants')) sp = { ...sp, k: 'elephants', s: 1 };
      else if (vm.includes('marteau')) sp = { ...sp, k: 'marteau', s: 1 };
    }
    const sg = sp.x < 0 ? -1 : 1;
    // ax: Abstand wie bei Normalbreite (Profil, Korridor); am Rand rückt alles mit der Breite nach außen
    const ax = Math.abs(sp.x);
    const sx = widen(sp.x, a.e);
    const ex = Math.abs(sx) - ax;
    let h = sp.h;
    // auf und neben der Fahrbahn: mit ihrem Relief (auf dem Gelände und dem See gilt deren Höhe)
    let lift = this.track!.liftRow(a.seg.i, sx);
    const px = a.x + a.rx * sx;
    const pz = a.z + a.rz * sx;
    // nicht auf eine andere Straße stellen (Serpentinen liegen oft nur 40 m auseinander)
    if (ax > EDGE + 1 && this.terrain!.roadDist(this.region!, px, pz) < Math.min(ax + ex - 0.7, EDGE + ex + 2.8)) return;
    if (ax > EDGE && !s.tunnel) {
      const side = sg < 0 ? s.L : s.R;
      if (side.ground === 'water' && ax > EDGE + 4) {
        if (sp.k !== 'boat') return;
        h = this.terrain!.lakeOf(s.sec) - a.y;            // Boote schwimmen auf dem See
        lift = 0;
      } else if (ax > lim - 0.5) {
        h = this.terrain!.heightIn(this.region!, px, pz) - 0.3 - a.y;   // auf der Landschaft
        lift = 0;
      } else {
        const gh = this.groundAt(side, s, sg, ax - EDGE, lim);
        if (gh === null) return;
        h = gh;
      }
    }
    const py = a.y + h + lift;
    const fx = Math.sin(a.th);
    const fz = -Math.cos(a.th);
    if (PROP3D.has(sp.k)) {
      const kind = sp.k as Prop3D;
      let rot = hash(s.i * 31 + Math.round(sp.x * 10)) * Math.PI * 2;
      if (kind === 'fence' || kind === 'vinerow' || kind === 'logs') rot = -a.th;
      if (kind === 'lamp') rot = sp.x < 0 ? Math.atan2(-a.rx, -a.rz) + Math.PI : Math.atan2(a.rx, a.rz) + Math.PI;
      if (kind === 'lamp') rot = sp.x < 0 ? Math.atan2(-Math.cos(a.th), -Math.sin(a.th)) : Math.atan2(Math.cos(a.th), Math.sin(a.th));
      const sc = sp.s * (kind === 'rock' && sp.h > 0.05 ? 1 : 1);
      const fixed = kind === 'lampParis' || kind === 'morris' || kind === 'kiosk' || kind === 'wallace' || kind === 'obelisk'
        || kind === 'calvaire' || kind === 'fronton' || kind === 'elephants' || kind === 'marteau';
      if (kind === 'kiosk' || kind === 'calvaire' || kind === 'fronton' || kind === 'marteau') rot = -a.th + (sp.x < 0 ? Math.PI / 2 : -Math.PI / 2);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(px, py - 0.05, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(sc, sc * (fixed ? 1 : 0.9 + hash(s.i + sp.v) * 0.25), sc));
      const v = 0.85 + hash(s.i * 3 + sp.v) * 0.3;
      // im Dorf stehen keine Bäume am Straßenrand (dort sind Gärten und Häuser)
      if (TREES.has(kind) && this.villages?.inside(s.i * SEG)) return;
      if (TREES.has(kind) && this.cTrees) {
        const [tr, tg, tb] = treeTint(v, hash(s.i * 7 + sp.v), hash(s.i * 11 + sp.v * 3));
        this.cTrees.push(px, py - 0.05, pz, sc, rot, tr, tg, tb, treeVariant(kind, hash(s.i * 13 + sp.v * 7)), 0);
        return;
      }
      let list = inst.get(kind);
      if (!list) { list = { m: [], c: [] }; inst.set(kind, list); }
      list.m.push(m);
      if (TREES.has(kind)) { const [tr, tg, tb] = treeTint(v, hash(s.i * 7 + sp.v), hash(s.i * 11 + sp.v * 3)); list.c.push(new THREE.Color(tr, tg, tb)); }
      else if (kind === 'bush' || kind === 'vinerow') {
        // Büsche und Reben in der Jahreszeit (season.ts): Herbst rotbraun bis gelb (Reben golden), Winter graubraun
        const S = this.season;
        const a = S.autumn * (1 - S.bare * 0.4);
        const vr = kind === 'vinerow' ? [1.5, 1.08, 0.38] : [1.45, 0.82, 0.42];
        const k = (i: number) => 1 + (vr[i] - 1) * a;
        const w = (x: number, y: number) => x + (y - x) * S.bare * 0.75;
        list.c.push(new THREE.Color(v * w(k(0), 0.95), v * (0.95 + hash(s.i) * 0.1) * w(k(1), 0.72) * (1 + S.fresh * 0.08), v * w(k(2), 0.6)));
      } else list.c.push(new THREE.Color(v, v * (0.95 + hash(s.i) * 0.1), v));
      if (kind === 'lamp') {
        const ax = Math.sin(rot) * -0.62;
        const az = Math.cos(rot) * -0.62;
        glows.push(px + ax, py + 4.35, pz + az);
      }
      if (kind === 'lampParis') glows.push(px, py + 4.45, pz);
      return;
    }
    if (sp.k === 'tornante' || sp.k === 'townSign' || sp.k === 'passSign') {
      const sec = this.track!.sections[s.sec];
      const sub = sp.k === 'passSign' ? `${sec.alt.toLocaleString('de-DE')} m` : '';
      const key = `${sp.k}:${sp.text}:${sub}`;
      let tex = this.labelTex.get(key);
      const img = this.bank.label(sp.k, sp.text ?? '', sub);
      if (!tex) { tex = this.tex(img.img, false); this.labelTex.set(key, tex); }
      const t2 = tex;
      const mat = this.matFor(`sign|${key}`, () => new THREE.MeshLambertMaterial({ map: t2, alphaTest: 0.5, side: THREE.DoubleSide }));
      const geo = new THREE.PlaneGeometry(img.w, img.h);
      geo.translate(0, img.h / 2, 0);
      disp.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(px, py, pz);
      mesh.rotation.y = -a.th;
      group.add(mesh);
      return;
    }
    const kind = sp.k === 'chevron' && sp.v === 9 ? 'dosso' : sp.k;
    const def = BILLBOARD[kind];
    if (!def) return;
    // Fahnen der Gegend des Schauplatzes (Trikolore, Gwenn-ha-Du, Ikurriña, Saltire …) statt der italienischen
    const fl = this.track!.scape?.flags;
    if (kind === 'flagpole' && fl?.length && (sp.v % 4 === 1 || sp.v % 4 === 3)) {
      const code = fl[Math.floor(hash(s.i * 5 + sp.v) * fl.length)];
      const fv = FLAG_VARIANT[code];
      if (fv !== undefined) sp = { ...sp, v: fv };
    }
    // Jahreszeit (season.ts): Blumen und Sonnenblumen nur, solange sie blühen (fester Anteil je Ort)
    if ((kind === 'flowers' || kind === 'sunflowers') && hash(sp.v * 31 + Math.round(px * 7)) > Math.min(1, this.season.flowers)) return;
    const e = this.atlas.get(`${kind}:${sp.v % def.variants}`);
    if (!e) return;
    const w = e.w * sp.s;
    const bh = e.h * sp.s;
    // Karte quer zur Straße, Blick zum Fahrer
    const flip = sp.f;
    const l = [px - a.rx * w / 2, py, pz - a.rz * w / 2];
    const rgt = [px + a.rx * w / 2, py, pz + a.rz * w / 2];
    const u0 = flip ? e.u1 : e.u0;
    const u1 = flip ? e.u0 : e.u1;
    bill.quad(l, rgt, [rgt[0], py + bh, rgt[2]], [l[0], py + bh, l[2]], [1, 1, 1], [[u0, e.v0], [u1, e.v0], [u1, e.v1], [u0, e.v1]]);
    // nächstes Animationsbild liegt im Atlas immer rechts daneben – auch bei gespiegelten Karten
    const du = e.du;
    const speed = kind === 'crowd' ? 0.9 + hash(s.i) * 0.8 : 1.2;
    const phase = hash(s.i * 13 + Math.round(sp.x));
    for (let i = 0; i < 6; i++) anim.push(du, phase, speed);
    void fx; void fz;
  }

  private decal(group: THREE.Group, disp: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[], marks: GB, rows: Row[], r: number, d: NonNullable<Seg['decals']>[number], P: (r: Row, x: number, h: number) => number[]) {
    const len = Math.min(d.len, rows.length - 1 - r);
    if (len <= 0) return;
    const H = 0.016;
    if (d.k === 'text' || d.k === 'arrow') {
      const gb = new GB();
      gb.uv = true;
      for (let k = 0; k < len; k++) {
        const a = rows[r + k];
        const b = rows[r + k + 1];
        const v0 = k / d.len;
        const v1 = (k + 1) / d.len;
        // engere Stelle: die Schrift bleibt auf der Fahrbahn
        const wa = d.w * Math.min(1, (ROAD_HALF + a.e) / ROAD_HALF);
        const wb = d.w * Math.min(1, (ROAD_HALF + b.e) / ROAD_HALF);
        // in Streifen quer, damit die Schrift dem Relief der Fahrbahn folgt (sonst taucht sie im Dach unter)
        const M = Math.max(2, Math.ceil((2 * Math.max(wa, wb)) / 0.4));
        for (let q = 0; q < M; q++) {
          const u0 = q / M, u1 = (q + 1) / M;
          const xa0 = d.x - wa + 2 * wa * u0, xa1 = d.x - wa + 2 * wa * u1;
          const xb0 = d.x - wb + 2 * wb * u0, xb1 = d.x - wb + 2 * wb * u1;
          gb.quad(P(a, xa0, H), P(a, xa1, H), P(b, xb1, H), P(b, xb0, H), [1, 1, 1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
        }
      }
      const key = `${d.k}:${d.text}`;
      let tex = this.labelTex.get(key);
      if (!tex) {
        const cv = d.k === 'text' ? roadText(d.text ?? '') : roadArrow((d.text as 'L' | 'R') ?? 'L');
        tex = this.tex(cv, false);
        this.labelTex.set(key, tex);
      }
      const geo = gb.build();
      const t2 = tex;
      const mat = this.matFor(`decal|${key}`, () => new THREE.MeshLambertMaterial({ map: t2, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, opacity: 0.9 }));
      disp.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 2;
      group.add(mesh);
      return;
    }
    for (let k = 0; k < len; k++) {
      const a = rows[r + k];
      const b = rows[r + k + 1];
      // Flickstellen: als Rechteck wirken sie wie Platten – (noch) nicht gezeichnet
      if (d.k === 'patch') continue;
      if (d.k === 'zebra') {
        const ka = Math.min(1, (ROAD_HALF + a.e) / ROAD_HALF), kb = Math.min(1, (ROAD_HALF + b.e) / ROAD_HALF);
        for (let q = -2; q <= 2; q++) marks.quad(P(a, q * 1.05 * ka - 0.25, H), P(a, q * 1.05 * ka + 0.25, H), P(b, q * 1.05 * kb + 0.25, H), P(b, q * 1.05 * kb - 0.25, H), lin('#f2f2ec'));
      }
      else if (d.k === 'grid') for (let q = 0; q < 4; q++) {
        const t0 = q / 4;
        const mid = (u: number[], v: number[], t: number) => [u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t, u[2] + (v[2] - u[2]) * t];
        // über die ganze (auch breitere) Fahrbahn
        // (in Stücken quer: folgt dem Relief der Fahrbahn)
        const Q = ROAD_COLS;
        for (let c = 0; c < Q; c++) {
          const xa0 = -ROAD_HALF - a.e + (2 * (ROAD_HALF + a.e) * c) / Q, xa1 = -ROAD_HALF - a.e + (2 * (ROAD_HALF + a.e) * (c + 1)) / Q;
          const xb0 = -ROAD_HALF - b.e + (2 * (ROAD_HALF + b.e) * c) / Q, xb1 = -ROAD_HALF - b.e + (2 * (ROAD_HALF + b.e) * (c + 1)) / Q;
          const A0 = P(a, xa0, H), A1 = P(a, xa1, H), B0 = P(b, xb0, H), B1 = P(b, xb1, H);
          marks.quad(mid(A0, B0, t0), mid(A1, B1, t0), mid(A1, B1, t0 + 0.12), mid(A0, B0, t0 + 0.12), lin('#bfc3c8'));
        }
      } else if (d.k === 'manhole' && k === 0 && this.paveGB) {
        this.roundCover(this.paveGB.covers, a, b, d.x, 1, Math.floor(hash(a.seg.i * 7 + 1) * 4));
      }
    }
  }

  /**
   * Stadttor am Ortseingang: zwei Türme aus Naturstein mit Zinnen links und rechts der Straße, dazwischen
   * ein Torbogen mit Wehrgang. Darauf das Stadtwappen (Schild in den Farben des Landes) und der Ortsname.
   */
  private gate(T: Town, group: THREE.Group, disp: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[], a: Row, name: string) {
    const fx = Math.sin(a.th);
    const fz = -Math.cos(a.th);
    const P = (lat: number, al: number, h: number) => [a.x + a.rx * lat + fx * al, a.y + h, a.z + a.rz * lat + fz * al];
    const stone = lin('#b9ab92');
    const stoneD = shadeF(stone, 0.78);
    const stoneL = shadeF(stone, 1.06);
    const dark = lin('#2c2420');
    const TW = 4.2;             // Turmbreite (quer)
    const TD = 4.6;             // Turmtiefe (längs)
    const TH = 11.5;            // Turmhöhe
    const AH = 6.2;             // Scheitel des Torbogens
    const WH = 8.6;             // Wehrgang über dem Bogen
    const x0 = EDGE + a.e + 0.5; // Innenkante der Türme (breitere Straße: weiter außen)
    /** Quader mit vier Wänden und Deckel */
    const box = (la0: number, la1: number, al0: number, al1: number, h0: number, h1: number, col: RGBf) => {
      T.plain.quad(P(la0, al0, h0), P(la1, al0, h0), P(la1, al0, h1), P(la0, al0, h1), col);                 // vorn
      T.plain.quad(P(la1, al1, h0), P(la0, al1, h0), P(la0, al1, h1), P(la1, al1, h1), shadeF(col, 0.9));   // hinten
      T.plain.quad(P(la0, al1, h0), P(la0, al0, h0), P(la0, al0, h1), P(la0, al1, h1), shadeF(col, 0.84));  // links
      T.plain.quad(P(la1, al0, h0), P(la1, al1, h0), P(la1, al1, h1), P(la1, al0, h1), shadeF(col, 0.84));  // rechts
      T.plain.quad(P(la0, al0, h1), P(la1, al0, h1), P(la1, al1, h1), P(la0, al1, h1), shadeF(col, 1.04));  // oben
    };
    for (const sg of [-1, 1]) {
      const la0 = sg < 0 ? -x0 - TW : x0;
      const la1 = la0 + TW;
      box(la0, la1, -TD / 2, TD / 2, -0.6, TH, stone);
      // Zinnen
      for (let k = 0; k < 4; k++) {
        const w = TW / 4;
        if (k % 2 === 0) box(la0 + k * w, la0 + (k + 1) * w, -TD / 2, TD / 2, TH, TH + 0.9, stoneL);
      }
      // Schießscharten
      for (const h of [3.5, 7.5]) {
        const c = (la0 + la1) / 2;
        T.plain.quad(P(c - 0.14, -TD / 2 - 0.02, h), P(c + 0.14, -TD / 2 - 0.02, h), P(c + 0.14, -TD / 2 - 0.02, h + 1.1), P(c - 0.14, -TD / 2 - 0.02, h + 1.1), dark);
      }
    }
    // Wehrgang über der Straße: Wand vorn und hinten mit Zinnen, Decke, Bogenlaibung
    const D2 = TD / 2 - 0.6;
    for (const sgn of [-1, 1]) {
      const al = sgn * D2;
      const face = (la0: number, la1: number, h0: number, h1: number, col: RGBf) => {
        if (sgn < 0) T.plain.quad(P(la0, al, h0), P(la1, al, h0), P(la1, al, h1), P(la0, al, h1), col);
        else T.plain.quad(P(la1, al, h0), P(la0, al, h0), P(la0, al, h1), P(la1, al, h1), col);
      };
      // Wand oberhalb des Bogens
      face(-x0, x0, AH, WH, sgn < 0 ? stone : stoneD);
      // Bogenzwickel: Wand von der Kämpferhöhe bis zum Scheitel, Öffnung als Halbkreis frei
      const R = x0;
      const N = 10;
      for (let q = 0; q < N; q++) {
        const a0 = Math.PI * (q / N);
        const a1 = Math.PI * ((q + 1) / N);
        const p0 = P(-Math.cos(a0) * R, al, AH - R + Math.sin(a0) * R);
        const p1 = P(-Math.cos(a1) * R, al, AH - R + Math.sin(a1) * R);
        const t0 = P(-Math.cos(a0) * R, al, AH);
        const t1 = P(-Math.cos(a1) * R, al, AH);
        if (sgn < 0) T.plain.quad(p0, p1, t1, t0, stone); else T.plain.quad(p1, p0, t0, t1, stoneD);
      }
      // Zinnen
      for (let k = 0; k < 7; k++) {
        const w = (2 * x0) / 7;
        if (k % 2 === 0) face(-x0 + k * w, -x0 + (k + 1) * w, WH, WH + 0.8, sgn < 0 ? stoneL : stone);
      }
    }
    // Bogenlaibung (Innenseite des Bogens, von unten sichtbar) und Decke des Wehrgangs
    {
      const R = x0;
      const N = 10;
      for (let q = 0; q < N; q++) {
        const a0 = Math.PI * (q / N);
        const a1 = Math.PI * ((q + 1) / N);
        const l0 = -Math.cos(a0) * R;
        const l1 = -Math.cos(a1) * R;
        const h0 = AH - R + Math.sin(a0) * R;
        const h1 = AH - R + Math.sin(a1) * R;
        T.plain.quad(P(l0, -D2, h0), P(l0, D2, h0), P(l1, D2, h1), P(l1, -D2, h1), shadeF(stone, 0.7));
      }
      T.plain.quad(P(-x0, -D2, WH), P(x0, -D2, WH), P(x0, D2, WH), P(-x0, D2, WH), shadeF(stone, 1.02));
    }
    // Wappen und Ortsname zur Anfahrt hin (Schild in den Landesfarben)
    const lang = this.track!.lang;
    const cols = lang === 'fr' ? ['#1f3c9c', '#f4f4f4', '#d6202a'] : lang === 'it' ? ['#1f8a4c', '#f4f4f4', '#d6202a'] : lang === 'es' ? ['#c8102e', '#ffc400', '#c8102e'] : ['#1f3c9c', '#f4f4f4', '#d6202a'];
    const al = -D2 - 0.06;
    const sw = 1.4;
    const sh = 1.6;
    const hy = AH + 0.4;
    for (let k = 0; k < 3; k++) {
      const u0 = -sw / 2 + (k * sw) / 3;
      const u1 = -sw / 2 + ((k + 1) * sw) / 3;
      T.plain.quad(P(u0, al, hy), P(u1, al, hy), P(u1, al, hy + sh), P(u0, al, hy + sh), lin(cols[k]));
    }
    T.plain.tri(P(-sw / 2, al, hy), P(sw / 2, al, hy), P(0, al, hy - 0.5), lin(cols[1]));
    // Ortsname als Tafel über dem Bogen
    const key = `gate:${name}`;
    let tex = this.labelTex.get(key);
    if (!tex) {
      tex = this.tex(plaqueTex(name.toUpperCase(), ''), false);
      this.labelTex.set(key, tex);
    }
    const pg = new GB();
    pg.uv = true;
    const pw = 3.6;
    const ph = pw * 120 / 512;
    const py = hy + sh + 0.25;
    pg.quad(P(-pw / 2, al, py), P(pw / 2, al, py), P(pw / 2, al, py + ph), P(-pw / 2, al, py + ph), [1, 1, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    const geo = pg.build();
    const t2 = tex;
    const mat = this.matFor(`plaque|${key}`, () => new THREE.MeshLambertMaterial({ map: t2, side: THREE.DoubleSide }));
    disp.push(geo);
    group.add(new THREE.Mesh(geo, mat));
  }

  private arch(group: THREE.Group, disp: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[], a: Row, banner: Banner | { kind: string; text: string; sub?: string }, color: string) {
    if (OFFICIAL.has(banner.kind)) { this.officialArch(group, disp, a, banner, banner.kind as ArchStyle); return; }
    const light = color === '#ffffff' || color === '#ffd23f';
    const main = banner.kind === 'gpm' ? `GPM · ${banner.text}` : banner.kind === 'welcome' ? `Benvenuti a ${banner.text}` : banner.text;
    // übrige Bögen (Willkommen im Ort) tragen links und rechts Werbung eines Teams, fest je Bogen; Bestmarken ohne
    // (nur jeder dritte Bogen)
    const sponsor = banner.kind === 'arch' || hash(a.seg.i * 17 + 3) >= 1 / 3 ? null : TEAMS[1 + Math.floor(hash(a.seg.i * 13 + 5) * (TEAMS.length - 1))];
    const key = `arch:${main}:${banner.sub ?? ''}:${color}:${sponsor?.id ?? ''}`;
    let tex = this.labelTex.get(key);
    if (!tex) {
      tex = this.tex(bannerTex(main.toUpperCase(), banner.sub ?? '', color, light ? '#1a1a1a' : '#ffffff', sponsor), false);
      this.labelTex.set(key, tex);
    }
    // Masten neben dem Bankett (breitere Straße: weiter auseinander)
    const span = (EDGE + a.e) * 2 + 0.6;
    const g = new THREE.Group();
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a8 });
    const pole = new THREE.CylinderGeometry(0.08, 0.1, 5.8, 8);
    pole.translate(0, 2.9, 0);
    const bannerMat = new THREE.MeshLambertMaterial({ map: tex });
    const sideMat = new THREE.MeshLambertMaterial({ color });
    const box = new THREE.BoxGeometry(span, 1.3, 0.18);
    // (Name für die Kostenanalyse: gehört zu Banden, Schildern, Bögen)
    poleMat.name = bannerMat.name = sideMat.name = 'arch';
    disp.push(poleMat, pole, bannerMat, sideMat, box);
    for (const sg of [-1, 1]) {
      const m = new THREE.Mesh(pole, poleMat);
      m.position.set(sg * span / 2, 0, 0);
      g.add(m);
    }
    const bm = new THREE.Mesh(box, [sideMat, sideMat, sideMat, sideMat, bannerMat, bannerMat]);
    bm.position.set(0, 5.1, 0);
    g.add(bm);
    g.position.set(a.x, a.y, a.z);
    g.rotation.y = -a.th;
    group.add(g);
  }

  /**
   * Offizieller Bogen (Ziel, Start, Bergwertung, Sprint, letzter Kilometer, Zwischenzeit) – soll man auf den ersten
   * Blick von Werbung unterscheiden: höher und breiter als alles andere, dicke Masten im Muster der Wertung, ein
   * großes Schild ohne Werbung, eine Linie auf der Fahrbahn (im Ziel kariert), beim letzten Kilometer das rote Dreieck.
   */
  private officialArch(group: THREE.Group, disp: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[], a: Row, banner: { kind: string; text: string; sub?: string }, style: ArchStyle) {
    const L = ARCH_LOOK[style];
    const text = style === 'gpm' ? `GPM · ${banner.text}` : style === 'finish' ? 'ZIEL' : banner.text;
    const sub = style === 'finish' ? [banner.text, banner.sub].filter(Boolean).join(' · ')
      : style === 'gpm' ? ['Bergwertung', banner.sub].filter(Boolean).join(' · ')
        : style === 'sprint' ? ['Zwischensprint', banner.sub].filter(Boolean).join(' · ')
          : style === 'flamme' ? 'Letzter Kilometer' : banner.sub ?? '';
    const key = `official:${style}:${text}:${sub}`;
    let tex = this.labelTex.get(key);
    if (!tex) { tex = this.tex(officialBannerTex(text.toUpperCase(), sub.toUpperCase(), style), false); this.labelTex.set(key, tex); }
    const pkey = `officialPost:${style}`;
    let ptex = this.labelTex.get(pkey);
    if (!ptex) { ptex = this.tex(archPostTex(style), true); ptex.repeat.set(1, 5); this.labelTex.set(pkey, ptex); }
    const lkey = `roadLine:${style === 'finish' ? 1 : 0}`;
    let ltex = this.labelTex.get(lkey);
    if (!ltex) { ltex = this.tex(roadLineTex(style === 'finish'), true); this.labelTex.set(lkey, ltex); }
    const t = this.track!;
    // Masten deutlich neben dem Bankett, Schild breit darüber
    const span = (EDGE + a.e) * 2 + 1.4;
    const POST = 0.5;
    const HIGH = 7.6;
    const BH = 2.1;
    const g = new THREE.Group();
    const postMat = new THREE.MeshLambertMaterial({ map: ptex });
    const bannerMat = new THREE.MeshLambertMaterial({ map: tex });
    const sideMat = new THREE.MeshLambertMaterial({ color: L.a });
    const lineMat = new THREE.MeshLambertMaterial({ map: ltex, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const post = new THREE.BoxGeometry(POST, HIGH, POST);
    post.translate(0, HIGH / 2, 0);
    const box = new THREE.BoxGeometry(span + POST, BH, 0.45);
    postMat.name = bannerMat.name = sideMat.name = lineMat.name = 'arch';
    disp.push(postMat, bannerMat, sideMat, lineMat, post, box);
    for (const sg of [-1, 1]) {
      const m = new THREE.Mesh(post, postMat);
      m.position.set(sg * span / 2, 0, 0);
      g.add(m);
    }
    const bm = new THREE.Mesh(box, [sideMat, sideMat, sideMat, sideMat, bannerMat, bannerMat]);
    bm.position.set(0, HIGH - BH / 2 - 0.15, 0);
    g.add(bm);
    if (style === 'flamme') {
      // das rote Dreieck unter dem Schild
      const tri = new THREE.BufferGeometry();
      const yb = HIGH - BH - 0.15;
      tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.9, yb, 0, 0.9, yb, 0, 0, yb - 1.5, 0], 3));
      tri.computeVertexNormals();
      const triMat = new THREE.MeshLambertMaterial({ color: L.a, side: THREE.DoubleSide });
      triMat.name = 'arch';
      disp.push(tri, triMat);
      g.add(new THREE.Mesh(tri, triMat));
    }
    // Linie auf der Fahrbahn, dem Relief folgend (im Ziel breit und kariert)
    const depth = style === 'finish' ? 0.9 : 0.4;
    const N = 24;
    const half = EDGE - 0.08;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= N; i++) {
      const x0 = -half + (2 * half * i) / N;
      const x = widen(x0, a.e);
      const y = t.lift(a.m, x) + 0.02;
      const u = (i / N) * (span / 4);
      pos.push(x, y, -depth / 2, x, y, depth / 2);
      uv.push(u, 0, u, 1);
      if (i < N) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    lg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    lg.setIndex(idx);
    lg.computeVertexNormals();
    disp.push(lg);
    g.add(new THREE.Mesh(lg, lineMat));
    g.position.set(a.x, a.y, a.z);
    g.rotation.y = -a.th;
    group.add(g);
  }

  /**
   * Fan-Bogen am Anfang von Stück i? Zelle des Spruchbands oder null. In jeder Zuschauerzone 28 m nach ihrem
   * Anfang einer, bei langen Zonen (Passhöhe, Ortsdurchfahrt, Finale) alle 88 m ein weiterer – nur wo die Zone
   * weitergeht, und nie dichter als 14 m an anderen Bögen oder Tunneln (Wimpelketten weichen ihm). Nur gerade Stücke: dort
   * beginnt ein Zuschauergrüppchen, der Mast steht in der Lücke zwischen zweien.
   */
  private fanAt(i: number): number | null {
    const t = this.track;
    if (!t || i < t.first || (i & 1)) return null;
    const hit = this.fanCache.get(i);
    if (hit !== undefined) return hit;
    if (this.fanCache.size > 5000) this.fanCache.clear();
    let res: number | null = null;
    const s = t.seg(i);
    if (s.crowd && !s.tunnel && !s.banner && !s.hairpin && !(s.bridge > 0)) {
      let k = 0;
      while (k < 1500 && i - k - 1 >= t.first && t.seg(i - k - 1).crowd) k++;
      // erster Bogen auf einem geraden Stück (gerade Zahl), weitere im festen Abstand
      const k0 = FAN_FIRST + ((i - k + FAN_FIRST) & 1);
      let ok = k >= k0 && (k - k0) % FAN_EVERY === 0;
      for (let j = 1; ok && j <= 6; j++) if (!t.seg(i + j).crowd) ok = false;
      for (let j = -7; ok && j <= 7; j++) {
        if (i + j < t.first) continue;
        const o = t.seg(i + j);
        if (o.banner || o.tunnel || o.portal) ok = false;
      }
      if (ok) res = Math.floor(hash(i * 31 + 7) * FAN_CELLS);
    }
    this.fanCache.set(i, res);
    return res;
  }

  /** Steht ein Fan-Bogen höchstens 8 m von Stück i entfernt? (dann hängt dort keine Wimpelkette) */
  private fanNear(i: number): boolean {
    for (let j = -4; j <= 4; j++) if (this.fanAt(i + j) !== null) return true;
    return false;
  }

  /** Geteilte Teile der Fan-Bögen: Mast, Wimpel, je Spruchband das durchhängende Tuch (vorn und hinten lesbar) */
  private fanParts(cell: number) {
    const fg = (this.fanGeo ??= (() => {
      const pole = new THREE.CylinderGeometry(0.055, 0.075, FAN_POLE, 8);
      pole.translate(0, FAN_POLE / 2, 0);
      // Wimpel an der Mastspitze, weht der Fahrerin entgegen
      const pennant = new THREE.BufferGeometry();
      pennant.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.5, 0, 0, -0.25, 0.75], 3));
      pennant.computeVertexNormals();
      return { pole, pennant, cells: [] };
    })());
    let c = fg.cells[cell];
    if (!c) {
      const bw = FAN_SPAN - 0.16;
      const bh = bw * FAN_ASPECT;
      const front = new THREE.PlaneGeometry(bw, bh, 16, 1);
      const pos = front.getAttribute('position');
      const uv = front.getAttribute('uv');
      const [u0, v0, u1, v1] = fanCell(cell);
      for (let k = 0; k < pos.count; k++) {
        const q = (2 * pos.getX(k)) / bw;
        pos.setY(k, pos.getY(k) + FAN_Y - FAN_SAG * (1 - q * q));
        pos.setZ(k, 0.012);
        uv.setXY(k, u0 + (u1 - u0) * uv.getX(k), v0 + (v1 - v0) * uv.getY(k));
      }
      front.computeVertexNormals();
      const back = front.clone();
      back.rotateY(Math.PI);
      c = fg.cells[cell] = { front, back };
    }
    return { pole: fg.pole, pennant: fg.pennant, ...c };
  }

  /**
   * Fan-Bogen: zwei Masten knapp hinter der Absperrung, dazwischen ein Spruchband quer über die Straße. Masten und
   * Wimpel landen im Sammler der einfarbigen Teile, die Bänder in einem je Abschnitt (statt sechs Netze je Bogen)
   */
  private fanArch(fans: GB, plain: GB, a: Row, cell: number) {
    if (!this.fanMat) return;
    const parts = this.fanParts(cell);
    const m = new THREE.Matrix4().makeRotationY(-a.th).setPosition(a.x, a.y, a.z);
    // breitere Straße: Masten weiter auseinander, das Band entsprechend breiter
    const span = FAN_SPAN + 2 * a.e;
    const wide = new THREE.Matrix4().makeScale(span / FAN_SPAN, 1, 1).premultiply(m);
    const uvOf = (g: THREE.BufferGeometry) => {
      const src = g.index ? g.toNonIndexed() : g;
      const pos = src.getAttribute('position');
      const uv = src.getAttribute('uv');
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(wide);
        fans.vert(v.x, v.y, v.z, [1, 1, 1], uv.getX(i), uv.getY(i));
      }
    };
    uvOf(parts.front);
    uvOf(parts.back);
    const pole = lin('#d8d2c4');
    const flag = lin('#ff5fa2');
    const pm = new THREE.Matrix4();
    for (const sg of [-1, 1]) {
      pm.makeTranslation((sg * span) / 2, 0, 0).premultiply(m);
      plain.add(parts.pole, pm, pole);
      pm.makeTranslation((sg * span) / 2, FAN_POLE - 0.05, 0).premultiply(m);
      // Wimpel beidseitig (das Material der einfarbigen Teile ist beidseitig – nur die Normale muss stimmen)
      plain.add(parts.pennant, pm, flag);
    }
  }

  // ------------------------------------------------------------------ Fahrer, Objekte, Partikel

  /**
   * Zuschauer für einen 4-m-Abschnitt: in Fanzonen zwei bis drei lockere Reihen hinter der Absperrung,
   * Kinder vorn, ab und zu ein Kind auf den Schultern; in Kehren (v 8) eine Traube, sonst (v 9) ein
   * kleines Grüppchen am Rand. Immer gleich für dieselbe Stelle.
   */
  private crowdPeople(out: Person[], s: Seg, sg: number, lim: number, v: number, dx0: number) {
    const t = this.track!;
    // Zeitfahren: dort wartet der Teamwagen hinter der Absperrung
    if (ttCrowdGap(t, s.i, sg)) return;
    const biome = t.sections[s.sec].biome;
    const zone: Zone = biome === 'pass' ? 'pass' : biome === 'village' ? 'village' : 'tifosi';
    const r = mulberry32(s.i * 7919 + (sg > 0 ? 104729 : 0));
    const group = v === 9;
    // dichter als früher: in der Ferne sind es Bilder (zwei Dreiecke je Mensch)
    // dicht (alle als Bilder: Platz für viele): hinter den Banden bis zu sechs Reihen, in den Kehren eine große Traube
    const rows = group ? (r() < 0.75 ? [dx0, dx0 + 0.78, dx0 + 1.56] : [dx0, dx0 + 0.78])
      : v === 8 ? [0.45, 1.2, 1.95, 2.7, 3.45] : zone === 'village' ? [0.32, 1.02, 1.7, 2.4] : [0.38, 1.1, 1.82, 2.55, 3.3, 4.05];
    // La-Ola: in manchen Fanzonen läuft eine Welle die Absperrung entlang (alle 40 m ein Wellenberg)
    const ola = zone === 'tifosi' && s.crowd && !group && hash(Math.floor(s.i / 30) * 31 + 7) < 0.3;
    const side = sg < 0 ? s.L : s.R;
    const w = this.w2;
    const pr = this.profile(side, s, sg, lim);
    const ground = (dx: number) => {
      const o = pr.o;
      for (let k = 0; k < o.length - 1; k++) {
        if (dx <= o[k + 1]) return pr.h[k] + (pr.h[k + 1] - pr.h[k]) * Math.max(0, Math.min(1, (dx - o[k]) / Math.max(1e-6, o[k + 1] - o[k])));
      }
      return pr.h[pr.h.length - 1];
    };
    const place = (p: Person, u: number, dx: number) => {
      const gh = ground(dx);
      // breitere Straße: die Reihen rücken mit dem Bankett nach außen
      t.world(s.i * SEG + u, sg * (EDGE + t.extraAt(s.i * SEG + u) + dx), gh, w);
      p.x = w.x; p.y = w.y; p.z = w.z;
      // Blick zur Straße, etwas dorthin, wo die Fahrer herkommen
      const rx = -sg * Math.cos(w.th);
      const rz = -sg * Math.sin(w.th);
      const bx = -Math.sin(w.th);
      const bz = Math.cos(w.th);
      // Schilder halten Fans den Ankommenden entgegen (schräg, etwa 45°) – so liest man sie schon von Weitem
      const sign = p.act === Act.sign;
      const k = sign ? 0.85 + r() * 0.3 : 0.25 + r() * 0.45;
      const j = (r() - 0.5) * (sign ? 0.16 : 0.5);
      p.yaw = Math.atan2(rx + bx * k, rz + bz * k) + j;
    };
    // Masten der Fan-Bögen (am Anfang dieses und der nächsten Stücke): dort steht vorn niemand
    const poles: number[] = [];
    if (s.crowd) for (let d = 0; d <= 2; d++) if (this.fanAt(s.i + d)) poles.push(d * SEG);
    for (let ri = 0; ri < rows.length; ri++) {
      if (zone === 'tifosi' && ri >= 3 && r() < 0.2 + (ri - 3) * 0.15) continue;
      // Abstände so, dass sich niemand überschneidet – auch nicht mit dem Nachbarabschnitt (alle 4 m)
      let u = group ? r() * 1.2 : 0.3 + r() * 0.2;
      const step = group ? [0.55, 0.4] : ri === 0 ? [0.62, 0.18] : ri === 1 ? [0.68, 0.24] : ri === 2 ? [0.74, 0.3] : [0.8, 0.36];
      const end = group ? 2.6 + r() * 4.2 : 3.7;
      while (u < end) {
        let dx = rows[ri] + (r() - 0.5) * (ri ? 0.2 : 0.06);
        if (EDGE + dx > lim - 0.45) break;
        if (ri === 0 && poles.some((q) => Math.abs(u - q) < 0.34)) { u += 0.32; continue; }
        const kid = ri === 0 && r() < 0.1;
        if (kid) dx -= 0.06;
        const p = randomPerson(r, zone, { row: Math.min(ri, 3), kid });
        if (!s.crowd && p.act === Act.lean) p.act = Act.idle; // ohne Absperrung lehnt sich niemand an
        if (group && r() < 0.2) p.act = Act.sign;
        // auch in der ersten Reihe ein paar Schilder – die liest man am besten
        if (ri === 0 && !kid && !group && r() < 0.05) p.act = Act.sign;
        if (p.act === Act.sign) {
          // das große Schild braucht Platz zu beiden Seiten (und keinen Mast mittendrin)
          if (ri === 0 && poles.some((q) => Math.abs(u + 0.4 - q) < 1.05)) p.act = Act.cheer;
          else { u += 0.4; if (u >= end) break; }
        }
        if (p.act === Act.sign && p.hatType === 5) p.act = Act.devil; // der Teufel hält kein Schild
        if (p.act === Act.sign) p.cup = false;
        if (ola && p.act !== Act.sign && p.act !== Act.flag && p.act !== Act.devil && r() < 0.85) {
          p.act = Act.ola;
          // Phase aus dem Ort: die Welle läuft der Straße entlang den Fahrern entgegen
          p.phase = ((s.i * SEG + u) * 0.03) / 37;
        }
        place(p, u, dx);
        out.push(p);
        if (p.act === Act.sign) this.signRoll(p, r);
        // Fahnen und Schilder brauchen Platz
        const wide = p.act === Act.flag ? 0.4 : p.act === Act.sign ? 0.75 : p.act === Act.wave ? 0.12 : 0;
        u += step[0] + wide + r() * step[1] + (!group && r() < 0.06 ? 0.5 + r() * 0.7 : 0);
      }
    }
  }

  /**
   * Feste Zuschauergruppe (Vorlage gi) am Rand von Stück s: auf dem Querprofil, zur Straße und den ankommenden
   * Fahrern gedreht. Nur wo der Hang flach genug ist.
   */
  private crowdGroup(out: Person[], s: Seg, sg: number, lim: number, gi: number) {
    const t = this.track!;
    const side = sg < 0 ? s.L : s.R;
    const pr = this.profile(side, s, sg, lim);
    const ground = (dx: number) => {
      const o = pr.o;
      for (let k = 0; k < o.length - 1; k++) {
        if (dx <= o[k + 1]) return pr.h[k] + (pr.h[k + 1] - pr.h[k]) * Math.max(0, Math.min(1, (dx - o[k]) / Math.max(1e-6, o[k + 1] - o[k])));
      }
      return pr.h[pr.h.length - 1];
    };
    const r = mulberry32(s.i * 4421 + (sg > 0 ? 17 : 3));
    const q0 = 0.5 + r() * 1.6;
    // zu steil (Böschung): lieber keine Gruppe
    if (Math.abs(ground(q0 + 2.4) - ground(q0)) > 1.6) return;
    if (EDGE + q0 + 2.4 > lim - 0.45) return;
    const biome = t.sections[s.sec].biome;
    const zone: Zone = biome === 'pass' ? 'pass' : biome === 'village' ? 'village' : 'tifosi';
    const w = this.w2;
    r(); // (früher die Farbe der Klappstühle – die Folge der Zufallszahlen bleibt gleich)
    for (const m of GROUPS[gi]) {
      const u = m.u + (r() - 0.5) * 0.15;
      const dq = q0 + m.q + (r() - 0.5) * 0.15;
      const z = s.i * SEG + u;
      const gh = ground(dq);
      const p = randomPerson(r, zone, { row: 1, kid: !!m.kid });
      p.act = m.act;
      if (p.hatType === 5 && m.act !== Act.cheer && m.act !== Act.idle) p.hatType = 0;
      t.world(z, sg * (EDGE + t.extraAt(z) + dq), gh, w);
      p.x = w.x; p.y = w.y; p.z = w.z;
      // zur Straße, etwas dorthin, wo die Fahrer herkommen
      const rx = -sg * Math.cos(w.th), rz = -sg * Math.sin(w.th);
      const bx = -Math.sin(w.th), bz = Math.cos(w.th);
      const k = 0.35 + r() * 0.4;
      p.yaw = Math.atan2(rx + bx * k, rz + bz * k) + (r() - 0.5) * 0.4;
      out.push(p);
    }
  }

  /**
   * Zuschauer auf den Boden des Abschnitts stellen: je Person die Flächen genau darunter (Dreiecke der Bodennetze in
   * einem 2-m-Raster, nur Zellen mit Menschen). Steht sie bis 0,3 m darüber oder bis 0,6 m darin, rückt sie auf die
   * Fläche; schwebt sie höher oder ist darunter nichts, fällt sie weg. Danach die Pappschilder der Übriggebliebenen.
   */
  private groundPeople(people: Person[][], gbs: GB[]) {
    const CELL = 2;
    const key = (x: number, z: number) => Math.floor(x / CELL) * 100003 + Math.floor(z / CELL);
    const grid = new Map<number, number[]>();
    for (const list of people) for (const p of list) grid.set(key(p.x, p.z), []);
    if (grid.size) {
      for (const gb of gbs) {
        const a = gb.p.a;
        const n = gb.p.length;
        for (let i = 0; i + 8 < n; i += 9) {
          const x0 = Math.min(a[i], a[i + 3], a[i + 6]), x1 = Math.max(a[i], a[i + 3], a[i + 6]);
          const z0 = Math.min(a[i + 2], a[i + 5], a[i + 8]), z1 = Math.max(a[i + 2], a[i + 5], a[i + 8]);
          for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) {
            for (let gz = Math.floor(z0 / CELL); gz <= Math.floor(z1 / CELL); gz++) {
              const c = grid.get(gx * 100003 + gz);
              if (c) for (let k = 0; k < 9; k++) c.push(a[i + k]);
            }
          }
        }
      }
      for (const list of people) {
        let o = 0;
        for (const p of list) {
          const c = grid.get(key(p.x, p.z))!;
          let best = -Infinity;
          for (let i = 0; i < c.length; i += 9) {
            const ax = c[i], ay = c[i + 1], az = c[i + 2], bx = c[i + 3], by = c[i + 4], bz = c[i + 5], cx = c[i + 6], cy = c[i + 7], cz = c[i + 8];
            const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
            if (Math.abs(d) < 1e-6) continue;
            const l1 = ((bz - cz) * (p.x - cx) + (cx - bx) * (p.z - cz)) / d;
            const l2 = ((cz - az) * (p.x - cx) + (ax - cx) * (p.z - cz)) / d;
            const l3 = 1 - l1 - l2;
            if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
            const h = l1 * ay + l2 * by + l3 * cy;
            if (h <= p.y + 0.6 && h > best) best = h;
          }
          if (best === -Infinity || p.y - best > 0.3) { this.signs.delete(p); continue; }
          p.y = best;
          list[o++] = p;
        }
        list.length = o;
      }
    }
    for (const list of people) {
      for (const p of list) {
        const sb = this.signs.get(p);
        if (!sb) continue;
        this.signBoard(p, sb[0], sb[1]);
        this.signs.delete(p);
      }
    }
  }

  /** Schilder der Fans: Größe und Spruch jetzt würfeln (gleiche Folge wie immer), gezeichnet erst nach der Bodenprüfung */
  private signs = new Map<Person, [number, number]>();
  private signRoll(p: Person, r: () => number) {
    this.signs.set(p, [0.78 + r() * 0.1, Math.floor(r() * SIGN_COUNT)]);
  }

  /**
   * Pappschild über dem Kopf eines Fans, den ankommenden Fahrern zugedreht; Rückseite Pappe.
   * Groß (gut 1,6 m × 0,8 m) – kleinere Schilder ließen sich im Vorbeifahren nicht lesen.
   */
  private signBoard(p: Person, w: number, cell: number) {
    const gb = this.adsGB;
    if (!gb) return;
    const h = p.height;
    const tall = w * 0.5; // Seitenverhältnis der Zelle im Atlas (2 : 1)
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    const rx = Math.cos(p.yaw);
    const rz = -Math.sin(p.yaw);
    const cx = p.x + fx * 0.36 * h;
    const cz = p.z + fz * 0.36 * h;
    const y0 = p.y + 1.8 * h;
    const y1 = y0 + tall * 2;
    const tilt = 0.08 * h; // oben etwas nach hinten
    const pt = (sx: number, y: number, back: number) => [cx + rx * sx - fx * back, y, cz + rz * sx - fz * back];
    const [u0, v0, u1, v1] = adCell(cell, true);
    const card: RGBf = lin('#b08a5a');
    gb.quad(pt(-w, y0, 0), pt(w, y0, 0), pt(w, y1, tilt), pt(-w, y1, tilt), card, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  }

  /** Zuschauer schauen dem Fahrer nach; ein paar Fans laufen ein Stück neben ihm her */
  private updateCrowd(g: RaceView, dt: number) {
    const pm = this.player;
    if (pm) this.crowdU.uRider.value.copy(pm.group.position);
    const cp = this.camera.position;
    // Zuschauer als Bilder bis gut hinter das Ende der gebauten Strecke – mit kürzerer Sicht auch weniger weit (in
    // den Orten und am Ziel stehen sie zu Hunderten; in der Ferne bleiben nur Punkte, aber jeder kostet)
    const crowdFar = Math.min(CROWD_FAR, this.range.ahead + 250);
    for (const ch of this.chunks.values()) {
      // Kleinteile der Häuser nur in der Nähe (in der Ferne wenige Bildpunkte, aber viele Dreiecke)
      const dt0 = ch.detail;
      if (dt0) {
        const dd = Math.hypot(cp.x - dt0.c.x, cp.z - dt0.c.z) - dt0.r;
        const vis = dt0.mesh.visible ? dd < DETAIL_FAR + 10 : dd < DETAIL_FAR;
        if (vis !== dt0.mesh.visible) dt0.mesh.visible = vis;
      }
      for (const b of ch.crowd) {
        // Welche Stufe ein Mensch zeigt, entscheidet der Shader je Person (fein bis ~20 m, einfach bis ~50 m,
        // dahinter Bilder – mit weichen, gerasterten Übergängen). Hier nur: Gruppen weglassen, die gerade
        // niemanden in dieser Stufe haben (waagrechter Abstand wie im Shader)
        // (alle Zuschauer sind Bilder: nur in der Ferne weglassen)
        const near = false;
        const mid = false;
        const spr = Math.hypot(cp.x - b.sc.x, cp.z - b.sc.z) - b.sr < crowdFar;
        const lod = spr ? 4 : 0;
        if (lod === b.lod) continue;
        b.lod = lod;
        for (const m of b.near) m.visible = near;
        for (const m of b.mid) m.visible = mid;
        if (b.spr) b.spr.visible = spr;
      }
    }
    // Läufer: warten jubelnd am Rand, laufen los, wenn der Fahrer kommt, und lassen sich dann zurückfallen
    const t = g.track;
    const pz = g.p.z;
    if (g.phase === 'playing' || g.phase === 'ready' || g.phase === 'countdown') {
      // weit genug voraus, dass sie unsichtbar beginnen (sie blenden ab ~124 m Abstand ein)
      const ahead = pz + 132;
      if (ahead > this.runNext && this.runners.length < 4 && t.segAt(ahead).crowd && !t.segAt(ahead).tunnel) {
        const r = Math.random;
        const sg = r() < 0.5 ? -1 : 1;
        const zone: Zone = t.sections[t.segAt(ahead).sec].biome === 'pass' ? 'pass' : 'tifosi';
        const p = randomPerson(r, zone, { row: 0, runner: true });
        const flag = p.act === Act.runFlag;
        this.runners.push({ z: ahead, x: sg * (ROAD_HALF + 0.42 + r() * 0.12), v: 0, go: false, p, act: p.act, yaw: 0, flag });
        this.runNext = ahead + 26 + r() * 34;
      }
    }
    const w = this.w2;
    let n = 0;
    this.runners = this.runners.filter((ru) => ru.z > pz - 30);
    const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
    for (const ru of this.runners) {
      const gap = ru.z - pz;
      if (!ru.go && gap < 20) ru.go = true;
      if (ru.go) {
        // anlaufen, solange der Fahrer noch dran ist; danach austrudeln
        const passed = gap < -3;
        // flotter Lauf, kein Sprint: der Fahrer zieht zügig vorbei
        const target = passed ? 0 : 6.2;
        const acc = passed ? -2.8 : 3.4;
        ru.v = passed ? Math.max(target, ru.v + acc * dt) : Math.min(target, ru.v + acc * dt);
        ru.z += ru.v * dt;
      }
      // am Fahrbahnrand (breitere Straße: weiter außen)
      t.world(ru.z, ru.x + Math.sign(ru.x) * t.extraAt(ru.z), -0.04, w);
      const p = ru.p;
      p.x = w.x; p.y = w.y; p.z = w.z;
      const fwd = Math.atan2(Math.sin(w.th), -Math.cos(w.th));
      const toRider = Math.atan2(-Math.sin(w.th), Math.cos(w.th)) - Math.sign(ru.x) * 0.6;
      let want = toRider;
      if (ru.v > 1.2) {
        want = fwd;
        p.act = ru.v > 4.2 ? (ru.flag ? Act.runFlag : Act.run) : ru.flag ? Act.jogFlag : Act.jog;
      } else {
        p.act = ru.flag ? Act.flag : p.hatType === 5 ? Act.devil : Act.cheer;
        if (ru.go && gap < -3) want = fwd; // schaut dem Fahrer nach
      }
      if (!ru.go && ru.yaw === 0) ru.yaw = want;
      ru.yaw += angDiff(want, ru.yaw) * Math.min(1, dt * 5);
      p.yaw = ru.yaw;
      if (n < 6) packPerson(p, this.runBuf.array as Float32Array, n++);
    }
    // im ersten Bild ohne Läufer gezeichnet (0 Instanzen): der Shader entsteht beim Start, nicht mitten im Rennen
    const first = !this.runMeshes.length;
    if (first) {
      for (const kind of KINDS) {
        const geo = crowdGeometry(kind, 0, this.runBuf, 0);
        if (!geo) continue;
        const m = new THREE.Mesh(geo, this.runMat);
        m.frustumCulled = false;
        this.runMeshes.push(m);
        this.scene.add(m);
      }
    }
    for (const m of this.runMeshes) {
      (m.geometry as THREE.InstancedBufferGeometry).instanceCount = n;
      m.visible = n > 0 || first;
    }
    if (n) this.runBuf.needsUpdate = true;
  }

  /** Namensschilder im Bild: Position, Deckkraft (weich ein- und ausgeblendet) */
  private tagView = new Map<number, { x: number; y: number; text: string; mate: boolean; a: number; on: boolean; sub?: string; color?: string; big?: boolean; fy?: number }>();
  private tagV = new THREE.Vector3();
  /** Mitspieler aus der Lobby, die gerade nicht im Bild sind (hinter einem): Hinweis am Bildrand */
  private markOff: { name: string; color: string; dz: number; left: boolean }[] = [];

  private updateRiders(g: RaceView) {
    const p = g.p;
    const track = g.track;
    const w = this.w;
    for (const t of this.tagView.values()) t.on = false;
    // eigener Fahrer in voller Detailstufe (Kette, Zähne, Schriftzüge: 40k statt 12k Dreiecke, dazu im
    // Schattendurchgang) erst ab den Landschaftsdetails (Stufe 7) – darunter wie die Gegner
    const pq = gfxOn('details') || this.pc ? 1 : 0;
    const kitKey = `${riderKitKey(p.kit)}|${pq}`;
    if (!this.player || this.playerKit !== kitKey) {
      if (this.player) { this.scene.remove(this.player.group); this.player.dispose(); }
      this.player = new RiderModel(p.kit, this.shadowTex, pq);
      this.player.setFront(true);
      this.playerKit = kitKey;
      this.player.group.userData.nopick = true;
      this.scene.add(this.player.group);
      this.warmUp(this.player.group);
    }
    const pm = this.player;
    pm.group.visible = !this.hidePlayer;
    const roadY = track.heightAt(p.z);
    const air = Math.max(0, p.y - roadY);
    track.world(p.z, p.x, 0, w);
    pm.group.position.set(w.x, w.y + air, w.z);
    pm.group.rotation.y = -w.th;
    // Rad und Fahrer neigen sich mit der Straße (bergauf vorn höher, über Bodenwellen ein wenig) – nicht im Sturz
    // (im Sprung über eine Kuppe weich zurück in die Waagrechte statt auf einen Schlag)
    // (am Start wartet das Rad waagrecht auf dem Podest – erst mit „Los“ geht es auf die Rampe)
    const down = g.wreck || g.phase === 'crash' || g.phase === 'over';
    const wait = g.phase === 'ready' || g.phase === 'countdown';
    const wantPitch = down || wait || air > 0.05 ? 0 : this.pitchAt(track, p.z, p.x);
    this.playerPitch = down || wait ? wantPitch : this.playerPitch + (wantPitch - this.playerPitch) * (1 - Math.exp(-this.lastDt * 12));
    pm.group.rotation.x = this.playerPitch;
    pm.shadow.position.y = 0.03 - air;
    (pm.shadow.material as THREE.MeshBasicMaterial).opacity = 0.3 / (1 + air * 2);
    // Massensturz: Rad nach wreck.ts, Körper als Ragdoll (der Schatten bliebe sonst liegen, wo der Körper nicht ist)
    pm.shadow.visible = !g.wreck;
    if (g.wreck) this.ragdoll(-1, pm, g.wreck, null, g);
    else if (g.phase === 'crash' || g.phase === 'over') pm.crash(g.phaseT, g.crashSpin);
    else {
      pm.resetCrash();
      pm.pose(this.playerAnim.step({
        lean: p.lean, pedal: p.pedal, tuck: p.tuck, brake: p.brake, stand: p.stand ?? 0, sprint: p.sprint ?? (track.kind === 'sprint' ? 1 : 0), strain: p.strain,
        v: p.v, air, surface: track.segAt(p.z).surface, wobble: p.wobble, light: this.bikeLight(), roll: p.z / 0.34, effort: p.effort,
      }, this.lastDt, this.time.value));
    }
    // Bildschirmposition für Popups
    const v = new THREE.Vector3(w.x, w.y + air + 1.9, w.z).project(this.camera);
    this.playerScreen.x = (v.x * 0.5 + 0.5) * this.W;
    this.playerScreen.y = (-v.y * 0.5 + 0.5) * this.H;

    // Gegner: die nächsten sichtbaren
    const seen = new Set<number>();
    // in den Rennfinals das ganze Feld; Fahrer zwischen Kamera und Spieler werden durchsichtig
    const sprint = track.kind !== 'descent';
    const field = g.ghosts?.length ? [...g.opps, ...g.ghosts] : g.opps;
    // (einfache Grafik: weniger Fahrer als Modell – im Finale die übrigen als Bild, siehe unten)
    const lite = this.lite;
    const cap = lite ? (sprint ? 16 : 8) : (sprint ? 32 : 14) * (this.pc ? 2 : 1);
    // hinter einem: normal nur knapp (dahinter steht die Kamera); im Sturz von außen gefilmt weiter, Gestürzte immer
    const tv = this.dirKind === 'crash' || !!g.wreck || g.phase === 'crash' || g.phase === 'over';
    const back = tv ? TV_BACK : sprint ? SPRINT_BACK + 1.5 : 8;
    const rank = (o: Opp) => Math.abs(o.z - p.z) - (o.wreck ? WRECK_PRIO : 0);
    const list = field.filter((o) => o.z < p.z + 320 && (o.z > p.z - back || (!!o.wreck && o.z > p.z - WRECK_BACK)))
      .sort((a, b) => rank(a) - rank(b)).slice(0, cap);
    const cp = this.camera.position;
    // Mitspieler aus der Lobby hinter einem (nicht im Bild): Hinweis am Bildrand, auf seiner Seite
    this.markOff.length = 0;
    if (g.ghosts && g.phase === 'playing') {
      for (const o of g.ghosts) {
        if (!o.mark || (o.ghost ?? 0) < 0.1 || list.includes(o)) continue;
        const dz = o.z - p.z;
        if (dz < 0 && dz > -60) this.markOff.push({ name: o.mark.name, color: o.mark.color, dz, left: o.x < p.x });
      }
    }
    // Startkran (oder der Flug von ihm in die Fahrkamera): verdeckt, wer zwischen ihm und dir steht
    const crane = this.dirKind === 'intro' || (this.dirFromKind === 'intro' && this.dirT < 1);
    const rsOn = this.rs.ready;
    this.rs.begin();
    // Sonnenschatten: nur die nächsten Fahrer werfen einen (jeder Werfer wird im Schattendurchgang noch einmal
    // gezeichnet – ein ganzes Finalfeld verdoppelte die Arbeit der Grafik)
    let casters = 0;
    for (const o of list) {
      seen.add(o.id);
      const kit = this.kitOf(o, sprint);
      let m = this.riders.get(o.id);
      if (m && m.kitKey !== riderKitKey(kit)) { this.giveRider(m); m = undefined; }
      if (!m) {
        m = this.takeRider(kit, sprint || o.ghost !== undefined);
        this.riders.set(o.id, m);
      }
      m.group.visible = true;
      // in der Ferne ein 2D-Bild statt des 3D-Fahrers – dazwischen gerastert überblendet (je Bildpunkt genau einer)
      track.world(o.z, o.x, 0, this.w);
      const dc = Math.hypot(this.w.x - cp.x, this.w.y - cp.y, this.w.z - cp.z);
      let sa = 0;
      // Geister bleiben immer das 3D-Modell (halbdurchsichtig) – kein Bild in der Ferne; Gestürzte auch (das Bild
      // kennt kein Liegen)
      if (rsOn && !o.ghost && !o.wreck && spriteable(o.kit)) {
        const t = Math.max(0, Math.min(1, (dc - this.spriteNear) / (this.spriteFar - this.spriteNear)));
        sa = apQ(t * t * (3 - 2 * t));
      }
      const rp = this.placeOpp(m, o, track, sa < 1 && !o.wreck);
      // Massensturz: Rad nach wreck.ts, Körper als Ragdoll; ohne Schlagschatten (der Körper liegt woanders)
      if (o.wreck) this.ragdoll(o.id, m, o.wreck, rp, g);
      else m.resetCrash();
      m.shadow.visible = !o.wreck;
      m.setCastShadow(sa < 1 && casters++ < SUN_CASTERS);
      m.setSprite(sa >= 1);
      m.setBodyAp(sa > 0 && sa < 1 ? apOut(sa) : undefined);
      if (sa > 0) {
        // das Bild bekommt dieselbe (gefederte) Haltung wie der 3D-Fahrer – in der Überblendung passen beide zusammen
        const tk = Math.max(0, Math.min(1, rp.tuck - rp.brake * 0.6));
        this.rs.add(this.w.x, this.w.y, this.w.z, m.group.rotation.y, rp.lean, rp.pedal, tk, rp.stand ?? 0, sa * this.appear(o.id, g), kit);
      }
      // weit weg (Kamera): kleine Teile weglassen – erst, wenn sie sich im Shader schon aufgelöst haben
      const fh = RiderModel.FAR_HIDE;
      m.setFar(this.camera.position.distanceToSquared(m.group.position) > (m.isFar ? (fh - 1) ** 2 : fh * fh));
      // Mitspieler aus der eigenen Lobby: immer ein großes Schild in seiner Farbe und ein Ring um das Rad
      const mark = o.mark && (o.ghost === undefined || o.ghost > 0.1) ? o.mark : null;
      const tag = mark ? null : g.tags?.find((t) => t.id === o.id);
      if (tag || mark) {
        // über dem Kopf des Fahrers (this.w hält nach placeOpp seine Weltposition)
        const fy = mark ? (-this.tagV.set(this.w.x, this.w.y + 0.05, this.w.z).project(this.camera).y * 0.5 + 0.5) * this.H : 0;
        const v = this.tagV.set(this.w.x, this.w.y + 2.05, this.w.z).project(this.camera);
        if (v.z < 1) {
          const tv = this.tagView.get(o.id) ?? { x: 0, y: 0, text: '', mate: false, a: 0, on: false };
          tv.x = (v.x * 0.5 + 0.5) * this.W;
          tv.y = (-v.y * 0.5 + 0.5) * this.H;
          if (mark) {
            const dz = o.z - p.z;
            tv.text = mark.name;
            tv.mate = false;
            tv.sub = Math.abs(dz) >= 4 ? `${dz > 0 ? '+' : '−'}${Math.round(Math.abs(dz))} m` : undefined;
            tv.color = mark.color;
            tv.big = true;
            tv.fy = fy;
          } else if (tag) {
            tv.text = tag.text;
            tv.mate = !!tag.mate;
            tv.sub = tag.sub;
            tv.color = tag.color;
            tv.big = false;
          }
          tv.on = true;
          this.tagView.set(o.id, tv);
        }
      }
      if (sprint || o.ghost !== undefined) {
        const dz = o.z - p.z;
        // (Startkran vor dem Fahrer: wer zwischen ihm und dir steht)
        const block = (dz < 0.8 && dz > -SPRINT_BACK - 1 && Math.abs(o.x - p.x) < 1.05 + Math.max(0, -dz) * 0.06)
          || (crane && this.screens(this.w, pm.group.position));
        // Geist (Zeitfahren): seine eigene Deckkraft, davor noch durchsichtiger
        const target = o.ghost !== undefined ? o.ghost : 1;
        m.fade(block ? Math.min(0.28, target) : target, o.ghost !== undefined && o.ghost <= 0.01 ? 1 : this.lastDt);
        m.group.visible = target > 0.005;
        (m.shadow.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.min(1, target + 0.2);
      } else {
        // Fahrerfeld: wer zwischen Kamera und dir fährt und dich verdeckt, wird durchsichtig (wie in den Finals)
        const dz = o.z - p.z;
        const block = !o.wreck && g.phase !== 'crash' && g.phase !== 'over' && dz < 0.8 && dz > -CAM_BACK - 1 && Math.abs(o.x - p.x) < 1.05 + Math.max(0, -dz) * 0.06;
        if (block) m.prepareFade();
        m.fade(block ? 0.28 : 1, this.lastDt);
      }
    }
    // Fahrerfeld: alle übrigen (voraus und knapp hinter dir) nur als Bild – alle zusammen ein Zeichenaufruf; neu
    // Aufgetauchte blenden ein, am Ende der Sichtweite blenden sie aus. Gestürzte liegen (seitlich gekippt)
    // (Finale mit einfacher Grafik: wer nicht unter den nächsten Modellen ist, ebenso als Bild)
    if (rsOn && (!sprint || lite)) {
      for (const o of g.opps) {
        if (seen.has(o.id) || !spriteable(o.kit)) continue;
        const dz = o.z - p.z;
        if (dz < -(o.wreck ? WRECK_BACK : back) || dz > FIELD_FAR) continue;
        const a = this.appear(o.id, g) * (1 - smoothstep(FIELD_FAR - 130, FIELD_FAR, dz));
        if (a < 0.02) continue;
        track.world(o.z, o.x, 0, this.w);
        const down = !!o.wreck;
        const tk = down ? 0 : Math.max(0, Math.min(1, o.tuck - o.brake * 0.6));
        this.rs.add(this.w.x, this.w.y, this.w.z, -this.w.th, down ? (o.x > 0 ? 1.45 : -1.45) : o.lean, o.pedal, tk, down ? 0 : o.stand ?? 0, a, this.kitOf(o, sprint));
      }
    }
    this.rs.end();
    // alle Fahrer vorab anlegen (ausgeblendet), damit beim Auftauchen nichts gebaut werden muss –
    // in den Finals immer, sonst in Ruhe auf der Startkarte
    if (sprint || this.idleBuild) {
      for (const o of field) {
        if (this.riders.has(o.id)) continue;
        const m = this.takeRider(this.kitOf(o, sprint), sprint || o.ghost !== undefined);
        m.group.visible = false;
        this.riders.set(o.id, m);
      }
      if (!sprint) {
        // Fahrerfeld: wer dich verdeckt, wird durchsichtig – diese Shader gleich jetzt übersetzen (nicht erst mitten
        // im Rennen); der Stellvertreter bleibt (sonst gäbe three.js die Programme wieder frei)
        if (!this.fadeWarm) {
          const fm = new RiderModel(LOOKS[0], this.shadowTex, this.pc ? 1 : 0);
          fm.prepareFade();
          // halb durchsichtig: zeichnet (unsichtbar) mit den durchsichtigen Materialien
          fm.fade(0.5, 1);
          appearifyTree(fm.group);
          this.scene.add(fm.group);
          this.warmUp(fm.group);
          fm.group.visible = false;
          this.fadeWarm = fm;
        }
        // alle Aussehen des Feldes vorab bauen (eins je Bild): unterwegs entsteht dann keins mehr neu
        const look = LOOKS.find((k) => !this.lookBuilt.has(riderKitKey(k)));
        if (look) {
          const key = riderKitKey(look);
          this.lookBuilt.add(key);
          if (![...this.riders.values()].some((m) => m.kitKey === key) && !this.riderPool.get(key)?.length) this.giveRider(this.takeRider(look, false));
        }
      }
    }
    const alive = new Set(field.map((o) => o.id));
    for (const [id, m] of this.riders) {
      if (seen.has(id)) continue;
      // außer Sicht: nur ausblenden – kommt der Fahrer zurück, ist er sofort wieder da (kein Neuaufbau, kein Ruckler);
      // wer nicht mehr im Rennen ist, gibt sein Modell ab (Fahrerfeld: in den Vorrat für den nächsten)
      if (alive.has(id)) m.group.visible = false;
      else { this.giveRider(m); this.riders.delete(id); this.anims.delete(id); }
    }
    for (const id of this.anims.keys()) if (!alive.has(id)) this.anims.delete(id);
    for (const id of this.seenAt.keys()) if (!alive.has(id)) this.seenAt.delete(id);
    // Ragdolls: nur solange der Sturz besteht (neuer Lauf, Fahrer weg)
    for (const [k, D] of this.dolls) {
      const w = k < 0 ? g.wreck : field.find((o) => o.id === k)?.wreck;
      if (w !== D.w) this.dolls.delete(k);
    }
  }

  /**
   * Trikot, wie es gezeichnet wird: in der Abfahrt eine von wenigen Startnummern je Team und Hautton – jedes neue
   * Aussehen baut eigene Netze und eine Trikottextur (und behält sie); im Fahrerfeld kämen sonst Hunderte zusammen
   */
  private kitOf(o: Opp, sprint: boolean): Kit {
    if (sprint || o.ghost !== undefined || o.kit.bike) return o.kit;
    return LOOKS[o.id % LOOKS.length];
  }

  /** Vorrat fertiger Fahrermodelle der Abfahrt je Aussehen (ausgeblendet in der Szene) */
  private riderPool = new Map<string, RiderModel[]>();
  /** Aussehen, die schon (vorab) gebaut wurden */
  private lookBuilt = new Set<string>();

  /** Fahrermodell aus dem Vorrat oder neu; fade: für Durchsichtigkeit vorbereitet (Finals, Geister) */
  private takeRider(kit: Kit, fade: boolean): RiderModel {
    const m = this.riderPool.get(riderKitKey(kit))?.pop();
    if (m) {
      m.resetCrash();
      m.setSprite(false);
      m.setBodyAp(undefined);
      m.fade(1, 1);
      m.shadow.visible = true;
      if (fade) m.prepareFade();
      return m;
    }
    // PC-Grafik: auch die Gegner mit voller Detailstufe am Rad (Kette, Zähne, Schriftzüge)
    const n = new RiderModel(kit, this.shadowTex, this.pc ? 1 : 0);
    appearifyTree(n.group);
    // auch die Teile, die erst später sichtbar werden (Speichen-Schleier), gleich übersetzen lassen – deckend und,
    // wer durchsichtig werden kann, auch durchsichtig (fade wechselt zwischen beiden)
    this.warmUp(n.group);
    if (fade) {
      n.prepareFade();
      n.withFadeMats(() => this.warmUp(n.group));
    }
    this.scene.add(n.group);
    return n;
  }

  /** Modell abgeben: Aussehen des Fahrerfelds in den Vorrat, alle anderen weg */
  private giveRider(m: RiderModel) {
    if (!LOOK_KEYS.has(m.kitKey)) { this.scene.remove(m.group); m.dispose(); return; }
    m.group.visible = false;
    let list = this.riderPool.get(m.kitKey);
    if (!list) { list = []; this.riderPool.set(m.kitKey, list); }
    list.push(m);
  }

  // ------------------------------------------------------------------ Laternen: Lichtkegel

  private lampLists: Float32Array[] = [];
  /** Sonnenuntergangs-Licht über dem ganzen Bild (sunset3d.ts) */
  private sunset = new SunsetGlow();
  /** Lichtkegel: die nächsten Laternen zur Kamera (aus den Abschnitten um den Fahrer) ins Uniform-Feld */
  private pickLamps(z: number) {
    const L = this.lampLists;
    L.length = 0;
    if (LAMP_U.uLampK.value > 0.001) {
      const ci = Math.floor(z / (SEG * CH));
      for (let k = ci - 2; k <= ci + 3; k++) { const c = this.chunks.get(k); if (c?.lamps) L.push(c.lamps); }
    }
    // (unter Stufe 7: die sechs nächsten Laternen – jede kostet in jedem Bildpunkt von Straße und Hang)
    pickLamps(L, this.camera.position, LAMP_U.uLampK.value, gfxOn('details') || this.pc ? LAMP_N : 6);
  }

  // ------------------------------------------------------------------ Häuser, Dörfer, Bäume weg

  /** Alpenhäuser (Höfe, Dorfhäuser, Stadel, Kirchen) als Instanzen */
  private houses = new Houses3D();
  /** Dörfer an der Strecke (nur Abfahrt) */
  private villages: Villages3D | null = null;
  /** Stellen ohne Bäume (x, z, Radius) – für Kacheln, die erst noch entstehen */
  private treeBlocks: number[] = [];
  /** Bild-Geometrie der Bäume je Quelle (zum Entfernen einzelner Bäume) */
  private bbOf = new WeakMap<TreeSource, THREE.InstancedBufferGeometry>();

  private treeBlocked(x: number, z: number): boolean {
    const b = this.treeBlocks;
    for (let k = 0; k < b.length; k += 3) if ((b[k] - x) ** 2 + (b[k + 1] - z) ** 2 < b[k + 2] * b[k + 2]) return true;
    return false;
  }

  /** Bäume im Umkreis entfernen: in gebauten Kacheln (Bild auf Größe 0) und in künftigen */
  private clearTrees(x: number, z: number, r: number) {
    this.treeBlocks.push(x, z, r);
    if (this.treeBlocks.length > 3 * 4000) this.treeBlocks.splice(0, 3 * 1000);
    for (const s of this.treeSrc) {
      const b = s.box;
      if (b[2] < x - r - 20 || b[0] > x + r + 20 || b[3] < z - r - 20 || b[1] > z + r + 20) continue;
      const bg = this.bbOf.get(s);
      const buf = bg ? (bg.getAttribute('aT0') as THREE.InterleavedBufferAttribute).data : null;
      let hit = false;
      for (let k = 0; k < s.n; k++) {
        const o = k * TREC;
        if ((s.rec[o] - x) ** 2 + (s.rec[o + 2] - z) ** 2 >= r * r || s.rec[o + 3] === 0) continue;
        s.rec[o + 3] = 0;
        if (buf) { (buf.array as Float32Array)[k * buf.stride + 3] = 0; hit = true; }
      }
      if (hit && buf) buf.needsUpdate = true;
    }
  }

  /** Bäume im Umkreis (gebaute Landschaft) */
  private countTrees(x: number, z: number, r: number): number {
    let n = 0;
    for (const s of this.treeSrc) {
      const b = s.box;
      if (b[2] < x - r || b[0] > x + r || b[3] < z - r || b[1] > z + r) continue;
      for (let k = 0; k < s.n; k++) {
        const o = k * TREC;
        if (s.rec[o + 3] > 0 && (s.rec[o] - x) ** 2 + (s.rec[o + 2] - z) ** 2 < r * r) n++;
      }
    }
    return n;
  }

  /** Abstand zur Straße (alle Schenkel) an einem Weltpunkt – Rechenbereich in der Nähe wiederverwendet */
  private rdReg: { r: Region; x: number; z: number } | null = null;
  private roadDistAt(x: number, z: number): number {
    const T = this.terrain;
    if (!T) return Infinity;
    if (!this.rdReg || Math.abs(x - this.rdReg.x) > 150 || Math.abs(z - this.rdReg.z) > 150) this.rdReg = { r: T.region(x - 200, z - 200, x + 200, z + 200), x, z };
    return T.roadDist(this.rdReg.r, x, z);
  }

  /** Bergwald in der Landschaft (Shader: Waldboden genau nach der Maske der Bäume) */
  private woodsU = { value: 0 };

  /** Stellvertreter, der die Shader durchsichtiger Fahrer am Leben hält (siehe updateRiders) */
  private fadeWarm: RiderModel | null = null;

  /** wann ein Fahrer zuerst zu sehen war (Spielzeit der Darstellung); vor dem Start: schon immer */
  private seenAt = new Map<number, number>();
  /** Einblendung eines neu aufgetauchten Fahrers (0 … 1 in 0,8 s) */
  private appear(id: number, g: RaceView): number {
    let t0 = this.seenAt.get(id);
    if (t0 === undefined) {
      t0 = g.phase === 'ready' || g.phase === 'countdown' ? -1e9 : this.time.value;
      this.seenAt.set(id, t0);
    }
    return Math.min(1, (this.time.value - t0) / 0.8);
  }

  // ------------------------------------------------------------------ Stürze (Massensturz)

  /** Körper der Gestürzten (Schlüssel: Gegner-Nummer, −1 = du) mit ihrem Boden und dem Sturz, zu dem sie gehören */
  private dolls = new Map<number, { d: Ragdoll; g: Ground; w: Wreck }>();
  private dollBuf = new Float32Array(JOINTS * 3);
  private gw = { x: 0, y: 0, z: 0, th: 0 };

  /**
   * Sturz darstellen: das Rad nach wreck.ts (kippt, schlittert), der Körper als Ragdoll – aus der Fahrhaltung
   * gestartet, danach frei mit Schwerkraft, Aufprall und Reibung, im Takt der Zeitlupe des Spiels. ride: Fahrhaltung
   * für den Start (ein eben erst gebautes Modell hat noch keine); null = die Haltung des letzten Bildes
   */
  private ragdoll(key: number, m: RiderModel, w: Wreck, ride: RiderPose | null, g: RaceView) {
    const t = g.track;
    let D = this.dolls.get(key);
    if (D && D.w !== w) D = undefined;
    if (!D) {
      m.resetCrash();
      if (ride) m.pose(ride);
      m.ragdollJoints(this.dollBuf);
      // an den Ort des Aufpralls (kommt der Sturz erst jetzt ins Bild, ist der Fahrer schon ein Stück gerutscht)
      const gp = m.group.position;
      t.world(w.z0, w.x0, 0, this.gw);
      const ox = this.gw.x - gp.x, oy = this.gw.y - gp.y, oz = this.gw.z - gp.z;
      for (let i = 0; i < JOINTS; i++) { this.dollBuf[i * 3] += ox; this.dollBuf[i * 3 + 1] += oy; this.dollBuf[i * 3 + 2] += oz; }
      const th = this.gw.th;
      const fx = Math.sin(th), fz = -Math.cos(th);
      const grade = t.segAt(w.z0).grade;
      const v = w.v0;
      const d = new Ragdoll(this.dollBuf, [fx * v, grade * v, fz * v], [fx, fz], Math.max(0.25, Math.min(1, (v - 3) / 14)), w.side, w.seed);
      // Boden: Straßenhöhe entlang der Fahrtrichtung vom Sturzort aus (die paar Meter Rutschen)
      t.world(w.z0, 0, 0, this.gw);
      const cx = this.gw.x, cz = this.gw.z, z0 = w.z0;
      const ground: Ground = (x, z) => t.heightAt(Math.max(0, z0 + (x - cx) * fx + (z - cz) * fz));
      D = { d, g: ground, w };
      this.dolls.set(key, D);
      // so weit vorrechnen, wie der Sturz schon läuft
      for (let left = Math.min(w.t, 4); left > 1e-3; left -= 1 / 30) d.step(Math.min(1 / 30, left), ground, []);
    }
    m.crashPose(wreckPose(w));
    const others: Ragdoll[] = [];
    for (const x of this.dolls.values()) if (x !== D) others.push(x.d);
    D.d.step(this.lastDt * (g.timeScale ?? 1), D.g, others);
    m.ragdollPose(D.d.p);
  }

  /**
   * Normalen der Fahrbahn aus ihrem Relief (statt aus den Dreiecken): weich über die Spalten hinweg und ohne Naht
   * zwischen den Abschnitten. Die Neigung durch das Relief wird fürs Licht verstärkt (ROAD_SHADE) – sonst sähe man
   * ein paar Zentimeter Welle auf einer Straße so wenig wie in Wirklichkeit; die Steigung selbst bleibt echt.
   * Lage je Ecke aus den Straßenmetern (Farbe = aRoad: quer ab dem linken Rand der Normalbreite, längs ab wBase).
   */
  private roadNormals(geo: THREE.BufferGeometry, wBase: number) {
    const t = this.track!;
    const col = geo.getAttribute('color');
    const n = col.count;
    const out = new Float32Array(n * 3);
    const w = this.w2;
    const K = ROAD_SHADE;
    // jede Ecke kommt in bis zu sechs Dreiecken vor: je Lage nur einmal rechnen
    const seen = new Map<number, number>();
    let lm = NaN, sx = 0, sz = 0, rx = 0, rz = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      const um = col.getX(i), vm = col.getY(i);
      const key = Math.round(vm * 16) * 8192 + Math.round((um + 20) * 64);
      const hit = seen.get(key);
      if (hit !== undefined) { out[i * 3] = out[hit * 3]; out[i * 3 + 1] = out[hit * 3 + 1]; out[i * 3 + 2] = out[hit * 3 + 2]; continue; }
      seen.set(key, i);
      const x = um - ROAD_HALF;
      const m = vm + wBase;
      if (m !== lm) {
        lm = m;
        t.world(m, 0, 0, w, true);
        sx = Math.sin(w.th); sz = -Math.cos(w.th); rx = Math.cos(w.th); rz = Math.sin(w.th);
        dy = (t.heightAt(m + 0.5) - t.heightAt(Math.max(0, m - 0.5))) / 1;
      }
      // (Abstände so, dass meist genau Segmentanfänge abgefragt werden – das ist am schnellsten)
      const gx = Math.max(-0.3, Math.min(0.3, ((t.lift(m, x + 0.2) - t.lift(m, x - 0.2)) / 0.4) * K));
      const gz = Math.max(-0.3, Math.min(0.3, ((t.lift(m + SEG, x) - t.lift(Math.max(0, m - SEG), x)) / (2 * SEG)) * K));
      // Querrichtung R = (rx, gx, rz), Fahrtrichtung F = (sx, dy + gz, sz), Normale = R × F
      const fy = dy + gz;
      let nx = gx * sz - rz * fy, ny = rz * sx - rx * sz, nz = rx * fy - gx * sx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      out[i * 3] = nx; out[i * 3 + 1] = ny; out[i * 3 + 2] = nz;
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  }

  private playerPitch = 0;
  /** Neigung des Rads in Fahrtrichtung (rad, + = vorn höher): Steigung, wie sie zu sehen ist, und Relief unter den Rädern */
  private pitchAt(t: Track, z: number, x: number): number {
    const f = t.heightAt(z + 0.5) + t.lift(z + 0.5, x);
    const b = t.heightAt(Math.max(0, z - 0.5)) + t.lift(Math.max(0, z - 0.5), x);
    return Math.atan(f - b);
  }

  /** flach auf die Fahrbahn legen (Pfützen, Schlaglöcher): Neigung längs und quer wie die Fahrbahn darunter */
  private onSurface(o: THREE.Object3D, t: Track, z: number, x: number, th: number) {
    const l = t.lift(z, x - 0.4), r = t.lift(z, x + 0.4);
    o.rotation.order = 'YXZ';
    o.rotation.set(this.pitchAt(t, z, x), -th, Math.atan((r - l) / 0.8));
  }

  /** Gegner an seinen Ort setzen; liefert die (gefederte) Pose des Bildes – angewendet nur, wenn der 3D-Fahrer zu sehen ist */
  private placeOpp(m: RiderModel, o: Opp, track: Track, pose = true): RiderPose {
    const w = this.w;
    track.world(o.z, o.x, 0, w);
    m.group.position.set(w.x, w.y, w.z);
    m.group.rotation.y = -w.th;
    m.group.rotation.x = o.wreck ? 0 : this.pitchAt(track, o.z, o.x);
    // die Federn laufen auch, solange nur das Bild zu sehen ist (kein Nachschwingen, wenn der 3D-Fahrer wiederkommt);
    // die Haltung selbst wird dann nicht gerechnet
    let an = this.anims.get(o.id);
    if (!an) { an = new RiderAnim(o.id * 7.31 + 3); this.anims.set(o.id, an); }
    const rp = an.step({
      lean: o.lean, pedal: o.pedal, tuck: o.tuck, brake: o.brake, stand: o.stand ?? 0, sprint: o.sprint ?? (track.kind === 'sprint' ? 1 : 0), strain: o.strain,
      v: o.v, air: 0, surface: track.segAt(o.z).surface, wobble: o.bump, light: this.bikeLight(), roll: o.z / 0.34, effort: o.effort,
    }, this.lastDt, this.time.value);
    if (pose) m.pose(rp);
    return rp;
  }

  private poolGet(kind: string, make: () => THREE.Object3D): THREE.Object3D {
    let list = this.objPool.get(kind);
    if (!list) { list = []; this.objPool.set(kind, list); }
    const used = this.objUsed.get(kind) ?? 0;
    if (used >= list.length) {
      const o = make();
      appearifyTree(o);
      list.push(o);
      this.objRoot.add(o);
    }
    const o = list[used];
    o.visible = true;
    setAp(o, this.objAp);
    this.objUsed.set(kind, used + 1);
    return o;
  }

  /** Einblendung des gerade platzierten Objekts (am Rand der Sichtweite: weich herein) */
  private objAp: number | undefined = undefined;
  private objMade = false;
  private objGeo: Record<string, THREE.BufferGeometry> = {};
  private objMat: Record<string, THREE.Material> = {};

  private makeObjAssets() {
    if (this.objMade) return;
    this.objMade = true;
    const bid = new GB();
    const M4 = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
    bid.add(new THREE.CylinderGeometry(0.075, 0.075, 0.22, 10), M4(0, 0, 0), lin('#3d8bfd'));
    bid.add(new THREE.CylinderGeometry(0.076, 0.076, 0.05, 10), M4(0, 0.02, 0), lin('#ffffff'));
    bid.add(new THREE.CylinderGeometry(0.035, 0.05, 0.07, 8), M4(0, 0.14, 0), lin('#1b1d22'));
    const gold = new GB();
    gold.add(new THREE.CylinderGeometry(0.075, 0.075, 0.22, 10), M4(0, 0, 0), lin('#ffd23f'));
    gold.add(new THREE.CylinderGeometry(0.035, 0.05, 0.07, 8), M4(0, 0.14, 0), lin('#b8860b'));
    const cone = new GB();
    cone.add(new THREE.ConeGeometry(0.17, 0.62, 10), M4(0, 0.35, 0), lin('#ff6a13'));
    cone.add(new THREE.CylinderGeometry(0.09, 0.115, 0.12, 10), M4(0, 0.38, 0), lin('#ffffff'));
    cone.add(new THREE.BoxGeometry(0.42, 0.04, 0.42), M4(0, 0.02, 0), lin('#1d1d1f'));
    const rock = new GB();
    rock.add(new THREE.DodecahedronGeometry(0.42, 0), new THREE.Matrix4().makeScale(1, 0.75, 0.9).setPosition(0, 0.25, 0), lin('#8a857c'));
    rock.add(new THREE.DodecahedronGeometry(0.2, 0), M4(0.4, 0.12, 0.2), lin('#7a756d'));
    this.objGeo = {
      bidon: bid.build(), gold: gold.build(), cone: cone.build(), rock: rock.build(),
      disc: new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2),
      ring: new THREE.RingGeometry(0.75, 1, 20).rotateX(-Math.PI / 2),
    };
    this.objMat = {
      v: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      gem: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color(0x553300), flatShading: true }),
      hole: new THREE.MeshBasicMaterial({ color: 0x1c1b1a, transparent: true, opacity: 0.85, depthWrite: false }),
      holeRim: new THREE.MeshBasicMaterial({ color: 0x9a9080, transparent: true, opacity: 0.35, depthWrite: false }),
      puddle: new THREE.MeshPhongMaterial({ color: 0x3d5566, shininess: 140, specular: 0xcfe4f5, transparent: true, opacity: 0.62, depthWrite: false }),
      glowB: new THREE.MeshBasicMaterial({ color: 0x59a6ff, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }),
      glowG: new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }),
    };
    // alle gleich übersetzen lassen (im Hintergrund) – nicht erst, wenn die erste Pfütze auftaucht
    const warm = new THREE.Group();
    for (const m of Object.values(this.objMat)) { appearify(m); warm.add(new THREE.Mesh(this.objGeo.disc, m)); }
    this.warmUp(warm);
  }

  private updateObjects(g: RaceView) {
    this.makeObjAssets();
    for (const list of this.objPool.values()) for (const o of list) o.visible = false;
    this.objUsed.clear();
    const p = g.p;
    const track = g.track;
    const w = this.w;
    const i0 = Math.floor((p.z - 6) / SEG);
    const i1 = Math.floor((p.z + 220) / SEG);
    const geo = this.objGeo;
    const mat = this.objMat;
    for (let i = Math.max(0, i0); i <= i1; i++) {
      const s = track.seg(i);
      if (!s.objs) continue;
      for (const o of s.objs) {
        if (o.done && (o.k === 'bidon' || o.k === 'gold' || o.k === 'cone')) continue;
        // die letzten 30 m vor der Sichtgrenze (220 m voraus): weich einblenden statt aufzutauchen
        const ahead = o.z - p.z;
        this.objAp = ahead > 188 ? apIn((220 - ahead) / 32) : undefined;
        track.world(o.z, o.x, 0, w);
        const th = w.th;
        switch (o.k) {
          case 'bidon':
          case 'gold': {
            const m = this.poolGet(o.k, () => {
              const gr = new THREE.Group();
              gr.add(new THREE.Mesh(o.k === 'gold' ? geo.gold : geo.bidon, o.k === 'gold' ? mat.gem : mat.v));
              const ring = new THREE.Mesh(geo.ring, o.k === 'gold' ? mat.glowG : mat.glowB);
              ring.name = 'ring';
              gr.add(ring);
              return gr;
            }) as THREE.Group;
            const bob = Math.sin(this.time.value * 4 + (o.ph ?? 0)) * 0.05;
            const body = m.children[0];
            body.position.set(0, 0.42 + bob, 0);
            body.rotation.set(0, this.time.value * 2.2 + (o.ph ?? 0), 0.25);
            body.scale.setScalar(o.k === 'gold' ? 1.6 : 1.35);
            const ring = m.children[1];
            ring.position.y = 0.03;
            ring.scale.setScalar(o.k === 'gold' ? 0.42 : 0.3);
            m.position.set(w.x, w.y, w.z);
            break;
          }
          case 'pothole': {
            const m = this.poolGet('pothole', () => {
              const gr = new THREE.Group();
              gr.add(new THREE.Mesh(geo.disc, mat.holeRim));
              gr.add(new THREE.Mesh(geo.disc, mat.hole));
              return gr;
            }) as THREE.Group;
            m.children[0].scale.set(o.r * 1.25, 1, o.r * 1.0);
            m.children[0].position.y = 0.02;
            m.children[1].scale.set(o.r * 1.05, 1, o.r * 0.8);
            m.children[1].position.set(0, 0.025, 0.04);
            m.position.set(w.x, w.y, w.z);
            this.onSurface(m, track, o.z, o.x, th);
            break;
          }
          case 'puddle': {
            const m = this.poolGet('puddle', () => new THREE.Mesh(geo.disc, mat.puddle));
            m.scale.set(o.r * 1.2, 1, o.r * 1.6);
            m.position.set(w.x, w.y + 0.02, w.z);
            this.onSurface(m, track, o.z, o.x, th);
            break;
          }
          case 'rock': {
            const m = this.poolGet('rock', () => new THREE.Mesh(geo.rock, mat.v));
            m.position.set(w.x, w.y, w.z);
            m.rotation.y = o.z;
            break;
          }
          case 'cone': {
            const m = this.poolGet('cone', () => new THREE.Mesh(geo.cone, mat.v));
            m.position.set(w.x, w.y, w.z);
            m.rotation.set(0, 0, 0);
            break;
          }
          case 'cow': {
            const kind = Math.floor(o.z) % 2 ? 'cowBW' : 'cow';
            const e = this.atlas.get(`${kind}:${o.vx ? 0 : 1}`);
            if (!e) break;
            const m = this.poolGet(`cow:${kind}:${o.vx ? 0 : 1}`, () => {
              const pg = new THREE.PlaneGeometry(e.w, e.h);
              pg.translate(0, e.h / 2, 0);
              const uv = pg.getAttribute('uv') as THREE.BufferAttribute;
              for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) ? e.u1 : e.u0, uv.getY(k) ? e.v1 : e.v0);
              const mesh = new THREE.Mesh(pg, this.mats.billboard);
              return mesh;
            }) as THREE.Mesh;
            const step = o.vx ? Math.abs(Math.sin(this.time.value * 6)) * 0.05 : 0;
            m.position.set(w.x, w.y + step, w.z);
            // Kuh von der Seite zeigen: Ebene längs zur Straße, in Laufrichtung gespiegelt
            m.rotation.set(0, -th + Math.PI / 2, 0);
            m.scale.set((o.vx ?? 0) > 0 ? -1 : 1, 1, 1);
            break;
          }
        }
      }
    }
  }

  private updateParticles(g: RaceView) {
    const n = Math.min(300, g.parts.length);
    const w = this.w;
    const col = new THREE.Color();
    for (let i = 0; i < 300; i++) {
      if (i < n) {
        const q = g.parts[i];
        g.track.world(q.z, q.x, q.h, w);
        this.partPos[i * 3] = w.x;
        this.partPos[i * 3 + 1] = w.y;
        this.partPos[i * 3 + 2] = w.z;
        col.set(q.color);
        const a = Math.max(0, q.life / q.max);
        this.partCol[i * 3] = col.r * a;
        this.partCol[i * 3 + 1] = col.g * a;
        this.partCol[i * 3 + 2] = col.b * a;
      } else {
        this.partPos[i * 3 + 1] = -1e6;
      }
    }
    const geo = this.parts.geometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  // ------------------------------------------------------------------ 2D-Ebene: Popups und Tempo-Linien

  /** wurde im letzten Bild etwas auf die Ebene gezeichnet? (sonst muss sie nicht neu gezeichnet werden) */
  private overlayDirty = true;

  private drawOverlay(g: RaceView) {
    const c = this.overlay;
    const busy = (g.p.v > 21 && g.phase === 'playing') || this.tagView.size > 0 || this.markOff.length > 0 || g.popups.length > 0;
    if (!busy && !this.overlayDirty) return;
    this.overlayDirty = busy;
    c.clearRect(0, 0, this.W, this.H);
    // leere Ebene ausblenden: der Browser muss sie dann nicht mehr über das Bild legen
    const vis = busy ? '' : 'hidden';
    if (this.overlayCv.style.visibility !== vis) this.overlayCv.style.visibility = vis;
    if (!busy) return;
    // Tempo-Linien am Rand
    const v = g.p.v;
    if (v > 21 && g.phase === 'playing') {
      const k = Math.min(1, (v - 21) / 14);
      c.strokeStyle = `rgba(255,255,255,${(0.18 * k).toFixed(3)})`;
      c.lineWidth = 1.2;
      const cx = this.W / 2;
      const cy = this.H * 0.42;
      for (let i = 0; i < 12; i++) {
        const a = hash(i * 7 + 1) * Math.PI * 2;
        const ph = (this.time.value * (1.4 + hash(i) * 1.1) + hash(i * 3)) % 1;
        const r0 = Math.max(this.W, this.H) * (0.42 + ph * 0.45);
        const r1 = r0 + 50 + 70 * k;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        if (sa > 0.2 && Math.abs(ca) < 0.5) continue;
        c.beginPath();
        c.moveTo(cx + ca * r0, cy + sa * r0 * 0.8);
        c.lineTo(cx + ca * r1, cy + sa * r1 * 0.8);
        c.stroke();
      }
    }
    // Namensschild über dem Hinterrad, an dem du fährst
    for (const [id, t] of this.tagView) {
      t.a += ((t.on ? 1 : 0) - t.a) * Math.min(1, this.lastDt * 9);
      if (!t.on && t.a < 0.02) { this.tagView.delete(id); continue; }
      if (t.big) this.drawMark(c, t); else this.drawTag(c, t);
    }
    this.drawMarkOff(c);
    // Hinweise links und rechts über dem Fahrer: nur Schrift, kleine Feder-Animation
    const ps = this.playerScreen;
    const tones: Record<string, string> = { accent: this.accent, gold: '#ffd23f', white: '#ffffff', muted: '#e4e4ea', red: '#ff8a7a', blue: '#9fd4ff' };
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const font = 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", -apple-system, "Segoe UI", Roboto, sans-serif';
    const easeBack = (x: number) => { const k = 1.9; return 1 + (k + 1) * Math.pow(x - 1, 3) + k * Math.pow(x - 1, 2); };
    const top = this.H * 0.36;
    const cx = Math.max(this.W * 0.3, Math.min(this.W * 0.7, ps.x));
    for (const pp of g.popups) {
      const t = pp.age / pp.life;
      const s = t < 0.22 ? Math.max(0.01, easeBack(t / 0.22)) : 1;
      const alpha = t < 0.06 ? t / 0.06 : t > 0.72 ? Math.max(0, (1 - t) / 0.28) : 1;
      const rise = (1 - Math.pow(1 - t, 3)) * 30;
      const drift = (1 - Math.pow(1 - t, 2)) * 10;
      const label = pp.text;
      const big = pp.big;
      const ptsSize = big ? 32 : pp.pts && !label ? 21 : 26;
      const labSize = big ? 17 : 14;
      const onlyText = !pp.pts;
      c.font = `800 ${onlyText ? (big ? 26 : 20) : ptsSize}px ${font}`;
      const w1 = c.measureText(onlyText ? label : pp.pts!).width;
      c.font = `700 ${labSize}px ${font}`;
      const w2 = label && !onlyText ? c.measureText(label).width : 0;
      const half = Math.max(w1, w2) / 2 + 6;
      const off = this.W * (0.2 + pp.dx * 0.07) + half * 0.35;
      const x = Math.max(12 + half, Math.min(this.W - 12 - half, cx + pp.side * off + pp.side * drift));
      const y = top + pp.slot * (big ? 76 : 64) + pp.dy * 10 - rise;
      c.save();
      c.globalAlpha = alpha;
      c.translate(x, y);
      c.rotate(pp.side * (0.07 * (1 - Math.min(1, t * 2.5)) + 0.015));
      c.scale(s, s);
      c.shadowColor = 'rgba(10, 12, 20, 0.55)';
      c.shadowBlur = 10;
      c.shadowOffsetY = 2;
      const col = tones[pp.tone] ?? '#fff';
      if (onlyText) {
        c.font = `800 ${big ? 26 : 20}px ${font}`;
        c.fillStyle = col;
        c.fillText(label, 0, 0);
      } else {
        if (label) {
          c.font = `700 ${labSize}px ${font}`;
          c.fillStyle = 'rgba(255,255,255,0.92)';
          c.fillText(label, 0, -ptsSize * 0.62);
        }
        c.font = `800 ${ptsSize}px ${font}`;
        c.fillStyle = col;
        c.fillText(pp.pts!, 0, label ? 4 : 0);
      }
      if (pp.sub) {
        c.font = `600 12px ${font}`;
        c.fillStyle = 'rgba(255,255,255,0.85)';
        c.fillText(pp.sub, 0, (onlyText ? 16 : ptsSize * 0.75 + 4));
      }
      // kleine Funkelsterne bei Gold und Akzent
      if ((pp.tone === 'gold' || pp.tone === 'accent') && t < 0.55) {
        c.shadowBlur = 0;
        const k = t / 0.55;
        c.globalAlpha = alpha * (1 - k);
        c.fillStyle = col;
        for (let i = 0; i < 4; i++) {
          const a = i * 1.7 + pp.dx * 6;
          const r = half * 0.7 + 8 + k * 16;
          const sx = Math.cos(a) * r;
          const sy = Math.sin(a) * r * 0.55 - 4;
          const sz = 3.2 * (1 - k * 0.6);
          c.beginPath();
          c.moveTo(sx, sy - sz * 1.6); c.lineTo(sx + sz * 0.4, sy - sz * 0.4); c.lineTo(sx + sz * 1.6, sy); c.lineTo(sx + sz * 0.4, sy + sz * 0.4);
          c.lineTo(sx, sy + sz * 1.6); c.lineTo(sx - sz * 0.4, sy + sz * 0.4); c.lineTo(sx - sz * 1.6, sy); c.lineTo(sx - sz * 0.4, sy - sz * 0.4);
          c.closePath();
          c.fill();
        }
      }
      c.restore();
    }
    c.globalAlpha = 1;
  }

  /**
   * Mitspieler aus der Lobby: Ring um das Rad und ein großes Schild in seiner Farbe (Name, Abstand) mit weißem Rand –
   * auf den ersten Blick von Feld und Geistern zu unterscheiden
   */
  private drawMark(c: CanvasRenderingContext2D, t: { x: number; y: number; text: string; a: number; sub?: string; color?: string; fy?: number }) {
    const font = 'ui-rounded, "SF Pro Rounded", -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif';
    const col = t.color ?? this.accent;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
    c.save();
    // Ring am Boden um das Rad (Größe aus der Höhe des Fahrers im Bild)
    const hpx = Math.max(0, (t.fy ?? t.y) - t.y);
    if (hpx > 10) {
      const rx = Math.min(90, hpx * 0.42);
      c.globalAlpha = t.a * (0.55 + 0.35 * pulse);
      c.strokeStyle = col;
      c.lineWidth = Math.max(2.5, Math.min(5, hpx * 0.035));
      c.shadowColor = col;
      c.shadowBlur = 12;
      c.beginPath();
      c.ellipse(t.x, t.fy!, rx * (1 + 0.06 * pulse), rx * 0.3 * (1 + 0.06 * pulse), 0, 0, Math.PI * 2);
      c.stroke();
      c.shadowBlur = 0;
    }
    // Schild
    c.globalAlpha = t.a;
    c.font = `800 15px ${font}`;
    const tw = c.measureText(t.text).width;
    c.font = `700 12px ${font}`;
    const sw = t.sub ? c.measureText(t.sub).width + 8 : 0;
    const w = tw + sw + 26;
    const h = 30;
    const x = Math.max(8, Math.min(this.W - 8 - w, t.x - w / 2));
    const y = Math.max(8, t.y - h - 12 - (1 - t.a) * 8);
    const r = h / 2;
    const pill = () => {
      c.beginPath();
      c.moveTo(x + r, y);
      c.lineTo(x + w - r, y);
      c.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
      c.lineTo(x + r, y + h);
      c.arc(x + r, y + r, r, Math.PI / 2, (Math.PI * 3) / 2);
      c.closePath();
    };
    c.shadowColor = 'rgba(0, 0, 0, 0.45)';
    c.shadowBlur = 10;
    c.shadowOffsetY = 2;
    c.fillStyle = col;
    pill();
    c.fill();
    c.shadowBlur = 0;
    c.shadowOffsetY = 0;
    // dunkler Schleier für die Lesbarkeit auf hellen Farben, weißer Rand
    c.fillStyle = 'rgba(0, 0, 0, 0.18)';
    pill();
    c.fill();
    c.strokeStyle = '#fff';
    c.lineWidth = 2;
    pill();
    c.stroke();
    // Zeiger zum Fahrer
    const px = Math.max(x + 14, Math.min(x + w - 14, t.x));
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(px - 7, y + h + 0.5);
    c.lineTo(px + 7, y + h + 0.5);
    c.lineTo(px, y + h + 9);
    c.closePath();
    c.fill();
    c.fillStyle = '#fff';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.font = `800 15px ${font}`;
    c.fillText(t.text, x + 13, y + h / 2 + 0.5);
    if (t.sub) {
      c.font = `700 12px ${font}`;
      c.fillStyle = 'rgba(255,255,255,0.88)';
      c.fillText(t.sub, x + 13 + tw + 8, y + h / 2 + 0.5);
    }
    c.restore();
  }

  /** Mitspieler hinter einem: Schild am linken oder rechten Bildrand (wo er fährt) mit Abstand */
  private drawMarkOff(c: CanvasRenderingContext2D) {
    if (!this.markOff.length) return;
    const font = 'ui-rounded, "SF Pro Rounded", -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif';
    const slots = { l: 0, r: 0 };
    c.save();
    c.textBaseline = 'middle';
    for (const m of [...this.markOff].sort((a, b) => b.dz - a.dz).slice(0, 4)) {
      const label = `▼ ${m.name} · ${Math.max(1, Math.round(-m.dz))} m`;
      c.font = `800 13px ${font}`;
      const w = c.measureText(label).width + 22;
      const h = 28;
      const k = m.left ? slots.l++ : slots.r++;
      const x = m.left ? 10 : this.W - 10 - w;
      const y = this.H * 0.6 + k * (h + 6);
      const r = h / 2;
      c.globalAlpha = -m.dz < 8 ? 1 : 0.85;
      c.fillStyle = m.color;
      c.beginPath();
      c.moveTo(x + r, y);
      c.lineTo(x + w - r, y);
      c.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
      c.lineTo(x + r, y + h);
      c.arc(x + r, y + r, r, Math.PI / 2, (Math.PI * 3) / 2);
      c.closePath();
      c.fill();
      c.fillStyle = 'rgba(0, 0, 0, 0.18)';
      c.fill();
      c.strokeStyle = '#fff';
      c.lineWidth = 2;
      c.stroke();
      c.fillStyle = '#fff';
      c.textAlign = 'left';
      c.fillText(label, x + 11, y + h / 2 + 0.5);
    }
    c.restore();
  }

  private drawTag(c: CanvasRenderingContext2D, t: { x: number; y: number; text: string; mate: boolean; a: number; sub?: string; color?: string }) {
    const font = '-apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif';
    c.save();
    c.globalAlpha = t.a * 0.95;
    c.font = `700 12px ${font}`;
    const label = t.text;
    const tw = c.measureText(label).width;
    c.font = `700 11px ${font}`;
    const sw = t.sub ? c.measureText(t.sub).width + 7 : 0;
    c.font = `700 12px ${font}`;
    const dot = t.mate || t.color ? 12 : 0;
    const w = tw + 18 + dot + sw;
    const h = 22;
    const x = Math.max(8, Math.min(this.W - 8 - w, t.x - w / 2));
    const y = t.y - h - 8 - (1 - t.a) * 6;
    c.fillStyle = 'rgba(12, 14, 20, 0.74)';
    c.beginPath();
    // abgerundete Pille (ohne roundRect, das ältere Safaris nicht kennen)
    const r = h / 2;
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
    c.lineTo(x + r, y + h);
    c.arc(x + r, y + r, r, Math.PI / 2, (Math.PI * 3) / 2);
    c.closePath();
    c.fill();
    // kleiner Zeiger nach unten zum Fahrer
    const px = Math.max(x + 10, Math.min(x + w - 10, t.x));
    c.beginPath();
    c.moveTo(px - 5, y + h - 0.5);
    c.lineTo(px + 5, y + h - 0.5);
    c.lineTo(px, y + h + 5);
    c.closePath();
    c.fill();
    if (t.mate || t.color) {
      c.fillStyle = t.color ?? this.accent;
      c.beginPath();
      c.arc(x + 12, y + h / 2, 3.5, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#fff';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(label, x + 9 + dot, y + h / 2 + 0.5);
    if (t.sub) {
      // Zeitabstand: grün, wenn man vorn liegt (Minus), sonst in Weiß gedämpft
      c.font = `700 11px ${font}`;
      c.fillStyle = t.sub.startsWith('−') ? '#5fe08a' : 'rgba(255,255,255,0.75)';
      c.fillText(t.sub, x + 9 + dot + tw + 7, y + h / 2 + 0.5);
    }
    c.restore();
  }

  /**
   * hat der Browser den 3D-Kontext entzogen (App im Hintergrund, Speicherdruck)? Bleibt wahr, auch wenn er ihn
   * zurückgibt: three.js lädt dann zwar Geometrie und Texturen neu, aber was nur in Zwischenbildern lebt – die
   * gebackenen Zuschauer und Fahrer als Bilder – ist leer. Die Bühne wird verworfen und neu gebaut (sonst fehlten
   * nach einem Wechsel in eine andere App alle Zuschauer, bis zum Neustart).
   */
  get lost(): boolean {
    if (this.wasLost) return true;
    try { return this.gl.getContext().isContextLost(); } catch { return true; }
  }
  private wasLost = false;

  dispose() {
    this.offGfx();
    this.offRes();
    try { this.clearChunks(); this.skyLife.dispose(); this.crowdAtlas.dispose(); this.markers?.dispose(); this.ttStart?.dispose(); this.descStart?.dispose(); this.wearRT?.dispose(); } catch { /* Kontext evtl. schon weg */ }
    try { this.gl.dispose(); } catch { /* egal */ }
    // Kontext sofort freigeben: iOS erlaubt nur wenige gleichzeitig – sonst bleibt ein späteres Spiel schwarz
    try { this.gl.forceContextLoss(); } catch { /* egal */ }
  }
}


function fmtKm(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`;
}

export type { Friend };
