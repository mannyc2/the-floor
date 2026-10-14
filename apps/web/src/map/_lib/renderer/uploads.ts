/* oxlint-disable effect/noReflectApply -- This native WebGL interception boundary preserves overloaded argument arities and the original receiver without casts or changing WebGL's error behavior. */
import { Predicate } from "effect";

type BufferSource = Parameters<WebGLRenderingContext["bufferData"]>[1];

export interface BufferUploads {
  readonly calls: number;
  readonly bytes: number;
  readonly allocationCalls: number;
  readonly allocationBytes: number;
  readonly updateCalls: number;
  readonly updateBytes: number;
}

const sourceBytes = (source: BufferSource, offset = 0, length = 0): number => {
  if (!source) return 0;
  // WebGL2 counts typed-array elements, but DataView offsets and lengths are
  // bytes. A zero length, like an omitted length, consumes the remaining view.
  const elementBytes = "BYTES_PER_ELEMENT" in source && Predicate.isNumber(source.BYTES_PER_ELEMENT)
    ? source.BYTES_PER_ELEMENT
    : 1;
  return length === 0 ? source.byteLength - offset * elementBytes : length * elementBytes;
};

export const trackUploads = (gl: WebGLRenderingContext | WebGL2RenderingContext) => {
  const originalData = gl.bufferData, originalSubData = gl.bufferSubData;
  const totals = { calls: 0, bytes: 0, allocationCalls: 0, allocationBytes: 0, updateCalls: 0, updateBytes: 0 };
  // Observe the native submission boundary: attribute callbacks have already
  // lost Three's merged update ranges, and array sizes overstate sparse writes.
  // These are buffer source bytes, not textures, bus traffic or GPU duration.
  const bufferData = (
    target: number,
    source: number | BufferSource,
    usage: number,
    offset?: number,
    length?: number,
  ): void => {
    if (Predicate.isUndefined(offset)) Reflect.apply(originalData, gl, [target, source, usage]);
    else if (Predicate.isUndefined(length)) Reflect.apply(originalData, gl, [target, source, usage, offset]);
    else Reflect.apply(originalData, gl, [target, source, usage, offset, length]);
    const bytes = Predicate.isNumber(source) ? 0 : sourceBytes(source, offset, length);
    totals.calls++;
    totals.bytes += bytes;
    totals.allocationCalls++;
    // A numeric size requests storage without supplying bytes. In particular,
    // async pixel-readback allocations must not masquerade as upload traffic.
    totals.allocationBytes += Predicate.isNumber(source) ? source : bytes;
  };
  const bufferSubData = (
    target: number,
    destinationOffset: number,
    source: AllowSharedBufferSource,
    offset?: number,
    length?: number,
  ): void => {
    if (Predicate.isUndefined(offset)) Reflect.apply(originalSubData, gl, [target, destinationOffset, source]);
    else if (Predicate.isUndefined(length)) {
      Reflect.apply(originalSubData, gl, [target, destinationOffset, source, offset]);
    } else Reflect.apply(originalSubData, gl, [target, destinationOffset, source, offset, length]);
    const bytes = sourceBytes(source, offset, length);
    totals.calls++;
    totals.bytes += bytes;
    totals.updateCalls++;
    totals.updateBytes += bytes;
  };
  gl.bufferData = bufferData;
  gl.bufferSubData = bufferSubData;
  return {
    read: (): BufferUploads => ({ ...totals }),
    restore: () => {
      gl.bufferData = originalData;
      gl.bufferSubData = originalSubData;
    },
  };
};
