"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

type AavePool = {
  pool: string;
  project: string;
  chain: string;
  symbol: string;
  apy: number;
};

async function fetchAavePools(): Promise<AavePool[]> {
  const res = await fetch("https://yields.llama.fi/pools");
  if (!res.ok) throw new Error("DefiLlama fetch failed");
  const data = (await res.json()) as { data: Array<{ pool: string; project: string; chain: string; symbol: string; apy: number }> };
  return data.data
    .filter(
      (p) =>
        p.project === "aave-v3" &&
        (p.chain === "Ethereum" || p.chain === "Arbitrum") &&
        (p.symbol.includes("USDC") || p.symbol.includes("USDT"))
    )
    .sort((a, b) => b.apy - a.apy)
    .slice(0, 3);
}

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

function ComingSoonOverlay() {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center rounded-2xl"
      style={{ backgroundColor: "rgba(4,5,8,0.75)", backdropFilter: "blur(4px)" }}
    >
      <div className="text-center">
        <p
          className="rounded-full border px-4 py-1.5 font-mono text-xs"
          style={{ borderColor: "rgba(91,79,232,0.3)", color: "#5B4FE8", backgroundColor: "rgba(91,79,232,0.1)" }}
        >
          Coming in next release
        </p>
      </div>
    </div>
  );
}

export function Yield() {
  const [minApy, setMinApy] = useState("3");
  const [rotateBelow, setRotateBelow] = useState("1");
  const [maxSupply, setMaxSupply] = useState("80");

  const { data: pools, isLoading } = useQuery({
    queryKey: ["defi-llama-aave"],
    queryFn: fetchAavePools,
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
    retry: 1,
  });

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <div
        className="grid grid-cols-2 overflow-hidden rounded-2xl lg:grid-cols-4"
        style={{ backgroundColor: "rgba(255,255,255,0.05)", gap: "1px" }}
      >
        {[
          { label: "Total Supplied", value: "$0.00", sub: "Coming soon" },
          { label: "Earned Today", value: "$0.00", sub: "Coming soon" },
          { label: "Total Earned", value: "$0.00", sub: "Coming soon" },
          { label: "Best APY", value: pools?.[0] ? `${pools[0].apy.toFixed(2)}%` : "…", sub: pools?.[0]?.symbol ?? "Aave V3" },
        ].map(({ label, value, sub }) => (
          <div key={label} className="px-4 py-3" style={{ backgroundColor: "rgba(4,5,10,0.7)" }}>
            <p className="font-mono text-[10px] uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>{label}</p>
            <p className="mt-0.5 font-mono text-sm font-semibold" style={{ color: "#D4A847" }}>{value}</p>
            <p className="font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* Live APY Monitor */}
      <Card>
        <Label>Live APY Monitor · Aave V3</Label>
        {isLoading ? (
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>Loading…</p>
        ) : !pools?.length ? (
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>No pools found</p>
        ) : (
          <div className="space-y-2">
            {pools.map((p) => (
              <div
                key={p.pool}
                className="flex items-center justify-between rounded-xl border px-3 py-2"
                style={{ borderColor: "rgba(255,255,255,0.05)" }}
              >
                <div>
                  <p className="text-sm font-semibold text-white">{p.project} · {p.symbol}</p>
                  <p className="font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>{p.chain}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-semibold" style={{ color: "#00C896" }}>{p.apy.toFixed(2)}%</p>
                  <p className="font-mono text-[9px] uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>APY</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>
          Via DefiLlama · refreshes every 5 min
        </p>
      </Card>

      {/* Aave V3 Positions (coming soon overlay) */}
      <div className="relative">
        <Card>
          <Label>Aave V3 Positions</Label>
          <div className="grid gap-4 sm:grid-cols-2">
            {["USDC", "USDT"].map((sym) => (
              <div key={sym} className="rounded-xl border p-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                <p className="font-semibold text-white">{sym}</p>
                <p className="mt-1 font-mono text-2xl text-white">$0.00</p>
                <div className="mt-3 flex gap-2">
                  <button className="flex-1 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)" }}>Supply</button>
                  <button className="flex-1 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)" }}>Withdraw</button>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <ComingSoonOverlay />
      </div>

      {/* Yield Settings */}
      <Card>
        <Label>Yield Settings</Label>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Min APY threshold (%)", value: minApy, set: setMinApy },
            { label: "Rotate below (%)", value: rotateBelow, set: setRotateBelow },
            { label: "Max supply (%)", value: maxSupply, set: setMaxSupply },
          ].map(({ label, value, set }) => (
            <label key={label} className="space-y-1">
              <span className="font-mono text-[10px] uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</span>
              <input
                type="number"
                value={value}
                onChange={(e) => set(e.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
                style={{ backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)", color: "white" }}
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem("rebal-yield-settings", JSON.stringify({ minApy, rotateBelow, maxSupply }));
            alert("Settings saved to localStorage");
          }}
          className="mt-4 rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
          style={{ backgroundColor: "#5B4FE8" }}
        >
          Save Settings
        </button>
      </Card>

      {/* Yield History placeholder */}
      <Card>
        <Label>Yield History</Label>
        <div className="space-y-2">
          {[
            { date: "2026-06-10", action: "Supply USDC", amount: "$500.00", apy: "4.2%" },
            { date: "2026-06-08", action: "Harvest USDT", amount: "$2.15", apy: "3.8%" },
          ].map((r) => (
            <div
              key={r.date + r.action}
              className="flex items-center justify-between rounded-xl border px-3 py-2"
              style={{ borderColor: "rgba(255,255,255,0.05)" }}
            >
              <div>
                <p className="text-sm text-white">{r.action}</p>
                <p className="font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>{r.date}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm text-white">{r.amount}</p>
                <p className="font-mono text-[10px]" style={{ color: "#D4A847" }}>{r.apy}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
