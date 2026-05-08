"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { ritualChain } from "@/lib/chain";

export function ChainGuard({ children }: { children: React.ReactNode }) {
  const { chain, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  if (isConnected && chain?.id !== ritualChain.id) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-rebal-border bg-rebal-card p-6 text-center">
        <p className="mb-3 text-lg font-semibold text-neutral-100">Wrong network</p>
        <p className="mb-4 text-sm text-neutral-400">Switch to Ritual Chain (1979) to use Rebal.</p>
        <button
          type="button"
          onClick={() => switchChain({ chainId: ritualChain.id })}
          disabled={isPending}
          className="rounded-lg bg-rebal-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-rebal-primaryHover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rebal-primary/50"
        >
          {isPending ? "Switching..." : "Switch to Ritual"}
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
