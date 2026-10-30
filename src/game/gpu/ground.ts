/**
 * Bodenmaterialien für den WebGPU-Test: Wiese, Waldboden, Fels, Schnee, Kies, Beton – aus den gebackenen
 * Oberflächen gemischt. Gewichte und Grundfarben kommen je Ecke aus der Landschaft (terrain3d) bzw. aus dem
 * Querprofil der Straße (Korridor). Fels wird von drei Seiten projiziert (keine gestreckten Texturen an Wänden).
 */
import * as THREE from 'three/webgpu';
import type { Surface, SurfaceId } from './bake';
import { decodeAlbedo, grain, planar, triplanar, triplanarCol, tsl, unTile, unTile3, vn1, vnoise, type N } from './nodes';
import { cheapMaterial } from './light';
import { QUALITY } from './quality';
import { groundMap, lampLit, terrainSun } from './sunmap';

const { abs, attribute, cameraPosition, cross, dFdx, dFdy, dot, float, fract, fwidth, max, min, mix, normalize, normalWorldGeometry, positionGeometry, positionWorld, select, sign, smoothstep, texture, transformNormalToView, varying, vec2, vec3, vertexColor } = tsl;

/**
 * Kronendach: Wald hebt sich in der Ferne als geschlossene Masse über den Boden (aCan, je Ecke aus der Waldmaske) –
 * nah flach (dort stehen die echten Bäume), ab gut 80 m wächst es weich heraus. Die Baumspitzen ragen darüber.
 */
const CAN_FADE: [number, number] = [75, 175];

/** mittlere Landschaft: Fels ab hier ohne Normalenkarten und feine Bänke (Bildpunkte dort kleiner als die Feinheit) */
const LITE_ROCK = 650;

type Surfaces = Record<SurfaceId, Surface>;

/** gemeinsame Wiesenfarbe: Landschaft und Straßenrand kommen aus verschiedenen Farbtabellen – beide ziehen hierhin */
export const MEADOW = new THREE.Color(0.225, 0.315, 0.072);

interface Mix {
  tint: N;       // Grundfarbe Wiese (linear)
  rockTint: N;   // Felsfarbe der Gegend
  fo: N;         // Wald (Waldboden bzw. Kronendach)
  rk: N;         // Fels
  sn: N;         // Schnee
  gr: N;         // Kies / Bankett
  cc: N;         // Beton / Mauer
  /** Geröllhalden unter den Wänden (nur Landschaft) */
  sc?: N;
  canopy: boolean; // keine echten Bäume: Wald als Kronendach färben
  /** Blüten im Gras (gebackene Punkte, Rang im Alpha) */
  dots?: THREE.Texture;
  detail: boolean; // feine Texturen (nah) – sonst nur die großen
  /** Qualität „schonend“: nah ohne Korn, Trittpfade, Blüten, Erdflecken und Fels-Normalen, Fels überall gröber */
  simple?: boolean;
  /** ganz fern (grobe Stufe): Fels nur von oben */
  far?: boolean;
  /** Straßenrand (Kies und Beton) */
  road?: boolean;
  /** Kronendach: wie weit angehoben (0 … 1, je Ecke) – dort ist sicher Wald */
  can?: N;
}

const meanOf = (s: Surface): N => vec3(s.mean.r, s.mean.g, s.mean.b);

/** grobes Waldgewicht (Felsköpfe nicht mitten im Wald) */
const foBase = (m: Mix): N => smoothstep(0.1, 0.5, m.fo);

/**
 * Relief der Felswände ohne Texturzugriff (nur Rechnen, nur wo Fels ist): Rinnen und Rippen die Wand hinab (in
 * der Höhe mäandernd), dunkle Wasserstreifen, Schichtbänke leicht schräg durch den ganzen Berg. Die Ableitungen
 * kippen die Normale – Licht und Schatten zeichnen Rinnen und Simse, Schnee und Gras bleiben auf den Simsen
 * liegen. Wände werden von zwei Seiten betrachtet (x- und z-zugewandt, weich gemischt).
 * Ergebnis: Helligkeit (Rinnen, Bänke, Streifen) und die gekippte Normale.
 */
function rockRelief(pos: N, nG: N, n: N, strata: N, lod = 0): { k: N; n: N } {
  if (/[?&]norelief\b/.test(location.search)) return { k: float(1), n };
  const ax = abs(nG.x), az = abs(nG.z);
  const wx0 = ax.mul(ax).mul(ax.mul(ax)), wz0 = az.mul(az).mul(az.mul(az));
  const ws = wx0.add(wz0).add(1e-4);
  const wx = wx0.div(ws), wz = wz0.div(ws);
  const steep = float(1).sub(nG.y.mul(nG.y)).clamp(0, 1);
  // Rinnen: u läuft waagrecht die Wand entlang, mit der Höhe leicht versetzt (Rinnen mäandern)
  const gully = (u: N, seed: number) => {
    const w = vn1(pos.y.div(53), seed + 7);
    const uu = u.add(w.v.sub(0.5).mul(26));
    // drei Größen: Runsen (110 m), Rinnen (33 m), Furchen (9,5 m); Tiefe wie die Breite (fraktal)
    const a = vn1(uu.div(110), seed);
    const b = vn1(uu.div(33), seed + 3);
    // fern (Stufe 2): Furchen und Streifen wären kleiner als ein Bildpunkt – ihr Mittel statt der Rechnung
    if (lod >= 2) return { g: a.v.mul(0.45).add(b.v.mul(0.33)).add(0.11), d: a.d.mul(16 / 110).add(b.d.mul(5 / 33)), st: null };
    const c = vn1(uu.div(9.5), seed + 9);
    const st = vn1(uu.div(2.6), seed + 5);
    return {
      g: a.v.mul(0.45).add(b.v.mul(0.33)).add(c.v.mul(0.22)),
      d: a.d.mul(16 / 110).add(b.d.mul(5 / 33)).add(c.d.mul(1.4 / 9.5)),
      st: st.v as N | null,
    };
  };
  const X = gully(pos.z, 11);
  const Z = gully(pos.x, 23);
  const g = X.g.mul(wx).add(Z.g.mul(wz));
  const st = X.st && Z.st ? X.st.mul(wx).add(Z.st.mul(wz)) : null;
  const grad = vec3(Z.d.mul(wz), 0, X.d.mul(wx));
  // Schichtbänke: leicht schräg gestellte Lagen (überall dieselbe Neigung, wie ein gekippter Kalkstock); ab der
  // mittleren Stufe ohne die feinen Bänke (1,7 m)
  const ys = pos.y.add(pos.x.mul(0.09)).sub(pos.z.mul(0.055));
  const s1 = vn1(ys.div(5.5), 31);
  const s2 = lod >= 1 ? null : vn1(ys.div(1.7), 37);
  const sb = s2 ? s1.v.mul(0.7).add(s2.v.mul(0.3)) : s1.v.mul(0.7).add(0.15);
  const ds = (s2 ? s1.d.mul(0.7 / 5.5).add(s2.d.mul(0.3 / 1.7)) : s1.d.mul(0.7 / 5.5)).mul(strata);
  // Wasserstreifen: schmal, dunkel, nur stellenweise (Quellhorizonte) – fern nicht
  const wet = st ? smoothstep(0.66, 0.92, st).mul(smoothstep(0.45, 0.75, vn1(pos.y.div(27), 41).v)).mul(steep) : float(0);
  // Flecken (Bergsturznarben hell, Flechten dunkel), 60–150 m
  const patch = vnoise(vec2(pos.z.div(83), pos.y.div(61)), 4096).mul(wx).add(vnoise(vec2(pos.x.div(83).add(17.3), pos.y.div(61)), 4096).mul(wz));
  const k = g.mul(0.8).add(0.58).mul(sb.sub(0.5).mul(strata.mul(0.5)).add(1)).mul(float(1).sub(wet.mul(0.45))).mul(patch.mul(0.36).add(0.82));
  const nn = normalize(n.sub(grad.mul(steep)).sub(vec3(0, ds.mul(steep.mul(0.9)), 0)));
  return { k, n: nn };
}

/**
 * Großflächiges je Ecke (im Vertex-Shader, aus kleinen Mipmaps der gebackenen Texturen): Farbzonen der Wiese,
 * trockene Stellen, Baumgrenze, Felsköpfe, Wandpartien, Schneeflecken, Blütendichte. Das ändert sich über ein paar
 * Meter kaum – je Bildpunkt gelesen kostete es sieben Texturzugriffe. spacing: Abstand der Ecken (m).
 */
function perVertex(S: Surfaces, detail: boolean, spacing: number) {
  const pos = positionWorld;
  const lvl = (t: THREE.Texture, scale: number, sp = spacing) => {
    const w = (t.image as { width?: number } | undefined)?.width ?? 1024;
    return Math.max(0, Math.log2((w * sp) / scale));
  };
  const smp = (s: Surface, scale: number): N => texture(s.albedo, pos.xz.div(scale)).level(lvl(s.albedo, scale));
  const nzv = (scale: number): N => texture(S.noise.albedo, pos.xz.div(scale)).level(lvl(S.noise.albedo, scale)).rgb;
  const gm = meanOf(S.grass);
  // drei Einzelwerte in einem Übergabewert: WebGPU erlaubt nur 16 zwischen Vertex- und Pixel-Shader, die
  // Landschaft braucht fast alle
  const pk = varying(vec3(
    // Baumgrenze ausfransen (97 m)
    decodeAlbedo(smp(S.grass, 97).rgb).div(gm).y.sub(1),
    // Schneeflecken
    smoothstep(0.35, 0.75, nzv(330).z.mul(0.7).add(nzv(70).y.mul(0.3))),
    // Blütendichte
    smoothstep(0.3, 0.7, decodeAlbedo(smp(S.grass, 53).rgb).x.div(gm.x).mul(0.5)),
  ), 'vPk') as N;
  return {
    /** Wiese grob (29 m), relativ zum Mittel */
    gC: varying(decodeAlbedo(smp(S.grass, 29).rgb).div(gm), 'vGC') as N,
    /** sehr groß (173 m): trockene und satte Flächen */
    macro: varying(smp(S.grass, 173).rgb, 'vMacro') as N,
    /** Baumgrenze ausfransen (97 m) */
    wob: pk.x as N,
    /** Felsköpfe und Erdflecken */
    rk2: varying(nzv(detail ? 41 : 160), 'vRk2') as N,
    /** Wandpartien (hell/dunkel, rötlich), Grasbänder */
    zone: varying(nzv(detail ? 140 : 520), 'vZone') as N,
    /** Schneeflecken */
    patchy: pk.y as N,
    /**
     * Wiesenarten (Flecken von 30–130 m): satte Fettwiese, magere Weide, hellere und dunklere Flecken – auf allen
     * Stufen aus derselben Mip-Stufe (sonst ändert sich die Wiese an der Grenze zur gröberen Landschaft)
     */
    mz: varying(texture(S.noise.albedo, pos.xz.div(260)).level(lvl(S.noise.albedo, 260, Math.max(16, spacing))).rgb, 'vMz') as N,
    /** Blütendichte */
    many: pk.z as N,
  };
}

/**
 * Schattierung aus den Gewichten: Farbe, Verschattung, Weltnormale. Je Bildpunkt nah höchstens zwölf
 * Texturzugriffe (Wiese, Blüten, Kies, Fels von drei Seiten, Schnee), fern fünf bis acht.
 */
function shade(S: Surfaces, m: Mix, spacing: number) {
  const pos = positionWorld;
  const nG = normalize(normalWorldGeometry);
  // wahre Flächenrichtung (je Dreieck): die Eckennormalen der Landschaft kommen aus dem Höhenfeld, die Schürzen an
  // den Kachelrändern (senkrecht, wo eine Nachbarkachel tiefer liegt) und Stufen von einer Zelle Breite tragen dort
  // aber die Normale der Kante – sie stünden als Wiesen-Vorhänge im Bild. Fast senkrechte Flächen werden Fels
  // mit der echten Richtung.
  const fN0 = normalize(cross(dFdx(pos), dFdy(pos)));
  const fN = fN0.mul(sign(dot(fN0, cameraPosition.sub(pos))));
  const vert = m.road ? float(0) : float(1).sub(smoothstep(0.3, 0.5, abs(fN.y)));
  const nR = normalize(mix(nG, fN, vert));
  const V = perVertex(S, m.detail, spacing);
  const gm = meanOf(S.grass);
  // Wiese fein (3,2 m): nur nah
  const gF = m.detail ? planar(S.grass.albedo, S.grass.nra, unTile(S.noise.albedo, pos.xz.div(3.2), 0.4), nG, 0.9) : null;
  const gC: N = V.gC;
  const gDet: N = gF ? decodeAlbedo(gF.col).div(gm) : gC;
  const macro: N = V.macro;
  const dryW = smoothstep(0.42, 0.6, macro.y.mul(macro.y).div(gm.y).mul(0.5));
  const meadow = vec3(MEADOW.r, MEADOW.g, MEADOW.b);
  const base = mix(mix(vec3(m.tint.dot(vec3(0.3, 0.55, 0.15))), m.tint, 0.78).mul(0.9), meadow, 0.55);
  const flat = smoothstep(0.5, 0.82, nG.y);
  const steepG = float(1).sub(smoothstep(0.72, 0.95, nG.y));
  const tint = mix(base, base.mul(vec3(1.25, 1.05, 0.62)), dryW.mul(0.55).add(steepG.mul(0.3)).min(0.8)).mul(macro.x.mul(0.6).add(0.75).clamp(0.7, 1.25));
  let grassCol: N = tint.mul(m.detail ? mix(gC.mul(0.35).add(0.65), gDet.mul(0.7).add(gC.mul(0.3)), flat) : mix(float(1), gC.mul(0.6).add(0.4), flat));
  // nah: unregelmäßige Helligkeit über einen halben Meter und feines Korn (wiederholt sich nie, blendet fern aus)
  if (m.detail && !m.simple) grassCol = grassCol.mul(grain(pos.xz, 0.55, 0.11)).mul(grain(pos.xz.add(17.3), 0.13, 0.12));
  // Vielfalt statt Grashalmen: Wiesenarten über ein paar Dutzend Meter (je Ecke, kostet nichts je Bildpunkt)
  const mz: N = V.mz;
  const lush = smoothstep(0.3, 0.62, mz.x);
  const lean = smoothstep(0.32, 0.66, mz.y).mul(float(1).sub(lush));
  grassCol = grassCol.mul(mix(vec3(1, 1, 1), vec3(0.8, 0.97, 0.72), lush.mul(0.8))).mul(mix(vec3(1, 1, 1), vec3(1.17, 1.09, 0.78), lean.mul(0.85))).mul(mz.z.mul(0.32).add(0.9));
  if (m.detail && !m.simple) {
    // Viehgangeln: an steilen Weiden schmale Trittpfade entlang der Höhenlinien (nur wo das Muster nicht flimmert)
    const sl = float(1).sub(nG.y);
    const slopeM = smoothstep(0.07, 0.15, sl).mul(float(1).sub(smoothstep(0.32, 0.45, sl)));
    const cw = pos.y.div(1.5).add(gC.x.mul(1.4)).add(mz.y.mul(2.5));
    const fr = fract(cw);
    const dl = min(fr, float(1).sub(fr));
    const fade = float(1).sub(smoothstep(0.1, 0.3, fwidth(cw)));
    const tracks = float(1).sub(smoothstep(0.035, 0.11, dl)).mul(fade).mul(slopeM).mul(smoothstep(0.2, 0.45, mz.z));
    grassCol = mix(grassCol, grassCol.mul(vec3(0.64, 0.58, 0.48)), tracks.mul(0.8));
  }
  if (m.road) {
    // Straßenrand: dichteres, büscheliges Gras (dunkle und helle Büschel) statt einzelner Halme
    const tuft = texture(S.noise.albedo, pos.xz.div(2.3)).y;
    grassCol = grassCol.mul(tuft.mul(0.6).add(0.8));
  }
  const camD = pos.sub(cameraPosition).length();
  if (m.dots && !m.simple) {
    const fd = texture(m.dots, pos.xz.div(3));
    const many = V.many.mul(flat);
    const texPx = fwidth(pos.x).add(fwidth(pos.z)).mul(0.5).div(3).mul(512);
    const near = float(1).sub(smoothstep(3, 8, texPx)).mul(float(1).sub(smoothstep(40, 80, camD)));
    const thr = many.mul(0.29);
    const show = float(1).sub(smoothstep(thr.sub(0.02), thr, fd.a)).mul(near);
    grassCol = mix(grassCol, decodeAlbedo(fd.rgb).mul(0.85), show);
    grassCol = mix(grassCol, grassCol.add(vec3(0.022, 0.02, 0.008)), many.mul(float(1).sub(near)).mul(0.5));
  }
  let col: N = grassCol;
  let ao: N = gF ? mix(float(1), gF.ao, flat) : float(1);
  // Stufen 1 und 2 (ab ~230 m): nur, was man dort noch sieht – keine Normalenkarte der Wiese, kein Kies (Geröll als
  // Farbe), Fels ohne Normalenkarten, fern ohne Schneetextur und mit gröberem Relief. Auf dem iPhone kostete die
  // ferne Landschaft ein Viertel des ganzen Bilds (Kostenanalyse: −1,43 von 5,87 ms)
  let n: N = gF ? normalize(mix(nG, gF.n, flat)) : nG;
  const rk2: N = V.rk2;
  // ein Kieszugriff für Erde, Geröll und Bankett (nur nah)
  const gv = m.detail && (!m.simple || m.road) ? planar(S.gravel.albedo, S.gravel.nra, unTile(S.noise.albedo, pos.xz.div(1.6), 0.4), nG, 0.8) : null;
  if (m.detail && gv && !m.simple) {
    const dirt = smoothstep(0.8, 0.9, rk2.y.add(steepG.mul(0.12))).mul(0.8);
    const soil = mix(vec3(0.075, 0.058, 0.04), decodeAlbedo(gv.col).mul(0.55), smoothstep(0.85, 1.2, decodeAlbedo(gv.col).x.div(meanOf(S.gravel).x)));
    col = mix(col, soil, dirt);
    n = normalize(mix(n, gv.n, dirt));
  }
  // Wald: nah Waldboden, fern Kronendach (Buckel aus der groben Wiese)
  const crown = gC.dot(vec3(0.3, 0.5, 0.2));
  let canopyCol: N = mix(vec3(0.03, 0.052, 0.024), vec3(0.095, 0.13, 0.052), crown.mul(0.6).clamp(0, 1)).mul(gC.y.mul(0.35).add(0.82));
  if (!m.road && !m.far) {
    // Kronen statt Fläche: helle Kronen, dunkle Lücken (ein Zugriff, nur im Wald) – das Dach liest sich als Wald
    const ct = texture(S.noise.albedo, pos.xz.div(13));
    const lumps = smoothstep(0.04, 0.42, ct.x.mul(0.65).add(ct.y.mul(0.35)));
    const inWood = (m.can ? max(m.fo, m.can) : m.fo).greaterThan(0.05);
    // etwas dunkler als die Fläche allein: die Bilder-Bäume davor sind innen verschattet
    canopyCol = select(inWood, canopyCol.mul(lumps.mul(0.85).add(0.36)), canopyCol);
  }
  const floorCol = mix(m.tint.mul(0.55), mix(vec3(0.07, 0.06, 0.035), vec3(0.09, 0.075, 0.045), gDet.x.mul(0.5).clamp(0, 1)), 0.6).mul(gDet.mul(0.5).add(0.5));
  const forestCol = m.canopy ? canopyCol : mix(floorCol, canopyCol, smoothstep(CAN_FADE[0] - 10, CAN_FADE[1] - 20, camD));
  const fo = smoothstep(0.25, 0.75, m.fo.add(V.wob.mul(0.45)));
  const clumps = smoothstep(0.62, 0.8, crown.mul(0.5)).mul(smoothstep(0.02, 0.3, m.fo)).mul(0.8);
  // wo das Dach angehoben ist, immer Waldfarbe (sonst Wiese auf dem Dach)
  const foW = m.can ? max(max(fo, clumps), m.can) : max(fo, clumps);
  // Waldsaum: vor dem Waldrand ist die Wiese dunkler (Schatten, höheres Gras) – der Wald steht fest im Boden
  const edge = smoothstep(0.0, 0.25, m.fo).mul(float(1).sub(foW));
  col = col.mul(float(1).sub(edge.mul(0.28)));
  col = mix(col, forestCol, foW);
  // Kies und Beton (Bankett, Rinne, Mauerkrone)
  if (m.detail && gv && m.road) {
    const gravelCol = decodeAlbedo(gv.col).mul(0.62);
    col = mix(col, gravelCol, m.gr);
    ao = mix(ao, gv.ao, m.gr);
    n = mix(n, gv.n, m.gr);
    const concrete = vec3(0.3, 0.29, 0.27).mul(decodeAlbedo(gv.col).div(meanOf(S.gravel)).mul(0.25).add(0.75));
    col = mix(col, concrete, m.cc);
    n = mix(n, mix(nG, gv.n, 0.25), m.cc);
  }
  // Geröll unter den Wänden (fern ohne Kiestextur: die Felsfarbe der Gegend)
  const screeCol: N = gv ? decodeAlbedo(gv.col).div(meanOf(S.gravel)).mul(m.rockTint).mul(1.05) : m.rockTint.mul(1.05);
  if (m.sc) {
    col = mix(col, screeCol, m.sc);
    if (gv) {
      ao = mix(ao, gv.ao, m.sc);
      n = normalize(mix(n, gv.n, m.sc));
    }
  }
  // Fels: nah und mittel von drei Seiten (Wände mit Schichtbänken, von oben Blöcke), ganz fern nur von oben
  const outcrop = smoothstep(0.72, 0.82, rk2.x.add(steepG.mul(0.15))).mul(steepG).mul(float(1).sub(foBase(m)));
  // fast senkrechte Flächen sind Fels (Wiese von oben projiziert zöge sich dort zu Streifen)
  const rkW = max(max(m.rk, outcrop.mul(0.9)), vert);
  const zone: N = V.zone;
  let rockCol: N;
  let rockN: N;
  let rockAo: N;
  // nur wo Fels ist: select wird zu einer echten Verzweigung, Wiese und Wald sparen die Felszugriffe (nah sechs)
  const hasRock = rkW.greaterThan(0.003);
  // Schichtbänke nicht überall gleich deutlich (manche Wände massig)
  const strata = smoothstep(0.25, 0.7, zone.y).mul(0.7).add(0.3);
  if (m.far) {
    const t = texture(S.rock.albedo, pos.xz.div(60));
    const rr = rockRelief(pos, nR, nR, strata, 2);
    const tc = mix(vec3(1, 1, 1), decodeAlbedo(t.rgb).div(meanOf(S.rock)), 0.5);
    const M = select(hasRock, tsl.mat3(tc.mul(m.rockTint).mul(rr.k.mul(0.95)), rr.n, vec3(1, 0, 0)), tsl.mat3(vec3(0, 0, 0), n, vec3(1, 0, 0)));
    rockCol = M.element(0);
    rockN = M.element(1);
    rockAo = float(1);
  } else {
    const top = { albedo: S.rock.albedo, nra: S.rock.nra };
    // Fels als Matrix (Farbe, Normale, Verschattung als Spalten): eine Verzweigung für alles – sonst baut three die
    // Zugriffe für jede Verzweigung neu. lite (mittlere Stufe ab LITE_ROCK m): nur die Farben der drei Seiten (die
    // Normalen kommen aus dem Relief), ohne die feinen Bänke – drei Zugriffe und eine Rauschstufe weniger
    const rockOf = (lite: boolean, lod: number): N => {
      const sc = m.detail ? 9 : 27;
      const warp = unTile3(S.noise.albedo, pos, sc, 0.45);
      // mittlere Stufe nah: die Feinheit der Normalen läuft zur Grenze hin aus (dahinter die Variante ohne)
      const bump: N | number = m.detail ? 1.5 : float(2).mul(float(1).sub(smoothstep(LITE_ROCK * 0.75, LITE_ROCK, camD)));
      const r = lite ? triplanarCol(S.cliff.albedo, S.rock.albedo, pos, nR, sc, 10, warp) : triplanar(S.cliff.albedo, S.cliff.nra, pos, nR, sc, 10, top, bump, warp);
      // mittlere Stufe: die Wandtextur (27 m) nur halb so kräftig – sonst ein Vorhang aus gleichen Streifen über den
      // ganzen Berg; die großen Formen kommen aus dem Relief
      const rRaw = m.detail ? decodeAlbedo(r.col).div(meanOf(S.cliff)) : mix(vec3(1, 1, 1), decodeAlbedo(r.col).div(meanOf(S.cliff)), 0.5);
      const rr = rockRelief(pos, nR, m.detail ? r.n : normalize(mix(nR, r.n, 0.5)), strata, lod);
      const rc = rRaw.mul(m.rockTint).mul(0.6).add(rRaw.mul(vec3(0.2, 0.19, 0.17)).mul(0.4)).mul(rr.k.mul(1.15));
      return tsl.mat3(rc, rr.n, vec3(r.ao, 0, 0));
    };
    const noRock = tsl.mat3(vec3(0, 0, 0), nR, vec3(1, 0, 0));
    // schonend: nah ohne Normalenkarten (Relief ohne feine Bänke), mittlere Stufe überall wie ganz fern
    const M = select(hasRock, m.detail ? (m.simple ? rockOf(true, 1) : rockOf(false, 0))
      : m.simple ? rockOf(true, 2) : select(camD.lessThan(LITE_ROCK), rockOf(false, 0), rockOf(true, 1)), noRock);
    rockCol = M.element(0);
    rockN = M.element(1);
    rockAo = M.element(2).x;
  }
  rockCol = rockCol.mul(zone.z.mul(0.45).add(0.8)).mul(mix(vec3(1, 1, 1), vec3(1.12, 1.0, 0.84), smoothstep(0.55, 0.85, zone.x)));
  // nah: Korn im Fels (Wände: aus Höhe und Lage längs der Wand)
  if (m.detail && !m.simple) rockCol = rockCol.mul(grain(vec2(pos.x.add(pos.z.mul(0.71)), pos.y.add(pos.z.mul(0.37))), 0.37, 0.16));
  const ledgeG = smoothstep(0.82, 0.95, normalize(rockN).y).mul(float(1).sub(smoothstep(0.05, 0.4, m.sn))).mul(smoothstep(0.3, 0.6, zone.y.add(0.15)));
  const rkV = rkW.mul(float(1).sub(ledgeG.mul(0.85)));
  col = mix(col, rockCol, rkV);
  ao = mix(ao, rockAo, rkV);
  n = mix(n, rockN, rkW);
  if (gv && m.sc) {
    const sr = rkV.mul(smoothstep(0.6, 0.82, nG.y)).mul(smoothstep(0.3, 0.6, zone.y)).mul(0.85);
    col = mix(col, screeCol, sr);
    n = mix(n, gv.n, sr);
  }
  // Schnee: Altschnee in Flecken; auf Fels nur auf Simsen
  const ledge = smoothstep(0.72, 0.9, normalize(rockN).y);
  const snowRaw = m.sn.mul(V.patchy.mul(0.9).add(0.2)).mul(mix(float(1), ledge, rkW.mul(0.7)));
  const sn = smoothstep(0.36, 0.46, snowRaw);
  // Schneetextur nur, wo Schnee liegt
  const sA: N = m.far ? vec3(1, 1, 1) : decodeAlbedo(texture(S.snow.albedo, pos.xz.div(m.detail ? 6 : 17)).rgb).div(meanOf(S.snow));
  const snowCol = select(sn.greaterThan(0.001), sA.mul(vec3(0.83, 0.86, 0.9)).mul(sA.x.mul(0.25).add(0.75).clamp(0.6, 1.2)), vec3(0, 0, 0));
  col = mix(col, snowCol, sn);
  ao = mix(ao, float(0.95), sn);
  n = mix(n, normalize(mix(nG, n, 0.35)), sn);
  return { col, ao: ao as N, n: normalize(n) };
}

/**
 * Material aus der Schattierung: Sonnenlicht vorberechnet (sun: Sonne und Himmel je Ecke aus den Kacheln, sonst
 * die Geländelicht-Karte), ground: Schatten der Dinge und Laternenlicht aus der Bodenkarte (nah)
 */
function apply(o: ReturnType<typeof shade>, name: string, opt: { sun?: N; ground?: boolean } = {}): THREE.MeshBasicNodeMaterial {
  const pos = positionWorld;
  const g = opt.ground ? groundMap(pos.xz) : null;
  let vis: N = opt.sun ? opt.sun.x : terrainSun(pos.xz);
  if (g) vis = vis.mul(g.x);
  const ao = opt.sun ? o.ao.mul(opt.sun.y) : o.ao;
  const mat = cheapMaterial({ col: o.col, nWorld: o.n, ao, vis, extra: g ? lampLit(o.col, g.w) : undefined });
  mat.name = name;
  return mat;
}

/**
 * Landschaft (Kacheln aus terrain3d): Farbe = Wiese der Gegend, aMat = (Wald, Fels, Schnee, Rauschen),
 * aRock = Felsfarbe, aNz = großflächiges Rauschen. lv 0 mit echten Bäumen, darüber Kronendach. woods: Bergwald
 * (Terrain.woods – die Waldmaske im Attribut ist schon die der Bäume).
 */
export function terrainMaterial(S: Surfaces, lv: number, dots?: THREE.Texture, woods = false): THREE.MeshBasicNodeMaterial {
  const aMat = attribute('aMat', 'vec4');
  const aNz = attribute('aNz', 'vec2');
  // Waldrand und Baumgrenze ausgefranst (sonst eine gerade Höhenlinie quer über den Berg); im Bergwald ist die
  // Maske schon ausgefranst und deckt sich mit den Bäumen
  const fo = woods
    ? smoothstep(0.3, 0.7, aMat.x.add(aNz.y.sub(0.5).mul(0.2)))
    : smoothstep(0.38, 0.66, aMat.x.add(aMat.w.sub(0.5).mul(0.4)).add(aNz.x.sub(0.5).mul(0.8)));
  const rk = smoothstep(0.32, 0.62, aMat.y.add(aNz.y.sub(0.5).mul(0.3)));
  const sn = smoothstep(0.42, 0.6, aMat.z.add(aNz.y.sub(0.5).mul(0.45)));
  // Geröllhalden: im Saum der Felsgebiete, wo der Hang flacher wird (Schutt bleibt ab ~40° liegen), fingerförmig
  const ny = normalize(normalWorldGeometry).y;
  const sc = smoothstep(0.1, 0.3, aMat.y.add(aNz.x.sub(0.5).mul(0.35)).add(aMat.w.sub(0.5).mul(0.25)))
    .mul(float(1).sub(rk)).mul(smoothstep(0.6, 0.78, ny)).mul(float(1).sub(fo)).mul(0.9);
  const spacing = [4, 16, 64][lv] ?? 16;
  // Kronendach anheben (nah flach) – nur im Bergwald, dort deckt sich das Dach mit den Bäumen
  const lift = woods ? attribute('aCan', 'float').mul(smoothstep(CAN_FADE[0], CAN_FADE[1], positionGeometry.xz.sub(cameraPosition.xz).length())) : null;
  const can = lift ? varying(smoothstep(0.5, 2.5, lift), 'vCan') : undefined;
  const mat = apply(shade(S, {
    tint: vertexColor(), rockTint: attribute('aRock', 'vec3'),
    fo, rk, sn, sc, gr: float(0), cc: float(0), canopy: lv > 0, detail: lv === 0, far: lv >= 2, dots: lv === 0 ? dots : undefined, can, simple: QUALITY.landSimple,
  }, spacing), `terrain${lv}`, { sun: attribute('aSun', 'vec2'), ground: lv === 0 });
  if (lift && !/[?&]nocan\b/.test(location.search)) mat.positionNode = positionGeometry.add(vec3(0, lift, 0));
  // Prüfmodus: Stufen einfärben (?lvcolor)
  if (/[?&]lvcolor\b/.test(location.search)) mat.colorNode = vec3(lv === 0 ? 0.6 : 0.05, lv === 1 ? 0.6 : 0.05, lv === 2 ? 0.6 : 0.05);
  if (/[?&]dbgmat\b/.test(location.search)) { mat.colorNode = vec3(fo, rk, sn).mul(0.5).add(0.02); mat.normalNode = transformNormalToView(normalize(normalWorldGeometry)); }
  if (/[?&]dbgny\b/.test(location.search)) { mat.colorNode = vec3(normalize(normalWorldGeometry).y, float(lv).mul(0.3), 0); mat.normalNode = transformNormalToView(vec3(0, 1, 0)); }
  if (/[?&]dbgsun\b/.test(location.search)) { const a = attribute('aSun', 'vec2'); mat.colorNode = vec3(a.x, a.y.mul(0.5), terrainSun(positionWorld.xz).mul(0.5)); }
  if (/[?&]dbgcol\b/.test(location.search)) { mat.colorNode = vertexColor(); mat.normalNode = transformNormalToView(normalize(normalWorldGeometry)); }
  return mat;
}

/** Straßenrand (Korridor): Farbe der Gegend je Ecke, Gewichte aW = (Wald, Fels, Schnee, Kies), aC = (Beton, Felsfarbe) */
export function corridorMaterial(S: Surfaces, dots?: THREE.Texture): THREE.MeshBasicNodeMaterial {
  const w = attribute('aW', 'vec4');
  const c = attribute('aC', 'vec4');
  return apply(shade(S, {
    tint: vertexColor(), rockTint: c.yzw, fo: w.x, rk: w.y, sn: w.z, gr: w.w, cc: c.x, canopy: false, detail: true, road: true, dots, simple: QUALITY.landSimple,
  }, 3), 'corridor', { ground: true });
}
