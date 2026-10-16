import * as THREE from "three";
import type { Engine } from "./renderer-probe";

type Attribute = THREE.BufferAttribute | THREE.InterleavedBuffer;
interface Range {
  readonly start: number;
  readonly count: number;
}
interface AttributeSource {
  readonly mesh: string;
  readonly attribute: string;
  readonly buffer: Attribute;
}

const mergeRanges = (ranges: ReadonlyArray<Range>, gap: number): ReadonlyArray<Range> => {
  const merged: Array<{ start: number; count: number }> = [];
  for (const range of ranges.toSorted((left, right) => left.start - right.start)) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.start + previous.count + gap) {
      previous.count = Math.max(previous.start + previous.count, range.start + range.count) - previous.start;
    } else merged.push({ start: range.start, count: range.count });
  }
  return merged;
};

const attributes = (engine: Engine): ReadonlyArray<AttributeSource> => {
  const data = engine.diagnosticScene();
  const sources: Array<AttributeSource> = [];
  const seen = new Set<Attribute>();
  const add = (mesh: string, attribute: string, buffer: Attribute) => {
    // Shared geometry and interleaved attributes refer to one native buffer.
    // Counting each mesh or attribute alias would invent duplicate transfers.
    if (seen.has(buffer)) return;
    seen.add(buffer);
    sources.push({ mesh, attribute, buffer });
  };
  const geometry = (name: string, value: THREE.BufferGeometry) => {
    for (const [attribute, buffer] of Object.entries(value.attributes)) {
      add(name, attribute, buffer instanceof THREE.InterleavedBufferAttribute ? buffer.data : buffer);
    }
    if (value.index) add(name, "index", value.index);
  };
  for (const mesh of data.meshes) {
    geometry(mesh.name, mesh.geometry);
    if (mesh instanceof THREE.InstancedMesh) {
      add(mesh.name, "instanceMatrix", mesh.instanceMatrix);
      if (mesh.instanceColor) add(mesh.name, "instanceColor", mesh.instanceColor);
    }
  }
  for (const [index, value] of data.geometries.entries()) geometry(`geometry-${index}`, value);
  return sources;
};

// Create after warming the scene, read after applying a snapshot and before
// drawing, then acknowledge after that draw. This observes renderer-owned
// buffers independently of both the snapshot diff and native upload counters.
export const makeUploadOracle = (engine: Engine) => {
  const versions = new Map(attributes(engine).map(source => [source.buffer, source.buffer.version]));
  const readExpected = () => {
    const records = attributes(engine).flatMap(source => {
      const previousVersion = versions.get(source.buffer) ?? -1;
      if (source.buffer.version === previousVersion) return [];
      const allocation = previousVersion === -1;
      const sourceRanges = source.buffer.updateRanges.map(range => ({ start: range.start, count: range.count }));
      const requested = allocation || sourceRanges.length === 0
        ? [{ start: 0, count: source.buffer.array.length }]
        : sourceRanges;
      // Three 0.180 joins overlapping/adjacent intervals and one-element gaps.
      // The gap is upload traffic, but is not an element marked as changed.
      const mergedRanges = mergeRanges(requested, 1);
      const markedElements = mergeRanges(requested, 0).reduce((total, range) => total + range.count, 0);
      const bytesPerElement = source.buffer.array.BYTES_PER_ELEMENT;
      const bytes = mergedRanges.reduce((total, range) => total + range.count * bytesPerElement, 0);
      return [{
        mesh: source.mesh,
        attribute: source.attribute,
        allocation,
        previousVersion,
        version: source.buffer.version,
        arrayBytes: source.buffer.array.byteLength,
        bytesPerElement,
        markedElements,
        sourceRanges,
        mergedRanges,
        calls: mergedRanges.length,
        bytes,
      }];
    });
    return {
      calls: records.reduce((total, record) => total + record.calls, 0),
      bytes: records.reduce((total, record) => total + record.bytes, 0),
      allocationCalls: records.filter(record => record.allocation).length,
      changedAttributes: records.length,
      records,
    };
  };
  return {
    readExpected,
    acknowledge: () => {
      for (const source of attributes(engine)) versions.set(source.buffer, source.buffer.version);
    },
  };
};
