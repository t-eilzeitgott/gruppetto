import type { Node, UniformNode } from 'three/webgpu';

/** Bloom (three.js examples/jsm/tsl/display/BloomNode.js) */
export type BloomNode = Node<'vec4'> & {
  strength: UniformNode<'float', number>;
  radius: UniformNode<'float', number>;
  threshold: UniformNode<'float', number>;
  smoothWidth: UniformNode<'float', number>;
  setSize(width: number, height: number): void;
  dispose(): void;
};
export function bloom(node: Node, strength?: number, radius?: number, threshold?: number): BloomNode;
