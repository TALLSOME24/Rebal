"use client";

import { useState, useCallback } from "react";
import { useAccount, usePublicClient, useWalletClient, useReadContracts } from "wagmi";
import { formatUnits, parseUnits, zeroAddress } from "viem";
import { mockERC20ABI } from "@/lib/abi/mockERC20ABI";
import { WETH, WBTC, USDC, USDT } from "@/lib/constants";
import { useAgentState } from "@/hooks/useAgentState";
import { usePrices } from "@/hooks/usePrices";
import { useToast } from "@/components/Toast";

const TOKENS = [
  { key: "WETH" as const, address: WETH, decimals: 18, symbol: "WETH", name: "Wrapped Ether", icon: "Ξ", priceKey: "eth" as const },
  { key: "WBTC" as const, address: WBTC, decimals: 8, symbol: "WBTC", name: "Wrapped Bitcoin", icon: "₿", priceKey: "btc" as const },
  { key: "USDC" as const, address: USDC, decimals: 6, symbol: "USDC", name: "USD Coin", icon: "$", priceKey: "stable" as const },
  { key: "USDT" as const, address: USDT, decimals: 6, symbol: "USDT", name: "Tether USD", icon: "$", priceKey: "stable" as const },
] as const;

const CLAIM_AMOUNTS = [
  { key: "WETH", label: "1 WETH", address: WETH, amount: parseUnits("1", 18) },
  { key: "WBTC", label: "0.01 WBTC", address: WBTC, amount: parseUnits("0.01", 8) },
  { key: "USDC", label: "1000 USDC", address: USDC, amount: parseUnits("1000", 6) },
  { key: "USDT", label: "1000 USDT", address: USDT, amount: parseUnits("1000", 6) },
] as const;

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

function useCopy() {
  const { toast } = useToast();
  return useCallback(
    (text: string) => {
      void navigator.clipboard.writeText(text).then(() => toast("Copied!", "success"));
    },
    [toast]
  );
}

export function Tokens() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { toast } = useToast();
  const copy = useCopy();
  const agentState = useAgentState();
  const { ethPrice, btcPrice } = usePrices();

  const [claiming, setClaiming] = useState(false);
  const [claimProgress, setClaimProgress] = useState<Record<string, "idle" | "pending" | "done" | "error">>({});

  const { data: balances, refetch } = useReadContracts({
    contracts: TOKENS.map((t) => ({
      address: t.address,
      abi: mockERC20ABI,
      functionName: "balanceOf" as const,
      args: [address ?? zeroAddress],
    })),
    query: { enabled: !!address, refetchInterval: 12_000 },
  });

  const getPrice = (token: typeof TOKENS[number]) => {
    if (token.priceKey === "eth") return ethPrice;
    if (token.priceKey === "btc") return btcPrice;
    return 1;
  };

  const getBalance = (i: number) => {
    if (!balances?.[i] || balances[i].status !== "success") return 0;
    return Number(formatUnits(balances[i].result as bigint, TOKENS[i].decimals));
  };

  const getAllocPct = (key: string) => {
    if (!agentState.registered) return 0;
    const bps: Record<string, number> = {
      WETH: agentState.ethBps,
      WBTC: agentState.wbtcBps,
      USDC: agentState.usdcBps,
      USDT: Math.max(0, 10000 - agentState.ethBps - agentState.wbtcBps - agentState.usdcBps),
    };
    return (bps[key] ?? 0) / 100;
  };

  const claimAll = async () => {
    if (!walletClient || !publicClient || !address) {
      toast("Connect wallet first", "error");
      return;
    }
    setClaiming(true);
    for (const token of CLAIM_AMOUNTS) {
      setClaimProgress((p) => ({ ...p, [token.key]: "pending" }));
      try {
        const txHash = await walletClient.writeContract({
          address: token.address,
          abi: mockERC20ABI,
          functionName: "mint",
          args: [address, token.amount],
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash });
        setClaimProgress((p) => ({ ...p, [token.key]: "done" }));
        toast(`Claimed ${token.label} ✓`, "success");
      } catch (e) {
        setClaimProgress((p) => ({ ...p, [token.key]: "error" }));
        toast(`Failed to claim ${token.label}: ${e instanceof Error ? e.message : "error"}`, "error");
      }
    }
    void refetch();
    setClaiming(false);
  };

  return (
    <div className="space-y-4">
      {/* Claim bar */}
      <div
        className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-4"
        style={{ backgroundColor: "rgba(91,79,232,0.05)", borderColor: "rgba(91,79,232,0.2)" }}
      >
        <div className="flex flex-wrap items-center gap-2">
          {CLAIM_AMOUNTS.map((t) => {
            const status = claimProgress[t.key] ?? "idle";
            return (
              <span
                key={t.key}
                className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-xs"
                style={{
                  borderColor: status === "done" ? "rgba(0,200,150,0.3)" : "rgba(255,255,255,0.08)",
                  color: status === "done" ? "#00C896" : status === "pending" ? "#5B4FE8" : "rgba(255,255,255,0.5)",
                  backgroundColor: status === "done" ? "rgba(0,200,150,0.07)" : "rgba(255,255,255,0.03)",
                }}
              >
                {status === "pending" && (
                  <span className="h-2 w-2 rounded-full border border-current border-t-transparent animate-spin" />
                )}
                {status === "done" && "✓ "}
                {t.label}
              </span>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => void claimAll()}
          disabled={claiming || !address}
          className="rounded-xl px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
          style={{ backgroundColor: "#5B4FE8" }}
        >
          {claiming ? "Claiming…" : "Claim All"}
        </button>
      </div>

      {/* Token cards 2×2 */}
      <div className="grid gap-4 sm:grid-cols-2">
        {TOKENS.map((token, i) => {
          const balance = getBalance(i);
          const price = getPrice(token);
          const usdValue = balance * price;
          const allocPct = getAllocPct(token.key);

          return (
            <div
              key={token.key}
              className="rounded-2xl border p-4"
              style={{ backgroundColor: "rgba(255,255,255,0.025)", borderColor: "rgba(255,255,255,0.06)" }}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-xl text-lg font-bold"
                    style={{ backgroundColor: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)" }}
                  >
                    {token.icon}
                  </div>
                  <div>
                    <p className="font-semibold text-white">{token.name}</p>
                    <p className="font-mono text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                      {token.symbol} · {token.decimals} dec
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm text-white">{balance.toFixed(token.decimals > 8 ? 4 : token.decimals)}</p>
                  <p className="font-mono text-xs" style={{ color: "#00C896" }}>{USD.format(usdValue)}</p>
                </div>
              </div>

              {/* Stats */}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <p className="font-mono text-[9px] uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>Live Price</p>
                  <p className="font-mono text-sm text-white">{USD.format(price)}</p>
                </div>
                <div>
                  <p className="font-mono text-[9px] uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>Target Alloc</p>
                  <p className="font-mono text-sm text-white">{allocPct.toFixed(1)}%</p>
                </div>
              </div>

              {/* Contract address */}
              <button
                type="button"
                onClick={() => copy(token.address)}
                className="mt-3 w-full rounded-xl border px-3 py-1.5 text-left font-mono text-[10px] transition hover:bg-white/5"
                style={{ borderColor: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.3)" }}
                title="Click to copy"
              >
                {token.address}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
