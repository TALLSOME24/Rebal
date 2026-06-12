"use client";

import { useAccount, useReadContract } from "wagmi";
import { formatEther } from "viem";
import { portfolioAgentABI } from "@/lib/abi/portfolioAgentABI";
import { PORTFOLIO_AGENT, WETH, WBTC, USDC, USDT } from "@/lib/constants";
import { usePortfolioValue } from "@/hooks/usePortfolioValue";
import { useAgentState } from "@/hooks/useAgentState";
import { useTickEvents, type TickEvent } from "@/hooks/useTickEvents";
import { usePrices } from "@/hooks/usePrices";
import { useRouter } from "next/navigation";

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

function Card({ children, style, className = "" }: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  return (
    <div
      className={`rounded-2xl border p-4 ${className}`}
      style={{
        backgroundColor: "rgba(255,255,255,0.025)",
        borderColor: "rgba(255,255,255,0.06)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mb-1 font-mono text-[10px] uppercase tracking-widest"
      style={{ color: "rgba(255,255,255,0.25)", letterSpacing: "1.4px" }}
    >
      {children}
    </p>
  );
}

function StatCell({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="px-4 py-3">
      <Label>{label}</Label>
      <p className="font-mono text-sm font-semibold" style={{ color: color ?? "white" }}>
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 60 ? "#00C896" : "#5B4FE8";
  return (
    <div className="mt-1 h-[3px] overflow-hidden rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.07)" }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, backgroundColor: color }} />
    </div>
  );
}

function DecisionCard({ event }: { event: TickEvent }) {
  const isHold = event.headline.toLowerCase().includes("hold");
  const isFailed = event.type === "failed";
  const borderColor = isFailed
    ? "rgba(255,71,87,0.2)"
    : isHold
    ? "rgba(255,255,255,0.08)"
    : "rgba(91,79,232,0.25)";
  const iconColor = isFailed ? "#FF4757" : isHold ? "rgba(255,255,255,0.3)" : "#5B4FE8";

  return (
    <div
      className="rounded-xl border p-3"
      style={{ backgroundColor: "rgba(255,255,255,0.02)", borderColor }}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-base" style={{ color: iconColor }}>
          {isFailed ? "✕" : isHold ? "⏸" : "⟳"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">{event.headline}</p>
          {event.reason && (
            <p className="mt-1 text-xs leading-5" style={{ color: "rgba(255,255,255,0.4)" }}>
              {event.reason.slice(0, 150)}
            </p>
          )}
          <div className="mt-2 flex items-center gap-3">
            <ConfidenceBar value={event.confidence} />
            <span className="shrink-0 font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
              Block {String(event.blockNumber)}
            </span>
            {event.protocol && (
              <span
                className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px]"
                style={{ backgroundColor: "rgba(91,79,232,0.15)", color: "#5B4FE8" }}
              >
                {event.protocol}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const router = useRouter();
  const { address } = useAccount();
  const { totalValue, loading: pvLoading } = usePortfolioValue();
  const agentState = useAgentState();
  const { events, refresh: refreshEvents, loading: eventsLoading } = useTickEvents();
  const { ethPrice, btcPrice, lastUpdated } = usePrices();

  // RitualWallet balance on agent contract
  const { data: ritualBal } = useReadContract({
    address: PORTFOLIO_AGENT,
    abi: portfolioAgentABI,
    functionName: "contractRitualBalance",
    query: { refetchInterval: 12_000 },
  });

  const ritualBalEth = ritualBal ? Number(formatEther(ritualBal as bigint)) : 0;
  const ticksLeft = ritualBal ? Math.floor(Number(formatEther(ritualBal as bigint)) / 0.01) : 0;

  const allocationTotal = agentState.ethBps + agentState.wbtcBps + agentState.usdcBps;
  const usdtBps = Math.max(0, 10000 - allocationTotal);

  const allocationTokens = [
    { label: "WETH", bps: agentState.ethBps, color: "#5B4FE8", address: WETH },
    { label: "WBTC", bps: agentState.wbtcBps, color: "#D4A847", address: WBTC },
    { label: "USDC", bps: agentState.usdcBps, color: "#00C896", address: USDC },
    { label: "USDT", bps: usdtBps, color: "rgba(255,255,255,0.3)", address: USDT },
  ];

  const lastUpdatedText = lastUpdated
    ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "--";

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <div
        className="grid grid-cols-2 overflow-hidden rounded-2xl lg:grid-cols-4"
        style={{ backgroundColor: "rgba(255,255,255,0.05)", gap: "1px" }}
      >
        {[
          {
            label: "Total Value",
            value: pvLoading ? "…" : USD.format(totalValue),
            sub: `live · CoinGecko · ${lastUpdatedText}`,
            color: "#00C896",
          },
          {
            label: "RitualWallet",
            value: `${ritualBalEth.toFixed(4)} RITUAL`,
            sub: `~${ticksLeft} ticks left`,
            color: "white",
          },
          {
            label: "Yield Earned",
            value: "$0.00",
            sub: "Aave not deployed",
            color: "#D4A847",
          },
          {
            label: "Agent Status",
            value: agentState.registered ? "Running" : "Not started",
            sub: agentState.registered ? `Schedule ${String(agentState.scheduleId).slice(0, 8)}` : "Register to activate",
            color: agentState.registered ? "#00C896" : "rgba(255,255,255,0.4)",
          },
        ].map((s) => (
          <div key={s.label} style={{ backgroundColor: "rgba(4,5,10,0.7)" }}>
            <StatCell {...s} />
          </div>
        ))}
      </div>

      {/* Main grid */}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Left column */}
        <div className="space-y-4">
          {/* Allocation */}
          <Card>
            <Label>Allocation</Label>
            {agentState.registered ? (
              <div className="mt-3 space-y-2">
                {/* Color bar */}
                <div className="flex h-2 overflow-hidden rounded-full">
                  {allocationTokens.map((t) => (
                    <div
                      key={t.label}
                      style={{ width: `${t.bps / 100}%`, backgroundColor: t.color }}
                      title={`${t.label}: ${t.bps / 100}%`}
                    />
                  ))}
                </div>
                {allocationTokens.map((t) => (
                  <div key={t.label} className="flex items-center justify-between gap-2 py-1">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                      <span className="text-sm text-white">{t.label}</span>
                      <span className="font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                        {t.address.slice(0, 6)}…{t.address.slice(-4)}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>
                        {(t.bps / 100).toFixed(1)}%
                      </span>
                      <span className="ml-2 font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                        {t.bps} bps
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
                No portfolio registered. Go to Rebalance to set targets.
              </p>
            )}
          </Card>

          {/* Agent Decisions */}
          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <Label>Agent Decisions</Label>
              <button
                type="button"
                onClick={() => void refreshEvents()}
                className="rounded-lg px-2.5 py-1 font-mono text-[10px] transition hover:bg-white/5"
                style={{ borderColor: "rgba(255,255,255,0.08)", border: "1px solid" }}
                disabled={eventsLoading}
              >
                {eventsLoading ? "…" : "Refresh"}
              </button>
            </div>
            {events.length === 0 ? (
              <div
                className="rounded-xl border py-8 text-center"
                style={{ borderColor: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.3)" }}
              >
                <p className="text-sm">No decisions yet</p>
                <p className="mt-1 font-mono text-[10px]">Waiting for agent ticks to settle on-chain</p>
              </div>
            ) : (
              <div className="space-y-2">
                {events.slice(0, 3).map((e, i) => (
                  <DecisionCard key={`${e.txHash}-${i}`} event={e} />
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* TEE Attestation */}
          <Card style={{ borderColor: "rgba(0,200,150,0.2)" }}>
            <Label>TEE Attestation</Label>
            <div className="mt-2">
              {agentState.executor ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold" style={{ color: "#00C896" }}>
                      Verified ✓
                    </span>
                  </div>
                  <p
                    className="mt-1 break-all font-mono text-[11px]"
                    style={{ color: "rgba(255,255,255,0.5)" }}
                  >
                    {agentState.executor}
                  </p>
                </>
              ) : (
                <p className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
                  Waiting for first tick
                </p>
              )}
            </div>
          </Card>

          {/* On-chain State */}
          <Card>
            <Label>On-chain State</Label>
            <div className="mt-2 space-y-1.5">
              {[
                { k: "registered", v: String(agentState.registered) },
                { k: "riskMode", v: ["Conservative", "Balanced", "Aggressive"][agentState.riskMode] ?? String(agentState.riskMode) },
                { k: "scheduleId", v: String(agentState.scheduleId).slice(0, 12) + "…" },
                { k: "tickIndex", v: String(agentState.tickIndex) },
                { k: "lastCycleId", v: String(agentState.lastCycleId) },
                { k: "executor", v: agentState.executor ? `${agentState.executor.slice(0, 8)}…` : "—" },
              ].map(({ k, v }) => (
                <div key={k} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                    {k}
                  </span>
                  <span className="font-mono text-[11px]" style={{ color: "rgba(255,255,255,0.75)" }}>
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {/* Quick Actions */}
          <Card>
            <Label>Quick Actions</Label>
            <div className="mt-2 space-y-2">
              {[
                { label: "Edit Allocation", tab: "rebalance" },
                { label: "Manage Agent", tab: "agent" },
                { label: "View Yield", tab: "yield" },
                { label: "Claim Tokens", tab: "tokens" },
              ].map(({ label, tab }) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => router.push(`/app?tab=${tab}`)}
                  className="w-full rounded-xl border px-3 py-2 text-left text-sm transition hover:bg-white/5"
                  style={{
                    borderColor: "rgba(255,255,255,0.06)",
                    color: "rgba(255,255,255,0.6)",
                  }}
                >
                  {label} →
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
