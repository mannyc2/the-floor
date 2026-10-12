import { Array, Effect, Option, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { ServerConfig } from "./config";
import { FloorDatabase } from "./store";

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character,
  );
const receiptChains = new Map([
  [8453, { name: "Base", explorer: "https://basescan.org" }],
  [84532, { name: "Base Sepolia", explorer: "https://sepolia.basescan.org" }],
]);

/**
 * A plate is a public, immutable capture; its permalink carries the recorded block rather than current atlas state.
 * @stability unstable
 */
export const PlatePageRoute = HttpRouter.add(
  "GET",
  "/plates/:number",
  Effect.gen(function*() {
    const db = yield* FloorDatabase;
    const config = yield* ServerConfig;
    const parameters = yield* HttpRouter.params;
    const number = yield* Schema.decodeEffect(Schema.Int)(Number(parameters["number"]));
    const plate = yield* db.plates.findById(number);
    const publicAgents = new Set(
      Array.map(Array.filter(yield* db.agents.list(), agent => agent.visibility === "public"), agent => agent.id),
    );
    const receipts = Array.filter(
      Array.map(yield* db.receipts.list(), row => row.data),
      receipt => plate.receiptIds.includes(receipt.id) && publicAgents.has(receipt.agentId),
    );
    const receiptLinks = Array.map(
      receipts,
      receipt =>
        Option.match(
          Option.all({
            hash: Option.fromNullOr(receipt.transactionHash),
            chain: Option.fromUndefinedOr(receiptChains.get(receipt.chainId)),
          }),
          {
            onNone: () =>
              `<li>${escapeHtml(receipt.id)} · chain ${receipt.chainId} · ${escapeHtml(receipt.status)}</li>`,
            onSome: ({ hash, chain }) =>
              `<li><a href="${chain.explorer}/tx/${encodeURIComponent(hash)}">${
                escapeHtml(receipt.id)
              }</a> · ${chain.name} · ${escapeHtml(receipt.status)}</li>`,
          },
        ),
    ).join("");
    return HttpServerResponse.html(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Plate ${plate.number} — ${
        escapeHtml(plate.title)
      }</title><meta property="og:type" content="website"><meta property="og:title" content="${
        escapeHtml(plate.title)
      }"><meta property="og:url" content="${
        escapeHtml(config.origin)
      }/plates/${plate.number}"><meta property="og:image" content="${
        escapeHtml(config.origin)
      }/api/plates/${plate.number}/image"><meta name="twitter:card" content="summary_large_image"><style>body{max-width:1100px;margin:48px auto;padding:0 24px;background:#f4f1ea;color:#303337;font:16px Georgia,serif}header,footer{border-block:1px solid;padding:18px 0}h1{font-size:40px;font-weight:normal}img{width:100%;display:block;border:1px solid #d8d5cb}small,.source{font:12px monospace;line-height:1.8}a{color:inherit}figcaption{padding:18px 0}footer{margin-top:32px}@media print{body{margin:0;padding:0}.download{display:none}}</style></head><body><header><a href="/">THE FLOOR</a> / THE PERMANENT RECORD</header><h1>Plate ${plate.number}: ${
        escapeHtml(plate.title)
      }</h1><p class="source">Base market block <a href="https://basescan.org/block/${plate.blockNumber}">${
        plate.blockNumber.toLocaleString("en-US")
      }</a> · ${escapeHtml(plate.view)} view<br>Captured ${escapeHtml(plate.createdAt)} · ${
        escapeHtml(plate.marketId)
      }</p><figure><img src="/api/plates/${plate.number}/image" alt="${
        escapeHtml(plate.title)
      }"><figcaption>A captured reading from its source block. Later market movements do not change this plate.</figcaption></figure><p class="download"><a href="/api/plates/${plate.number}/image" download="floor-plate-${plate.number}.png">Download the image</a> · <a href="/?market=${
        encodeURIComponent(plate.marketId)
      }">Open the current market</a></p><h2>Receipts in this record</h2>${
        receipts.length > 0 ? `<ul>${receiptLinks}</ul>` : "<p>No public confirmed receipts were linked at capture.</p>"
      }<footer><small>Market data: Base mainnet. Each linked transaction receipt names its own chain.</small></footer></body></html>`,
    );
  }).pipe(Effect.orElseSucceed(() => HttpServerResponse.text("Plate not found", { status: 404 }))),
);
