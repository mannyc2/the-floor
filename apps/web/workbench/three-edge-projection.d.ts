// The pinned package has no declarations. These signatures cover only the
// generator and result fields verified against its installed JavaScript source.
declare module "three-edge-projection/src/ProjectionGenerator.js" {
  import type { BufferGeometry, Object3D } from "three";
  export interface ProjectionResult {
    readonly visibleEdges: { readonly getLineGeometry: () => BufferGeometry };
    readonly hiddenEdges: { readonly getLineGeometry: () => BufferGeometry };
  }
  export class ProjectionGenerator {
    angleThreshold: number;
    includeIntersectionEdges: boolean;
    generate(scene: Object3D): Generator<unknown, ProjectionResult>;
  }
}
