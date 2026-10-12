import { WalletProof } from "@floor/surfaces";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { Hex } from "effect/encoding";
import { FrontendError } from "./errors";
interface EthereumProvider {
  // oxlint-disable-next-line effect/noUnknownReturns -- EIP-1193 returns untrusted provider data, decoded immediately by Schema below.
  readonly request: (request: { readonly method: string; readonly params?: readonly string[] }) => Promise<unknown>;
}
declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}
export class OwnerWallet extends Context.Service<
  OwnerWallet,
  {
    readonly signChallenge: (nonce: string, message: string) => Effect.Effect<typeof WalletProof.Type, FrontendError>;
  }
>()("@floor/frontend/OwnerWallet") {
  static readonly browser = Layer.succeed(
    OwnerWallet,
    OwnerWallet.of({
      signChallenge: Effect.fn("OwnerWallet.signChallenge")(function*(nonce: string, message: string) {
        const maybeProvider = Option.fromUndefinedOr(window.ethereum);
        if (Option.isNone(maybeProvider)) {
          return yield* new FrontendError({
            message: "Open The Floor in a browser with an Ethereum wallet to connect your owner address.",
          });
        }
        const provider = maybeProvider.value;
        const accounts = yield* Effect.tryPromise({
          try: () => provider.request({ method: "eth_requestAccounts" }),
          catch: () => new FrontendError({ message: "The wallet did not share an account." }),
        }).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.NonEmptyArray(WalletProof.fields.address))),
          Effect.mapError(() => new FrontendError({ message: "The wallet returned no valid owner address." })),
        );
        const address = accounts[0];
        const signature = yield* Effect.tryPromise({
          try: () => provider.request({ method: "personal_sign", params: [`0x${Hex.encode(message)}`, address] }),
          catch: () => new FrontendError({ message: "The wallet signature was declined." }),
        }).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(WalletProof.fields.signature)),
          Effect.mapError(() => new FrontendError({ message: "The wallet did not return a valid signature." })),
        );
        return { address, signature, nonce };
      }),
    }),
  );
}
