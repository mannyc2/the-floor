import { researchNote } from "@floor/contract";
import { Option } from "effect";
import { expect, it } from "vitest";
import { calibration, verifyClaim } from "../src/index";
const note = researchNote({
  id: "n",
  agentId: "wren",
  marketId: "pool",
  claim: "Pool reserves exceed 10",
  sources: [{
    id: "s",
    kind: "chain",
    label: "Pool contract",
    url: "https://basescan.org/address/0x1",
    blockNumber: 12,
  }],
  // oxlint-disable-next-line effect/noNullish -- The note records an observed zero amount with unknown supply percentage.
  position: { disclosure: "disclosed", amount: "0", symbol: "TOKEN", supplyPercent: null },
  status: "pending",
  visibility: "public",
  createdAt: "2026-10-11T12:00:00Z",
  blockNumber: 12,
  // oxlint-disable-next-line effect/noNullish -- The pending wire note has not yet been verified.
  verification: null,
});
it("verifies and contradicts block-bound claims; web claims remain sourced", () => {
  const claim = { kind: "minimum" as const, field: "reserve", expected: 10, blockNumber: 12 };
  const trueNote = verifyClaim(
    note,
    Option.some(claim),
    Option.some({ source: "chain", blockNumber: 12, values: { reserve: 20 } }),
  );
  const falseNote = verifyClaim(
    note,
    Option.some(claim),
    Option.some({ source: "chain", blockNumber: 12, values: { reserve: 9 } }),
  );
  expect(trueNote.status).toBe("verified");
  expect(falseNote.status).toBe("contradicted");
  expect(
    verifyClaim(note, Option.some(claim), Option.some({ source: "chain", blockNumber: 13, values: { reserve: 20 } }))
      .status,
  ).toBe("pending");
  expect(
    verifyClaim(
      { ...note, sources: [{ id: "s", kind: "web", label: "Article", url: "https://example.com", blockNumber: 12 }] },
      Option.some(claim),
      Option.some({ source: "chain", blockNumber: 12, values: { reserve: 20 } }),
    ).status,
  ).toBe("sourced");
  expect(calibration([trueNote, falseNote])).toEqual({
    checked: 2,
    verified: 1,
    contradicted: 1,
    rate: Option.some(0.5),
  });
});
