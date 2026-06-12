"use client";

import { useState, useEffect } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useBalance, useBlockNumber, usePublicClient, useWalletClient } from "wagmi";
import { formatEther, parseEther, parseGwei, type Address } from "viem";
import { portfolioAgentABI } from "@/lib/abi/portfolioAgentABI";
import { ritualWalletABI } from "@/lib/abi/ritualWalletABI";
import { PORTFOLIO_AGENT, RITUAL_WALLET } from "@/lib/constants";
import { useAgentState } from "@/hooks/useAgentState";
import { useTickEvents } from "@/hooks/useTickEvents";
import { useToast } from "@/components/Toast";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 font-mono text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)", letterSpacing: "1.4px" }}>
      {children}
    </p>
  );
}

function Card({ children, style, className = "" }: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  return (
    <div
      className={`rounded-2xl border p-4 ${className}`}
      style={{ backgroundColor: "rgba(255,255,255,0.025)", borderColor: "rgba(255,255,255,0.06)", ...style }}
    >
      {children}
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  unit = "",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  unit?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
          {label}
        </span>
        <span className="font-mono text-xs" style={{ color: "rgba(255,255,255,0.75)" }}>
          {value.toLocaleString()}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}

export function Agent() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const agentState = useAgentState();
  const { events } = useTickEvents();
  const { toast } = useToast();

  // Scheduler config
  const [freq, setFreq] = useState(80);
  const [cycles, setCycles] = useState(12);
  const [gasLimit, setGasLimit] = useState(3000000);
  const [ttl, setTtl] = useState(350);

  // Ritual Wallet
  const [depositAmt, setDepositAmt] = useState("0.35");
  const [lockBlocks, setLockBlocks] = useState(200_000);

  // Agent fund
  const [fundAmt, setFundAmt] = useState("0.1");
  const [isFunding, setIsFunding] = useState(false);

  const { data: contractBalance, refetch: refetchBalance } = useBalance({
    address: PORTFOLIO_AGENT,
    query: { refetchInterval: 12_000 },
  });

  const { data: ritualBal } = useReadContract({
    address: PORTFOLIO_AGENT,
    abi: portfolioAgentABI,
    functionName: "contractRitualBalance",
    query: { refetchInterval: 12_000 },
  });

  const { data: currentBlock } = useBlockNumber({ query: { refetchInterval: 12_000 } });

  const { data: lockUntilData, refetch: refetchLock } = useReadContract({
    address: RITUAL_WALLET,
    abi: ritualWalletABI,
    functionName: "lockUntil",
    args: [PORTFOLIO_AGENT],
    query: { refetchInterval: 12_000 },
  });

  // startAutomation
  const { writeContract: writeStart, data: startHash, isPending: startPending } = useWriteContract();
  const { isSuccess: startSuccess } = useWaitForTransactionReceipt({ hash: startHash, query: { enabled: !!startHash } });
  useEffect(() => { if (startSuccess) toast("Scheduler started ✓", "success"); }, [startSuccess, toast]);

  // cancelAutomation
  const { writeContract: writeCancel, data: cancelHash, isPending: cancelPending } = useWriteContract();
  const { isSuccess: cancelSuccess } = useWaitForTransactionReceipt({ hash: cancelHash, query: { enabled: !!cancelHash } });
  useEffect(() => { if (cancelSuccess) toast("Scheduler cancelled ✓", "success"); }, [cancelSuccess, toast]);

  // depositFees
  const { writeContract: writeDeposit, data: depositHash, isPending: depositPending } = useWriteContract();
  const { isSuccess: depositSuccess } = useWaitForTransactionReceipt({ hash: depositHash, query: { enabled: !!depositHash } });
  useEffect(() => {
    if (depositSuccess) {
      toast("Deposited to RitualWallet ✓", "success");
      void refetchLock();
    }
  }, [depositSuccess, toast, refetchLock]);

  // withdrawFees
  const { writeContract: writeWithdraw, data: withdrawHash, isPending: withdrawPending } = useWriteContract();
  const { isSuccess: withdrawSuccess, isError: withdrawError } = useWaitForTransactionReceipt({ hash: withdrawHash, query: { enabled: !!withdrawHash } });
  useEffect(() => { if (withdrawSuccess) toast("RITUAL recovered ✓", "success"); }, [withdrawSuccess, toast]);
  useEffect(() => { if (withdrawError) toast("Recovery failed", "error"); }, [withdrawError, toast]);

  // owner
  const { data: ownerAddress } = useReadContract({
    address: PORTFOLIO_AGENT,
    abi: portfolioAgentABI,
    functionName: "owner",
  });

  const startScheduler = () => {
    toast("Sending startAutomation…", "pending");
    writeStart({
      address: PORTFOLIO_AGENT,
      abi: portfolioAgentABI,
      functionName: "startAutomation",
      args: [freq, cycles, gasLimit, parseGwei("2"), ttl],
    });
  };

  const cancelScheduler = () => {
    toast("Cancelling scheduler…", "pending");
    writeCancel({ address: PORTFOLIO_AGENT, abi: portfolioAgentABI, functionName: "cancelAutomation" });
  };

  const depositFees = () => {
    const amt = parseEther(depositAmt || "0");
    if (amt <= 0n) return toast("Enter a valid deposit amount", "error");
    toast("Depositing to RitualWallet…", "pending");
    writeDeposit({
      address: PORTFOLIO_AGENT,
      abi: portfolioAgentABI,
      functionName: "depositFeesForCaller",
      args: [BigInt(lockBlocks)],
      value: amt,
    });
  };

  const fundAgent = async () => {
    if (!walletClient || !publicClient) return;
    const amt = parseEther(fundAmt || "0");
    if (amt <= 0n) return toast("Enter a valid fund amount", "error");
    setIsFunding(true);
    toast("Sending ETH to agent…", "pending");
    try {
      const txHash = await walletClient.sendTransaction({ to: PORTFOLIO_AGENT, value: amt });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      await refetchBalance();
      toast("Agent funded ✓", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Fund failed", "error");
    } finally {
      setIsFunding(false);
    }
  };

  const tickCount = events.filter((e) => e.type === "decision").length;
  const ritualBalEth = ritualBal ? Number(formatEther(ritualBal as bigint)) : 0;
  const lockUntilBlock = lockUntilData ? (lockUntilData as bigint) : 0n;
  const lockValid = currentBlock ? lockUntilBlock > currentBlock : false;
  const isOwner = !!(address && ownerAddress && address.toLowerCase() === (ownerAddress as string).toLowerCase());
  const canRecover = isOwner && !lockValid && ritualBalEth > 0;

  const recoverFees = () => {
    toast("Recovering RITUAL…", "pending");
    writeWithdraw({
      address: PORTFOLIO_AGENT,
      abi: portfolioAgentABI,
      functionName: "withdrawFees",
      args: [0n],
    });
  };

  return (
    <div className="space-y-4">
      {/* Hero card */}
      <div
        className="rounded-2xl border p-5"
        style={{
          background: "linear-gradient(135deg, rgba(91,79,232,0.08) 0%, rgba(59,130,246,0.04) 100%)",
          borderColor: "rgba(91,79,232,0.25)",
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span
                className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold"
                style={
                  agentState.registered
                    ? { backgroundColor: "rgba(0,200,150,0.1)", borderColor: "rgba(0,200,150,0.3)", color: "#00C896" }
                    : { backgroundColor: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }
                }
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    backgroundColor: agentState.registered ? "#00C896" : "rgba(255,255,255,0.3)",
                    ...(agentState.registered ? {} : {}),
                  }}
                />
                {agentState.registered ? "Active" : "Paused"}
              </span>
              <span className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
                PortfolioAgent v8 · Ritual Chain 1979
              </span>
            </div>

            {/* Metrics */}
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: "Ticks Fired", value: String(tickCount) },
                { label: "Tick Index", value: String(agentState.tickIndex) },
                { label: "Contract Balance", value: contractBalance ? `${Number(contractBalance.formatted).toFixed(4)} RITUAL` : "—" },
                { label: "Net Profit", value: "$0.00" },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="font-mono text-[10px] uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</p>
                  <p className="mt-0.5 font-mono text-sm text-white">{value}</p>
                </div>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="rounded-xl border px-4 py-2 text-sm font-semibold transition hover:opacity-90"
            style={{
              backgroundColor: "rgba(255,71,87,0.07)",
              borderColor: "rgba(255,71,87,0.2)",
              color: "rgba(255,71,87,0.75)",
            }}
            title="Owner-only function"
          >
            ⏸ Emergency Pause
          </button>
        </div>
      </div>

      {/* Gas vs Yield */}
      <div
        className="rounded-2xl border p-4"
        style={{ backgroundColor: "rgba(255,255,255,0.025)", borderColor: "rgba(0,200,150,0.2)" }}
      >
        <Label>Gas vs Yield Profitability</Label>
        <div className="space-y-2">
          {[
            { label: "Estimated gas (next tick)", value: "~$0.05", color: "#FF4757" },
            { label: "Yield captured", value: "$0.00", color: "#D4A847" },
            { label: "Net (yield - gas)", value: "-$0.05", color: "rgba(255,255,255,0.4)" },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>{label}</span>
              <span className="font-mono text-sm" style={{ color }}>{value}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 h-[3px] overflow-hidden rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.07)" }}>
          <div className="h-full w-0 rounded-full" style={{ backgroundColor: "#00C896" }} />
        </div>
        <p className="mt-1 text-xs" style={{ color: "rgba(255,71,87,0.6)" }}>
          Below threshold — agent will skip this tick
        </p>
      </div>

      {/* Scheduler Setup */}
      <Card>
        <Label>Scheduler Setup</Label>
        <div className="grid gap-4 sm:grid-cols-2">
          <SliderField label="Frequency (blocks)" value={freq} min={20} max={500} onChange={setFreq} />
          <SliderField label="Cycles" value={cycles} min={10} max={500} onChange={setCycles} />
          <SliderField label="Gas limit" value={gasLimit} min={3000000} max={10000000} step={100000} onChange={setGasLimit} />
          <SliderField label="TTL (blocks)" value={ttl} min={300} max={3600} onChange={setTtl} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={startScheduler}
            disabled={!address || startPending || !lockValid}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: "#5B4FE8" }}
            title={!lockValid ? "RitualWallet lock expired — deposit first" : undefined}
          >
            {startPending ? "Starting…" : "Start"}
          </button>
          <button
            type="button"
            onClick={cancelScheduler}
            disabled={!address || cancelPending}
            className="rounded-xl border px-4 py-2 text-sm transition hover:bg-white/5 disabled:opacity-40"
            style={{ borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}
          >
            {cancelPending ? "Cancelling…" : "Cancel"}
          </button>
        </div>
      </Card>

      {/* Approve + RitualWallet + Fund in grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Pre-flight Checklist */}
        <Card>
          <Label>Pre-flight Checklist</Label>
          <p className="mb-3 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            Requirements before starting automation.
          </p>
          <ul className="space-y-2">
            {[
              { label: "Wallet connected", ok: !!address },
              { label: "Portfolio registered", ok: agentState.registered },
              { label: `RITUAL balance > 0 (${ritualBalEth.toFixed(4)})`, ok: ritualBalEth > 0 },
              { label: "Gas limit ≥ 3,000,000", ok: gasLimit >= 3_000_000 },
              { label: "TTL ≥ 300 blocks", ok: ttl >= 300 },
              {
                label: lockValid
                  ? `RitualWallet lock valid (until block ${lockUntilBlock.toString()})`
                  : "RitualWallet lock valid",
                ok: lockValid,
              },
            ].map(({ label, ok }) => (
              <li key={label} className="flex items-center gap-2">
                <span className="shrink-0 font-mono text-xs" style={{ color: ok ? "#00C896" : "#FF4757" }}>
                  {ok ? "✓" : "✗"}
                </span>
                <span className="text-xs" style={{ color: ok ? "rgba(255,255,255,0.55)" : "rgba(255,71,87,0.8)" }}>
                  {label}
                </span>
              </li>
            ))}
          </ul>
          {!lockValid && (
            <p className="mt-3 text-xs" style={{ color: "rgba(255,71,87,0.75)" }}>
              Lock expired — click Deposit in the RitualWallet card below to re-extend before starting.
            </p>
          )}
          <p className="mt-3 font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>
            No separate approval tx needed — startAutomation handles everything.
          </p>
        </Card>

        {/* RitualWallet Deposit */}
        <Card>
          <Label>RitualWallet</Label>
          <p className="mb-1 font-mono text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            Balance: {ritualBalEth.toFixed(4)} RITUAL
          </p>
          <p className="mb-3 font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
            {RITUAL_WALLET.slice(0, 10)}…
          </p>
          <input
            type="number"
            value={depositAmt}
            onChange={(e) => setDepositAmt(e.target.value)}
            step="0.1"
            className="mb-2 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
            style={{ backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)", color: "white" }}
            placeholder="Amount (RITUAL)"
          />
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>Lock blocks</span>
            </div>
            <input
              type="number"
              value={lockBlocks}
              onChange={(e) => setLockBlocks(Number(e.target.value))}
              min={1000}
              step={10000}
              className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
              style={{ backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)", color: "white" }}
            />
          </div>
          <button
            type="button"
            onClick={depositFees}
            disabled={!address || depositPending}
            className="mt-3 w-full rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: "#5B4FE8" }}
          >
            {depositPending ? "Depositing…" : "Deposit"}
          </button>
          {canRecover && (
            <button
              type="button"
              onClick={recoverFees}
              disabled={withdrawPending}
              className="mt-2 w-full rounded-xl border px-4 py-2 text-sm font-semibold transition hover:opacity-90 disabled:opacity-40"
              style={{ borderColor: "rgba(0,200,150,0.4)", color: "#00C896", backgroundColor: "rgba(0,200,150,0.06)" }}
            >
              {withdrawPending ? "Recovering…" : "Recover RITUAL"}
            </button>
          )}
          <p className="mt-2 font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
            Depositing extends the scheduler lock. Always deposit before starting a new schedule.
          </p>
        </Card>

        {/* Fund Agent */}
        <Card>
          <Label>Fund Agent Contract</Label>
          <p className="mb-1 font-mono text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            Balance: {contractBalance ? Number(contractBalance.formatted).toFixed(4) : "—"} RITUAL
          </p>
          <p className="mb-3 font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
            {PORTFOLIO_AGENT.slice(0, 10)}…
          </p>
          <input
            type="number"
            value={fundAmt}
            onChange={(e) => setFundAmt(e.target.value)}
            step="0.1"
            className="mb-3 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
            style={{ backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)", color: "white" }}
            placeholder="ETH amount"
          />
          <button
            type="button"
            onClick={() => void fundAgent()}
            disabled={!address || isFunding}
            className="w-full rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: "#5B4FE8" }}
          >
            {isFunding ? "Sending…" : "Fund Agent"}
          </button>
        </Card>
      </div>
    </div>
  );
}
