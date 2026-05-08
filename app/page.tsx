import { Dashboard } from "@/components/Dashboard";
import dynamic from "next/dynamic";

const Connect = dynamic(() => import("@/components/WalletConnect").then((m) => m.WalletConnect), { ssr: false });

export default function Home() {
  return (
    <main className="min-h-screen">
      <div className="border-b border-rebal-border bg-[#0D0D0D]/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-rebal-border bg-rebal-card">
              <span className="font-mono text-sm font-bold text-rebal-primary">R</span>
            </div>
            <span className="text-lg font-semibold tracking-normal text-neutral-100">Rebal</span>
            <span className="hidden items-center gap-1 rounded-full border border-rebal-border px-2 py-1 font-mono text-[9px] text-[#666] sm:flex">
              <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 16 16" fill="none">
                <path d="M8 1.5 13.6 4.8v6.4L8 14.5l-5.6-3.3V4.8L8 1.5Z" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              Ritual Chain · 1979
            </span>
          </div>
          <Connect />
        </div>
      </div>
      <Dashboard />
    </main>
  );
}
