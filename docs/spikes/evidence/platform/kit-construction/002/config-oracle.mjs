import {
  ActivationType,
  BaseFeeMode,
  buildCurve,
  CollectFeeMode,
  DynamicBondingCurveClient,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

import BN from "bn.js";
const fixture = buildCurve({
              token: {
                tokenType: TokenType.SPLToken,
                tokenBaseDecimal: TokenDecimal.SIX,
                tokenQuoteDecimal: TokenDecimal.NINE,
                tokenAuthorityOption: TokenAuthorityOption.Immutable,
                totalTokenSupply: 1_000_000_000,
                leftover: 0,
              },
              fee: {
                baseFeeParams: {
                  baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
                  feeSchedulerParam: {
                    startingFeeBps: 100,
                    endingFeeBps: 100,
                    numberOfPeriod: 0,
                    totalDuration: 0,
                  },
                },
                dynamicFeeEnabled: false,
                collectFeeMode: CollectFeeMode.QuoteToken,
                creatorTradingFeePercentage: 50,
                poolCreationFee: 0,
                enableFirstSwapWithMinFee: false,
              },
              migration: {
                migrationOption: MigrationOption.MET_DAMM_V2,
                migrationFeeOption: MigrationFeeOption.FixedBps200,
                migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
              },
              liquidityDistribution: {
                partnerPermanentLockedLiquidityPercentage: 5,
                partnerLiquidityPercentage: 50,
                creatorPermanentLockedLiquidityPercentage: 5,
                creatorLiquidityPercentage: 40,
              },
              lockedVesting: {
                totalLockedVestingAmount: 0,
                numberOfVestingPeriod: 0,
                cliffUnlockAmount: 0,
                totalVestingDuration: 0,
                cliffDurationFromMigrationTime: 0,
              },
              activationType: ActivationType.Timestamp,
              percentageSupplyOnMigration: 20,
              migrationQuoteThreshold: 10,
            });
function encode(value) {
  if (BN.isBN(value)) return { bigint: value.toString(10) };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,encode(item)]));
  return value;
}
await Bun.write(new URL('./config-oracle.json',import.meta.url), JSON.stringify(encode(fixture),null,2)+'\n');
import { Connection, PublicKey } from '@solana/web3.js';
const connection = new Connection('https://synthetic.invalid', { fetch: (_url, options) => {
 const req=JSON.parse(options.body);
 if(req.method!=='getAccountInfo'||req.params[0]!=='So11111111111111111111111111111111111111112') throw new Error('Undeclared oracle RPC');
 return Promise.resolve(Response.json({jsonrpc:'2.0',id:req.id,result:{context:{slot:0},value:{data:['','base64'],executable:false,lamports:0,owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',rentEpoch:0}}}));
 }, httpAgent:false, disableRetryOnRateLimit:true });
const payer=new PublicKey(new Uint8Array(32).fill(1));
const transaction=await new DynamicBondingCurveClient(connection,'confirmed').partner.createConfigAndPool({
 ...fixture,payer,config:new PublicKey(new Uint8Array(32).fill(2)),feeClaimer:payer,leftoverReceiver:payer,quoteMint:new PublicKey('So11111111111111111111111111111111111111112'),
 preCreatePoolParam:{name:'Spike',symbol:'SPK',uri:'https://example.invalid/spike',poolCreator:payer,baseMint:new PublicKey(new Uint8Array(32).fill(3))}
});
transaction.feePayer=payer; transaction.recentBlockhash='11111111111111111111111111111111';
const serialized=transaction.serialize({requireAllSignatures:false,verifySignatures:false});
const result={instructions:transaction.instructions.map(ix=>({programAddress:ix.programId.toBase58(),accounts:ix.keys.map(k=>({address:k.pubkey.toBase58(),role:(k.isWritable?1:0)+(k.isSigner?2:0)})),dataHex:ix.data.toString('hex')})),byteLength:serialized.length,sha256:new Bun.CryptoHasher('sha256').update(serialized).digest('hex')};
await Bun.write(new URL('./instruction-oracle.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
