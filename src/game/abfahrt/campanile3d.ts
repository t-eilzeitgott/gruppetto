/**
 * Kirchturm der Orte (Campanile an der Piazza, Turm der Dorfkirche): gemauert (Stein oder – in Italien oft –
 * Backstein, mit Fugen aus der Mauertextur), Sockel, Ecklisenen, Gesimse rund um den Turm mit Wasserschlag,
 * schmale Rundbogenfenster mit hellem Gewände, Uhren auf allen vier Seiten (Zifferblatt mit Ring, Stundenstrichen
 * und Zeigern; mal weiß, mal blau mit Gold), Glockenstube mit echten Öffnungen (Zwillings- oder Drillingsbögen mit
 * Laibung, Kämpfern und Glocken im Dunkel), Konsolen mit Bogenfries unter dem Kranzgesims, darüber ein
 * achteckiger Helm (Ziegel, Schiefer oder Kupfer) – beim Campanile mit vier Eckfialen –, Kugel und Kreuz.
 *
 * Geometrie in die Netze des Ortes: Mauern mit Textur (stone, sonst plain), Einfarbiges (plain), Helm mit
 * Ziegeltextur (tiles), Kleinteile nur für die Nähe (detail). Alle Seiten werden gleich gebaut: der Turm steht
 * frei an der Ecke der Kirche und wird von allen Seiten gesehen.
 */
import { lin, type RGBf } from './models3d';
import type { At, Town } from './house3d';

export interface CampanileSpec {
  /** Punkt (quer, längs, Höhe über dem Platz) in der Welt */
  at: At;
  /** Mitte des Grundrisses (quer, längs) und Seitenlänge (m) */
  cl: number;
  ca: number;
  w: number;
  /** hoher Campanile an der Piazza: drittes Geschoss mit Zwillingsfenstern, Glockenstube mit drei Bögen */
  tall: boolean;
  /** Zufall je Turm (0 … 1) */
  rnd: (k: number) => number;
  /** Landessprache der Strecke (Backstein vor allem in Italien) */
  lang: string;
  /**
   * Turmform nach dem Ortsbild (venue.ts): Campanile (Italien), Clocher mit hohem schlankem Schieferhelm und Wetterhahn
   * (Frankreich), englischer Kirchturm mit Zinnen und vier Fialen ohne Helm
   */
  kind?: 'campanile' | 'clocher' | 'tower';
}

const sh = (c: RGBf, f: number): RGBf => [c[0] * f, c[1] * f, c[2] * f];

interface Face {
  /** Punkt auf der Seite: s waagrecht (von außen gesehen nach rechts), h Höhe, d vor der Mauer (nach außen) */
  p: (s: number, h: number, d?: number) => number[];
}

/** Höhe der Oberkante des Kranzgesimses (dort sitzt der Helm) */
export function campanileTop(tall: boolean) {
  return tall ? 34 : 23;
}

export function campanile(T: Town, S: CampanileSpec) {
  const { at, cl, ca, w, tall, rnd } = S;
  const hw = w / 2;
  const stone = T.stone ?? T.plain;
  const plain = T.plain;
  const fine = T.detail;
  const PI = Math.PI;

  // ---- Baustoff und Farben
  const brick = S.lang === 'it' ? rnd(1) < 0.55 : rnd(1) < 0.12;
  const wallC: RGBf = brick ? sh(lin('#b9694b'), 0.9 + rnd(2) * 0.14) : sh(lin(rnd(2) < 0.5 ? '#dacfbb' : '#cdc4b2'), 0.94 + rnd(3) * 0.08);
  const uvS = brick ? 0.85 : 1.9;
  const trim: RGBf = lin(brick ? '#e6dece' : '#ebe4d6');
  const lesC = brick ? sh(wallC, 1.04) : sh(wallC, 1.05);
  const dark = lin('#1b1714');
  const reveal = sh(wallC, 0.7);
  const blueDial = rnd(4) < 0.4;
  const form = S.kind ?? 'campanile';
  const helmKind = form === 'clocher' ? (rnd(5) < 0.85 ? 1 : 2) : tall ? (rnd(5) < 0.7 ? 0 : 2) : S.lang === 'it' ? (rnd(5) < 0.6 ? 0 : 1) : rnd(5) < 0.55 ? 1 : 2;
  const helmC: RGBf = lin(['#a75a3a', '#5a6266', '#5e9480'][helmKind]);

  // ---- Seiten: Normale (u längs, v quer) und Richtung „rechts“ von außen gesehen
  const P = (u: number, v: number, h: number) => at(cl + v, ca + u, h);
  const faces: Face[] = ([[0, 1], [1, 0], [0, -1], [-1, 0]] as const).map(([nu, nv]) => {
    const tu = nv, tv = -nu;
    return { p: (s: number, h: number, d = 0) => P(nu * (hw + d) + tu * s, nv * (hw + d) + tv * s, h) };
  });

  const uvq = (s0: number, s1: number, h0: number, h1: number) => [[s0 / uvS, h0 / uvS], [s1 / uvS, h0 / uvS], [s1 / uvS, h1 / uvS], [s0 / uvS, h1 / uvS]];
  /** Mauerstück mit Fugen */
  const wallR = (f: Face, s0: number, s1: number, h0: number, h1: number, d = 0, c = wallC) =>
    stone.quad(f.p(s0, h0, d), f.p(s1, h0, d), f.p(s1, h1, d), f.p(s0, h1, d), c, uvq(s0, s1, h0, h1));
  /** einfarbiges Rechteck */
  const rect = (gb = plain, f: Face, s0: number, s1: number, h0: number, h1: number, d: number, c: RGBf) =>
    gb.quad(f.p(s0, h0, d), f.p(s1, h0, d), f.p(s1, h1, d), f.p(s0, h1, d), c);
  /** Klotz vor der Mauer: Stirn, Seiten, Unter- und Oberseite */
  const block = (gb = plain, f: Face, s0: number, s1: number, h0: number, h1: number, d0: number, d1: number, c: RGBf) => {
    gb.quad(f.p(s0, h0, d1), f.p(s1, h0, d1), f.p(s1, h1, d1), f.p(s0, h1, d1), c);
    gb.quad(f.p(s0, h0, d0), f.p(s0, h0, d1), f.p(s0, h1, d1), f.p(s0, h1, d0), sh(c, 0.88));
    gb.quad(f.p(s1, h0, d1), f.p(s1, h0, d0), f.p(s1, h1, d0), f.p(s1, h1, d1), sh(c, 0.88));
    gb.quad(f.p(s0, h0, d0), f.p(s1, h0, d0), f.p(s1, h0, d1), f.p(s0, h0, d1), sh(c, 0.72));
    gb.quad(f.p(s0, h1, d1), f.p(s1, h1, d1), f.p(s1, h1, d0), f.p(s0, h1, d0), c);
  };
  /** Rundbogenform (Rechteck bis zum Kämpfer he, Halbkreis darüber) flach vor der Mauer */
  const archShape = (gb = plain, f: Face, s: number, h0: number, he: number, r: number, d: number, c: RGBf, n = 5) => {
    gb.quad(f.p(s - r, h0, d), f.p(s + r, h0, d), f.p(s + r, he, d), f.p(s - r, he, d), c);
    for (let k = 0; k < n; k++) {
      const a0 = (PI * k) / n, a1 = (PI * (k + 1)) / n;
      gb.tri(f.p(s, he, d), f.p(s + Math.cos(a0) * r, he + Math.sin(a0) * r, d), f.p(s + Math.cos(a1) * r, he + Math.sin(a1) * r, d), c);
    }
  };
  /** Gesims rund um den Turm: schräge Unterseite, Stirn (mit Fugen), Wasserschlag oben */
  const cornice = (h0: number, hgt: number, o: number, c = trim) => {
    for (const f of faces) {
      stone.quad(f.p(-hw - o, h0, o), f.p(hw + o, h0, o), f.p(hw + o, h0 + hgt, o), f.p(-hw - o, h0 + hgt, o), c, uvq(-hw - o, hw + o, h0, h0 + hgt));
      plain.quad(f.p(-hw - o, h0 + hgt, o), f.p(hw + o, h0 + hgt, o), f.p(hw, h0 + hgt + o * 0.35, 0), f.p(-hw, h0 + hgt + o * 0.35, 0), c);
      plain.quad(f.p(-hw, h0 - o * 0.6, 0), f.p(hw, h0 - o * 0.6, 0), f.p(hw + o, h0, o), f.p(-hw - o, h0, o), sh(c, 0.78));
    }
    return h0 + hgt + o * 0.35;
  };
  /** schmales Rundbogenfenster mit hellem Gewände */
  const slit = (f: Face, h0: number, h1: number, wd: number) => {
    const r = wd / 2;
    const he = h1 - r;
    archShape(plain, f, 0, h0 - 0.12, he, r + 0.12, 0.025, trim);
    archShape(plain, f, 0, h0, he, r, 0.04, dark);
    // Sohlbank
    block(fine, f, -r - 0.2, r + 0.2, h0 - 0.2, h0 - 0.08, 0, 0.12, trim);
  };
  /** Zwillingsfenster (zwei schmale Bögen mit Säulchen) unter einem gemeinsamen Rahmen, als flache Form */
  const bifora = (f: Face, h0: number, h1: number, wd: number) => {
    const r = wd / 2, g = 0.09;
    const he = h1 - r;
    const R = 2 * r + g + 0.12;
    archShape(plain, f, 0, h0 - 0.12, h1 + 0.12 - R, R, 0.025, trim, 7);
    for (const s of [-(r + g), r + g]) archShape(plain, f, s, h0, he, r, 0.04, dark);
    block(fine, f, -R - 0.15, R + 0.15, h0 - 0.2, h0 - 0.08, 0, 0.12, trim);
  };
  /** Uhr: helle Platte, Zifferblatt mit Ring, Stundenstriche, Zeiger */
  const clock = (f: Face, hc: number, rc: number, hh: number, mm: number) => {
    const n = 18;
    const dial = blueDial ? lin('#24366a') : lin('#f3efe5');
    const ink = blueDial ? lin('#e0bb58') : lin('#1d1b19');
    const ring = blueDial ? lin('#c9a24c') : lin('#2e2925');
    const pl = rc + 0.34;
    rect(plain, f, -pl, pl, hc - pl, hc + pl, 0.04, trim);
    const pt = (a: number, r: number, d: number) => f.p(Math.cos(a) * r, hc + Math.sin(a) * r, d);
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * PI * 2, a1 = ((k + 1) / n) * PI * 2;
      plain.tri(f.p(0, hc, 0.07), pt(a0, rc, 0.07), pt(a1, rc, 0.07), dial);
      plain.quad(pt(a0, rc - 0.01, 0.075), pt(a1, rc - 0.01, 0.075), pt(a1, rc + 0.12, 0.075), pt(a0, rc + 0.12, 0.075), ring);
    }
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * PI * 2;
      const wq = k % 3 === 0 ? 0.055 : 0.03;
      const r0 = rc * (k % 3 === 0 ? 0.7 : 0.79), r1 = rc * 0.92;
      const c = Math.cos(a), s = Math.sin(a);
      const Q = (rr: number, ww: number) => f.p(c * rr - s * ww, hc + s * rr + c * ww, 0.085);
      plain.quad(Q(r0, -wq), Q(r1, -wq), Q(r1, wq), Q(r0, wq), ink);
    }
    const hand = (a: number, len: number, wd: number) => {
      const c = Math.cos(a), s = Math.sin(a);
      const Q = (rr: number, ww: number) => f.p(c * rr - s * ww, hc + s * rr + c * ww, 0.1);
      plain.quad(Q(-0.14, -wd), Q(len, -wd * 0.35), Q(len, wd * 0.35), Q(-0.14, wd), ink);
    };
    hand(PI / 2 - ((hh + mm / 60) / 12) * PI * 2, rc * 0.52, 0.075);
    hand(PI / 2 - (mm / 60) * PI * 2, rc * 0.82, 0.05);
    plain.tri(pt(0, 0.07, 0.11), pt((PI * 2) / 3, 0.07, 0.11), pt((PI * 4) / 3, 0.07, 0.11), ink);
  };
  /** Glocke als Umriss im dunklen Raum hinter der Öffnung, darüber das Joch */
  const bell = (f: Face, s: number, he: number, hs: number, R: number, d: number) => {
    const bc = lin('#6d5629');
    const bh = Math.min(1.3, (he - hs) * 0.42);
    const bw = Math.min(R * 1.3, bh * 0.85);
    const top = he - 0.02;
    rect(plain, f, s - R, s + R, top, top + 0.18, d + 0.01, lin('#36261a'));
    const prof: [number, number][] = [[0.14, 0], [0.34, 0.07], [0.42, 0.22], [0.45, 0.5], [0.5, 0.76], [0.62, 0.91], [0.68, 1]];
    for (let i = 0; i + 1 < prof.length; i++) {
      const [x0, y0] = prof[i], [x1, y1] = prof[i + 1];
      const h0 = top - y0 * bh, h1 = top - y1 * bh;
      plain.quad(f.p(s - x1 * bw, h1, d), f.p(s + x1 * bw, h1, d), f.p(s + x0 * bw, h0, d), f.p(s - x0 * bw, h0, d), i >= 4 ? sh(bc, 1.25) : bc);
    }
  };
  /**
   * Geschoss mit echten Rundbogenöffnungen: Mauer in Stücken um die Öffnungen (Brüstung, Pfeiler, Zwickel über
   * den Bögen, Band bis h1), Laibung in die Mauertiefe, dahinter dunkler Raum, Kämpfer auf den Pfeilerchen
   */
  const openings = (h0: number, h1: number, n: number, wo: number, hs: number, he: number, bells: boolean) => {
    const R = wo / 2, ht = he + R, D = 0.5, N = 6, cw = 0.28;
    const total = n * wo + (n - 1) * cw;
    const cs = Array.from({ length: n }, (_, i) => -total / 2 + R + i * (wo + cw));
    for (const f of faces) {
      wallR(f, -hw, hw, h0, hs);
      wallR(f, -hw, hw, ht, h1);
      const ed = [-hw, ...cs.flatMap((c) => [c - R, c + R]), hw];
      for (let i = 0; i < ed.length; i += 2) wallR(f, ed[i], ed[i + 1], hs, ht);
      for (const c of cs) {
        for (let k = 0; k < N; k++) {
          const a0 = (PI * k) / N, a1 = (PI * (k + 1)) / N;
          const x0 = c + Math.cos(a0) * R, y0 = he + Math.sin(a0) * R;
          const x1 = c + Math.cos(a1) * R, y1 = he + Math.sin(a1) * R;
          stone.quad(f.p(x0, y0), f.p(x1, y1), f.p(x1, ht), f.p(x0, ht), wallC, [[x0 / uvS, y0 / uvS], [x1 / uvS, y1 / uvS], [x1 / uvS, ht / uvS], [x0 / uvS, ht / uvS]]);
          plain.quad(f.p(x0, y0), f.p(x1, y1), f.p(x1, y1, -D), f.p(x0, y0, -D), reveal);
          // Bogen aus hellem Stein (Archivolte), leicht vor der Mauer
          fine.quad(f.p(x0, y0, 0.03), f.p(x1, y1, 0.03), f.p(c + Math.cos(a1) * (R + 0.16), he + Math.sin(a1) * (R + 0.16), 0.03), f.p(c + Math.cos(a0) * (R + 0.16), he + Math.sin(a0) * (R + 0.16), 0.03), trim);
        }
        plain.quad(f.p(c - R, hs), f.p(c - R, he), f.p(c - R, he, -D), f.p(c - R, hs, -D), reveal);
        plain.quad(f.p(c + R, he), f.p(c + R, hs), f.p(c + R, hs, -D), f.p(c + R, he, -D), reveal);
        plain.quad(f.p(c - R, hs), f.p(c + R, hs), f.p(c + R, hs, -D), f.p(c - R, hs, -D), sh(reveal, 1.15));
        if (bells) bell(f, c, he, hs, R, -D + 0.08);
      }
      rect(plain, f, cs[0] - R - 0.05, cs[n - 1] + R + 0.05, hs - 0.05, ht + 0.05, -D, dark);
      // Kämpfer auf den Pfeilerchen zwischen den Bögen
      for (let i = 0; i + 1 < n; i++) {
        const sc = (cs[i] + cs[i + 1]) / 2;
        block(fine, f, sc - cw / 2 - 0.1, sc + cw / 2 + 0.1, he - 0.18, he, -D * 0.6, 0.06, trim);
      }
      // Brüstung: Sohlbank über die ganze Breite der Öffnungen
      block(plain, f, cs[0] - R - 0.25, cs[n - 1] + R + 0.25, hs - 0.16, hs, 0, 0.14, trim);
    }
  };
  /** Konsolen mit kleinen Bögen dazwischen (Bogenfries) unter einem Gesims */
  const corbels = (h0: number, h1: number) => {
    const span = 2 * (hw - 0.62);
    const n = Math.max(3, Math.round(span / 0.48));
    const step = span / n;
    const r = step / 2;
    for (const f of faces) {
      for (let i = 0; i <= n; i++) {
        const s = -span / 2 + i * step;
        block(fine, f, s - 0.08, s + 0.08, h0, h1, 0, 0.2, trim);
        if (i === n) continue;
        const c = s + r;
        const hb = h1 - r * 0.9;
        for (let k = 0; k < 5; k++) {
          const a0 = (PI * k) / 5, a1 = (PI * (k + 1)) / 5;
          const p = (a: number, rr: number) => f.p(c + Math.cos(a) * rr, hb + Math.sin(a) * rr * 0.9, 0.05);
          fine.quad(p(a0, r - 0.07), p(a1, r - 0.07), p(a1, r), p(a0, r), sh(trim, 0.92));
        }
      }
    }
  };
  /** Ecklisenen: an jeder Ecke zwei Streifen vor der Mauer (treffen sich über Eck), mit Laibung nach innen */
  const lesenes = (h0: number, h1: number) => {
    const LW = 0.5, LD = 0.12;
    for (const f of faces) {
      for (const side of [-1, 1]) {
        const a = side * (hw - LW), b = side * (hw + LD);
        stone.quad(f.p(Math.min(a, b), h0, LD), f.p(Math.max(a, b), h0, LD), f.p(Math.max(a, b), h1, LD), f.p(Math.min(a, b), h1, LD), lesC, uvq(Math.min(a, b), Math.max(a, b), h0, h1));
        plain.quad(f.p(a, h0, 0), f.p(a, h0, LD), f.p(a, h1, LD), f.p(a, h1, 0), sh(lesC, 0.86));
      }
    }
  };

  // ---- Aufbau
  const time = Math.floor(rnd(6) * 12);
  const mins = Math.floor(rnd(7) * 12) * 5;
  // Sockel mit Wasserschlag
  for (const f of faces) {
    wallR(f, -hw - 0.2, hw + 0.2, -2, 1.8, 0.2, sh(wallC, 0.8));
    plain.quad(f.p(-hw - 0.2, 1.8, 0.2), f.p(hw + 0.2, 1.8, 0.2), f.p(hw, 1.98, 0), f.p(-hw, 1.98, 0), sh(trim, 0.92));
  }
  const top = campanileTop(tall);
  const crown0 = top - 1.42;   // Konsolen
  const crown1 = top - 1.02;   // Kranzgesims
  lesenes(1.8, crown0);
  if (!tall) {
    // Schaft bis zur Glockenstube, zwei Geschosse
    for (const f of faces) {
      wallR(f, -hw, hw, 1.8, 15.5);
      slit(f, 3.9, 5.4, 0.36);
      slit(f, 8.7, 10.1, 0.32);
      clock(f, 12.7, 1.0, time, mins);
    }
    cornice(7.5, 0.24, 0.22);
    cornice(15.5, 0.3, 0.28);
    // Glockenstube: Zwillingsbögen
    const wo = Math.min(1.2, (w - 2 * 0.5 - 2 * 0.45 - 0.28) / 2);
    openings(15.5, crown0, 2, wo, 16.7, 19.8, true);
  } else {
    for (const f of faces) {
      wallR(f, -hw, hw, 1.8, 15.5);
      slit(f, 3.9, 5.5, 0.38);
      bifora(f, 9.6, 11.6, 0.34);
      slit(f, 12.9, 14.4, 0.3);
    }
    cornice(7.5, 0.26, 0.24);
    cornice(15.5, 0.28, 0.26);
    cornice(24.5, 0.32, 0.3);
    // drittes Geschoss: Zwillingsöffnungen, darüber die Uhr
    openings(15.5, 24.5, 2, 0.78, 16.7, 19.0, false);
    for (const f of faces) clock(f, 21.75, 1.08, time, mins);
    // Glockenstube: Drillingsbögen
    const wo = Math.min(1.0, (w - 2 * 0.5 - 2 * 0.4 - 2 * 0.28) / 3);
    openings(24.5, crown0, 3, wo, 25.6, 30.4, true);
  }
  // Kranz: Konsolen mit Bogenfries, Kranzgesims
  for (const f of faces) wallR(f, -hw, hw, crown0, crown1 + 0.05);
  corbels(crown0, crown1);
  const roof0 = cornice(crown1, 0.5, 0.42);

  // ---- englischer Kirchturm: Zinnen und vier Fialen, flaches Dach (kein Helm)
  if (form === 'tower') {
    const cr = roof0;
    const merl = 0.55;
    for (const f of faces) {
      const n = 5;
      for (let k = 0; k < n; k++) {
        if (k % 2) continue;
        const s0 = -hw + (k * 2 * hw) / n, s1 = -hw + ((k + 1) * 2 * hw) / n;
        block(plain, f, s0, s1, cr, cr + 0.9, -0.05, 0.25, trim);
      }
      rect(plain, f, -hw, hw, cr - 0.05, cr + merl, 0.2, sh(wallC, 0.95));
    }
    plain.quad(P(-hw, -hw, cr), P(hw, -hw, cr), P(hw, hw, cr), P(-hw, hw, cr), sh(wallC, 0.7));
    for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const cu = su * (hw - 0.25), cv = sv * (hw - 0.25);
      const r = 0.3;
      const base = [[cu - r, cv - r], [cu + r, cv - r], [cu + r, cv + r], [cu - r, cv + r]];
      for (let q = 0; q < 4; q++) {
        const [a0, b0] = base[q], [a1, b1] = base[(q + 1) % 4];
        plain.quad(P(a0, b0, cr), P(a1, b1, cr), P(a1, b1, cr + 1.4), P(a0, b0, cr + 1.4), trim);
        plain.tri(P(a0, b0, cr + 1.4), P(a1, b1, cr + 1.4), P(cu, cv, cr + 3.2), trim);
      }
    }
    return;
  }
  // ---- Helm: achteckig über dem Quadrat, Ecken mit Blei abgedeckt, beim Campanile vier Fialen; Clocher hoch und schlank
  const hb = hw + 0.16;
  const R8 = hb / Math.cos(PI / 8);
  const hH = form === 'clocher' ? 15 + rnd(8) * 6 : tall ? 10.5 : helmKind === 0 ? 7.5 : 9.5;
  const tipH = roof0 + hH;
  const oct = (k: number) => {
    const a = PI / 8 + (k * PI) / 4;
    return [Math.cos(a) * R8, Math.sin(a) * R8];
  };
  const edge = 2 * R8 * Math.sin(PI / 8);
  const slant = Math.hypot(hH, hb);
  for (let k = 0; k < 8; k++) {
    const [u0, v0] = oct(k), [u1, v1] = oct(k + 1);
    T.tiles.tri(P(u0, v0, roof0), P(u1, v1, roof0), P(0, 0, tipH), sh(helmC, 0.94 + ((k * 5) % 3) * 0.04), [-edge / 4, 0], [edge / 4, 0], [0, slant / 2]);
  }
  const lead = lin('#58564f');
  for (let c = 0; c < 4; c++) {
    // Ecke zwischen den Achteckpunkten 2c und 2c + 1
    const ang = PI / 4 + (c * PI) / 2;
    const su = Math.sign(Math.cos(ang)), sv = Math.sign(Math.sin(ang));
    const a = oct(2 * c), b = oct(2 * c + 1);
    plain.tri(P(su * hb, sv * hb, roof0 - 0.02), P(a[0], a[1], roof0), P(b[0], b[1], roof0), lead);
    if ((tall || helmKind === 0) && form === 'campanile') {
      // Fiale: Sockel und schlanke vierseitige Spitze auf der Ecke
      const cu = su * (hb - 0.32), cv = sv * (hb - 0.32);
      const r = 0.24, fh = tall ? 2.4 : 1.7;
      const base = [[cu - r, cv - r], [cu + r, cv - r], [cu + r, cv + r], [cu - r, cv + r]];
      for (let q = 0; q < 4; q++) {
        const [a0, b0] = base[q], [a1, b1] = base[(q + 1) % 4];
        plain.quad(P(a0, b0, roof0 - 0.05), P(a1, b1, roof0 - 0.05), P(a1, b1, roof0 + 0.45), P(a0, b0, roof0 + 0.45), trim);
        T.tiles.tri(P(a0, b0, roof0 + 0.45), P(a1, b1, roof0 + 0.45), P(cu, cv, roof0 + 0.45 + fh), helmC, [0, 0], [0.25, 0], [0.12, fh / 2]);
      }
    }
  }
  // Kugel und Kreuz
  const gold = lin('#cfa648');
  /** Quader (u, v quer, h hoch) */
  const box3 = (u0: number, u1: number, v0: number, v1: number, h0: number, h1: number, c: RGBf) => {
    const q = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    for (let k = 0; k < 4; k++) {
      const [a0, b0] = q[k], [a1, b1] = q[(k + 1) % 4];
      plain.quad(P(a0, b0, h0), P(a1, b1, h0), P(a1, b1, h1), P(a0, b0, h1), c);
    }
    plain.quad(P(u0, v0, h1), P(u1, v0, h1), P(u1, v1, h1), P(u0, v1, h1), c);
    plain.quad(P(u0, v1, h0), P(u1, v1, h0), P(u1, v0, h0), P(u0, v0, h0), c);
  };
  box3(-0.04, 0.04, -0.04, 0.04, tipH - 0.3, tipH + 0.6, lin('#2c2a28'));
  const bc = tipH + 0.75;
  const br = 0.24;
  for (let k = 0; k < 6; k++) {
    const a0 = (k / 6) * PI * 2, a1 = ((k + 1) / 6) * PI * 2;
    for (const [y0, r0, y1, r1] of [[-br, 0, -br * 0.5, br * 0.87], [-br * 0.5, br * 0.87, br * 0.5, br * 0.87], [br * 0.5, br * 0.87, br, 0]]) {
      const A = P(Math.cos(a0) * r0, Math.sin(a0) * r0, bc + y0), B = P(Math.cos(a1) * r0, Math.sin(a1) * r0, bc + y0);
      const C = P(Math.cos(a1) * r1, Math.sin(a1) * r1, bc + y1), D = P(Math.cos(a0) * r1, Math.sin(a0) * r1, bc + y1);
      plain.quad(A, B, C, D, gold);
    }
  }
  // Kreuz (flach wie ein echtes, Arme längs der Straße)
  box3(-0.05, 0.05, -0.05, 0.05, bc + br - 0.05, bc + br + 1.5, gold);
  box3(-0.42, 0.42, -0.05, 0.05, bc + br + 0.98, bc + br + 1.1, gold);
  // Clocher: Wetterhahn auf dem Kreuz
  if (form === 'clocher') {
    const hy = bc + br + 1.6;
    box3(-0.32, 0.22, -0.04, 0.04, hy, hy + 0.32, gold);
    box3(0.12, 0.3, -0.04, 0.04, hy + 0.32, hy + 0.62, gold);
    box3(-0.42, -0.24, -0.04, 0.04, hy + 0.2, hy + 0.55, gold);
  }
}
