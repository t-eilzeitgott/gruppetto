/**
 * Sonnenuntergangs-Licht (wie in der WebGPU-Abfahrt, gpu/atmo.ts): warmer Schein um die tiefe Sonne, ein feiner
 * waagrechter Lichtstreif durch sie und ein Hauch Wärme im ganzen Bild.
 *
 * Ohne eigene Nachbearbeitung: ein Dreieck über den ganzen Schirm, als Letztes gezeichnet. „Screen“-Überblendung
 * (Quelle · (1 − Ziel)): helle Stellen bekommen weniger dazu; die Blendfarbe legt zugleich einen leichten
 * Wärmefilter über das Bild – ein Durchgang, keine Bildkopie, ein paar Rechnungen je Bildpunkt.
 */
import * as THREE from 'three';

export class SunsetGlow {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private v = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private k = 0;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: new THREE.Vector2(0.5, 2) }, uAspect: { value: 1 }, uK: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec2 uSun;
        uniform float uAspect;
        uniform float uK;
        varying vec2 vUv;
        void main() {
          vec2 dd = (vUv - uSun) * vec2(uAspect, 1.0);
          float r = length(dd);
          float halo = exp(-r * 2.4) * 0.35 + exp(-r * 9.0) * 0.3;
          float streak = exp(-abs(dd.y) * 46.0) * exp(-abs(dd.x) * 1.4) * 0.22;
          gl_FragColor = vec4(vec3(1.0, 0.6, 0.3) * (halo + streak) * uK * 0.2 + vec3(0.012, 0.004, 0.0) * uK, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneMinusDstColorFactor,
      blendDst: THREE.ConstantColorFactor,
    });
    this.mat.blendColor = new THREE.Color(1, 1, 1);
    this.mat.name = 'sunset';
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1e6;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.userData.noShadow = true;
    this.mesh.visible = false;
  }

  /**
   * je Bild: Sonne ins Bild rechnen, Stärke nach Blickrichtung (zur Sonne hin kräftiger); on: Abfahrt am Abend
   * (sonst aus), dim: 0 … 1 (Tunnel). dt ≤ 0: sofort.
   */
  update(cam: THREE.PerspectiveCamera, sunDir: THREE.Vector3, on: boolean, dim: number, dt: number) {
    cam.getWorldDirection(this.fwd);
    const facing = this.fwd.dot(sunDir);
    const vis = Math.max(0, Math.min(1, (facing + 0.15) / 0.6));
    const want = on ? (1 - dim) * (0.35 + 0.65 * vis) : 0;
    this.k = dt <= 0 ? want : this.k + (want - this.k) * Math.min(1, dt * 5);
    if (!on && this.k < 0.002) this.k = 0;
    this.mesh.visible = this.k > 0.002;
    if (!this.mesh.visible) return;
    this.v.copy(cam.position).addScaledVector(sunDir, 1000).project(cam);
    // hinter der Kamera: Richtung beibehalten, weit aus dem Bild schieben
    if (facing < 0) this.v.multiplyScalar(-4);
    const u = this.mat.uniforms;
    (u.uSun.value as THREE.Vector2).set(this.v.x * 0.5 + 0.5, this.v.y * 0.5 + 0.5);
    u.uAspect.value = cam.aspect;
    u.uK.value = this.k;
    // Hauch Wärme: Grün und Blau etwas zurück (die Blendfarbe kann nicht über 1)
    const t = this.k * 0.7;
    this.mat.blendColor.setRGB(1, 1 - 0.035 * t, 1 - 0.085 * t);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
