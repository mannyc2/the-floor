import { Schema } from "effect";

// Wallet response validation needs EVM's encodings without loading transaction
// construction or the launchpad SDK into the wallet authority's module graph.
export const Address = Schema.String.check(Schema.isPattern(/^0x[0-9a-fA-F]{40}$/));
export const Signature = Schema.String.check(Schema.isPattern(/^0x[0-9a-fA-F]{130}$/));
