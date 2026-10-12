import { parseAbi, parseAbiItem } from "viem";

// The published FPair uses virtual reserves for price and real balances for available inventory.
// https://github.com/Virtual-Protocol/protocol-contracts/tree/main/contracts/fun
export const virtualPairAbi = parseAbi([
  "function tokenA() view returns(address)",
  "function tokenB() view returns(address)",
  "function getReserves() view returns(uint256 tokenReserve,uint256 quoteReserve)",
  "function balance() view returns(uint256)",
  "function assetBalance() view returns(uint256)",
]);
export const virtualBondingAbi = parseAbi([
  "function gradThreshold() view returns(uint256)",
  "function tokenInfo(address) view returns(address creator,address token,address pair,address agentToken,(address token,string name,string _name,string ticker,uint256 supply,uint256 price,uint256 marketCap,uint256 liquidity,uint256 volume,uint256 volume24H,uint256 prevPrice,uint256 lastUpdated) data,string description,string image,string twitter,string telegram,string youtube,string website,bool trading,bool tradingOnUniswap)",
]);
export const virtualSwap = parseAbiItem(
  "event Swap(uint256 amount0In,uint256 amount0Out,uint256 amount1In,uint256 amount1Out)",
);
