import { Effect, Exit, Option, Schema, Semaphore } from "effect";
import { fault, type MapFault, type Marker, Snapshot } from "../model";

export interface Resource {
  readonly token: number;
  readonly kind: Marker["kind"];
  readonly read: () => number;
  readonly write: (x: number) => void;
  readonly dispose: () => void;
}
const resourceCall = <A>(phase: string, run: () => A) => Effect.try({ try: run, catch: cause => fault(phase, cause) });
const releaseAll = (handles: ReadonlyArray<Resource>) =>
  Effect.forEach(handles.toReversed(), handle => resourceCall("resource-dispose", handle.dispose).pipe(Effect.exit))
    .pipe(
      Effect.map(exits => exits.flatMap(exit => Exit.isFailure(exit) ? [exit.cause] : [])),
    );

export const makeTransactionalHost = Effect.fn("TransactionalHost.make")(
  function*(create: (marker: Marker) => Resource) {
    const lock = yield* Semaphore.make(1);
    const state = { handles: new Map<string, Resource>(), poisoned: false, maybeFrame: Option.none<Snapshot>() };
    const prepare = Effect.fn("TransactionalHost.prepare")(function*(snapshot: Snapshot) {
      const staged = new Map<string, Resource>();
      const acquired: Array<Resource> = [];
      const result = yield* Effect.forEach(snapshot.markers, marker =>
        Effect.gen(function*() {
          const previous = Option.fromUndefinedOr(state.handles.get(marker.id));
          const handle = Option.isSome(previous) && previous.value.kind === marker.kind
            ? previous.value
            : yield* resourceCall("resource-create", () => create(marker)).pipe(
              Effect.tap(value => Effect.sync(() => acquired.push(value))),
            );
          staged.set(marker.id, handle);
        }), { discard: true }).pipe(Effect.exit);
      if (Exit.isFailure(result)) {
        const failures = yield* releaseAll(acquired);
        state.poisoned = failures.length !== 0;
        return yield* fault("prepare", { cause: result.cause, cleanup: failures });
      }
      return { staged, acquired };
    });
    const mutate = Effect.fn("TransactionalHost.mutate")(
      function*(snapshot: Snapshot, staged: ReadonlyMap<string, Resource>, acquired: ReadonlyArray<Resource>) {
        const written: Array<{ readonly handle: Resource; readonly oldX: number }> = [];
        const result = yield* Effect.forEach(snapshot.markers, marker =>
          Effect.gen(function*() {
            const handle = Option.fromUndefinedOr(staged.get(marker.id));
            if (Option.isNone(handle)) return yield* fault("plan", "Validated plan lost a handle");
            const oldX = yield* resourceCall("resource-read", handle.value.read);
            written.push({ handle: handle.value, oldX });
            return yield* resourceCall("resource-write", () => handle.value.write(marker.x));
          }), { discard: true }).pipe(Effect.exit);
        if (Exit.isFailure(result)) {
          const rollbacks = yield* Effect.forEach(
            written.toReversed(),
            ({ handle, oldX }) => resourceCall("resource-rollback", () => handle.write(oldX)).pipe(Effect.exit),
          );
          const failures = [
            ...rollbacks.flatMap(exit => Exit.isFailure(exit) ? [exit.cause] : []),
            ...yield* releaseAll(acquired),
          ];
          state.poisoned = failures.length !== 0;
          return yield* fault("commit-rollback", { cause: result.cause, cleanup: failures });
        }
        return yield* Effect.void;
      },
    );
    const reconcile = Effect.fn("TransactionalHost.reconcile")(function*(snapshot: Snapshot) {
      if (state.poisoned) return yield* fault("quarantined", "Host is quarantined");
      const ids = new Set(snapshot.markers.map(marker => marker.id));
      if (ids.size !== snapshot.markers.length) return yield* fault("validation", "Duplicate entity IDs");
      const { staged, acquired } = yield* prepare(snapshot);
      yield* mutate(snapshot, staged, acquired);
      const retired = [...state.handles].flatMap(([id, handle]) => staged.get(id) !== handle ? [handle] : []);
      state.handles = staged;
      state.maybeFrame = Option.some(snapshot);
      const failures = yield* releaseAll(retired);
      if (failures.length !== 0) {
        state.poisoned = true;
        return yield* fault("retirement", failures);
      }
      return yield* Effect.void;
    });
    const apply = Effect.fn("TransactionalHost.apply")(function*(input: Schema.Json) {
      const snapshot = yield* Schema.decodeUnknownEffect(Snapshot)(input).pipe(
        Effect.mapError(cause => fault("validation", cause)),
      );
      // Every staged mutation either commits or rolls back before interruption can
      // leave a partially written scene visible to the next reconciliation.
      yield* lock.withPermit(reconcile(snapshot).pipe(Effect.uninterruptible));
    });
    const close = lock.withPermit(Effect.gen(function*() {
      const failures = yield* releaseAll([...state.handles.values()]);
      state.handles.clear();
      state.maybeFrame = Option.none();
      if (failures.length !== 0) {
        state.poisoned = true;
        return yield* fault("close", failures);
      }
      return yield* Effect.void;
    }));
    const inspect: Effect.Effect<{
      readonly poisoned: boolean;
      readonly maybeFrame: Option.Option<Snapshot>;
      readonly resources: ReadonlyArray<
        { readonly id: string; readonly token: number; readonly x: number; readonly kind: Marker["kind"] }
      >;
    }, MapFault> = resourceCall("inspect", () => ({
      poisoned: state.poisoned,
      maybeFrame: state.maybeFrame,
      resources: [...state.handles].map(([id, resource]) => ({
        id,
        token: resource.token,
        x: resource.read(),
        kind: resource.kind,
      })),
    }));
    return { apply, close, inspect };
  },
);
