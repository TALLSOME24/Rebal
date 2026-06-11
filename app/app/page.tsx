"use client";

import { Suspense, lazy } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Nav } from "@/components/Nav";
import { ChainGuard } from "@/components/ChainGuard";

const DashboardTab = lazy(() => import("@/components/tabs/Dashboard").then((m) => ({ default: m.Dashboard })));
const RebalanceTab = lazy(() => import("@/components/tabs/Rebalance").then((m) => ({ default: m.Rebalance })));
const AgentTab = lazy(() => import("@/components/tabs/Agent").then((m) => ({ default: m.Agent })));
const TokensTab = lazy(() => import("@/components/tabs/Tokens").then((m) => ({ default: m.Tokens })));
const YieldTab = lazy(() => import("@/components/tabs/Yield").then((m) => ({ default: m.Yield })));
const DexTab = lazy(() => import("@/components/tabs/Dex").then((m) => ({ default: m.Dex })));
const AccountsTab = lazy(() => import("@/components/tabs/Accounts").then((m) => ({ default: m.Accounts })));
const SettingsTab = lazy(() => import("@/components/tabs/Settings").then((m) => ({ default: m.Settings })));

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "rebalance", label: "Rebalance" },
  { id: "agent", label: "Agent" },
  { id: "tokens", label: "Tokens" },
  { id: "yield", label: "Yield", badge: "v2" },
  { id: "dex", label: "DEX", badge: "v2" },
  { id: "accounts", label: "Accounts", badge: "v2" },
  { id: "settings", label: "Settings" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const TAB_SPINNER = (
  <div className="flex h-40 items-center justify-center">
    <span
      className="h-6 w-6 animate-spin rounded-full border-2"
      style={{ borderColor: "#5B4FE8", borderTopColor: "transparent" }}
    />
  </div>
);

function TabContent({ tab }: { tab: TabId }) {
  switch (tab) {
    case "dashboard": return <Suspense fallback={TAB_SPINNER}><DashboardTab /></Suspense>;
    case "rebalance": return <Suspense fallback={TAB_SPINNER}><RebalanceTab /></Suspense>;
    case "agent": return <Suspense fallback={TAB_SPINNER}><AgentTab /></Suspense>;
    case "tokens": return <Suspense fallback={TAB_SPINNER}><TokensTab /></Suspense>;
    case "yield": return <Suspense fallback={TAB_SPINNER}><YieldTab /></Suspense>;
    case "dex": return <Suspense fallback={TAB_SPINNER}><DexTab /></Suspense>;
    case "accounts": return <Suspense fallback={TAB_SPINNER}><AccountsTab /></Suspense>;
    case "settings": return <Suspense fallback={TAB_SPINNER}><SettingsTab /></Suspense>;
    default: return null;
  }
}

function AppShell() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawTab = searchParams?.get("tab") ?? "dashboard";
  const activeTab = (TABS.find((t) => t.id === rawTab)?.id ?? "dashboard") as TabId;

  const setTab = (id: TabId) => {
    router.push(`/app?tab=${id}`, { scroll: false });
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "rgba(4,5,10,0.94)" }}>
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
              {"badge" in t && t.badge && (
                <span
                  className="rounded-full px-1.5 py-0.5 font-mono text-[9px] font-bold"
                  style={{ backgroundColor: "rgba(91,79,232,0.2)", color: "#5B4FE8" }}
                >
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab body */}
      <div className="mx-auto max-w-7xl px-4 py-6">
        <ChainGuard>
          <TabContent tab={activeTab} />
        </ChainGuard>
      </div>
    </div>
  );
}

export default function AppPage() {
  return (
    <Suspense>
      <AppShell />
    </Suspense>
  );
}
