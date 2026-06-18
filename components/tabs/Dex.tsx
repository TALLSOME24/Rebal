"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  useReadContracts,
  usePublicClient,
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
} from "wagmi";
import { formatUnits, parseUnits, type Address } from "viem";
import { uniswapV2PairABI } from "@/lib/abi/uniswapV2PairABI";
import { uniswapV2RouterABI } from "@/lib/abi/uniswapV2RouterABI";
import { portfolioAgentABI } from "@/lib/abi/portfolioAgentABI";
import { DEX_PAIRS, DEX_ROUTER, WETH, WBTC, USDC, USDT } from "@/lib/constants";
import { TOKEN_DECIMALS } from "@/lib/constants";

// ── Minimal ERC20 ABI for approve + balanceOf + allowance ─────────────────────
const erc20Abi = [
  { name: "balanceOf",  type: "function", stateMutability: "view",
    inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "allowance",  type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ type: "uint256" }] },
  { name: "approve",    type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }] },
] as const;

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

// ── Token registry ─────────────────────────────────────────────────────────────
const TOKENS = [
  { sym: "WETH", addr: WETH as Address, dec: TOKEN_DECIMALS.WETH },
  { sym: "WBTC", addr: WBTC as Address, dec: TOKEN_DECIMALS.WBTC },
  { sym: "USDC", addr: USDC as Address, dec: TOKEN_DECIMALS.USDC },
  { sym: "USDT", addr: USDT as Address, dec: TOKEN_DECIMALS.USDT },
];

const TOKEN_BY_SYM = Object.fromEntries(TOKENS.map(t => [t.sym, t]));
const TOKEN_BY_ADDR: Record<string, typeof TOKENS[0]> = Object.fromEntries(
  TOKENS.map(t => [t.addr.toLowerCase(), t])
);

function tokenSym(addr: string) { return TOKEN_BY_ADDR[addr.toLowerCase()]?.sym ?? addr.slice(0, 8); }
function tokenDec(addr: string) { return TOKEN_BY_ADDR[addr.toLowerCase()]?.dec ?? 18; }

// ── Pair metadata ──────────────────────────────────────────────────────────────
type PairInfo = {
  label: string; pair: Address; decimals0: number; decimals1: number;
  sym0: string; sym1: string; priceLabel: string;
};

const PAIR_META: PairInfo[] = [
  { label: "WETH / USDC", pair: DEX_PAIRS["WETH/USDC"], decimals0: 18, decimals1: 6,  sym0: "WETH", sym1: "USDC", priceLabel: "WETH price (USDC)" },
  { label: "WETH / USDT", pair: DEX_PAIRS["WETH/USDT"], decimals0: 18, decimals1: 6,  sym0: "WETH", sym1: "USDT", priceLabel: "WETH price (USDT)" },
  { label: "WETH / WBTC", pair: DEX_PAIRS["WETH/WBTC"], decimals0: 18, decimals1: 8,  sym0: "WETH", sym1: "WBTC", priceLabel: "WBTC price (WETH)" },
];

// ── Swap event history ─────────────────────────────────────────────────────────
type SwapEvent = {
  blockNumber: bigint; txHash: string;
  tokenIn: string; tokenOut: string; amountIn: bigint; amountOut: bigint;
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
        address: agentAddress, abi: portfolioAgentABI,
        eventName: "SwapExecuted", fromBlock: from, toBlock: latest,
      });
      setSwaps(
        logs.map((l) => {
          const a = l.args as { tokenIn: Address; tokenOut: Address; amountIn: bigint; amountOut: bigint };
          return { blockNumber: l.blockNumber ?? 0n, txHash: l.transactionHash as string,
            tokenIn: a.tokenIn, tokenOut: a.tokenOut, amountIn: a.amountIn, amountOut: a.amountOut };
        }).sort((a, b) => Number(b.blockNumber - a.blockNumber)).slice(0, 20)
      );
    } catch { /* keep previous on error */ }
  }, [agentAddress, publicClient]);

  useEffect(() => {
    void fetch();
    const id = setInterval(() => void fetch(), 20_000);
    return () => clearInterval(id);
  }, [fetch]);

  return swaps;
}

// ── Manual swap UI ─────────────────────────────────────────────────────────────
function ManualSwap() {
  const { address: userAddr } = useAccount();
  const [fromSym, setFromSym] = useState("WETH");
  const [toSym,   setToSym]   = useState("USDC");
  const [amtIn,   setAmtIn]   = useState("");
  const [step,    setStep]    = useState<"idle" | "approving" | "swapping">("idle");
  const [txMsg,   setTxMsg]   = useState<string | null>(null);

  const fromToken = TOKEN_BY_SYM[fromSym];
  const toToken   = TOKEN_BY_SYM[toSym];

  // Build path: direct if one is WETH, else route through WETH
  const path = useMemo<Address[]>(() => {
    if (!fromToken || !toToken) return [];
    if (fromSym === "WETH" || toSym === "WETH") return [fromToken.addr, toToken.addr];
    return [fromToken.addr, WETH as Address, toToken.addr];
  }, [fromSym, toSym, fromToken, toToken]);

  const amtInParsed = useMemo(() => {
    if (!fromToken || !amtIn || isNaN(Number(amtIn)) || Number(amtIn) <= 0) return 0n;
    try { return parseUnits(amtIn, fromToken.dec); } catch { return 0n; }
  }, [amtIn, fromToken]);

  // getAmountsOut quote
  const { data: amountsOut } = useReadContract({
    address: DEX_ROUTER as Address,
    abi: uniswapV2RouterABI,
    functionName: "getAmountsOut",
    args: [amtInParsed, path],
    query: { enabled: amtInParsed > 0n && path.length >= 2, refetchInterval: 5_000 },
  });
  const quoteOut = amountsOut ? (amountsOut as bigint[])[amountsOut.length - 1] : undefined;

  // allowance
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: fromToken?.addr,
    abi: erc20Abi,
    functionName: "allowance",
    args: [userAddr ?? "0x0000000000000000000000000000000000000000", DEX_ROUTER as Address],
    query: { enabled: !!userAddr && !!fromToken },
  });

  // wallet balance of fromToken
  const { data: fromBalance } = useReadContract({
    address: fromToken?.addr,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [userAddr ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!userAddr && !!fromToken, refetchInterval: 10_000 },
  });

  const { writeContractAsync } = useWriteContract();
  const needsApproval = !allowance || (allowance as bigint) < amtInParsed;

  const handleSwap = useCallback(async () => {
    if (!userAddr || !fromToken || !toToken || amtInParsed === 0n) return;
    setTxMsg(null);
    try {
      if (needsApproval) {
        setStep("approving");
        setTxMsg("Approving router…");
        const appHash = await writeContractAsync({
          address: fromToken.addr, abi: erc20Abi, functionName: "approve",
          args: [DEX_ROUTER as Address, amtInParsed],
        });
        setTxMsg(`Approve TX: ${appHash.slice(0, 14)}…`);
        await refetchAllowance();
      }

      setStep("swapping");
      setTxMsg("Sending swap…");
      // Ritual block.timestamp is in ms; use far-future deadline
      const deadline = 9_999_999_999_999n;
      const swapHash = await writeContractAsync({
        address: DEX_ROUTER as Address, abi: uniswapV2RouterABI,
        functionName: "swapExactTokensForTokens",
        args: [amtInParsed, 0n, path, userAddr, deadline],
      });
      setTxMsg(`Swap TX: ${swapHash.slice(0, 14)}… ✓`);
      setAmtIn("");
      setStep("idle");
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "shortMessage" in e
        ? String((e as { shortMessage: string }).shortMessage)
        : String(e);
      setTxMsg("Error: " + msg.slice(0, 80));
      setStep("idle");
    }
  }, [userAddr, fromToken, toToken, amtInParsed, needsApproval, path, writeContractAsync, refetchAllowance]);

  if (!userAddr) {
    return (
      <Card>
        <Label>Manual Swap</Label>
        <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>Connect wallet to swap.</p>
      </Card>
    );
  }

  const fromBalFmt = fromBalance !== undefined
    ? Number(formatUnits(fromBalance as bigint, fromToken?.dec ?? 18)).toLocaleString(undefined, { maximumFractionDigits: 6 })
    : "…";
  const quoteFmt = quoteOut !== undefined && toToken
    ? Number(formatUnits(quoteOut, toToken.dec)).toLocaleString(undefined, { maximumFractionDigits: 6 })
    : amtInParsed > 0n ? "…" : "—";

  const busy = step !== "idle";
  const canSwap = amtInParsed > 0n && fromSym !== toSym;

  return (
    <Card>
      <Label>Manual Swap</Label>
      <div className="space-y-3">
        {/* From */}
        <div className="rounded-xl border p-3" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <div className="flex items-center justify-between mb-1">
            <select
              value={fromSym}
              onChange={e => setFromSym(e.target.value)}
              className="bg-transparent font-mono text-sm font-semibold text-white outline-none cursor-pointer"
            >
              {TOKENS.map(t => <option key={t.sym} value={t.sym} style={{ background: "#0d0e14" }}>{t.sym}</option>)}
            </select>
            <span className="font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
              Bal: {fromBalFmt}
            </span>
          </div>
          <input
            type="number"
            placeholder="0.0"
            value={amtIn}
            onChange={e => setAmtIn(e.target.value)}
            className="w-full bg-transparent font-mono text-lg text-white outline-none placeholder-white/20"
          />
        </div>

        {/* Arrow */}
        <div className="flex justify-center">
          <button
            onClick={() => { setFromSym(toSym); setToSym(fromSym); setAmtIn(""); }}
            className="rounded-lg border px-3 py-1 font-mono text-sm transition-colors"
            style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }}
          >
            ↕
          </button>
        </div>

        {/* To */}
        <div className="rounded-xl border p-3" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <div className="flex items-center justify-between mb-1">
            <select
              value={toSym}
              onChange={e => setToSym(e.target.value)}
              className="bg-transparent font-mono text-sm font-semibold text-white outline-none cursor-pointer"
            >
              {TOKENS.map(t => <option key={t.sym} value={t.sym} style={{ background: "#0d0e14" }}>{t.sym}</option>)}
            </select>
            <span className="font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
              You receive
            </span>
          </div>
          <p className="font-mono text-lg" style={{ color: quoteFmt === "—" ? "rgba(255,255,255,0.2)" : "#00C896" }}>
            {quoteFmt}
          </p>
        </div>

        {/* Button */}
        <button
          onClick={handleSwap}
          disabled={!canSwap || busy}
          className="w-full rounded-xl py-2.5 font-mono text-sm font-semibold transition-opacity disabled:opacity-40"
          style={{ background: "linear-gradient(135deg,#5B4FE8,#8B7FF5)" }}
        >
          {busy
            ? step === "approving" ? "Approving…" : "Swapping…"
            : needsApproval && canSwap ? "Approve & Swap" : "Swap"}
        </button>

        {/* Status */}
        {txMsg && (
          <p className="font-mono text-[10px] break-all" style={{ color: txMsg.startsWith("Error") ? "#FF6B6B" : "rgba(255,255,255,0.4)" }}>
            {txMsg}
          </p>
        )}

        {/* Path info */}
        {path.length === 3 && (
          <p className="font-mono text-[10px] text-center" style={{ color: "rgba(255,255,255,0.2)" }}>
            Route: {fromSym} → WETH → {toSym}
          </p>
        )}
      </div>
    </Card>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export function Dex({ agentAddress }: { agentAddress: Address }) {
  const swaps = useSwapEvents(agentAddress);

  // Batch-read getReserves + token0 + totalSupply for each pair
  const pairCalls = PAIR_META.flatMap((p) => [
    { address: p.pair, abi: uniswapV2PairABI, functionName: "getReserves" as const },
    { address: p.pair, abi: uniswapV2PairABI, functionName: "token0"      as const },
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
    const resData = pairData?.[i * 3]     as ReserveResult | undefined;
    const t0Data  = pairData?.[i * 3 + 1] as AddressResult | undefined;
    const supData = pairData?.[i * 3 + 2] as SupplyResult  | undefined;

    const reserves = resData?.status === "success" ? resData.result : undefined;
    const token0   = t0Data?.status  === "success" ? t0Data.result  : undefined;
    const supply   = supData?.status === "success" ? supData.result : undefined;

    let r0 = reserves?.[0] ?? 0n;
    let r1 = reserves?.[1] ?? 0n;
    let dec0 = meta.decimals0, dec1 = meta.decimals1;
    let sym0 = meta.sym0,      sym1 = meta.sym1;

    // Correct for pair's actual token order (sym0 is always WETH for our pairs)
    const expectedToken0 = meta.sym0 === "WETH" ? WETH : undefined;
    if (token0 && expectedToken0 && token0.toLowerCase() !== expectedToken0.toLowerCase()) {
      [r0, r1] = [r1, r0]; [dec0, dec1] = [dec1, dec0]; [sym0, sym1] = [sym1, sym0];
    }

    const f0 = Number(formatUnits(r0, dec0));
    const f1 = Number(formatUnits(r1, dec1));

    let priceStr = "—";
    if (f0 > 0 && f1 > 0) {
      if (meta.label === "WETH / WBTC") {
        priceStr = (f0 / f1).toLocaleString(undefined, { maximumFractionDigits: 2 }) + " WETH";
      } else {
        priceStr = "$" + (f1 / f0).toLocaleString(undefined, { maximumFractionDigits: 2 });
      }
    }

    return { meta, r0, r1, dec0, dec1, sym0, sym1, f0, f1, priceStr, supply: supply ?? 0n, loaded: !!reserves };
  });

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <div
        className="grid grid-cols-2 overflow-hidden rounded-2xl lg:grid-cols-4"
        style={{ backgroundColor: "rgba(255,255,255,0.05)", gap: "1px" }}
      >
        {[
          { label: "Agent Swaps",  value: String(swaps.length) },
          { label: "WETH Price",   value: pools[0]?.priceStr ?? "—" },
          { label: "Active Pairs", value: String(PAIR_META.length) },
          { label: "DEX",          value: "Rebal V2" },
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
                  SwapExecuted events appear here once the agent rebalances.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {swaps.map((s, i) => {
                  const inSym  = tokenSym(s.tokenIn);
                  const outSym = tokenSym(s.tokenOut);
                  const fIn  = Number(formatUnits(s.amountIn,  tokenDec(s.tokenIn)));
                  const fOut = Number(formatUnits(s.amountOut, tokenDec(s.tokenOut)));
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
          <ManualSwap />

          <Card>
            <Label>Safety Rules</Label>
            <ul className="space-y-2">
              {[
                "Agent swaps gated on LLM 'swap' decision",
                "amountBps capped at 10,000 (100%)",
                "0.3% fee deducted per swap",
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
                { label: "Router",    addr: DEX_ROUTER },
                { label: "WETH/USDC", addr: DEX_PAIRS["WETH/USDC"] },
                { label: "WETH/USDT", addr: DEX_PAIRS["WETH/USDT"] },
                { label: "WETH/WBTC", addr: DEX_PAIRS["WETH/WBTC"] },
              ].map(({ label, addr }) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span className="shrink-0 font-mono text-[10px] uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</span>
                  <span className="font-mono text-[10px] truncate" style={{ color: "rgba(255,255,255,0.5)" }} title={addr}>
                    {addr.slice(0, 10)}…{addr.slice(-6)}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
