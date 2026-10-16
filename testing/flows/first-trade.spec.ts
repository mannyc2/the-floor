import { NodeServices } from "@effect/platform-node";
import { cameraValues } from "@floor/atlas/camera";
import { materialPalette } from "@floor/atlas/materials";
import { Receipt } from "@floor/contract/economics";
import { AgentId, ChainRef, WorldId } from "@floor/contract/identifiers";
import { expect, test } from "@playwright/test";
import { Config, Effect, FileSystem, Option, Schema } from "effect";

const publicMetadata = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const agentPath = yield* Config.String("FLOOR_TRADE_METADATA").pipe(
    Config.withDefault("work/first-trade/agent.json"),
  );
  const forkPath = yield* Config.String("FLOOR_FORK_METADATA").pipe(Config.withDefault("work/first-trade/fork.json"));
  const agent = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({
    url: Schema.String,
    mandate: Schema.Json,
  })))(yield* fs.readFileString(agentPath));
  const identity = yield* Schema.decodeUnknownEffect(Schema.Struct({
    world: WorldId,
    intent: Schema.Struct({ agent: AgentId, chain: ChainRef }),
  }))(agent.mandate);
  const fork = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({
    configuration: Schema.Struct({ endpoint: Schema.String }),
  })))(yield* fs.readFileString(forkPath));
  return { ...agent, identity, endpoint: fork.configuration.endpoint };
}).pipe(Effect.provide(NodeServices.layer));

// @effect-diagnostics-next-line asyncFunction:off -- Playwright owns this native browser flow and its promise lifecycle.
test("a live desk follows its agent and opens the settled fork receipt", async ({ page, request }) => {
  const metadata = await Effect.runPromise(publicMetadata);
  const url = new URL(metadata.url);
  url.searchParams.set("world", metadata.identity.world);
  url.searchParams.set("chain", metadata.identity.intent.chain);
  const errors: Array<string> = [];
  const logs: Array<string> = [];
  let offline = false;
  page.on("console", message => {
    logs.push(`${message.type()}: ${message.text()}`);
    const expectedDisconnect = offline && message.text().includes("net::ERR_INTERNET_DISCONNECTED");
    if (message.type() === "error" && !expectedDisconnect) errors.push(message.text());
  });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(url.href);
  await expect(page.getByText("World connected", { exact: true })).toBeVisible();
  await expect(page.getByText("Rendering live world", { exact: true })).toBeVisible();
  const ready = page.waitForEvent("console", message => message.text() === "first-trade observer ready");
  const observations = page.evaluate(({ activeColor }) => {
    // @effect-diagnostics-next-line newPromise:off -- This browser-only observer reports real DOM/GPU changes without replacing application behavior.
    return new Promise<{ states: Array<string>; activeFrames: number }>(resolve => { // oxlint-disable-line effect/noNewPromise -- Playwright serializes this observer into the browser where Effect is unavailable.
      const states: Array<string> = [];
      let activeFrames = 0;
      let finished = false;
      const canvas = document.querySelector("canvas");
      const gl = canvas?.getContext("webgl2");
      const pixels = canvas ? new Uint8Array(canvas.width * canvas.height * 4) : new Uint8Array();
      const record = () => {
        document.querySelectorAll("[data-agent-state]").forEach(element => {
          const state = element.getAttribute("data-agent-state") ?? "";
          if (state.length > 0 && states.at(-1) !== state) states.push(state);
        });
      };
      const observer = new MutationObserver(record);
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-agent-state"],
      });
      const finish = () => {
        if (finished) return;
        finished = true;
        observer.disconnect();
        resolve({ states, activeFrames });
      };
      const sample = () => {
        if (finished) return;
        if (canvas && gl) {
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          for (let index = 0; index < pixels.length; index += 4) {
            if (
              pixels[index] === activeColor[0] && pixels[index + 1] === activeColor[1]
              && pixels[index + 2] === activeColor[2]
            ) {
              activeFrames++;
              break;
            }
          }
        }
        if (states.includes("idle")) finish();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      // @effect-diagnostics-next-line globalTimers:off -- The native observation deadline prevents a broken UI from leaving a pending browser promise.
      setTimeout(finish, 60_000); // oxlint-disable-line effect/noGlobals -- The browser observer needs a bounded native deadline and cannot import Effect.
      // @effect-diagnostics-next-line globalConsole:off -- This handshake installs the observation before the real agent is triggered.
      console.info("first-trade observer ready"); // oxlint-disable-line effect/noGlobals -- Playwright waits on this observer-ready handshake before starting the real trade.
    });
  }, {
    activeColor: [
      (materialPalette.colors["screen-light-0"].day >>> 16) & 255,
      (materialPalette.colors["screen-light-0"].day >>> 8) & 255,
      materialPalette.colors["screen-light-0"].day & 255,
    ],
  });
  await ready;
  const response = await request.post(new URL("/trade", url).href, { data: metadata.mandate });
  expect(response.ok(), await response.text()).toBe(true);
  const receipt = await Effect.runPromise(Schema.decodeUnknownEffect(Receipt)(await response.json()));
  expect(receipt._tag).toBe("SettledReceipt");
  if (receipt._tag !== "SettledReceipt") return;
  const observed = await observations;
  Effect.runSync(Effect.logInfo("Observed live world", observed));
  expect(observed.states).toContain("researching");
  expect(observed.states).toContain("trading");
  expect(observed.states.at(-1)).toBe("idle");
  expect(observed.states.indexOf("researching")).toBeLessThan(observed.states.indexOf("trading"));
  expect(observed.activeFrames).toBeGreaterThan(0);

  // This point is the first canonical desk's tabletop, projected with the
  // production camera basis. The click goes through the GPU picking path.
  const canvas = page.locator("#map canvas");
  const bounds = await canvas.boundingBox();
  expect(bounds).toBeTruthy();
  if (!bounds) return;
  const distance = Math.hypot(
    cameraValues.horizontalOffset,
    cameraValues.horizontalOffset,
    cameraValues.verticalOffset,
  );
  const upHorizontal = -cameraValues.verticalOffset / distance / Math.SQRT2;
  const upVertical = Math.SQRT2 * cameraValues.horizontalOffset / distance;
  await canvas.click({
    position: {
      x: bounds.width / 2 + Math.SQRT2 * bounds.height / 21,
      y: bounds.height / 2 - (2 * upHorizontal + .33 * upVertical) * bounds.height / 21,
    },
  });
  const drawer = page.getByRole("complementary", { name: "Agent desk" });
  await expect(drawer.getByRole("heading", { name: metadata.identity.intent.agent, exact: true })).toBeVisible();
  await expect(drawer.locator("[data-agent-state]")).toHaveText("idle");
  await expect(drawer.getByText("Settled · succeeded", { exact: true })).toBeVisible();
  await expect(drawer.getByText(receipt.id, { exact: true })).toBeVisible();
  await expect(drawer.locator("[data-transaction]")).toHaveText(receipt.transaction.hash);
  await expect(drawer.getByText(receipt.checkpoint.height, { exact: true })).toBeVisible();
  const transactionResponse = await request.post(metadata.endpoint, {
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [
        receipt.transaction.hash,
        { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
      ],
    },
  });
  const transaction = await Effect.runPromise(
    Schema.decodeUnknownEffect(Schema.Struct({
      result: Schema.Struct({
        slot: Schema.Natural,
        meta: Schema.Struct({ err: Schema.OptionFromNullOr(Schema.Json) }),
        transaction: Schema.Struct({ signatures: Schema.Array(Schema.String) }),
      }),
    }))(await transactionResponse.json()),
  );
  expect(transaction.result.transaction.signatures).toContain(receipt.transaction.hash);
  expect(String(transaction.result.slot)).toBe(receipt.checkpoint.height);
  expect(Option.isNone(transaction.result.meta.err)).toBe(true);
  await page.screenshot({ path: "work/flows/first-trade/settled.png", fullPage: true });
  offline = true;
  await page.context().setOffline(true);
  await expect(page.getByText("World disconnected · reconnecting from the last event", { exact: true })).toBeVisible();
  await expect(drawer.locator("[data-transaction]")).toHaveText(receipt.transaction.hash);
  await page.context().setOffline(false);
  await expect(page.getByText("World connected", { exact: true })).toBeVisible();
  offline = false;
  await expect(drawer.locator("[data-transaction]")).toHaveText(receipt.transaction.hash);
  await page.reload();
  await expect(page.getByText("World connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Open desk for ${metadata.identity.intent.agent}` }).click();
  await expect(drawer.locator("[data-transaction]")).toHaveText(receipt.transaction.hash);
  await test.info().attach("world-observation", {
    body: await Effect.runPromise(Schema.encodeEffect(Schema.fromJsonString(Schema.Json))({ ...observed, logs })),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});
