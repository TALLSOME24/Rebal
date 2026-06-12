"use client";

import { useState, useEffect } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { portfolioAgentABI } from "@/lib/abi/portfolioAgentABI";
import { useAgentState } from "@/hooks/useAgentState";
import { useToast } from "@/components/Toast";
import { fetchLlmExecutor, fetchHttpExecutor } from "@/lib/tee";
import type { Address } from "viem";

const RISK_MODES = [
  { id: 0, label: "Safe", desc: "40% max single asset. Capital preservation first." },
  { id: 1, label: "Balanced", desc: "60% max. Default drift control with measured upside." },
  { id: 2, label: "Degen", desc: "No limit. Max AI-suggested corrections when drift is material." },
] as const;

function Card({ children, style, className = "" }: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  return (
    <div
      className={`rounded-2xl border p-4 ${className}`}
      style={{ backgroundColor: "rgba(255,255,255,0.025)", borderColor: "rgba(255,255,255,0.06)", ...style }}
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

function SliderRow({
  label,
  color,
  value,
  max,
  onChange,
  readOnly,
}: {
  label: string;
  color: string;
  value: number;
  max: number;
  onChange?: (v: number) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <span className="text-sm text-white">{label}</span>
        </div>
        <span className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>
          {value.toFixed(1)}%
        </span>
      </div>
      {readOnly ? (
        <div className="h-0.5 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.08)" }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(value, 100)}%`, backgroundColor: color }}
          />
        </div>
      ) : (
        <input
          type="range"
          min={0}
          max={max}
          step={0.5}
          value={value}
          onChange={(e) => onChange?.(Number(e.target.value))}
          className="w-full"
          style={{ accentColor: color }}
        />
      )}
    </div>
  );
}

function parseStrategyText(text: string): { weth: number; wbtc: number; usdc: number; usdt: number } | null {
  const lower = text.toLowerCase();
  const extract = (keywords: string[]) => {
    for (const kw of keywords) {
      const patterns = [
        new RegExp(`(\\d+(?:\\.\\d+)?)%?\\s*${kw}`),
        new RegExp(`${kw}[:\\s]+(\\d+(?:\\.\\d+)?)%?`),
      ];
      for (const p of patterns) {
        const m = lower.match(p);
        if (m) return parseFloat(m[1]);
      }
    }
    return null;
  };
  const weth = extract(["weth", "eth", "ether"]);
  const wbtc = extract(["wbtc", "btc", "bitcoin"]);
  const usdc = extract(["usdc"]);
  const usdt = extract(["usdt"]);
  if (!weth && !wbtc && !usdc && !usdt) return null;
  const total = (weth ?? 0) + (wbtc ?? 0) + (usdc ?? 0) + (usdt ?? 0);
  if (total > 105) return null;
  const remaining = 100 - (weth ?? 0) - (wbtc ?? 0) - (usdc ?? 0) - (usdt ?? 0);
  return {
    weth: weth ?? 0,
    wbtc: wbtc ?? 0,
    usdc: usdc ?? (usdt === null && weth !== null ? Math.max(0, remaining) : 0),
    usdt: usdt ?? 0,
  };
}

export function Rebalance({ agentAddress }: { agentAddress: Address }) {
  const { address } = useAccount();
  const agentState = useAgentState(agentAddress);
  const { toast } = useToast();

  const [wethPct, setWethPct] = useState(40);
  const [wbtcPct, setWbtcPct] = useState(30);
  const [usdcPct, setUsdcPct] = useState(20);
  const usdtPct = Math.max(0, 100 - wethPct - wbtcPct - usdcPct);
  const [riskMode, setRiskMode] = useState<0 | 1 | 2>(1);
  const [strategyText, setStrategyText] = useState("");
  const [parsedPreview, setParsedPreview] = useState<string | null>(null);
  const [executors, setExecutors] = useState<{ llm?: Address; http?: Address }>({});
  const [loadingExecutors, setLoadingExecutors] = useState(false);

  // Pre-populate from onchain
  useEffect(() => {
    if (agentState.registered) {
      setWethPct(agentState.ethBps / 100);
      setWbtcPct(agentState.wbtcBps / 100);
      setUsdcPct(agentState.usdcBps / 100);
      setRiskMode(agentState.riskMode as 0 | 1 | 2);
    }
  }, [agentState.registered, agentState.ethBps, agentState.wbtcBps, agentState.usdcBps, agentState.riskMode]);

  const loadExecutors = async () => {
    setLoadingExecutors(true);
    try {
      const [llm, http] = await Promise.all([fetchLlmExecutor(), fetchHttpExecutor()]);
      setExecutors({ llm, http });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to load executors", "error");
    } finally {
      setLoadingExecutors(false);
    }
  };

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: Boolean(txHash) },
  });

  useEffect(() => {
    if (isSuccess) toast("Portfolio saved onchain ✓", "success");
  }, [isSuccess, toast]);

  const total = wethPct + wbtcPct + usdcPct + usdtPct;
  const totalInvalid = total > 100.1;

  const setAlloc = (w: number, b: number, u: number) => {
    setWethPct(Math.max(0, Math.min(100, w)));
    setWbtcPct(Math.max(0, Math.min(100 - w, b)));
    setUsdcPct(Math.max(0, Math.min(100 - w - b, u)));
  };

  const parseStrategy = () => {
    const result = parseStrategyText(strategyText);
    if (!result) {
      toast("Couldn't parse allocation from text. Try: '40% WETH, 30% WBTC, 20% USDC, 10% USDT'", "error");
      return;
    }
    setAlloc(result.weth, result.wbtc, result.usdc);
    setParsedPreview(
      `Understood: ${result.weth}% WETH, ${result.wbtc}% WBTC, ${result.usdc}% USDC, ${result.usdt || Math.max(0, 100 - result.weth - result.wbtc - result.usdc)}% USDT`
    );
    toast("Strategy parsed — review sliders and save", "success");
  };

  const savePortfolio = () => {
    if (!address) return toast("Connect wallet first", "error");
    if (!executors.llm || !executors.http) return toast("Load executors first", "error");
    if (totalInvalid) return toast("Total allocation exceeds 100%", "error");
    const wethBps = Math.round(wethPct * 100);
    const wbtcBps = Math.round(wbtcPct * 100);
    const usdcBps = Math.round(usdcPct * 100);
    toast("Sending transaction…", "pending");
    writeContract({
      address: agentAddress,
      abi: portfolioAgentABI,
      functionName: "registerPortfolio",
      args: [riskMode, wethBps, wbtcBps, usdcBps, executors.llm, executors.http],
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      {/* Main */}
      <div className="space-y-4">
        {/* AI Strategy */}
        <div
          className="rounded-2xl border p-4"
          style={{ backgroundColor: "rgba(91,79,232,0.05)", borderColor: "rgba(91,79,232,0.2)" }}
        >
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest" style={{ color: "rgba(91,79,232,0.8)", letterSpacing: "1.4px" }}>
            AI Strategy Parser
          </p>
          <textarea
            value={strategyText}
            onChange={(e) => setStrategyText(e.target.value)}
            placeholder="e.g. 'Put 40% in ETH, 30% in Bitcoin, rest in stables' or '50/25/15/10 WETH WBTC USDC USDT'"
            rows={3}
            className="w-full resize-none rounded-xl border px-3 py-2 text-sm focus:outline-none"
            style={{
              backgroundColor: "rgba(255,255,255,0.04)",
              borderColor: "rgba(255,255,255,0.08)",
              color: "white",
            }}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={parseStrategy}
              disabled={!strategyText.trim()}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: "#5B4FE8" }}
            >
              Parse Strategy →
            </button>
            {parsedPreview && (
              <p className="text-sm" style={{ color: "#00C896" }}>
                {parsedPreview}
              </p>
            )}
          </div>
        </div>

        {/* Manual Allocation */}
        <div
          className="rounded-2xl border p-4"
          style={{ backgroundColor: "rgba(255,255,255,0.025)", borderColor: "rgba(255,255,255,0.06)" }}
        >
          <p className="mb-3 font-mono text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)", letterSpacing: "1.4px" }}>
            Manual Allocation
          </p>
          <div className="space-y-4">
            <SliderRow
              label="WETH"
              color="#5B4FE8"
              value={wethPct}
              max={100}
              onChange={(v) => setAlloc(v, wbtcPct, usdcPct)}
            />
            <SliderRow
              label="WBTC"
              color="#D4A847"
              value={wbtcPct}
              max={100 - wethPct}
              onChange={(v) => setAlloc(wethPct, v, usdcPct)}
            />
            <SliderRow
              label="USDC"
              color="#00C896"
              value={usdcPct}
              max={100 - wethPct - wbtcPct}
              onChange={(v) => setAlloc(wethPct, wbtcPct, v)}
            />
            <SliderRow
              label="USDT (auto)"
              color="rgba(255,255,255,0.3)"
              value={usdtPct}
              max={100}
              readOnly
            />
          </div>
          {totalInvalid && (
            <p className="mt-2 text-sm" style={{ color: "#FF4757" }}>
              Total exceeds 100% — adjust sliders
            </p>
          )}
        </div>

        {/* Risk Mode */}
        <div
          className="rounded-2xl border p-4"
          style={{ backgroundColor: "rgba(255,255,255,0.025)", borderColor: "rgba(255,255,255,0.06)" }}
        >
          <p className="mb-3 font-mono text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)", letterSpacing: "1.4px" }}>
            Risk Mode
          </p>
          <div className="grid grid-cols-3 gap-2">
            {RISK_MODES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRiskMode(r.id)}
                className="rounded-xl border px-3 py-3 text-left transition"
                style={{
                  backgroundColor: riskMode === r.id ? "rgba(91,79,232,0.15)" : "rgba(255,255,255,0.02)",
                  borderColor: riskMode === r.id ? "rgba(91,79,232,0.4)" : "rgba(255,255,255,0.06)",
                  color: riskMode === r.id ? "white" : "rgba(255,255,255,0.5)",
                }}
              >
                <p className="text-sm font-semibold">{r.label}</p>
                <p className="mt-1 text-[10px] leading-4" style={{ color: riskMode === r.id ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.3)" }}>
                  {r.desc}
                </p>
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void loadExecutors()}
              disabled={loadingExecutors || !!executors.llm}
              className="rounded-xl border px-4 py-2 text-sm transition hover:bg-white/5 disabled:opacity-40"
              style={{ borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}
            >
              {executors.llm ? "Executors loaded ✓" : loadingExecutors ? "Loading…" : "Load Executors"}
            </button>
            <button
              type="button"
              onClick={savePortfolio}
              disabled={!address || !executors.llm || totalInvalid || isPending || confirming}
              className="rounded-xl px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: "#5B4FE8" }}
            >
              {confirming ? "Confirming…" : isPending ? "Check wallet…" : "Save Portfolio Onchain"}
            </button>
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <div className="space-y-4">
        {/* TEE Executor */}
        <div
          className="rounded-2xl border p-4"
          style={{ backgroundColor: "rgba(255,255,255,0.025)", borderColor: "rgba(0,200,150,0.2)" }}
        >
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)" }}>
            TEE Executor
          </p>
          {executors.llm ? (
            <div className="space-y-2">
              <div>
                <p className="font-mono text-[9px] uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>LLM</p>
                <p className="break-all font-mono text-[11px]" style={{ color: "#00C896" }}>{executors.llm}</p>
              </div>
              <div>
                <p className="font-mono text-[9px] uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>HTTP</p>
                <p className="break-all font-mono text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>{executors.http}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
              Click "Load Executors" to fetch TEE addresses
            </p>
          )}
        </div>

        {/* Safety Rules */}
        <div
          className="rounded-2xl border p-4"
          style={{ backgroundColor: "rgba(255,255,255,0.025)", borderColor: "rgba(255,255,255,0.06)" }}
        >
          <p className="mb-3 font-mono text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)" }}>
            Safety Rules
          </p>
          <ul className="space-y-2">
            {[
              "ethBps + wbtcBps + usdcBps ≤ 10000",
              "executor != address(0)",
              "httpExecutor != address(0)",
              "gasLimit >= 3,000,000",
              "schedulerTtl >= 300 blocks",
            ].map((r) => (
              <li key={r} className="flex items-start gap-2">
                <span style={{ color: "#00C896" }}>✓</span>
                <span className="font-mono text-[11px] leading-4" style={{ color: "rgba(255,255,255,0.4)" }}>
                  {r}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
