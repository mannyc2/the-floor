import { Clock, Effect, Option } from "effect";
import type { DevToolsStore } from "foldkit/devtools-host";
import { browserCall, nextFrame, settled, WorkbenchFailure } from "./runtime";

// Checkpoints are recorded through the same controls as a person uses. The
// hashes read current GPU pixels, so replay cannot pass by reusing a saved frame.
export const replayProbe = Effect.fn("Workbench.replay")(
  function*(
    store: DevToolsStore,
    entries: () => ReadonlyArray<{ index: number; tag: string }>,
    hash: () => Promise<string>,
    rendered: () => { readonly revision: number; readonly theme: string },
  ) {
    const clock = yield* Clock.Clock;
    const now = () => Number(clock.monotonicTimeNanosUnsafe()) / 1e6;
    const acknowledged = Effect.fn("Workbench.acknowledgedCheckpoint")(function*(revision: number, theme: string) {
      while (rendered().revision !== revision || rendered().theme !== theme) yield* nextFrame;
      yield* settled;
    }, Effect.timeout("5 seconds"));
    const live = yield* Effect.forEach(
      ["a", "b", "a", "b", "a"],
      Effect.fnUntraced(function*(letter) {
        yield* Effect.sleep(250);
        const button = document.getElementById(`frame-${letter}`);
        if (!(button instanceof HTMLButtonElement)) {
          return yield* new WorkbenchFailure({ operation: "record-checkpoint", cause: "Recording button missing" });
        }
        button.click();
        const revision = letter === "a" ? 1 : 2, theme = letter === "a" ? "day" : "night";
        yield* acknowledged(revision, theme);
        const recorded = yield* browserCall("frame-hash", hash);
        const entry = Option.fromUndefinedOr(
          entries().findLast((candidate) => candidate.tag.includes(letter === "a" ? "ClickedFrameA" : "ClickedFrameB")),
        );
        if (Option.isNone(entry)) {
          return yield* new WorkbenchFailure({ operation: "record-checkpoint", cause: "Missing Foldkit checkpoint" });
        }
        return { index: entry.value.index, hash: recorded, revision, theme };
      }),
      { concurrency: 1 },
    );
    const replay = Effect.fn("Workbench.replayAtSpeed")(function*(speed: number) {
      const start = now();
      const checkpoints = yield* Effect.forEach(
        live,
        Effect.fnUntraced(function*(point) {
          yield* Effect.sleep(250 / speed);
          yield* store.jumpTo(point.index);
          yield* acknowledged(point.revision, point.theme);
          return { index: point.index, expected: point.hash, hash: yield* browserCall("replayed-frame-hash", hash) };
        }),
        { concurrency: 1 },
      );
      return { speed, elapsedMs: now() - start, checkpoints };
    });
    const one = yield* replay(1), ten = yield* replay(10);
    yield* store.resume;
    return { clock: "Effect Clock monotonicTimeNanosUnsafe", live, one, ten };
  },
);
