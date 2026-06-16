"use client";

import { useAccount, useReadContract } from "wagmi";
import { portfolioAgentABI } from "@/lib/abi/portfolioAgentABI";
import type { Address, Hex } from "viem";

export type AgentState = {
  registered: boolean;
  riskMode: number;
  ethBps: number;
  wbtcBps: number;
  usdcBps: number;
  executor: Address | undefined;
  scheduleId: bigint;
  pendingJobId: Hex;
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
  scheduleId: 0n,
  pendingJobId: "0x0000000000000000000000000000000000000000000000000000000000000000",
  lastCycleId: 0n,
  loading: false,
};

export function useAgentState(agentAddress: Address | undefined): AgentState {
  const { address } = useAccount();

  const { data: portfolio, isLoading } = useReadContract({
    address: agentAddress,
    abi: portfolioAgentABI,
    functionName: "portfolios",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!agentAddress, refetchInterval: 30_000 },
  });

  const { data: pendingJob } = useReadContract({
    address: agentAddress,
    abi: portfolioAgentABI,
    functionName: "pendingJobId",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!agentAddress, refetchInterval: 15_000 },
  });

  const { data: lastCycle } = useReadContract({
    address: agentAddress,
    abi: portfolioAgentABI,
    functionName: "lastCycleId",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!agentAddress, refetchInterval: 30_000 },
  });

  if (!portfolio) return { ...DEFAULT, loading: isLoading };

  const p = portfolio as unknown as readonly [boolean, number, number, number, number, Address, bigint];

  return {
    registered: p[0],
    riskMode: Number(p[1]),
    ethBps: Number(p[2]),
    wbtcBps: Number(p[3]),
    usdcBps: Number(p[4]),
    executor: p[5],
    scheduleId: p[6],
    pendingJobId: (pendingJob as Hex | undefined) ?? DEFAULT.pendingJobId,
    lastCycleId: (lastCycle as bigint | undefined) ?? 0n,
    loading: isLoading,
  };
}
