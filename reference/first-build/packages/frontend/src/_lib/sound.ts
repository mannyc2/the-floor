import { Context, Effect, Layer, Option, Random, Ref, Scope, Semaphore } from "effect";
import { FrontendError } from "./errors";

interface AmbientGraph {
  readonly context: AudioContext;
  readonly output: GainNode;
}

const closeContext = (context: AudioContext) =>
  context.state === "closed"
    ? Effect.void
    : Effect.tryPromise({
      try: () => context.close(),
      catch: () => new FrontendError({ message: "The browser could not release ambient audio." }),
    }).pipe(Effect.tapError(Effect.logWarning), Effect.ignore);

const noiseBuffer = (context: AudioContext, random: Random.Random): AudioBuffer => {
  const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index++) samples[index] = random.nextDoubleUnsafe() * 2 - 1;
  return buffer;
};

const connectNoise = (
  context: AudioContext,
  buffer: AudioBuffer,
  output: GainNode,
  kind: BiquadFilterType,
  frequency: number,
  volume: number,
  offset: number,
): void => {
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const level = context.createGain();
  source.buffer = buffer;
  source.loop = true;
  filter.type = kind;
  filter.frequency.value = frequency;
  filter.Q.value = 0.5;
  level.gain.value = volume;
  source.connect(filter).connect(level).connect(output);
  source.start(0, offset);
};

const acquireGraph = Effect.fn("AmbientSound.acquireGraph")(function*(random: Random.Random) {
  const context = yield* Effect.acquireRelease(
    Effect.try({
      try: () => new AudioContext(),
      catch: () => new FrontendError({ message: "Ambient sound is unavailable in this browser." }),
    }),
    closeContext,
  );
  return yield* Effect.try({
    try: (): AmbientGraph => {
      const output = context.createGain();
      output.gain.value = 0;
      output.connect(context.destination);
      const buffer = noiseBuffer(context, random);
      connectNoise(context, buffer, output, "lowpass", 230, 0.075, 0);
      connectNoise(context, buffer, output, "bandpass", 1300, 0.018, 2);
      return { context, output };
    },
    catch: () => new FrontendError({ message: "The browser could not prepare ambient sound." }),
  }).pipe(Effect.onError(() => closeContext(context)));
});

const changePlayback = Effect.fn("AmbientSound.changePlayback")(function*(graph: AmbientGraph, enabled: boolean) {
  if (enabled) {
    yield* Effect.tryPromise({
      try: () => graph.context.resume(),
      catch: () => new FrontendError({ message: "The browser did not enable ambient sound." }),
    });
  }
  yield* Effect.try({
    try: () => {
      // Audio automation uses the device's sample clock so fades remain smooth when animation frames slow down.
      const now = graph.context.currentTime;
      graph.output.gain.cancelScheduledValues(now);
      graph.output.gain.setValueAtTime(graph.output.gain.value, now);
      graph.output.gain.linearRampToValueAtTime(enabled ? 0.45 : 0, now + 0.18);
    },
    catch: () => new FrontendError({ message: "The browser could not change ambient sound." }),
  });
  if (!enabled) {
    yield* Effect.sleep("200 millis");
    yield* Effect.tryPromise({
      try: () => graph.context.suspend(),
      catch: () => new FrontendError({ message: "The browser could not pause ambient sound." }),
    });
  }
});

export class AmbientSound extends Context.Service<AmbientSound, {
  setEnabled(enabled: boolean): Effect.Effect<void, FrontendError>;
}>()("@floor/frontend/AmbientSound") {
  static readonly layer = Layer.effect(
    AmbientSound,
    Effect.gen(function*() {
      const scope = yield* Scope.Scope;
      const random = yield* Random.Random;
      const graph = yield* Ref.make(Option.none<AmbientGraph>());
      const mutex = yield* Semaphore.make(1);
      return AmbientSound.of({
        setEnabled: Effect.fn("AmbientSound.setEnabled")(
          function*(enabled: boolean) {
            const current = yield* Ref.get(graph);
            if (!enabled && Option.isNone(current)) return;
            // The first explicit opt-in owns allocation; merely opening The Floor never starts an audio device.
            const active = Option.isSome(current)
              ? current.value
              : yield* acquireGraph(random).pipe(Scope.provide(scope));
            yield* Ref.set(graph, Option.some(active));
            yield* changePlayback(active, enabled);
          },
          (effect) => mutex.withPermit(effect),
          Effect.uninterruptible,
        ),
      });
    }),
  );
}
