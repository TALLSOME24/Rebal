import type { Address } from "viem";

export const PORTFOLIO_AGENT: Address = "0x92Daf1F6455FbA78452B60FCc7399331589c430c";
export const FACTORY_ADDRESS: Address  = "0x3a7a972e17794e9d8ff4eb2be427189efbd7e3c8";

export const DEX_FACTORY: Address = "0xD2D774e8ca44Eb3449d9028d89d4861cE56a867c";
export const DEX_ROUTER:  Address = "0xB44b8646281886Bc3F63280C1287CF1349A936b9";

export const DEX_PAIRS = {
  "WETH/USDC": "0xc91eBa9767Db596e7641Ca366353D3C2B5a0C560" as Address,
  "WETH/USDT": "0x834f220d1cAecF51877F06Ccb6DC486FedAaFa12" as Address,
  "WETH/WBTC": "0xcEf6eFBCb29348565AF49faF9E76f434138Ae3A2" as Address,
} as const;
export const SCHEDULER: Address = "0x56e776BAE2DD60664b69Bd5F865F1180fFB7D58B";
export const RITUAL_WALLET: Address = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
export const TEE_SERVICE_REGISTRY: Address = "0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F";
export const HTTP_PRECOMPILE: Address = "0x0000000000000000000000000000000000000801";
export const LLM_PRECOMPILE: Address = "0x0000000000000000000000000000000000000802";

export const CHAIN_ID = 1979;

export const WETH: Address = "0xF42c8B335EE1ee9eD84109C68C238E50E0EE27EC";
export const WBTC: Address = "0x9Ca60C0d83EAD718D43C5f2134013e2bA4Ce3ec7";
export const USDC: Address = "0x031CbE4EbC5aF2ca432Ae3df4DbD65053F1A6584";
export const USDT: Address = "0xEa9E6a94E83E4B46eA7Dff6802D269F9a4e21E02";

export const TOKEN_DECIMALS = {
  WETH: 18,
  WBTC: 8,
  USDC: 6,
  USDT: 6,
} as const;

export const HTTP_CALL_CAPABILITY = 0;
export const LLM_CAPABILITY = 1;

export const MOCK_TOKENS = {
  WETH,
  WBTC,
  USDC,
  USDT,
} as const;

export const MOCK_PRICE_FEED: Address = "0x7e2c33923f895215A07a706E1D4E99fE64386985";

export function portfolioAgentAddress(): Address | undefined {
  const a = (process.env.NEXT_PUBLIC_PORTFOLIO_AGENT ?? PORTFOLIO_AGENT) as Address;
  return a && a.startsWith("0x") && a.length === 42 ? a : undefined;
}
