import { Effect, Option, Ref, Schema } from "effect";
import { Envelope, fault, type Receipt } from "../model";

interface State {
  readonly generation: number;
  readonly sequence: number;
  readonly maybePending: Option.Option<Envelope>;
  readonly maybeApplied: Option.Option<Receipt>;
}

export const makeDisplayGate = Effect.gen(function*() {
  const state = yield* Ref.make<State>({
    generation: 0,
    sequence: -1,
    maybePending: Option.none(),
    maybeApplied: Option.none(),
  });
  return {
    begin: Effect.fn("DisplayGate.begin")(function*(generation: number) {
      const current = yield* Ref.get(state);
      if (!Number.isSafeInteger(generation) || generation <= current.generation) {
        return yield* fault("generation", "Acquisition generations must advance");
      }
      return yield* Ref.set(state, {
        generation,
        sequence: -1,
        maybePending: Option.none(),
        maybeApplied: Option.none(),
      });
    }),
    accept: Effect.fn("DisplayGate.accept")(function*(input: Schema.Json) {
      const envelope = yield* Schema.decodeUnknownEffect(Envelope)(input).pipe(
        Effect.mapError(cause => fault("validation", cause)),
      );
      return yield* Ref.modify(state, (current): [boolean, State] => {
        if (envelope.generation !== current.generation || envelope.sequence <= current.sequence) {
          return [false, current];
        }
        return [true, { ...current, sequence: envelope.sequence, maybePending: Option.some(envelope) }];
      });
    }),
    acknowledge: (receipt: Receipt) =>
      Ref.modify(state, (current): [boolean, State] => {
        if (
          receipt.generation !== current.generation || receipt.sequence !== current.sequence
          || Option.isNone(current.maybePending)
        ) {
          return [false, current];
        }
        return [true, { ...current, maybeApplied: Option.some(receipt) }];
      }),
    canInteract: (receipt: Receipt) =>
      Ref.get(state).pipe(
        Effect.map(current =>
          Option.isSome(current.maybeApplied) && Option.isSome(current.maybePending)
          && current.maybePending.value.mode === "Live" && receipt.generation === current.generation
          && receipt.sequence === current.sequence && current.maybeApplied.value.sequence === current.sequence
        ),
      ),
    read: Ref.get(state),
  };
});
