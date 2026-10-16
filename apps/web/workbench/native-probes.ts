/* oxlint-disable unicorn/consistent-function-scoping, effect/noRuntimeTypeof, effect/noNullish, effect/noUnknownReturns, typescript/unbound-method -- Playwright serializes this init function without imports; native wrappers preserve platform nullability, primitive overloads and explicit original receivers. */
/* oxlint-disable effect/noReflectApply -- The native probe preserves overloaded browser arguments and receivers without casts. */
export interface BufferUploads {
  readonly calls: number;
  readonly bytes: number;
  readonly allocationCalls: number;
  readonly allocationBytes: number;
  readonly updateCalls: number;
  readonly updateBytes: number;
}
export interface NativeProbes {
  readonly uploads: (gl: WebGLRenderingContext | WebGL2RenderingContext) => BufferUploads;
  readonly memory: (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    value: { geometries: number; textures: number },
  ) => void;
  readonly ledger: () => {
    acquired: number;
    released: number;
    live: number;
    contexts: number;
    listeners: number;
    history: Array<{ geometries: number; textures: number; contextLost: boolean }>;
  };
}
declare global {
  interface Window {
    floorNativeProbes: NativeProbes;
  }
}
// This function is self-contained because Playwright serializes it before any
// application code runs. The workbench may also install it for manual diagnosis.
export const installNativeProbes = () => {
  if (Object.hasOwn(window, "floorNativeProbes")) return;
  type GL = WebGLRenderingContext | WebGL2RenderingContext;
  type Source = Parameters<WebGLRenderingContext["bufferData"]>[1];
  const contexts: Array<{
    gl: GL;
    canvas: HTMLCanvasElement;
    totals: {
      calls: number;
      bytes: number;
      allocationCalls: number;
      allocationBytes: number;
      updateCalls: number;
      updateBytes: number;
    };
    memory: Array<{ geometries: number; textures: number }>;
  }> = [];
  const listeners: Array<{
    target: EventTarget;
    type: string;
    listener: EventListenerOrEventListenerObject;
    actual: EventListener;
    capture: boolean;
    forget: () => void;
  }> = [];
  const bytes = (source: Source, offset = 0, length = 0) => {
    if (!source) return 0;
    const unit = "BYTES_PER_ELEMENT" in source && typeof source.BYTES_PER_ELEMENT === "number"
      ? source.BYTES_PER_ELEMENT
      : 1;
    return length === 0 ? source.byteLength - offset * unit : length * unit;
  };
  const getContext = HTMLCanvasElement.prototype.getContext;
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value: function(this: HTMLCanvasElement, ...args: ReadonlyArray<unknown>): unknown {
      const context: unknown = Reflect.apply(getContext, this, args);
      if (!(context instanceof WebGLRenderingContext || context instanceof WebGL2RenderingContext)) return context;
      if (contexts.some(value => value.gl === context)) return context;
      const totals = { calls: 0, bytes: 0, allocationCalls: 0, allocationBytes: 0, updateCalls: 0, updateBytes: 0 };
      contexts.push({ gl: context, canvas: this, totals, memory: [] });
      const data = context.bufferData, sub = context.bufferSubData;
      context.bufferData = (
        target: number,
        source: number | Source,
        usage: number,
        offset?: number,
        length?: number,
      ) => {
        if (offset === undefined) Reflect.apply(data, context, [target, source, usage]);
        else if (length === undefined) Reflect.apply(data, context, [target, source, usage, offset]);
        else Reflect.apply(data, context, [target, source, usage, offset, length]);
        const uploaded = typeof source === "number" ? 0 : bytes(source, offset, length);
        totals.calls++;
        totals.bytes += uploaded;
        totals.allocationCalls++;
        totals.allocationBytes += typeof source === "number" ? source : uploaded;
      };
      context.bufferSubData = (
        target: number,
        destination: number,
        source: AllowSharedBufferSource,
        offset?: number,
        length?: number,
      ) => {
        if (offset === undefined) Reflect.apply(sub, context, [target, destination, source]);
        else if (length === undefined) Reflect.apply(sub, context, [target, destination, source, offset]);
        else Reflect.apply(sub, context, [target, destination, source, offset, length]);
        const uploaded = bytes(source, offset, length);
        totals.calls++;
        totals.bytes += uploaded;
        totals.updateCalls++;
        totals.updateBytes += uploaded;
      };
      return context;
    },
  });
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  const captured = (options?: boolean | AddEventListenerOptions) =>
    typeof options === "boolean" ? options : options?.capture ?? false;
  const observed = (target: EventTarget, type: string) =>
    target instanceof HTMLCanvasElement || (target === window && type === "popstate");
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (!listener || !observed(this, type)) return Reflect.apply(add, this, [type, listener, options]);
    const capture = captured(options);
    const existing = listeners.find(value =>
      value.target === this && value.type === type && value.listener === listener && value.capture === capture
    );
    if (existing) return Reflect.apply(add, this, [type, existing.actual, options]);
    const signal = typeof options === "object" ? options.signal : undefined;
    if (signal?.aborted === true) return;
    const once = typeof options === "object" && options.once === true;
    // Native once/abort removal does not call removeEventListener. Observe those
    // lifetimes too, including one-shot listeners installed by a browser test.
    const forget = () => {
      const index = listeners.indexOf(record);
      if (index >= 0) listeners.splice(index, 1);
      signal?.removeEventListener("abort", forget);
    };
    const actual = function(this: EventTarget, event: Event) {
      if (once) forget();
      if (typeof listener === "function") Reflect.apply(listener, this, [event]);
      else listener.handleEvent(event);
    };
    const record = { target: this, type, listener, actual, capture, forget };
    Reflect.apply(add, this, [type, actual, options]);
    listeners.push(record);
    signal?.addEventListener("abort", forget, { once: true });
  };
  EventTarget.prototype.removeEventListener = function(type, listener, options) {
    const record = listeners.find(value =>
      value.target === this && value.type === type && value.listener === listener && value.capture === captured(options)
    );
    Reflect.apply(remove, this, [type, record?.actual ?? listener, options]);
    record?.forget();
  };
  const lookup = (gl: GL) => {
    const value = contexts.find(context => context.gl === gl);
    if (!value) {
      // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- A probe installed after acquisition cannot claim complete native measurements.
      throw new Error("Native probe was not installed before this context was acquired");
    }
    return value;
  };
  window.floorNativeProbes = {
    uploads: gl => ({ ...lookup(gl).totals }),
    memory: (gl, memory) => {
      lookup(gl).memory.push(memory);
    },
    ledger: () => ({
      acquired: contexts.length,
      released: contexts.filter(context => !context.canvas.isConnected && context.gl.isContextLost()).length,
      live: contexts.filter(context => context.canvas.isConnected).length,
      contexts: contexts.filter(context => !context.gl.isContextLost()).length,
      listeners: listeners.length,
      history: contexts.flatMap(context =>
        context.memory.map(memory => ({ ...memory, contextLost: context.gl.isContextLost() }))
      ),
    }),
  };
};
