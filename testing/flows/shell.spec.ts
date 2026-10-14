import { expect, test } from "@playwright/test";
import { Option, Schema } from "effect";

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

// Enters through the production page and its typed RPC client. No intercepted
// routes, injected models, fixtures or direct database arrangement are involved.
// @effect-diagnostics-next-line asyncFunction:off -- Playwright requires a native Promise callback at this test boundary.
test("the shell and read-only MCP share health through the running Floor Worker", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "The Floor", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Trading floor" })).toBeVisible();
  await expect(page.locator("#floor-map canvas")).toBeVisible();
  await expect(page.getByText("Synthetic renderer test scene — geometry and palette unapproved")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Not checked");
  const response = page.waitForResponse(value =>
    /^\/api\/rpc\/?$/.test(new URL(value.url()).pathname) && value.request().method() === "POST"
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

  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  const headers = {
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2026-07-28",
  };
  // Listing before discovery proves each HTTP request carries its own protocol
  // context. The exact tool list also fences off writes and model-run entry points.
  for (
    const [id, method, params, expected] of [
      [1, "tools/list", {}, {
        tools: [{
          name: "health",
          inputSchema: { type: "object", additionalProperties: false },
          outputSchema: {
            type: "object",
            properties: { status: { type: "string", enum: ["ready"] }, service: { type: "string", enum: ["floor"] } },
          },
          annotations: { readOnlyHint: true, destructiveHint: false },
        }],
      }],
      [2, "server/discover", {}, { supportedVersions: ["2026-07-28"], capabilities: { tools: {} } }],
      [3, "tools/call", { name: "health", arguments: {} }, {
        isError: false,
        structuredContent: { status: "ready", service: "floor" },
      }],
    ] satisfies ReadonlyArray<readonly [number, string, Schema.JsonObject, Schema.JsonObject]>
  ) {
    const requestHeaders = method === "tools/call"
      ? { ...headers, "mcp-method": method, "mcp-name": "health" }
      : { ...headers, "mcp-method": method };
    const result = await request.post("/mcp", {
      headers: requestHeaders,
      data: { jsonrpc: "2.0", id, method, params: { ...params, _meta: meta } },
    });
    expect(result.status()).toBe(200);
    expect(result.headers()["mcp-session-id"]).toBeUndefined();
    expect(Option.getOrThrow(decodeJson(await result.text()))).toMatchObject({ jsonrpc: "2.0", id, result: expected });
  }
  const invalid = await request.post("/mcp", {
    headers: { ...headers, "mcp-method": "tools/call", "mcp-name": "health" },
    data: {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "health", arguments: { unexpected: true }, _meta: meta },
    },
  });
  expect(Option.getOrThrow(decodeJson(await invalid.text()))).toMatchObject({ id: 4, result: { isError: true } });
  const malformed = await request.post("/mcp", {
    headers: { ...headers, "mcp-method": "tools/call", "mcp-name": "health" },
    data: { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "health", arguments: [], _meta: meta } },
  });
  expect(Option.getOrThrow(decodeJson(await malformed.text()))).toMatchObject({ id: 5, error: { code: -32602 } });
  const wrongVersion = await request.post("/mcp", {
    headers: { ...headers, "mcp-protocol-version": "2025-11-25", "mcp-method": "server/discover" },
    data: { jsonrpc: "2.0", id: 6, method: "server/discover", params: { _meta: meta } },
  });
  expect(wrongVersion.status()).toBe(400);
  expect((await request.get("/mcp")).status()).toBe(405);
  expect((await request.delete("/mcp")).status()).toBe(405);
});
