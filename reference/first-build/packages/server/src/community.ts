import { Address, type AdoptedDesign, defaults, DesignElection, TransactionHash } from "@floor/contract";
import { MarketHistory } from "@floor/markets";
import { createLayout, designFit } from "@floor/renderer/layout";
import { atlasMarket } from "@floor/renderer/market-view";
import { ApiError, type AtlasSnapshot, type Owner } from "@floor/surfaces";
import { Context, Crypto, DateTime, Duration, Effect, Layer, Option, Schema } from "effect";
import { Model } from "effect/schema";
import { SqlClient, SqlModel, SqlSchema } from "effect/sql";
import { TokenHolders } from "./holder-evidence";
import { FloorDatabase } from "./store";

class ElectionRow extends Model.Class<ElectionRow>("ElectionRow")({
  id: Model.Field({ select: Schema.String, update: Schema.String }),
  data: Schema.fromJsonString(DesignElection),
}) {}
const Ballot = Schema.Struct({ wallet: Address, weight: Schema.String, support: Schema.BooleanFromBit });
const communityError = (error: { readonly _tag: string; readonly message?: string }): ApiError =>
  Schema.is(ApiError)(error) ? error : new ApiError({
    message: error._tag === "HolderEvidenceError"
      ? (error.message ?? "Holder balances could not be verified.")
      : "The community vote could not be completed. Refresh its current state before retrying.",
  });
const verifiedWallet = Effect.fn("Community.verifiedWallet")(function*(owner: Owner) {
  if (owner.mode !== "wallet") return yield* new ApiError({ message: "Verify your owner wallet before voting." });
  const address = yield* Schema.decodeUnknownEffect(Address)(owner.walletAddress);
  return yield* Schema.decodeUnknownEffect(Address)(address.toLowerCase());
});

const makeCommunity = Effect.gen(function*() {
  const db = yield* FloorDatabase;
  const holders = yield* TokenHolders;
  const history = yield* MarketHistory;
  const crypto = yield* Crypto.Crypto;
  const repository = yield* SqlModel.makeRepository(ElectionRow, {
    tableName: "design_elections",
    idColumn: "id",
    spanPrefix: "DesignElections",
  });
  const rows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ElectionRow,
    execute: () => db.sql`SELECT * FROM design_elections ORDER BY json_extract(data, '$.createdAt'), id`,
  });
  const ballots = SqlSchema.findAll({
    Request: Schema.String,
    Result: Ballot,
    execute: id => db.sql`SELECT wallet, weight, support FROM design_ballots WHERE electionId = ${id}`,
  });
  const openFor = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: ElectionRow,
    execute: marketId =>
      db.sql`SELECT * FROM design_elections WHERE json_extract(data, '$.marketId') = ${marketId} AND json_extract(data, '$.status') = 'open'`,
  });
  const load = Effect.fn("Community.load")(function*(id: string) {
    return (yield* repository.findById(id)).data;
  });
  const event = Effect.fn("Community.event")(function*(type: string, owner: Owner, election: DesignElection) {
    yield* db.events.insert({
      id: yield* crypto.randomUUIDv4,
      type,
      actor: owner.id,
      entityId: election.id,
      blockNumber: election.blockNumber,
      createdAt: DateTime.formatIso(yield* DateTime.now),
      payload: { marketId: election.marketId, designId: election.designId, status: election.status },
    });
  });
  const tally = Effect.fn("Community.tally")(function*(election: DesignElection) {
    const votes = yield* ballots(election.id);
    const support = votes.filter(vote => vote.support).reduce((total, vote) => total + BigInt(vote.weight), 0n);
    const oppose = votes.filter(vote => !vote.support).reduce((total, vote) => total + BigInt(vote.weight), 0n);
    if (support + oppose > BigInt(election.supplyRaw)) {
      return yield* new ApiError({ message: "The recorded votes exceed the snapshot supply; adoption is refused." });
    }
    return { ...election, supportRaw: support.toString(), opposeRaw: oppose.toString() };
  });
  const acceptedDesign = Effect.fn("Community.acceptedDesign")(function*(id: string) {
    const submission = yield* db.designs.findById(id);
    if (submission.status !== "accepted" || submission.checks.some(check => check.status !== "pass")) {
      return yield* new ApiError({ message: "Only a design that passed every gate check can enter a holder vote." });
    }
    return submission.design;
  });
  const ensureOpen = Effect.fn("Community.ensureOpen")(function*(election: DesignElection) {
    const now = yield* DateTime.now;
    if (election.status !== "open" || DateTime.isGreaterThanOrEqualTo(now, DateTime.makeUnsafe(election.closesAt))) {
      return yield* new ApiError({ message: "This holder vote is closed." });
    }
    return yield* Effect.void;
  });
  return {
    list: rows().pipe(Effect.map(entries => entries.map(row => row.data)), Effect.mapError(communityError)),
    adoptedAt: Effect.fn("Community.adoptedAt")(function*(observedAt: string) {
      const cutoff = DateTime.makeUnsafe(observedAt);
      const latest = new Map<string, AdoptedDesign>();
      for (const { data: election } of yield* rows()) {
        const adoptedAt = Option.fromNullOr(election.finalizedAt);
        if (
          election.status !== "adopted" || Option.isNone(adoptedAt)
          || DateTime.isGreaterThan(DateTime.makeUnsafe(adoptedAt.value), cutoff)
        ) continue;
        const previous = Option.fromUndefinedOr(latest.get(election.marketId));
        if (Option.isSome(previous) && previous.value.adoptedAt > adoptedAt.value) continue;
        latest.set(election.marketId, {
          electionId: election.id,
          marketId: election.marketId,
          design: yield* acceptedDesign(election.designId),
          adoptedAt: adoptedAt.value,
        });
      }
      return [...latest.values()];
    }, Effect.mapError(communityError)),
    propose: Effect.fn("Community.propose")(
      function*(owner: Owner, designId: string, marketId: string, snapshot: AtlasSnapshot) {
        const wallet = yield* verifiedWallet(owner);
        const design = yield* acceptedDesign(designId);
        const market = yield* Effect.fromOption(
          Option.fromUndefinedOr(snapshot.market.markets.find(item => item.id === marketId)),
        );
        const now = yield* DateTime.now;
        const sourceAge = Duration.toMillis(
          DateTime.distance(DateTime.makeUnsafe(snapshot.market.blockTimestamp), now),
        );
        if (snapshot.replay || snapshot.market.source !== "chain" || sourceAge < 0 || sourceAge > 300_000) {
          return yield* new ApiError({
            message: "Start a holder vote from a fresh live Base reading, not replay or a fallback recording.",
          });
        }
        if (
          design.kind !== market.kind
          || ![market.id, market.token.address.toLowerCase()].includes(design.tokenId.toLowerCase())
        ) {
          return yield* new ApiError({ message: "This accepted design belongs to a different market or token." });
        }
        const layout = createLayout(snapshot.market.markets.map(atlasMarket), {
          lens: "flow",
          moorings: new Set(),
          explodedId: Option.none(),
          activeMarketId: Option.fromNullOr(snapshot.activeMarketId),
          slots: snapshot.slots,
          tiers: snapshot.tiers,
        });
        const fit = designFit(design, marketId, layout.markets);
        if (
          !Option.exists(fit, site =>
            site.plinthAvailable && !site.overlapsMachine
            && design.bounds.width <= site.maxWidth && design.bounds.depth <= site.maxDepth)
        ) {
          return yield* new ApiError({
            message: "This design no longer fits the market's current tier and reserved footprint.",
          });
        }
        const token = yield* Schema.decodeUnknownEffect(Address)(market.token.address);
        const blockHash = yield* Schema.decodeUnknownEffect(TransactionHash)(snapshot.market.blockHash);
        const ownership = yield* holders.at({ token, wallet, blockNumber: snapshot.market.blockNumber, blockHash });
        if (ownership.balance <= 0n) {
          return yield* new ApiError({ message: "Only a holder at the voting source block can propose a design." });
        }
        const quorumRaw = (ownership.supply * BigInt(defaults.quorumSupplyPercent) + 99n) / 100n;
        const election: DesignElection = {
          id: yield* crypto.randomUUIDv4,
          designId,
          marketId,
          token,
          symbol: market.symbol,
          proposer: wallet,
          blockNumber: snapshot.market.blockNumber,
          blockHash,
          supplyRaw: ownership.supply.toString(),
          quorumRaw: quorumRaw.toString(),
          supportRaw: "0",
          opposeRaw: "0",
          createdAt: DateTime.formatIso(now),
          closesAt: DateTime.formatIso(DateTime.add(now, { hours: defaults.voteHours })),
          // oxlint-disable-next-line effect/noNullish -- A public open ballot has no finalization timestamp in its transport schema.
          finalizedAt: null,
          status: "open",
        };
        yield* db.sql.withTransaction(Effect.gen(function*() {
          if (Option.isSome(yield* openFor(marketId))) {
            return yield* new ApiError({ message: "This market already has an open holder vote." });
          }
          yield* history.pin(election.blockNumber);
          yield* repository.insert({ data: election });
          return yield* event("design-vote-opened", owner, election);
        }));
        return election;
      },
      Effect.mapError(communityError),
    ),
    vote: Effect.fn("Community.vote")(function*(owner: Owner, id: string, support: boolean) {
      const wallet = yield* verifiedWallet(owner);
      const election = yield* load(id);
      yield* ensureOpen(election);
      const ownership = yield* holders.at({
        token: election.token,
        wallet,
        blockNumber: election.blockNumber,
        blockHash: election.blockHash,
      });
      if (ownership.balance <= 0n || ownership.supply.toString() !== election.supplyRaw) {
        return yield* new ApiError({
          message: "A vote requires a verified token balance at this ballot's fixed source block.",
        });
      }
      return yield* db.sql.withTransaction(Effect.gen(function*() {
        const fresh = yield* load(id);
        yield* ensureOpen(fresh);
        // The unique wallet key is independent of session and owner IDs; changing a vote replaces its weight instead of adding it.
        yield* db
          .sql`INSERT INTO design_ballots(electionId, wallet, weight, support) VALUES (${id}, ${wallet}, ${ownership.balance.toString()}, ${
          support ? 1 : 0
        }) ON CONFLICT(electionId, wallet) DO UPDATE SET support = excluded.support`;
        const updated = yield* tally(fresh);
        yield* repository.update({ id, data: updated });
        yield* event("design-vote-cast", owner, updated);
        return updated;
      }));
    }, Effect.mapError(communityError)),
    finalize: Effect.fn("Community.finalize")(function*(owner: Owner, id: string) {
      const election = yield* load(id);
      if (election.status !== "open") return election;
      const now = yield* DateTime.now;
      if (DateTime.isLessThan(now, DateTime.makeUnsafe(election.closesAt))) {
        return yield* new ApiError({ message: "The full 72-hour holder vote must finish before adoption." });
      }
      // Canonical source verification is repeated before adoption, including when no further vote arrived after a reorg.
      const ownership = yield* holders.at({
        token: election.token,
        wallet: election.proposer,
        blockNumber: election.blockNumber,
        blockHash: election.blockHash,
      });
      if (ownership.supply.toString() !== election.supplyRaw) {
        return yield* new ApiError({ message: "The voting supply changed at its source block." });
      }
      yield* acceptedDesign(election.designId);
      return yield* db.sql.withTransaction(Effect.gen(function*() {
        const fresh = yield* load(id);
        if (fresh.status !== "open") return fresh;
        const votes = yield* tally(fresh);
        const support = BigInt(votes.supportRaw);
        const oppose = BigInt(votes.opposeRaw);
        const updated: DesignElection = {
          ...votes,
          finalizedAt: DateTime.formatIso(now),
          status: support + oppose >= BigInt(votes.quorumRaw) && support > oppose ? "adopted" : "rejected",
        };
        yield* repository.update({ id, data: updated });
        yield* event("design-vote-finalized", owner, updated);
        return updated;
      }));
    }, Effect.mapError(communityError)),
  };
});

/** @stability unstable */
export class Community extends Context.Service<Community, Effect.Success<typeof makeCommunity>>()("floor/Community") {
  static readonly layer = Layer.effect(Community, makeCommunity).pipe(
    Layer.provide(Layer.effect(SqlClient.SqlClient, Effect.map(FloorDatabase, db => db.sql))),
  );
}
