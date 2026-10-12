import { Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { evaluateDesignGate, evaluateDriver, lilyPondDesign, type RenderEvidence } from "../src/index";
const fit = { plinthAvailable: true, maxWidth: 20, maxDepth: 20, overlapsMachine: false };
const evidence: RenderEvidence = {
  rendered: true,
  imageUrl: Option.some("https://fixture.invalid/lily-pond.png"),
  legibility: { reserve0: 0.95, reserve1: 0.95, price: 0.95, trades: 0.95, history: 0.95 },
  judgment: { "no-impersonation": 0.95, "no-copyrighted-characters": 0.95, "no-slurs": 0.95, "no-scam-links": 0.95 },
};
describe("Design gate", () => {
  it("does not manufacture a visual check without renderer and judgment evidence", () => {
    expect(evaluateDesignGate(lilyPondDesign).status).toBe("review");
  });
  it("passes the full contract with explicitly supplied test evidence", () => {
    expect(evaluateDesignGate(lilyPondDesign, Option.some(evidence), Option.some(fit)).status).toBe("accepted");
  });
  it("names the missing-price rejection", () => {
    const gate = evaluateDesignGate({
      ...lilyPondDesign,
      readings: lilyPondDesign.readings.filter((reading) => reading.reading !== "price"),
    });
    expect(gate.status).toBe("rejected");
    expect(gate.checks.find((check) => check.name === "Reading: price")?.status).toBe("fail");
  });
  it("rejects data theft, moving brass and decorative brass", () => {
    expect(
      evaluateDesignGate({
        ...lilyPondDesign,
        drivers: [{ partId: "reeds", property: "sway", expression: { op: "reading", name: "otherToken.balance" } }],
      }).status,
    ).toBe("rejected");
    expect(
      evaluateDesignGate({
        ...lilyPondDesign,
        drivers: [{ partId: "left", property: "sway", expression: { op: "time" } }],
      }).status,
    ).toBe("rejected");
    expect(
      evaluateDesignGate({
        ...lilyPondDesign,
        parts: lilyPondDesign.parts.map((part) => ({ ...part, material: "brass" })),
      }).status,
    ).toBe("rejected");
  });
  it("thresholds produce steward review or named rejection", () => {
    expect(
      evaluateDesignGate(
        lilyPondDesign,
        Option.some({ ...evidence, legibility: { ...evidence.legibility, price: 0.65 } }),
        Option.some(fit),
      ).status,
    ).toBe("review");
    expect(
      evaluateDesignGate(
        lilyPondDesign,
        Option.some({ ...evidence, legibility: { ...evidence.legibility, price: 0.39 } }),
        Option.some(fit),
      ).status,
    ).toBe("rejected");
  });
  it("rejects overlapping plinths and excess geometry", () => {
    expect(
      evaluateDesignGate(lilyPondDesign, Option.some(evidence), Option.some({ ...fit, overlapsMachine: true })).status,
    ).toBe("rejected");
    expect(evaluateDesignGate({ ...lilyPondDesign, tier: "stall" }, Option.some(evidence), Option.some(fit)).status)
      .toBe("rejected");
  });
  it("counts protected generated parts and moving nodes in the tier budgets", () => {
    const part = lilyPondDesign.parts[0];
    if (!part) return;
    const crowded = {
      ...lilyPondDesign,
      parts: [
        ...lilyPondDesign.parts,
        ...Array.from({ length: 190 - lilyPondDesign.parts.length }, (_, index) => ({
          ...part,
          id: `extra-${index}`,
        })),
      ],
    };
    expect(crowded.parts.length).toBe(190);
    expect(evaluateDesignGate(crowded).checks.find(check => check.name === "Part budget")?.status).toBe("fail");
    const decorated = {
      ...crowded,
      drivers: Array.from({ length: 17 }, (_, index) => ({
        partId: `extra-${index}`,
        property: "height",
        expression: { op: "constant" as const, value: 0 },
      })),
    };
    expect(evaluateDesignGate(decorated).checks.find(check => check.name === "Animation budget")?.status).toBe("fail");
  });
  it("executes only the bounded driver vocabulary", () => {
    expect(
      Result.getOrThrow(
        evaluateDriver({ op: "multiply", args: [{ op: "constant", value: 2 }, { op: "reading", name: "price" }] }, {
          price: 3,
        }, 0),
      ),
    ).toBe(6);
    expect(Result.isFailure(evaluateDriver({ op: "reading", name: "secret" }, {}, 0))).toBe(true);
    expect(Result.isFailure(evaluateDriver({ op: "sin", args: [] }, {}, 0))).toBe(true);
  });
});
