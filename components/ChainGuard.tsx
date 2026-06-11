"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { ritualChain } from "@/lib/chain";

export function ChainGuard({ children }: { children: React.ReactNode }) {
  const { chain, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  if (isConnected && chain?.id !== ritualChain.id) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div
          className="w-full max-w-sm rounded-2xl border p-8 text-center"
          style={{
            backgroundColor: "rgba(15,14,26,0.9)",
            borderColor: "rgba(91,79,232,0.3)",
            backdropFilter: "blur(12px)",
          }}
        >
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: "rgba(91,79,232,0.12)", border: "1px solid rgba(91,79,232,0.25)" }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 2.5 16.5 6v8L10 17.5 3.5 14V6L10 2.5Z" stroke="#5B4FE8" strokeWidth="1.5" />
            </svg>
          </div>
          <p className="mb-1 text-base font-semibold text-white">Wrong network</p>
          <p className="mb-5 text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>
            Switch to Ritual Chain (1979) to use Rebal.
          </p>
          <button
            type="button"
            onClick={() => switchChain({ chainId: ritualChain.id })}
            disabled={isPending}
            className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: "#5B4FE8" }}
          >
            {isPending ? "Switching…" : "Switch to Ritual Chain"}
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
