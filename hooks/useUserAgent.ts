"use client";

import { useEffect } from "react";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { zeroAddress, type Address } from "viem";
import { portfolioAgentFactoryABI } from "@/lib/abi/portfolioAgentFactoryABI";
import { FACTORY_ADDRESS } from "@/lib/constants";

export type UserAgentResult = {
  agentAddress: Address | undefined;
  hasAgent: boolean;
  isLoading: boolean;
  deployAgent: () => void;
  deployPending: boolean;
  deployConfirming: boolean;
  deploySuccess: boolean;
  deployHash: `0x${string}` | undefined;
  refetch: () => void;
};

export function useUserAgent(address: Address | undefined): UserAgentResult {
  const { data: agentAddress, isLoading, refetch } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: portfolioAgentFactoryABI,
    functionName: "getAgent",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });

  const { writeContract, data: deployHash, isPending: deployPending } = useWriteContract();
  const { isSuccess: deploySuccess, isLoading: deployConfirming } = useWaitForTransactionReceipt({
    hash: deployHash,
    query: { enabled: !!deployHash },
  });

  // Auto-refetch once TX confirms so the parent sees hasAgent → true immediately
  useEffect(() => {
    if (deploySuccess) void refetch();
  }, [deploySuccess, refetch]);

  const deployAgent = () =>
    writeContract({
      address: FACTORY_ADDRESS,
      abi: portfolioAgentFactoryABI,
      functionName: "deployAgent",
    });

  const resolvedAgent = agentAddress as Address | undefined;
  const hasAgent = !!resolvedAgent && resolvedAgent !== zeroAddress;

  return {
    agentAddress: hasAgent ? resolvedAgent : undefined,
    hasAgent,
    isLoading,
    deployAgent,
    deployPending,
    deployConfirming,
    deploySuccess,
    deployHash,
    refetch,
  };
}
