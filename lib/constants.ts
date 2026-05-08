import type { Address } from "viem";

export const SCHEDULER: Address = "0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B";
export const RITUAL_WALLET: Address = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
export const TEE_SERVICE_REGISTRY: Address = "0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F";

export const HTTP_CALL_CAPABILITY = 0;

export function portfolioAgentAddress(): Address | undefined {
  const a = process.env.NEXT_PUBLIC_PORTFOLIO_AGENT as Address | undefined;
  return a && a.startsWith("0x") && a.length === 42 ? a : undefined;
}
