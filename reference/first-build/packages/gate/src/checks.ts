import { defaults, Design, readingContracts, unillustratedPart } from "@floor/contract";
import { Option, Schema } from "effect";
import { driverProblems } from "./drivers";
import { designGeometryBudget } from "./instruments";
export { DriverError, evaluateDriver } from "./drivers";
export interface GateCheck {
  readonly name: string;
  readonly status: "pass" | "fail" | "review";
  readonly detail: string;
}
export interface GateResult {
  readonly status: "accepted" | "rejected" | "review";
  readonly checks: readonly GateCheck[];
  readonly design: Design;
}
export interface RenderEvidence {
  readonly rendered: boolean;
  readonly imageUrl: Option.Option<string>;
  readonly legibility: Readonly<Record<string, number>>;
  readonly judgment: Readonly<Record<string, number>>;
}
export interface FitContext {
  readonly plinthAvailable: boolean;
  readonly maxWidth: number;
  readonly maxDepth: number;
  readonly overlapsMachine: boolean;
}
interface InstrumentBindings {
  readonly [reading: string]: readonly string[];
}
const kits = new Set([
  "base",
  "column",
  "cylinder",
  "tank",
  "pipe",
  "beam",
  "rack",
  "tray",
  "track",
  "ball",
  "sign",
  "reeds",
  "deck",
  "flag",
  "roof",
  "wall",
  "wheel",
]);
const materials = new Set([
  "steel",
  "glass",
  "stone",
  "brick",
  "timber",
  "enamel-green",
  "enamel",
  "paint",
  "paper",
  "water",
]);
const instruments: InstrumentBindings = {
  reserve0: ["level-gauge"],
  reserve1: ["level-gauge"],
  price: ["arc", "float-well", "tray-rack", "tide-gauge"],
  trades: ["pour"],
  history: ["tide-gauge"],
  liquidityBands: ["tray-rack"],
  progress: ["graduation-track"],
  deposits: ["level-gauge"],
  borrows: ["level-gauge"],
  utilization: ["utilization-dial"],
  liquidations: ["trapdoor"],
  longOpenInterest: ["weight-scale"],
  shortOpenInterest: ["weight-scale"],
  funding: ["pump"],
  odds: ["arc"],
  valueCrossing: ["freight"],
  queueLength: ["freight"],
  holdings: ["level-gauge"],
  movements: ["freight"],
};
const inspect = (name: string, passed: boolean, detail: string): GateCheck => ({
  name,
  status: passed ? "pass" : "fail",
  detail,
});
function confidence(name: string, score: Option.Option<number>): GateCheck {
  if (Option.isNone(score) || !Number.isFinite(score.value) || score.value < 0 || score.value > 1) {
    return { name, status: "review", detail: "Provider judgment unavailable; steward review required" };
  }
  return {
    name,
    status: score.value >= defaults.gatePass ? "pass" : score.value < defaults.gateReject ? "fail" : "review",
    detail: `Confidence ${score.value}; pass ≥ ${defaults.gatePass}, reject < ${defaults.gateReject}`,
  };
}
function inspectReadings(design: Design): readonly GateCheck[] {
  const ids = new Set(design.parts.map((part) => part.id));
  return [
    ...readingContracts[design.kind].map((required) => {
      const bindings = design.readings.filter((reading) => reading.reading === required);
      return inspect(
        `Reading: ${required}`,
        bindings.length === 1
          && bindings.every((reading) =>
            ids.has(reading.partId) && instruments[required]?.includes(reading.instrument) === true
          ),
        `Exactly one world-owned instrument displays ${required}`,
      );
    }),
    inspect(
      "Declared bindings",
      design.readings.every((reading) => readingContracts[design.kind].includes(reading.reading)),
      "Only this market's declared readings",
    ),
  ];
}
function inspectDrivers(design: Design): readonly GateCheck[] {
  const ids = new Set(design.parts.map((part) => part.id));
  const instrumentParts = new Set(design.readings.map((reading) => reading.partId));
  const driverErrors = design.drivers.flatMap((driver) => [
    ...(ids.has(driver.partId) ? [] : ["Missing driver part"]),
    ...(instrumentParts.has(driver.partId) ? ["Custom drivers cannot move instrument-bearing parts"] : []),
    ...(["rotation", "sway", "height", "scale"].includes(driver.property) ? [] : ["Unknown driver property"]),
    ...driverProblems(driver.expression, readingContracts[design.kind]),
  ]);
  return [
    inspect(
      "Drivers",
      driverErrors.length === 0,
      driverErrors.join("; ") || "Pure bounded expressions, own readings, brass protected",
    ),
    inspect(
      "Behaviours",
      design.behaviours.every((behaviour) => ids.has(behaviour.partId) && !instrumentParts.has(behaviour.partId)),
      "Behaviours cannot control instruments",
    ),
  ];
}
function inspectBudget(design: Design): readonly GateCheck[] {
  const generated = designGeometryBudget(design);
  const partBudget = { stall: 0, works: 200, tower: 600 }[design.tier];
  const animatedBudget = { stall: 0, works: 20, tower: 60 }[design.tier];
  return [
    inspect(
      "Part budget",
      generated.parts <= partBudget,
      `${generated.parts}/${partBudget}, including protected instruments; stalls use shared geometry`,
    ),
    inspect(
      "Animation budget",
      generated.animatedNodes <= animatedBudget,
      `${generated.animatedNodes}/${animatedBudget}, including every moving protected instrument node`,
    ),
    inspect(
      "Texture budget",
      design.texturePixels <= (design.tier === "tower" ? 4194304 : 1048576),
      "At most 1 megapixel for works, 4 for towers",
    ),
  ];
}
function inspectParts(design: Design): readonly GateCheck[] {
  const ids = design.parts.map((part) => part.id);
  const spans = [0, 1, 2].map(axis =>
    design.parts.length === 0
      ? 0
      : Math.max(...design.parts.map(part => (part.position[axis] ?? 0) + (part.size[axis] ?? 0) / 2))
        - Math.min(...design.parts.map(part => (part.position[axis] ?? 0) - (part.size[axis] ?? 0) / 2))
  );
  return [
    inspect("Schema", true, "Decoded against the shared Design schema at the submission boundary"),
    inspect(
      "Declared footprint",
      (spans[0] ?? 0) <= design.bounds.width && (spans[1] ?? 0) <= design.bounds.height
        && (spans[2] ?? 0) <= design.bounds.depth,
      "Every declared part fits within the submitted width, height and depth",
    ),
    inspect(
      "Unique parts",
      new Set(ids).size === ids.length && ids.every((id) => id.length > 0),
      "Part identifiers must be unique and non-empty",
    ),
    inspect(
      "Kit and materials",
      design.parts.every((part) => kits.has(part.kit) && materials.has(part.material)),
      "Registered kit and non-brass materials only; the world draws instruments",
    ),
    inspect(
      "Base",
      design.parts.some((part) => part.kit === "base" || part.kit === "deck"),
      "Every machine stands on a base",
    ),
    inspect(
      "Safe images",
      design.parts.every((part) =>
        Option.match(Option.fromNullishOr(part.image), {
          onNone: () => true,
          onSome: (url) => url.startsWith("https://"),
        })
      ),
      "Images require HTTPS asset URLs, never script or inline markup",
    ),
  ];
}
export const decodeDesignSubmission = Schema.decodeUnknownResult(Design);
/** The typed declaration is already structurally decoded by the HTTP/CLI boundary; this gate establishes relational and publication laws. */
export function evaluateDesignGate(
  design: Design,
  evidence: Option.Option<RenderEvidence> = Option.none(),
  fit: Option.Option<FitContext> = Option.none(),
): GateResult {
  const checks = [
    ...inspectParts(design),
    ...inspectReadings(design),
    ...inspectDrivers(design),
    ...inspectBudget(design),
  ];
  checks.push(Option.match(fit, {
    onNone: (): GateCheck => ({
      name: "Fit",
      status: "review",
      detail: "District plinth geometry must be checked before publication",
    }),
    onSome: (value) =>
      inspect(
        "Fit",
        value.plinthAvailable && !value.overlapsMachine && design.bounds.width <= value.maxWidth
          && design.bounds.depth <= value.maxDepth,
        "Available plinth, within footprint, no machine occlusion",
      ),
  }));
  if (checks.some((entry) => entry.status === "fail")) return { status: "rejected", checks, design };
  const image = Option.flatMap(evidence, (value) => value.imageUrl);
  checks.push({
    name: "Render",
    status: Option.exists(evidence, (value) => value.rendered) && Option.isSome(image) ? "pass" : "review",
    detail: Option.isSome(image)
      ? "Trusted renderer captured the declared parts and their protected instruments"
      : "Trusted renderer output and baked impostor required",
  });
  for (const required of readingContracts[design.kind]) {
    checks.push(confidence(
      `Legibility: ${required}`,
      Option.flatMap(evidence, (value) => Option.fromUndefinedOr(value.legibility[required])),
    ));
  }
  for (const lint of ["no-impersonation", "no-copyrighted-characters", "no-slurs", "no-scam-links"]) {
    checks.push(confidence(
      `Judgment: ${lint}`,
      Option.flatMap(evidence, (value) => Option.fromUndefinedOr(value.judgment[lint])),
    ));
  }
  return {
    status: checks.some((entry) => entry.status === "fail")
      ? "rejected"
      : checks.some((entry) => entry.status === "review")
      ? "review"
      : "accepted",
    checks,
    design,
  };
}
export const lilyPondDesign: Design = {
  id: "lily-pond",
  tokenId: "toad",
  name: "Lily-pond water clock",
  kind: "constant-product",
  tier: "works",
  parts: [
    unillustratedPart({ id: "base", kit: "deck", material: "timber", position: [0, 0, 0], size: [8, 1, 5] }),
    unillustratedPart({ id: "left", kit: "cylinder", material: "glass", position: [-2, 1, 0], size: [2, 4, 2] }),
    unillustratedPart({ id: "right", kit: "cylinder", material: "glass", position: [2, 1, 0], size: [2, 4, 2] }),
    unillustratedPart({ id: "balance", kit: "beam", material: "enamel-green", position: [0, 1, 0], size: [6, 1, 1] }),
    unillustratedPart({ id: "pipe", kit: "pipe", material: "steel", position: [0, 2, 0], size: [4, 1, 1] }),
    unillustratedPart({ id: "drum", kit: "cylinder", material: "paper", position: [4, 1, 0], size: [2, 2, 2] }),
    unillustratedPart({ id: "reeds", kit: "reeds", material: "enamel-green", position: [-4, 1, 0], size: [1, 3, 1] }),
  ],
  readings: [
    { reading: "reserve0", instrument: "level-gauge", partId: "left" },
    { reading: "reserve1", instrument: "level-gauge", partId: "right" },
    { reading: "price", instrument: "arc", partId: "balance" },
    { reading: "trades", instrument: "pour", partId: "pipe" },
    { reading: "history", instrument: "tide-gauge", partId: "drum" },
  ],
  drivers: [{
    partId: "reeds",
    property: "sway",
    expression: { op: "multiply", args: [{ op: "constant", value: 0.03 }, { op: "sin", args: [{ op: "time" }] }] },
  }],
  behaviours: [],
  texturePixels: 0,
  bounds: { width: 10, depth: 5, height: 6 },
};
export const evaluateDesign = evaluateDesignGate;
