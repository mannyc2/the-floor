import { test } from "bun:test";
import { Effect, Option, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import {
  Author,
  Budget,
  Capability,
  ConfirmedPolicy,
  DraftPolicy,
  Emblem,
  Fraction,
  Mandate,
  Policy,
  PolicyLimits,
  Position,
  PositiveUsd,
  ProviderBalance,
  Usd,
  VerifiedWithdrawalDestination,
  Wallet,
} from "../src/agents.ts";
import {
  BoardPost,
  Brief,
  Channel,
  CommonsItem,
  CommonsReference,
  CreditEvent,
  Dataset,
  HttpUrl,
  Note,
  Source,
  Thesis,
  Tool,
} from "../src/community.ts";
import { LaunchIntent, LaunchSpec, PolicyDecision, ReceiptCause, Refusal } from "../src/economics.ts";
import { Health } from "../src/health.ts";
import {
  AccountRef,
  AgentId,
  AssetRef,
  BoardPostId,
  ChainRef,
  ChannelId,
  Checkpoint,
  CommonsId,
  CreditEventId,
  DeskId,
  DestinationId,
  Digest,
  FloorId,
  Height,
  IntentId,
  Label,
  OwnerId,
  PieceId,
  PlotId,
  PolicyId,
  ReceiptId,
  SignerId,
  StationId,
  Timestamp,
  TradingPostId,
  TransactionRef,
  VersionId,
  WalletId,
  WorldEventId,
  WorldId,
} from "../src/identifiers.ts";
import { Setting, SettingScope } from "../src/settings.ts";
import { expectPassed, roundTrip, runTest } from "./_runtime.ts";

const checkRoundTrips = <A, I>(name: string, schema: Schema.Codec<A, I>) =>
  test(`${name} preserves generated values through JSON`, () =>
    runTest(
      Arbitrary.checkEffect(Arbitrary.schema(schema), (value) => roundTrip(schema, value), {
        seed: name,
        runs: 64,
        size: 5,
        maxDiscards: 10000,
      }).pipe(Effect.tap(expectPassed)),
    ));

checkRoundTrips("Health", Health);
checkRoundTrips("ChainRef", ChainRef);
checkRoundTrips("AccountRef", AccountRef);
checkRoundTrips("AssetRef", AssetRef);
checkRoundTrips("WorldId", WorldId);
checkRoundTrips("FloorId", FloorId);
checkRoundTrips("TradingPostId", TradingPostId);
checkRoundTrips("StationId", StationId);
checkRoundTrips("DeskId", DeskId);
checkRoundTrips("PlotId", PlotId);
checkRoundTrips("PieceId", PieceId);
checkRoundTrips("VersionId", VersionId);
checkRoundTrips("AgentId", AgentId);
checkRoundTrips("OwnerId", OwnerId);
checkRoundTrips("PolicyId", PolicyId);
checkRoundTrips("ReceiptId", ReceiptId);
checkRoundTrips("IntentId", IntentId);
checkRoundTrips("CommonsId", CommonsId);
checkRoundTrips("BoardPostId", BoardPostId);
checkRoundTrips("ChannelId", ChannelId);
checkRoundTrips("CreditEventId", CreditEventId);
checkRoundTrips("WorldEventId", WorldEventId);
checkRoundTrips("WalletId", WalletId);
checkRoundTrips("DestinationId", DestinationId);
checkRoundTrips("SignerId", SignerId);
checkRoundTrips("Label", Label);
checkRoundTrips("Timestamp", Timestamp);
checkRoundTrips("Digest", Digest);
checkRoundTrips("Height", Height);
checkRoundTrips("TransactionRef", TransactionRef);
checkRoundTrips("Checkpoint", Checkpoint);
checkRoundTrips("Usd", Usd);
checkRoundTrips("PositiveUsd", PositiveUsd);
checkRoundTrips("Fraction", Fraction);
checkRoundTrips("Capability", Capability);
checkRoundTrips("Mandate", Mandate);
checkRoundTrips("Wallet", Wallet);
checkRoundTrips("VerifiedWithdrawalDestination", VerifiedWithdrawalDestination);
checkRoundTrips("ProviderBalance", ProviderBalance);
checkRoundTrips("PolicyLimits", PolicyLimits);
checkRoundTrips("DraftPolicy", DraftPolicy);
checkRoundTrips("ConfirmedPolicy", ConfirmedPolicy);
checkRoundTrips("Policy", Policy);
checkRoundTrips("Budget", Budget);
checkRoundTrips("Emblem", Emblem);
checkRoundTrips("Position", Position);
checkRoundTrips("Author", Author);
checkRoundTrips("LaunchSpec", LaunchSpec);
checkRoundTrips("LaunchIntent", LaunchIntent);
checkRoundTrips("ReceiptCause", ReceiptCause);
checkRoundTrips("PolicyDecision", PolicyDecision);
checkRoundTrips("Refusal", Refusal);
checkRoundTrips("Source", Source);
checkRoundTrips("CommonsReference", CommonsReference);
checkRoundTrips("Note", Note);
checkRoundTrips("Thesis", Thesis);
checkRoundTrips("Tool", Tool);
checkRoundTrips("Dataset", Dataset);
checkRoundTrips("Brief", Brief);
checkRoundTrips("CommonsItem", CommonsItem);
checkRoundTrips("CreditEvent", CreditEvent);
checkRoundTrips("Channel", Channel);
checkRoundTrips("BoardPost", BoardPost);
checkRoundTrips("SettingScope", SettingScope);
checkRoundTrips("Setting", Setting);

test("an undecided large-trade default cannot acquire an invented measured amount", () =>
  runTest(
    Arbitrary.checkEffect(Arbitrary.schema(Setting.cases.LargeTradeDollars), (setting) =>
      Option.isNone(setting.default) && !Schema.is(Setting)({ ...setting, default: Option.some(setting.value) }), {
      seed: "undecided-setting-default",
      runs: 64,
      size: 5,
    }).pipe(Effect.tap(expectPassed)),
  ));

checkRoundTrips("HttpUrl", HttpUrl);

test("board posts reject a reply to their own identifier", () =>
  runTest(
    Arbitrary.checkEffect(Arbitrary.schema(BoardPost), (post) =>
      !Schema.is(BoardPost)({ ...post, replyTo: Option.some(post.id) }), {
      seed: "board-self-reply",
      runs: 128,
      size: 6,
    }).pipe(Effect.tap(expectPassed)),
  ));

test("setting keys enforce their value type and exact recorded default", () =>
  runTest(
    Arbitrary.checkEffect(Arbitrary.schema(Setting.cases.StationsPerPost), (setting) =>
      !Schema.is(Setting)({ ...setting, value: "ten" }) && !Schema.is(Setting)({ ...setting, default: 9 }), {
      seed: "typed-setting-default",
      runs: 64,
      size: 5,
    }).pipe(Effect.tap(expectPassed)),
  ));

test("evidence URLs reject executable, data and local-file schemes", () =>
  runTest(Effect.gen(function*() {
    for (const url of ["javascript:alert(1)", "data:text/html,hello", "file:///etc/passwd"]) {
      const result = yield* Schema.decodeEffect(HttpUrl)(url).pipe(Effect.result);
      if (result._tag !== "Failure") return yield* Effect.die("Non-web evidence URL was accepted");
    }
    const url = yield* Schema.decodeEffect(HttpUrl)("https://example.com/evidence");
    return yield* roundTrip(HttpUrl, url).pipe(Effect.filterOrFail((equal) => equal));
  })));
