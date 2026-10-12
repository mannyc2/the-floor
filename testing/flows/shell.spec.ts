import { expect, test } from "@playwright/test";

// Enters through the production page and its typed HTTP client. No intercepted
// routes, injected models, fixtures or direct database arrangement are involved.
/* oxlint-disable effecttsgo/async-function, effect/noAsyncFunction -- Playwright owns the single native asynchronous callback below and its awaited assertions. */
// @effect-diagnostics-next-line asyncFunction:off -- Playwright requires a native Promise callback at this test boundary.
test("the shell verifies its connection through the running Floor Worker", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "The Floor", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Trading floor" })).toBeVisible();
  await expect(page.locator("#floor-map canvas")).toBeVisible();
  await expect(page.getByText("Synthetic renderer test scene — reference art pending")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Not checked");
  const response = page.waitForResponse(value =>
    new URL(value.url()).pathname === "/api/health" && value.request().method() === "GET"
  );
  await page.getByRole("button", { name: "Check connection" }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole("status")).toHaveText("Connected");
  await expect(page.getByRole("button", { name: "Check connection" })).toBeEnabled();
  expect(await page.evaluate(() => ({ workbench: "floorTest" in window, look: "floorLook" in window }))).toEqual({
    workbench: false,
    look: false,
  });
  expect(errors).toEqual([]);
  await page.screenshot({ path: "work/flows/shell-connected.png", fullPage: true });
});
/* oxlint-enable effecttsgo/async-function, effect/noAsyncFunction */
