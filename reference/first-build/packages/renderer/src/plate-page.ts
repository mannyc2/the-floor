import { Effect, Result, Schema } from "effect";
import { PlateRenderJson } from "./plate";

const setStatus = (message: string): void => {
  const status = document.getElementById("status");
  if (status) status.textContent = message;
};
const parsed = Schema.decodeResult(PlateRenderJson)(decodeURIComponent(window.location.hash.slice(1)));
const host = document.getElementById("scene");
if (Result.isFailure(parsed)) setStatus("A valid retained market observation is required.");
else if (host) {
  // The capture page validates inert data before downloading the shared scene renderer.
  Effect.promise(() => import("./plate-scene")).pipe(
    Effect.flatMap(scene => Effect.sync(() => scene.renderPlateScene(parsed.success, host))),
    Effect.catchCause(() => Effect.sync(() => setStatus("The retained market scene could not be drawn."))),
    Effect.runFork,
  );
}
