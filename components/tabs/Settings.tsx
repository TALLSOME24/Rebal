"use client";

import { useState } from "react";
import { PORTFOLIO_AGENT, RITUAL_WALLET, SCHEDULER, HTTP_PRECOMPILE, LLM_PRECOMPILE, WETH, WBTC, USDC, USDT, CHAIN_ID } from "@/lib/constants";
import { useToast } from "@/components/Toast";

const NETWORK_DETAILS = [
  { k: "Chain ID", v: String(CHAIN_ID) },
  { k: "Network Name", v: "Ritual Chain" },
  { k: "Symbol", v: "RITUAL" },
  { k: "RPC URL", v: "https://rpc.ritualfoundation.org" },
  { k: "Explorer", v: "https://explorer.ritualfoundation.org" },
  { k: "Block time", v: "~350ms" },
] as const;

const CONTRACT_ADDRS = [
  { label: "PortfolioAgent", address: PORTFOLIO_AGENT },
  { label: "RitualWallet", address: RITUAL_WALLET },
  { label: "Scheduler", address: SCHEDULER },
  { label: "HTTP Precompile", address: HTTP_PRECOMPILE },
  { label: "LLM Precompile", address: LLM_PRECOMPILE },
  { label: "WETH", address: WETH },
  { label: "WBTC", address: WBTC },
  { label: "USDC", address: USDC },
  { label: "USDT", address: USDT },
] as const;

const ROADMAP = [
  {
    title: "DEX Integration",
    desc: "1inch & Uniswap swap execution onchain. Agent-triggered rebalance through best-price routing.",
    status: "In design ✓",
  },
  {
    title: "Yield Farming",
    desc: "Aave V3 supply/withdraw. Auto-compound idle stablecoins. APY-weighted allocation suggestions.",
    status: "In design ✓",
  },
  {
    title: "Smart Accounts",
    desc: "ERC-4337 session keys via Biconomy. Gasless rebalance transactions. Social recovery.",
    status: "In design ✓",
  },
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
    <p className="mb-3 font-mono text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)", letterSpacing: "1.4px" }}>
      {children}
    </p>
  );
}

export function Settings() {
  const { toast } = useToast();
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);

  const copy = (addr: string) => {
    void navigator.clipboard.writeText(addr).then(() => {
      setCopiedAddr(addr);
      toast("Address copied!", "success");
      setTimeout(() => setCopiedAddr(null), 2000);
    });
  };

  return (
    <div className="space-y-4">
      {/* Network */}
      <Card>
        <Label>Network Details</Label>
        <div className="space-y-2">
          {NETWORK_DETAILS.map(({ k, v }) => (
            <div key={k} className="flex items-center justify-between gap-4 border-b py-2 last:border-b-0" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
              <span className="font-mono text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>{k}</span>
              <span className="font-mono text-[11px] text-right" style={{ color: "rgba(255,255,255,0.75)" }}>{v}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Contracts */}
      <Card>
        <Label>Contract Addresses</Label>
        <div className="space-y-1.5">
          {CONTRACT_ADDRS.map(({ label, address }) => (
            <button
              key={address}
              type="button"
              onClick={() => copy(address)}
              className="flex w-full items-center justify-between rounded-xl border px-3 py-2 transition hover:bg-white/5"
              style={{ borderColor: "rgba(255,255,255,0.04)" }}
            >
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>{label}</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px]" style={{ color: copiedAddr === address ? "#00C896" : "rgba(255,255,255,0.55)" }}>
                  {copiedAddr === address ? "Copied!" : address}
                </span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: "rgba(255,255,255,0.2)" }}>
                  <rect x="1" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M4 4V2.5A1.5 1.5 0 015.5 1h4A1.5 1.5 0 0111 2.5v4A1.5 1.5 0 019.5 8H8" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              </div>
            </button>
          ))}
        </div>
      </Card>

      {/* Roadmap */}
      <Card>
        <Label>Roadmap</Label>
        <div className="grid gap-3 sm:grid-cols-3">
          {ROADMAP.map((r) => (
            <div
              key={r.title}
              className="rounded-xl border p-4"
              style={{ borderColor: "rgba(0,200,150,0.15)", backgroundColor: "rgba(0,200,150,0.03)" }}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-semibold text-white text-sm">{r.title}</p>
                <span
                  className="shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px]"
                  style={{ borderColor: "rgba(0,200,150,0.3)", color: "#00C896" }}
                >
                  {r.status}
                </span>
              </div>
              <p className="text-xs leading-5" style={{ color: "rgba(255,255,255,0.4)" }}>{r.desc}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
