/**
 * Alpenhaus für den WebGPU-Test: ein Tiroler Bauernhaus, Stück für Stück gebaut – Bruchsteinsockel mit Terrasse,
 * gekalktes Erdgeschoss mit gemalten Fensterfaschen und Eckquadern, Obergeschoss aus Blockbohlen mit
 * vorstehenden Eckköpfen, Giebel aus senkrechten Brettern, flaches Satteldach mit Holzschindeln, weitem
 * Überstand, sichtbaren Pfetten, Sparren und Kopfbändern, verzierten Windbrettern und Firstzier. Rundum-Balkon
 * mit ausgesägten Brettbalustern und Geranien, Giebelbalkon, Sprossenfenster mit Vorhängen und Jalousieläden,
 * Haustür mit Füllungen und Vordach, Kamin, Rinnen und Fallrohre, Holzstoß, Bank und Tisch.
 *
 * Alles in fünf Materialien (Putz, Holz, Schindeln, Stein, Kleinteile), damit viele Häuser als Instanzen mit
 * wenigen Zeichenaufrufen auskommen. Zwei Stufen: nah (~40 000 Dreiecke), fern (~600).
 * Lokale Maße: Giebel vorn bei +z (zum Tal), Breite x = ±5 m, Tiefe z = ±6 m, Boden der Wohnung bei y = 0,7.
 */
import * as THREE from 'three/webgpu';
import type { Surface, SurfaceId } from './bake';
import { decodeAlbedo, tsl, unTile, useDither, type N } from './nodes';
import { cheapMaterial } from './light';
import { instNodes } from './inst';
import { MOOD_U } from './mood';
import type { HMat } from '../abfahrt/alphouse';

// Geometrie (Baukasten, Haus) steht in abfahrt/alphouse.ts – auch das WebGL-Spiel baut damit
export * from '../abfahrt/alphouse';

const { attribute, float, mix, normalize, positionGeometry, select, smoothstep, texture, uv, varying, vec3, vertexColor } = tsl;

/** Materialien der Häuser (Instanzen: iP Ort/Drehung, iS.w Putzfarbe 0 … 1, iC Farbe der Läden) */
export function houseMaterials(S: Record<SurfaceId, Surface>, fade: ((I: ReturnType<typeof instNodes>) => [N, N]) | null): Record<HMat, THREE.MeshBasicNodeMaterial> {
  // günstiges Licht (light.ts): Lambert mit gemessenem Umgebungslicht – Häuser sind matt (Putz, Holz, Schindeln)
  const make = (name: string, shade: (I: ReturnType<typeof instNodes>) => { col: N; rough: N; ao?: N; xy?: N; metal?: N; k?: number }, emissive?: (I: ReturnType<typeof instNodes>) => N) => {
    const I = instNodes();
    const o = shade(I);
    let nW: N = I.nWorld;
    if (o.xy) {
      const T = varying(I.rot(attribute('aTU', 'vec3')), 'vHT');
      const B = varying(I.rot(attribute('aTV', 'vec3')), 'vHB');
      const k = o.k ?? 1;
      nW = normalize(normalize(I.nWorld).add(T.mul(o.xy.x.mul(k))).add(B.mul(o.xy.y.mul(k))));
    }
    // Metall (Rinnen, Beschläge): etwas dunkler statt spiegelnd
    const col = o.metal ? o.col.mul(float(1).sub(o.metal.mul(0.4))) : o.col;
    const m = cheapMaterial({ col, nWorld: nW, ao: o.ao, extra: emissive ? emissive(I) : undefined });
    m.positionNode = I.world;
    // weiche Überblendung zwischen den Stufen (Raster: jede Stufe ihre eigenen Bildpunkte)
    if (fade) { const [lo, hi] = fade(I); useDither(m, lo, hi); }
    m.name = name;
    return m;
  };
  const tex = (id: SurfaceId, size: number, amt = 0.25) => {
    // je Haus anders verschoben und verbogen (kein Haus wie das andere, keine Kachel wie die nächste)
    const I0 = instNodes();
    const p = unTile(S.noise.albedo, uv().div(size).add(I0.at.xz.mul(0.173)), amt);
    const a = texture(S[id].albedo, p);
    const t = texture(S[id].nra, p);
    return { col: decodeAlbedo(a.rgb), rough: t.z, ao: t.w, xy: t.xy.mul(2).sub(1) };
  };
  return {
    plaster: make('house-plaster', (I) => {
      const t = tex('plaster', 2, 0.3);
      // Putzfarbe je Haus (weiß bis warmes Cremeweiß), Spritzwasser und Schmutz unten
      const tint = mix(vec3(1, 1, 1), vec3(1.02, 0.95, 0.82), I.extra);
      const dirt = mix(float(0.66), float(1), smoothstep(0.7, 1.7, positionGeometry.y));
      return { col: t.col.mul(vertexColor()).mul(tint).mul(dirt), rough: t.rough, ao: t.ao, xy: t.xy };
    }),
    wood: make('house-wood', () => {
      const a = tex('logs', 2, 0.05);
      const c = tex('boards', 2, 0.05);
      const k = attribute('aE', 'vec4').w;
      return { col: mix(c.col, a.col, k).mul(vertexColor()), rough: mix(c.rough, a.rough, k), ao: mix(c.ao, a.ao, k), xy: mix(c.xy, a.xy, k) };
    }),
    roof: make('house-roof', () => {
      const t = tex('shingles', 2, 0.12);
      return { col: t.col.mul(vertexColor()), rough: t.rough, ao: t.ao, xy: t.xy, k: 1.3 };
    }),
    stone: make('house-stone', () => {
      const t = tex('masonry', 2.5, 0.25);
      return { col: t.col.mul(vertexColor()), rough: t.rough, ao: t.ao, xy: t.xy, k: 1.2 };
    }),
    detail: make('house-detail', (I) => {
      const e = attribute('aE', 'vec4');
      return { col: mix(vertexColor(), I.color, e.z), rough: e.x, metal: e.y };
    }, (I) => {
      // Nacht: Fensterscheiben leuchten warm (je Haus unterschiedlich viele)
      const e = attribute('aE', 'vec4');
      const glass = e.x.lessThan(0.1).and(e.z.lessThan(0.5));
      // abends brennt fast überall Licht (je Fenster etwas anders hell)
      const on = smoothstep(0.05, 0.25, I.extra.add(positionGeometry.x.mul(0.37).add(positionGeometry.z.mul(0.23)).sin().mul(0.5))).mul(0.6).add(0.4);
      return select(glass, vec3(1.0, 0.68, 0.34).mul(on).mul(MOOD_U.lights as unknown as N).mul(2.6), vec3(0, 0, 0));
    }),
  };
}
