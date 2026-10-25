/**
 * Pseudo-3D-Renderer für „Abfahrt“ (Canvas 2D).
 * Die Strecke wird in Streifen zerlegt (nah fein, fern je Segment), perspektivisch projiziert
 * und von hinten nach vorne gezeichnet: Gelände, Felswände, Häuserzeilen, Tunnel, Leitplanken,
 * Straßenbelag mit Textur, Markierungen und Malereien, danach Bäume, Zuschauer, Fahrer, Partikel.
 */
import { css, BIOME_PALETTES, lightAt, mixRGB, shade, type Light, type Palette, type RGB } from './palette';
import { cloud, glow, makeTextures, roadArrow, roadText, SpriteBank, type Tex } from './sprites';
import { makeBackdrop, type Backdrop } from './bg';
import { drawCrash, drawRider } from './rider';
import { EDGE, ROAD_HALF, SEG, type Building, type Seg, type Side, type Surface, type Obj, type BiomeId, Track } from './track';
import type { Abfahrt, Friend, Opp, Particle } from './engine';

const NEAR = 0.6;
const DRAW_M = 430;
const CAM_BACK = 4.6;
const FOG_D = 290;
const HOR = 0.46;
const TEX_ROAD = 90;
const TEX_SIDE = 45;
const MAX_STRIPS = 700;
const RIDER = 1.22;   // Fahrer etwas größer als maßstäblich, damit man sie gut erkennt

const SURFACE_COL: Record<Surface, [RGB, RGB]> = {
  asphalt: [[96, 99, 105], [94, 97, 103]],
  fresh: [[62, 65, 71], [61, 64, 70]],
  cobble: [[128, 116, 104], [125, 113, 101]],
  gravel: [[201, 182, 140], [198, 179, 137]],
};
const FACADES: RGB[] = [[221, 168, 96], [226, 152, 124], [236, 222, 188], [232, 200, 108], [214, 146, 140], [206, 120, 82], [238, 234, 224]];
const SHUTTERS = ['#2f6a3a', '#5b3a22', '#2c4f7a', '#7a2d24'];
const ROOFS = ['#a8492a', '#7a3a22', '#5a4a40'];
const BARRIER_CLOTH = ['#ff5fa2', '#2f80ed', '#ffd23f', '#ffffff', '#27ae60'];

interface Glow { x: number; y: number; r: number; img: HTMLCanvasElement; a: number }
interface Ent { strip: number; z: number; flat: boolean; kind: 'obj' | 'opp' | 'player' | 'part'; ref: Obj | Opp | Particle | null }

const hash = (n: number) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};

export class Renderer {
  private cv: HTMLCanvasElement;
  private c: CanvasRenderingContext2D;
  W = 0;
  H = 0;
  dpr = 1;
  private F = 300;
  private hor = 0;
  private camH = 3;
  private bank = new SpriteBank();
  private tex = makeTextures();
  private pats = new Map<HTMLCanvasElement, CanvasPattern | null>();
  private mat: DOMMatrix | null = typeof DOMMatrix !== 'undefined' ? new DOMMatrix() : null;
  private clouds: HTMLCanvasElement[] = [];
  private gWarm = glow('rgba(255,196,110,0.95)');
  private gRed = glow('rgba(255,60,50,0.95)');
  private gSun = glow('rgba(255,244,214,0.9)', 256);
  private texts = new Map<string, HTMLCanvasElement>();
  private arrows = { L: roadArrow('L'), R: roadArrow('R') };
  private bg = new Map<string, Backdrop>();
  private bgCur: Backdrop | null = null;
  private bgPrev: Backdrop | null = null;
  private bgFade = 1;
  private stars: { x: number; y: number; s: number }[] = [];
  private accent = '#ff5fa2';
  dark = false;
  quality = 1;

  // Kamera
  private cam = { z: 0, x: 0, y: 0, vy: 0, roll: 0, pitch: 0, init: false };

  // Streifen und Kanten
  private EZ = new Float64Array(MAX_STRIPS + 1);
  private EX = new Float64Array(MAX_STRIPS + 1);
  private EY = new Float64Array(MAX_STRIPS + 1);
  private SX = new Float64Array(MAX_STRIPS + 1);
  private SY = new Float64Array(MAX_STRIPS + 1);
  private SC = new Float64Array(MAX_STRIPS + 1);
  private FOG = new Float64Array(MAX_STRIPS + 1);
  private CLIP = new Float64Array(MAX_STRIPS + 1);
  private SEGS: Seg[] = [];
  private START = new Uint8Array(MAX_STRIPS + 1);
  private n = 0;
  private glows: Glow[] = [];
  private ents: Ent[] = [];
  private light: Light = lightAt(0);
  private haze: RGB = [200, 220, 235];
  private time = 0;
  private pt = { x: 0, y: 0, s: 0, f: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.cv = canvas;
    this.c = canvas.getContext('2d', { alpha: false })!;
    this.clouds = [cloud(1), cloud(2), cloud(3)];
    for (let i = 0; i < 140; i++) this.stars.push({ x: hash(i * 3 + 1), y: hash(i * 3 + 2) * 0.55, s: 0.4 + hash(i * 3 + 3) * 1.2 });
    this.resize();
  }

  /** Grafiken vorab erzeugen, damit es beim Fahren nicht ruckelt (verteilt auf mehrere Takte) */
  warm() {
    this.bank.warm();
    const order: BiomeId[] = ['pass', 'alpine', 'forest', 'village', 'lake', 'vineyard'];
    let i = 0;
    const next = () => {
      if (i >= order.length) return;
      this.backdrop(order[i++]);
      window.setTimeout(next, 40);
    };
    window.setTimeout(next, 60);
  }

  setTheme(accent: string, dark: boolean) {
    this.accent = accent || '#ff5fa2';
    this.dark = dark;
  }

  resize() {
    const rect = this.cv.getBoundingClientRect();
    const W = Math.max(200, Math.round(rect.width));
    const H = Math.max(200, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.quality;
    if (W === this.W && H === this.H && dpr === this.dpr) return;
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.cv.width = Math.round(W * dpr);
    this.cv.height = Math.round(H * dpr);
    this.F = (0.5 * Math.min(W, H * 0.75)) / Math.tan((32 * Math.PI) / 180);
    // Kamerahöhe so, dass der Fahrer im unteren Viertel steht (hochkant wie quer)
    this.camH = Math.max(1.8, Math.min(4.2, ((0.745 - HOR) * H) / (this.F / CAM_BACK)));
    if (this.bg.size && (this.bgW !== W || this.bgH !== H)) {
      this.bg.clear();
      this.bgCur = null;
      this.bgPrev = null;
    }
    this.bgW = W;
    this.bgH = H;
  }

  private bgW = 0;
  private bgH = 0;

  private backdrop(biome: BiomeId): Backdrop {
    let b = this.bg.get(biome);
    if (!b) {
      b = makeBackdrop(biome, this.W, this.H, Math.min(1.25, this.dpr), 77 + biome.length * 13);
      this.bg.set(biome, b);
    }
    return b;
  }

  private pattern(img: HTMLCanvasElement): CanvasPattern | null {
    let p = this.pats.get(img);
    if (p === undefined) {
      p = this.c.createPattern(img, 'repeat');
      if (p && typeof p.setTransform !== 'function') p = null;
      this.pats.set(img, p);
    }
    return p;
  }

  // ------------------------------------------------------------------ Hauptzeichnung

  draw(g: Abfahrt, dt: number) {
    const c = this.c;
    this.time += dt;
    const W = this.W;
    const H = this.H;
    const p = g.p;
    const track = g.track;
    this.track = track;

    // Tageszeit: hell → Mittag bis Abend, dunkel → Abend bis Nacht
    const tod = this.dark ? 0.6 + Math.min(0.4, p.z / 11000) : Math.min(0.8, p.z / 10000);
    this.light = lightAt(tod);

    // Kamera nachführen
    const cam = this.cam;
    const roadAtCam = track.heightAt(Math.max(0, p.z - CAM_BACK));
    const lift = p.air ? (p.y - track.heightAt(p.z)) * 0.45 : 0;
    const ty = roadAtCam + this.camH + lift;
    if (!cam.init) { cam.y = ty; cam.x = p.x * 0.6; cam.init = true; }
    cam.z = p.z - CAM_BACK;
    cam.x += (p.x * 0.6 - cam.x) * Math.min(1, dt * 5);
    // Federung der Kamera (Landungen, Kuppen)
    const k = 90;
    const d = 2 * Math.sqrt(k) * 0.8;
    cam.vy += ((ty - cam.y) * k - cam.vy * d) * Math.min(dt, 0.05);
    cam.y += cam.vy * Math.min(dt, 0.05);
    if (Math.abs(ty - cam.y) > 6) { cam.y = ty; cam.vy = 0; }
    const seg0 = track.segAt(p.z + 6);
    cam.pitch += (seg0.grade * 0.6 - cam.pitch) * Math.min(1, dt * 3);
    const targetRoll = (g.phase === 'crash' ? 0 : -p.lean * 0.2) + (Math.random() - 0.5) * g.shake * 0.02;
    cam.roll += (targetRoll - cam.roll) * Math.min(1, dt * 6);
    this.hor = H * HOR - cam.pitch * this.F;

    this.buildStrips(track);

    // Hintergrund je Tal
    const sec = track.sections[seg0.sec];
    const want = this.backdrop(sec.biome);
    if (this.bgCur !== want) {
      this.bgPrev = this.bgCur;
      this.bgCur = want;
      this.bgFade = this.bgPrev ? 0 : 1;
    }
    this.bgFade = Math.min(1, this.bgFade + dt / 2.4);
    const pal = BIOME_PALETTES[sec.biome];
    this.haze = mixRGB(pal.haze, this.light.hazeMix, this.light.hazeAmt);

    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.imageSmoothingEnabled = true;
    const shakeX = (Math.random() - 0.5) * g.shake * 5;
    const shakeY = (Math.random() - 0.5) * g.shake * 4;
    c.save();
    c.translate(W / 2 + shakeX, H * 0.82 + shakeY);
    c.rotate(cam.roll);
    c.translate(-W / 2, -H * 0.82);

    this.glows.length = 0;
    this.drawSky(g, pal);
    this.drawBackdrops(g);
    this.collectEntities(g);
    this.drawWorld(g);
    c.restore();

    // Licht der Tageszeit über alles
    const t = this.light.tint;
    if (t[0] < 250 || t[1] < 250 || t[2] < 250) {
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = css(t);
      c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = 'source-over';
    }
    // Tunnel: dunkler Rand
    if (track.segAt(p.z).tunnel) {
      const v = c.createRadialGradient(W / 2, H * 0.55, H * 0.15, W / 2, H * 0.55, H * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(10,8,5,0.55)');
      c.fillStyle = v;
      c.fillRect(0, 0, W, H);
    }
    // Lichter
    if (this.glows.length) {
      c.globalCompositeOperation = 'lighter';
      for (const gl of this.glows) {
        c.globalAlpha = gl.a;
        c.drawImage(gl.img, gl.x - gl.r, gl.y - gl.r, gl.r * 2, gl.r * 2);
      }
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
    }
    this.drawSpeed(g);
    this.drawPopups(g);
  }

  // ------------------------------------------------------------------ Streifen

  private buildStrips(track: Track) {
    const cam = this.cam;
    const camZ = cam.z;
    const EZ = this.EZ, EX = this.EX, EY = this.EY;
    let z = camZ + NEAR;
    const k0 = track.segAt(Math.max(0, camZ)).curve;
    let X = 0.5 * k0 * NEAR * NEAR;
    let dX = k0 * NEAR;
    let n = 0;
    const maxZ = camZ + DRAW_M * (0.75 + 0.25 * this.quality);
    while (z < maxZ && n < MAX_STRIPS) {
      const i = Math.floor(z / SEG + 1e-9);
      const seg = track.seg(i);
      const segStart = i * SEG;
      const segEnd = segStart + SEG;
      const dz = z - camZ;
      const step = dz < 16 ? Math.max(0.1, dz * 0.11) : SEG;
      let z1 = Math.min(segEnd, z + step);
      if (segEnd - z1 < 0.04) z1 = segEnd;
      EZ[n] = z;
      EX[n] = X;
      EY[n] = seg.y + seg.grade * (z - segStart);
      this.SEGS[n] = seg;
      this.START[n] = Math.abs(z - segStart) < 1e-6 ? 1 : 0;
      const d = z1 - z;
      X += dX * d + 0.5 * seg.curve * d * d;
      dX += seg.curve * d;
      z = z1;
      n++;
    }
    EZ[n] = z;
    EX[n] = X;
    EY[n] = track.heightAt(z);
    this.SEGS[n] = track.segAt(z);
    this.n = n;
    const F = this.F;
    const W2 = this.W / 2;
    let clip = Infinity;
    for (let e = 0; e <= n; e++) {
      const dz = EZ[e] - camZ;
      const sc = F / dz;
      this.SC[e] = sc;
      this.SX[e] = W2 + (EX[e] - cam.x) * sc;
      this.SY[e] = this.hor - (EY[e] - cam.y) * sc;
      this.FOG[e] = 1 - Math.exp(-dz / FOG_D);
      this.CLIP[e] = clip;
      clip = Math.min(clip, this.SY[e]);
    }
  }

  /** Strip-Index für eine Weltposition z (−1 = hinter der Kamera) */
  private stripOf(z: number): number {
    const EZ = this.EZ;
    if (z < EZ[0] || z >= EZ[this.n]) return -1;
    let lo = 0;
    let hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (EZ[mid] <= z) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  /** Projektion eines Punktes (z, seitlich x, Höhe h über der Straße) */
  private proj(z: number, x: number, h: number): boolean {
    const e = this.stripOf(z);
    if (e < 0) return false;
    const t = (z - this.EZ[e]) / (this.EZ[e + 1] - this.EZ[e]);
    const X = this.EX[e] + (this.EX[e + 1] - this.EX[e]) * t;
    const Y = this.EY[e] + (this.EY[e + 1] - this.EY[e]) * t;
    const sc = this.F / (z - this.cam.z);
    this.pt.x = this.W / 2 + (X + x - this.cam.x) * sc;
    this.pt.y = this.hor - (Y + h - this.cam.y) * sc;
    this.pt.s = sc;
    this.pt.f = this.FOG[e];
    return true;
  }

  // ------------------------------------------------------------------ Himmel und Hintergrund

  private drawSky(g: Abfahrt, pal: Palette) {
    const c = this.c;
    const W = this.W;
    const H = this.H;
    const L = this.light;
    const top = mixRGB(L.skyTop, pal.skyTop, 0.35 * (1 - L.t));
    const hz = mixRGB(L.skyHorizon, pal.skyHorizon, 0.35 * (1 - L.t));
    const grd = c.createLinearGradient(0, -H * 0.2, 0, this.hor + 4);
    grd.addColorStop(0, css(top));
    grd.addColorStop(1, css(hz));
    c.fillStyle = grd;
    c.fillRect(-W * 0.3, -H * 0.3, W * 1.6, this.hor + H * 0.3 + 2);
    c.fillStyle = css(this.haze);
    c.fillRect(-W * 0.3, this.hor, W * 1.6, H * 1.4);

    // Sterne
    if (L.stars > 0.02) {
      c.fillStyle = '#ffffff';
      const off = -g.heading * this.F * 0.2;
      for (const s of this.stars) {
        const x = (((s.x * W * 2 + off) % (W * 2)) + W * 2) % (W * 2) - W * 0.5;
        c.globalAlpha = L.stars * (0.4 + 0.6 * Math.abs(Math.sin(this.time * 0.7 + s.x * 40)));
        c.fillRect(x, s.y * this.hor, s.s, s.s);
      }
      c.globalAlpha = 1;
    }
    // Sonne (fester Kurs, dreht mit den Kurven)
    const az = ((0.35 - g.heading) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    const sx = W / 2 + az * this.F;
    const sy = this.hor - L.sunY * H;
    if (sx > -W && sx < W * 2) {
      const r = 26 + (1 - Math.max(0, L.sunY) / 0.3) * 18;
      c.globalAlpha = 0.85;
      c.drawImage(this.gSun, sx - r * 5, sy - r * 5, r * 10, r * 10);
      c.globalAlpha = 1;
      c.beginPath();
      c.arc(sx, sy, r * 0.55, 0, Math.PI * 2);
      c.fillStyle = css(L.sun);
      c.fill();
    }
    if (L.stars > 0.3) {
      const mx = W / 2 + ((((2.2 - g.heading) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI) * this.F;
      c.beginPath();
      c.arc(mx, this.hor * 0.35, 13, 0, Math.PI * 2);
      c.fillStyle = 'rgba(245,245,235,0.95)';
      c.fill();
      c.beginPath();
      c.arc(mx + 5, this.hor * 0.35 - 3, 12, 0, Math.PI * 2);
      c.fillStyle = css(mixRGB(L.skyTop, L.skyHorizon, 0.3));
      c.fill();
    }
    // Wolken
    const cw = W * 2.4;
    for (let i = 0; i < 6; i++) {
      const img = this.clouds[i % 3];
      const w = (150 + hash(i + 50) * 170) * (W / 390);
      const h = w * 0.39;
      let x = hash(i + 10) * cw - g.heading * this.F * 0.85 + this.time * (3 + i);
      x = ((x % cw) + cw) % cw - w;
      const y = this.hor * (0.12 + hash(i + 20) * 0.55);
      c.globalAlpha = 0.75 - L.stars * 0.5;
      c.drawImage(img, x, y, w, h);
    }
    c.globalAlpha = 1;
    // Vögel
    if (L.t < 0.8) {
      c.strokeStyle = 'rgba(30,30,40,0.55)';
      c.lineWidth = 1.2;
      for (let i = 0; i < 4; i++) {
        const bx = ((hash(i + 70) * W * 1.6 + this.time * (12 + i * 3) - g.heading * this.F * 0.6) % (W * 1.6) + W * 1.6) % (W * 1.6) - W * 0.3;
        const by = this.hor * (0.25 + hash(i + 80) * 0.35) + Math.sin(this.time * 0.6 + i) * 6;
        const flap = Math.sin(this.time * 9 + i * 2) * 3;
        c.beginPath();
        c.moveTo(bx - 5, by - flap);
        c.quadraticCurveTo(bx - 2, by - 1, bx, by);
        c.quadraticCurveTo(bx + 2, by - 1, bx + 5, by - flap);
        c.stroke();
      }
    }
  }

  private drawBackdrops(g: Abfahrt) {
    const draw = (b: Backdrop, alpha: number) => {
      const c = this.c;
      const W = b.width;
      c.globalAlpha = alpha;
      const layer = (img: HTMLCanvasElement, h: number, y: number, par: number) => {
        let x = (-g.heading * this.F * par) % W;
        if (x > 0) x -= W;
        x -= W * 0.3;
        for (let k = 0; k < 3 && x < this.W * 1.3; k++) {
          c.drawImage(img, x, y, W, h);
          x += W;
        }
      };
      layer(b.valley, b.valleyH, this.hor - 1, 1.0);
      layer(b.far, b.farH, this.hor - b.farH + 3, 0.7);
      layer(b.mid, b.midH, this.hor - b.midH + 7, 0.85);
      // Lichter im Tal – gleich hier, damit Gelände davor sie verdeckt
      if (this.light.lights > 0.3) {
        let x0 = (-g.heading * this.F) % W;
        if (x0 > 0) x0 -= W;
        x0 -= W * 0.3;
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = this.light.lights * alpha;
        for (let k = 0; k < 3; k++) {
          for (const l of b.lights) {
            const x = x0 + k * W + l.x;
            if (x < -10 || x > this.W + 10) continue;
            const r = 3 + l.s * 5;
            c.drawImage(this.gWarm, x - r, this.hor + l.y - r, r * 2, r * 2);
          }
        }
        c.globalCompositeOperation = 'source-over';
      }
      c.globalAlpha = 1;
    };
    if (this.bgPrev && this.bgFade < 1) draw(this.bgPrev, 1);
    if (this.bgCur) draw(this.bgCur, this.bgFade);
  }

  // ------------------------------------------------------------------ Welt

  private collectEntities(g: Abfahrt) {
    const ents = this.ents;
    ents.length = 0;
    const iFrom = Math.floor(this.EZ[0] / SEG);
    const iTo = Math.floor(this.EZ[this.n] / SEG);
    for (let i = iFrom; i <= iTo; i++) {
      const s = g.track.seg(i);
      if (!s.objs) continue;
      for (const o of s.objs) {
        if (o.done && (o.k === 'bidon' || o.k === 'gold' || o.k === 'cone')) continue;
        const st = this.stripOf(o.z);
        if (st >= 0) ents.push({ strip: st, z: o.z, flat: o.k === 'pothole' || o.k === 'puddle', kind: 'obj', ref: o });
      }
    }
    for (const o of g.opps) {
      const st = this.stripOf(o.z);
      if (st >= 0) ents.push({ strip: st, z: o.z, flat: false, kind: 'opp', ref: o });
    }
    for (const q of g.parts) {
      const st = this.stripOf(q.z);
      if (st >= 0) ents.push({ strip: st, z: q.z, flat: false, kind: 'part', ref: q });
    }
    const ps = this.stripOf(g.p.z);
    if (ps >= 0) ents.push({ strip: ps, z: g.p.z, flat: false, kind: 'player', ref: null });
    ents.sort((a, b) => (b.strip - a.strip) || (Number(b.flat) - Number(a.flat)) || (b.z - a.z));
  }

  private drawWorld(g: Abfahrt) {
    const n = this.n;
    let ei = 0;
    const ents = this.ents;
    // Freunde-Marken als Torbögen
    const marks = new Map<number, Friend>();
    for (const f of g.friends) if (!f.passed) marks.set(Math.floor(f.meters / SEG), f);

    for (let j = n - 1; j >= 0; j--) {
      const seg = this.SEGS[j];
      const hidden = this.SY[j + 1] >= this.CLIP[j] + 0.5 && this.SY[j] >= this.CLIP[j] + 0.5;
      if (!hidden) {
        if (seg.tunnel) this.drawTunnel(j, seg);
        else {
          this.drawSide(j, seg, -1);
          this.drawSide(j, seg, 1);
          this.drawRoad(j, seg, g);
          this.drawBarriers(j, seg);
        }
      }
      // Objekte, Fahrer, Partikel in diesem Streifen
      while (ei < ents.length && ents[ei].strip > j) ei++;
      while (ei < ents.length && ents[ei].strip === j) {
        this.drawEnt(ents[ei], g);
        ei++;
      }
      if (this.START[j]) {
        this.drawSegmentExtras(j, seg, g);
        const f = marks.get(seg.i);
        if (f) this.drawArch(j, { kind: 'arch', text: f.userId === 'me' ? 'Deine Bestmarke' : `Bestmarke ${f.name}`, sub: fmtKm(f.meters) }, f.color);
      }
    }
  }

  private fogCol(col: RGB, f: number): string {
    return css(mixRGB(col, this.haze, f * 0.92));
  }

  private segPal(seg: Seg, track: Track): { pal: Palette; prev: Palette | null; t: number } {
    const sec = track.sections[seg.sec];
    const pal = BIOME_PALETTES[sec.biome];
    const into = seg.i - sec.start;
    if (into < 50 && seg.sec > 0) {
      const prev = BIOME_PALETTES[track.sections[seg.sec - 1].biome];
      return { pal, prev, t: into / 50 };
    }
    return { pal, prev: null, t: 1 };
  }

  private ground(seg: Seg, g: Side['ground'], k: number, trackRef: Track): RGB {
    const { pal, prev, t } = this.segPal(seg, trackRef);
    // k < 0: Hang ohne Streifen, aber mit leichten Flecken je Segmentgruppe
    const pick = (p: Palette): RGB => (k < 0 ? mixRGB(p.ground[g][0], p.ground[g][1], hash(Math.floor(seg.i / 3)) * 0.9) : mixRGB(p.ground[g][0], p.ground[g][1], k * 0.6));
    const c = pick(pal);
    return prev ? mixRGB(pick(prev), c, t) : c;
  }

  private quad(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, fill: string) {
    const c = this.c;
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.lineTo(x2, y2);
    c.lineTo(x3, y3);
    c.closePath();
    c.fillStyle = fill;
    c.fill();
  }

  /** Viereck eines Streifens; die ferne Kante wird um ~0,6 px verlängert, damit keine Haarlinien entstehen */
  private strip4(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, fill: string) {
    let dx = x3 - x0;
    let dy = y3 - y0;
    let l = Math.hypot(dx, dy);
    if (l > 0.01) { x3 += (dx / l) * 0.6; y3 += (dy / l) * 0.6; }
    dx = x2 - x1;
    dy = y2 - y1;
    l = Math.hypot(dx, dy);
    if (l > 0.01) { x2 += (dx / l) * 0.6; y2 += (dy / l) * 0.6; }
    this.quad(x0, y0, x1, y1, x2, y2, x3, y3, fill);
  }

  /** Viereck auf der Ebene x = konst. bzw. zwischen zwei seitlichen Lagen im Streifen j */
  private band(j: number, xa: number, ha: number, xb: number, hb: number, fill: string, tex?: Tex | null, texAlpha = 1) {
    const e0 = j;
    const e1 = j + 1;
    const SX = this.SX, SY = this.SY, SC = this.SC;
    const x0 = SX[e0] + xa * SC[e0], y0 = SY[e0] - ha * SC[e0];
    const x1 = SX[e0] + xb * SC[e0], y1 = SY[e0] - hb * SC[e0];
    const x2 = SX[e1] + xb * SC[e1], y2 = SY[e1] - hb * SC[e1];
    const x3 = SX[e1] + xa * SC[e1], y3 = SY[e1] - ha * SC[e1];
    this.strip4(x0, y0, x1, y1, x2, y2, x3, y3, fill);
    if (tex && this.mat && texAlpha > 0.02) {
      const sc = (SC[e0] + SC[e1]) * 0.5;
      const lvl = Math.max(0, Math.min(tex.levels.length - 1, Math.floor(Math.log2(tex.ppm / (sc * this.dpr)))));
      const pat = this.pattern(tex.levels[lvl]);
      if (!pat) return;
      const ppm = tex.ppm / (1 << lvl);
      const m = this.mat;
      const zMid = (this.EZ[e0] + this.EZ[e1]) * 0.5;
      const dzPx = Math.max(1e-6, (this.EZ[e1] - this.EZ[e0]) * ppm);
      const tilt = xb !== xa ? (hb - ha) / (xb - xa) : 0;
      const d = (SY[e1] - SY[e0]) / dzPx;
      const cc = (SX[e1] - SX[e0]) / dzPx;
      m.a = sc / ppm; m.b = -tilt * sc / ppm; m.c = cc; m.d = d;
      m.e = (SX[e0] + SX[e1]) * 0.5 - cc * zMid * ppm;
      m.f = (SY[e0] + SY[e1]) * 0.5 - d * zMid * ppm - (ha - tilt * xa) * sc;
      pat.setTransform(m);
      const c = this.c;
      c.globalAlpha = texAlpha;
      c.fillStyle = pat;
      c.fill();
      c.globalAlpha = 1;
    }
  }

  /** senkrechte Wand parallel zur Straße bei Seitenlage x, von Höhe h0 bis h1 */
  private wall(j: number, x: number, h0: number, h1: number, fill: string) {
    const e0 = j;
    const e1 = j + 1;
    const SX = this.SX, SY = this.SY, SC = this.SC;
    this.strip4(
      SX[e0] + x * SC[e0], SY[e0] - h0 * SC[e0],
      SX[e0] + x * SC[e0], SY[e0] - h1 * SC[e0],
      SX[e1] + x * SC[e1], SY[e1] - h1 * SC[e1],
      SX[e1] + x * SC[e1], SY[e1] - h0 * SC[e1],
      fill,
    );
  }

  private drawSide(j: number, seg: Seg, sign: number) {
    const side = sign < 0 ? seg.L : seg.R;
    const bld = sign < 0 ? seg.bL : seg.bR;
    const f = this.FOG[j];
    const dz = this.EZ[j] - this.cam.z;
    const stripe = (seg.i >> 1) & 1;
    const track = this.track!;
    const farX = Math.min(220, (this.W * 2.2) / Math.max(1e-3, this.SC[j]) + EDGE + 5);
    const texOn = dz < TEX_SIDE ? this.tex.ground : null;
    const ta = Math.max(0, 1 - f * 1.6) * 0.9;
    const s = sign;

    if (side.wall > 0) {
      const { pal } = this.segPal(seg, track);
      const v = 0.86 + hash(seg.i * 7 + (s > 0 ? 3 : 0)) * 0.22;
      const base = shade(pal.rock, v * (s < 0 ? 1 : 0.86));
      this.wall(j, s * EDGE, 0, side.wall, this.fogCol(base, f));
      // Gesteinsbänder
      const strata = 3;
      for (let q = 1; q <= strata; q++) {
        const h = side.wall * (q / (strata + 1)) + Math.sin(seg.i * 0.21 + q) * 0.4;
        this.wall(j, s * EDGE, h, h + 0.25, this.fogCol(shade(pal.rockDark, 0.95 + q * 0.03), f));
      }
      if (hash(seg.i * 13 + s) < 0.12) this.wall(j, s * EDGE, 0, side.wall * 0.8, this.fogCol(shade(pal.rockDark, 0.9), f));
      // Hang über der Wand
      const gcol = this.ground(seg, side.ground === 'rock' ? 'meadow' : side.ground, -1, track);
      this.band(j, s * (EDGE + 0.6), side.wall, s * farX, side.wall + side.tilt * (farX - EDGE), this.fogCol(gcol, f), texOn?.[side.ground === 'rock' ? 'meadow' : side.ground] ?? null, ta);
      // Wandkante
      this.band(j, s * EDGE, side.wall, s * (EDGE + 0.6), side.wall, this.fogCol(shade(pal.rock, 1.1), f));
      return;
    }
    if (side.ground === 'water') {
      const { pal } = this.segPal(seg, track);
      this.wall(j, s * (EDGE + 0.05), -1.4, 0, this.fogCol([150, 142, 130], f));
      const wcol = mixRGB(pal.water, this.light.skyHorizon, 0.18 + 0.08 * Math.sin(seg.i * 0.6 + this.time * 2));
      this.band(j, s * (EDGE + 0.05), -1.4, s * Math.min(400, farX * 2), -1.4, this.fogCol(wcol, f), texOn?.water ?? null, ta);
      return;
    }
    if (side.ground === 'pavement') {
      const curb = this.fogCol([168, 162, 152], f);
      this.wall(j, s * EDGE, 0, 0.13, curb);
      const out = bld ? bld.setback : EDGE + 7;
      this.band(j, s * EDGE, 0.13, s * out, 0.13, this.fogCol(this.ground(seg, 'pavement', stripe, track), f), texOn?.pavement ?? null, ta);
      if (bld) this.drawFacade(j, seg, bld, s, f);
      else this.band(j, s * out, 0.13, s * farX, 0.13 + 0.05 * (farX - out), this.fogCol(this.ground(seg, 'meadow', stripe, track), f), texOn?.meadow ?? null, ta);
      return;
    }
    const gcol = this.ground(seg, side.ground, Math.abs(side.tilt) > 0.25 ? -1 : stripe, track);
    if (side.drop) {
      // nur die abfallende Kante – dahinter liegt das Tal
      this.band(j, s * EDGE, 0, s * (EDGE + 2.2), side.tilt * 2.2, this.fogCol(gcol, f), texOn?.[side.ground] ?? null, ta);
      this.band(j, s * (EDGE + 2.2), side.tilt * 2.2, s * (EDGE + 3.4), side.tilt * 2.2 - 3, this.fogCol(shade(gcol, 0.8), f));
      return;
    }
    const h = Math.max(-60, Math.min(70, side.tilt * (farX - EDGE)));
    this.band(j, s * EDGE, 0, s * farX, h, this.fogCol(gcol, f), texOn?.[side.ground] ?? null, ta);
  }

  private track: Track | null = null;

  private drawFacade(j: number, _seg: Seg, b: Building, s: number, f: number) {
    const col = b.style === 2 ? ([206, 196, 178] as RGB) : FACADES[b.color];
    const lit = s < 0 ? 0.9 : 1;
    const top = b.height;
    this.wall(j, s * b.setback, 0, top, this.fogCol(shade(col, lit), f));
    if (b.style === 1) this.wall(j, s * b.setback, 3.1, top, this.fogCol(shade([132, 88, 52], lit), f));
    // Sockel
    this.wall(j, s * b.setback, 0, 0.6, this.fogCol(shade(col, lit * 0.8), f));
    // Traufe
    this.band(j, s * b.setback, top, s * (b.setback - 0.55), top + 0.22, this.fogCol(shade([80, 50, 35], 1), f));
  }

  private drawRoad(j: number, seg: Seg, g: Abfahrt) {
    const f = this.FOG[j];
    const dz = this.EZ[j] - this.cam.z;
    const stripe = (seg.i >> 1) & 1;
    const sc = SURFACE_COL[seg.surface][stripe];
    const texOn = dz < TEX_ROAD;
    const ta = Math.max(0, 1 - f * 1.4);
    const track = this.track!;
    const { pal } = this.segPal(seg, track);
    // Bankett
    const verge = this.fogCol(seg.surface === 'gravel' ? shade(SURFACE_COL.gravel[stripe], 0.92) : pal.verge, f);
    this.band(j, -EDGE, 0, -ROAD_HALF, 0, verge, texOn ? this.tex.verge : null, ta * 0.9);
    this.band(j, ROAD_HALF, 0, EDGE, 0, verge, texOn ? this.tex.verge : null, ta * 0.9);
    // Belag
    this.band(j, -ROAD_HALF, 0, ROAD_HALF, 0, this.fogCol(sc, f), texOn ? this.tex.surface[seg.surface] : null, ta * (seg.surface === 'cobble' ? 1 : 0.85));
    // Schatten der Bäume (weiche, unregelmäßige Flecken, stetig entlang der Strecke)
    const biome = track.sections[seg.sec].biome;
    const shady = biome === 'forest' || seg.L.ground === 'forest' || seg.R.ground === 'forest';
    if (shady && dz < 220) {
      const z = (this.EZ[j] + this.EZ[j + 1]) * 0.5;
      const n1 = Math.sin(z * 0.11) + Math.sin(z * 0.047 + 1.3) * 0.8 + Math.sin(z * 0.23 + 0.7) * 0.4;
      if (n1 > 0.15) {
        const a = -EDGE + 0.6 + (Math.sin(z * 0.19 + 2.1) + Math.sin(z * 0.53)) * 1.1;
        const b = a + 1.6 + (Math.sin(z * 0.13 + 0.4) + 1) * 1.8 + Math.sin(z * 0.71) * 0.4;
        const k = Math.min(1, (n1 - 0.15) * 2.5);
        this.band(j, Math.max(-EDGE, a), 0.005, Math.min(EDGE, b), 0.005, `rgba(12,28,10,${(0.26 * k * (1 - f)).toFixed(3)})`);
      }
    }
    const lines = seg.surface === 'asphalt' || seg.surface === 'fresh';
    if (lines && dz < 300) {
      const white = css(mixRGB([238, 238, 232], this.haze, f * 0.92));
      const village = biome === 'village';
      if (!village) {
        this.band(j, -ROAD_HALF + 0.08, 0.002, -ROAD_HALF + 0.2, 0.002, white);
        this.band(j, ROAD_HALF - 0.2, 0.002, ROAD_HALF - 0.08, 0.002, white);
      }
      if (Math.abs(seg.curve) > 0.015 || seg.hairpin) {
        this.band(j, -0.17, 0.002, -0.06, 0.002, white);
        this.band(j, 0.06, 0.002, 0.17, 0.002, white);
      } else if ((seg.i & 3) < 2) this.band(j, -0.06, 0.002, 0.06, 0.002, white);
    }
    // Malereien und Details
    if (dz < 260) this.drawDecals(j, seg, g, f);
  }

  private drawDecals(j: number, seg: Seg, g: Abfahrt, f: number) {
    const track = g.track;
    for (let back = 0; back < 9; back++) {
      if (seg.i - back < 0) break;
      const s = track.seg(seg.i - back);
      if (!s.decals) continue;
      for (const d of s.decals) {
        if (back >= d.len) continue;
        const z0 = s.i * SEG;
        const len = d.len * SEG;
        const v0 = (this.EZ[j] - z0) / len;
        const v1 = (this.EZ[j + 1] - z0) / len;
        const a = 1 - f;
        switch (d.k) {
          case 'text':
          case 'arrow': {
            const img = d.k === 'text' ? this.roadText(d.text ?? '') : this.arrows[(d.text as 'L' | 'R') ?? 'L'];
            const sy0 = Math.max(0, (1 - v1) * img.height);
            const sy1 = Math.min(img.height, (1 - v0) * img.height);
            if (sy1 - sy0 < 0.5) break;
            const e0 = j;
            const e1 = j + 1;
            const sc = (this.SC[e0] + this.SC[e1]) / 2;
            const cx = (this.SX[e0] + this.SX[e1]) / 2 + d.x * sc;
            const w = d.w * 2 * sc;
            this.c.globalAlpha = a * 0.9;
            this.c.drawImage(img, 0, sy0, img.width, sy1 - sy0, cx - w / 2, this.SY[e1], w, this.SY[e0] - this.SY[e1] + 0.5);
            this.c.globalAlpha = 1;
            break;
          }
          case 'patch':
            this.band(j, d.x - d.w, 0.003, d.x + d.w, 0.003, `rgba(20,20,22,${(0.12 * a).toFixed(3)})`);
            break;
          case 'zebra':
            for (let q = -2; q <= 2; q++) {
              const x = q * 1.05;
              this.band(j, x - 0.25, 0.003, x + 0.25, 0.003, `rgba(245,245,240,${(0.9 * a).toFixed(3)})`);
            }
            break;
          case 'grid':
            for (let q = 0; q < 1; q++) this.band(j, -ROAD_HALF, 0.003, ROAD_HALF, 0.003, `rgba(30,30,32,${(0.55 * a).toFixed(3)})`);
            break;
          case 'manhole': {
            if (!this.START[j]) break;
            if (!this.proj(z0 + 0.6, d.x, 0.003)) break;
            const { x, y, s: k } = this.pt;
            const ry = Math.max(1, (this.SY[j] - this.SY[j + 1]) / Math.max(0.1, this.EZ[j + 1] - this.EZ[j]) * 0.35);
            this.c.beginPath();
            this.c.ellipse(x, y, 0.35 * k, ry, 0, 0, Math.PI * 2);
            this.c.fillStyle = `rgba(40,40,42,${(0.8 * a).toFixed(3)})`;
            this.c.fill();
            break;
          }
        }
      }
    }
  }

  private roadText(t: string): HTMLCanvasElement {
    let img = this.texts.get(t);
    if (!img) {
      img = roadText(t);
      this.texts.set(t, img);
    }
    return img;
  }

  private drawBarriers(j: number, seg: Seg) {
    const f = this.FOG[j];
    const dz = this.EZ[j] - this.cam.z;
    if (dz > 330) return;
    for (const s of [-1, 1]) {
      const side = s < 0 ? seg.L : seg.R;
      if (seg.crowd) {
        const cloth = BARRIER_CLOTH[(seg.i >> 2) % BARRIER_CLOTH.length];
        this.wall(j, s * (EDGE - 0.05), 0.15, 0.95, this.fogCol(hexRGB(cloth), f));
        this.wall(j, s * (EDGE - 0.05), 0.95, 1.05, this.fogCol([200, 205, 210], f));
        continue;
      }
      if (side.wall > 0) continue;
      switch (side.barrier) {
        case 'rail': {
          const x = s * (EDGE - 0.12);
          this.wall(j, x, 0.44, 0.74, this.fogCol([205, 210, 216], f));
          this.wall(j, x, 0.44, 0.53, this.fogCol([138, 145, 153], f));
          this.wall(j, x, 0.66, 0.7, this.fogCol([238, 242, 246], f));
          break;
        }
        case 'stone': {
          const v = 0.9 + hash(seg.i * 3 + s) * 0.16;
          this.wall(j, s * (EDGE - 0.05), 0, 0.62, this.fogCol(shade([170, 160, 145], v), f));
          this.band(j, s * (EDGE - 0.05), 0.62, s * (EDGE + 0.35), 0.62, this.fogCol(shade([200, 192, 178], v), f));
          break;
        }
        case 'fence':
          this.wall(j, s * (EDGE + 0.15), 0.55, 0.62, this.fogCol([122, 86, 52], f));
          this.wall(j, s * (EDGE + 0.15), 0.92, 0.99, this.fogCol([122, 86, 52], f));
          break;
      }
    }
  }

  private drawTunnel(j: number, seg: Seg) {
    const f = this.FOG[j];
    const z = this.EZ[j];
    const m = ((z % 12) + 12) % 12;
    const near = Math.min(m, 12 - m);
    const b = 0.5 + 0.5 * Math.max(0, 1 - near / 5);
    const dark: RGB = [22, 20, 18];
    const col = (c: RGB) => css(mixRGB(shade(c, b), dark, f * 0.85));
    const x = EDGE - 0.35;
    this.band(j, -x, 0, x, 0, col([70, 72, 76]));
    this.band(j, -0.06, 0.002, 0.06, 0.002, (seg.i & 3) < 2 ? col([220, 220, 210]) : col([70, 72, 76]));
    this.band(j, -ROAD_HALF + 0.08, 0.002, -ROAD_HALF + 0.2, 0.002, col([220, 220, 210]));
    this.band(j, ROAD_HALF - 0.2, 0.002, ROAD_HALF - 0.08, 0.002, col([220, 220, 210]));
    for (const s of [-1, 1]) {
      this.wall(j, s * x, 0, 1.3, col([196, 198, 200]));
      this.wall(j, s * x, 1.3, 4.3, col([108, 110, 114]));
      this.wall(j, s * x, 0, 0.18, col([40, 40, 42]));
    }
    // Decke
    this.band(j, -x, 4.3, -1.7, 5.7, col([84, 86, 90]));
    this.band(j, -1.7, 5.7, 1.7, 5.7, col([74, 76, 80]));
    this.band(j, 1.7, 5.7, x, 4.3, col([84, 86, 90]));
    if (this.START[j] && seg.lamp) {
      for (const s of [-1, 1]) {
        if (!this.proj(z + 0.2, s * 1.3, 5.62)) continue;
        const { x: px, y: py, s: k } = this.pt;
        this.c.fillStyle = '#ffe2a8';
        this.c.fillRect(px - 0.35 * k, py - 0.05 * k, 0.7 * k, Math.max(1, 0.1 * k));
        this.glows.push({ x: px, y: py, r: 1.6 * k, img: this.gWarm, a: 0.7 * (1 - f) });
        if (this.proj(z + 0.2, s * 1.0, 0)) this.glows.push({ x: this.pt.x, y: this.pt.y, r: 2.2 * this.pt.s, img: this.gWarm, a: 0.12 * (1 - f) });
      }
    }
  }

  private drawPortal(j: number) {
    const c = this.c;
    const e = j;
    const sc = this.SC[e];
    const cx = this.SX[e];
    const gy = this.SY[e];
    const f = this.FOG[e];
    const X = (x: number) => cx + x * sc;
    const Y = (h: number) => gy - h * sc;
    const x = EDGE - 0.35;
    const hill = BIOME_PALETTES[this.track!.sections[this.SEGS[j].sec].biome];
    const opening = () => {
      c.moveTo(X(-x), Y(0));
      c.lineTo(X(-x), Y(4.3));
      c.quadraticCurveTo(X(-x), Y(5.75), X(0), Y(5.85));
      c.quadraticCurveTo(X(x), Y(5.75), X(x), Y(4.3));
      c.lineTo(X(x), Y(0));
      c.closePath();
    };
    // Berg über dem Tunnel
    c.beginPath();
    c.moveTo(X(-110), Y(-4));
    c.quadraticCurveTo(X(-70), Y(4), X(-45), Y(16));
    c.quadraticCurveTo(X(-20), Y(27), X(0), Y(27));
    c.quadraticCurveTo(X(25), Y(27), X(50), Y(14));
    c.quadraticCurveTo(X(75), Y(3), X(110), Y(-4));
    c.closePath();
    opening();
    c.fillStyle = this.fogCol(shade(hill.ground.forest[0], 0.95), f);
    c.fill('evenodd');
    // Felsanschnitt um das Portal
    c.beginPath();
    c.moveTo(X(-10), Y(0));
    c.lineTo(X(-9), Y(8));
    c.quadraticCurveTo(X(0), Y(12.5), X(9), Y(8.5));
    c.lineTo(X(10), Y(0));
    c.closePath();
    opening();
    c.fillStyle = this.fogCol(shade(hill.rock, 0.95), f);
    c.fill('evenodd');
    // Betonrahmen
    c.beginPath();
    c.moveTo(X(-x - 0.7), Y(0));
    c.lineTo(X(-x - 0.7), Y(4.4));
    c.quadraticCurveTo(X(-x - 0.7), Y(6.5), X(0), Y(6.6));
    c.quadraticCurveTo(X(x + 0.7), Y(6.5), X(x + 0.7), Y(4.4));
    c.lineTo(X(x + 0.7), Y(0));
    c.lineTo(X(x), Y(0));
    c.lineTo(X(x), Y(4.3));
    c.quadraticCurveTo(X(x), Y(5.75), X(0), Y(5.85));
    c.quadraticCurveTo(X(-x), Y(5.75), X(-x), Y(4.3));
    c.lineTo(X(-x), Y(0));
    c.closePath();
    c.fillStyle = this.fogCol([196, 192, 184], f);
    c.fill();
    // ein paar Bäume auf dem Berg
    c.fillStyle = this.fogCol(shade(hill.ground.forest[1], 0.75), f);
    for (let i = 0; i < 14; i++) {
      const hx = -60 + hash(i * 11 + 3) * 120;
      if (Math.abs(hx) < 11) continue;
      const top = Math.max(1, 26 - Math.abs(hx) * 0.42);
      c.beginPath();
      c.moveTo(X(hx - 1.6), Y(top - 1));
      c.lineTo(X(hx), Y(top + 4.5));
      c.lineTo(X(hx + 1.6), Y(top - 1));
      c.closePath();
      c.fill();
    }
    if (sc > 4) {
      c.fillStyle = this.fogCol([250, 250, 245], f);
      c.fillRect(X(-1.4), Y(7.6), 2.8 * sc, 0.7 * sc);
      c.fillStyle = '#222';
      c.font = `700 ${Math.max(6, 0.42 * sc)}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('GALLERIA', X(0), Y(7.25));
    }
  }

  // ------------------------------------------------------------------ Segment-Extras (Sprites, Fenster, Banner)

  private drawSegmentExtras(j: number, seg: Seg, g: Abfahrt) {
    const f = this.FOG[j];
    const sc = this.SC[j];
    const dz = this.EZ[j] - this.cam.z;
    const lights = this.light.lights;
    // Leitplanken-Pfosten
    if (dz < 90 && (seg.i & 1) === 0 && !seg.tunnel) {
      for (const s of [-1, 1]) {
        const side = s < 0 ? seg.L : seg.R;
        if (side.barrier !== 'rail' || side.wall > 0 || seg.crowd) continue;
        const x = this.SX[j] + s * (EDGE - 0.1) * sc;
        const w = Math.max(1, 0.1 * sc);
        this.c.fillStyle = this.fogCol([92, 98, 106], f);
        this.c.fillRect(x - w / 2, this.SY[j] - 0.74 * sc, w, 0.74 * sc);
      }
    }
    // Häuser: Fenster und Stirnseiten
    if (dz < 150) {
      if (seg.bL) this.drawWindows(seg, seg.bL, -1, f, lights);
      if (seg.bR) this.drawWindows(seg, seg.bR, 1, f, lights);
    }
    for (const s of [-1, 1]) {
      const b = s < 0 ? seg.bL : seg.bR;
      if (b && b.start === seg.i) this.drawGable(j, b, s, f, lights);
    }
    // Sprites
    if (seg.sprites) {
      const list = seg.sprites;
      for (let q = 0; q < list.length; q++) this.drawSprite(j, list[q], f, g);
    }
    if (seg.banner) this.drawArch(j, seg.banner, seg.banner.kind === 'gpm' ? this.accent : seg.banner.kind === 'sprint' ? '#1f6feb' : '#ffffff');
    if (seg.portal === 1) this.drawPortal(j);
  }

  private drawSprite(j: number, sp: NonNullable<Seg['sprites']>[number], f: number, g: Abfahrt) {
    const sc = this.SC[j];
    const lit = this.light.lights > 0.45;
    let img;
    if (sp.k === 'tornante' || sp.k === 'townSign' || sp.k === 'passSign') {
      const sec = g.track.sections[this.SEGS[j].sec];
      img = this.bank.label(sp.k, sp.text ?? '', sp.k === 'passSign' ? `${sec.alt.toLocaleString('de-DE')} m` : '');
    } else {
      let frame = 0;
      if (sp.k === 'crowd') frame = Math.floor(this.time * (3 + (this.EZ[j] - g.p.z < 40 ? 4 : 0)) + sp.x * 1.7) & 1;
      if (sp.k === 'flagpole') frame = Math.floor(this.time * 3 + sp.x) & 1;
      img = this.bank.get(sp.v === 9 && sp.k === 'chevron' ? 'dosso' : sp.k, sp.v, frame, lit);
    }
    if (!img) return;
    const w = img.w * sp.s * sc;
    const h = img.h * sp.s * sc;
    if (h < 0.8) return;
    const x = this.SX[j] + sp.x * sc;
    if (x + w < -this.W * 0.3 || x - w > this.W * 1.3) return;
    const y = this.SY[j] - sp.h * sc;
    if (y - h > this.H * 1.2 || y < -this.H * 0.4) return;
    const c = this.c;
    let alpha = Math.max(0, 1 - f * 0.92);
    if (this.EZ[j] < g.p.z) {
      const ps = this.playerScreen;
      const px = ps.x;
      if (Math.abs(x - px) < w / 2 + ps.s * 0.6 && y > ps.y) alpha *= 0.28;
    }
    c.globalAlpha = alpha;
    if (sp.f) {
      c.save();
      c.translate(x, y);
      c.scale(-1, 1);
      c.drawImage(img.img, -w / 2, -h, w, h);
      c.restore();
    } else c.drawImage(img.img, x - w / 2, y - h, w, h);
    c.globalAlpha = 1;
    if (sp.k === 'lamp' && this.light.lights > 0.2) {
      const lx = x + (sp.f ? -1 : 1) * 0.55 * sp.s * sc;
      this.glows.push({ x: lx, y: y - 4.75 * sp.s * sc, r: 2.4 * sc, img: this.gWarm, a: this.light.lights * 0.9 * (1 - f) });
      if (this.proj(this.EZ[j] + 0.1, sp.x * 0.7, 0)) this.glows.push({ x: this.pt.x, y: this.pt.y, r: 3.5 * sc, img: this.gWarm, a: this.light.lights * 0.18 * (1 - f) });
    }
  }

  private drawWindows(seg: Seg, b: Building, s: number, f: number, lights: number) {
    const c = this.c;
    const z0 = seg.i * SEG;
    const x = s * (b.setback - 0.02);
    const rnd = (k: number) => hash(b.seed + seg.i * 31 + k);
    const P: number[] = [];
    const corner = (z: number, h: number) => {
      if (!this.proj(z, x, h)) return false;
      P.push(this.pt.x, this.pt.y);
      return true;
    };
    const rect = (za: number, zb: number, ha: number, hb: number, fill: string) => {
      P.length = 0;
      if (!corner(za, ha) || !corner(za, hb) || !corner(zb, hb) || !corner(zb, ha)) return;
      this.quad(P[0], P[1], P[2], P[3], P[4], P[5], P[6], P[7], fill);
    };
    const shutter = SHUTTERS[b.shutter];
    const floors = b.style === 2 ? 0 : b.floors;
    for (let fl = 0; fl < floors; fl++) {
      const h0 = 3.2 + fl * 2.9;
      if (h0 + 1.3 > b.height - 0.4) break;
      const on = lights > 0.4 && rnd(fl) < 0.55;
      const glass = on ? css(mixRGB([255, 214, 130], this.haze, f * 0.5)) : this.fogCol([44, 52, 64], f);
      rect(z0 + 0.62, z0 + 1.38, h0, h0 + 1.35, glass);
      if (b.style !== 1) {
        rect(z0 + 0.3, z0 + 0.6, h0, h0 + 1.35, this.fogCol(hexRGB(shutter), f));
        rect(z0 + 1.4, z0 + 1.7, h0, h0 + 1.35, this.fogCol(hexRGB(shutter), f));
      }
      if (rnd(fl + 10) < 0.45) {
        rect(z0 + 0.55, z0 + 1.45, h0 - 0.18, h0 - 0.02, this.fogCol([226, 54, 74], f));
      }
      if (on && this.proj(z0 + 1, x, h0 + 0.7)) this.glows.push({ x: this.pt.x, y: this.pt.y, r: 1.4 * this.pt.s, img: this.gWarm, a: 0.35 * lights * (1 - f) });
    }
    // Erdgeschoss: Tür, Laden mit Markise
    const kind = rnd(99);
    if (b.style === 2) {
      rect(z0 + 0.5, z0 + 1.5, 0, 3.4, this.fogCol([70, 50, 36], f));
    } else if (kind < 0.35) {
      rect(z0 + 0.6, z0 + 1.4, 0, 2.2, this.fogCol([84, 58, 38], f));
    } else if (kind < 0.7) {
      rect(z0 + 0.25, z0 + 1.75, 0.5, 2.3, lights > 0.4 ? css([255, 222, 150]) : this.fogCol([60, 72, 84], f));
      const aw = ['#c0392b', '#2e7d4f', '#1f5fbf', '#b8860b'][Math.floor(rnd(5) * 4)];
      P.length = 0;
      const xo = s * (b.setback - 0.95);
      if (this.proj(z0 + 0.1, x, 2.75)) { P.push(this.pt.x, this.pt.y); }
      if (this.proj(z0 + 1.9, x, 2.75)) { P.push(this.pt.x, this.pt.y); }
      if (this.proj(z0 + 1.9, xo, 2.35)) { P.push(this.pt.x, this.pt.y); }
      if (this.proj(z0 + 0.1, xo, 2.35)) { P.push(this.pt.x, this.pt.y); }
      if (P.length === 8) {
        this.quad(P[0], P[1], P[2], P[3], P[4], P[5], P[6], P[7], this.fogCol(hexRGB(aw), f));
        c.globalAlpha = 0.5 * (1 - f);
        this.quad(P[6], P[7], P[4], P[5], P[4], P[5] + (P[5] - P[3]) * 0.2, P[6], P[7] + (P[7] - P[1]) * 0.2, '#ffffff');
        c.globalAlpha = 1;
      }
    }
  }

  private drawGable(j: number, b: Building, s: number, f: number, lights: number) {
    const c = this.c;
    const sc = this.SC[j];
    const cx = this.SX[j];
    const gy = this.SY[j];
    const X = (x: number) => cx + s * x * sc;
    const Y = (h: number) => gy - h * sc;
    const col = b.style === 2 ? ([196, 186, 168] as RGB) : FACADES[b.color];
    const dark = this.fogCol(shade(col, 0.74), f);
    const x0 = b.setback;
    const x1 = b.setback + b.depth;
    this.quad(X(x0), Y(0), X(x1), Y(0), X(x1), Y(b.height), X(x0), Y(b.height), dark);
    // Dach (Giebel zur Straße)
    if (b.style !== 2) {
      const roof = this.fogCol(hexRGB(ROOFS[b.roof]), f);
      c.beginPath();
      c.moveTo(X(x0 - 0.55), Y(b.height - 0.1));
      c.lineTo(X((x0 + x1) / 2), Y(b.height + b.depth * 0.33));
      c.lineTo(X(x1 + 0.4), Y(b.height - 0.1));
      c.closePath();
      c.fillStyle = roof;
      c.fill();
      c.beginPath();
      c.moveTo(X(x0 + 0.2), Y(b.height));
      c.lineTo(X((x0 + x1) / 2), Y(b.height + b.depth * 0.3));
      c.lineTo(X(x1 - 0.2), Y(b.height));
      c.closePath();
      c.fillStyle = dark;
      c.fill();
      if (sc > 2) {
        const on = lights > 0.4;
        for (let fl = 0; fl < b.floors; fl++) {
          const h0 = 3.2 + fl * 2.9;
          if (h0 + 1.2 > b.height) break;
          c.fillStyle = on && hash(b.seed + fl) < 0.5 ? '#ffd88a' : this.fogCol([40, 48, 60], f);
          c.fillRect(X(x0 + 1.6), Y(h0 + 1.2), 0.9 * sc * s, 1.2 * sc);
        }
      }
    } else {
      // Kirchturm
      const tx0 = x0 + 0.5;
      const tx1 = x0 + 4.3;
      const tc = this.fogCol(shade(col, 0.86), f);
      this.quad(X(tx0), Y(0), X(tx1), Y(0), X(tx1), Y(24), X(tx0), Y(24), tc);
      c.fillStyle = this.fogCol([52, 46, 40], f);
      c.fillRect(Math.min(X(tx0 + 1), X(tx1 - 1)), Y(22), Math.abs(X(tx1 - 1) - X(tx0 + 1)), 2.4 * sc);
      c.beginPath();
      c.moveTo(X(tx0 - 0.3), Y(24));
      c.lineTo(X((tx0 + tx1) / 2), Y(29.5));
      c.lineTo(X(tx1 + 0.3), Y(24));
      c.closePath();
      c.fillStyle = this.fogCol([150, 70, 46], f);
      c.fill();
      c.fillStyle = this.fogCol([240, 236, 226], f);
      c.beginPath();
      c.arc(X((tx0 + tx1) / 2), Y(17.5), 0.9 * sc, 0, Math.PI * 2);
      c.fill();
    }
  }

  private drawArch(j: number, banner: { kind: string; text: string; sub?: string }, color: string) {
    const c = this.c;
    const sc = this.SC[j];
    if (sc < 0.6) return;
    const f = this.FOG[j];
    const cx = this.SX[j];
    const gy = this.SY[j];
    const X = (x: number) => cx + x * sc;
    const Y = (h: number) => gy - h * sc;
    const xl = -EDGE - 0.3;
    const xr = EDGE + 0.3;
    const dz = this.EZ[j] - this.cam.z;
    c.globalAlpha = Math.max(0, 1 - f * 0.9) * Math.max(0.25, Math.min(1, (dz - 4) / 10));
    c.fillStyle = '#9aa0a8';
    const pw = Math.max(1, 0.16 * sc);
    c.fillRect(X(xl) - pw / 2, Y(5.6), pw, 5.6 * sc);
    c.fillRect(X(xr) - pw / 2, Y(5.6), pw, 5.6 * sc);
    const bx = X(xl);
    const by = Y(5.55);
    const bw = X(xr) - X(xl);
    const bh = 1.25 * sc;
    c.fillStyle = color;
    c.beginPath();
    c.roundRect(bx, by, bw, bh, Math.min(6, bh * 0.15));
    c.fill();
    const light = color === '#ffffff';
    if (banner.kind === 'welcome') {
      c.fillStyle = '#1f8a4c'; c.fillRect(bx, by + bh - bh * 0.12, bw / 3, bh * 0.12);
      c.fillStyle = '#f4f4f4'; c.fillRect(bx + bw / 3, by + bh - bh * 0.12, bw / 3, bh * 0.12);
      c.fillStyle = '#d23a3a'; c.fillRect(bx + (2 * bw) / 3, by + bh - bh * 0.12, bw / 3, bh * 0.12);
    }
    if (bh > 7) {
      const main = banner.kind === 'gpm' ? `GPM · ${banner.text}` : banner.kind === 'welcome' ? `Benvenuti a ${banner.text}` : banner.text;
      const fs0 = bh * (banner.sub ? 0.4 : 0.5);
      let fs = fs0;
      c.font = `800 ${fs}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
      const label = main.toUpperCase();
      while (c.measureText(label).width > bw * 0.9 && fs > 4) { fs *= 0.9; c.font = `800 ${fs}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`; }
      c.fillStyle = light ? '#1a1a1a' : '#ffffff';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(label, bx + bw / 2, by + bh * (banner.sub ? 0.36 : 0.5));
      if (banner.sub) {
        c.font = `600 ${fs0 * 0.62}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
        c.globalAlpha *= 0.85;
        c.fillText(banner.sub, bx + bw / 2, by + bh * 0.74);
      }
    }
    c.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ Objekte, Fahrer, Partikel

  private drawEnt(e: Ent, g: Abfahrt) {
    switch (e.kind) {
      case 'obj': this.drawObj(e.ref as Obj); break;
      case 'opp': this.drawOpp(e.ref as Opp, g); break;
      case 'part': this.drawPart(e.ref as Particle); break;
      case 'player': this.drawPlayer(g); break;
    }
  }

  private flatEllipse(z: number, x: number, rx: number, rz: number, fill: string) {
    if (!this.proj(z, x, 0.004)) return;
    const { x: cx, y: cy, s } = this.pt;
    const e = this.stripOf(z);
    const k = (this.SY[e] - this.SY[e + 1]) / Math.max(0.05, this.EZ[e + 1] - this.EZ[e]);
    this.c.beginPath();
    this.c.ellipse(cx, cy, rx * s, Math.max(0.6, rz * k), 0, 0, Math.PI * 2);
    this.c.fillStyle = fill;
    this.c.fill();
  }

  private drawObj(o: Obj) {
    const c = this.c;
    switch (o.k) {
      case 'pothole': {
        if (!this.proj(o.z, o.x, 0)) return;
        const a = 1 - this.pt.f;
        this.flatEllipse(o.z, o.x, o.r * 1.1, o.r * 0.8, `rgba(30,28,26,${(0.9 * a).toFixed(3)})`);
        this.flatEllipse(o.z - o.r * 0.25, o.x, o.r * 0.9, o.r * 0.45, `rgba(150,140,125,${(0.35 * a).toFixed(3)})`);
        this.flatEllipse(o.z + 0.05, o.x, o.r * 0.85, o.r * 0.6, `rgba(20,18,16,${(0.95 * a).toFixed(3)})`);
        return;
      }
      case 'puddle': {
        if (!this.proj(o.z, o.x, 0)) return;
        const a = 1 - this.pt.f;
        const sky = this.light.skyHorizon;
        this.flatEllipse(o.z, o.x, o.r * 1.2, o.r, `rgba(${sky[0] | 0},${sky[1] | 0},${sky[2] | 0},${(0.55 * a).toFixed(3)})`);
        this.flatEllipse(o.z + 0.2, o.x + 0.2, o.r * 0.5, o.r * 0.2, `rgba(255,255,255,${(0.4 * a).toFixed(3)})`);
        return;
      }
      case 'bidon':
      case 'gold': {
        const bob = Math.sin(this.time * 4 + (o.ph ?? 0)) * 0.06;
        if (!this.proj(o.z, o.x, 0.42 + bob)) return;
        const { x, y, s, f } = this.pt;
        const k = s * 1.55;
        if (k < 1.5) return;
        const gold = o.k === 'gold';
        // Leuchtring am Boden
        this.flatEllipse(o.z, o.x, 0.32, 0.32, gold ? `rgba(255,210,63,${(0.45 * (1 - f)).toFixed(3)})` : `rgba(80,160,255,${(0.32 * (1 - f)).toFixed(3)})`);
        c.globalAlpha = 1 - f * 0.8;
        c.save();
        c.translate(x, y);
        c.rotate(Math.sin(this.time * 3 + (o.ph ?? 0)) * 0.25);
        const body = gold ? '#ffd23f' : '#3d8bfd';
        c.fillStyle = body;
        c.beginPath(); c.roundRect(-0.075 * k, -0.11 * k, 0.15 * k, 0.24 * k, 0.04 * k); c.fill();
        c.fillStyle = gold ? '#fff3b0' : '#ffffff';
        c.fillRect(-0.075 * k, -0.02 * k, 0.15 * k, 0.05 * k);
        c.fillStyle = gold ? '#b8860b' : '#1b1d22';
        c.beginPath(); c.roundRect(-0.045 * k, -0.17 * k, 0.09 * k, 0.07 * k, 0.02 * k); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.45)';
        c.fillRect(-0.05 * k, -0.1 * k, 0.025 * k, 0.2 * k);
        c.restore();
        c.globalAlpha = 1;
        if (gold) this.glows.push({ x, y, r: 1.8 * s, img: this.gWarm, a: 0.6 });
        return;
      }
      case 'rock': {
        if (!this.proj(o.z, o.x, 0)) return;
        const { x, y, s, f } = this.pt;
        const img = this.bank.get('rock', Math.floor(o.z) % 3);
        if (!img) return;
        const w = img.w * 0.55 * s;
        const h = img.h * 0.55 * s;
        c.globalAlpha = 1 - f * 0.9;
        c.fillStyle = 'rgba(0,0,0,0.25)';
        c.beginPath(); c.ellipse(x, y, w * 0.5, w * 0.12, 0, 0, Math.PI * 2); c.fill();
        c.drawImage(img.img, x - w / 2, y - h, w, h);
        c.globalAlpha = 1;
        return;
      }
      case 'cow': {
        if (!this.proj(o.z, o.x, 0)) return;
        const { x, y, s, f } = this.pt;
        const img = this.bank.get(Math.floor(o.z) % 2 ? 'cowBW' : 'cow', o.vx ? 0 : 1);
        if (!img) return;
        const w = img.w * s;
        const h = img.h * s;
        const step = o.vx ? Math.abs(Math.sin(this.time * 6)) * 0.04 * s : 0;
        c.globalAlpha = 1 - f * 0.9;
        c.fillStyle = 'rgba(0,0,0,0.22)';
        c.beginPath(); c.ellipse(x, y, w * 0.42, w * 0.08, 0, 0, Math.PI * 2); c.fill();
        if ((o.vx ?? 0) > 0) {
          c.save(); c.translate(x, y - step); c.scale(-1, 1); c.drawImage(img.img, -w / 2, -h, w, h); c.restore();
        } else c.drawImage(img.img, x - w / 2, y - h - step, w, h);
        c.globalAlpha = 1;
        return;
      }
      case 'cone': {
        if (!this.proj(o.z, o.x, 0)) return;
        const { x, y, s, f } = this.pt;
        c.globalAlpha = 1 - f * 0.9;
        drawCone(c, x, y, s, 0);
        c.globalAlpha = 1;
      }
    }
  }

  private drawOpp(o: Opp, g: Abfahrt) {
    if (!this.proj(o.z, o.x, 0)) return;
    const { x, y, s, f } = this.pt;
    if (s < 1) return;
    this.c.globalAlpha = Math.max(0, 1 - f * 0.9);
    drawRider(this.c, x, y, s * RIDER, o.kit, { lean: o.lean, pedal: o.pedal, tuck: o.tuck, brake: o.brake, light: this.light.lights });
    this.c.globalAlpha = 1;
    if (this.light.lights > 0.25 || g.track.segAt(o.z).tunnel) {
      const ly = y - 0.78 * s * RIDER;
      this.glows.push({ x: x + Math.sin(o.lean) * 0.78 * s * RIDER, y: ly, r: 0.28 * s + 2, img: this.gRed, a: 0.7 * (1 - f) });
    }
  }

  private drawPlayer(g: Abfahrt) {
    const p = g.p;
    const roadY = g.track.heightAt(p.z);
    const air = Math.max(0, p.y - roadY);
    if (!this.proj(p.z, p.x, 0)) return;
    const { x, y, s } = this.pt;
    const c = this.c;
    if (g.phase === 'crash' || g.phase === 'over') {
      drawCrash(c, x, y, s * RIDER, p.kit, g.phaseT, g.crashSpin);
      return;
    }
    if (air > 0.02) {
      // Schatten bleibt auf der Straße
      c.fillStyle = `rgba(0,0,0,${(0.22 / (1 + air)).toFixed(3)})`;
      c.beginPath(); c.ellipse(x, y, 0.42 * s, 0.09 * s, 0, 0, Math.PI * 2); c.fill();
    }
    // Windschatten: Luftlinien
    if (g.draft > 0.3) {
      c.strokeStyle = `rgba(255,255,255,${(0.35 * g.draft).toFixed(3)})`;
      c.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) {
        const ph = (this.time * 2.4 + i / 6) % 1;
        const side = i % 2 ? 1 : -1;
        const ox = x + side * (0.45 + ph * 0.3) * s;
        const oy = y - (0.5 + (i % 3) * 0.35) * s + ph * 0.8 * s;
        c.beginPath();
        c.moveTo(ox, oy);
        c.quadraticCurveTo(ox + side * 0.1 * s, oy + 0.3 * s, ox + side * 0.05 * s, oy + 0.6 * s);
        c.stroke();
      }
    }
    drawRider(c, x, y - air * s, s * RIDER, p.kit, { lean: p.lean, pedal: p.pedal, tuck: p.tuck, brake: p.brake, light: this.light.lights }, air > 0.02 ? 0 : 0.3);
    if (p.brake > 0.1 && p.v > 5) {
      // Bremsspur-Funken bei Vollbremsung auf Schotter, sonst Bremslicht-Glimmen
      this.glows.push({ x, y: y - 0.06 * s, r: 0.3 * s, img: this.gRed, a: 0.25 * p.brake });
    }
    if (this.light.lights > 0.25 || g.track.segAt(p.z).tunnel) this.glows.push({ x: x + Math.sin(p.lean) * 0.78 * s * RIDER, y: y - (0.78 * RIDER + air) * s, r: 0.28 * s + 2, img: this.gRed, a: 0.75 });
    this.playerScreen.x = x;
    this.playerScreen.y = y - (1.6 * RIDER + air) * s;
    this.playerScreen.s = s;
  }

  playerScreen = { x: 0, y: 0, s: 1 };

  private drawPart(q: Particle) {
    if (!this.proj(q.z, q.x, q.h)) return;
    const { x, y, s, f } = this.pt;
    const c = this.c;
    const a = Math.max(0, q.life / q.max) * (1 - f);
    switch (q.kind) {
      case 'dust':
      case 'snow': {
        const r = q.size * s * (1.6 - q.life / q.max);
        c.globalAlpha = a * 0.45;
        c.fillStyle = q.color;
        c.beginPath(); c.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2); c.fill();
        break;
      }
      case 'gravel':
      case 'splash':
        c.globalAlpha = a;
        c.fillStyle = q.color;
        c.fillRect(x, y, Math.max(1, q.size * s), Math.max(1, q.size * s));
        break;
      case 'spark':
        c.globalAlpha = a;
        c.strokeStyle = q.color;
        c.lineWidth = Math.max(1, 0.03 * s);
        c.beginPath(); c.moveTo(x, y); c.lineTo(x - q.vx * 0.02 * s, y + q.vh * 0.02 * s); c.stroke();
        break;
      case 'confetti':
        c.globalAlpha = a;
        c.save();
        c.translate(x, y);
        c.rotate(q.rot);
        c.fillStyle = q.color;
        c.fillRect(-q.size * s, -q.size * s * 0.5 * Math.abs(Math.cos(q.rot * 1.7)), q.size * s * 2, q.size * s * Math.abs(Math.cos(q.rot * 1.7)) + 0.5);
        c.restore();
        break;
      case 'cone':
        c.globalAlpha = Math.min(1, a * 2);
        drawCone(c, x, y, s, q.rot);
        break;
    }
    c.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ Bildschirm-Effekte

  private drawSpeed(g: Abfahrt) {
    const v = g.p.v;
    if (v < 19 || g.phase !== 'playing') return;
    const c = this.c;
    const k = Math.min(1, (v - 19) / 13);
    const cx = this.W / 2;
    const cy = this.hor + this.H * 0.08;
    c.strokeStyle = `rgba(255,255,255,${(0.22 * k).toFixed(3)})`;
    c.lineWidth = 1.2;
    for (let i = 0; i < 14; i++) {
      const a = hash(i * 7 + 1) * Math.PI * 2;
      const ph = (this.time * (1.6 + hash(i) * 1.2) + hash(i * 3)) % 1;
      const r0 = Math.max(this.W, this.H) * (0.35 + ph * 0.5);
      const r1 = r0 + 40 + 80 * k;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      if (sa > 0.25 && Math.abs(ca) < 0.45) continue; // nicht über den Fahrer
      c.beginPath();
      c.moveTo(cx + ca * r0, cy + sa * r0 * 0.8);
      c.lineTo(cx + ca * r1, cy + sa * r1 * 0.8);
      c.stroke();
    }
  }

  private drawPopups(g: Abfahrt) {
    const c = this.c;
    const ps = this.playerScreen;
    const tones: Record<string, string> = { accent: this.accent, gold: '#ffd23f', white: '#ffffff', muted: '#d1d1d6', red: '#ff7a6b', blue: '#8ccaff' };
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const font = '-apple-system, "SF Pro Text", "Segoe UI", Roboto, Arial, sans-serif';
    const baseY = Math.min(this.H * 0.62, ps.y - 18);
    let acc = 0;
    for (let i = g.popups.length - 1; i >= 0; i--) {
      const pp = g.popups[i];
      const t = pp.age / pp.life;
      const rise = (1 - Math.pow(1 - Math.min(1, t * 1.6), 3)) * 26;
      const pop = t < 0.1 ? 1.25 - (t / 0.1) * 0.25 : 1;
      const alpha = t > 0.75 ? (1 - t) / 0.25 : Math.min(1, t * 12);
      const size = (pp.big ? 22 : 16) * pop;
      const boxH = size * 1.5 + (pp.sub ? 15 : 0);
      const y = baseY - acc - rise;
      acc += boxH + 6;
      if (y < this.H * 0.24) break;
      const x = Math.max(90, Math.min(this.W - 90, ps.x));
      c.font = `800 ${size}px ${font}`;
      const w = Math.min(this.W - 24, c.measureText(pp.text).width + 24);
      c.globalAlpha = alpha * 0.62;
      c.fillStyle = '#0a0c12';
      c.beginPath();
      c.roundRect(x - w / 2, y - boxH / 2, w, boxH, Math.min(boxH / 2, 18));
      c.fill();
      c.globalAlpha = alpha;
      c.fillStyle = tones[pp.tone] ?? '#fff';
      c.fillText(pp.text, x, y - (pp.sub ? 7 : 0), this.W - 40);
      if (pp.sub) {
        c.font = `600 12px ${font}`;
        c.fillStyle = 'rgba(255,255,255,0.85)';
        c.fillText(pp.sub, x, y + size * 0.55, this.W - 40);
      }
    }
    c.globalAlpha = 1;
  }
}

function drawCone(c: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.fillStyle = '#1d1d1f';
  c.fillRect(-0.2 * s, -0.04 * s, 0.4 * s, 0.04 * s);
  c.beginPath();
  c.moveTo(-0.15 * s, -0.04 * s);
  c.lineTo(-0.03 * s, -0.7 * s);
  c.lineTo(0.03 * s, -0.7 * s);
  c.lineTo(0.15 * s, -0.04 * s);
  c.closePath();
  c.fillStyle = '#ff6a13';
  c.fill();
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.moveTo(-0.11 * s, -0.25 * s);
  c.lineTo(-0.07 * s, -0.42 * s);
  c.lineTo(0.07 * s, -0.42 * s);
  c.lineTo(0.11 * s, -0.25 * s);
  c.closePath();
  c.fill();
  c.restore();
}

const rgbCache = new Map<string, RGB>();
function hexRGB(h: string): RGB {
  let v = rgbCache.get(h);
  if (!v) {
    v = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    rgbCache.set(h, v);
  }
  return v;
}

function fmtKm(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`;
}
