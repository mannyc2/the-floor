// Generated from the pinned IDL and Codama binary codecs; regenerate, do not hand-edit.
import { AccountRole, address, fixEncoderSize, getBytesEncoder, getStructEncoder, transformEncoder } from "@solana/kit";
import type { Address, Instruction } from "@solana/kit";
import { getConfigParametersEncoder, getInitializePoolParametersEncoder } from "./bounded-generated";
import type { ConfigParametersArgs, InitializePoolParametersArgs } from "./bounded-generated";
export const programAddress = address("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");

export interface CreateConfigAccounts {
  readonly config: Address;
  readonly feeClaimer: Address;
  readonly leftoverReceiver: Address;
  readonly quoteMint: Address;
  readonly payer: Address;
  readonly eventAuthority: Address;
}
const createConfigData = transformEncoder(
  getStructEncoder([
    ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
    ["configParameters", getConfigParametersEncoder()],
  ]),
  (value: { readonly configParameters: ConfigParametersArgs }) => ({
    ...value,
    discriminator: new Uint8Array([201, 207, 243, 114, 75, 111, 47, 189]),
  }),
);
export function getCreateConfigInstruction(
  accounts: CreateConfigAccounts,
  configParameters: ConfigParametersArgs,
): Instruction {
  return {
    programAddress,
    accounts: [
      { address: accounts.config, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.feeClaimer, role: AccountRole.READONLY },
      { address: accounts.leftoverReceiver, role: AccountRole.READONLY },
      { address: accounts.quoteMint, role: AccountRole.READONLY },
      { address: accounts.payer, role: AccountRole.WRITABLE_SIGNER },
      { address: address("11111111111111111111111111111111"), role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: programAddress, role: AccountRole.READONLY },
    ],
    data: createConfigData.encode({ configParameters }),
  };
}

export interface InitializeVirtualPoolWithSplTokenAccounts {
  readonly config: Address;
  readonly creator: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly pool: Address;
  readonly baseVault: Address;
  readonly quoteVault: Address;
  readonly mintMetadata: Address;
  readonly payer: Address;
  readonly tokenQuoteProgram: Address;
  readonly eventAuthority: Address;
}
const initializeVirtualPoolWithSplTokenData = transformEncoder(
  getStructEncoder([
    ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
    ["params", getInitializePoolParametersEncoder()],
  ]),
  (value: { readonly params: InitializePoolParametersArgs }) => ({
    ...value,
    discriminator: new Uint8Array([140, 85, 215, 176, 102, 54, 104, 79]),
  }),
);
export function getInitializeVirtualPoolWithSplTokenInstruction(
  accounts: InitializeVirtualPoolWithSplTokenAccounts,
  params: InitializePoolParametersArgs,
): Instruction {
  return {
    programAddress,
    accounts: [
      { address: accounts.config, role: AccountRole.READONLY },
      { address: address("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM"), role: AccountRole.READONLY },
      { address: accounts.creator, role: AccountRole.READONLY_SIGNER },
      { address: accounts.baseMint, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.quoteMint, role: AccountRole.READONLY },
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.baseVault, role: AccountRole.WRITABLE },
      { address: accounts.quoteVault, role: AccountRole.WRITABLE },
      { address: accounts.mintMetadata, role: AccountRole.WRITABLE },
      { address: address("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"), role: AccountRole.READONLY },
      { address: accounts.payer, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.tokenQuoteProgram, role: AccountRole.READONLY },
      { address: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), role: AccountRole.READONLY },
      { address: address("11111111111111111111111111111111"), role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: programAddress, role: AccountRole.READONLY },
    ],
    data: initializeVirtualPoolWithSplTokenData.encode({ params }),
  };
}
