import { assert, it } from "@effect/vitest";
import { publicAgent, publicReceipt, researchNote, undisclosedPosition } from "@floor/contract";
import { Markets } from "@floor/markets";
import { createLayout } from "@floor/renderer/layout";
import { atlasMarket } from "@floor/renderer/market-view";
import { Signing } from "@floor/signing";
import { Array, Effect, Option, Ref } from "effect";
import { ServerAgentRunner } from "../../packages/server/src/agent-runner";
import { NotePositions, stampPosition } from "../../packages/server/src/note-positions";
import { Proposals } from "../../packages/server/src/proposals";
import { FloorDatabase } from "../../packages/server/src/store";
import { chainCall, tokenAbi } from "./_fixtures/anvil";
import { FinancialChain } from "./_fixtures/financial-chain";
import { financialResearch } from "./_fixtures/financial-floor";
import { ResearchTrace } from "./_fixtures/recorded-research";
import { SignerTrace } from "./_fixtures/scoped-signer-edge";

it.layer(financialResearch)("trade with a receipt", test => {
  test.effect(
    "runs research, persisted evidence, policy, reservation and a mined scoped-account transaction",
    () =>
      Effect.gen(function*() {
        const node = yield* FinancialChain;
        const db = yield* FloorDatabase;
        const runner = yield* ServerAgentRunner;
        const signing = yield* Signing;
        const trace = yield* SignerTrace;
        const research = yield* ResearchTrace;
        const positions = yield* NotePositions;
        yield* db.owners.insert(node.ownerIdentity);
        yield* db.agents.insert(node.agent);
        const request = { marketId: `sepolia:${node.token}`, tokenAddress: node.token, chainId: 84532 };
        const beforeHolding = yield* Effect.fromOption(
          Option.fromUndefinedOr((yield* positions.read(node.agent, [request])).get(request.marketId)),
        );
        assert.strictEqual(beforeHolding.status, "verified");
        if (beforeHolding.status !== "verified") return;
        assert.strictEqual(beforeHolding.evidence.balanceBaseUnits, "0");
        const snapshot = yield* (yield* Markets).fetchSnapshot();
        assert.include(yield* runner.run(node.agent, snapshot, Option.none()), "Research completed");
        const proposal = yield* Effect.fromOption(Array.head(yield* db.proposals.listByAgent(node.agent.id)));
        const receipt = (yield* db.receipts.findByProposal(proposal.id).pipe(Effect.flatMap(Effect.fromOption))).data;
        assert.strictEqual(receipt.status, "confirmed");
        if (receipt.status !== "confirmed") return;
        const proof = yield* chainCall(
          "The receipt hash did not identify a mined transaction",
          () => node.chain.getTransactionReceipt({ hash: receipt.transactionHash }),
        );
        assert.strictEqual(Number(proof.blockNumber), receipt.blockNumber);
        assert.strictEqual(
          receipt.chainId,
          yield* chainCall("The transaction chain identity was unavailable", () => node.chain.getChainId()),
        );
        assert.strictEqual(proof.status, "success");
        const savedResearch = yield* db.notes.list();
        assert.isTrue(
          savedResearch.every(note => note.visibility === "private" && note.position.disclosure === "undisclosed"),
        );
        assert.isTrue(savedResearch.every(note =>
          note.publicationReason?.includes("8453 does not match the linked account chain 84532") === true
        ));
        assert.isEmpty(yield* db.notes.listPublic());
        const holding = yield* Effect.fromOption(
          Option.fromUndefinedOr((yield* positions.read(node.agent, [request])).get(request.marketId)),
        );
        assert.strictEqual(holding.status, "verified");
        if (holding.status !== "verified") {
          return;
        }
        assert.isTrue(BigInt(holding.evidence.balanceBaseUnits) > 0n);
        assert.strictEqual(holding.evidence.chainId, 84532);
        assert.strictEqual(holding.evidence.account, node.address);
        assert.strictEqual(holding.evidence.tokenAddress, node.token);
        assert.isAtLeast(holding.evidence.blockNumber, receipt.blockNumber);
        assert.isAbove(holding.evidence.blockNumber, beforeHolding.evidence.blockNumber);
        const observedBlock = yield* chainCall("Holdings source block missing", () =>
          node.chain.getBlock({ blockNumber: BigInt(holding.evidence.blockNumber) }));
        assert.strictEqual(holding.evidence.blockHash, observedBlock.hash);
        const holdingNote = stampPosition(
          researchNote({
            id: "current-sepolia-holding",
            agentId: node.agent.id,
            marketId: request.marketId,
            claim: "The scoped account has an independently observed token holding on Base Sepolia.",
            sources: [{
              id: "sepolia-holding-source",
              kind: "chain",
              label: "Base Sepolia holdings observation",
              url: holding.evidence.sourceUrl,
              blockNumber: holding.evidence.blockNumber,
            }],
            position: undisclosedPosition,
            status: "verified",
            visibility: "public",
            createdAt: holding.evidence.observedAt,
            blockNumber: holding.evidence.blockNumber,
            verification: "Balance read at one current block after the actual testnet transaction.",
          }),
          "public",
          Option.some(holding),
        );
        yield* db.notes.insert(holdingNote);
        assert.deepStrictEqual((yield* db.notes.findById(holdingNote.id)).positionEvidence, holding.evidence);
        assert.deepStrictEqual(
          (yield* db.notes.listPublic()).map(note =>
            note.id
          ),
          [holdingNote.id],
        );
        assert.isAbove(
          yield* chainCall("Token ownership unavailable", () =>
            node.chain.readContract({
              abi: tokenAbi,
              address: node.token,
              functionName: "balanceOf",
              args: [node.address],
            })).pipe(Effect.map(Number)),
          0,
        );
        const thesis = yield* db.theses.findById(receipt.thesisId);
        assert.strictEqual(thesis.agentId, node.agent.id);
        assert.isAbove(thesis.noteIds.length, 0);
        assert.isTrue(receipt.checks.every(check =>
          check.passed
        ));
        assert.strictEqual(receipt.policyVersion, node.agent.policy.version);
        const identity = publicAgent(node.agent);
        const layout = createLayout(snapshot.markets.map(atlasMarket), {
          lens: "flow",
          moorings: new Set(),
          explodedId: Option.none(),
          activeMarketId: Option.none(),
          slots: yield* db.marketSlots.list(),
          evidence: {
            agents: [identity],
            receipts: [publicReceipt(receipt)],
            notes: yield* db.notes.list(),
            observedAt: receipt.updatedAt,
            chainId: snapshot.chainId,
            blockNumber: snapshot.blockNumber,
          },
        });
        const figure = yield* Effect.fromOption(
          Array.findFirst(layout.agentPlacements, placement => placement.agent.id === identity.id),
        );
        assert.deepStrictEqual(figure.agent.emblem, identity.emblem);
        assert.isTrue(Option.contains(figure.marketId, proposal.marketId));
        assert.isFalse(layout.receiptStamps.some(mark => mark.receipt.id === receipt.id));
        assert.strictEqual(publicReceipt(receipt).transactionHash, proof.transactionHash);
        assert.strictEqual(publicReceipt(receipt).chainId, 84532);
        assert.strictEqual((yield* Ref.get(research.requests)).length, 2);
        assert.isTrue(yield* Ref.get(research.released));
        assert.strictEqual(yield* Ref.get(trace.dispatches), 1);
        yield* signing.dispatchApproved(receipt.id);
        assert.strictEqual(yield* Ref.get(trace.dispatches), 1);
        const invented = yield* (yield* Proposals).submit(node.ownerIdentity, {
          ...proposal,
          id: "invented-citations",
          sourceIds: ["never-observed"],
        });
        assert.strictEqual(invented.status, "refused");
        assert.isTrue(invented.checks.some(check => check.rule === "Linked thesis" && !check.passed));
        assert.strictEqual(yield* Ref.get(trace.dispatches), 1);
      }),
    60_000,
  );
});
