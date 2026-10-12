import { Effect, Exit, Fiber, Option, Semaphore } from "effect";
import { fault, MapFault } from "../model";

// Acquisition is interruptible; publication and retirement are serialized.
// A failed or timed-out retirement is uncertain ownership, never permission to overlap.
export const makeSerialOwner = Effect.fn("SerialOwner.make")(
  function*<A>(release: (value: A) => Effect.Effect<void, MapFault>, releaseBoundMs = 100) {
    const lock = yield* Semaphore.make(1);
    const state = {
      ticket: 0,
      closed: false,
      maybeValue: Option.none<A>(),
      maybeAcquiring: Option.none<Fiber.Fiber<A, MapFault>>(),
      maybePoison: Option.none<MapFault>(),
    };

    const retire = Effect.fn("SerialOwner.retire")(function*() {
      if (Option.isNone(state.maybeValue)) return yield* Effect.void;
      const value = state.maybeValue.value;
      state.maybeValue = Option.none();
      const exit = yield* Effect.exit(release(value).pipe(Effect.interruptible, Effect.timeout(releaseBoundMs)));
      if (Exit.isFailure(exit)) {
        const error = fault("release-quarantined", exit.cause);
        state.maybePoison = Option.some(error);
        return yield* error;
      }
      return yield* Effect.void;
    });

    const replace = Effect.fn("SerialOwner.replace")(function*(acquire: Effect.Effect<A, MapFault>) {
      const ticket = ++state.ticket;
      if (Option.isSome(state.maybeAcquiring)) yield* Fiber.interrupt(state.maybeAcquiring.value);
      return yield* lock.withPermit(Effect.uninterruptible(
        Effect.gen(function*() {
          if (Option.isSome(state.maybePoison)) return yield* state.maybePoison.value;
          if (state.closed || ticket !== state.ticket) return Option.none<A>();
          yield* retire();
          if (state.closed || ticket !== state.ticket) return Option.none<A>();
          const fiber = yield* Effect.forkChild(Effect.interruptible(acquire));
          state.maybeAcquiring = Option.some(fiber);
          const exit = yield* Effect.exit(Effect.interruptible(Fiber.join(fiber)));
          state.maybeAcquiring = Option.none();
          if (Exit.isFailure(exit)) {
            // The child can finish successfully just as its waiting parent is
            // cancelled. Its exact value still needs retirement in that race.
            yield* Fiber.interrupt(fiber);
            const acquired = yield* Fiber.await(fiber);
            if (Exit.isSuccess(acquired)) {
              state.maybeValue = Option.some(acquired.value);
              yield* retire();
            }
            return yield* Effect.failCause(exit.cause);
          }
          state.maybeValue = Option.some(exit.value);
          if (state.closed || ticket !== state.ticket) {
            yield* retire();
            return Option.none<A>();
          }
          return Option.some(exit.value);
        }),
      ));
    });

    const close = Effect.fn("SerialOwner.close")(function*() {
      state.closed = true;
      state.ticket++;
      if (Option.isSome(state.maybeAcquiring)) yield* Fiber.interrupt(state.maybeAcquiring.value);
      yield* lock.withPermit(retire());
    });
    const retireValue = (value: A) =>
      lock.withPermit(
        Effect.suspend(() =>
          Option.isSome(state.maybeValue) && state.maybeValue.value === value ? retire() : Effect.void
        ),
      );
    const replaceScoped = (
      acquire: Effect.Effect<A, MapFault>,
      onRetireFailure: (error: MapFault) => Effect.Effect<void>,
    ) =>
      // Only the child acquisition and join are interruptible. Publication must
      // stay masked until acquireRelease attaches retirement to the mount scope.
      Effect.acquireRelease(replace(acquire), mounted =>
        Option.match(mounted, {
          onNone: () => Effect.void,
          onSome: value => retireValue(value).pipe(Effect.catch(onRetireFailure)),
        }));
    return {
      replace,
      replaceScoped,
      close,
      retireValue,
      current: () => state.maybeValue,
      inspect: Effect.sync(() => ({
        closed: state.closed,
        active: Option.isSome(state.maybeValue),
        quarantined: Option.isSome(state.maybePoison),
      })),
    };
  },
);
