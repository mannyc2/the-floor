import { GateReview, LaunchGate } from "@floor/gate";
import { scopedAccountsLayer, Signing, TransactionExecutor } from "@floor/signing";
import { ConfigProvider, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { unavailableGateEdges } from "../../../gate/src/testing";
import { AccountContext } from "../account-context";
import { LaunchReviewEvidence, LaunchReviews } from "../launch-reviews";
import { NotePositions, PositionChain } from "../note-positions";
import { Proposals } from "../proposals";
import { SigningJournalLive } from "../signing-journal";

// Research-only fixtures still cross the production policy and receipt boundary; absent external account credentials are explicit.
/** @stability unstable */
export const unconfiguredProposals = Layer.mergeAll(Proposals.layer, NotePositions.layer).pipe(
  Layer.provide(PositionChain.layer),
  Layer.provide(Signing.layer),
  Layer.provide(SigningJournalLive),
  Layer.provide(AccountContext.layer),
  Layer.provide(LaunchReviews.layer),
  Layer.provide(LaunchGate.layer),
  Layer.provide(GateReview.layer.pipe(Layer.provide(unavailableGateEdges))),
  Layer.provide(LaunchReviewEvidence.layer),
  Layer.provide(TransactionExecutor.unavailable),
  Layer.provide(scopedAccountsLayer.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
  )),
);
