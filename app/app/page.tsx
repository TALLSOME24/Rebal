"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Nav } from "@/components/Nav";
import { ChainGuard } from "@/components/ChainGuard";

// Direct static imports — React.lazy causes blank renders in Next.js App Router SSR
import { Dashboard } from "@/components/tabs/Dashboard";
import { Rebalance } from "@/components/tabs/Rebalance";
import { Agent } from "@/components/tabs/Agent";
import { Tokens } from "@/components/tabs/Tokens";
import { Yield } from "@/components/tabs/Yield";
import { Dex } from "@/components/tabs/Dex";
import { Accounts } from "@/components/tabs/Accounts";
import { Settings } from "@/components/tabs/Settings";

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

function TabContent({ tab }: { tab: TabId }) {
  switch (tab) {
    case "dashboard":  return <Dashboard />;
    case "rebalance":  return <Rebalance />;
    case "agent":      return <Agent />;
    case "tokens":     return <Tokens />;
    case "yield":      return <Yield />;
    case "dex":        return <Dex />;
    case "accounts":   return <Accounts />;
    case "settings":   return <Settings />;
    default:           return <Dashboard />;
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

// Suspense wraps AppShell so useSearchParams() can suspend without breaking the page
export default function AppPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <span
            className="h-8 w-8 animate-spin rounded-full border-2"
            style={{ borderColor: "#5B4FE8", borderTopColor: "transparent" }}
          />
        </div>
      }
    >
      <AppShell />
    </Suspense>
  );
}
