/**
 * Zeichnet „Akku leer!“ auf ein Canvas (2D): Kamera mit Mitziehen und Wackeln, Kulisse mit Wolken,
 * Gleitschirm und kleinen Radlern, Gabel-Schleuder mit Fahrradschlauch, Bauteile, Figuren, Partikel, Punkte.
 * Statische Teile liegen als fertige Bilder bereit – pro Bild werden nur bewegte Dinge neu gezeichnet.
 */
import { MAX_PULL, RIDERS, GRAVITY, WAIT_SCALE, type AkkuGame, type Enemy, type Shot, type Block } from './game';
import type { LevelDef } from './level';
import { drawBattery, drawEnemy, drawRider, INK, type RiderMood } from './chars';
import { FONT, blockSprite, cloudSprite, makeCanvas, paintBackdrop, paintTerrain, type Backdrop, type TerrainLayer } from './art';
import { P } from './particles';

const TAU = Math.PI * 2;
/** kleinste Darstellung (CSS-Pixel pro Meter) – darunter wird die Kamera mitgezogen statt verkleinert */
const MIN_PX = 24;
/** Platz oben für Punkte und Knöpfe (CSS-Pixel) */
const HUD_TOP = 64;

interface Cam { x: number; y: number; z: number }

export class AkkuRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private cssW = 1;
  private cssH = 1;
  dpr = 1;
  /** Gerätepixel pro Meter in der Grundansicht */
  private baseZ = 40;
  /** Kamera: Weltpunkt in der Bildmitte und Zoom (Gerätepixel pro Meter) */
  private cam: Cam = { x: 0, y: 0, z: 40 };
  private aim: Cam = { x: 0, y: 0, z: 40 };
  private overview: Cam = { x: 0, y: 0, z: 40 };
  private minX = 0;
  private maxX = 0;
  private pans = false;
  private backdrop: Backdrop | null = null;
  private terrain: TerrainLayer | null = null;
  private clouds: HTMLCanvasElement[] = [];
  private sprites = new Map<string, { canvas: HTMLCanvasElement; ox: number; oy: number }>();
  private spriteScale = 40;
  private vignette: HTMLCanvasElement | null = null;
  private level: LevelDef | null = null;
  private names: string[] = [];
  private dark = false;
  private time = 0;
  private shakeX = 0;
  private shakeY = 0;
  private lastPhase = '';
  private introT = 0;
  /** Zeit seit dem letzten Wechsel in den Zielmodus (für den Hinweis mit dem Finger) */
  private aimIdle = 0;
  /** Bildzeiten zum Anpassen der Auflösung */
  private frameAcc = 0;
  private dtAcc = 0;
  private frameN = 0;
  private slowFrames = 0;
  maxDpr = 2;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error('Canvas 2D nicht verfügbar');
    this.ctx = ctx;
  }

  /** Größe und Thema – baut die fertigen Bilder neu */
  setup(level: LevelDef, cssW: number, cssH: number, dpr: number, names: string[], dark: boolean) {
    this.level = level;
    this.names = names;
    this.dark = dark;
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.dpr = Math.min(this.maxDpr, Math.max(Math.min(1, this.maxDpr), dpr));
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.layout();
    this.cam = { ...this.aim };
    this.build();
  }

  /** Namen der Runde für die Straße (malt nur das Gelände neu) */
  setNames(names: string[]) {
    if (!this.level || names.join('|') === this.names.join('|')) return;
    this.names = names;
    this.terrain = paintTerrain(this.level, Math.min(this.baseZ, 96), names, this.dark);
  }

  private layout() {
    const v = this.level!.view;
    const vw = v.x1 - v.x0;
    const vh = v.y1 - v.y0;
    const availH = this.cssH - HUD_TOP;
    const fitW = this.cssW / vw;
    const fitH = availH / vh;
    let zc = Math.min(fitW, fitH);
    if (zc < MIN_PX) zc = Math.min(MIN_PX, fitH);
    zc = Math.min(zc, 64);
    const Z = zc * this.dpr;
    this.baseZ = Z;
    const halfW = this.cssW / 2 / zc;
    this.pans = zc * vw > this.cssW + 1;
    // Boden: unten, bei viel Platz etwas angehoben
    const extra = Math.max(0, availH - vh * zc);
    const groundCss = this.cssH - 10 - -v.y0 * zc - extra * 0.12;
    const cy = (groundCss - this.cssH / 2) / zc;
    if (this.pans) {
      this.minX = v.x0 + halfW;
      this.maxX = v.x1 - halfW;
      this.aim = { x: this.minX, y: cy, z: Z };
    } else {
      this.minX = this.maxX = (v.x0 + v.x1) / 2;
      this.aim = { x: this.minX, y: cy, z: Z };
    }
    // Übersicht: ganzes Level (zum Schluss)
    const zAll = Math.min(fitW, fitH) * this.dpr;
    const groundAll = this.cssH - 10 - -v.y0 * (zAll / this.dpr) - Math.max(0, availH - vh * (zAll / this.dpr)) * 0.12;
    this.overview = { x: (v.x0 + v.x1) / 2, y: (groundAll - this.cssH / 2) / (zAll / this.dpr), z: zAll };
  }

  private build() {
    const level = this.level!;
    const Z = this.baseZ;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const groundY = H / 2 + this.aim.y * Z;
    const pad = Math.round(Math.max(W, H) * 0.3);
    this.backdrop = paintBackdrop(W, H, groundY, Z, pad, this.dark);
    this.spriteScale = Math.min(Z, 110);
    this.terrain = paintTerrain(level, Math.min(Z, 96), this.names, this.dark);
    this.clouds = [cloudSprite(Z * 5, 3, this.dark), cloudSprite(Z * 3.4, 8, this.dark), cloudSprite(Z * 6.5, 13, this.dark)];
    this.sprites.clear();
    // Vignette mit eingebackenem Papierkorn (ein Vollbild-Durchgang)
    const g = makeCanvas(128, 128);
    const gx = g.getContext('2d')!;
    const img = gx.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (Math.random() - 0.5) * 255;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 14;
    }
    gx.putImageData(img, 0, 0);
    const vg = makeCanvas(W, H);
    const vx = vg.getContext('2d')!;
    const grad = vx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.45, Math.max(W, H) * 0.75);
    grad.addColorStop(0, 'rgba(20,16,30,0)');
    grad.addColorStop(1, 'rgba(20,16,30,0.28)');
    vx.fillStyle = grad;
    vx.fillRect(0, 0, W, H);
    const pat = vx.createPattern(g, 'repeat');
    if (pat) {
      vx.fillStyle = pat;
      vx.fillRect(0, 0, W, H);
    }
    this.vignette = vg;
  }

  /** alle Bauteile in allen Schadensstufen vorab zeichnen (kein Ruckeln beim ersten Treffer) */
  prewarm(g: AkkuGame) {
    for (const b of g.blocks) {
      const keep = b.stage;
      for (let st = 0; st < 3; st++) { b.stage = st; this.spriteFor(b); }
      b.stage = keep;
    }
  }

  /** Bildschirm-Pixel (CSS) → Welt */
  toWorld(sx: number, sy: number): { x: number; y: number } {
    const Z = this.cam.z / this.dpr;
    return { x: this.cam.x + (sx - this.cssW / 2) / Z, y: this.cam.y - (sy - this.cssH / 2) / Z };
  }

  /** Welt → CSS-Pixel */
  toScreen(x: number, y: number): { x: number; y: number } {
    const Z = this.cam.z / this.dpr;
    return { x: (x - this.cam.x) * Z + this.cssW / 2, y: this.cssH / 2 - (y - this.cam.y) * Z };
  }

  // ---------------------------------------------------------------- Kamera

  private updateCamera(g: AkkuGame, dt: number) {
    if (g.phase !== this.lastPhase) {
      if (g.phase === 'aim') this.aimIdle = 0;
      this.lastPhase = g.phase;
    }
    let target: Cam = { ...this.aim };
    const halfW = this.canvas.width / 2 / this.aim.z;
    if (g.phase === 'intro') {
      this.introT = g.phaseT;
      // erst die E-Biker zeigen, dann zur Schleuder schwenken
      const t = Math.max(0, Math.min(1, (this.introT - 0.9) / 1.6));
      const e = t * t * (3 - 2 * t);
      if (this.pans) target.x = this.maxX + (this.aim.x - this.maxX) * e;
      else target.z = this.aim.z * (1.18 - 0.18 * e);
      if (this.introT < 0.05) this.cam = { ...target };
      void dt;
    } else if (g.phase === 'fly') {
      // Rennradler folgen (der vorderste zählt)
      let lead: Shot | null = null;
      for (const s of g.shots) if (!s.dead && (!lead || s.body.x > lead.body.x)) lead = s;
      if (lead && this.pans) target.x = Math.max(this.minX, Math.min(this.maxX, lead.body.x + halfW * 0.25));
      else if (!lead) target.x = this.cam.x;
      if (lead) {
        // zu hoch geflogen? Kamera hebt sich
        const topY = this.aim.y + (this.canvas.height / 2 - HUD_TOP * this.dpr) / this.aim.z;
        if (lead.body.y + 1.2 > topY) target.y = this.aim.y + (lead.body.y + 1.2 - topY);
      }
    } else if (g.phase === 'won' || g.phase === 'lost' || g.phase === 'over') {
      target = { ...this.overview };
    }
    const k = 1 - Math.exp(-dt * (g.phase === 'fly' ? 4.2 : g.phase === 'won' ? 4 : 2.6));
    this.cam.x += (target.x - this.cam.x) * k;
    this.cam.y += (target.y - this.cam.y) * k;
    this.cam.z += (target.z - this.cam.z) * k;
    // Wackeln
    const tr = g.trauma * g.trauma;
    this.shakeX = (Math.sin(this.time * 53.1) + Math.sin(this.time * 31.7) * 0.5) * tr * 0.22;
    this.shakeY = (Math.cos(this.time * 47.3) + Math.sin(this.time * 23.9) * 0.5) * tr * 0.22;
  }

  // ---------------------------------------------------------------- Bild

  draw(g: AkkuGame, dt: number) {
    if (!this.level || !this.backdrop || !this.terrain) return;
    const t0 = performance.now();
    this.time += dt;
    this.updateCamera(g, dt);
    if (g.phase === 'aim') this.aimIdle += dt;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const Z = this.cam.z;
    const camX = this.cam.x + this.shakeX;
    const camY = this.cam.y + this.shakeY;
    const ox = W / 2 - camX * Z;
    const oy = H / 2 + camY * Z;

    // Kulisse (Parallaxe)
    const bd = this.backdrop;
    const zr = Z / this.baseZ;
    const par = 0.28;
    const bx = -bd.pad - (camX - this.aim.x) * Z * par;
    const by = -bd.pad + (camY - this.aim.y) * Z * par;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    if (Math.abs(zr - 1) < 0.002) {
      ctx.drawImage(bd.canvas, bx, by);
    } else {
      const s = 1 + (zr - 1) * 0.35;
      const cxp = W / 2;
      const cyp = H / 2;
      ctx.drawImage(bd.canvas, cxp + (bx - cxp) * s, cyp + (by - cyp) * s, bd.canvas.width * s, bd.canvas.height * s);
    }
    this.drawSky(bx, by, zr);

    this.drawHeli(g, ox, oy, Z, dt);

    // Gelände
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const tl = this.terrain;
    const ts = Z / tl.s;
    ctx.drawImage(tl.canvas, ox + tl.x0 * Z, oy - tl.y1 * Z, tl.canvas.width * ts, tl.canvas.height * ts);

    // Spur des letzten und des laufenden Schusses
    this.drawTrail(g.lastTrail, ox, oy, Z, 0.5);
    this.drawTrail(g.trail, ox, oy, Z, 1);

    this.drawSlingBack(g, ox, oy, Z);
    this.drawWaiting(g, ox, oy, Z);
    this.drawBlocks(g, ox, oy, Z);
    this.drawEnemies(g, ox, oy, Z);
    this.drawBottles(g, ox, oy, Z);
    this.drawShots(g, ox, oy, Z);
    this.drawLoaded(g, ox, oy, Z);
    this.drawSlingFront(g, ox, oy, Z);
    this.drawGhosts(g, ox, oy, Z);
    this.drawParticles(g, ox, oy, Z);
    if (g.pull) this.drawAim(g, ox, oy, Z);
    this.drawBatteries(g, ox, oy, Z);
    this.drawPopups(g, ox, oy, Z);
    this.drawHints(g, ox, oy, Z);
    this.drawOffscreen(g, ox, oy, Z);

    // Korn und Vignette
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.vignette) ctx.drawImage(this.vignette, 0, 0);
    this.watchFrame(performance.now() - t0, dt);
  }

  /** Auflösung senken, wenn das Zeichnen zu lange dauert */
  private watchFrame(ms: number, dt: number) {
    this.frameAcc += ms;
    this.dtAcc += dt;
    this.frameN++;
    if (this.frameN >= 90) {
      const avg = this.frameAcc / this.frameN;
      const avgDt = this.dtAcc / this.frameN;
      // unter ~50 Bildern pro Sekunde und das Zeichnen kostet spürbar: Auflösung senken
      if (avgDt > 0.0195 && avg > 6) this.slowFrames++;
      else this.slowFrames = 0;
      if (this.slowFrames >= 2 && this.dpr > 1.25 && this.level) {
        this.maxDpr = Math.max(1.25, this.dpr - 0.35);
        const cam = { ...this.cam };
        const ratio = this.maxDpr / this.dpr;
        this.setup(this.level, this.cssW, this.cssH, this.maxDpr, this.names, this.dark);
        this.cam = { x: cam.x, y: cam.y, z: cam.z * ratio };
        this.slowFrames = 0;
      }
      this.frameAcc = 0;
      this.dtAcc = 0;
      this.frameN = 0;
    }
  }

  private place(ox: number, oy: number, Z: number, x: number, y: number, a: number, s = 1) {
    const c = Math.cos(a) * Z * s;
    const n = Math.sin(a) * Z * s;
    this.ctx.setTransform(c, -n, n, c, ox + x * Z, oy - y * Z);
  }

  // ---------------------------------------------------------------- Himmel (bewegt)

  private drawSky(bx: number, by: number, zr: number) {
    const ctx = this.ctx;
    const bd = this.backdrop!;
    const Z = this.baseZ * (1 + (zr - 1) * 0.35);
    const W = bd.canvas.width;
    const t = this.time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Wolken ziehen langsam nach links (verschiedene Höhen und Größen)
    const gy = bd.groundY + by;
    const sky = Math.max(12, gy / Z);
    const CL: [number, number, number][] = [[0.1, 0.42, 1], [0.55, 0.62, 0.8], [0.32, 0.8, 0.55], [0.8, 0.5, 1.1], [0.68, 0.9, 0.45], [0.2, 0.3, 0.7], [0.9, 0.72, 0.6]];
    CL.forEach(([phase, hy, sc], i) => {
      const cl = this.clouds[i % this.clouds.length];
      const cw = cl.width * sc;
      const chh = cl.height * sc;
      const speed = 0.08 + sc * 0.09;
      const span = W + cw * 2;
      const x = (((phase * span - t * Z * speed) % span) + span) % span - cw + bx;
      const y = gy - Z * Math.min(sky - 2, 8 + hy * (sky - 8)) - chh;
      ctx.globalAlpha = 0.55 + sc * 0.35;
      ctx.drawImage(cl, x, y, cw, chh);
    });
    ctx.globalAlpha = 1;
    // Gleitschirm
    const px = ((W * 0.9 - t * Z * 0.35) % (W + Z * 8) + W + Z * 8) % (W + Z * 8) - Z * 4 + bx;
    const py = gy - Z * Math.min(sky * 0.62, 15) + Math.sin(t * 0.7) * Z * 0.4;
    this.paraglider(px, py, Z * 0.55, t);
    // Vögel
    for (let i = 0; i < 3; i++) {
      const span = W + Z * 6;
      const x = (((t * Z * (0.9 + i * 0.12) + i * W * 0.31) % span) + span) % span - Z * 3 + bx;
      const y = gy - Z * (12.5 + i * 0.8) + Math.sin(t * 1.3 + i) * Z * 0.3;
      const f = Math.sin(t * 9 + i * 2) * 0.5 + 0.5;
      ctx.strokeStyle = 'rgba(40,50,70,0.65)';
      ctx.lineWidth = Math.max(1, Z * 0.04);
      ctx.beginPath();
      ctx.moveTo(x - Z * 0.22, y - Z * 0.1 * f);
      ctx.quadraticCurveTo(x - Z * 0.1, y - Z * 0.12, x, y);
      ctx.quadraticCurveTo(x + Z * 0.1, y - Z * 0.12, x + Z * 0.22, y - Z * 0.1 * f);
      ctx.stroke();
    }
  }

  /** TV-Hubschrauber über dem Pass – folgt der Aktion mit etwas Abstand */
  private heli = { x: 8, y: 17, face: -1 };

  private drawHeli(g: AkkuGame, ox: number, oy: number, Z: number, dt: number) {
    const ctx = this.ctx;
    const h = this.heli;
    const top = (oy - HUD_TOP * this.dpr - 30 * this.dpr) / Z;
    let tx = this.cam.x + (this.canvas.width / Z) * 0.18;
    const lead = g.shots.find((s) => !s.dead && s.hitAt < 0);
    if (lead) tx = lead.body.x + 3;
    // über dem höchsten Bau – ist dafür kein Platz im Bild, wartet er oben außerhalb
    const y1 = this.level?.view.y1 ?? 12;
    const ty = top - 1.3 < y1 + 2.4 ? top + 4 : Math.min(top - 1.5, y1 + 5.5);
    const k = 1 - Math.exp(-dt * 0.7);
    const vx = (tx - h.x) * k;
    h.x += vx;
    h.y += (ty - h.y) * k;
    if (Math.abs(vx) > 0.002) h.face = vx > 0 ? 1 : -1;
    const x = h.x;
    const y = h.y + Math.sin(this.time * 1.7) * 0.18;
    const tilt = Math.max(-0.2, Math.min(0.2, vx / Math.max(dt, 0.001) * 0.02));
    this.place(ox, oy, Z, x, y, -tilt * h.face);
    ctx.scale(h.face, 1);
    // Heckausleger und Heckrotor (hinten = links)
    ctx.fillStyle = '#1f3a6b';
    ctx.fillRect(-1.55, -0.12, 1.0, 0.16);
    ctx.beginPath();
    ctx.moveTo(-1.55, -0.04);
    ctx.lineTo(-1.75, -0.42);
    ctx.lineTo(-1.6, -0.42);
    ctx.lineTo(-1.4, -0.06);
    ctx.fill();
    ctx.fillStyle = 'rgba(30,40,60,0.45)';
    ctx.beginPath();
    ctx.ellipse(-1.62, -0.2, 0.08, 0.26 * Math.abs(Math.sin(this.time * 40)), 0, 0, TAU);
    ctx.fill();
    // Rumpf
    ctx.fillStyle = '#244b8a';
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.72, 0.38, 0, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 0.05;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-0.62, 0.05, 1.1, 0.09);
    // Kanzel
    ctx.fillStyle = '#bfe6ff';
    ctx.beginPath();
    ctx.ellipse(0.35, -0.08, 0.32, 0.22, 0.2, -Math.PI * 0.95, Math.PI * 0.35);
    ctx.fill();
    ctx.stroke();
    // TV-Schriftzug und Kamera
    ctx.save();
    ctx.scale(h.face / Z, 1 / Z);
    ctx.fillStyle = '#ffd23f';
    ctx.font = `900 italic ${(0.28 * Z).toFixed(1)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TV', -0.22 * Z * h.face, -0.06 * Z);
    ctx.restore();
    ctx.fillStyle = '#1b1d24';
    ctx.beginPath();
    ctx.arc(0.5, 0.36, 0.12, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#7ab8ff';
    ctx.beginPath();
    ctx.arc(0.56, 0.38, 0.045, 0, TAU);
    ctx.fill();
    // Kufen
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(-0.3, 0.32);
    ctx.lineTo(-0.36, 0.5);
    ctx.moveTo(0.3, 0.32);
    ctx.lineTo(0.36, 0.5);
    ctx.moveTo(-0.6, 0.5);
    ctx.lineTo(0.6, 0.5);
    ctx.stroke();
    // Hauptrotor
    ctx.fillStyle = INK;
    ctx.fillRect(-0.04, -0.52, 0.08, 0.16);
    const blur = 0.35 + Math.abs(Math.sin(this.time * 31)) * 0.4;
    ctx.fillStyle = `rgba(30,40,60,${blur})`;
    ctx.beginPath();
    ctx.ellipse(0, -0.54, 1.25, 0.05, 0, 0, TAU);
    ctx.fill();
  }

  private paraglider(x: number, y: number, s: number, t: number) {
    const ctx = this.ctx;
    const cols = ['#e5484d', '#ffd23f', '#2fb24c', '#3aa8ff', '#e5484d'];
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = cols[i];
      ctx.beginPath();
      const a0 = Math.PI * (1.15 + i * 0.14);
      const a1 = a0 + Math.PI * 0.14;
      ctx.arc(x, y + s * 1.2, s * 1.6, a0, a1);
      ctx.arc(x, y + s * 1.2, s * 1.25, a1, a0, true);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(40,40,50,0.5)';
    ctx.lineWidth = 1;
    const px = x + Math.sin(t * 0.7) * s * 0.1;
    const py = y + s * 2.1;
    ctx.beginPath();
    for (const a of [1.2, 1.5, 1.8]) {
      ctx.moveTo(x + Math.cos(Math.PI * a) * s * 1.25, y + s * 1.2 + Math.sin(Math.PI * a) * s * 1.25);
      ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.fillStyle = '#1b1d24';
    ctx.beginPath();
    ctx.arc(px, py + s * 0.1, s * 0.14, 0, TAU);
    ctx.fill();
  }

  // ---------------------------------------------------------------- Schleuder

  /** Ruhelage und Gabelenden */
  private slingParts(g: AkkuGame) {
    const s = g.sling;
    return { back: { x: s.x - 0.68, y: s.y + 0.28 }, front: { x: s.x + 0.66, y: s.y + 0.32 } };
  }

  /** wo der Schlauch hinten am Fahrer anliegt */
  private pouchPoint(g: AkkuGame): { x: number; y: number; r: number } {
    const s = g.sling;
    if (g.loaded && g.loaded.hop >= 1) {
      const p = g.pouch();
      const r = RIDERS[g.loaded.type].r;
      const dx = g.pull ? -g.pull.x : 1;
      const dy = g.pull ? -g.pull.y : 0;
      const d = Math.hypot(dx, dy) || 1;
      return { x: p.x - (dx / d) * r * 0.85, y: p.y - (dy / d) * r * 0.85, r };
    }
    // nach dem Schuss: Schlauch schwingt aus
    if (g.snap > 0) {
      const k = g.snap / 0.45;
      const osc = Math.cos((1 - k) * 22) * k;
      return { x: s.x + g.snapX * osc * 0.8, y: s.y + g.snapY * osc * 0.8, r: 0 };
    }
    return { x: s.x - 0.05, y: s.y - 0.1, r: 0 };
  }

  private band(ox: number, oy: number, Z: number, ax: number, ay: number, bx: number, by: number) {
    const ctx = this.ctx;
    const len = Math.hypot(bx - ax, by - ay);
    const w = Math.max(0.07, 0.17 - len * 0.035);
    ctx.setTransform(Z, 0, 0, -Z, ox, oy);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#121318';
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = w * 0.3;
    ctx.beginPath();
    ctx.moveTo(ax, ay + w * 0.2);
    ctx.lineTo(bx, by + w * 0.2);
    ctx.stroke();
  }

  private drawSlingBack(g: AkkuGame, ox: number, oy: number, Z: number) {
    const ctx = this.ctx;
    const s = g.sling;
    ctx.setTransform(Z, 0, 0, -Z, ox, oy);
    // Schatten
    ctx.fillStyle = 'rgba(20,20,30,0.25)';
    ctx.beginPath();
    ctx.ellipse(s.x, 0.02, 0.9, 0.14, 0, 0, TAU);
    ctx.fill();
    // Gabelschaft (steckt im Boden)
    ctx.fillStyle = '#1d2027';
    ctx.beginPath();
    ctx.roundRect(s.x - 0.15, -0.05, 0.3, 1.15, 0.06);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(s.x + 0.04, 0.05, 0.05, 1.0);
    ctx.fillStyle = '#e5484d';
    ctx.fillRect(s.x - 0.15, 0.42, 0.3, 0.11);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(s.x - 0.15, 0.53, 0.3, 0.06);
    // hintere Gabelscheide
    const { back } = this.slingParts(g);
    this.blade(s.x - 0.28, 1.15, back.x, back.y, '#15171c');
    // Krone
    ctx.setTransform(Z, 0, 0, -Z, ox, oy);
    ctx.fillStyle = '#2a2e37';
    ctx.beginPath();
    ctx.roundRect(s.x - 0.5, 0.98, 1.0, 0.3, 0.13);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(s.x - 0.4, 1.19, 0.72, 0.05);
    // hinterer Schlauch
    const pp = this.pouchPoint(g);
    this.band(ox, oy, Z, back.x, back.y, pp.x, pp.y);
  }

  private blade(x0: number, y0: number, x1: number, y1: number, color: string) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.22;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(x0 + (x1 - x0) * 0.05, y0 + (y1 - y0) * 0.7, x1, y1);
    ctx.stroke();
    // Ausfallende
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x1, y1, 0.14, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#9aa3b5';
    ctx.beginPath();
    ctx.arc(x1, y1, 0.05, 0, TAU);
    ctx.fill();
  }

  private drawSlingFront(g: AkkuGame, ox: number, oy: number, Z: number) {
    const ctx = this.ctx;
    const s = g.sling;
    const { front } = this.slingParts(g);
    const pp = this.pouchPoint(g);
    this.band(ox, oy, Z, front.x, front.y, pp.x, pp.y);
    // Ventil am Schlauch
    ctx.setTransform(Z, 0, 0, -Z, ox, oy);
    const vx = front.x + (pp.x - front.x) * 0.45;
    const vy = front.y + (pp.y - front.y) * 0.45;
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(vx - 0.03, vy - 0.02, 0.06, 0.14);
    ctx.fillStyle = '#e5484d';
    ctx.fillRect(vx - 0.035, vy + 0.1, 0.07, 0.06);
    // vordere Gabelscheide mit Glanz und Schriftzug
    this.blade(s.x + 0.28, 1.15, front.x, front.y, '#2a2e37');
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 0.05;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x + 0.36, 1.3);
    ctx.quadraticCurveTo(s.x + 0.38, 2.1, front.x + 0.05, front.y - 0.2);
    ctx.stroke();
    ctx.strokeStyle = g.team;
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.moveTo(s.x + 0.33, 1.55);
    ctx.lineTo(s.x + 0.36, 1.85);
    ctx.stroke();
  }

  // ---------------------------------------------------------------- Figuren

  private riderLook(mood: RiderMood, blink: boolean, pedal: number | null, standing: boolean, glasses: boolean, lookX: number, lookY: number, team: string) {
    return { mood, blink, pedal, standing, glasses, team, lookX, lookY, t: this.time };
  }

  private drawWaiting(g: AkkuGame, ox: number, oy: number, Z: number) {
    const ctx = this.ctx;
    const fly = g.shots.find((s) => !s.dead && s.hitAt < 0);
    for (const w of g.waiting) {
      const r = RIDERS[w.type].r;
      const s = WAIT_SCALE;
      // Schatten
      ctx.setTransform(Z, 0, 0, -Z, ox, oy);
      ctx.fillStyle = 'rgba(20,20,30,0.2)';
      ctx.beginPath();
      ctx.ellipse(w.x, 0.03, r * 0.75, r * 0.12, 0, 0, TAU);
      ctx.fill();
      const bob = w.hop >= 1 ? Math.sin(w.bob * 3) * 0.02 : 0;
      let lx = 1;
      let ly = 0.1;
      if (fly) {
        const dx = fly.body.x - w.x;
        const dy = fly.body.y - w.y;
        const d = Math.hypot(dx, dy) || 1;
        lx = dx / d;
        ly = dy / d;
      }
      this.place(ox, oy, Z, w.x, w.y + bob, 0, s);
      ctx.scale(1 + bob * 2, 1 - bob * 2);
      const mood: RiderMood = w.cheer > 0 || g.phase === 'won' ? 'cheer' : fly ? 'fly' : 'idle';
      drawRider(ctx, w.type, r, this.riderLook(mood, w.blink < 0, null, true, true, lx, ly, g.team));
    }
  }

  private drawLoaded(g: AkkuGame, ox: number, oy: number, Z: number) {
    const w = g.loaded;
    if (!w) return;
    const r = RIDERS[w.type].r;
    const inPouch = w.hop >= 1;
    const p = inPouch ? g.pouch() : { x: w.x, y: w.y };
    // im Flug zur Schleuder leicht nach vorn gedreht
    const a = inPouch ? 0 : Math.sin(Math.min(1, Math.max(0, w.hop)) * Math.PI) * 0.4;
    this.place(ox, oy, Z, p.x, p.y, a, inPouch ? 1 : WAIT_SCALE + (1 - WAIT_SCALE) * Math.max(0, w.hop));
    const mood: RiderMood = g.pull ? 'aim' : 'idle';
    drawRider(this.ctx, w.type, r, this.riderLook(mood, w.blink < 0, null, !inPouch, true, 1, 0.15, g.team));
  }

  private drawShots(g: AkkuGame, ox: number, oy: number, Z: number) {
    const ctx = this.ctx;
    const al = g.alpha;
    for (const s of g.shots) {
      if (s.dead) continue;
      const b = s.body;
      const x = b.px + (b.x - b.px) * al;
      const y = b.py + (b.y - b.py) * al;
      const a = b.pa + (b.a - b.pa) * al;
      let mood: RiderMood = 'fly';
      if (s.hitAt >= 0) mood = s.dizzy > 0 ? 'dizzy' : 'rest';
      else if (s.dash > 0) mood = 'dash';
      else if (s.dive) mood = 'dive';
      const sp = Math.hypot(b.vx, b.vy) || 1;
      // Bewegungsstreifen
      if (s.hitAt < 0 && sp > 8) {
        ctx.setTransform(Z, 0, 0, -Z, ox, oy);
        ctx.strokeStyle = s.dash > 0 ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 0.06;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (const k of [-0.5, 0, 0.5]) {
          const nx = -b.vy / sp;
          const ny = b.vx / sp;
          const sx = x + nx * k * s.r - (b.vx / sp) * s.r * 1.2;
          const sy = y + ny * k * s.r - (b.vy / sp) * s.r * 1.2;
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx - (b.vx / sp) * (0.5 + sp * 0.04), sy - (b.vy / sp) * (0.5 + sp * 0.04));
        }
        ctx.stroke();
      }
      // Zeitfahrer im Sturzflug: nach unten gedreht
      const rot = s.dive && s.hitAt < 0 ? -Math.PI / 2 + 0.3 : a;
      this.place(ox, oy, Z, x, y, rot);
      const sq = s.squash;
      if (sq > 0) ctx.scale(1 + sq * 0.22, 1 - sq * 0.22);
      if (s.dash > 0) ctx.scale(1.12, 0.9);
      // Fähigkeit noch frei: pulsierender Ring
      if (!s.used && !s.clone && (s.hitAt < 0 || s.type === 'gelb')) {
        const pulse = 0.5 + Math.sin(this.time * 9) * 0.5;
        ctx.strokeStyle = `rgba(255,255,255,${0.35 + pulse * 0.45})`;
        ctx.lineWidth = 0.06;
        ctx.beginPath();
        ctx.arc(0, 0, s.r * (1.28 + pulse * 0.12), 0, TAU);
        ctx.stroke();
      }
      const lx = b.vx / sp;
      const ly = b.vy / sp;
      drawRider(ctx, s.type, s.r, this.riderLook(mood, s.blink < 0, s.hitAt < 0 ? s.legs : null, false, s.glasses, s.hitAt < 0 ? lx : 1, s.hitAt < 0 ? ly : 0, g.team));
      // Sternchen über dem Kopf
      if (mood === 'dizzy') {
        this.place(ox, oy, Z, x, y + s.r * 1.25, 0);
        for (let i = 0; i < 3; i++) {
          const ang = this.time * 5 + (i * TAU) / 3;
          this.star(Math.cos(ang) * s.r * 0.75, Math.sin(ang) * s.r * 0.22, s.r * 0.17, i % 2 ? '#ffd23f' : '#ffffff');
        }
      }
    }
  }

  private star(x: number, y: number, r: number, color: string) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = r * 0.25;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const rr = i % 2 ? r * 0.45 : r;
      if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private drawGhosts(g: AkkuGame, ox: number, oy: number, Z: number) {
    for (const gh of g.ghosts) {
      this.place(ox, oy, Z, gh.x, gh.y, gh.rot, Math.max(0.3, 1 - gh.t * 0.2));
      drawRider(this.ctx, gh.type, RIDERS[gh.type].r, this.riderLook('cheer', false, gh.t * 20, false, false, 1, 0, g.team));
    }
  }

  private drawEnemies(g: AkkuGame, ox: number, oy: number, Z: number) {
    const ctx = this.ctx;
    const al = g.alpha;
    for (const e of g.enemies) {
      if (e.dead) continue;
      const b = e.body;
      const x = b.px + (b.x - b.px) * al;
      const y = b.py + (b.y - b.py) * al;
      const a = b.pa + (b.a - b.pa) * al;
      this.place(ox, oy, Z, x, y, a);
      const wob = e.wob > 0 ? Math.sin(this.time * 34) * e.wob * 0.09 : 0;
      const breathe = Math.sin(this.time * 2.2 + e.seed) * 0.015;
      ctx.scale(1 + wob, 1 - wob + breathe);
      const sipPhase = e.sip < 0 ? Math.sin(Math.min(1, -e.sip / 1.2) * Math.PI) : 0;
      drawEnemy(ctx, e.type, e.r, {
        mood: g.phase === 'won' ? 'scared' : e.mood,
        blink: e.blink < 0,
        lookX: e.lookX,
        lookY: e.lookY,
        sip: sipPhase,
        harm: 1 - Math.max(0, e.hp / e.maxHp),
        t: this.time,
      });
      if (e.flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${Math.min(0.6, e.flash * 4)})`;
        ctx.beginPath();
        ctx.arc(0, 0, e.r, 0, TAU);
        ctx.fill();
      }
    }
  }

  /** Akkuanzeigen über den Köpfen (immer aufrecht) */
  private drawBatteries(g: AkkuGame, ox: number, oy: number, Z: number) {
    const al = g.alpha;
    for (const e of g.enemies) {
      if (e.dead) continue;
      const b = e.body;
      const x = b.px + (b.x - b.px) * al;
      const y = b.py + (b.y - b.py) * al;
      const w = e.type === 'boss' ? 0.8 : 0.62;
      const bump = e.flash > 0 ? 1 + e.flash * 1.2 : 1;
      this.place(ox, oy, Z, x, y + e.r + 0.42, 0, bump);
      drawBattery(this.ctx, w, e.bat, e.flash);
    }
  }

  private spriteFor(b: Block) {
    const key = `${b.mat}:${b.w.toFixed(2)}:${b.h.toFixed(2)}:${b.stage}:${b.body.n}:${b.seed % 7}`;
    let sp = this.sprites.get(key);
    if (!sp) {
      const poly = b.body.n !== 4 || b.mat === 'roof' ? { x: b.body.lx, y: b.body.ly } : null;
      sp = blockSprite(b.mat, b.w, b.h, b.stage, poly, this.spriteScale, b.seed % 7 + 1, b.deco);
      this.sprites.set(key, sp);
    }
    return sp;
  }

  private drawBlocks(g: AkkuGame, ox: number, oy: number, Z: number) {
    const ctx = this.ctx;
    const al = g.alpha;
    const k = Z / this.spriteScale;
    for (const b of g.blocks) {
      if (b.dead) continue;
      const body = b.body;
      const x = body.px + (body.x - body.px) * al;
      const y = body.py + (body.y - body.py) * al;
      const a = body.pa + (body.a - body.pa) * al;
      const sp = this.spriteFor(b);
      const c = Math.cos(a);
      const s = Math.sin(a);
      ctx.setTransform(c * k, -s * k, s * k, c * k, ox + x * Z, oy - y * Z);
      ctx.drawImage(sp.canvas, -sp.ox, -sp.oy);
      if (b.flash > 0) {
        ctx.globalAlpha = Math.min(0.5, b.flash * 3);
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(sp.canvas, -sp.ox, -sp.oy);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      if (b.deco) this.drawDeco(b, ox, oy, Z, x, y, a);
      if (b.mat === 'akku' && b.stage > 0 && Math.random() < 0.08) {
        g.particles.spawn(P.Spark, x + (Math.random() - 0.5) * b.w * 0.6, y + b.h * 0.4, (Math.random() - 0.5) * 3, 2 + Math.random() * 2, 0.25, 0.05, '#7ff0ff', 6, 2);
      }
    }
  }

  private drawDeco(b: Block, ox: number, oy: number, Z: number, x: number, y: number, a: number) {
    const ctx = this.ctx;
    this.place(ox, oy, Z, x, y, a);
    if (b.deco === 'sign') {
      // Schild „Ladestation“ auf dem Dach
      const w = Math.min(1.7, b.w * 0.8);
      ctx.fillStyle = '#5a6170';
      ctx.fillRect(-w * 0.35, -b.h / 2 - 0.3, 0.06, 0.32);
      ctx.fillRect(w * 0.3, -b.h / 2 - 0.3, 0.06, 0.32);
      ctx.fillStyle = '#2c313b';
      ctx.beginPath();
      ctx.roundRect(-w / 2, -b.h / 2 - 0.72, w, 0.46, 0.08);
      ctx.fill();
      ctx.fillStyle = '#5be37d';
      ctx.scale(1 / Z, 1 / Z);
      ctx.font = `800 ${(0.25 * Z).toFixed(1)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚡ LADEN', 0, (-b.h / 2 - 0.49) * Z);
    } else if (b.deco === 'flag') {
      // Fahne auf dem Dachfirst (Bergtrikot)
      const lx = Math.max(...b.body.lx);
      const ty = -Math.max(...b.body.ly);
      ctx.fillStyle = '#6b4a2e';
      ctx.fillRect(lx - 0.05, ty - 1.0, 0.07, 1.02);
      const wave = Math.sin(this.time * 6) * 0.06;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(lx + 0.02, ty - 1.0);
      ctx.quadraticCurveTo(lx + 0.35, ty - 1.0 + wave, lx + 0.7, ty - 0.92 - wave);
      ctx.lineTo(lx + 0.7, ty - 0.55 - wave);
      ctx.quadraticCurveTo(lx + 0.35, ty - 0.62 + wave, lx + 0.02, ty - 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e5484d';
      for (const [dx, dy] of [[0.18, -0.85], [0.45, -0.78], [0.3, -0.7], [0.58, -0.68]]) {
        ctx.beginPath();
        ctx.arc(lx + dx, ty + dy, 0.045, 0, TAU);
        ctx.fill();
      }
    } else if (b.deco === 'chimney') {
      // Kamin mit Rauch
      const cx = -0.4;
      ctx.fillStyle = '#9d968a';
      ctx.fillRect(cx - 0.15, -0.95, 0.3, 0.6);
      ctx.fillStyle = '#7c766b';
      ctx.fillRect(cx - 0.19, -1.0, 0.38, 0.1);
      if (Math.random() < 0.06) {
        const c = Math.cos(a);
        const s = Math.sin(a);
        const wx = x + c * cx - s * 1.0;
        const wy = y + s * cx + c * 1.0;
        this.smoke.push([wx, wy]);
      }
    } else if (b.deco === 'menu') {
      // Zettel „Kuchen“ an der Scheibe
      ctx.fillStyle = '#fffaf0';
      ctx.fillRect(-0.12, -0.25, 0.24, 0.32);
      ctx.fillStyle = '#e5484d';
      ctx.fillRect(-0.08, -0.18, 0.16, 0.05);
      ctx.fillStyle = '#5a3220';
      ctx.fillRect(-0.08, -0.08, 0.16, 0.03);
      ctx.fillRect(-0.08, -0.02, 0.12, 0.03);
    }
  }

  /** Rauchwolken aus dem Kamin (werden beim nächsten Partikelschritt erzeugt) */
  private smoke: [number, number][] = [];

  private drawBottles(g: AkkuGame, ox: number, oy: number, Z: number) {
    const ctx = this.ctx;
    const al = g.alpha;
    for (const bt of g.bottles) {
      if (bt.dead) continue;
      const b = bt.body;
      this.place(ox, oy, Z, b.px + (b.x - b.px) * al, b.py + (b.y - b.py) * al, b.pa + (b.a - b.pa) * al);
      ctx.fillStyle = '#eef8ff';
      ctx.beginPath();
      ctx.roundRect(-0.12, -0.22, 0.24, 0.46, 0.07);
      ctx.fill();
      ctx.lineWidth = 0.035;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.fillStyle = '#3aa8ff';
      ctx.fillRect(-0.12, -0.02, 0.24, 0.1);
      ctx.fillStyle = INK;
      ctx.fillRect(-0.05, -0.3, 0.1, 0.09);
    }
  }

  // ---------------------------------------------------------------- Spur, Zielhilfe, Partikel

  private drawTrail(trail: number[], ox: number, oy: number, Z: number, alpha: number) {
    if (!trail.length) return;
    const ctx = this.ctx;
    ctx.setTransform(Z, 0, 0, -Z, ox, oy);
    ctx.fillStyle = `rgba(255,255,255,${0.75 * alpha})`;
    for (let i = 0; i < trail.length; i += 3) {
      ctx.beginPath();
      ctx.arc(trail[i], trail[i + 1], 0.07 * trail[i + 2] + 0.03, 0, TAU);
      ctx.fill();
    }
  }

  private drawAim(g: AkkuGame, ox: number, oy: number, Z: number) {
    const p = g.pull;
    if (!p || !g.loaded) return;
    const len = Math.hypot(p.x, p.y);
    if (len < 0.15) return;
    const { vx, vy } = g.launchVelocity(p.x, p.y);
    const s = g.sling;
    const ctx = this.ctx;
    ctx.setTransform(Z, 0, 0, -Z, ox, oy);
    let x = s.x + p.x;
    let y = s.y + p.y;
    const dt = 0.055;
    let t = 0;
    const steps = 16;
    const power = Math.min(1, len / MAX_PULL);
    for (let i = 0; i < steps; i++) {
      t += dt;
      const px = s.x + p.x + vx * t;
      const py = s.y + p.y + vy * t - 0.5 * GRAVITY * t * t;
      if (py < g.floorAt(px)) break;
      x = px;
      y = py;
      if (i < 1) continue;
      const k = 1 - i / steps;
      ctx.fillStyle = `rgba(255,255,255,${0.35 + k * 0.6})`;
      ctx.strokeStyle = 'rgba(27,29,36,0.55)';
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      ctx.arc(x, y, 0.05 + k * 0.08 * (0.6 + power * 0.4), 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawParticles(g: AkkuGame, ox: number, oy: number, Z: number) {
    // Kaminrauch nachreichen
    for (const [x, y] of this.smoke) g.particles.spawn(P.Smoke, x, y, 0.3 + Math.random() * 0.3, 0.8 + Math.random() * 0.4, 2.4, 0.18 + Math.random() * 0.1, 'rgba(235,235,240,1)', -0.15, 0.3);
    this.smoke.length = 0;
    const ctx = this.ctx;
    const pt = g.particles;
    ctx.setTransform(Z, 0, 0, -Z, ox, oy);
    for (let i = 0; i < pt.count; i++) {
      const life = pt.life[i] / pt.max[i];
      const x = pt.x[i];
      const y = pt.y[i];
      const s = pt.size[i];
      const type = pt.type[i];
      ctx.fillStyle = pt.color[i];
      switch (type) {
        case P.Puff:
        case P.Smoke: {
          const grow = type === P.Smoke ? 1 + (1 - life) * 2.2 : 1 + (1 - life) * 1.3;
          ctx.globalAlpha = type === P.Smoke ? Math.min(0.55, life * 0.7) : Math.min(0.85, life * 1.3);
          ctx.beginPath();
          ctx.arc(x, y, s * grow, 0, TAU);
          ctx.fill();
          break;
        }
        case P.Chip:
        case P.Confetti: {
          const r = pt.rot[i];
          const c = Math.cos(r);
          const n = Math.sin(r);
          const w = s;
          const h = type === P.Confetti ? s * 0.6 * Math.abs(Math.cos(r * 1.7)) + s * 0.08 : s * 0.55;
          ctx.globalAlpha = Math.min(1, life * 3);
          ctx.beginPath();
          ctx.moveTo(x + c * w - n * h, y + n * w + c * h);
          ctx.lineTo(x - c * w - n * h, y - n * w + c * h);
          ctx.lineTo(x - c * w + n * h, y - n * w - c * h);
          ctx.lineTo(x + c * w + n * h, y + n * w - c * h);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case P.Shard: {
          const r = pt.rot[i];
          ctx.globalAlpha = Math.min(0.9, life * 3);
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(r) * s, y + Math.sin(r) * s);
          ctx.lineTo(x + Math.cos(r + 2.3) * s * 0.7, y + Math.sin(r + 2.3) * s * 0.7);
          ctx.lineTo(x + Math.cos(r + 4.1) * s * 0.5, y + Math.sin(r + 4.1) * s * 0.5);
          ctx.closePath();
          ctx.fill();
          if (Math.sin(this.time * 20 + i) > 0.7) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(x - s * 0.15, y - s * 0.15, s * 0.3, s * 0.3);
          }
          break;
        }
        case P.Spark: {
          ctx.globalAlpha = Math.min(1, life * 2);
          ctx.strokeStyle = pt.color[i];
          ctx.lineWidth = s;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - pt.vx[i] * 0.04, y - pt.vy[i] * 0.04);
          ctx.stroke();
          break;
        }
        case P.Bolt: {
          ctx.globalAlpha = Math.min(1, life * 2.5);
          ctx.strokeStyle = pt.color[i];
          ctx.lineWidth = 0.08;
          ctx.lineJoin = 'miter';
          const a = pt.rot[i];
          const c = Math.cos(a);
          const n = Math.sin(a);
          ctx.beginPath();
          ctx.moveTo(x, y);
          const seg = s / 4;
          for (let k = 1; k <= 4; k++) {
            const off = (k % 2 ? 1 : -1) * 0.12;
            ctx.lineTo(x + c * seg * k - n * off, y + n * seg * k + c * off);
          }
          ctx.stroke();
          break;
        }
        case P.Ring: {
          const k = 1 - life;
          ctx.globalAlpha = life * 0.9;
          ctx.strokeStyle = pt.color[i];
          ctx.lineWidth = 0.18 * life + 0.03;
          ctx.beginPath();
          ctx.arc(x, y, s * (0.2 + k * 0.9), 0, TAU);
          ctx.stroke();
          break;
        }
        default: {
          // Tropfen, Schaum, Sahne, Stern
          ctx.globalAlpha = Math.min(1, life * 3);
          ctx.beginPath();
          ctx.arc(x, y, s, 0, TAU);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- Punkte und Hinweise

  private drawPopups(g: AkkuGame, ox: number, oy: number, Z: number) {
    const ctx = this.ctx;
    for (const p of g.popups) {
      const k = p.t / p.life;
      const sx = ox + p.x * Z;
      const sy = oy - (p.y + k * 0.9) * Z;
      const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.55 : k < 0.25 ? 1.15 - ((k - 0.15) / 0.1) * 0.15 : 1;
      const alpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      ctx.globalAlpha = Math.max(0, alpha);
      if (p.kind === 'battery') {
        // leerer Akku blinkt
        ctx.setTransform(Z * pop, 0, 0, Z * pop, sx, sy);
        const blink = Math.floor(p.t * 8) % 2 === 0;
        drawBattery(ctx, 0.9, 0, blink ? 1 : 0, true);
        ctx.globalAlpha = 1;
        continue;
      }
      const base = p.kind === 'small' ? Math.max(11 * this.dpr, Z * 0.5) : Math.min(34 * this.dpr, Math.max(15 * this.dpr, Z * 0.62));
      const px = Math.round(base * p.size * (p.kind === 'small' ? 1.6 : 1) * pop);
      ctx.setTransform(1, 0, 0, 1, sx, sy);
      ctx.rotate(-0.06);
      ctx.font = `italic 900 ${px}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = px * 0.22;
      ctx.strokeStyle = INK;
      ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
    }
    ctx.globalAlpha = 1;
  }

  private drawHints(g: AkkuGame, ox: number, oy: number, Z: number) {
    const ctx = this.ctx;
    const w = g.loaded;
    if (g.phase !== 'aim' || !w || w.hop < 1) return;
    const s = g.sling;
    const info = RIDERS[w.type];
    // Fähigkeit als kleines Schild über der Schleuder
    const label = `${info.ability}`;
    const sx = ox + (s.x + 0.15) * Z;
    const sy = oy - (s.y + info.r + 1.05) * Z;
    const fs = Math.round(13 * this.dpr);
    ctx.setTransform(1, 0, 0, 1, sx, sy);
    ctx.font = `800 ${fs}px ${FONT}`;
    const tw = ctx.measureText(label).width;
    const pw = tw + fs * 2.2;
    const ph = fs * 1.75;
    const appear = Math.min(1, this.aimIdle * 4);
    ctx.globalAlpha = appear * (g.pull ? 0.35 : 1);
    ctx.fillStyle = 'rgba(16,18,24,0.78)';
    ctx.beginPath();
    ctx.roundRect(-pw / 2, -ph / 2, pw, ph, ph / 2);
    ctx.fill();
    // Tipp-Symbol
    const ix = -pw / 2 + fs * 0.95;
    const pulse = (this.time * 1.6) % 1;
    ctx.strokeStyle = `rgba(255,255,255,${1 - pulse})`;
    ctx.lineWidth = Math.max(1, fs * 0.1);
    ctx.beginPath();
    ctx.arc(ix, 0, fs * (0.25 + pulse * 0.35), 0, TAU);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ix, 0, fs * 0.2, 0, TAU);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, ix + fs * 0.6, fs * 0.05);
    ctx.globalAlpha = 1;

    // Finger zeigt das Zurückziehen (bis zum ersten Schuss)
    if (g.hints && g.launches === 0 && !g.pull && this.aimIdle > 0.8) {
      const cyc = ((this.aimIdle - 0.8) % 2.2) / 2.2;
      const m = cyc < 0.15 ? 0 : cyc < 0.65 ? (cyc - 0.15) / 0.5 : 1;
      const e = m * m * (3 - 2 * m);
      const fade = cyc < 0.1 ? cyc / 0.1 : cyc > 0.85 ? (1 - cyc) / 0.15 : 1;
      const fx = s.x - e * 1.5;
      const fy = s.y - e * 0.75;
      ctx.setTransform(Z, 0, 0, -Z, ox, oy);
      ctx.globalAlpha = fade * 0.9;
      // Pfeil der Bewegung
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 0.06;
      ctx.setLineDash([0.12, 0.12]);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(fx, fy);
      ctx.stroke();
      ctx.setLineDash([]);
      // Finger
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.arc(fx, fy, 0.24, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(fx, fy, 0.36 + Math.sin(this.time * 6) * 0.04, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /** E-Biker außerhalb des Bildes: kleiner Akku am Rand */
  private drawOffscreen(g: AkkuGame, ox: number, oy: number, Z: number) {
    if (!this.pans) return;
    const W = this.canvas.width;
    const ctx = this.ctx;
    for (const e of g.enemies) {
      if (e.dead) continue;
      const sx = ox + e.body.x * Z;
      const sy = oy - e.body.y * Z;
      if (sx < W + e.r * Z * 0.5) continue;
      const ix = W - Z * 0.75;
      ctx.setTransform(Z * 0.85, 0, 0, Z * 0.85, ix, sy);
      ctx.globalAlpha = 0.9;
      drawBattery(ctx, 0.7, e.bat, 0);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0.48, -0.16);
      ctx.lineTo(0.66, 0);
      ctx.lineTo(0.48, 0.16);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

export type { Enemy };
