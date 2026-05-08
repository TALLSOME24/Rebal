"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";

export function WalletConnect() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden max-w-[260px] truncate rounded-full border border-rebal-success/25 bg-rebal-success/10 px-3 py-1.5 font-mono text-xs text-rebal-success sm:inline">
          {address}
        </span>
        <button
          type="button"
          onClick={() => disconnect()}
          className="rounded-lg border border-rebal-border px-3 py-1.5 text-xs text-neutral-400 transition hover:border-rebal-primary hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rebal-primary/50"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={isPending || !connectors[0]}
      onClick={() => connect({ connector: connectors[0] })}
      className="rounded-lg bg-rebal-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-rebal-primaryHover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rebal-primary/50"
    >
      {isPending ? "Connecting..." : "Connect wallet"}
    </button>
  );
}
