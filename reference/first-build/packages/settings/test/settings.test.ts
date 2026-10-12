import { Option, Result } from "effect";
import { expect, it } from "vitest";
import { changeSetting, resolveSetting } from "../src/index";
it("scoped changes are recorded and resolved without granting cross-owner authority", () => {
  const authority = { principal: "owner", admin: false, ownedAgentIds: ["wren"] };
  const changed = Result.getOrThrow(
    changeSetting(
      { key: "sound", value: true, scope: "agent", scopeId: "wren" },
      authority,
      "event",
      Option.some(12),
      "2026-10-11T12:00:00Z",
    ),
  );
  expect(changed.event.blockNumber).toBe(12);
  expect(changed.setting.changedByEvent).toBe("event");
  expect(resolveSetting("sound", [changed.setting], [{ scope: "agent", scopeId: "wren" }])).toBe(true);
  expect(resolveSetting("sound", [changed.setting], [{ scope: "agent", scopeId: "other" }])).toBe(false);
  expect(
    Result.isFailure(
      changeSetting(
        { key: "sound", value: true, scope: "agent", scopeId: "other" },
        authority,
        "event",
        Option.some(12),
        "2026-10-11T12:00:00Z",
      ),
    ),
  ).toBe(true);
  expect(
    Result.isFailure(
      changeSetting(
        { key: "testnetOnly", value: false, scope: "floor", scopeId: "floor" },
        { ...authority, admin: true },
        "event",
        Option.some(12),
        "2026-10-11T12:00:00Z",
      ),
    ),
  ).toBe(true);
});
