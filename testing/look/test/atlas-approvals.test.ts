import * as AtlasCamera from "@floor/atlas/camera";
import * as AtlasLook from "@floor/atlas/look";
import { darkLine, lineOpacity } from "@floor/atlas/look";
import * as AtlasMaterials from "@floor/atlas/materials";
import {
  characterMaterials,
  paletteValues,
  proportionPaletteValues,
  syntheticPaletteValues,
} from "@floor/atlas/materials";
import * as AtlasProportions from "@floor/atlas/proportions";
import { kitUnit, roomyRatios } from "@floor/atlas/proportions";
import * as AtlasTokens from "@floor/atlas/tokens";
import { type AtlasValue, colors } from "@floor/atlas/tokens";
import { expect, test } from "bun:test";
import { Effect, FileSystem, Option, Predicate, Record, Schema } from "effect";
import { runPlatformTest } from "./_runtime";

const Approval = Schema.TaggedStruct("OwnerApproved", {
  date: Schema.String,
  decisionReference: Schema.String,
});
const HexValues = Schema.Record(Schema.String, Schema.String);
const DayBrief = Schema.Struct({ approval: Approval, approvedVisibleDayValues: HexValues, lineOpacity: Schema.Finite });
const NightBrief = Schema.Struct({
  approval: Approval,
  approvedVisibleNightValues: HexValues,
  lineOpacity: Schema.Finite,
});
const ProportionBrief = Schema.Struct({
  approval: Approval,
  approvedKitUnit: Schema.Struct({
    definition: Schema.String,
    standingHeightK: Schema.Finite,
    physicalScale: Schema.Null,
  }),
  approvedRatiosRelativeToH: Schema.Record(Schema.String, Schema.Finite),
});
const materialBriefs = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const day = yield* Schema.decodeEffect(Schema.fromJsonString(DayBrief))(
    yield* fs.readFileString("testing/look/scenes/materials-day.json"),
  );
  const night = yield* Schema.decodeEffect(Schema.fromJsonString(NightBrief))(
    yield* fs.readFileString("testing/look/scenes/materials-night.json"),
  );
  return { day, night };
});
const themes: ReadonlyArray<"day" | "night"> = ["day", "night"];
const fromHex = (value: string) => Number.parseInt(value.slice(1), 16);
const Metadata = Schema.Struct({
  value: Schema.Unknown,
  status: Schema.Union([
    Schema.TaggedStruct("Approved", {
      decisionDate: Schema.String,
      decisionReference: Schema.String,
      sceneBrief: Schema.String,
      sourceKey: Schema.String,
      scope: Schema.NonEmptyString,
    }),
    Schema.Struct({
      _tag: Schema.Literals(["Provisional", "Synthetic"]),
      source: Schema.NonEmptyString,
      reason: Schema.NonEmptyString,
    }),
  ]),
});

const metadataExports = () => {
  interface ExportNode {
    readonly owner: string;
    readonly path: string;
    readonly value: unknown;
  }
  const entries: Array<ExportNode> = [];
  const seen = new WeakSet<object>();
  const pending: Array<ExportNode> = Object.entries({
    tokens: AtlasTokens,
    materials: AtlasMaterials,
    look: AtlasLook,
    proportions: AtlasProportions,
    camera: AtlasCamera,
  }).map(([owner, value]) => ({ owner, path: "", value }));
  // Discover all five public modules so newly added camera/look entries cannot
  // evade the approval check merely by being absent from a hand-built inventory.
  for (const node of pending) {
    const value = node.value;
    if (!Predicate.isObjectOrArray(value) || Schema.isSchema(value) || seen.has(value)) continue;
    seen.add(value);
    if (Predicate.hasProperty(value, "status")) entries.push(node);
    pending.push(
      ...Object.entries(value).map(([name, child]) => ({
        owner: node.owner,
        path: node.path.length > 0 ? `${node.path}.${name}` : name,
        value: child,
      })),
    );
  }
  return entries;
};

// The briefs are read at test time, never imported into production or copied
// into expected palettes. A new approved key must be represented, and an Atlas
// approval with no matching key in its cited brief fails in the other direction.
const checkApprovals = (
  entries: ReadonlyArray<AtlasValue<number>>,
  expected: Readonly<Record<string, number>>,
  brief: string,
  approval: typeof Approval.Type,
) => {
  const covered = new Set<string>();
  for (const entry of entries) {
    if (entry.status._tag !== "Approved") continue;
    expect(entry.status.sceneBrief).toBe(brief);
    expect(approval.date).toBe(entry.status.decisionDate);
    expect(approval.decisionReference).toBe(entry.status.decisionReference);
    expect(entry.status.scope.length).toBeGreaterThan(0);
    expect(expected[entry.status.sourceKey]).toBe(entry.value);
    covered.add(entry.status.sourceKey);
  }
  expect([...covered].toSorted()).toEqual(Object.keys(expected).toSorted());
};

const materialSourceKey = (slot: string) => {
  if (slot.startsWith("paper-")) return "paper";
  if (slot.startsWith("screen-light-")) return "screen-light";
  if (slot.startsWith("lamp-light-")) return "lamp-light";
  return slot;
};

const checkApprovedSlots = (theme: "day" | "night", expected: Readonly<Record<string, number>>) => {
  for (const [slot, pair] of Object.entries(paletteValues)) {
    const semanticKey = materialSourceKey(slot);
    const value = Record.get(expected, semanticKey);
    if (slot === "paper" || Option.isNone(value)) continue;
    expect(pair[theme].status._tag).toBe("Approved");
    expect(pair[theme].value).toBe(value.value);
    if (pair[theme].status._tag === "Approved") expect(pair[theme].status.sourceKey).toBe(semanticKey);
  }
};

test("every approved Atlas hex and opacity matches its exact day or night brief", () =>
  runPlatformTest(
    Effect.gen(function*() {
      const briefs = yield* materialBriefs;
      for (const theme of themes) {
        const brief = theme === "day" ? briefs.day : briefs.night;
        const hexValues = theme === "day"
          ? briefs.day.approvedVisibleDayValues
          : briefs.night.approvedVisibleNightValues;
        const expected = Object.fromEntries(Object.entries(hexValues).map(([name, value]) => [name, fromHex(value)]));
        expect(Object.keys(expected)).toHaveLength(theme === "day" ? 25 : 28);
        checkApprovals(
          [
            ...Object.values(colors).map((entry) => entry[theme]),
            ...Object.values(paletteValues).map((entry) => entry[theme]),
            ...Object.values(proportionPaletteValues).map((entry) => entry[theme]),
            ...Object.values(syntheticPaletteValues).map((entry) => entry[theme]),
            darkLine[theme],
            lineOpacity[theme],
          ],
          { ...expected, lineOpacity: brief.lineOpacity },
          `testing/look/scenes/materials-${theme}.json`,
          brief.approval,
        );
        checkApprovedSlots(theme, expected);
      }
    }),
    BunFileSystem.layer,
  ));

test("every Roomy ratio and K = H/8 agrees with all five scoped proportion briefs", () =>
  runPlatformTest(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      const citedBrief = "testing/look/scenes/proportions-post-day.json";
      for (const view of ["post-day", "post-night", "floor-day", "cast-day", "readability-day"]) {
        const brief = yield* Schema.decodeEffect(Schema.fromJsonString(ProportionBrief))(
          yield* fs.readFileString(`testing/look/scenes/proportions-${view}.json`),
        );
        expect(brief.approvedKitUnit.definition).toBe("K = H / 8");
        expect(brief.approvedKitUnit.physicalScale).toBeNull();
        expect(Object.keys(brief.approvedRatiosRelativeToH)).toHaveLength(9);
        expect(Object.fromEntries(Object.entries(roomyRatios).map(([name, entry]) => [name, entry.value])))
          .toEqual(brief.approvedRatiosRelativeToH);
        for (const entry of [...Object.values(roomyRatios), kitUnit]) expect(entry.status._tag).toBe("Approved");
        checkApprovals(
          [...Object.values(roomyRatios), kitUnit],
          { ...brief.approvedRatiosRelativeToH, standingHeightK: brief.approvedKitUnit.standingHeightK },
          citedBrief,
          brief.approval,
        );
      }
    }),
    BunFileSystem.layer,
  ));

test("every approval exported by all five Atlas modules has a matching tracked source", () =>
  runPlatformTest(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      const briefs = yield* materialBriefs;
      const roomy = yield* Schema.decodeEffect(Schema.fromJsonString(ProportionBrief))(
        yield* fs.readFileString("testing/look/scenes/proportions-post-day.json"),
      );
      const sources = {
        "testing/look/scenes/materials-day.json": {
          approval: briefs.day.approval,
          values: {
            ...Object.fromEntries(
              Object.entries(briefs.day.approvedVisibleDayValues).map(([name, value]) => [name, fromHex(value)]),
            ),
            lineOpacity: briefs.day.lineOpacity,
          },
        },
        "testing/look/scenes/materials-night.json": {
          approval: briefs.night.approval,
          values: {
            ...Object.fromEntries(
              Object.entries(briefs.night.approvedVisibleNightValues).map(([name, value]) => [name, fromHex(value)]),
            ),
            lineOpacity: briefs.night.lineOpacity,
          },
        },
        "testing/look/scenes/proportions-post-day.json": {
          approval: roomy.approval,
          values: { ...roomy.approvedRatiosRelativeToH, standingHeightK: roomy.approvedKitUnit.standingHeightK },
        },
      };
      const approvedProportions = new Set([
        "kitUnit",
        ...Object.keys(roomy.approvedRatiosRelativeToH).map(name => `roomyRatios.${name}`),
      ]);
      const approvedLook = new Set(["lineOpacity.day", "lineOpacity.night", "darkLine.night"]);
      for (const raw of metadataExports()) {
        const entry = yield* Schema.decodeUnknownEffect(Metadata)(raw.value);
        const status = entry.status;
        if (raw.owner === "camera") expect(status._tag).toBe("Synthetic");
        if (raw.owner === "proportions") expect(status._tag === "Approved").toBe(approvedProportions.has(raw.path));
        if (raw.owner === "look") expect(status._tag === "Approved").toBe(approvedLook.has(raw.path));
        if (status._tag !== "Approved") continue;
        const source = Option.fromNullishOr(
          Object.entries(sources).find(([name]) => name === status.sceneBrief),
        );
        expect(Option.isSome(source)).toBe(true);
        if (Option.isNone(source)) continue;
        expect(source.value[1].approval.date).toBe(status.decisionDate);
        expect(source.value[1].approval.decisionReference).toBe(status.decisionReference);
        const value = yield* Schema.decodeUnknownEffect(Schema.Finite)(entry.value);
        const expected = Object.entries(source.value[1].values).find(([name]) => name === status.sourceKey)?.[1];
        expect(expected).toBe(value);
      }
    }),
    BunFileSystem.layer,
  ));

test("the neutral diagnostic palette remains entirely synthetic", () => {
  for (const pair of Object.values(syntheticPaletteValues)) {
    for (const theme of themes) expect(pair[theme].status._tag).toBe("Synthetic");
  }
});

test("material and proportion approval never promotes excluded semantic uses or unseen faces", () => {
  for (const entry of Object.values(characterMaterials)) expect(entry.status._tag).toBe("Provisional");
  for (const theme of themes) {
    for (const [slot, pair] of Object.entries(paletteValues)) {
      if (slot.startsWith("brass-") || slot.startsWith("engraving-")) {
        expect(pair[theme].status._tag).toBe("Provisional");
      }
    }
    for (const slot of ["timber-0", "floor-0", "steel-0", "jacket-blue-0", "jacket-red-0", "jacket-green-0"]) {
      const entry = Object.entries(paletteValues).find(([name]) => name === slot)?.[1][theme];
      expect(entry?.status._tag).toBe("Synthetic");
    }
    for (const [slot, pair] of Object.entries(proportionPaletteValues)) {
      if (slot.startsWith("tone-") || ["steel-0", "jacket-blue-0", "jacket-red-0", "jacket-green-0"].includes(slot)) {
        expect(pair[theme].status._tag).toBe("Provisional");
      }
    }
    expect(paletteValues.paper[theme].status._tag).toBe("Synthetic");
    expect(paletteValues.steel[theme].status._tag).toBe("Synthetic");
  }
  for (const [slot, pair] of Object.entries(paletteValues)) {
    if (slot.startsWith("screen-light-") || slot.startsWith("lamp-light-")) {
      expect(pair.day.status._tag).toBe("Synthetic");
    }
  }
  expect(darkLine.day.status._tag).toBe("Synthetic");
});
import { BunFileSystem } from "@effect/platform-bun";
