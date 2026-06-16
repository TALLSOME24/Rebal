"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { type Address, type Hex } from "viem";
import { portfolioAgentABI } from "@/lib/abi/portfolioAgentABI";

export type TickEvent = {
  type: "decision" | "triggered" | "failed";
  headline: string;
  reason: string;
  confidence: number;
  blockNumber: bigint;
  protocol: string;
  txHash: Hex;
  cycleId?: bigint;
  jobId?: Hex;
  hasError?: boolean;
  phase?: string;
};

const ZERO_JOB = "0x0000000000000000000000000000000000000000000000000000000000000000";

// Ritual chain caps eth_getLogs at 100k blocks — use 50k to stay well within the limit.
const LOOKBACK_BLOCKS = 50_000n;

function parseTextResponse(text: string): { headline: string; reason: string; confidence: number } {
  if (!text) return { headline: "No response", reason: "", confidence: 0 };
  try {
    const json = JSON.parse(text) as {
      action?: string;
      fromToken?: string;
      toToken?: string;
      amountBps?: number;
      reason?: string;
      confidence?: number;
    };
    if (json.action === "swap") {
      const headline = `Swap ${json.fromToken ?? "?"} → ${json.toToken ?? "?"} (${json.amountBps ?? 0} bps)`;
      return {
        headline,
        reason: json.reason?.slice(0, 200) ?? "",
        confidence: Math.round((json.confidence ?? 0.7) * 100),
      };
    }
    return {
      headline: "Hold — portfolio in range",
      reason: json.reason?.slice(0, 200) ?? "",
      confidence: Math.round((json.confidence ?? 0.5) * 100),
    };
  } catch {
    return {
      headline: "Agent response received",
      reason: text.slice(0, 200),
      confidence: 50,
    };
  }
}

export function useTickEvents(agentAddress: Address | undefined): { events: TickEvent[]; refresh: () => void; loading: boolean } {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [events, setEvents] = useState<TickEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!publicClient || !agentAddress) return;
    setLoading(true);
    try {
      const latest = await publicClient.getBlockNumber();
      const from = latest > LOOKBACK_BLOCKS ? latest - LOOKBACK_BLOCKS : 0n;
      const ownerFilter = address ? { owner: address as Address } : undefined;

      const [results, triggers, failures] = await Promise.all([
        publicClient.getContractEvents({
          address: agentAddress,
          abi: portfolioAgentABI,
          eventName: "SovereignAgentResult",
          args: ownerFilter,
          fromBlock: from,
          toBlock: latest,
        }),
        publicClient.getContractEvents({
          address: agentAddress,
          abi: portfolioAgentABI,
          eventName: "AutomationTriggered",
          args: ownerFilter,
          fromBlock: from,
          toBlock: latest,
        }),
        publicClient.getContractEvents({
          address: agentAddress,
          abi: portfolioAgentABI,
          eventName: "TickFailed",
          args: ownerFilter,
          fromBlock: from,
          toBlock: latest,
        }),
      ]);

      const parsed: TickEvent[] = [
        ...results.map((r) => {
          const args = r.args as {
            jobId: Hex;
            cycleId: bigint;
            hasError: boolean;
            textResponse: string;
            errorMessage: string;
          };
          if (args.hasError) {
            return {
              type: "decision" as const,
              headline: `Agent error: ${args.errorMessage || "unknown"}`,
              reason: args.errorMessage,
              confidence: 0,
              blockNumber: r.blockNumber ?? 0n,
              protocol: "ZeroClaw",
              txHash: r.transactionHash as Hex,
              cycleId: args.cycleId,
              jobId: args.jobId,
              hasError: true,
            };
          }
          const { headline, reason, confidence } = parseTextResponse(args.textResponse);
          return {
            type: "decision" as const,
            headline,
            reason,
            confidence,
            blockNumber: r.blockNumber ?? 0n,
            protocol: "ZeroClaw · GLM-4.7-FP8",
            txHash: r.transactionHash as Hex,
            cycleId: args.cycleId,
            jobId: args.jobId,
            hasError: false,
          };
        }),
        ...triggers.map((t) => {
          const args = t.args as { jobId: Hex };
          const shortJob = args.jobId !== ZERO_JOB
            ? `${args.jobId.slice(0, 10)}…`
            : "pending";
          return {
            type: "triggered" as const,
            headline: `Sovereign agent job submitted`,
            reason: `Job ID: ${shortJob}`,
            confidence: 0,
            blockNumber: t.blockNumber ?? 0n,
            protocol: "0x080C",
            txHash: t.transactionHash as Hex,
            jobId: args.jobId,
          };
        }),
        ...failures.map((f) => {
          const args = f.args as { tickIdx: bigint; phase: string; reason: string };
          return {
            type: "failed" as const,
            headline: `${args.phase} failed`,
            reason: args.reason,
            confidence: 0,
            blockNumber: f.blockNumber ?? 0n,
            protocol: args.phase,
            txHash: f.transactionHash as Hex,
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
