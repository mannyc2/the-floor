import { Effect, Option, Queue, Schema, Stream } from "effect";
import type { MapCommands, Mounted } from "../src/map/_lib/renderer/service";
import { Message } from "../src/map/message";
import { fault, Presentation } from "../src/map/model";

type MountOptions = Parameters<MapCommands["Service"]["mount"]>[0];
export const installReplay = (mounted: Mounted, options: MountOptions) =>
  Effect.gen(function*() {
    let paused = false;
    const report = (error: { readonly message: string }) =>
      Effect.sync(() => {
        Queue.offerUnsafe(options.queue, Message.FailedMap({ reason: error.message }));
      });
    const readRendered = Effect.gen(function*() {
      const encoded = Option.fromUndefinedOr(options.element.dataset["frame"]);
      if (Option.isNone(encoded)) return;
      const presentation = yield* Schema.decodeEffect(Schema.fromJsonString(Presentation))(encoded.value)
        .pipe(Effect.mapError(cause => fault("rendered-schema", cause)));
      yield* mounted.service.present(presentation, true);
    });
    const changes = yield* Queue.sliding<boolean>(1);
    yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const observer = new MutationObserver(() => {
            if (paused) Queue.offerUnsafe(changes, true);
          });
          observer.observe(options.element, { attributes: true, attributeFilter: ["data-frame"] });
          return observer;
        },
        catch: cause => fault("replay-observer", cause),
      }),
      observer => Effect.sync(() => observer.disconnect()),
    );
    yield* Stream.runForEach(Stream.fromQueue(changes), () => readRendered.pipe(Effect.catch(report)))
      .pipe(Effect.forkScoped);
    yield* Stream.runForEach(options.viewStateChanges, state =>
      Effect.gen(function*() {
        paused = state === "Paused";
        yield* mounted.service.pause(paused);
        yield* readRendered;
      })).pipe(Effect.catch(report), Effect.forkScoped);
  });
