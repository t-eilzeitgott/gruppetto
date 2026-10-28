import { Mesh, Vector3 } from 'three/webgpu';
import type { UniformNode } from 'three/webgpu';

/** Himmel nach Preetham mit Wolken (three.js examples/jsm/objects/SkyMesh.js) */
export class SkyMesh extends Mesh {
  turbidity: UniformNode<'float', number>;
  rayleigh: UniformNode<'float', number>;
  mieCoefficient: UniformNode<'float', number>;
  mieDirectionalG: UniformNode<'float', number>;
  sunPosition: UniformNode<'vec3', Vector3>;
  cloudScale: UniformNode<'float', number>;
  cloudSpeed: UniformNode<'float', number>;
  cloudCoverage: UniformNode<'float', number>;
  cloudDensity: UniformNode<'float', number>;
  cloudElevation: UniformNode<'float', number>;
  showSunDisc: UniformNode<'float', number>;
  readonly isSky: true;
  constructor();
}
