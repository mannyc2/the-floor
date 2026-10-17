import { NodeServices } from "@effect/platform-node";
import { cameraValues } from "@floor/atlas/camera";
import { defaultWorldLayout } from "@floor/contract/settings";
import { canonicalFloorOrigin, canonicalPostAnchor } from "@floor/contract/world";
import { createLayoutProposal, proposalDimensions } from "@floor/world/proposal";
import { expect, type Page, test } from "@playwright/test";
import { Array, Config, Effect, FileSystem, Option, Result, Schema } from "effect";

// The development world: the production viewer built with the development
// layout switch, watching a labelled synthetic world on the local world test
// Worker. Its oracle is the proposal generator with the world's seed and the
// default configuration, independent of the viewer's mapping.
const Metadata = Schema.fromJsonString(Schema.Struct({
  seed: Schema.Int,
  floors: Schema.Int,
  urls: Schema.Struct({ proposal: Schema.String, grid: Schema.String }),
}));
const readMetadata = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Config.String("FLOOR_DEV_WORLD_METADATA").pipe(Config.withDefault("work/dev-world/world.json"));
  return yield* Schema.decodeEffect(Metadata)(yield* fs.readFileString(path));
}).pipe(Effect.provide(NodeServices.layer), Effect.option);

const cameraOf = (page: Page) => {
  const query = new URL(page.url()).searchParams;
  return { x: Number(query.get("x")), z: Number(query.get("z")) };
};
// The production camera basis projects a ground point at the default zoom;
// clicks then go through the renderer's GPU picking path.
const distance = Math.hypot(cameraValues.horizontalOffset, cameraValues.horizontalOffset, cameraValues.verticalOffset);
const upHorizontal = -cameraValues.verticalOffset / distance / Math.SQRT2;
const upVertical = Math.SQRT2 * cameraValues.horizontalOffset / distance;
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
test("the development world draws the proposal's rooms and picks a desk in its second room", async ({ page }) => {
  // The world publishes its arrivals after the Worker answers, then writes this file.
  // @effect-diagnostics-next-line asyncFunction:off -- Playwright polls this native file read.
  await expect.poll(async () => Option.isSome(await Effect.runPromise(readMetadata)), { timeout: 120_000 }).toBe(true);
  const metadata = Option.getOrThrow(await Effect.runPromise(readMetadata));
  expect(metadata.floors).toBe(2);
  const layout = defaultWorldLayout;
  const capacity = layout.postsPerFloor * layout.stationsPerPost;
  const plan = Result.getOrThrow(createLayoutProposal({
    seed: metadata.seed,
    rooms: metadata.floors + 1,
    postsPerFloor: layout.postsPerFloor,
    stationsPerPost: layout.stationsPerPost,
    lobbyPlots: layout.lobbyPlots,
  }));
  // The default scale draws the 4.25H minimum post distance at the grid's pitch,
  // and the viewer's frame puts the first room's origin at zero.
  const pitch = Option.getOrThrow(Option.map(canonicalPostAnchor(1), anchor => Math.hypot(anchor.x, anchor.z)));
  const scale = pitch / proposalDimensions.postDistance;
  const origin = Array.headNonEmpty(plan.rooms).origin;
  const view = (point: { readonly x: number; readonly z: number }) => ({
    x: (point.x - origin.x) * scale,
    z: (point.z - origin.z) * scale,
  });
  const second = Option.getOrThrow(Array.get(plan.rooms, 1));
  const focus = view({
    x: (Math.min(...second.areas.map(area => area.x0)) + Math.max(...second.areas.map(area => area.x1))) / 2,
    z: (Math.min(...second.areas.map(area => area.z0)) + Math.max(...second.areas.map(area => area.z1))) / 2,
  });
  // The second floor's first post: its desk nearest the camera's corner, so no
  // other desk of that post covers its tabletop.
  const stations = Array.map(Array.headNonEmpty(second.posts).stations, (station, index) => ({
    index,
    ...view(station),
  }));
  const desk = Array.reduce(
    stations,
    Array.headNonEmpty(stations),
    (best, station) => station.x + station.z > best.x + best.z ? station : best,
  );
  // Arrivals fill floors and posts in order, so the second floor's first post
  // seats the arrivals after the first floor's capacity.
  const agent = `synthetic-dev-agent-${capacity + desk.index}`;
  const lastFloor = 3 * layout.stationsPerPost + 4;

  const errors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(metadata.urls.proposal);
  await expect(page.getByText("World connected", { exact: true })).toBeVisible();
  await expect(page.getByText("Rendering live world", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Development layout" })).toContainText(
    `Proposal, unadopted · seed ${metadata.seed}`,
  );
  const floors = page.getByRole("navigation", { name: "Floors" });
  const first = floors.getByRole("button", { name: `Floor 1 · ${capacity} desks`, exact: true });
  const room = floors.getByRole("button", { name: `Floor 2 · ${lastFloor} desks`, exact: true });
  await expect(floors.getByRole("button", { name: "Floor 3 · blueprint", exact: true })).toBeVisible();
  await expect(first).toHaveAttribute("aria-current", "location");

  // The floor list flies to the second room's hall and wing, which the plan
  // gives the viewer as that floor's ground.
  await room.click();
  await expect(room).toHaveAttribute("aria-current", "location");
  await expect.poll(() => cameraOf(page).x).toBeCloseTo(focus.x, 3);
  await expect.poll(() => cameraOf(page).z).toBeCloseTo(focus.z, 3);

  // A named place the proposal reserves is a place the viewer draws an agent:
  // the second room's walker reaches one within a circuit of four moves.
  const drawer = page.getByRole("complementary", { name: "Agent desk" });
  const desks = page.getByRole("button", { name: "Desks", exact: true });
  await desks.click();
  await page.getByRole("button", { name: `Open desk for synthetic-dev-agent-${capacity}`, exact: true }).click();
  await desks.click();
  await expect(drawer.locator("[data-agent-location]")).toHaveText(
    /^At the (wall of screens|bell|podium|file room|board) on floor_1$/,
    { timeout: 30_000 },
  );
  await drawer.getByRole("button", { name: "Close desk", exact: true }).click();
  await expect(drawer).toHaveCount(0);

  // GPU picking on the second room: rest the camera on one of its desks.
  const atDesk = new URL(page.url());
  atDesk.searchParams.set("x", String(desk.x));
  atDesk.searchParams.set("z", String(desk.z));
  atDesk.searchParams.set("extent", "21");
  atDesk.searchParams.set("rotation", "0");
  await page.goto(atDesk.href);
  await expect(page.getByText("Rendering live world", { exact: true })).toBeVisible();
  await expect(room).toHaveAttribute("aria-current", "location");
  // @effect-diagnostics-next-line asyncFunction:off -- Playwright retries this native click and observation.
  await expect(async () => {
    await clickGround(page, { x: 0, z: 0 }, 1.33 - cameraValues.targetHeight);
    await expect(drawer).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await expect(drawer.getByRole("heading", { name: agent, exact: true })).toBeVisible();
  await page.screenshot({ path: "work/flows/dev-world/second-room.png", fullPage: true });

  // The same world under the production grid, switched without restarting it.
  await page.getByRole("navigation", { name: "Development layout" }).getByRole("link", { name: "Grid" }).click();
  await expect(page.getByText("Rendering live world", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Development layout" })).toContainText("Production grid");
  await room.click();
  const grid = (index: number) => Option.getOrThrow(canonicalFloorOrigin(index, layout.postsPerFloor));
  await expect.poll(() => cameraOf(page).x).toBeCloseTo(grid(1).x - grid(0).x, 3);
  await expect.poll(() => cameraOf(page).z).toBeCloseTo(grid(1).z - grid(0).z, 3);
  expect(errors).toEqual([]);
});
