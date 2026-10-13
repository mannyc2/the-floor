import { Option, Schema } from "effect";

export const Id = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/));
const Label = Schema.NonEmptyString.check(Schema.isMaxLength(50));
export const Message = Schema.NonEmptyString.check(Schema.isMaxLength(1024));
export const Base64Value = Schema.NonEmptyString.check(
  Schema.isPattern(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
);
export const Signature = Base64Value;
const SolanaAddress = Schema.String.check(Schema.isPattern(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/));
const EthereumAddress = Schema.String.check(Schema.isPattern(/^0x[0-9a-fA-F]{40}$/));
const Amount = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]*)$/));
const Chain = Schema.Literals(["ethereum", "solana"]);
const SystemProgram = "11111111111111111111111111111111";
const TokenProgram = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const Token2022Program = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export const QuorumInput = Schema.Struct({
  display_name: Label,
  public_keys: Schema.NonEmptyArray(Signature),
  user_ids: Schema.Array(Schema.NonEmptyString),
  authorization_threshold: Schema.Int.check(Schema.isGreaterThan(0)),
}).check(
  Schema.makeFilter(input =>
    input.authorization_threshold <= new Set([...input.public_keys, ...input.user_ids]).size
    && new Set(input.public_keys).size === input.public_keys.length
    && new Set(input.user_ids).size === input.user_ids.length
  ),
);
export const WalletInput = Schema.Struct({
  chain_type: Chain,
  owner_id: Id,
  policy_ids: Schema.NonEmptyArray(Id),
});
const EthereumRule = Schema.Struct({
  name: Label,
  method: Schema.Literal("personal_sign"),
  action: Schema.Literals(["ALLOW", "DENY"]),
  conditions: Schema.Tuple([Schema.Struct({
    field_source: Schema.Literal("message"),
    field: Schema.Literal("content"),
    operator: Schema.Literal("eq"),
    value: Message,
  })]),
});
const ProgramRule = Schema.Struct({
  name: Label,
  method: Schema.Literal("signTransaction"),
  action: Schema.Literal("ALLOW"),
  conditions: Schema.Tuple([Schema.Struct({
    field_source: Schema.Literal("solana_program_instruction"),
    field: Schema.Literal("programId"),
    operator: Schema.Literal("in"),
    // A broad ALLOW for these programs overrides the transfer limits below.
    value: Schema.NonEmptyArray(
      SolanaAddress.check(
        Schema.makeFilter(address => ![SystemProgram, TokenProgram, Token2022Program].includes(address)),
      ),
    ),
  })]),
});
// Privy evaluates Solana instructions individually. These are deliberately
// named per-instruction limits: multiple transfers are not an aggregate cap.
export const SolanaTransferInstructionRule = Schema.Struct({
  name: Label,
  method: Schema.Literal("signTransaction"),
  action: Schema.Literal("ALLOW"),
  conditions: Schema.Tuple([
    Schema.Struct({
      field_source: Schema.Literal("solana_program_instruction"),
      field: Schema.Literal("programId"),
      operator: Schema.Literal("eq"),
      value: Schema.Literal(SystemProgram),
    }),
    Schema.Struct({
      field_source: Schema.Literal("solana_system_program_instruction"),
      field: Schema.Literal("Transfer.lamports"),
      operator: Schema.Literal("lte"),
      value: Amount,
    }),
    Schema.Struct({
      field_source: Schema.Literal("solana_system_program_instruction"),
      field: Schema.Literal("Transfer.to"),
      operator: Schema.Literal("in"),
      value: Schema.NonEmptyArray(SolanaAddress),
    }),
  ]),
});
export const SolanaTokenTransferInstructionRule = Schema.Struct({
  name: Label,
  method: Schema.Literal("signTransaction"),
  action: Schema.Literal("ALLOW"),
  conditions: Schema.Tuple([
    Schema.Struct({
      field_source: Schema.Literal("solana_program_instruction"),
      field: Schema.Literal("programId"),
      operator: Schema.Literal("in"),
      value: Schema.NonEmptyArray(Schema.Literals([TokenProgram, Token2022Program])),
    }),
    Schema.Struct({
      field_source: Schema.Literal("solana_token_program_instruction"),
      field: Schema.Literal("TransferChecked.mint"),
      operator: Schema.Literal("eq"),
      value: SolanaAddress,
    }),
    Schema.Struct({
      field_source: Schema.Literal("solana_token_program_instruction"),
      field: Schema.Literal("TransferChecked.amount"),
      operator: Schema.Literal("lte"),
      value: Amount,
    }),
    Schema.Struct({
      field_source: Schema.Literal("solana_token_program_instruction"),
      field: Schema.Literal("TransferChecked.destination"),
      operator: Schema.Literal("in"),
      value: Schema.NonEmptyArray(SolanaAddress),
    }),
  ]),
});
export const SolanaPolicyRule = Schema.Union([
  ProgramRule,
  SolanaTransferInstructionRule,
  SolanaTokenTransferInstructionRule,
]);
const EthereumPolicyInput = Schema.Struct({
  version: Schema.Literal("1.0"),
  name: Label,
  chain_type: Schema.Literal("ethereum"),
  owner_id: Id,
  rules: Schema.Tuple([EthereumRule]),
});
export const SolanaPolicyInput = Schema.Struct({
  version: Schema.Literal("1.0"),
  name: Label,
  chain_type: Schema.Literal("solana"),
  owner_id: Id,
  rules: Schema.NonEmptyArray(SolanaPolicyRule),
});
export const PolicyInput = Schema.Union([EthereumPolicyInput, SolanaPolicyInput]);
export const WalletUpdateInput = Schema.Struct({
  owner_id: Schema.optionalKey(Id),
  policy_ids: Schema.optionalKey(Schema.NonEmptyArray(Id)),
}).check(
  Schema.makeFilter(input =>
    Option.isSome(Option.fromUndefinedOr(input.owner_id)) || Option.isSome(Option.fromUndefinedOr(input.policy_ids))
  ),
);
export const PolicyUpdateInput = Schema.Struct({
  name: Schema.optionalKey(Label),
  owner_id: Schema.optionalKey(Id),
  rules: Schema.optionalKey(Schema.Union([
    Schema.Tuple([EthereumRule]),
    Schema.NonEmptyArray(SolanaPolicyRule),
  ])),
}).check(
  Schema.makeFilter(input =>
    Option.isSome(Option.fromUndefinedOr(input.name)) || Option.isSome(Option.fromUndefinedOr(input.owner_id))
    || Option.isSome(Option.fromUndefinedOr(input.rules))
  ),
);
export const Created = Schema.Struct({ id: Id });
const WalletFields = { id: Id, owner_id: Id };
export const CreatedWallet = Schema.Union([
  Schema.Struct({ ...WalletFields, chain_type: Schema.Literal("ethereum"), address: EthereumAddress }),
  Schema.Struct({ ...WalletFields, chain_type: Schema.Literal("solana"), address: SolanaAddress }),
]);
const ReadWalletFields = { id: Id, owner_id: Schema.OptionFromNullOr(Id), policy_ids: Schema.Array(Id) };
export const Wallet = Schema.Union([
  Schema.Struct({ ...ReadWalletFields, chain_type: Schema.Literal("ethereum"), address: EthereumAddress }),
  Schema.Struct({ ...ReadWalletFields, chain_type: Schema.Literal("solana"), address: SolanaAddress }),
]);
export const Policy = Schema.Union([
  Schema.Struct({
    id: Id,
    version: Schema.Literal("1.0"),
    name: Label,
    chain_type: Schema.Literal("ethereum"),
    owner_id: Schema.OptionFromNullOr(Id),
    rules: Schema.Array(EthereumRule.mapFields(fields => ({ id: Id, ...fields }))),
  }),
  Schema.Struct({
    id: Id,
    version: Schema.Literal("1.0"),
    name: Label,
    chain_type: Schema.Literal("solana"),
    owner_id: Schema.OptionFromNullOr(Id),
    rules: Schema.Array(Schema.Union([
      ProgramRule.mapFields(fields => ({ id: Id, ...fields })),
      SolanaTransferInstructionRule.mapFields(fields => ({ id: Id, ...fields })),
      SolanaTokenTransferInstructionRule.mapFields(fields => ({ id: Id, ...fields })),
    ])),
  }),
]);
export const SignedMessage = Schema.Struct({
  method: Schema.Literal("personal_sign"),
  data: Schema.Struct({
    signature: Schema.String.check(Schema.isPattern(/^0x[0-9a-fA-F]{130}$/)),
    encoding: Schema.Literal("hex"),
  }),
});
export const SignedTransaction = Schema.Struct({
  method: Schema.Literal("signTransaction"),
  data: Schema.Struct({ signed_transaction: Base64Value, encoding: Schema.Literal("base64") }),
});
export const SignMessageInput = Schema.Struct({ walletId: Id, message: Message });
export const SignTransactionInput = Schema.Struct({ walletId: Id, transaction: Base64Value });
