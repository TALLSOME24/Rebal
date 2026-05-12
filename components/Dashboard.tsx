"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
  useWalletClient,
} from "wagmi";
import { formatEther, formatUnits, parseEther, parseUnits, zeroAddress, type Address, type Hex, hexToString } from "viem";
import { portfolioAgentAbi } from "@/lib/abi/portfolioAgent";
import { mockErc20Abi } from "@/lib/abi/mockERC20";
import { schedulerAbi } from "@/lib/abi/scheduler";
import { MOCK_TOKENS, portfolioAgentAddress, SCHEDULER } from "@/lib/constants";
import { fetchHttpExecutor, fetchLlmExecutor } from "../lib/tee";
import { ChainGuard } from "./ChainGuard";

const RISK_MODES = [
  { id: 0, label: "Safe", hint: "Smaller drift corrections with capital preservation first." },
  { id: 1, label: "Balanced", hint: "Default drift control with measured upside capture." },
  { id: 2, label: "Degen", hint: "Larger AI-suggested corrections when drift is material." },
] as const;

const PRECOMPILE_TAGS = ["HTTP 0x0801", "LLM 0x0802", "Scheduler"] as const;

const TOKEN_DECIMALS = {
  WETH: 18,
  WBTC: 8,
  USDC: 6,
  USDT: 6,
} as const;

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Native RITUAL on the PortfolioAgent contract below this warns users to fund ticks. */
const AGENT_CONTRACT_RITUAL_LOW_WEI = parseEther("0.05");

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
  /** Gray hint next to label, e.g. "(remainder)" for auto-calculated share */
  labelSuffix?: string;
  value: number;
  bps: number;
  tone: "purple" | "green";
  address?: Address;
};

function shortHex(value?: string, head = 6, tail = 4) {
  if (!value) return "0x--";
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function parseCoinGeckoPrices(body: string) {
  if (!body) return null;
  try {
    const json = JSON.parse(body) as {
      ethereum?: { usd?: number };
      bitcoin?: { usd?: number };
      "usd-coin"?: { usd?: number };
      tether?: { usd?: number };
    };

    const prices = {
      WETH: json.ethereum?.usd,
      WBTC: json.bitcoin?.usd,
      USDC: json["usd-coin"]?.usd,
      USDT: json.tether?.usd,
    };

    return Object.values(prices).every((price) => typeof price === "number") ? (prices as Record<keyof typeof TOKEN_DECIMALS, number>) : null;
  } catch {
    return null;
  }
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

function AllocationBar({ label, labelSuffix, value, bps, tone, address }: AllocationBarProps) {
  const barColor = tone === "green" ? "bg-rebal-success" : "bg-rebal-primary";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-neutral-300">
          {label}
          {labelSuffix ? <span className="ml-1.5 text-xs font-normal text-neutral-500">{labelSuffix}</span> : null}
          {address && <span className="ml-2 font-mono text-[10px] text-neutral-500">{shortHex(address, 8, 4)}</span>}
        </span>
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
  const { data: walletClient } = useWalletClient();

  const [executor, setExecutor] = useState<Address | undefined>();
  const [executorLoadError, setExecutorLoadError] = useState<string | null>(null);

  const [wethPct, setWethPct] = useState(40);
  const [wbtcPct, setWbtcPct] = useState(30);
  const [usdcPct, setUsdcPct] = useState(20);
  const usdtPct = Math.max(0, 100 - wethPct - wbtcPct - usdcPct);
  const [riskMode, setRiskMode] = useState<0 | 1 | 2>(1);

  const [freq, setFreq] = useState(80);
  const [cycles, setCycles] = useState(12);
  const [gasLimit, setGasLimit] = useState(3000000);
  const [schedulerTtl, setSchedulerTtl] = useState(300);
  const [depositAmt, setDepositAmt] = useState("0.02");
  const [lockBlocks, setLockBlocks] = useState("50000");

  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [coinGeckoPricesBody, setCoinGeckoPricesBody] = useState("");
  const [agentContractBalanceWei, setAgentContractBalanceWei] = useState<bigint | null>(null);
  const [fundAgentAmt, setFundAgentAmt] = useState("0.1");
  const [isFundingAgent, setIsFundingAgent] = useState(false);

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

  const { data: mockTokenBalances } = useReadContracts({
    contracts: [
      { address: MOCK_TOKENS.WETH, abi: mockErc20Abi, functionName: "balanceOf", args: [address ?? zeroAddress] },
      { address: MOCK_TOKENS.WBTC, abi: mockErc20Abi, functionName: "balanceOf", args: [address ?? zeroAddress] },
      { address: MOCK_TOKENS.USDC, abi: mockErc20Abi, functionName: "balanceOf", args: [address ?? zeroAddress] },
      { address: MOCK_TOKENS.USDT, abi: mockErc20Abi, functionName: "balanceOf", args: [address ?? zeroAddress] },
    ],
    query: { enabled: !!address, refetchInterval: 12_000 },
  });

  const lastPricesText = useMemo(() => {
    if (!lastPrices || (lastPrices as Hex) === "0x") return "";
    try {
      return hexToString(lastPrices as Hex);
    } catch {
      return String(lastPrices);
    }
  }, [lastPrices]);

  const portfolioValue = useMemo(() => {
    if (!address || !mockTokenBalances) return null;
    const prices = parseCoinGeckoPrices(coinGeckoPricesBody);
    if (!prices) return null;

    const [weth, wbtc, usdc, usdt] = mockTokenBalances;
    if (weth.status !== "success" || wbtc.status !== "success" || usdc.status !== "success" || usdt.status !== "success") return null;

    return (
      Number(formatUnits(weth.result as bigint, TOKEN_DECIMALS.WETH)) * prices.WETH +
      Number(formatUnits(wbtc.result as bigint, TOKEN_DECIMALS.WBTC)) * prices.WBTC +
      Number(formatUnits(usdc.result as bigint, TOKEN_DECIMALS.USDC)) * prices.USDC +
      Number(formatUnits(usdt.result as bigint, TOKEN_DECIMALS.USDT)) * prices.USDT
    );
  }, [address, coinGeckoPricesBody, mockTokenBalances]);

  const portfolioValueText = portfolioValue === null ? "$--" : USD_FORMATTER.format(portfolioValue);

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

  useEffect(() => {
    const url =
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin,usd-coin,tether&vs_currencies=usd";
    const fetchPrices = async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        setCoinGeckoPricesBody(await res.text());
      } catch {
        /* keep previous snapshot on transient errors */
      }
    };
    void fetchPrices();
    const id = setInterval(() => void fetchPrices(), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!publicClient || !agent) {
      setAgentContractBalanceWei(null);
      return;
    }
    let cancelled = false;
    const refreshAgentContractBalance = async () => {
      try {
        const wei = await publicClient.getBalance({ address: agent });
        if (!cancelled) setAgentContractBalanceWei(wei);
      } catch {
        if (!cancelled) setAgentContractBalanceWei(null);
      }
    };
    void refreshAgentContractBalance();
    const id = setInterval(() => void refreshAgentContractBalance(), 12_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [publicClient, agent]);

  const agentContractBalanceLow =
    agent !== undefined && agentContractBalanceWei !== null && agentContractBalanceWei < AGENT_CONTRACT_RITUAL_LOW_WEI;

  const agentContractBalanceStatText = !agent
    ? "--"
    : agentContractBalanceWei === null
      ? "…"
      : `${Number(formatEther(agentContractBalanceWei)).toFixed(4)} RITUAL`;

  const fundAgent = async () => {
    if (!walletClient || !publicClient || !agent || !isConnected) return;
    let value: bigint;
    try {
      value = parseEther(fundAgentAmt.trim() || "0");
    } catch {
      setStatusMsg("Invalid fund amount.");
      return;
    }
    if (value <= 0n) {
      setStatusMsg("Fund amount must be greater than zero.");
      return;
    }
    setIsFundingAgent(true);
    setStatusMsg("Sending RITUAL to agent contract…");
    try {
      const txHash = await walletClient.sendTransaction({
        to: agent,
        value,
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      setStatusMsg(`Funded agent: ${shortHex(txHash, 10, 4)}`);
      const wei = await publicClient.getBalance({ address: agent });
      setAgentContractBalanceWei(wei);
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : "Fund agent failed.");
    } finally {
      setIsFundingAgent(false);
    }
  };

  const loadExecutor = async () => {
    setExecutorLoadError(null);
    try {
      const ex = await fetchLlmExecutor();
      setExecutor(ex);
    } catch (e) {
      setExecutorLoadError(e instanceof Error ? e.message : "Failed registry read");
    }
  };

  const bpsTriplet = useMemo(() => {
    const wbtcClamped = Math.min(wbtcPct, 100 - wethPct);
    const ethBps = Math.round(wethPct * 100);
    const wbtcBps = Math.round(wbtcClamped * 100);
    const usdcBps = 10000 - ethBps - wbtcBps;
    return { ethBps, wbtcBps, usdcBps } as const;
  }, [wethPct, wbtcPct]);

  const mockTokenBps = useMemo(() => {
    const wethBps = Math.round(wethPct * 100);
    const wbtcBps = Math.round(wbtcPct * 100);
    const usdcBps = Math.round(usdcPct * 100);
    const usdtBps = 10000 - wethBps - wbtcBps - usdcBps;
    return { wethBps, wbtcBps, usdcBps, usdtBps };
  }, [usdcPct, wethPct, wbtcPct]);

  const setAllocation = (nextWeth: number, nextWbtc: number, nextUsdc: number) => {
    const weth = Math.max(0, Math.min(100, nextWeth));
    const wbtc = Math.max(0, Math.min(100 - weth, nextWbtc));
    const usdc = Math.max(0, Math.min(100 - weth - wbtc, nextUsdc));
    setWethPct(weth);
    setWbtcPct(wbtc);
    setUsdcPct(usdc);
  };

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

  const claimTestTokens = async () => {
    if (!walletClient || !publicClient || !address) return;
    setIsClaiming(true);
    setStatusMsg("Claiming mock tokens...");
    try {
      const claims = [
        { symbol: "WETH", token: MOCK_TOKENS.WETH, amount: parseUnits("1", 18) },
        { symbol: "WBTC", token: MOCK_TOKENS.WBTC, amount: parseUnits("0.01", 8) },
        { symbol: "USDC", token: MOCK_TOKENS.USDC, amount: parseUnits("1000", 6) },
        { symbol: "USDT", token: MOCK_TOKENS.USDT, amount: parseUnits("1000", 6) },
      ];

      for (const claim of claims) {
        setStatusMsg(`Claiming ${claim.symbol}...`);
        const tx = await walletClient.writeContract({
          address: claim.token,
          abi: mockErc20Abi,
          functionName: "mint",
          args: [claim.amount],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
      }

      setStatusMsg("Claimed 100 WETH, 0.01 WBTC, 1000 USDC, and 1000 USDT.");
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : "Token claim failed.");
    } finally {
      setIsClaiming(false);
    }
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
          {isConnected && address && (
            <div className="rounded-xl border border-rebal-border bg-rebal-card p-4">
              <p className="text-xs text-neutral-500">Connected wallet</p>
              <p className="mt-2 break-all font-mono text-sm text-rebal-success">{address}</p>
            </div>
          )}
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

            <section className="grid overflow-hidden rounded-xl border border-rebal-border bg-rebal-card sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <StatCard label="Portfolio Value" value={portfolioValueText} tone={portfolioValue === null ? undefined : "green"} />
              <StatCard
                label="RitualWallet"
                value={ritualBal !== undefined ? `${Number(formatEther(ritualBal as bigint)).toFixed(4)} RITUAL` : "--"}
                tone="green"
              />
              <StatCard
                label="Agent contract"
                value={agentContractBalanceStatText}
                tone={
                  !agent || agentContractBalanceWei === null
                    ? undefined
                    : agentContractBalanceLow
                      ? "red"
                      : "green"
                }
              />
              <StatCard label="Last Rebalance" value={lastRebalance} tone={decisions[0]?.llmHasError ? "red" : "purple"} />
              <StatCard label="Agent Status" value={agentStatus} tone={executor ? "green" : "purple"} />
            </section>

            {agent && (
              <section className="rounded-xl border border-rebal-border bg-rebal-card p-5">
                <h2 className="text-lg font-semibold text-neutral-100">Agent Contract Balance</h2>
                <p className="mt-1 text-xs text-neutral-500">
                  Native RITUAL held by the PortfolioAgent contract for scheduled ticks. This is separate from your RitualWallet deposit above.
                </p>
                <p className="mt-3 font-mono text-sm text-neutral-200">
                  {agentContractBalanceWei === null ? "Loading…" : `${Number(formatEther(agentContractBalanceWei)).toFixed(4)} RITUAL`}
                </p>
                {agentContractBalanceLow && (
                  <p className="mt-3 rounded-lg border border-rebal-danger/40 bg-rebal-danger/10 px-3 py-2 text-sm text-rebal-danger">
                    Contract balance is under 0.05 RITUAL. Fund the agent so automated ticks can pay for execution.
                  </p>
                )}
                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <label className="text-xs text-neutral-500">
                    Amount (RITUAL)
                    <input
                      value={fundAgentAmt}
                      onChange={(e) => setFundAgentAmt(e.target.value)}
                      disabled={!isConnected || isFundingAgent}
                      className="mt-1 w-full rounded-lg border border-rebal-border bg-[#0D0D0D] px-3 py-2 font-mono text-sm text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rebal-primary/50 disabled:opacity-40"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!isConnected || !walletClient || isFundingAgent}
                    onClick={() => void fundAgent()}
                    className="rounded-lg bg-rebal-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-rebal-primaryHover disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rebal-primary/50"
                  >
                    {isFundingAgent ? "Sending…" : "Fund agent"}
                  </button>
                </div>
              </section>
            )}

            <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-xl border border-rebal-border bg-rebal-card p-5">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-neutral-100">Allocation Targets</h2>
                    <p className="text-xs text-neutral-500">WETH / WBTC / USDC / USDT mock token targets.</p>
                  </div>
                  <span className="font-mono text-xs text-rebal-success">
                    {mockTokenBps.wethBps + mockTokenBps.wbtcBps + mockTokenBps.usdcBps + mockTokenBps.usdtBps === 10000
                      ? "valid"
                      : "check total"}
                  </span>
                </div>

                <div className="space-y-5">
                  <div className="space-y-2">
                    <AllocationBar label="WETH" value={wethPct} bps={mockTokenBps.wethBps} tone="purple" address={MOCK_TOKENS.WETH} />
                    <label className="block text-xs font-medium text-neutral-400">
                      WETH slider — set allocation (%)
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={wethPct}
                        onChange={(e) => setAllocation(Number(e.target.value), wbtcPct, usdcPct)}
                        className="mt-2 w-full"
                        aria-label="WETH allocation percent"
                      />
                    </label>
                  </div>

                  <div className="space-y-2">
                    <AllocationBar label="WBTC" value={wbtcPct} bps={mockTokenBps.wbtcBps} tone="green" address={MOCK_TOKENS.WBTC} />
                    <label className="block text-xs font-medium text-neutral-400">
                      WBTC slider — set allocation (%)
                      <input
                        type="range"
                        min={0}
                        max={100 - wethPct}
                        value={wbtcPct}
                        onChange={(e) => setAllocation(wethPct, Number(e.target.value), usdcPct)}
                        className="mt-2 w-full"
                        aria-label="WBTC allocation percent"
                      />
                    </label>
                  </div>

                  <div className="space-y-2">
                    <AllocationBar label="USDC" value={usdcPct} bps={mockTokenBps.usdcBps} tone="purple" address={MOCK_TOKENS.USDC} />
                    <label className="block text-xs font-medium text-neutral-400">
                      USDC slider — set allocation (%)
                      <input
                        type="range"
                        min={0}
                        max={100 - wethPct - wbtcPct}
                        value={usdcPct}
                        onChange={(e) => setAllocation(wethPct, wbtcPct, Number(e.target.value))}
                        className="mt-2 w-full"
                        aria-label="USDC allocation percent"
                      />
                    </label>
                  </div>

                  <div className="space-y-2">
                    <AllocationBar
                      label="USDT"
                      labelSuffix="(remainder)"
                      value={usdtPct}
                      bps={mockTokenBps.usdtBps}
                      tone="green"
                      address={MOCK_TOKENS.USDT}
                    />
                  </div>
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
                <h2 className="text-lg font-semibold text-neutral-100">Claim Test Tokens</h2>
                <p className="mt-1 text-xs text-neutral-500">Mints 1 WETH, 0.01 WBTC, 1000 USDC, and 1000 USDT to your connected wallet.</p>
                <button
                  type="button"
                  disabled={!isConnected || !walletClient || isClaiming}
                  onClick={() => void claimTestTokens()}
                  className="mt-4 w-full rounded-lg bg-rebal-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-rebal-primaryHover disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rebal-primary/50"
                >
                  {isClaiming ? "Claiming..." : "Claim test tokens"}
                </button>
              </div>

              <div className="rounded-xl border border-rebal-border bg-rebal-card p-5">
                <h2 className="text-lg font-semibold text-neutral-100">Save Portfolio</h2>
                <p className="mt-1 text-xs text-neutral-500">Writes WETH, WBTC, and combined stablecoin target bps to the current agent contract.</p>
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
