// Account order, roles, fixed addresses and discriminators follow the pinned IDL;
// instructions.test.ts checks each of them against it.
import { AccountRole, address, fixEncoderSize, getBytesEncoder, getStructEncoder, transformEncoder } from "@solana/kit";
import type { Address, Instruction } from "@solana/kit";
import { getConfigParametersEncoder } from "./_generated/configParameters";
import type { ConfigParametersArgs } from "./_generated/configParameters";
import { getInitializePoolParametersEncoder } from "./_generated/initializePoolParameters";
import type { InitializePoolParametersArgs } from "./_generated/initializePoolParameters";
import { getSwapParametersEncoder } from "./_generated/swapParameters";
import type { SwapParametersArgs } from "./_generated/swapParameters";
import { tokenProgram } from "./programs";
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

export interface SwapAccounts {
  readonly payer: Address;
  readonly config: Address;
  readonly pool: Address;
  readonly inputTokenAccount: Address;
  readonly outputTokenAccount: Address;
  readonly baseVault: Address;
  readonly quoteVault: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly eventAuthority: Address;
}
const swapData = transformEncoder(
  getStructEncoder([
    ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
    ["params", getSwapParametersEncoder()],
  ]),
  (value: { readonly params: SwapParametersArgs }) => ({
    ...value,
    discriminator: new Uint8Array([248, 198, 158, 145, 225, 117, 135, 200]),
  }),
);
export function getSwapInstruction(accounts: SwapAccounts, params: SwapParametersArgs): Instruction {
  return {
    programAddress,
    accounts: [
      { address: address("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM"), role: AccountRole.READONLY },
      { address: accounts.config, role: AccountRole.READONLY },
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.inputTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.outputTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.baseVault, role: AccountRole.WRITABLE },
      { address: accounts.quoteVault, role: AccountRole.WRITABLE },
      { address: accounts.baseMint, role: AccountRole.READONLY },
      { address: accounts.quoteMint, role: AccountRole.READONLY },
      { address: accounts.payer, role: AccountRole.READONLY_SIGNER },
      { address: address(tokenProgram), role: AccountRole.READONLY },
      { address: address(tokenProgram), role: AccountRole.READONLY },
      // Anchor represents an absent optional account by the invoked program, readonly.
      { address: programAddress, role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: programAddress, role: AccountRole.READONLY },
    ],
    data: swapData.encode({ params }),
  };
}
