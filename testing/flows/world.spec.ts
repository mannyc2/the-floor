import { NodeServices } from "@effect/platform-node";
import { cameraValues } from "@floor/atlas/camera";
import {
  AgentId,
  ChainRef,
  Checkpoint,
  DeskId,
  Digest,
  Height,
  TradingPostId,
  WorldId,
} from "@floor/contract/identifiers";
import { defaultWorldLayout } from "@floor/contract/settings";
import {
  AgentLocation,
  canonicalFloorOrigin,
  canonicalPostAnchor,
  canonicalStationPosition,
} from "@floor/contract/world";
import { MoveInWorld } from "@floor/contract/world-stream";
import { expect, type Page, test } from "@playwright/test";
import { Array, Clock, Config, DateTime, Effect, FileSystem, Option, Schema } from "effect";

const viewerUrl = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Config.String("FLOOR_TRADE_METADATA").pipe(Config.withDefault("work/first-trade/agent.json"));
  const metadata = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({ url: Schema.String })))(
    yield* fs.readFileString(path),
  );
  return new URL(metadata.url).origin;
}).pipe(Effect.provide(NodeServices.layer));

// A separate world with labelled synthetic evidence. The harness publishes it
// through the Floor's internal world service; nothing is arranged in the page.
const world = WorldId.make(`synthetic-floors-${Effect.runSync(Clock.currentTimeMillis)}`);
const chain = ChainRef.make("solana:synthetic-floors");
const checkpoint = Checkpoint.make({
  chain,
  height: Height.make("1"),
  hash: Digest.make("synthetic-floors-block"),
  time: DateTime.makeUnsafe("2026-10-16T12:00:00.000Z"),
});
// One more arrival than the default floor holds opens the second floor.
const capacity = defaultWorldLayout.postsPerFloor * defaultWorldLayout.stationsPerPost;
const agents = Array.makeBy(capacity + 1, index => AgentId.make(`synthetic-floor-agent-${index}`));
const traveller = Array.lastNonEmpty(agents);
const post = TradingPostId.make("floor_1_post_0");
// The oracle is the contract's canonical layout, independent of the viewer's
// mapping. The viewer's frame puts the first floor's origin at zero.
const origin = (index: number) => Option.getOrThrow(canonicalFloorOrigin(index, defaultWorldLayout.postsPerFloor));
const relative = (index: number, point: { readonly x: number; readonly z: number }) => ({
  x: origin(index).x + point.x - origin(0).x,
  z: origin(index).z + point.z - origin(0).z,
});
const secondFloor = relative(1, { x: 0, z: 0 });
const travellerDesk = relative(
  1,
  Option.getOrThrow(canonicalStationPosition(0, 0, defaultWorldLayout.stationsPerPost)),
);
const travellerPost = relative(1, Option.getOrThrow(canonicalPostAnchor(0)));

const encodeMove = Schema.encodeEffect(Schema.toCodecJson(MoveInWorld));
const cameraOf = (page: Page) => {
  const query = new URL(page.url()).searchParams;
  return { x: Number(query.get("x")), z: Number(query.get("z")), sequence: Number(query.get("sequence")) };
};
// The production camera basis projects a ground point at the default zoom;
// clicks then go through the renderer's GPU picking path.
const distance = Math.hypot(cameraValues.horizontalOffset, cameraValues.horizontalOffset, cameraValues.verticalOffset);
const upHorizontal = -cameraValues.verticalOffset / distance / Math.SQRT2;
const upVertical = Math.SQRT2 * cameraValues.horizontalOffset / distance;
// Offsets are from the view's centre on the ground; height is above the camera target.
// @effect-diagnostics-next-line asyncFunction:off -- Playwright owns the native click at this boundary.
const clickGround = async (page: Page, offset: { readonly x: number; readonly z: number }, height: number) => {
  const canvas = page.locator("#map canvas");
  const bounds = await canvas.boundingBox();
  expect(bounds).toBeTruthy();
  if (!bounds) return;
  const scale = bounds.height / 21;
  await canvas.click({
    position: {
      x: bounds.width / 2 + (offset.x - offset.z) / Math.SQRT2 * scale,
      y: bounds.height / 2 - ((offset.x + offset.z) * upHorizontal + height * upVertical) * scale,
    },
  });
};

// @effect-diagnostics-next-line asyncFunction:off -- Playwright owns this native browser flow and its promise lifecycle.
test("a viewer reaches the second floor, picks a desk there and follows its agent as it moves", async ({ page, request }) => {
  const base = await Effect.runPromise(viewerUrl);
  // @effect-diagnostics-next-line asyncFunction:off -- Playwright's request context returns a native Promise.
  const publish = async (path: string, data: Schema.Json) => {
    const response = await request.post(`${base}${path}`, { data, timeout: 180_000 });
    expect(response.ok(), await response.text()).toBe(true);
  };
  // @effect-diagnostics-next-line asyncFunction:off -- Playwright's request context returns a native Promise.
  const move = async (location: typeof AgentLocation.Type) => {
    await publish(
      "/world/move",
      await Effect.runPromise(encodeMove({ world, checkpoint, agent: traveller, location })),
    );
  };
  await publish(
    "/world/arrivals",
    await Effect.runPromise(
      Schema.encodeEffect(Schema.toCodecJson(Schema.Struct({
        world: WorldId,
        checkpoint: Checkpoint,
        agents: Schema.Array(AgentId),
      })))({ world, checkpoint, agents }),
    ),
  );
  const errors: string[] = [];
  let offline = false;
  page.on("console", message => {
    const expectedDisconnect = offline && message.text().includes("net::ERR_INTERNET_DISCONNECTED");
    if (message.type() === "error" && !expectedDisconnect) errors.push(message.text());
  });
  page.on("pageerror", error => errors.push(error.message));
  const url = new URL(base);
  url.searchParams.set("world", world);
  url.searchParams.set("chain", chain);
  await page.goto(url.href);
  await expect(page.getByText("World connected", { exact: true })).toBeVisible();
  await expect(page.getByText("Rendering live world", { exact: true })).toBeVisible();
  const floors = page.getByRole("navigation", { name: "Floors" });
  const first = floors.getByRole("button", { name: `Floor 1 · ${capacity} desks`, exact: true });
  const second = floors.getByRole("button", { name: "Floor 2 · 1 desk", exact: true });
  await expect(floors.getByRole("button", { name: "Floor 3 · blueprint", exact: true })).toBeVisible();
  await expect(first).toHaveAttribute("aria-current", "location");

  // Navigation flies there and rests the camera in the Model and URL.
  await second.click();
  await expect(second).toHaveAttribute("aria-current", "location");
  await expect(first).toHaveAttribute("aria-current", "false");
  await expect.poll(() => cameraOf(page).x).toBeCloseTo(secondFloor.x, 3);
  await expect.poll(() => cameraOf(page).z).toBeCloseTo(secondFloor.z, 3);
  const deskButton = page.getByRole("button", { name: `Open desk for ${traveller}`, exact: true });
  await expect(deskButton).toBeVisible();
  await expect(page.getByRole("button", { name: `Open desk for ${agents[0]}`, exact: true })).toHaveCount(0);

  // The post anchor at the view's centre is empty, so picking it selects nothing.
  const drawer = page.getByRole("complementary", { name: "Agent desk" });
  const centre = { x: travellerPost.x - secondFloor.x, z: travellerPost.z - secondFloor.z };
  await clickGround(page, centre, 0);
  await expect(drawer).toHaveCount(0);
  // The tabletop of the second floor's only desk opens its agent. A pick before
  // the flight's last frame is drawn is ignored, so the same click repeats.
  // @effect-diagnostics-next-line asyncFunction:off -- Playwright retries this native click and observation.
  await expect(async () => {
    await clickGround(
      page,
      { x: travellerDesk.x - secondFloor.x, z: travellerDesk.z - secondFloor.z },
      1.33 - cameraValues.targetHeight,
    );
    await expect(drawer).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await expect(drawer.getByRole("heading", { name: traveller, exact: true })).toBeVisible();
  await expect(drawer.locator("[data-agent-location]")).toHaveText("At its desk");

  // Follow flies to the agent's marker; each settled follow commits the camera.
  await drawer.getByRole("button", { name: "Follow agent", exact: true }).click();
  await expect.poll(() => Math.hypot(cameraOf(page).x - travellerDesk.x, cameraOf(page).z - travellerDesk.z))
    .toBeLessThan(3);
  const beforeMove = cameraOf(page);
  await move(AgentLocation.cases.AtPost.make({ postId: post }));
  await expect(drawer.locator("[data-agent-location]")).toHaveText(`At post ${post}`);
  await expect.poll(() => cameraOf(page).x).toBeCloseTo(travellerPost.x, 3);
  await expect.poll(() => cameraOf(page).z).toBeCloseTo(travellerPost.z, 3);
  expect(cameraOf(page).sequence).toBe(beforeMove.sequence + 1);
  // The marker now stands at the view's centre: picking there selects the agent.
  await drawer.getByRole("button", { name: "Close desk", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  // @effect-diagnostics-next-line asyncFunction:off -- Playwright retries this native click and observation.
  await expect(async () => {
    await clickGround(page, { x: 0, z: 0 }, 0);
    await expect(drawer).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await expect(drawer.getByRole("heading", { name: traveller, exact: true })).toBeVisible();
  await page.screenshot({ path: "work/flows/world/followed.png", fullPage: true });

  // Leaving the page and returning to its URL resumes from the URL's delivery
  // sequence. The world sends that sequence's snapshot and the movement made
  // meanwhile, which the Model folds as a delivery.
  const left = cameraOf(page).sequence;
  const resumeUrl = page.url();
  await page.goto("about:blank");
  await move(AgentLocation.cases.AtDesk.make({ deskId: DeskId.make("floor_1_post_0_station_0_desk") }));
  const resumed = page.waitForRequest(value =>
    new URL(value.url()).pathname.startsWith("/api/world") && (value.postData() ?? "").includes(`"after":${left}`)
  );
  await page.goto(resumeUrl);
  await resumed;
  await expect(page.getByText("World connected", { exact: true })).toBeVisible();
  await expect(second).toHaveAttribute("aria-current", "location");
  await expect.poll(() => cameraOf(page).sequence).toBe(left + 1);
  await deskButton.click();
  await expect(drawer.locator("[data-agent-location]")).toHaveText("At its desk");

  // A movement published while the page is offline arrives as a delivery after
  // the reconnect, resumed from the Model's cursor rather than a fresh snapshot.
  offline = true;
  await page.context().setOffline(true);
  await expect(page.getByText("World disconnected · reconnecting from the last event", { exact: true })).toBeVisible();
  await move(AgentLocation.cases.AtPost.make({ postId: post }));
  const reconnected = page.waitForRequest(value =>
    new URL(value.url()).pathname.startsWith("/api/world") && (value.postData() ?? "").includes(`"after":${left + 1}`)
  );
  await page.context().setOffline(false);
  await reconnected;
  await expect(page.getByText("World connected", { exact: true })).toBeVisible();
  offline = false;
  await expect(drawer.locator("[data-agent-location]")).toHaveText(`At post ${post}`);
  await expect.poll(() => cameraOf(page).sequence).toBe(left + 2);

  // Going up two rungs shows both occupied floors and the blueprint as rooms on
  // one ground plane; the capture is retained for review, not compared.
  await page.locator("#map canvas").focus();
  for (const extent of [80, 380]) {
    await page.keyboard.press("Escape");
    await expect.poll(() => Number(new URL(page.url()).searchParams.get("extent"))).toBe(extent);
    await page.screenshot({ path: `work/flows/world/exchange-${extent}.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
});
