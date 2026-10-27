/**
 * Radgarage in 3D: ein Rad auf der Drehscheibe im Studiolicht (Wischen dreht, sonst dreht es sich
 * langsam von selbst) und Vorschaubilder aller Räder (eins pro Bild, damit nichts ruckelt).
 * Ein einziger WebGL-Kontext; beim Verlassen wird er sofort freigegeben.
 */
import * as THREE from 'three';
import './grade';
import { BIKE_BB, bikeBuild, releaseBikes } from './bike3d';
import { glossMat, setGlossEnv } from './gloss';
import { pedalBuild } from './gear3d';
import type { Kit } from './rider';

/** Rad als Objekt (volle Detailstufe, mit Pedalen) */
export function bikeObject(id: string, kit: Kit): THREE.Group {
  const b = bikeBuild(id, kit, 1);
  const g = new THREE.Group();
  const mat = glossMat();
  g.add(new THREE.Mesh(b.frame, mat));
  const wf = new THREE.Mesh(b.wheelF, mat);
  wf.position.copy(b.fit.front);
  const wr = new THREE.Mesh(b.wheelR, mat);
  wr.position.copy(b.fit.rear);
  if (b.spokes.f) wf.add(new THREE.Mesh(b.spokes.f, mat));
  if (b.spokes.r) wr.add(new THREE.Mesh(b.spokes.r, mat));
  const cr = new THREE.Mesh(b.crank, mat);
  cr.position.copy(b.fit.bb ?? BIKE_BB);
  // Pedale waagrecht an den Kurbelenden (Kurbel in Ruhelage: rechts oben, links unten)
  const ped = pedalBuild(b.spec.pedals);
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(ped, mat);
    p.position.set(sx * (b.fit.pedalX ?? 0.128), sx * (b.fit.crank ?? 0.17), 0);
    // bleiben waagrecht, auch wenn die Kurbel gedreht ist
    p.rotation.x = 0.55;
    cr.add(p);
  }
  // Kurbel leicht gedreht, damit beide Pedale gut zu sehen sind
  cr.rotation.x = -0.55;
  g.add(wf, wr, cr);
  if (b.decal) {
    g.add(new THREE.Mesh(b.decal.frame, b.decal.mat));
    if (b.decal.rimF) wf.add(new THREE.Mesh(b.decal.rimF, b.decal.rimMat));
    if (b.decal.rimR) wr.add(new THREE.Mesh(b.decal.rimR, b.decal.rimMat));
  }
  if (b.trailer) {
    // Wohnwagen gerade hinter dem Rad
    const t = new THREE.Group();
    t.position.copy(b.trailer.hitch);
    t.add(new THREE.Mesh(b.trailer.body, mat));
    for (const p of b.trailer.wheels) {
      const w = new THREE.Mesh(b.trailer.wheel, mat);
      w.position.copy(p);
      t.add(w);
    }
    if (b.trailer.plate) t.add(new THREE.Mesh(b.trailer.plate.geo, b.trailer.plate.mat));
    g.add(t);
  }
  // um die Mitte der Länge drehen (Lastenrad und Gespann sind länger)
  const box = new THREE.Box3().setFromObject(g);
  g.position.set(0, 0, -(box.min.z + box.max.z) / 2);
  const holder = new THREE.Group();
  holder.add(g);
  // halbe Länge und Höhe (für den Bildausschnitt; das Hochrad ist höher)
  holder.userData.half = Math.max(0.9, (box.max.z - box.min.z) / 2);
  holder.userData.top = box.max.y;
  return holder;
}

function shadowTex(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 128;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(128, 64, 4, 128, 64, 124);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 256, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class GarageView {
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(26, 1, 0.05, 50);
  private turn = new THREE.Group();
  private bike: THREE.Object3D | null = null;
  private bikeId = '';
  private raf = 0;
  private last = 0;
  private angle = -Math.PI / 2 + 0.5;
  private vel = 0;
  private dragging = false;
  private idle = 0;
  private thumbQueue: { id: string; kit: Kit; w: number; h: number; done: (url: string) => void }[] = [];
  private thumbCv = document.createElement('canvas');
  private disposed = false;
  /** Zoom-Anteil (0 = ganzes Rad) */
  private zoom = 0;
  /** halbe Länge des Rads (Gespann länger) – Kamera weiter weg */
  private half = 0.9;
  /** Höhe über das übliche Maß hinaus (Hochrad) – Kamera weiter weg und etwas höher */
  private tall = 0;
  private shadow: THREE.Mesh;

  constructor(private canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', stencil: false });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.CustomToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.gl.setClearColor(0x000000, 0);
    this.gl.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    setGlossEnv(1);
    // Studiolicht: Himmel/Boden, warmes Hauptlicht vorn rechts, kühles Kantenlicht von hinten
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.05);
    hemi.color.setRGB(0.78, 0.84, 1, THREE.SRGBColorSpace);
    hemi.groundColor.setRGB(0.42, 0.4, 0.38, THREE.SRGBColorSpace);
    const key = new THREE.DirectionalLight(0xfff0dc, 2.3);
    key.position.set(2.6, 3.6, 2.2);
    const rim = new THREE.DirectionalLight(0xbcd4ff, 1.15);
    rim.position.set(-2.8, 2.2, -2.6);
    const fill = new THREE.DirectionalLight(0xffffff, 0.45);
    fill.position.set(-1.5, 0.6, 3);
    this.scene.add(hemi, key, rim, fill, this.turn);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.0), new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.rotation.z = Math.PI / 2;
    shadow.position.y = 0.002;
    this.shadow = shadow;
    this.turn.add(shadow);
    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    this.resize();
  }

  /** wird der Kontext entzogen, meldet der Aufrufer neu an */
  get lost(): boolean { return this.gl.getContext().isContextLost(); }

  setBike(id: string, kit: Kit) {
    if (this.disposed || id === this.bikeId) return;
    this.bikeId = id;
    if (this.bike) this.turn.remove(this.bike);
    this.bike = bikeObject(id, kit);
    this.turn.add(this.bike);
    this.half = this.bike.userData.half ?? 0.9;
    this.tall = Math.max(0, (this.bike.userData.top ?? 1.1) - 1.2);
    this.shadow.scale.set(this.half / 0.9, 1, 1);
    // kleiner Schwung beim Wechsel
    this.vel = Math.max(this.vel, 1.6);
    this.idle = 0;
  }

  /** Vorschaubild (Seitenansicht) – wird im nächsten freien Bild gerendert */
  thumb(id: string, kit: Kit, w: number, h: number, done: (url: string) => void) {
    this.thumbQueue.push({ id, kit, w, h, done });
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this.raf || this.disposed) return;
    this.last = performance.now();
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame(dt: number) {
    if (this.gl.getContext().isContextLost()) return;
    // Drehung: beim Ziehen direkt, danach mit Schwung, in Ruhe langsam von selbst
    if (!this.dragging) {
      this.idle += dt;
      const auto = this.idle > 1.2 ? 0.32 : 0;
      this.vel += (auto - this.vel) * Math.min(1, dt * 1.6);
      this.angle += this.vel * dt;
    }
    this.turn.rotation.y = this.angle;
    // Kamera: das ganze Rad in jeder Drehung im Bild
    const vf = (this.camera.fov * Math.PI) / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    // unten liegt das Namensschild: Rad etwas nach oben ins Bild rücken
    const k = this.half / 0.9;
    const dist = Math.max((0.96 * k) / Math.tan(hf / 2), (0.78 * Math.min(1.25, k) + this.tall * 0.9) / Math.tan(vf / 2)) * (1 - this.zoom * 0.35) + 0.3;
    this.camera.position.set(0, 0.5 + dist * 0.2 + this.tall * 0.5, dist);
    this.camera.lookAt(0, 0.3 + this.tall * 0.55, 0);
    // Vorschaubilder: eins pro Bild
    const job = this.thumbQueue.shift();
    if (job) this.renderThumb(job);
    this.gl.setViewport(0, 0, this.gl.domElement.width / this.gl.getPixelRatio(), this.gl.domElement.height / this.gl.getPixelRatio());
    this.gl.setScissorTest(false);
    this.gl.render(this.scene, this.camera);
  }

  private thumbCam = new THREE.PerspectiveCamera(22, 1.6, 0.05, 50);
  private renderThumb(job: { id: string; kit: Kit; w: number; h: number; done: (url: string) => void }) {
    const prevBike = this.bike;
    const prevRot = this.turn.rotation.y;
    if (prevBike) prevBike.visible = false;
    const obj = bikeObject(job.id, job.kit);
    this.turn.add(obj);
    const k = (obj.userData.half ?? 0.9) / 0.9;
    // senkrecht vom Boden bis über die höchste Stelle (Hochrad, Rückenlehne, Wimpel, Zeitung auf der Posttasche)
    const top: number = obj.userData.top ?? 0.97;
    const cy = Math.max(0.5, top / 2 + 0.02);
    const vHalf = Math.max(0.56 * Math.min(1.3, k), top / 2 + 0.06);
    // Seitenansicht: Antriebsseite, Vorderrad rechts, leicht schräg
    this.turn.rotation.y = -Math.PI / 2 + 0.22;
    const pr = this.gl.getPixelRatio();
    const W = this.gl.domElement.width;
    const H = this.gl.domElement.height;
    const w = Math.min(job.w, W);
    const h = Math.min(job.h, H);
    this.thumbCam.aspect = w / h;
    this.thumbCam.fov = 22;
    this.thumbCam.updateProjectionMatrix();
    const vf = (22 * Math.PI) / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * this.thumbCam.aspect);
    const dist = Math.max((0.92 * k) / Math.tan(hf / 2), vHalf / Math.tan(vf / 2)) + 0.25;
    this.thumbCam.position.set(0, cy + 0.05 + dist * 0.1, dist);
    this.thumbCam.lookAt(0, cy, 0);
    // in die linke obere Ecke zeichnen und sofort herauskopieren
    this.gl.setScissorTest(true);
    this.gl.setScissor(0, (H - h) / pr, w / pr, h / pr);
    this.gl.setViewport(0, (H - h) / pr, w / pr, h / pr);
    this.gl.clear();
    this.gl.render(this.scene, this.thumbCam);
    this.thumbCv.width = w;
    this.thumbCv.height = h;
    const c = this.thumbCv.getContext('2d')!;
    c.clearRect(0, 0, w, h);
    c.drawImage(this.gl.domElement, 0, 0, w, h, 0, 0, w, h);
    let url = '';
    try { url = this.thumbCv.toDataURL('image/png'); } catch { url = ''; }
    this.turn.remove(obj);
    if (prevBike) prevBike.visible = true;
    this.turn.rotation.y = prevRot;
    this.gl.setScissorTest(false);
    job.done(url);
  }

  private px = 0;
  private onDown = (e: PointerEvent) => {
    this.dragging = true;
    this.px = e.clientX;
    this.vel = 0;
  };
  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.px;
    this.px = e.clientX;
    const w = this.canvas.getBoundingClientRect().width || 300;
    const d = (dx / w) * Math.PI * 1.6;
    this.angle += d;
    this.vel = d * 60;
    this.idle = 0;
  };
  private onUp = () => {
    if (!this.dragging) return;
    this.dragging = false;
    this.vel = Math.max(-6, Math.min(6, this.vel));
  };

  /** keep: Rad, das im Speicher bleiben soll (das gewählte) */
  dispose(keep?: string) {
    this.disposed = true;
    this.stop();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.gl.dispose();
    this.gl.forceContextLoss();
    // große Geometrien der Garage freigeben (das eigene Rad bleibt für das Spiel im Speicher)
    releaseBikes(keep);
  }
}
