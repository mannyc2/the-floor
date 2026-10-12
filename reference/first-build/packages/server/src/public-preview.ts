import { type Note, publicAgent } from "@floor/contract";
import { ApiError } from "@floor/surfaces";
import { Cache, Context, Data, Effect, Layer, Option, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { Atlas } from "./atlas";
import { ServerConfig } from "./config";
import { PlateRenderer } from "./plate-renderer";
import { FloorDatabase } from "./store";

const PreviewKind = Schema.Literals(["market", "agent"]);
type PreviewKind = typeof PreviewKind.Type;
class PreviewKey extends Data.Class<{
  readonly kind: PreviewKind;
  readonly id: string;
  readonly blockNumber: number;
  readonly blockHash: string;
  readonly title: string;
}> {}
const missing = () => new ApiError({ message: "This public preview is unavailable." });
const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character,
  );
const noteHtml = (note: Note): string => {
  const position = Option.fromNullOr(note.positionEvidence);
  const disclosure = note.position.disclosure === "disclosed"
    ? `${escapeHtml(note.position.amount)} ${escapeHtml(note.position.symbol)}`
    : "Unavailable";
  const provenance = Option.match(position, {
    onNone: () => "",
    onSome: evidence =>
      ` · chain ${evidence.chainId} · account ${escapeHtml(evidence.account)} · holdings block ${evidence.blockNumber}`,
  });
  const sources = note.sources.filter(source => source.url.startsWith("https://")).map(source =>
    `<a href="${escapeHtml(source.url)}">${escapeHtml(source.label)}</a>`
  ).join(" · ");
  return `<article><p>${escapeHtml(note.claim)}</p><small>${escapeHtml(note.status)} · ${
    escapeHtml(note.createdAt)
  }<br>Position when written: ${disclosure}${provenance}</small><p>${sources}</p></article>`;
};

const makePreviews = Effect.gen(function*() {
  const db = yield* FloorDatabase;
  const atlas = yield* Atlas;
  const renderer = yield* PlateRenderer;
  const publicDesk = Effect.fn("PublicPreviews.desk")(function*(id: string) {
    const agent = yield* db.agents.findById(id);
    if (agent.visibility !== "public") return yield* missing();
    return {
      agent: publicAgent(agent),
      notes: (yield* db.notes.listPublic()).filter(note => note.agentId === id),
    };
  }, Effect.mapError(missing));
  const describe = Effect.fn("PublicPreviews.describe")(
    function*(kind: PreviewKind, id: string, block: Option.Option<number>) {
      const snapshot = yield* atlas.snapshot(block);
      const desk = kind === "agent" ? Option.some(yield* publicDesk(id)) : Option.none();
      const market = Option.fromUndefinedOr(
        kind === "market"
          ? snapshot.market.markets.find(item => item.id === id)
          : snapshot.market.markets.find(item =>
            Option.exists(desk, value => value.notes.some(note => note.marketId === item.id))
          )
            ?? snapshot.market.markets[0],
      );
      if (Option.isNone(market)) return yield* missing();
      return {
        snapshot,
        market: market.value,
        desk,
        title: Option.match(desk, {
          onNone: () => `${market.value.name} · ${market.value.symbol}`,
          onSome: value => `${value.agent.name}’s public desk`,
        }),
      };
    },
  );
  const cache = yield* Cache.make({
    capacity: 64,
    timeToLive: "30 seconds",
    lookup: Effect.fn("PublicPreviews.render")(function*(key: PreviewKey) {
      const value = yield* describe(key.kind, key.id, Option.some(key.blockNumber));
      if (value.snapshot.market.blockNumber !== key.blockNumber || value.snapshot.market.blockHash !== key.blockHash) {
        return yield* missing();
      }
      const encoded = yield* renderer.render({
        title: value.title.slice(0, 180),
        marketId: value.market.id,
        snapshot: value.snapshot,
        view: "machine",
        evidence: {
          agents: Option.match(value.desk, { onNone: () => [], onSome: desk => [desk.agent] }),
          notes: Option.match(value.desk, { onNone: () => [], onSome: desk => desk.notes }),
          receipts: [],
          observedAt: value.snapshot.market.blockTimestamp,
          chainId: value.snapshot.market.chainId,
          blockNumber: value.snapshot.market.blockNumber,
        },
      });
      return yield* Effect.fromResult(Base64.decode(encoded.slice("data:image/png;base64,".length))).pipe(
        Effect.mapError(missing),
      );
    }),
  });
  const image = Effect.fn("PublicPreviews.image")(function*(kind: PreviewKind, id: string, blockNumber: number) {
    // Recheck public access before a cache hit: switching a desk to private must immediately close its preview route.
    const value = yield* describe(kind, id, Option.some(blockNumber));
    return yield* Cache.get(
      cache,
      new PreviewKey({ kind, id, blockNumber, blockHash: value.snapshot.market.blockHash, title: value.title }),
    );
  });
  return { describe, image };
});

/** @stability unstable */
export class PublicPreviews extends Context.Service<PublicPreviews, Effect.Success<typeof makePreviews>>()(
  "floor/PublicPreviews",
) {
  static readonly layer = Layer.effect(PublicPreviews, makePreviews);
}

const page = (kind: PreviewKind) =>
  Effect.gen(function*() {
    const previews = yield* PublicPreviews;
    const config = yield* ServerConfig;
    const { id } = yield* HttpRouter.params;
    const identifier = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(id);
    const value = yield* previews.describe(kind, identifier, Option.none());
    const path = `/${kind === "market" ? "markets" : "agents"}/${encodeURIComponent(identifier)}`;
    const imageUrl = `${config.origin}/api/previews/${kind}/${
      encodeURIComponent(identifier)
    }/${value.snapshot.market.blockNumber}/image`;
    const canonical = `${config.origin}${path}`;
    const title = escapeHtml(value.title);
    const evidence = Option.match(value.desk, {
      onNone: () =>
        `<p>${escapeHtml(value.market.kind)} · ${escapeHtml(value.market.venue)} · ${escapeHtml(value.market.symbol)}/${
          escapeHtml(value.market.quote.symbol)
        }</p>`,
      onSome: desk =>
        `${
          Option.match(desk.agent.publishedMandate, {
            onNone: () => "",
            onSome: mandate => `<p>${escapeHtml(mandate)}</p>`,
          })
        }<h2>Public research</h2>${
          desk.notes.length === 0 ? "<p>No public research has been published.</p>" : desk.notes.map(noteHtml).join("")
        }`,
    });
    return HttpServerResponse.html(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title} — The Floor</title><link rel="canonical" href="${
        escapeHtml(canonical)
      }"><meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:url" content="${
        escapeHtml(canonical)
      }"><meta property="og:image" content="${
        escapeHtml(imageUrl)
      }"><meta name="twitter:card" content="summary_large_image"><style>body{max-width:1100px;margin:48px auto;padding:0 24px;background:#f4f1ea;color:#303337;font:16px Georgia,serif}header,footer{border-block:1px solid;padding:18px 0}h1{font-size:40px;font-weight:normal}img{width:100%;border:1px solid #d8d5cb}small{font:12px monospace}a{color:inherit}article{border-bottom:1px solid #d8d5cb;padding:12px 0}footer{margin-top:32px}</style></head><body><header><a href="/">THE FLOOR</a> / PUBLIC RECORD</header><h1>${title}</h1><p><small>Base · ${
        escapeHtml(value.snapshot.market.source)
      } · source block ${value.snapshot.market.blockNumber} · ${
        escapeHtml(value.snapshot.market.blockTimestamp)
      }</small></p><img src="${escapeHtml(imageUrl)}" alt="Source-based atlas rendering"><p><a href="/?market=${
        encodeURIComponent(value.market.id)
      }">Open the current market on the atlas</a></p>${evidence}<footer>Readings and research retain their own source time and chain. Previews refresh with the atlas.</footer></body></html>`,
    );
  }).pipe(Effect.orElseSucceed(() => HttpServerResponse.text("Public record not found", { status: 404 })));

/** @stability unstable */
export const PublicPreviewRoutes = Layer.mergeAll(
  HttpRouter.add("GET", "/markets/:id", page("market")),
  HttpRouter.add("GET", "/agents/:id", page("agent")),
  HttpRouter.add(
    "GET",
    "/api/previews/:kind/:id/:block/image",
    Effect.gen(function*() {
      const previews = yield* PublicPreviews;
      const params = yield* HttpRouter.params;
      const kind = yield* Schema.decodeUnknownEffect(PreviewKind)(params["kind"]);
      const id = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(params["id"]);
      const block = yield* Schema.decodeEffect(Schema.Natural)(Number(params["block"]));
      const image = yield* previews.image(kind, id, block);
      return HttpServerResponse.uint8Array(image, {
        contentType: "image/png",
        headers: { "cache-control": "public,max-age=30" },
      });
    }).pipe(Effect.orElseSucceed(() => HttpServerResponse.text("Preview unavailable", { status: 404 }))),
  ),
);
