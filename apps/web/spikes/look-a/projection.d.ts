declare module 'three-edge-projection' {
  import type { BufferGeometry, Object3D } from 'three';
  export interface ProjectionResult { visibleEdges:{getLineGeometry():BufferGeometry};hiddenEdges:{getLineGeometry():BufferGeometry} }
  export class ProjectionGenerator { angleThreshold:number;includeIntersectionEdges:boolean;generate(scene:Object3D):Generator<unknown,ProjectionResult>; }
}
