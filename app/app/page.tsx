"use client";

import { Suspense, Component, type ReactNode } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { type Address } from "viem";
import { Nav } from "@/components/Nav";
import { DeployAgent } from "@/components/DeployAgent";
import { useUserAgent } from "@/hooks/useUserAgent";

// Direct static imports — React.lazy causes blank renders in Next.js App Router SSR
import { Dashboard } from "@/components/tabs/Dashboard";
import { Rebalance } from "@/components/tabs/Rebalance";
import { Agent } from "@/components/tabs/Agent";
import { Tokens } from "@/components/tabs/Tokens";
import { Dex } from "@/components/tabs/Dex";
import { Settings } from "@/components/tabs/Settings";

class TabErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
          <p className="font-mono text-sm text-red-400">Tab render error: {this.state.error.message}</p>
          <pre className="mt-2 overflow-auto font-mono text-[10px] text-red-300/60">{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "rebalance", label: "Rebalance" },
  { id: "agent",     label: "Agent" },
  { id: "tokens",    label: "Tokens" },
  { id: "dex",       label: "DEX" },
  { id: "settings",  label: "Settings" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function TabContent({ tab, agentAddress }: { tab: TabId; agentAddress: Address }) {
  switch (tab) {
    case "dashboard": return <Dashboard agentAddress={agentAddress} />;
    case "rebalance": return <Rebalance agentAddress={agentAddress} />;
    case "agent":     return <Agent     agentAddress={agentAddress} />;
    case "tokens":    return <Tokens    agentAddress={agentAddress} />;
    case "dex":       return <Dex       agentAddress={agentAddress} />;
    case "settings":  return <Settings  agentAddress={agentAddress} />;
    default:          return <Dashboard agentAddress={agentAddress} />;
  }
}

const BG = { backgroundColor: "rgba(4,5,10,0.94)" } as const;
const SPINNER = (
  <span
    className="h-8 w-8 animate-spin rounded-full border-2"
    style={{ borderColor: "#5B4FE8", borderTopColor: "transparent" }}
  />
);

function AppShell() {
  const { address } = useAccount();
  const { agentAddress, hasAgent, isLoading, deployAgent, deployPending, deployConfirming, deploySuccess } =
    useUserAgent(address);

  const searchParams = useSearchParams();
  const router = useRouter();
  const rawTab = searchParams?.get("tab") ?? "dashboard";
  const activeTab = (TABS.find((t) => t.id === rawTab)?.id ?? "dashboard") as TabId;
  const setTab = (id: TabId) => router.push(`/app?tab=${id}`, { scroll: false });

  // ── Not connected ────────────────────────────────────────────────────────
  if (!address) {
    return (
      <div className="min-h-screen" style={BG}>
        <Nav variant="app" />
        <div className="flex min-h-[80vh] items-center justify-center">
          <div className="text-center">
            <p className="text-lg font-semibold text-white">Connect your wallet to get started</p>
            <p className="mt-2 text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
              Use the connect button in the top right.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Checking chain state ─────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={BG}>
        {SPINNER}
      </div>
    );
  }

  // ── No agent yet — onboarding ─────────────────────────────────────────────
  if (!hasAgent) {
    return (
      <div className="min-h-screen" style={BG}>
        <Nav variant="app" />
        <DeployAgent
          deployAgent={deployAgent}
          deployPending={deployPending}
          deployConfirming={deployConfirming}
          deploySuccess={deploySuccess}
          agentAddress={agentAddress}
        />
      </div>
    );
  }

  // ── Normal app ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={BG}>
      <Nav variant="app" />

      {/* Tab strip */}
      <div
        className="sticky top-[52px] z-30 border-b"
        style={{
          backgroundColor: "rgba(4,5,10,0.97)",
          borderColor: "rgba(255,255,255,0.06)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="mx-auto flex max-w-7xl overflow-x-auto px-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-3 text-sm transition"
              style={{
                borderColor: activeTab === t.id ? "#5B4FE8" : "transparent",
                color: activeTab === t.id ? "white" : "rgba(255,255,255,0.4)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab body */}
      <div className="mx-auto max-w-7xl px-4 py-6">
        <TabErrorBoundary>
          <TabContent tab={activeTab} agentAddress={agentAddress!} />
        </TabErrorBoundary>
      </div>
    </div>
  );
}

export default function AppPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          {SPINNER}
        </div>
      }
    >
      <AppShell />
    </Suspense>
  );
}
