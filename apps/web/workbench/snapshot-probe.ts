import { Clock, Effect, Option } from "effect";
import type { InstanceSnapshot } from "../src/map/_lib/renderer/instances";
import type { Mounted, RendererFrame } from "../src/map/_lib/renderer/service";
import { nextFrame } from "./runtime";
import { makeUploadOracle } from "./upload-oracle";

const coordinatesMatch = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.abs(a.x - b.x) < 1e-5 && Math.abs(a.y - b.y) < 1e-5 && Math.abs(a.z - b.z) < 1e-5;

// The only periodic source is this development probe. The mounted service
// receives complete snapshots, exactly as a future world subscription will.
export const snapshotStream = Effect.fn("Workbench.snapshotStream")(function*(mounted: Mounted) {
  const clock = yield* Clock.Clock;
  const now = () => Number(clock.monotonicTimeNanosUnsafe()) / 1e6;
  const { engine, service } = mounted;
  const baseline = engine.instancePositions().map(({ id, x, y, z }) => ({ id, x, y, z }));
  // Warm shader programs and the complete decode/diff/upload path. Retain cold
  // costs separately so a steady-state budget cannot disguise startup work.
  const warmup: Array<{ revision: number; snapshotCpuMs: number }> = [];
  const firstRevision = engine.inspect().snapshotRevision + 1;
  yield* Effect.forEach(
    Array.from({ length: 16 }, (_, step) => step),
    Effect.fnUntraced(function*(step) {
      const revision = firstRevision + step;
      const instances = baseline.map(instance => ({ ...instance, x: instance.x + (step % 2 === 0 ? .25 : 0) }));
      const started = now();
      yield* service.snapshot({ revision, instances });
      warmup.push({ revision, snapshotCpuMs: now() - started });
      yield* nextFrame;
      engine.draw(true);
    }),
  );
  yield* Effect.sleep(250);
  yield* nextFrame;
  engine.finishFrame();
  const uploads = makeUploadOracle(engine);
  const frames: Array<RendererFrame> = [];
  const received: Array<{
    revision: number;
    scheduledMs: number;
    receivedMs: number;
    acceptedMs: number;
    observedMs: number;
    changedInstances: number;
    changedAttributes: number;
    expected: ReturnType<typeof uploads.readExpected>;
    targetsMatch: boolean;
  }> = [];
  // Input construction is the synthetic source, not renderer work. Prepare it
  // before the clock starts; validation and reconciliation stay inside it.
  const snapshots: ReadonlyArray<InstanceSnapshot> = Array.from({ length: 48 }, (_, step) => {
    const phase = step - Math.floor(step / 6);
    const offset = (phase % 5 - 2) / 4;
    const instances = baseline.map(instance => ({ ...instance, x: instance.x + offset, z: instance.z - offset }));
    return { revision: firstRevision + 16 + step, instances: step % 2 === 0 ? instances : instances.toReversed() };
  });
  let started = now();
  let pendingUpload = false;
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      mounted.observeFrames(sample => {
        frames.push({ ...sample, atMs: sample.atMs - started });
        if (pendingUpload && sample.draws > 0) {
          uploads.acknowledge();
          pendingUpload = false;
        }
      })
    ),
    remove => Effect.sync(remove),
  );
  yield* Effect.logInfo("Synthetic snapshot stream started", { desks: baseline.length, frequencyHz: 4, snapshots: 48 });
  started = now();
  yield* Effect.forEach(
    snapshots,
    Effect.fnUntraced(function*(snapshot, step) {
      yield* Effect.sleep(Math.max(0, started + step * 250 - now()));
      // Every sixth arrival repeats a target; other arrivals move all instances.
      // Reversing wire order catches accidental index-based reconciliation.
      const receivedMs = now() - started;
      const receipt = yield* service.snapshot(snapshot);
      const acceptedMs = now() - started;
      pendingUpload = true;
      const actual = new Map(engine.instancePositions().map(instance => [instance.id, instance]));
      const expected = uploads.readExpected();
      const targetsMatch = snapshot.instances.every(instance =>
        Option.exists(
          Option.fromUndefinedOr(actual.get(instance.id)),
          value => value.visible && coordinatesMatch(instance, value.target),
        )
      );
      // The oracle is probe overhead, not renderer CPU. Retain its duration so
      // delayed producer callbacks cannot be attributed to rendering by omission.
      received.push({
        ...receipt,
        scheduledMs: step * 250,
        receivedMs,
        acceptedMs,
        observedMs: now() - started,
        expected,
        targetsMatch,
      });
    }),
    { concurrency: 1 },
  );
  yield* Effect.sleep(Math.max(0, started + 12000 - now()));
  // Include the last arrival's interpolation completion and upload observation.
  const last = received.at(-1);
  if (last) yield* Effect.sleep(Math.max(0, started + last.acceptedMs + 250 - now()));
  yield* nextFrame;
  yield* nextFrame;
  yield* Effect.logInfo("Synthetic snapshot stream completed", { snapshots: received.length, frames: frames.length });
  return {
    source: "synthetic-workbench-only",
    requestedFrequencyHz: 4,
    durationMs: now() - started,
    count: baseline.length,
    before: baseline,
    warmup,
    received,
    frames,
    after: engine.instancePositions(),
    info: engine.inspect(),
    limits:
      "CPU submission, decoding and instance diff only; no GPU timer query, physical bus traffic or real-phone claim",
  };
}, Effect.scoped);
