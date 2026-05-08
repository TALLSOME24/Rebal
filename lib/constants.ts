import type { Address } from "viem";

export const SCHEDULER: Address = "0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B";
export const RITUAL_WALLET: Address = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
export const TEE_SERVICE_REGISTRY: Address = "0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F";

export const HTTP_CALL_CAPABILITY = 0;

export const MOCK_TOKENS = {
  WETH: (process.env.NEXT_PUBLIC_MOCK_WETH ?? "0xF42c8B335EE1ee9eD84109C68C238E50E0EE27EC") as Address,
  WBTC: (process.env.NEXT_PUBLIC_MOCK_WBTC ?? "0x9Ca60C0d83EAD718D43C5f2134013e2bA4Ce3ec7") as Address,
  USDC: (process.env.NEXT_PUBLIC_MOCK_USDC ?? "0x031CbE4EbC5aF2ca432Ae3df4DbD65053F1A6584") as Address,
  USDT: (process.env.NEXT_PUBLIC_MOCK_USDT ?? "0xEa9E6a94E83E4B46eA7Dff6802D269F9a4e21E02") as Address,
} as const;

export const MOCK_PRICE_FEED: Address = (process.env.NEXT_PUBLIC_MOCK_PRICE_FEED ??
  "0x7e2c33923f895215A07a706E1D4E99fE64386985") as Address;

export function portfolioAgentAddress(): Address | undefined {
  const a = process.env.NEXT_PUBLIC_PORTFOLIO_AGENT as Address | undefined;
  return a && a.startsWith("0x") && a.length === 42 ? a : undefined;
}
