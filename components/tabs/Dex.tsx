"use client";

import { useEffect, useState, useCallback } from "react";
import { useReadContracts, usePublicClient } from "wagmi";
import { formatUnits, type Address } from "viem";
import { uniswapV2PairABI } from "@/lib/abi/uniswapV2PairABI";
import { portfolioAgentABI } from "@/lib/abi/portfolioAgentABI";
import { DEX_PAIRS, WETH, WBTC, USDC, USDT } from "@/lib/constants";
import { TOKEN_DECIMALS } from "@/lib/constants";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border p-4 ${className}`}
      style={{ backgroundColor: "rgba(255,255,255,0.025)", borderColor: "rgba(255,255,255,0.06)" }}
    >
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 font-mono text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)", letterSpacing: "1.4px" }}>
      {children}
    </p>
  );
}

type PairInfo = {
  label: string;
  pair: Address;
  decimals0: number;
  decimals1: number;
  sym0: string;
  sym1: string;
  priceLabel: string; // e.g. "WETH/USDC"
};

const PAIR_META: PairInfo[] = [
  { label: "WETH / USDC", pair: DEX_PAIRS["WETH/USDC"], decimals0: 18, decimals1: 6,  sym0: "WETH", sym1: "USDC", priceLabel: "WETH price (USDC)" },
  { label: "WETH / USDT", pair: DEX_PAIRS["WETH/USDT"], decimals0: 18, decimals1: 6,  sym0: "WETH", sym1: "USDT", priceLabel: "WETH price (USDT)" },
  { label: "WETH / WBTC", pair: DEX_PAIRS["WETH/WBTC"], decimals0: 18, decimals1: 8,  sym0: "WETH", sym1: "WBTC", priceLabel: "WBTC price (WETH)" },
];

// address → symbol + decimals
const TOKEN_META: Record<string, { sym: string; dec: number }> = {
  [WETH.toLowerCase()]:  { sym: "WETH", dec: TOKEN_DECIMALS.WETH },
  [WBTC.toLowerCase()]:  { sym: "WBTC", dec: TOKEN_DECIMALS.WBTC },
  [USDC.toLowerCase()]:  { sym: "USDC", dec: TOKEN_DECIMALS.USDC },
  [USDT.toLowerCase()]:  { sym: "USDT", dec: TOKEN_DECIMALS.USDT },
};

function tokenSym(addr: string) { return TOKEN_META[addr.toLowerCase()]?.sym ?? addr.slice(0, 8); }
function tokenDec(addr: string) { return TOKEN_META[addr.toLowerCase()]?.dec ?? 18; }

type SwapEvent = {
  blockNumber: bigint;
  txHash: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOut: bigint;
};

function useSwapEvents(agentAddress: Address | undefined) {
  const publicClient = usePublicClient();
  const [swaps, setSwaps] = useState<SwapEvent[]>([]);

  const fetch = useCallback(async () => {
    if (!publicClient || !agentAddress) return;
    try {
      const latest = await publicClient.getBlockNumber();
      const from = latest > 20000n ? latest - 20000n : 0n;
      const logs = await publicClient.getContractEvents({
        address: agentAddress,
        abi: portfolioAgentABI,
        eventName: "SwapExecuted",
        fromBlock: from,
        toBlock: latest,
      });
      setSwaps(
        logs
          .map((l) => {
            const a = l.args as { tokenIn: Address; tokenOut: Address; amountIn: bigint; amountOut: bigint };
            return {
              blockNumber: l.blockNumber ?? 0n,
              txHash: l.transactionHash as string,
              tokenIn: a.tokenIn,
              tokenOut: a.tokenOut,
              amountIn: a.amountIn,
              amountOut: a.amountOut,
            };
          })
          .sort((a, b) => Number(b.blockNumber - a.blockNumber))
          .slice(0, 20)
      );
    } catch {
      // keep previous on error
    }
  }, [agentAddress, publicClient]);

  useEffect(() => {
    void fetch();
    const id = setInterval(() => void fetch(), 20_000);
    return () => clearInterval(id);
  }, [fetch]);

  return swaps;
}

export function Dex({ agentAddress }: { agentAddress: Address }) {
  const swaps = useSwapEvents(agentAddress);

  // Batch-read getReserves + token0 for each pair
  const pairCalls = PAIR_META.flatMap((p) => [
    { address: p.pair, abi: uniswapV2PairABI, functionName: "getReserves" as const },
    { address: p.pair, abi: uniswapV2PairABI, functionName: "token0" as const },
    { address: p.pair, abi: uniswapV2PairABI, functionName: "totalSupply" as const },
  ]);

  const { data: pairData } = useReadContracts({
    contracts: pairCalls,
    query: { refetchInterval: 15_000 },
  });

  type ReserveResult = { status: "success" | "failure"; result?: [bigint, bigint, number] };
  type AddressResult = { status: "success" | "failure"; result?: Address };
  type SupplyResult  = { status: "success" | "failure"; result?: bigint };

  const pools = PAIR_META.map((meta, i) => {
    const resData  = pairData?.[i * 3]     as ReserveResult | undefined;
    const t0Data   = pairData?.[i * 3 + 1] as AddressResult | undefined;
    const supData  = pairData?.[i * 3 + 2] as SupplyResult  | undefined;

    const reserves = resData?.status === "success" ? resData.result : undefined;
    const token0   = t0Data?.status  === "success" ? t0Data.result  : undefined;
    const supply   = supData?.status === "success" ? supData.result : undefined;

    let r0 = reserves?.[0] ?? 0n;
    let r1 = reserves?.[1] ?? 0n;
    let dec0 = meta.decimals0;
    let dec1 = meta.decimals1;
    let sym0 = meta.sym0;
    let sym1 = meta.sym1;

    // Pair may have swapped token order
    if (token0 && token0.toLowerCase() !== {
      "WETH/USDC": WETH, "WETH/USDT": WETH, "WETH/WBTC": WETH,
    }[`${meta.sym0}/${meta.sym1}` as keyof typeof DEX_PAIRS]?.toLowerCase()) {
      [r0, r1] = [r1, r0];
      [dec0, dec1] = [dec1, dec0];
      [sym0, sym1] = [sym1, sym0];
    }

    const f0 = Number(formatUnits(r0, dec0));
    const f1 = Number(formatUnits(r1, dec1));

    // Price: for WETH/stable, price = stable_per_1_WETH = r1/r0
    // For WETH/WBTC, show BTC price in ETH = r0/r1 (how many WETH per 1 WBTC)
    let price: number | undefined;
    let priceStr = "—";
    if (f0 > 0 && f1 > 0) {
      if (meta.label === "WETH / WBTC") {
        price = f0 / f1; // WETH per WBTC
        priceStr = price.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " WETH";
      } else {
        price = f1 / f0; // USDC/USDT per WETH
        priceStr = "$" + price.toLocaleString(undefined, { maximumFractionDigits: 2 });
      }
    }

    return {
      meta,
      r0, r1, dec0, dec1, sym0, sym1,
      f0, f1, price, priceStr,
      supply: supply ?? 0n,
      loaded: !!reserves,
    };
  });

  const totalVolumeSwaps = swaps.length;

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <div
        className="grid grid-cols-2 overflow-hidden rounded-2xl lg:grid-cols-4"
        style={{ backgroundColor: "rgba(255,255,255,0.05)", gap: "1px" }}
      >
        {[
          { label: "Agent Swaps",  value: String(totalVolumeSwaps) },
          { label: "WETH Price",   value: pools[0]?.priceStr ?? "—" },
          { label: "Active Pairs", value: String(PAIR_META.length) },
          { label: "DEX",         value: "Rebal V2" },
        ].map(({ label, value }) => (
          <div key={label} className="px-4 py-3" style={{ backgroundColor: "rgba(4,5,10,0.7)" }}>
            <p className="font-mono text-[10px] uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>{label}</p>
            <p className="mt-0.5 font-mono text-sm font-semibold text-white">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">

          {/* Liquidity Pools */}
          <Card>
            <Label>Liquidity Pools · Rebal DEX</Label>
            <div className="space-y-3">
              {pools.map((pool) => (
                <div
                  key={pool.meta.label}
                  className="rounded-xl border p-3"
                  style={{ borderColor: "rgba(255,255,255,0.06)", backgroundColor: "rgba(255,255,255,0.02)" }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">{pool.meta.label}</span>
                    <span
                      className="rounded-full px-2 py-0.5 font-mono text-[10px]"
                      style={{ backgroundColor: "rgba(91,79,232,0.15)", color: "#8B7FF5" }}
                    >
                      0.3% fee
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <div>
                      <p className="font-mono text-[9px] uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>Reserve {pool.sym0}</p>
                      <p className="font-mono text-xs text-white">
                        {pool.loaded ? pool.f0.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "…"}
                      </p>
                    </div>
                    <div>
                      <p className="font-mono text-[9px] uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>Reserve {pool.sym1}</p>
                      <p className="font-mono text-xs text-white">
                        {pool.loaded ? pool.f1.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "…"}
                      </p>
                    </div>
                    <div>
                      <p className="font-mono text-[9px] uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>{pool.meta.priceLabel}</p>
                      <p className="font-mono text-xs" style={{ color: "#00C896" }}>
                        {pool.loaded ? pool.priceStr : "…"}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Swap History */}
          <Card>
            <Label>Swap History · Agent Executed</Label>
            {swaps.length === 0 ? (
              <div className="rounded-xl border py-6 text-center" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                <p className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>No agent swaps yet.</p>
                <p className="mt-1 text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>
                  SwapExecuted events will appear here once the agent rebalances.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {swaps.map((s, i) => {
                  const inSym  = tokenSym(s.tokenIn);
                  const outSym = tokenSym(s.tokenOut);
                  const inDec  = tokenDec(s.tokenIn);
                  const outDec = tokenDec(s.tokenOut);
                  const fIn  = Number(formatUnits(s.amountIn,  inDec));
                  const fOut = Number(formatUnits(s.amountOut, outDec));
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-xl border px-3 py-2"
                      style={{ borderColor: "rgba(255,255,255,0.05)" }}
                    >
                      <div>
                        <p className="text-sm text-white">
                          {fIn.toLocaleString(undefined, { maximumFractionDigits: 6 })} {inSym}
                          <span className="mx-1.5" style={{ color: "rgba(255,255,255,0.3)" }}>→</span>
                          {fOut.toLocaleString(undefined, { maximumFractionDigits: 6 })} {outSym}
                        </p>
                        <p className="font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                          {s.txHash.slice(0, 14)}…
                        </p>
                      </div>
                      <p className="shrink-0 font-mono text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                        #{String(s.blockNumber)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          <Card>
            <Label>How It Works</Label>
            <ol className="space-y-2">
              {[
                "Set target allocation % in the Rebalance tab",
                "Agent fetches live prices on each HTTP tick",
                "LLM tick evaluates drift vs target",
                "PortfolioAgent auto-swaps via Rebal DEX router",
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
                  <span className="shrink-0 font-mono text-[10px] mt-0.5" style={{ color: "#5B4FE8" }}>{i + 1}.</span>
                  {step}
                </li>
              ))}
            </ol>
          </Card>

          <Card>
            <Label>Safety Rules</Label>
            <ul className="space-y-2">
              {[
                "Min swap: $0.10 threshold",
                "0.3% fee deducted per swap",
                "No swap if portfolio at target",
                "WETH used as routing hub",
                "Only whitelisted token pairs",
              ].map((r) => (
                <li key={r} className="flex items-start gap-2">
                  <span style={{ color: "#00C896" }}>✓</span>
                  <span className="text-xs leading-4" style={{ color: "rgba(255,255,255,0.4)" }}>{r}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <Label>Contract Addresses</Label>
            <div className="space-y-2">
              {[
                { label: "Router",       addr: "0xB44b8...C893D" },
                { label: "Factory",      addr: "0xD2D77...867c" },
                { label: "WETH/USDC",    addr: "0xc91eB...560" },
                { label: "WETH/USDT",    addr: "0x834f2...a12" },
                { label: "WETH/WBTC",    addr: "0xcEf6e...3A2" },
              ].map(({ label, addr }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</span>
                  <span className="font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }}>{addr}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
