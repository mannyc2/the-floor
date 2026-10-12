import { Deferred, Effect, Exit, Result, Scope } from "effect";
import { fault, MapFault } from "../model";

interface Entry<A> {
  readonly scope: Scope.Closeable;
  readonly ready: Deferred.Deferred<A, MapFault>;
  refs: number;
}
export interface ContentKey {
  readonly url: string;
  readonly sha256: string;
}

export const makeLeasePool = Effect.fn("LeasePool.make")(function*<A>(
  load: (key: ContentKey) => Effect.Effect<A, MapFault>,
  dispose: (value: A) => Effect.Effect<void, MapFault>,
) {
  const entries = new Map<string, Entry<A>>();
  const cleanupFailures: Array<MapFault> = [];
  const closeEntry = (entry: Entry<A>) => Scope.close(entry.scope, Exit.void);
  yield* Effect.addFinalizer(() =>
    Effect.forEach(entries.values(), closeEntry, { discard: true }).pipe(
      Effect.andThen(Effect.sync(() => entries.clear())),
    )
  );
  const acquire = Effect.fn("LeasePool.acquire")(function*(key: ContentKey) {
    if (!/^[a-f0-9]{64}$/.test(key.sha256)) return yield* fault("content-key", "A content digest is required");
    const cacheKey = `${key.url}\u0000${key.sha256}`;
    const entry = yield* Effect.acquireRelease(
      Effect.gen(function*() {
        const existing = entries.get(cacheKey);
        if (existing) {
          existing.refs++;
          return existing;
        }
        const scope = yield* Scope.make();
        const ready = yield* Deferred.make<A, MapFault>();
        const created: Entry<A> = { scope, ready, refs: 1 };
        entries.set(cacheKey, created);
        const worker = Effect.scoped(Effect.gen(function*() {
          const value = yield* Effect.acquireRelease(
            Effect.interruptible(load(key)),
            resource =>
              dispose(resource).pipe(
                Effect.catchCause(cause => Effect.sync(() => cleanupFailures.push(fault("lease-dispose", cause)))),
              ),
          );
          yield* Deferred.succeed(ready, value);
          return yield* Effect.never;
        })).pipe(Effect.catchCause(cause =>
          Effect.gen(function*() {
            if (entries.get(cacheKey) === created) entries.delete(cacheKey);
            yield* Deferred.fail(ready, fault("lease-load", cause));
          })
        ));
        yield* Effect.forkIn(worker, scope);
        return created;
      }),
      current =>
        Effect.gen(function*() {
          current.refs--;
          if (current.refs === 0) {
            if (entries.get(cacheKey) === current) entries.delete(cacheKey);
            yield* closeEntry(current);
          }
        }),
    );
    return yield* Deferred.await(entry.ready);
  });
  return {
    acquire,
    inspect: Effect.sync(() => ({
      entries: entries.size,
      cleanupFailures: cleanupFailures.map(error => error.message),
    })),
  };
});

// Non-cooperative foreign callbacks need a late-value path. Interrupting an
// Effect cannot stop an SDK from invoking a callback it already retained.
export const scopedForeignValue = <A>(
  start: (receive: (value: A) => void, signal: AbortSignal) => void,
  dispose: (value: A) => void,
  reportCleanupFailure: (error: MapFault) => void,
) =>
  Effect.acquireRelease(
    Effect.interruptible(Effect.callback<A, MapFault>((resume, signal) => {
      start(value => {
        if (signal.aborted) {
          const result = Result.try({ try: () => dispose(value), catch: cause => fault("late-dispose", cause) });
          if (Result.isFailure(result)) reportCleanupFailure(result.failure);
        } else resume(Effect.succeed(value));
      }, signal);
    })),
    value =>
      Effect.sync(() => {
        const result = Result.try({ try: () => dispose(value), catch: cause => fault("dispose", cause) });
        if (Result.isFailure(result)) reportCleanupFailure(result.failure);
      }),
  );
