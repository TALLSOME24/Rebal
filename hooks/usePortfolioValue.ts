"use client";

import { useMemo } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { formatUnits, zeroAddress } from "viem";
import { usePrices } from "./usePrices";
import { mockERC20ABI } from "@/lib/abi/mockERC20ABI";
import { WETH, WBTC, USDC, USDT, TOKEN_DECIMALS } from "@/lib/constants";

export type TokenValues = {
  weth: number;
  wbtc: number;
  usdc: number;
  usdt: number;
};

export type PortfolioValue = {
  totalValue: number;
  tokenValues: TokenValues;
  loading: boolean;
};

export function usePortfolioValue(_agentAddress?: string): PortfolioValue {
  const { address } = useAccount();
  const { ethPrice, btcPrice } = usePrices();

  const { data: balances, isLoading } = useReadContracts({
    contracts: [
      { address: WETH, abi: mockERC20ABI, functionName: "balanceOf", args: [address ?? zeroAddress] },
      { address: WBTC, abi: mockERC20ABI, functionName: "balanceOf", args: [address ?? zeroAddress] },
      { address: USDC, abi: mockERC20ABI, functionName: "balanceOf", args: [address ?? zeroAddress] },
      { address: USDT, abi: mockERC20ABI, functionName: "balanceOf", args: [address ?? zeroAddress] },
    ],
    query: { enabled: !!address, refetchInterval: 12_000 },
  });

  const tokenValues = useMemo((): TokenValues => {
    if (!balances) return { weth: 0, wbtc: 0, usdc: 0, usdt: 0 };
    const [w, b, u, t] = balances;
    const wethAmt = w.status === "success" ? Number(formatUnits(w.result as bigint, TOKEN_DECIMALS.WETH)) : 0;
    const wbtcAmt = b.status === "success" ? Number(formatUnits(b.result as bigint, TOKEN_DECIMALS.WBTC)) : 0;
    const usdcAmt = u.status === "success" ? Number(formatUnits(u.result as bigint, TOKEN_DECIMALS.USDC)) : 0;
    const usdtAmt = t.status === "success" ? Number(formatUnits(t.result as bigint, TOKEN_DECIMALS.USDT)) : 0;
    return {
      weth: wethAmt * ethPrice,
      wbtc: wbtcAmt * btcPrice,
      usdc: usdcAmt,
      usdt: usdtAmt,
    };
  }, [balances, ethPrice, btcPrice]);

  const totalValue = tokenValues.weth + tokenValues.wbtc + tokenValues.usdc + tokenValues.usdt;

  return {
    totalValue,
    tokenValues,
    loading: isLoading,
  };
}
