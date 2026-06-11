"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Logo } from "./Logo";

type NavVariant = "home" | "app";

function PulsingDot({ color = "green" }: { color?: "green" | "gold" }) {
  const c = color === "green" ? "#00C896" : "#D4A847";
  return (
    <span
      className="relative inline-flex h-2 w-2 rounded-full shrink-0"
      style={{ backgroundColor: c }}
    >
      <span
        className="absolute inset-0 rounded-full animate-ping opacity-60"
        style={{ backgroundColor: c }}
      />
    </span>
  );
}

function RitualPill() {
  return (
    <div
      className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-mono"
      style={{ borderColor: "rgba(212,168,71,0.3)", color: "#D4A847", backgroundColor: "rgba(212,168,71,0.07)" }}
    >
      <PulsingDot color="gold" />
      Ritual Chain · 1979
    </div>
  );
}

function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <button
        type="button"
        onClick={() => disconnect()}
        className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-mono transition hover:opacity-80"
        style={{
          borderColor: "rgba(91,79,232,0.3)",
          color: "rgba(255,255,255,0.7)",
          backgroundColor: "rgba(91,79,232,0.08)",
        }}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-green" />
        {`${address.slice(0, 6)}…${address.slice(-4)}`}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={isPending || !connectors[0]}
      onClick={() => connect({ connector: connectors[0] })}
      className="rounded-full px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
      style={{ backgroundColor: "#5B4FE8" }}
    >
      {isPending ? "Connecting…" : "Connect Wallet"}
    </button>
  );
}

const NAV_LINKS_HOME = [
  { label: "Home", href: "/" },
  { label: "Dashboard", href: "/app?tab=dashboard" },
  { label: "Rebalance", href: "/app?tab=rebalance" },
  { label: "Agent", href: "/app?tab=agent", badge: "Live" },
] as const;

const NAV_LINKS_APP = [
  { label: "Dashboard", tab: "dashboard" },
  { label: "Rebalance", tab: "rebalance" },
  { label: "Agent", tab: "agent", badge: "Live" },
  { label: "Tokens", tab: "tokens" },
] as const;

const MORE_ITEMS = [
  { label: "Yield", tab: "yield", badge: "v2" },
  { label: "DEX", tab: "dex", badge: "v2" },
  { label: "Accounts", tab: "accounts", badge: "v2" },
  null,
  { label: "Settings", tab: "settings" },
  { label: "Docs", href: "https://docs.ritual.net", external: true },
  { label: "Explorer", href: "https://explorer.ritualfoundation.org", external: true },
] as const;

export function Nav({ variant }: { variant: NavVariant }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = searchParams?.get("tab") ?? "dashboard";
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const navBg =
    variant === "home"
      ? "bg-transparent"
      : "border-b"

  const positionClass = variant === "home" ? "relative" : "sticky top-0 z-40";

  return (
    <nav
      className={`${positionClass} w-full ${navBg}`}
      style={
        variant === "app"
          ? {
              backgroundColor: "rgba(4,5,10,0.95)",
              borderColor: "rgba(255,255,255,0.06)",
              backdropFilter: "blur(12px)",
            }
          : undefined
      }
    >
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
        {/* Logo + wordmark */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Logo size="nav" />
          <span className="text-base font-semibold tracking-tight text-white">rebal</span>
        </Link>

        {/* Center links */}
        <div className="hidden flex-1 items-center justify-center gap-1 md:flex">
          {variant === "home"
            ? NAV_LINKS_HOME.map((link) => {
                const isActive = link.href === "/" ? pathname === "/" : pathname?.startsWith("/app") && link.href.startsWith("/app");
                return (
                  <Link
                    key={link.label}
                    href={link.href}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition"
                    style={{
                      color: isActive ? "white" : "rgba(255,255,255,0.45)",
                      backgroundColor: isActive ? "rgba(255,255,255,0.06)" : undefined,
                    }}
                  >
                    {link.label}
                    {"badge" in link && link.badge === "Live" && (
                      <span
                        className="flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase"
                        style={{ backgroundColor: "rgba(0,200,150,0.15)", color: "#00C896" }}
                      >
                        <PulsingDot />
                        Live
                      </span>
                    )}
                  </Link>
                );
              })
            : NAV_LINKS_APP.map((link) => {
                const isActive = activeTab === link.tab;
                return (
                  <Link
                    key={link.label}
                    href={`/app?tab=${link.tab}`}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition"
                    style={{
                      color: isActive ? "white" : "rgba(255,255,255,0.45)",
                      backgroundColor: isActive ? "rgba(91,79,232,0.12)" : undefined,
                    }}
                  >
                    {link.label}
                    {"badge" in link && link.badge === "Live" && (
                      <span
                        className="flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase"
                        style={{ backgroundColor: "rgba(0,200,150,0.15)", color: "#00C896" }}
                      >
                        <PulsingDot />
                        Live
                      </span>
                    )}
                  </Link>
                );
              })}

          {/* More dropdown (app only) */}
          {variant === "app" && (
            <div className="relative" ref={moreRef}>
              <button
                type="button"
                onClick={() => setMoreOpen((o) => !o)}
                className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm transition"
                style={{ color: "rgba(255,255,255,0.45)" }}
              >
                More
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                </svg>
              </button>
              {moreOpen && (
                <div
                  className="absolute left-0 top-full mt-1 w-44 rounded-xl border py-1 shadow-xl"
                  style={{
                    backgroundColor: "#0F0E1A",
                    borderColor: "rgba(255,255,255,0.08)",
                    backdropFilter: "blur(16px)",
                  }}
                >
                  {MORE_ITEMS.map((item, i) => {
                    if (item === null) {
                      return <div key={`divider-${i}`} className="my-1 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }} />;
                    }
                    if ("external" in item && item.external) {
                      return (
                        <a
                          key={item.label}
                          href={item.href}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between px-3 py-1.5 text-sm transition hover:bg-white/5"
                          style={{ color: "rgba(255,255,255,0.5)" }}
                          onClick={() => setMoreOpen(false)}
                        >
                          {item.label}
                          <span style={{ fontSize: 10 }}>↗</span>
                        </a>
                      );
                    }
                    if ("tab" in item) {
                      return (
                        <Link
                          key={item.label}
                          href={`/app?tab=${item.tab}`}
                          className="flex items-center justify-between px-3 py-1.5 text-sm transition hover:bg-white/5"
                          style={{ color: "rgba(255,255,255,0.5)" }}
                          onClick={() => setMoreOpen(false)}
                        >
                          {item.label}
                          {"badge" in item && item.badge && (
                            <span
                              className="rounded-full px-1.5 py-0.5 font-mono text-[9px] font-bold"
                              style={{ backgroundColor: "rgba(91,79,232,0.2)", color: "#5B4FE8" }}
                            >
                              {item.badge}
                            </span>
                          )}
                        </Link>
                      );
                    }
                    return null;
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right */}
        <div className="ml-auto flex items-center gap-3 shrink-0">
          <RitualPill />
          <WalletButton />
        </div>
      </div>
    </nav>
  );
}
