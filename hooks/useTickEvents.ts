"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { hexToString, type Address, type Hex } from "viem";
import { portfolioAgentABI } from "@/lib/abi/portfolioAgentABI";

export type TickEvent = {
  type: "decision" | "failed";
  headline: string;
  reason: string;
  confidence: number;
  blockNumber: bigint;
  protocol: string;
  txHash: Hex;
  cycleId?: bigint;
  tickIdx?: bigint;
  llmHasError?: boolean;
  phase?: string;
};

function parseCompletionPayload(payload: Hex | undefined): { headline: string; reason: string; confidence: number } {
  if (!payload || payload === "0x") {
    return { headline: "Awaiting LLM response", reason: "", confidence: 0 };
  }
  try {
    const text = hexToString(payload);
    const json = JSON.parse(text) as {
      rationale?: string;
      suggested_moves?: Array<{ asset: string; drift_bps?: number; note?: string }>;
    };
    const moves = json.suggested_moves ?? [];
    const headline =
      moves.length === 0
        ? "Hold — portfolio in range"
        : `Adjust: ${moves.map((m) => `${m.asset} ${m.drift_bps && m.drift_bps > 0 ? "+" : ""}${m.drift_bps ?? 0}bps`).join(", ")}`;
    const reason = json.rationale?.slice(0, 200) ?? "";
    const confidence = moves.length > 0 ? Math.min(95, 60 + moves.length * 5) : 40;
    return { headline, reason, confidence };
  } catch {
    const text = hexToString(payload).slice(0, 200);
    return { headline: "LLM response received", reason: text, confidence: 50 };
  }
}

export function useTickEvents(agentAddress: Address | undefined): { events: TickEvent[]; refresh: () => void; loading: boolean } {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [events, setEvents] = useState<TickEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!publicClient || !address || !agentAddress) return;
    setLoading(true);
    try {
      const latest = await publicClient.getBlockNumber();
      const from = latest > 10000n ? latest - 10000n : 0n;

      const [decisions, failures] = await Promise.all([
        publicClient.getContractEvents({
          address: agentAddress,
          abi: portfolioAgentABI,
          eventName: "RebalanceDecision",
          args: { owner: address as Address },
          fromBlock: from,
          toBlock: latest,
        }),
        publicClient.getContractEvents({
          address: agentAddress,
          abi: portfolioAgentABI,
          eventName: "TickFailed",
          args: { owner: address as Address },
          fromBlock: from,
          toBlock: latest,
        }),
      ]);

      const parsed: TickEvent[] = [
        ...decisions.map((d) => {
          const args = d.args as {
            cycleId: bigint;
            tickIdx: bigint;
            llmHasError: boolean;
            completionPayload: Hex;
            errorMessage: string;
          };
          const { headline, reason, confidence } = parseCompletionPayload(args.completionPayload);
          return {
            type: "decision" as const,
            headline: args.llmHasError ? `LLM Error: ${args.errorMessage || "unknown"}` : headline,
            reason: args.llmHasError ? args.errorMessage : reason,
            confidence: args.llmHasError ? 0 : confidence,
            blockNumber: d.blockNumber ?? 0n,
            protocol: "GLM-4.7-FP8",
            txHash: d.transactionHash as Hex,
            cycleId: args.cycleId,
            tickIdx: args.tickIdx,
            llmHasError: args.llmHasError,
          };
        }),
        ...failures.map((f) => {
          const args = f.args as { tickIdx: bigint; phase: string; reason: string };
          return {
            type: "failed" as const,
            headline: `${args.phase} tick failed`,
            reason: args.reason,
            confidence: 0,
            blockNumber: f.blockNumber ?? 0n,
            protocol: args.phase,
            txHash: f.transactionHash as Hex,
            tickIdx: args.tickIdx,
            phase: args.phase,
          };
        }),
      ].sort((a, b) => Number(b.blockNumber - a.blockNumber));

      setEvents(parsed.slice(0, 20));
    } catch {
      // keep previous results on transient error
    } finally {
      setLoading(false);
    }
  }, [address, agentAddress, publicClient]);

  useEffect(() => {
    void fetch();
    const id = setInterval(() => void fetch(), 20_000);
    return () => clearInterval(id);
  }, [fetch]);

  return { events, refresh: fetch, loading };
}
