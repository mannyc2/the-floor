import type { PoolConfig } from "./types";

// Discovery selects addresses only. All rendered numbers and token metadata are read at one explicit Base block.
export const BASE_POOLS: readonly PoolConfig[] = [
  {
    address: "0xd0b53D9277642d899DF5C87A3966A349A798F224",
    kind: "concentrated-liquidity",
    venue: "Uniswap V3",
    districtId: "blue-chip",
  },
  {
    address: "0xf79478d5a6baE4546F7e489e80b2fC690B558944",
    kind: "concentrated-liquidity",
    venue: "Uniswap V3",
    districtId: "culture",
  },
  {
    address: "0x0FB597D6cFE5bE0d5258A7f017599C2A4Ece34c7",
    kind: "concentrated-liquidity",
    venue: "Uniswap V3",
    districtId: "culture",
  },
  {
    address: "0x00278697f1264852eF465b6CAC9183639db22AA7",
    kind: "concentrated-liquidity",
    venue: "Uniswap V3",
    districtId: "blue-chip",
  },
  {
    address: "0xE207FAb5839CA5bCc0d930761755cC7d82C1f19c",
    kind: "concentrated-liquidity",
    venue: "Uniswap V3",
    districtId: "onchain",
  },
  {
    address: "0x8C6bCAd6ce067304d505B5d5b36f19C64A933076",
    kind: "concentrated-liquidity",
    venue: "Uniswap V3",
    districtId: "culture",
  },
  {
    address: "0x16905890A1D02b6F824387419319Bf4188B961b0",
    kind: "constant-product",
    venue: "Uniswap V2",
    districtId: "culture",
  },
  {
    address: "0x870F9783501f79f66eecb19fa97F4BABf630b2A3",
    kind: "constant-product",
    venue: "Uniswap V2",
    districtId: "onchain",
  },
  {
    address: "0x39a72B1292AAED73B9B5633e14f88fE9a89F400b",
    kind: "constant-product",
    venue: "Uniswap V2",
    districtId: "onchain",
  },
  {
    address: "0x7b4bB1742B6F77f922e43f009139D52cB4F90FdD",
    kind: "constant-product",
    venue: "Uniswap V2",
    districtId: "culture",
  },
  {
    address: "0x20000FbfeDFD172821821C9c59284129B04ffB2e",
    kind: "constant-product",
    venue: "Aerodrome",
    districtId: "aerodrome",
    stableCheck: true,
  },
  {
    address: "0x8f5F1D63599362115e7F9fe71BFD5ab883D82c82",
    kind: "constant-product",
    venue: "Aerodrome",
    districtId: "aerodrome",
    stableCheck: true,
  },
  {
    address: "0x529d2863a1521d0b57db028168fdE2E97120017C",
    kind: "concentrated-liquidity",
    venue: "Uniswap V3",
    districtId: "onchain",
  },
  {
    address: "0x61C4823734285CCe741EF5caBb79B494Cf373516",
    kind: "bonding-curve",
    venue: "Virtuals",
    districtId: "onchain",
    bonding: "0xf66dea7b3e897cd44a5a231c61b6b4423d613259",
    token: "0x6325B576F9079c2F7071CE89c810064EeED856cE",
  },
];
