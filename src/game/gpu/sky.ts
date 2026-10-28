/**
 * Himmel und Licht für den WebGPU-Test: physikalischer Himmel (Preetham, mit Wolken) einmal in eine Würfeltextur
 * gerendert – als Hintergrund (ein Texturzugriff je Bildpunkt statt Wolkenrauschen) und, vorgefiltert, als
 * Umgebungslicht für alle Materialien. Dazu die Sonne als gerichtetes Licht mit Schatten.
 */
import * as THREE from 'three/webgpu';
import { SkyMesh } from '../../../vendor/three/addons/SkyMesh.js';

export interface SkySetup {
  sunDir: THREE.Vector3;
  sun: THREE.DirectionalLight;
  /** Farbe am Horizont (für den Dunst) */
  horizon: THREE.Color;
  /** Farbe des Dunsts zur Sonne hin */
  haze: THREE.Color;
  background: THREE.Texture;
  environment: THREE.Texture;
  dispose(): void;
}

/** elev, azim in Grad: Sonne 0° = Horizont, Azimut 0° = Norden (−z), im Uhrzeigersinn */
export async function buildSky(renderer: THREE.WebGPURenderer, elev = 24, azim = 215, size = 512, cube = true, env = true): Promise<SkySetup> {
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(azim));
  const sky = new SkyMesh();
  sky.scale.setScalar(4000);
  sky.turbidity.value = 2.4;
  sky.rayleigh.value = 1.35;
  sky.mieCoefficient.value = 0.0032;
  sky.mieDirectionalG.value = 0.78;
  sky.sunPosition.value.copy(sunDir);
  sky.cloudCoverage.value = 0.32;
  sky.cloudDensity.value = 0.5;
  sky.cloudElevation.value = 0.55;
  sky.cloudScale.value = 0.00022;
  const skyScene = new THREE.Scene();
  skyScene.add(sky);

  // Hintergrund: Würfel ohne Sonnenscheibe (die zeichnet showcase als eigenes, weiches Glühen – im Würfel wäre
  // sie ein pixeliges Quadrat)
  sky.showSunDisc.value = 0;
  const cubeRT = new THREE.CubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cubeCam = new THREE.CubeCamera(1, 10000, cubeRT);
  skyScene.add(cubeCam);
  if (cube) (cubeCam as unknown as { update(r: unknown, s: unknown): void }).update(renderer, skyScene);

  // Umgebungslicht, vorgefiltert
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = env ? pmrem.fromScene(skyScene as unknown as THREE.Scene, 0, 1, 10000) : new THREE.RenderTarget(1, 1);
  sky.showSunDisc.value = 1;
  pmrem.dispose();

  const sun = new THREE.DirectionalLight(0xfff1dc, 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 3;
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  // weit nach hinten: mit umgekehrter Tiefe galt alles hinter der fernen Ebene als verschattet (Täler schwarz)
  sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 6000;

  sky.geometry.dispose();
  (sky.material as THREE.Material).dispose();
  return {
    sunDir,
    sun,
    horizon: new THREE.Color(0.62, 0.72, 0.86),
    haze: new THREE.Color(1.0, 0.86, 0.68),
    background: cubeRT.texture,
    environment: envRT.texture,
    dispose() { cubeRT.dispose(); envRT.dispose(); sun.dispose(); },
  };
}
