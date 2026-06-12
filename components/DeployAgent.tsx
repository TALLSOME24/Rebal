"use client";

import type { Address } from "viem";

export function DeployAgent({
  deployAgent,
  deployPending,
  deployConfirming,
  deploySuccess,
  agentAddress,
}: {
  deployAgent: () => void;
  deployPending: boolean;
  deployConfirming: boolean;
  deploySuccess: boolean;
  agentAddress: Address | undefined;
}) {
  const busy = deployPending || deployConfirming;
  const done = deploySuccess && !!agentAddress;
  const finalizing = deploySuccess && !agentAddress;

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <div
        className="w-full max-w-md rounded-2xl border p-8"
        style={{
          backgroundColor: "rgba(255,255,255,0.025)",
          borderColor: done ? "rgba(0,200,150,0.3)" : "rgba(91,79,232,0.25)",
        }}
      >
        {/* Icon */}
        <div
          className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl text-2xl"
          style={{ backgroundColor: done ? "rgba(0,200,150,0.1)" : "rgba(91,79,232,0.12)" }}
        >
          {done ? "✓" : "⬡"}
        </div>

        {done ? (
          <>
            <h2 className="text-xl font-semibold text-white">Your agent is live</h2>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
              Your personal PortfolioAgent is deployed and ready. Loading your dashboard…
            </p>
            <div
              className="mt-4 rounded-xl border px-3 py-2"
              style={{ borderColor: "rgba(0,200,150,0.2)", backgroundColor: "rgba(0,200,150,0.05)" }}
            >
              <p className="font-mono text-[10px] uppercase" style={{ color: "rgba(0,200,150,0.6)" }}>
                Your agent contract
              </p>
              <p className="mt-1 break-all font-mono text-xs" style={{ color: "#00C896" }}>
                {agentAddress}
              </p>
            </div>
          </>
        ) : busy || finalizing ? (
          <>
            <div className="mb-4 flex items-center gap-3">
              <span
                className="h-5 w-5 animate-spin rounded-full border-2 shrink-0"
                style={{ borderColor: "#5B4FE8", borderTopColor: "transparent" }}
              />
              <h2 className="text-xl font-semibold text-white">
                {finalizing ? "Finalizing…" : "Deploying your agent…"}
              </h2>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
              {deployPending
                ? "Check your wallet to confirm the transaction."
                : "Waiting for Ritual Chain confirmation. This takes a few seconds."}
            </p>
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold text-white">Deploy your personal agent</h2>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
              Your agent is a smart contract that lives on Ritual Chain. It manages your portfolio,
              runs the scheduler, and holds your RITUAL balance. You own it — no one else can touch it.
            </p>

            <div
              className="mt-4 rounded-xl border px-3 py-2.5"
              style={{ borderColor: "rgba(255,255,255,0.07)", backgroundColor: "rgba(255,255,255,0.02)" }}
            >
              <p className="font-mono text-[10px] uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>
                Cost
              </p>
              <p className="mt-1 text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
                A small amount of RITUAL for gas (~0.001 RITUAL).
              </p>
            </div>

            <button
              type="button"
              onClick={deployAgent}
              className="mt-6 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              style={{ backgroundColor: "#5B4FE8" }}
            >
              Deploy My Agent
            </button>
          </>
        )}
      </div>
    </div>
  );
}
