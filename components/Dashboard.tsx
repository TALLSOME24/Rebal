"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from "wagmi";
import { formatEther, parseEther, type Address, type Hex, hexToString } from "viem";
import { portfolioAgentAbi } from "@/lib/abi/portfolioAgent";
import { schedulerAbi } from "@/lib/abi/scheduler";
import { portfolioAgentAddress, SCHEDULER } from "@/lib/constants";
import { fetchHttpExecutor } from "@/lib/tee";
import { ChainGuard } from "./ChainGuard";

const RISK_MODES = [
  { id: 0, label: "Safe", hint: "Smaller drift corrections with capital preservation first." },
  { id: 1, label: "Balanced", hint: "Default drift control with measured upside capture." },
  { id: 2, label: "Degen", hint: "Larger AI-suggested corrections when drift is material." },
] as const;

const PRECOMPILE_TAGS = ["HTTP 0x0801", "LLM 0x0802", "Scheduler"] as const;

type DecisionRow = {
  tx_hash: Hex;
  cycleId: bigint;
  executionIndex: bigint;
  llmHasError: boolean;
  completionPayload: Hex;
  errorMessage: string;
  pricesHash: Hex;
};

type AllocationBarProps = {
  label: string;
  value: number;
  bps: number;
  tone: "purple" | "green";
};

function shortHex(value?: string, head = 6, tail = 4) {
  if (!value) return "0x--";
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "green" | "purple" | "red" }) {
  const toneClass =
    tone === "green" ? "text-rebal-success" : tone === "red" ? "text-rebal-danger" : tone === "purple" ? "text-rebal-primary" : "text-neutral-100";

  return (
    <div className="border-r border-rebal-border px-4 py-3 last:border-r-0">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`mt-1 truncate font-mono text-sm ${toneClass}`}>{value}</p>
    </div>
  );
}

function AllocationBar({ label, value, bps, tone }: AllocationBarProps) {
  const barColor = tone === "green" ? "bg-rebal-success" : "bg-rebal-primary";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-neutral-300">{label}</span>
        <span className="font-mono text-xs text-neutral-400">
          {value}% / {bps} bps
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#0D0D0D]">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
        />
      </div>
    </div>
  );
}

export function Dashboard() {
  const agent = portfolioAgentAddress();
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();

  const [executor, setExecutor] = useState<Address | undefined>();
  const [executorLoadError, setExecutorLoadError] = useState<string | null>(null);

  const [ethPct, setEthPct] = useState(40);
  const [wbtcPct, setWbtcPct] = useState(30);
  const usdcPct = Math.max(0, 100 - ethPct - wbtcPct);
  const [riskMode, setRiskMode] = useState<0 | 1 | 2>(1);

  const [freq, setFreq] = useState(80);
  const [cycles, setCycles] = useState(12);
  const [gasLimit, setGasLimit] = useState(900000);
  const [schedulerTtl, setSchedulerTtl] = useState(250);
  const [depositAmt, setDepositAmt] = useState("0.02");
  const [lockBlocks, setLockBlocks] = useState("50000");

  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const { data: portfolio } = useReadContract({
    address: agent,
    abi: portfolioAgentAbi,
    functionName: "portfolios",
    args: address ? [address] : undefined,
    query: { enabled: !!agent && !!address },
  });

  const { data: ritualBal } = useReadContract({
    address: agent,
    abi: portfolioAgentAbi,
    functionName: "ritualBalance",
    args: address ? [address] : undefined,
    query: { enabled: !!agent && !!address, refetchInterval: 12_000 },
  });

  const { data: lastPrices } = useReadContract({
    address: agent,
    abi: portfolioAgentAbi,
    functionName: "lastPricesBody",
    args: address ? [address] : undefined,
    query: { enabled: !!agent && !!address, refetchInterval: 15_000 },
  });

  const lastPricesText = useMemo(() => {
    if (!lastPrices || (lastPrices as Hex) === "0x") return "";
    try {
      return hexToString(lastPrices as Hex);
    } catch {
      return String(lastPrices);
    }
  }, [lastPrices]);

  const { writeContract, data: hash, isPending, error: writeError } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: Boolean(hash) },
  });

  useEffect(() => {
    if (isSuccess && hash) setStatusMsg(`Confirmed: ${shortHex(hash, 10, 4)}`);
  }, [isSuccess, hash]);

  useEffect(() => {
    if (writeError) setStatusMsg(writeError.message);
  }, [writeError]);

  const loadExecutor = async () => {
    setExecutorLoadError(null);
    try {
      const ex = await fetchHttpExecutor();
      setExecutor(ex);
    } catch (e) {
      setExecutorLoadError(e instanceof Error ? e.message : "Failed registry read");
    }
  };

  const bpsTriplet = useMemo(() => {
    const wbtcClamped = Math.min(wbtcPct, 100 - ethPct);
    const ethBps = Math.round(ethPct * 100);
    const wbtcBps = Math.round(wbtcClamped * 100);
    const usdcBps = 10000 - ethBps - wbtcBps;
    return { ethBps, wbtcBps, usdcBps } as const;
  }, [ethPct, wbtcPct]);

  const register = () => {
    if (!agent || !executor) return;
    const { ethBps, wbtcBps, usdcBps } = bpsTriplet;
    if (ethBps + wbtcBps + usdcBps !== 10000) {
      setStatusMsg("Allocations must total 100%.");
      return;
    }
    writeContract({
      address: agent,
      abi: portfolioAgentAbi,
      functionName: "registerPortfolio",
      args: [riskMode, ethBps, wbtcBps, usdcBps, executor],
    });
  };

  const deposit = () => {
    if (!agent) return;
    writeContract({
      address: agent,
      abi: portfolioAgentAbi,
      functionName: "depositFeesForCaller",
      args: [BigInt(lockBlocks)],
      value: parseEther(depositAmt),
    });
  };

  const approveScheduler = () => {
    if (!agent) return;
    writeContract({
      address: SCHEDULER,
      abi: schedulerAbi,
      functionName: "approveScheduler",
      args: [agent],
    });
  };

  const startAuto = useCallback(async () => {
    if (!agent || !publicClient) return;
    const gas = await publicClient.getGasPrice();
    writeContract({
      address: agent,
      abi: portfolioAgentAbi,
      functionName: "startAutomation",
      args: [freq, cycles, gasLimit, gas, schedulerTtl],
    });
  }, [agent, cycles, freq, gasLimit, publicClient, schedulerTtl, writeContract]);

  const cancelAuto = () => {
    if (!agent) return;
    writeContract({
      address: agent,
      abi: portfolioAgentAbi,
      functionName: "cancelAutomation",
    });
  };

  const fetchRecentDecisions = useCallback(async () => {
    if (!publicClient || !agent || !address) return;
    const latest = await publicClient.getBlockNumber();
    const from = latest > 80000n ? latest - 80000n : 0n;
    const logs = await publicClient.getContractEvents({
      address: agent,
      abi: portfolioAgentAbi,
      eventName: "RebalanceDecision",
      args: { owner: address },
      fromBlock: from,
      toBlock: latest,
    });
    const rows: DecisionRow[] = logs
      .map((l) => ({
        tx_hash: l.transactionHash,
        cycleId: (l.args as { cycleId: bigint }).cycleId,
        executionIndex: (l.args as { executionIndex: bigint }).executionIndex,
        llmHasError: Boolean((l.args as { llmHasError: boolean }).llmHasError),
        completionPayload: (l.args as { completionPayload: Hex }).completionPayload,
        errorMessage: String((l.args as { errorMessage: string }).errorMessage ?? ""),
        pricesHash: (l.args as { pricesHash: Hex }).pricesHash,
      }))
      .sort((a, b) => Number(b.executionIndex - a.executionIndex));
    setDecisions(rows.slice(0, 20));
  }, [address, agent, publicClient]);

  useEffect(() => {
    void fetchRecentDecisions();
    const t = setInterval(() => void fetchRecentDecisions(), 20_000);
    return () => clearInterval(t);
  }, [fetchRecentDecisions]);

  const completionPreview = (payload: Hex) => {
    if (!payload || payload === "0x") return "--";
    try {
      return hexToString(payload).slice(0, 2400);
    } catch {
      return `${payload.slice(0, 66)}...`;
    }
  };

  const lastRebalance = decisions[0] ? `Cycle ${String(decisions[0].cycleId)}` : "None yet";
  const agentStatus = !agent ? "Config needed" : !isConnected ? "Wallet offline" : executor ? "Executor loaded" : "Ready";
  const scheduleId = portfolio ? String(portfolio[6]) : "0";
  const actionsDisabled = !agent || !isConnected || isPending || confirming;

  return (
    <ChainGuard>
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-6 grid gap-5 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <div className="mb-4 flex flex-wrap gap-2">
              {PRECOMPILE_TAGS.map((tag) => (
                <span key={tag} className="rounded-full bg-rebal-primary/15 px-3 py-1 font-mono text-[11px] text-rebal-primary">
                  {tag}
                </span>
              ))}
            </div>
            <h1 className="text-4xl font-semibold tracking-normal text-neutral-50 md:text-5xl">Rebal</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-400">
              AI portfolio rebalancing on Ritual Chain. Targets, fee deposits, scheduler approval, and audited LLM decisions stay wired to the existing contract flow.
            </p>
          </div>
          <div className="rounded-xl border border-rebal-border bg-rebal-card p-4">
            <p className="text-xs text-neutral-500">Connected wallet</p>
            <p className="mt-2 break-all font-mono text-sm text-rebal-success">{address ?? "0x53Ee4EBC921AE15E5d153E2b6AdC805A4D29cFC2"}</p>
          </div>
        </header>

        <div className="space-y-6">
            {!agent && (
              <section className="rounded-xl border border-rebal-danger/40 bg-rebal-card p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-rebal-danger">Contract not configured</h2>
                    <p className="mt-1 text-sm text-neutral-400">
                      Set <code className="font-mono text-rebal-success">NEXT_PUBLIC_PORTFOLIO_AGENT</code> to enable live contract writes.
                    </p>
                  </div>
                  <span className="font-mono text-xs text-neutral-500">preview mode</span>
                </div>
              </section>
            )}

            {!isConnected && (
              <section className="rounded-xl border border-rebal-border bg-rebal-card p-5">
                <p className="font-mono text-sm text-neutral-400">Connect a wallet to activate Rebal controls.</p>
              </section>
            )}

            <section className="grid overflow-hidden rounded-xl border border-rebal-border bg-rebal-card sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Portfolio Value" value={lastPricesText ? "Oracle live" : "$--"} tone={lastPricesText ? "green" : undefined} />
              <StatCard
                label="RitualWallet"
                value={ritualBal !== undefined ? `${Number(formatEther(ritualBal as bigint)).toFixed(4)} RITUAL` : "--"}
                tone="green"
              />
              <StatCard label="Last Rebalance" value={lastRebalance} tone={decisions[0]?.llmHasError ? "red" : "purple"} />
              <StatCard label="Agent Status" value={agentStatus} tone={executor ? "green" : "purple"} />
            </section>

            <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-xl border border-rebal-border bg-rebal-card p-5">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-neutral-100">Allocation Targets</h2>
                    <p className="text-xs text-neutral-500">ETH / WBTC / USDC basis points stored on-chain.</p>
                  </div>
                  <span className="font-mono text-xs text-rebal-success">
                    {bpsTriplet.ethBps + bpsTriplet.wbtcBps + bpsTriplet.usdcBps === 10000 ? "valid" : "check total"}
                  </span>
                </div>

                <div className="space-y-5">
                  <AllocationBar label="ETH" value={ethPct} bps={bpsTriplet.ethBps} tone="purple" />
                  <label className="block text-xs text-neutral-500">
                    ETH %
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={ethPct}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setEthPct(v);
                        if (wbtcPct > 100 - v) setWbtcPct(100 - v);
                      }}
                      className="mt-2 w-full"
                    />
                  </label>

                  <AllocationBar label="WBTC" value={Math.min(wbtcPct, 100 - ethPct)} bps={bpsTriplet.wbtcBps} tone="green" />
                  <label className="block text-xs text-neutral-500">
                    WBTC %
                    <input
                      type="range"
                      min={0}
                      max={100 - ethPct}
                      value={Math.min(wbtcPct, 100 - ethPct)}
                      onChange={(e) => setWbtcPct(Number(e.target.value))}
                      className="mt-2 w-full"
                    />
                  </label>

                  <AllocationBar label="USDC" value={usdcPct} bps={bpsTriplet.usdcBps} tone="purple" />
                </div>
              </div>

              <div className="space-y-6">
                <section className="rounded-xl border border-rebal-border bg-rebal-card p-5">
                  <h2 className="text-lg font-semibold text-neutral-100">Risk Mode</h2>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {RISK_MODES.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setRiskMode(r.id)}
                        className={`rounded-lg px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rebal-primary/50 ${
                          riskMode === r.id ? "bg-rebal-primary text-white" : "bg-[#0D0D0D] text-neutral-400 hover:bg-rebal-primaryHover hover:text-white"
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-neutral-500">{RISK_MODES[riskMode].hint}</p>
                </section>

                <section className="rounded-xl border border-rebal-border bg-rebal-card p-5">
                  <h2 className="text-lg font-semibold text-neutral-100">Executor</h2>
                  <p className="mt-1 text-xs text-neutral-500">TEE address from the Ritual service registry.</p>
                  <button
                    type="button"
                    onClick={() => void loadExecutor()}
                    disabled={!isConnected}
                    className="mt-4 rounded-lg bg-rebal-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-rebal-primaryHover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rebal-primary/50"
                  >
                    Load HTTP executor
                  </button>
                  {executor && <p className="mt-3 break-all font-mono text-xs text-rebal-success">{executor}</p>}
                  {executorLoadError && <p className="mt-3 text-sm text-rebal-danger">{executorLoadError}</p>}
                </section>
              </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-3">
              <div className="rounded-xl border border-rebal-border bg-rebal-card p-5">
                <h2 className="text-lg font-semibold text-neutral-100">Save Portfolio</h2>
                <p className="mt-1 text-xs text-neutral-500">Writes the risk mode, target bps, and executor to the contract.</p>
                <button
                  type="button"
                  disabled={!executor || actionsDisabled}
                  onClick={register}
                  className="mt-4 w-full rounded-lg bg-rebal-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-rebal-primaryHover disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rebal-primary/50"
                >
                  Save portfolio
                </button>
              </div>

              <div className="rounded-xl border border-rebal-border bg-rebal-card p-5">
                <h2 className="text-lg font-semibold text-neutral-100">RitualWallet</h2>
                <div className="mt-4 grid gap-3">
                  <label className="text-xs text-neutral-500">
                    Amount (RITUAL)
                    <input
                      value={depositAmt}
                      onChange={(e) => setDepositAmt(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-rebal-border bg-[#0D0D0D] px-3 py-2 font-mono text-sm text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rebal-primary/50"
                    />
                  </label>
                  <label className="text-xs text-neutral-500">
                    Lock (blocks)
                    <input
                      value={lockBlocks}
                      onChange={(e) => setLockBlocks(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-rebal-border bg-[#0D0D0D] px-3 py-2 font-mono text-sm text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rebal-primary/50"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  disabled={actionsDisabled}
                  onClick={deposit}
                  className="mt-4 w-full rounded-lg bg-rebal-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-rebal-primaryHover disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rebal-primary/50"
                >
                  Deposit for fees
                </button>
              </div>

              <div className="rounded-xl border border-rebal-border bg-rebal-card p-5">
                <h2 className="text-lg font-semibold text-neutral-100">Scheduler</h2>
                <p className="mt-1 text-xs text-neutral-500">Approve fee debit, then start or cancel automated ticks.</p>
                <button
                  type="button"
                  disabled={actionsDisabled}
                  onClick={approveScheduler}
                  className="mt-4 w-full rounded-lg bg-rebal-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-rebal-primaryHover disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rebal-primary/50"
                >
                  Approve Scheduler
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-rebal-border bg-rebal-card p-5">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-neutral-100">Automation</h2>
                  <p className="text-xs text-neutral-500">Frequency, cycle count, callback gas, and scheduler TTL.</p>
                </div>
                <span className="font-mono text-xs text-neutral-500">scheduleId: {scheduleId}</span>
              </div>
              <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-neutral-500">
                  Frequency (blocks)
                  <input
                    type="number"
                    value={freq}
                    onChange={(e) => setFreq(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-rebal-border bg-[#0D0D0D] px-3 py-2 font-mono text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rebal-primary/50"
                  />
                </label>
                <label className="text-neutral-500">
                  Cycles
                  <input
                    type="number"
                    value={cycles}
                    onChange={(e) => setCycles(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-rebal-border bg-[#0D0D0D] px-3 py-2 font-mono text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rebal-primary/50"
                  />
                </label>
                <label className="text-neutral-500">
                  Callback gas
                  <input
                    type="number"
                    value={gasLimit}
                    onChange={(e) => setGasLimit(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-rebal-border bg-[#0D0D0D] px-3 py-2 font-mono text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rebal-primary/50"
                  />
                </label>
                <label className="text-neutral-500">
                  Scheduler TTL
                  <input
                    type="number"
                    value={schedulerTtl}
                    onChange={(e) => setSchedulerTtl(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-rebal-border bg-[#0D0D0D] px-3 py-2 font-mono text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rebal-primary/50"
                  />
                </label>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={actionsDisabled}
                  onClick={() => void startAuto()}
                  className="rounded-lg bg-rebal-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-rebal-primaryHover disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rebal-primary/50"
                >
                  Start / refresh schedule
                </button>
                <button
                  type="button"
                  disabled={actionsDisabled}
                  onClick={cancelAuto}
                  className="rounded-lg bg-rebal-danger px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rebal-danger/50"
                >
                  Cancel schedule
                </button>
              </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
              <div className="rounded-xl border border-rebal-border bg-rebal-card p-5">
                <h2 className="text-lg font-semibold text-neutral-100">On-chain State</h2>
                {portfolio ? (
                  <div className="mt-4 space-y-2 font-mono text-xs text-neutral-400">
                    <p>registered: {String(portfolio[0])}</p>
                    <p>risk: {RISK_MODES[Number(portfolio[1]) as 0 | 1 | 2]?.label ?? String(portfolio[1])}</p>
                    <p>
                      bps: {String(portfolio[2])} / {String(portfolio[3])} / {String(portfolio[4])}
                    </p>
                    <p className="break-all">executor: {String(portfolio[5])}</p>
                    <p>scheduleId: {String(portfolio[6])}</p>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-neutral-500">No registered portfolio loaded yet.</p>
                )}
              </div>

              <div className="rounded-xl border border-rebal-border bg-rebal-card p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-neutral-100">Agent Activity</h2>
                  <button
                    type="button"
                    onClick={() => void fetchRecentDecisions()}
                    disabled={!agent || !isConnected}
                    className="rounded-lg bg-rebal-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rebal-primaryHover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rebal-primary/50"
                  >
                    Refresh
                  </button>
                </div>
                {decisions.length === 0 ? (
                  <ul className="space-y-3 text-sm text-neutral-400">
                    <li className="flex gap-3">
                      <span className="mt-1 h-2 w-2 rounded-full bg-rebal-primary" />
                      Waiting for scheduled HTTP quote snapshot.
                    </li>
                    <li className="flex gap-3">
                      <span className="mt-1 h-2 w-2 rounded-full bg-rebal-success" />
                      LLM rebalance decisions will appear after ticks settle.
                    </li>
                  </ul>
                ) : (
                  <ul className="space-y-4">
                    {decisions.map((d) => (
                      <li key={`${d.tx_hash}-${d.executionIndex}`} className="rounded-lg border border-rebal-border bg-[#0D0D0D] p-4 text-xs">
                        <div className="flex gap-3">
                          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${d.llmHasError ? "bg-rebal-danger" : "bg-rebal-success"}`} />
                          <div className="min-w-0 flex-1">
                            <p className="font-mono text-rebal-success">
                              cycle {String(d.cycleId)} / exec {String(d.executionIndex)}
                            </p>
                            <p className={d.llmHasError ? "mt-1 text-rebal-danger" : "mt-1 text-neutral-400"}>
                              {d.llmHasError ? `LLM error: ${d.errorMessage || "true"}` : "AI rebalance decision emitted"}
                            </p>
                            <p className="mt-1 truncate font-mono text-neutral-500">pricesHash: {d.pricesHash}</p>
                            <a
                              className="mt-2 inline-block font-mono text-rebal-primary hover:underline"
                              href={`https://explorer.ritualfoundation.org/tx/${d.tx_hash}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {shortHex(d.tx_hash, 18, 4)}
                            </a>
                            <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-neutral-400">
                              {completionPreview(d.completionPayload)}
                            </pre>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            {lastPricesText && (
              <section className="rounded-xl border border-rebal-border bg-rebal-card p-5">
                <h2 className="text-sm font-semibold text-neutral-100">Last Price JSON</h2>
                <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#0D0D0D] p-3 font-mono text-xs text-neutral-400">
                  {lastPricesText}
                </pre>
              </section>
            )}

            {(statusMsg || isPending || confirming) && (
              <p className="rounded-xl border border-rebal-border bg-rebal-card p-4 font-mono text-sm text-rebal-primary">
                {confirming ? "Confirming..." : isPending ? "Check wallet..." : statusMsg}
              </p>
            )}
        </div>

        <footer className="mt-10 border-t border-rebal-border pt-5 text-center font-mono text-[9px] text-[#333]">
          Powered by Ritual Chain · HTTP + LLM + Scheduler precompiles
        </footer>
      </div>
    </ChainGuard>
  );
}
