import { Design } from "@floor/contract";
import { expect, type Page, test } from "@playwright/test";
import { Effect, Schema } from "effect";

const openAtlas = Effect.fn("BrowserProof.openAtlas")(function*(page: Page) {
  yield* Effect.promise(() => page.goto("/"));
  yield* Effect.promise(() => expect(page.getByRole("heading", { name: "The Base harbour" })).toBeVisible());
  yield* Effect.promise(() => expect(page.locator(".market-title-row h2")).not.toBeEmpty({ timeout: 45000 }));
  yield* Effect.promise(() => expect(page.locator("#atlas-host canvas")).toBeVisible());
});
const createDesk = Effect.fn("BrowserProof.createDesk")(function*(page: Page) {
  yield* Effect.promise(() => page.getByRole("button", { name: "Your agents", exact: true }).click());
  yield* Effect.promise(() => page.getByRole("button", { name: "Open a new desk", exact: true }).first().click());
  yield* Effect.promise(() => expect(page.getByLabel("Agent name", { exact: true })).toBeFocused());
  yield* Effect.promise(() => page.getByLabel("Agent name", { exact: true }).fill("Wren"));
  yield* Effect.promise(() => page.getByRole("button", { name: "Confirm & create desk", exact: true }).click());
  yield* Effect.promise(() => expect(page.getByRole("heading", { name: "Wren’s desk" })).toBeVisible());
  yield* Effect.promise(() => expect(page.getByRole("dialog")).toBeHidden());
});
const observeErrors = Effect.fn("BrowserProof.observeErrors")(function*(page: Page) {
  const errors: string[] = [];
  yield* Effect.sync(() => page.on("pageerror", error => errors.push(error.message)));
  return errors;
});

test("owner journey preserves limits, moorings, alerts, replay and a numbered plate", ({ page }) =>
  Effect.gen(function*() {
    const errors = yield* observeErrors(page);
    yield* openAtlas(page);
    yield* Effect.promise(() => page.screenshot({ path: "testing/e2e/atlas-proof.png", fullPage: true }));
    yield* createDesk(page);
    yield* Effect.promise(() => page.getByRole("button", { name: "Pause agent", exact: true }).click());
    yield* Effect.promise(() => expect(page.getByRole("button", { name: "Run research", exact: true })).toBeDisabled());
    yield* Effect.promise(() => page.reload());
    yield* Effect.promise(() => page.getByRole("button", { name: "Your agents", exact: true }).click());
    yield* Effect.promise(() => expect(page.getByRole("button", { name: "Run research", exact: true })).toBeDisabled());
    yield* Effect.promise(() => page.getByRole("button", { name: "Resume agent", exact: true }).click());
    yield* Effect.promise(() => expect(page.getByRole("button", { name: "Run research", exact: true })).toBeEnabled());
    yield* Effect.promise(() => page.getByRole("button", { name: "Edit confirmed limits", exact: true }).click());
    yield* Effect.promise(() =>
      page.getByLabel("Its mandate", { exact: true }).fill("Check every source and ask before trading.")
    );
    yield* Effect.promise(() => page.getByLabel("Maximum trade ($)", { exact: true }).fill("35"));
    yield* Effect.promise(() => page.getByRole("button", { name: "Confirm limits", exact: true }).click());
    yield* Effect.promise(() =>
      expect(page.getByText("Check every source and ask before trading.", { exact: true })).toBeVisible()
    );
    yield* Effect.promise(() => expect(page.locator(".desk-policy")).toContainText("$35"));
    yield* Effect.promise(() => page.screenshot({ path: "testing/e2e/desk-proof.png", fullPage: true }));
    yield* Effect.promise(() => page.getByRole("button", { name: "The atlas", exact: true }).click());
    yield* Effect.promise(() => expect(page.locator("#atlas-host canvas")).toBeVisible());
    yield* Effect.promise(() => page.getByRole("button", { name: "Moor market", exact: true }).click());
    yield* Effect.promise(() => expect(page.getByRole("button", { name: "Moored", exact: true })).toBeVisible());
    yield* Effect.promise(() => page.getByRole("button", { name: "Scribe a line", exact: true }).click());
    yield* Effect.promise(() => page.getByLabel("Price in USD", { exact: true }).fill("999999"));
    yield* Effect.promise(() => page.getByRole("button", { name: "Scribe the line", exact: true }).click());
    yield* Effect.promise(() => expect(page.locator(".scribed-line")).toContainText("Watching above"));
    yield* Effect.promise(() => page.getByRole("button", { name: "My harbour", exact: true }).click());
    yield* Effect.promise(() => expect(page.getByRole("heading", { name: "Your harbour", exact: true })).toBeVisible());
    const slider = page.getByRole("slider", { name: "Replay block" });
    yield* Effect.promise(() => slider.focus());
    yield* Effect.promise(() => slider.press("Home"));
    yield* Effect.promise(() => expect(page.locator(".data-mode")).toHaveText("REPLAY"));
    yield* Effect.promise(() => expect(page.getByRole("button", { name: "Make a plate", exact: true })).toBeEnabled());
    const sourceBlock = yield* Effect.promise(() => page.locator(".app-footer .mono").innerText());
    yield* Effect.promise(() => page.getByRole("button", { name: "Make a plate", exact: true }).click());
    yield* Effect.promise(() => expect(page.locator(".toast")).toContainText(/Plate \d+ is now part of the record/));
    yield* Effect.promise(() => page.getByRole("button", { name: "Tide table", exact: true }).click());
    yield* Effect.promise(() => page.getByRole("button", { name: "Browse the plates", exact: true }).click());
    yield* Effect.promise(() => expect(page.locator(".plate-card")).toHaveCount(1));
    yield* Effect.promise(() => expect(page.locator(".plate-card")).toContainText(sourceBlock.toLowerCase()));
    yield* Effect.promise(() => expect(page.locator(".plate-card img")).toBeVisible());
    yield* Effect.gen(function*() {
      const record = yield* Effect.acquireRelease(
        Effect.promise(() => page.context().newPage()),
        current => Effect.promise(() => current.close()),
      );
      const recordErrors = yield* observeErrors(record);
      yield* Effect.promise(() => record.goto("/plates/1"));
      yield* Effect.promise(() => expect(record.getByRole("heading", { name: /^Plate 1:/ })).toBeVisible());
      yield* Effect.promise(() => expect(record.locator(".source")).toContainText(sourceBlock.toLowerCase()));
      const marketLink = yield* Effect.promise(() =>
        record.getByRole("link", { name: "Open the current market" }).getAttribute("href")
      );
      const marketPath = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(marketLink);
      yield* Effect.promise(() => record.goto(marketPath.replace("/?market=", "/markets/")));
      yield* Effect.promise(() =>
        expect(record.locator("meta[property='og:image']")).toHaveAttribute("content", /\/api\/previews\/market\//)
      );
      yield* Effect.promise(() =>
        expect(record.getByRole("img", { name: "Source-based atlas rendering" })).toHaveJSProperty("naturalWidth", 1440)
      );
      yield* Effect.promise(() => record.screenshot({ path: "testing/e2e/market-preview-proof.png", fullPage: true }));
      yield* Effect.promise(() => record.goto(marketPath.replace("?market=", "?embed=")));
      yield* Effect.promise(() => expect(record.locator("#atlas-host canvas")).toBeVisible());
      yield* Effect.promise(() =>
        expect(record.getByRole("button", { name: "Your agents", exact: true })).toBeHidden()
      );
      yield* Effect.promise(() =>
        expect(record.getByRole("button", { name: "Moor market", exact: true })).toBeHidden()
      );
      yield* Effect.promise(() =>
        expect(record.getByRole("link", { name: "Open this works on The Floor" })).toBeVisible()
      );
      yield* Effect.promise(() => record.screenshot({ path: "testing/e2e/embed-proof.png", fullPage: true }));
      yield* Effect.sync(() => expect(recordErrors).toEqual([]));
    }).pipe(Effect.scoped);
    yield* Effect.promise(() => page.getByRole("button", { name: "Foundry", exact: true }).click());
    yield* Effect.promise(() => page.getByRole("button", { name: "Prepare a cast", exact: true }).click());
    yield* Effect.promise(() => page.getByLabel("Token name", { exact: true }).fill("Wren Research"));
    yield* Effect.promise(() => page.getByLabel("Token symbol", { exact: true }).fill("WREN"));
    yield* Effect.promise(() =>
      page.getByLabel("Why this token, for whom, and on what sources?", { exact: true }).fill(
        "A testnet experiment in sourced research. The recorded Base reserve readings are the starting evidence.",
      )
    );
    yield* Effect.promise(() => page.getByRole("button", { name: "Save launch draft", exact: true }).click());
    yield* Effect.promise(() => expect(page.locator(".draft-card")).toContainText("Wren Research"));
    yield* Effect.promise(() => page.getByRole("button", { name: "Workspace settings", exact: true }).click());
    yield* Effect.promise(() => page.getByRole("button", { name: "Off", exact: true }).click());
    yield* Effect.promise(() => expect(page.getByRole("button", { name: "On", exact: true })).toBeVisible());
    yield* Effect.promise(() => page.getByRole("button", { name: "On", exact: true }).click());
    yield* Effect.promise(() => page.getByRole("button", { name: "Switch to night", exact: true }).click());
    yield* Effect.promise(() => expect(page.locator(".app")).toHaveAttribute("data-theme", "night"));
    yield* Effect.promise(() => page.reload());
    yield* Effect.promise(() => expect(page.locator(".app")).toHaveAttribute("data-theme", "night"));
    yield* Effect.promise(() => page.getByRole("button", { name: "Your agents", exact: true }).click());
    yield* Effect.promise(() =>
      expect(page.getByText("Check every source and ask before trading.", { exact: true })).toBeVisible()
    );
    yield* Effect.promise(() => page.getByRole("button", { name: "Open a new desk", exact: true }).click());
    yield* Effect.promise(() => expect(page.getByLabel("Agent name", { exact: true })).toBeFocused());
    yield* Effect.promise(() => page.keyboard.press("Escape"));
    yield* Effect.promise(() => expect(page.getByRole("dialog")).toBeHidden());
    yield* Effect.promise(() =>
      expect(page.getByRole("button", { name: "Open a new desk", exact: true })).toBeFocused()
    );
    yield* Effect.sync(() => expect(errors).toEqual([]));
    // oxlint-disable-next-line effect/noEffectRunInTests -- Playwright owns the actual browser fixture and its Promise completion boundary.
  }).pipe(Effect.runPromise));

test("the gate names structural failures and refuses a design without a compatible works", ({ page }) =>
  Effect.gen(function*() {
    const errors = yield* observeErrors(page);
    yield* openAtlas(page);
    yield* Effect.promise(() => page.getByRole("button", { name: "Community workshop", exact: true }).click());
    yield* Effect.promise(() => page.getByRole("button", { name: "Submit a design", exact: true }).click());
    const input = page.getByLabel("Design submission (JSON)", { exact: true });
    const source = yield* Effect.promise(() => input.inputValue());
    const design = yield* Schema.decodeEffect(Schema.fromJsonString(Design))(source);
    const broken = yield* Schema.encodeEffect(Schema.fromJsonString(Design))({
      ...design,
      name: "Missing instruments",
      readings: [],
    });
    yield* Effect.promise(() => input.fill(broken));
    yield* Effect.promise(() => page.getByRole("button", { name: "Run the gate", exact: true }).click());
    yield* Effect.promise(() => expect(page.locator(".gate-card")).toContainText("rejected"));
    yield* Effect.promise(() => page.getByRole("button", { name: "Submit a design", exact: true }).click());
    yield* Effect.promise(() => page.getByRole("button", { name: "Run the gate", exact: true }).click());
    yield* Effect.promise(() => expect(page.locator(".gate-card")).toHaveCount(2));
    yield* Effect.promise(() =>
      expect(page.locator(".gate-card").filter({ hasText: "Lily-pond water clock" })).toContainText("rejected")
    );
    yield* Effect.promise(() =>
      expect(page.locator(".gate-card").filter({ hasText: "Lily-pond water clock" }).locator(".gate-check.fail"))
        .toContainText("Fit")
    );
    yield* Effect.promise(() => page.screenshot({ path: "testing/e2e/gate-proof.png", fullPage: true }));
    yield* Effect.sync(() => expect(errors).toEqual([]));
    // oxlint-disable-next-line effect/noEffectRunInTests -- Playwright owns the actual browser fixture and its Promise completion boundary.
  }).pipe(Effect.runPromise));

test("phone layout keeps the atlas and owner forms usable", ({ page }) =>
  Effect.gen(function*() {
    const errors = yield* observeErrors(page);
    yield* Effect.promise(() => page.setViewportSize({ width: 390, height: 844 }));
    yield* Effect.promise(() => page.emulateMedia({ reducedMotion: "reduce" }));
    yield* openAtlas(page);
    const dimensions = yield* Effect.promise(() =>
      page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }))
    );
    yield* Effect.sync(() => expect(dimensions.content).toBeLessThanOrEqual(dimensions.width));
    yield* Effect.promise(() => page.screenshot({ path: "testing/e2e/phone-proof.png", fullPage: true }));
    yield* createDesk(page);
    yield* Effect.promise(() => page.getByRole("button", { name: "The atlas", exact: true }).click());
    yield* Effect.promise(() => expect(page.locator("#atlas-host canvas")).toBeVisible());
    yield* Effect.sync(() => expect(errors).toEqual([]));
    // oxlint-disable-next-line effect/noEffectRunInTests -- This verifies a Chrome phone viewport, not physical-device performance.
  }).pipe(Effect.runPromise));
