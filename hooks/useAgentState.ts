"use client";

import { useAccount, useReadContract } from "wagmi";
import { portfolioAgentABI } from "@/lib/abi/portfolioAgentABI";
import { PORTFOLIO_AGENT } from "@/lib/constants";
import type { Address } from "viem";

export type AgentState = {
  registered: boolean;
  riskMode: number;
  ethBps: number;
  wbtcBps: number;
  usdcBps: number;
  executor: Address | undefined;
  httpExecutor: Address | undefined;
  scheduleId: bigint;
  tickIndex: bigint;
  lastCycleId: bigint;
  loading: boolean;
};

const DEFAULT: AgentState = {
  registered: false,
  riskMode: 1,
  ethBps: 0,
  wbtcBps: 0,
  usdcBps: 0,
  executor: undefined,
  httpExecutor: undefined,
  scheduleId: 0n,
  tickIndex: 0n,
  lastCycleId: 0n,
  loading: false,
};

export function useAgentState(): AgentState {
  const { address } = useAccount();

  const { data: portfolio, isLoading } = useReadContract({
    address: PORTFOLIO_AGENT,
    abi: portfolioAgentABI,
    functionName: "portfolios",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 30_000 },
  });

  const { data: tick } = useReadContract({
    address: PORTFOLIO_AGENT,
    abi: portfolioAgentABI,
    functionName: "tickIndex",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 30_000 },
  });

  const { data: lastCycle } = useReadContract({
    address: PORTFOLIO_AGENT,
    abi: portfolioAgentABI,
    functionName: "lastCycleId",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 30_000 },
  });

  if (!portfolio) return { ...DEFAULT, loading: isLoading };

  // portfolio is a tuple: [registered, riskMode, ethBps, wbtcBps, usdcBps, executor, scheduleId, httpExecutor]
  const p = portfolio as unknown as readonly [boolean, number, number, number, number, Address, bigint, Address];

  return {
    registered: p[0],
    riskMode: Number(p[1]),
    ethBps: Number(p[2]),
    wbtcBps: Number(p[3]),
    usdcBps: Number(p[4]),
    executor: p[5],
    scheduleId: p[6],
    httpExecutor: p[7],
    tickIndex: (tick as bigint | undefined) ?? 0n,
    lastCycleId: (lastCycle as bigint | undefined) ?? 0n,
    loading: isLoading,
  };
}
