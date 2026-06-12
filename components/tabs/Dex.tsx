"use client";

import { useRouter } from "next/navigation";
import { useTickEvents } from "@/hooks/useTickEvents";
import type { Address } from "viem";

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

export function Dex({ agentAddress }: { agentAddress: Address }) {
  const router = useRouter();
  const { events } = useTickEvents(agentAddress);

  const swapEvents = events.filter((e) => !e.headline.toLowerCase().includes("hold"));

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <div
        className="grid grid-cols-2 overflow-hidden rounded-2xl lg:grid-cols-4"
        style={{ backgroundColor: "rgba(255,255,255,0.05)", gap: "1px" }}
      >
        {[
          { label: "Total Swapped", value: "$0.00" },
          { label: "Last Swap", value: swapEvents[0] ? `Block ${swapEvents[0].blockNumber}` : "—" },
          { label: "Avg Slippage", value: "—" },
          { label: "Agent Swaps", value: String(swapEvents.length) },
        ].map(({ label, value }) => (
          <div key={label} className="px-4 py-3" style={{ backgroundColor: "rgba(4,5,10,0.7)" }}>
            <p className="font-mono text-[10px] uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>{label}</p>
            <p className="mt-0.5 font-mono text-sm font-semibold text-white">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* How swaps work */}
        <div className="space-y-4">
          <Card>
            <Label>Swap Execution</Label>
            <div
              className="rounded-xl border px-4 py-4"
              style={{ borderColor: "rgba(91,79,232,0.2)", backgroundColor: "rgba(91,79,232,0.05)" }}
            >
              <p className="text-sm font-semibold text-white">Handled automatically by the onchain agent</p>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
                Swaps are executed automatically by the onchain agent. Set your target allocation in the
                Rebalance tab and the agent will handle execution on the next tick.
              </p>
              <p className="mt-3 text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.4)" }}>
                1inch and Uniswap are not deployed on Ritual Chain 1979. Swap execution runs directly
                through the PortfolioAgent contract during scheduled rebalance ticks.
              </p>
            </div>

            <div
              className="mt-3 rounded-xl border px-3 py-2"
              style={{ borderColor: "rgba(255,255,255,0.05)", backgroundColor: "rgba(255,255,255,0.02)" }}
            >
              <p className="font-mono text-[10px] uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>How it works</p>
              <ol className="mt-2 space-y-1.5">
                {[
                  "Set target allocation percentages in the Rebalance tab",
                  "Agent fetches live prices on each HTTP tick",
                  "LLM tick decides whether to rebalance based on drift",
                  "PortfolioAgent executes swaps to reach target allocation",
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>
                    <span className="shrink-0 font-mono text-[10px] mt-0.5" style={{ color: "#5B4FE8" }}>{i + 1}.</span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>

            <button
              type="button"
              onClick={() => router.push("/app?tab=rebalance")}
              className="mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
              style={{ backgroundColor: "#5B4FE8" }}
            >
              Go to Rebalance →
            </button>
          </Card>

          {/* Swap History */}
          <Card>
            <Label>Swap History · Agent Executed</Label>
            {swapEvents.length === 0 ? (
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
                No agent swaps yet. Rebalance events will appear here once the agent executes trades.
              </p>
            ) : (
              <div className="space-y-2">
                {swapEvents.slice(0, 5).map((e, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl border px-3 py-2" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                    <div>
                      <p className="text-sm text-white">{e.headline}</p>
                      {e.reason && (
                        <p className="font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>{e.reason.slice(0, 80)}</p>
                      )}
                    </div>
                    <p className="shrink-0 font-mono text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>Block {String(e.blockNumber)}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Safety Rules */}
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
                <span className="font-mono text-[10px] uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>Min swap size ($)</span>
                <input
                  type="number"
                  defaultValue="10"
                  onChange={(e) => {
                    if (typeof window !== "undefined") localStorage.setItem("rebal-min-swap", e.target.value);
                  }}
                  className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
                  style={{ backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)", color: "white" }}
                />
              </label>
              <label className="space-y-1">
                <span className="font-mono text-[10px] uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>Max slippage (%)</span>
                <input
                  type="number"
                  defaultValue="1"
                  step="0.1"
                  onChange={(e) => {
                    if (typeof window !== "undefined") localStorage.setItem("rebal-max-slippage", e.target.value);
                  }}
                  className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
                  style={{ backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)", color: "white" }}
                />
              </label>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
