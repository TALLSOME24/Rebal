"use client";

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
    .slice(0, 5);
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

export function Yield() {
  const { data: pools, isLoading, isError, refetch } = useQuery({
    queryKey: ["defi-llama-aave"],
    queryFn: fetchAavePools,
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
    retry: 2,
  });

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <div
        className="grid grid-cols-2 overflow-hidden rounded-2xl lg:grid-cols-4"
        style={{ backgroundColor: "rgba(255,255,255,0.05)", gap: "1px" }}
      >
        {[
          { label: "Total Supplied", value: "$0.00", sub: "Aave not on Ritual yet" },
          { label: "Earned Today", value: "$0.00", sub: "Aave not on Ritual yet" },
          { label: "Total Earned", value: "$0.00", sub: "Aave not on Ritual yet" },
          { label: "Best APY (mainnet ref)", value: pools?.[0] ? `${pools[0].apy.toFixed(2)}%` : "…", sub: pools?.[0]?.symbol ?? "Aave V3" },
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
        <div className="mb-3 flex items-center justify-between gap-2">
          <Label>Live APY Monitor · Aave V3 · Mainnet Reference</Label>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isLoading}
            className="rounded-lg px-2.5 py-1 font-mono text-[10px] transition hover:bg-white/5"
            style={{ border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}
          >
            {isLoading ? "…" : "Refresh"}
          </button>
        </div>

        {isLoading ? (
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>Loading…</p>
        ) : isError ? (
          <div className="flex items-center gap-3">
            <p className="text-sm" style={{ color: "rgba(255,71,87,0.8)" }}>Failed to load APY data</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="rounded-lg px-2.5 py-1 text-xs transition hover:opacity-80"
              style={{ backgroundColor: "rgba(255,71,87,0.1)", color: "#FF4757", border: "1px solid rgba(255,71,87,0.2)" }}
            >
              Retry
            </button>
          </div>
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
          Via DefiLlama · refreshes every 5 min · mainnet rates shown for reference only
        </p>
      </Card>

      {/* Yield availability notice */}
      <Card>
        <Label>Yield on Ritual Chain</Label>
        <div
          className="rounded-xl border px-4 py-4"
          style={{ borderColor: "rgba(91,79,232,0.2)", backgroundColor: "rgba(91,79,232,0.05)" }}
        >
          <p className="text-sm font-semibold text-white">Coming when Aave V3 deploys on Ritual Chain mainnet</p>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
            Yield strategies will be available when Aave V3 deploys on Ritual Chain mainnet.
            Current APY data is shown for reference — these are mainnet Ethereum and Arbitrum rates.
          </p>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.4)" }}>
            Once live, the agent will automatically supply idle stablecoins to the highest-yielding
            Aave pool and rotate positions based on your yield settings below.
          </p>
        </div>
      </Card>

      {/* Yield Settings */}
      <Card>
        <Label>Yield Settings · Saved for when Aave deploys</Label>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Min APY threshold (%)", key: "minApy", defaultValue: "3" },
            { label: "Rotate below (%)", key: "rotateBelow", defaultValue: "1" },
            { label: "Max supply (%)", key: "maxSupply", defaultValue: "80" },
          ].map(({ label, key, defaultValue }) => (
            <label key={key} className="space-y-1">
              <span className="font-mono text-[10px] uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</span>
              <input
                type="number"
                defaultValue={defaultValue}
                onChange={(e) => {
                  if (typeof window !== "undefined") {
                    const stored = JSON.parse(localStorage.getItem("rebal-yield-settings") ?? "{}") as Record<string, string>;
                    stored[key] = e.target.value;
                    localStorage.setItem("rebal-yield-settings", JSON.stringify(stored));
                  }
                }}
                className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
                style={{ backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)", color: "white" }}
              />
            </label>
          ))}
        </div>
        <p className="mt-3 font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>
          Settings auto-save on change
        </p>
      </Card>
    </div>
  );
}
