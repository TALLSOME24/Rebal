"use client";

import { useState } from "react";
import { useTickEvents } from "@/hooks/useTickEvents";
import { WETH, WBTC, USDC, USDT } from "@/lib/constants";

const TOKENS = [
  { key: "WETH", address: WETH, label: "WETH", decimals: 18 },
  { key: "WBTC", address: WBTC, label: "WBTC", decimals: 8 },
  { key: "USDC", address: USDC, label: "USDC", decimals: 6 },
  { key: "USDT", address: USDT, label: "USDT", decimals: 6 },
] as const;

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

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

export function Dex() {
  const [fromToken, setFromToken] = useState("WETH");
  const [toToken, setToToken] = useState("USDC");
  const [amount, setAmount] = useState("");
  const { events } = useTickEvents();

  // Swap history from events (PortfolioAgent doesn't have SwapExecuted yet — show empty)
  const swapEvents: typeof events = [];

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <div
        className="grid grid-cols-2 overflow-hidden rounded-2xl lg:grid-cols-4"
        style={{ backgroundColor: "rgba(255,255,255,0.05)", gap: "1px" }}
      >
        {[
          { label: "Total Swapped", value: "$0.00" },
          { label: "Last Swap", value: "—" },
          { label: "Avg Slippage", value: "—" },
          { label: "Best Route", value: "—" },
        ].map(({ label, value }) => (
          <div key={label} className="px-4 py-3" style={{ backgroundColor: "rgba(4,5,10,0.7)" }}>
            <p className="font-mono text-[10px] uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>{label}</p>
            <p className="mt-0.5 font-mono text-sm font-semibold text-white">{value}</p>
          </div>
        ))}
      </div>

      {/* Testnet banner */}
      <div
        className="flex items-center gap-3 rounded-2xl border px-4 py-3"
        style={{ backgroundColor: "rgba(212,168,71,0.06)", borderColor: "rgba(212,168,71,0.2)" }}
      >
        <span style={{ color: "#D4A847" }}>⚠</span>
        <p className="text-sm" style={{ color: "rgba(212,168,71,0.85)" }}>
          Testnet: swap execution not yet available on Ritual Chain 1979. Route preview shows 1inch data when available.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Manual Swap Card */}
        <Card>
          <Label>Manual Swap</Label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>From</span>
              <select
                value={fromToken}
                onChange={(e) => setFromToken(e.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
                style={{ backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)", color: "white" }}
              >
                {TOKENS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>To</span>
              <select
                value={toToken}
                onChange={(e) => setToToken(e.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
                style={{ backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)", color: "white" }}
              >
                {TOKENS.filter((t) => t.key !== fromToken).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </label>
          </div>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount"
            className="mt-3 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
            style={{ backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)", color: "white" }}
          />

          {/* Route preview */}
          <div
            className="mt-3 rounded-xl border px-3 py-2"
            style={{ borderColor: "rgba(255,255,255,0.05)", backgroundColor: "rgba(255,255,255,0.02)" }}
          >
            <p className="font-mono text-[10px] uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>Route Preview</p>
            <p className="mt-1 text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
              Route preview not available on testnet (chain 1979 not supported by 1inch v6)
            </p>
          </div>

          <button
            type="button"
            disabled
            className="mt-3 w-full rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-40"
            style={{ backgroundColor: "#5B4FE8", color: "white" }}
            title="Not available on testnet"
          >
            Execute Swap (coming in next release)
          </button>
        </Card>

        {/* Safety Rules + DEX Settings */}
        <div className="space-y-4">
          <Card>
            <Label>Safety Rules</Label>
            <ul className="space-y-2">
              {[
                "Minimum swap size enforced",
                "Slippage capped at 1% default",
                "No swaps if portfolio at target",
                "Gas cost must be covered",
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
            <Label>DEX Settings</Label>
            <div className="space-y-3">
              <label className="space-y-1">
                <span className="font-mono text-[10px] uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>Preferred DEX</span>
                <select
                  defaultValue="1inch"
                  onChange={(e) => localStorage.setItem("rebal-dex", e.target.value)}
                  className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
                  style={{ backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)", color: "white" }}
                >
                  <option value="1inch">1inch</option>
                  <option value="uniswap">Uniswap</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="font-mono text-[10px] uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>Min swap size ($)</span>
                <input
                  type="number"
                  defaultValue="10"
                  onChange={(e) => localStorage.setItem("rebal-min-swap", e.target.value)}
                  className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
                  style={{ backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)", color: "white" }}
                />
              </label>
            </div>
          </Card>
        </div>
      </div>

      {/* Swap History */}
      <Card>
        <Label>Swap History</Label>
        {swapEvents.length === 0 ? (
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
            No swaps executed yet. SwapExecuted events will appear here once the agent performs trades.
          </p>
        ) : (
          <div className="space-y-2">
            {swapEvents.map((e, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl border px-3 py-2" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                <p className="text-sm text-white">{e.headline}</p>
                <p className="font-mono text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>Block {String(e.blockNumber)}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
