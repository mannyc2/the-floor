import { describe, expect } from "bun:test";
import { Clock, Deferred, Effect, Exit, Fiber, Option, Queue, References, Result, Scope } from "effect";
import { TestClock } from "effect/testing";
import * as THREE from "three";
import { makeDisplayGate } from "../src/map/_lib/display-gate";
import { makeLeasePool, scopedForeignValue } from "../src/map/_lib/lease-pool";
import { makeSerialOwner } from "../src/map/_lib/serial-owner";
import { makeTransactionalHost, type Resource } from "../src/map/_lib/transactional-host";
import { cameraFromQuery, fault, type Marker, type Presentation } from "../src/map/model";
import { effectTest } from "./_runtime";

const presentation: Presentation = {
  revision: 8,
  theme: "day",
  camera: { x: 0, z: 0, extent: 21, rotation: 0 },
  sampleTime: 0,
  playbackRate: 0,
  previousValue: 0,
  nextValue: 0,
  intervalStart: 0,
};
const envelope = (sequence: number, revision = sequence, generation = 1) => ({
  generation,
  sequence,
  mode: "Live",
  presentation: { ...presentation, revision },
});
const key = { url: "asset:desk", sha256: "a".repeat(64) };

describe("Camera URL boundary", () => {
  effectTest(
    "legacy links retain their original corner and invalid rotations reject the view",
    () =>
      Effect.sync(() => {
        expect(cameraFromQuery(new URLSearchParams("x=2&z=-1&extent=18"))).toEqual(
          Option.some({ x: 2, z: -1, extent: 18, rotation: 0 }),
        );
        expect(cameraFromQuery(new URLSearchParams("x=2&z=-1&extent=18&rotation=3"))).toEqual(
          Option.some({ x: 2, z: -1, extent: 18, rotation: 3 }),
        );
        for (const rotation of ["-1", "4", "1.5", "NaN", "Infinity", "east"]) {
          expect(Option.isNone(cameraFromQuery(new URLSearchParams(`x=2&z=-1&extent=18&rotation=${rotation}`)))).toBe(
            true,
          );
        }
        expect(Option.isNone(cameraFromQuery(new URLSearchParams("rotation=3")))).toBe(true);
      }),
  );
});

describe("Display protocol", () => {
  effectTest("A-B-A uses display order, not revision order", () =>
    Effect.gen(function*() {
      const gate = yield* makeDisplayGate;
      yield* gate.begin(1);
      yield* Effect.forEach([8, 9, 8], (revision, index) =>
        Effect.gen(function*() {
          expect(yield* gate.accept(envelope(index, revision))).toBe(true);
          expect(yield* gate.acknowledge({ generation: 1, sequence: index })).toBe(true);
        }));
      const state = yield* gate.read;
      expect(Option.isSome(state.maybePending)).toBe(true);
      expect(Option.getOrThrow(state.maybePending).presentation.revision).toBe(8);
    }));
  effectTest("stale completion cannot acknowledge a newer pending frame", () =>
    Effect.gen(function*() {
      const gate = yield* makeDisplayGate;
      yield* gate.begin(1);
      yield* gate.accept(envelope(2));
      yield* gate.accept(envelope(3));
      expect(yield* gate.acknowledge({ generation: 1, sequence: 2 })).toBe(false);
      expect(yield* gate.canInteract({ generation: 1, sequence: 3 })).toBe(false);
    }));
  effectTest("structured-cloned receipts are accepted by value", () =>
    Effect.gen(function*() {
      const gate = yield* makeDisplayGate;
      yield* gate.begin(1);
      yield* gate.accept(envelope(1));
      expect(yield* gate.acknowledge(structuredClone({ generation: 1, sequence: 1 }))).toBe(true);
      expect(yield* gate.canInteract({ generation: 1, sequence: 1 })).toBe(true);
    }));
  effectTest("previous acquisition cannot publish into a fresh generation", () =>
    Effect.gen(function*() {
      const gate = yield* makeDisplayGate;
      yield* gate.begin(1);
      yield* gate.accept(envelope(3));
      yield* gate.begin(2);
      expect(yield* gate.accept(envelope(99))).toBe(false);
      expect(yield* gate.acknowledge({ generation: 1, sequence: 3 })).toBe(false);
      expect(yield* gate.accept(envelope(0, 1, 2))).toBe(true);
    }));
  effectTest("invalid input does not poison the sequence counter", () =>
    Effect.gen(function*() {
      const gate = yield* makeDisplayGate;
      yield* gate.begin(1);
      expect(Exit.isFailure(yield* Effect.exit(gate.accept(envelope(NaN))))).toBe(true);
      expect(yield* gate.accept(envelope(1))).toBe(true);
      expect(yield* gate.accept(envelope(0))).toBe(false);
    }));
  effectTest("paused and pending presentations reject interaction", () =>
    Effect.gen(function*() {
      const gate = yield* makeDisplayGate;
      yield* gate.begin(1);
      yield* gate.accept({ ...envelope(1), mode: "Paused" });
      yield* gate.acknowledge({ generation: 1, sequence: 1 });
      expect(yield* gate.canInteract({ generation: 1, sequence: 1 })).toBe(false);
    }));
  effectTest("generation must advance", () =>
    Effect.gen(function*() {
      const gate = yield* makeDisplayGate;
      yield* gate.begin(1);
      expect(Exit.isFailure(yield* Effect.exit(gate.begin(1)))).toBe(true);
    }));
});

describe("Serial ownership, real fibers and clock", () => {
  effectTest("old teardown completes before replacement acquisition", () =>
    Effect.gen(function*() {
      const events: Array<string> = [];
      const started = yield* Deferred.make<boolean>();
      const owner = yield* makeSerialOwner<number>(value =>
        Effect.gen(function*() {
          events.push(`release-${value}`);
          yield* Deferred.succeed(started, true);
          // oxlint-disable-next-line effect/noFixedWaitInTests -- The synthetic release lasts 50 virtual milliseconds; TestClock.adjust controls completion and the assertion proves acquisition waits for retirement.
          yield* Effect.sleep(50);
          events.push(`released-${value}`);
        })
      );
      yield* owner.replace(Effect.succeed(1));
      const replacement = yield* Effect.forkChild(owner.replace(Effect.sync(() => {
        events.push("acquire-2");
        return 2;
      })));
      yield* Deferred.await(started);
      expect(events).toEqual(["release-1"]);
      yield* TestClock.adjust(50);
      yield* Fiber.join(replacement);
      expect(events).toEqual(["release-1", "released-1", "acquire-2"]);
      const closing = yield* Effect.forkChild(owner.close());
      yield* TestClock.adjust(50);
      yield* Fiber.join(closing);
    }));
  effectTest("never-settling acquisition is interrupted by close", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<boolean>();
      const owner = yield* makeSerialOwner<number>(() => Effect.void);
      const replacement = yield* Effect.forkChild(
        owner.replace(Deferred.succeed(started, true).pipe(Effect.andThen(Effect.never))),
      );
      yield* Deferred.await(started);
      const before = yield* Clock.currentTimeMillis;
      yield* owner.close();
      const after = yield* Clock.currentTimeMillis;
      expect(after - before).toBe(0);
      expect((yield* owner.inspect).active).toBe(false);
      yield* Fiber.interrupt(replacement);
    }));
  effectTest("cancellation at publication cannot escape the mount scope finalizer", () =>
    Effect.gen(function*() {
      const released: Array<number> = [];
      const owner = yield* makeSerialOwner<number>(value => Effect.sync(() => released.push(value)));
      // Yield with a small operation budget so cancellation can land between the
      // owner publishing its value and the mount registering its finalizer.
      const mounting = yield* Effect.forkChild(
        Effect.scoped(
          owner.replaceScoped(Effect.succeed(42), Effect.die).pipe(Effect.andThen(Effect.never)),
        ).pipe(Effect.provideService(References.MaxOpsBeforeYield, 10)),
      );
      yield* Effect.yieldNow.pipe(Effect.repeat({ while: () => Option.isNone(owner.current()) }));
      yield* Fiber.interrupt(mounting);
      expect(Exit.isFailure(yield* Fiber.await(mounting))).toBe(true);
      expect(released).toEqual([42]);
      expect((yield* owner.inspect).active).toBe(false);
      yield* owner.close();
      expect(released).toEqual([42]);
    }));
  effectTest("negative control: interruptible publication loses the mount finalizer", () =>
    Effect.gen(function*() {
      const released: Array<number> = [];
      const owner = yield* makeSerialOwner<number>(value => Effect.sync(() => released.push(value)));
      const mounting = yield* Effect.forkChild(
        Effect.scoped(
          Effect.acquireRelease(Effect.interruptible(owner.replace(Effect.succeed(42))), mounted =>
            Option.match(mounted, {
              onNone: () =>
                Effect.void,
              onSome: value => owner.retireValue(value).pipe(Effect.orDie),
            })).pipe(Effect.andThen(Effect.never)),
        ).pipe(Effect.provideService(References.MaxOpsBeforeYield, 10)),
      );
      yield* Effect.yieldNow.pipe(Effect.repeat({
        while: () =>
          Option.isNone(owner.current()),
      }));
      yield* Fiber.interrupt(mounting);
      expect((yield* owner.inspect).active).toBe(true);
      expect(released).toEqual([]);
      yield* owner.close();
      expect(released).toEqual([42]);
    }));
  effectTest("cancelling a published mount retires only its own acquisition", () =>
    Effect.gen(function*() {
      const released: Array<number> = [];
      const published = yield* Deferred.make<boolean>();
      const owner = yield* makeSerialOwner<number>(value => Effect.sync(() => released.push(value)));
      const mounting = yield* Effect.forkChild(Effect.scoped(
        owner.replaceScoped(Effect.succeed(1), Effect.die).pipe(
          Effect.andThen(Deferred.succeed(published, true)),
          Effect.andThen(Effect.never),
        ),
      ));
      yield* Deferred.await(published);
      expect(Option.getOrThrow(owner.current())).toBe(1);
      yield* owner.replaceScoped(Effect.succeed(2), Effect.die);
      yield* Fiber.interrupt(mounting);
      expect(released).toEqual([1]);
      expect(Option.getOrThrow(owner.current())).toBe(2);
      yield* owner.close();
      expect(released).toEqual([1, 2]);
    }));
  effectTest(
    "a mount scope closed during acquisition retires publication without deadlock",
    () =>
      Effect.gen(function*() {
        const released: Array<number> = [];
        const started = yield* Deferred.make<boolean>();
        const ready = yield* Deferred.make<number>();
        const scope = yield* Scope.make();
        const owner = yield* makeSerialOwner<number>(value => Effect.sync(() => released.push(value)));
        const mounting = yield* Effect.forkChild(
          owner.replaceScoped(
            Deferred.succeed(started, true).pipe(Effect.andThen(Deferred.await(ready))),
            Effect.die,
          ).pipe(Scope.provide(scope)),
        );
        yield* Deferred.await(started);
        yield* Scope.close(scope, Exit.void);
        yield* Deferred.succeed(ready, 7);
        yield* Fiber.join(mounting);
        expect(released).toEqual([7]);
        expect((yield* owner.inspect).active).toBe(false);
        yield* owner.close();
        expect(released).toEqual([7]);
      }),
  );
  effectTest("failed release quarantines and prevents overlapping acquisition", () =>
    Effect.gen(function*() {
      const owner = yield* makeSerialOwner<number>(() => Effect.fail(fault("release", "injected failure")));
      yield* owner.replace(Effect.succeed(1));
      const attempts = { value: 0 };
      expect(Exit.isFailure(yield* Effect.exit(owner.replace(Effect.sync(() => ++attempts.value))))).toBe(true);
      expect(attempts.value).toBe(0);
      expect((yield* owner.inspect).quarantined).toBe(true);
    }));
  effectTest("slow release hits a 100ms bound and quarantines", () =>
    Effect.gen(function*() {
      const releaseStarted = yield* Deferred.make<boolean>();
      const owner = yield* makeSerialOwner<number>(
        () => Deferred.succeed(releaseStarted, true).pipe(Effect.andThen(Effect.never)),
        100,
      );
      yield* owner.replace(Effect.succeed(1));
      const close = yield* Effect.forkChild(Effect.exit(owner.close()));
      yield* Deferred.await(releaseStarted);
      yield* TestClock.adjust(100);
      expect(Exit.isFailure(yield* Fiber.join(close))).toBe(true);
      expect((yield* owner.inspect).quarantined).toBe(true);
    }));
  effectTest("obsolete queued acquisition is skipped", () =>
    Effect.gen(function*() {
      const releaseStarted = yield* Deferred.make<boolean>();
      const owner = yield* makeSerialOwner<number>(() =>
        Deferred.succeed(releaseStarted, true).pipe(Effect.andThen(Effect.sleep(30)))
      );
      const acquired: Array<number> = [];
      yield* owner.replace(Effect.succeed(0));
      const first = yield* Effect.forkChild(owner.replace(Effect.sync(() => {
        acquired.push(1);
        return 1;
      })));
      yield* Deferred.await(releaseStarted);
      const second = yield* Effect.forkChild(owner.replace(Effect.sync(() => {
        acquired.push(2);
        return 2;
      })));
      yield* TestClock.adjust(30);
      expect(Option.isNone(yield* Fiber.join(first))).toBe(true);
      expect(Option.getOrThrow(yield* Fiber.join(second))).toBe(2);
      expect(acquired).toEqual([2]);
      const close = yield* Effect.forkChild(owner.close());
      yield* TestClock.adjust(30);
      yield* Fiber.join(close);
    }));
  effectTest("foreign value arriving after interruption is still disposed", () =>
    Effect.gen(function*() {
      const callbacks = { receive: Option.none<(value: number) => void>() };
      const started = yield* Deferred.make<boolean>();
      const disposed: Array<number> = [];
      const fiber = yield* Effect.forkChild(Effect.scoped(scopedForeignValue<number>((receive) => {
        callbacks.receive = Option.some(receive);
        Deferred.doneUnsafe(started, Effect.succeed(true));
      }, value =>
        disposed.push(value), () => {})));
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      Option.getOrThrow(callbacks.receive)(42);
      expect(disposed).toEqual([42]);
    }));
  effectTest("late cleanup failure is observable rather than reported as success", () =>
    Effect.gen(function*() {
      const callbacks = { receive: Option.none<(value: number) => void>() };
      const failures: Array<string> = [];
      const started = yield* Deferred.make<boolean>();
      const fiber = yield* Effect.forkChild(Effect.scoped(scopedForeignValue<number>((receive) => {
        callbacks.receive = Option.some(receive);
        Deferred.doneUnsafe(started, Effect.succeed(true));
      }, () => {
        // oxlint-disable-next-line effect/noThrowStatement -- The foreign callback fixture must throw synchronously after cancellation to prove late cleanup failure retention.
        throw fault("injected", "injected disposal");
      }, error => failures.push(error.phase))));
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      Option.getOrThrow(callbacks.receive)(42);
      expect(failures).toEqual(["late-dispose"]);
    }));
});

describe("Content-qualified shared leases", () => {
  effectTest("one consumer cancellation leaves the shared load alive", () =>
    Effect.gen(function*() {
      const ready = yield* Deferred.make<number>();
      const acquired = yield* Queue.unbounded<number>();
      const disposed: Array<number> = [];
      const pool = yield* makeLeasePool(() => Deferred.await(ready), value =>
        Effect.sync(() => {
          disposed.push(value);
        }));
      const consumer = Effect.scoped(
        pool.acquire(key).pipe(Effect.flatMap(value => Queue.offer(acquired, value)), Effect.andThen(Effect.never)),
      );
      const first = yield* Effect.forkChild(consumer);
      const second = yield* Effect.forkChild(consumer);
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(first);
      yield* Deferred.succeed(ready, 7);
      expect(yield* Queue.take(acquired)).toBe(7);
      expect(disposed).toEqual([]);
      yield* Fiber.interrupt(second);
      expect(disposed).toEqual([7]);
      expect((yield* pool.inspect).entries).toBe(0);
    }));
  effectTest("zero leases interrupts a pending load exactly once", () =>
    Effect.gen(function*() {
      const count = { cancelled: 0 };
      const started = yield* Deferred.make<boolean>();
      const pool = yield* makeLeasePool(() =>
        Deferred.succeed(started, true).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              count.cancelled++;
            })
          ),
        ), () => Effect.void);
      const consumer = yield* Effect.forkChild(Effect.scoped(pool.acquire(key)));
      yield* Deferred.await(started);
      yield* Fiber.interrupt(consumer);
      expect(count.cancelled).toBe(1);
      expect((yield* pool.inspect).entries).toBe(0);
    }));
  effectTest("failed shared load is evicted and retry is fresh", () =>
    Effect.gen(function*() {
      const count = { attempts: 0, released: 0 };
      const pool = yield* makeLeasePool(
        () => Effect.suspend(() => ++count.attempts === 1 ? Effect.fail(fault("load", "injected")) : Effect.succeed(2)),
        () =>
          Effect.sync(() => {
            count.released++;
          }),
      );
      expect(Exit.isFailure(yield* Effect.exit(Effect.scoped(pool.acquire(key))))).toBe(true);
      expect(yield* Effect.scoped(pool.acquire(key))).toBe(2);
      expect(count.attempts).toBe(2);
      expect(count.released).toBe(1);
    }));
  effectTest("same URL with different content digests never shares a value", () =>
    Effect.gen(function*() {
      const count = { attempts: 0 };
      const pool = yield* makeLeasePool(() => Effect.sync(() => ++count.attempts), () => Effect.void);
      const a = yield* pool.acquire(key);
      const b = yield* pool.acquire({ ...key, sha256: "b".repeat(64) });
      expect(a).not.toBe(b);
      expect((yield* pool.inspect).entries).toBe(2);
    }));
  effectTest("old failed entry cannot evict its same-key replacement", () =>
    Effect.gen(function*() {
      const count = { attempts: 0 };
      const firstStarted = yield* Deferred.make<boolean>();
      const pool = yield* makeLeasePool(() =>
        Effect.suspend(() =>
          ++count.attempts === 1
            ? Deferred.succeed(firstStarted, true).pipe(Effect.andThen(Effect.never))
            : Effect.succeed(2)
        ), () => Effect.void);
      const first = yield* Effect.forkChild(Effect.scoped(pool.acquire(key)));
      yield* Deferred.await(firstStarted);
      yield* Fiber.interrupt(first);
      expect(yield* pool.acquire(key)).toBe(2);
      expect((yield* pool.inspect).entries).toBe(1);
    }));
  effectTest("disposal failures are retained after cache eviction", () =>
    Effect.gen(function*() {
      const pool = yield* makeLeasePool(() => Effect.succeed(1), () => Effect.fail(fault("release", "injected")));
      yield* Effect.scoped(pool.acquire(key));
      expect((yield* pool.inspect).cleanupFailures.length).toBe(1);
    }));
  effectTest("100 scoped acquisitions release each value exactly once", () =>
    Effect.gen(function*() {
      const count = { acquired: 0, released: 0 };
      const pool = yield* makeLeasePool(() => Effect.sync(() => ++count.acquired), () =>
        Effect.sync(() => {
          count.released++;
        }));
      yield* Effect.forEach(Array.from({ length: 100 }, (_, i) => i), () => Effect.scoped(pool.acquire(key)));
      expect(count.acquired).toBe(100);
      expect(count.released).toBe(100);
      expect((yield* pool.inspect).entries).toBe(0);
    }));
});

/* oxlint-disable effect/noThrowStatement -- This test fixture models foreign synchronous SDK mutation/allocation/disposal failures, including mutation before throwing. */
const resources = () => {
  const count = {
    acquired: 0,
    released: 0,
    failPrepare: false,
    failWrite: false,
    failRollback: false,
    failRetire: false,
  };
  const create = (marker: Marker): Resource => {
    if (count.failPrepare && marker.id === "b") throw fault("injected", "injected allocation");
    const geometry = marker.kind === "box" ? new THREE.BoxGeometry() : new THREE.SphereGeometry();
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.x = marker.x;
    return {
      token: ++count.acquired,
      kind: marker.kind,
      read: () => mesh.position.x,
      write: x => {
        mesh.position.x = x;
        if (count.failWrite && x === 99) throw fault("injected", "mutated then threw");
        if (count.failRollback && x === 0) throw fault("injected", "rollback failed");
      },
      dispose: () => {
        geometry.dispose();
        material.dispose();
        count.released++;
        if (count.failRetire) throw fault("injected", "retirement uncertain");
      },
    };
  };
  return { count, create };
};
/* oxlint-enable effect/noThrowStatement */
const frame = (x: number, kind: Marker["kind"] = "box") => ({ revision: 1, markers: [{ id: "a", x, kind }] });
describe("Transactional host, real Three.js objects", () => {
  effectTest("write after mutation rolls back old values and preserves identity", () =>
    Effect.gen(function*() {
      const fixture = resources();
      const host = yield* makeTransactionalHost(fixture.create);
      yield* host.apply(frame(0));
      const before = yield* host.inspect;
      fixture.count.failWrite = true;
      expect(Exit.isFailure(yield* Effect.exit(host.apply(frame(99))))).toBe(true);
      expect((yield* host.inspect).resources).toEqual(before.resources);
      yield* host.close;
    }));
  effectTest("failed preparation leaves the old scene untouched", () =>
    Effect.gen(function*() {
      const fixture = resources();
      const host = yield* makeTransactionalHost(fixture.create);
      yield* host.apply(frame(0));
      fixture.count.failPrepare = true;
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            host.apply({ revision: 2, markers: [{ id: "a", x: 4, kind: "sphere" }, { id: "b", x: 5, kind: "box" }] }),
          ),
        ),
      ).toBe(true);
      expect((yield* host.inspect).resources[0]?.x).toBe(0);
      expect(fixture.count.released).toBe(1);
      yield* host.close;
    }));
  effectTest("failed rollback quarantines future updates", () =>
    Effect.gen(function*() {
      const fixture = resources();
      const host = yield* makeTransactionalHost(fixture.create);
      yield* host.apply(frame(0));
      fixture.count.failWrite = true;
      fixture.count.failRollback = true;
      yield* Effect.exit(host.apply(frame(99)));
      expect((yield* host.inspect).poisoned).toBe(true);
      expect(Exit.isFailure(yield* Effect.exit(host.apply(frame(3))))).toBe(true);
      yield* host.close;
    }));
  effectTest("retirement failure is distinct from a failed commit", () =>
    Effect.gen(function*() {
      const fixture = resources();
      const host = yield* makeTransactionalHost(fixture.create);
      yield* host.apply(frame(0));
      fixture.count.failRetire = true;
      yield* Effect.exit(host.apply(frame(4, "sphere")));
      expect((yield* host.inspect).resources[0]?.x).toBe(4);
      expect((yield* host.inspect).poisoned).toBe(true);
      fixture.count.failRetire = false;
      yield* host.close;
    }));
  effectTest("same ID, incompatible kind replaces the resource", () =>
    Effect.gen(function*() {
      const fixture = resources();
      const host = yield* makeTransactionalHost(fixture.create);
      yield* host.apply(frame(0));
      yield* host.apply(frame(1, "sphere"));
      expect(fixture.count.acquired).toBe(2);
      expect(fixture.count.released).toBe(1);
      yield* host.close;
    }));
  effectTest("duplicate IDs and non-finite coordinates fail before allocation", () =>
    Effect.gen(function*() {
      const fixture = resources();
      const host = yield* makeTransactionalHost(fixture.create);
      yield* Effect.exit(host.apply(frame(NaN)));
      yield* Effect.exit(
        host.apply({ revision: 0, markers: [{ id: "a", x: 0, kind: "box" }, { id: "a", x: 1, kind: "box" }] }),
      );
      expect(fixture.count.acquired).toBe(0);
    }));
  effectTest("2000 deterministic reconciliations release all Three resources", () =>
    Effect.gen(function*() {
      const fixture = resources();
      const host = yield* makeTransactionalHost(fixture.create);
      const random = { seed: 20261012 };
      yield* Effect.forEach(Array.from({ length: 2000 }, (_, i) => i), index =>
        Effect.gen(function*() {
          random.seed = (Math.imul(random.seed, 1664525) + 1013904223) >>> 0;
          yield* host.apply({
            revision: index % 13,
            markers: Array.from(
              { length: random.seed % 6 },
              (_, id): Marker => ({
                id: String(id),
                x: (random.seed % 100) / 10,
                kind: ((random.seed >>> id) & 1) === 0 ? "box" : "sphere",
              }),
            ),
          });
        }));
      yield* host.close;
      expect(fixture.count.acquired).toBe(fixture.count.released);
      expect((yield* host.inspect).resources.length).toBe(0);
    }));
});

describe("Counterexamples, buffer ownership and randomized leases", () => {
  effectTest("negative control: revision ordering incorrectly drops historical A", () =>
    Effect.sync(() => {
      const revisions = [8, 9, 8];
      const state = { revision: -1 };
      const accepted: Array<number> = [];
      revisions.forEach(revision => {
        if (revision > state.revision) {
          state.revision = revision;
          accepted.push(revision);
        }
      });
      expect(accepted).toEqual([8, 9]);
      expect(accepted).not.toEqual(revisions);
    }));
  effectTest("negative control: reference equality rejects a cloned receipt", () =>
    Effect.sync(() => {
      const receipt = { generation: 1, sequence: 2 };
      const transported = structuredClone(receipt);
      expect(receipt).not.toBe(transported);
      expect(receipt).toEqual(transported);
    }));
  effectTest("negative control: URL-only cache returns stale content", () =>
    Effect.sync(() => {
      const cache = new Map([["asset:desk", "v1"]]);
      const newDigest = "b".repeat(64);
      expect(cache.get("asset:desk")).toBe("v1");
      expect(cache.get(`asset:desk:${newDigest}`)).toBeUndefined();
    }));
  effectTest("negative control: allocation-only rollback misses mutations", () =>
    Effect.sync(() => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
      const allocations: Array<THREE.BufferGeometry> = [];
      const failed = Result.try({
        try: () => {
          mesh.position.x = 99;
          // oxlint-disable-next-line effect/noThrowStatement -- This negative control reproduces a foreign synchronous operation that mutates before failure.
          throw fault("injected", "later operation failed");
        },
        catch: cause => fault("negative-control", cause),
      });
      if (Result.isFailure(failed)) allocations.forEach(geometry => geometry.dispose());
      expect(mesh.position.x).toBe(99);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }));
  effectTest("history buffer survives transfer of a renderer-owned copy", () =>
    Effect.sync(() => {
      const history = new Float32Array([1, 2, 3]);
      const rendererOwned = history.slice();
      const message = structuredClone({ positions: rendererOwned }, { transfer: [rendererOwned.buffer] });
      expect(rendererOwned.byteLength).toBe(0);
      expect(history.byteLength).toBe(12);
      message.positions[0] = 9;
      expect(Array.from(history)).toEqual([1, 2, 3]);
    }));
  effectTest("3000 seeded lease operations release each resource once", () =>
    Effect.gen(function*() {
      const state = { seed: 0x85123211, created: 0 };
      const random = () => {
        state.seed ^= state.seed << 13;
        state.seed ^= state.seed >>> 17;
        state.seed ^= state.seed << 5;
        return state.seed >>> 0;
      };
      const live = new Set<number>();
      const disposed = new Set<number>();
      const scopes: Array<Scope.Closeable> = [];
      const pool = yield* makeLeasePool(() =>
        Effect.sync(() => {
          const id = ++state.created;
          live.add(id);
          return id;
        }), id =>
        Effect.sync(() => {
          expect(live.delete(id)).toBe(true);
          expect(disposed.has(id)).toBe(false);
          disposed.add(id);
        }));
      for (let step = 0; step < 3000; step++) {
        if (scopes.length === 0 || random() % 3 !== 0) {
          const scope = yield* Scope.make();
          scopes.push(scope);
          yield* pool.acquire({ url: `asset:${random() % 13}`, sha256: "a".repeat(64) }).pipe(
            Effect.provideService(Scope.Scope, scope),
          );
        } else {
          const scope = scopes.splice(random() % scopes.length, 1)[0];
          if (scope) {
            yield* Scope.close(scope, Exit.void);
            if (random() % 2 !== 0) yield* Scope.close(scope, Exit.void);
          }
        }
      }
      yield* Effect.forEach(scopes, scope => Scope.close(scope, Exit.void));
      expect(live.size).toBe(0);
      expect((yield* pool.inspect).entries).toBe(0);
      expect(disposed.size).toBe(state.created);
    }));
});
