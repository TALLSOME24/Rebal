/**
 * Diagnostic script for PortfolioAgent on Ritual testnet.
 * Run: node scripts/check-agent.cjs
 */
require("dotenv").config();
const { createPublicClient, http, formatEther } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const RITUAL_RPC = process.env.RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";
const AGENT    = "0xB2f331A2403d35C79BcAc72885a55676B17B8348"; // v7
const WALLET   = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
const SCHED    = "0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B";
const TEE_REG  = "0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F";

const OWNER = process.env.PRIVATE_KEY
  ? privateKeyToAccount(process.env.PRIVATE_KEY).address
  : "0x53Ee4EBC921AE15E5d153E2b6AdC805A4D29cFC2";

const chain = {
  id: 1979,
  name: "Ritual",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: { default: { http: [RITUAL_RPC] } },
};
const client = createPublicClient({ chain, transport: http() });

// ── ABIs (minimal) ────────────────────────────────────────────────────────────
const agentAbi = [
  { name: "portfolios", type: "function", stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "registered", type: "bool" },
      { name: "riskMode",   type: "uint8" },
      { name: "ethBps",     type: "uint16" },
      { name: "wbtcBps",    type: "uint16" },
      { name: "usdcBps",    type: "uint16" },
      { name: "executor",   type: "address" },
      { name: "scheduleId", type: "uint256" },
    ] },
  { name: "tickIndex",  type: "function", stateMutability: "view",
    inputs: [{ name: "", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "lastCycleId", type: "function", stateMutability: "view",
    inputs: [{ name: "", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "contractRitualBalance", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }] },
  { name: "lastPricesBody", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "bytes" }] },
  { name: "MIN_TTL_BLOCKS", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint32" }] },
];

const walletAbi = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "lockUntil", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
];

const schedAbi = [
  { name: "getCallState", type: "function", stateMutability: "view",
    inputs: [{ name: "callId", type: "uint256" }], outputs: [{ name: "state", type: "uint8" }] },
  { name: "calls", type: "function", stateMutability: "view",
    inputs: [{ name: "callId", type: "uint256" }],
    outputs: [
      { name: "to",                 type: "address" },
      { name: "caller",             type: "address" },
      { name: "startBlock",         type: "uint32" },
      { name: "numCalls",           type: "uint32" },
      { name: "frequency",          type: "uint32" },
      { name: "gas",                type: "uint32" },
      { name: "ttl",                type: "uint32" },
      { name: "state",              type: "uint8" },
      { name: "maxFeePerGas",       type: "uint256" },
      { name: "maxPriorityFeePerGas", type: "uint256" },
      { name: "value",              type: "uint256" },
      { name: "data",               type: "bytes" },
    ] },
];

const teeAbi = [
  { name: "getServicesByCapability", type: "function", stateMutability: "view",
    inputs: [{ name: "capability", type: "uint8" }, { name: "checkValidity", type: "bool" }],
    outputs: [{ name: "services", type: "tuple[]", components: [
      { name: "node", type: "tuple", components: [
        { name: "paymentAddress", type: "address" },
        { name: "teeAddress",     type: "address" },
        { name: "teeType",        type: "uint8" },
        { name: "publicKey",      type: "bytes" },
        { name: "endpoint",       type: "string" },
        { name: "certPubKeyHash", type: "bytes32" },
        { name: "capability",     type: "uint8" },
      ]},
      { name: "isValid",    type: "bool" },
      { name: "workloadId", type: "bytes32" },
    ]}] },
];

const CALL_STATES = ["SCHEDULED","EXECUTING","COMPLETED","CANCELLED","EXPIRED"];
const RISK_NAMES  = ["Conservative","Balanced","Aggressive"];

function sep(label) {
  const pad = "─".repeat(Math.max(0, 54 - label.length));
  console.log(`\n┌── ${label} ${pad}`);
}

async function safeRead(label, fn) {
  try { return await fn(); }
  catch (e) { console.log(`  ⚠  ${label}: ${e.shortMessage || e.message.slice(0, 80)}`); return null; }
}

async function main() {
  console.log("═".repeat(58));
  console.log("  PortfolioAgent Diagnostic  —  Ritual Testnet (1979)");
  console.log("═".repeat(58));
  console.log("  Agent   :", AGENT);
  console.log("  Owner   :", OWNER);
  console.log("  RPC     :", RITUAL_RPC);

  // ── 1. Chain ──────────────────────────────────────────────────────────────
  sep("1 · Chain");
  const block = await client.getBlockNumber();
  const basefee = await client.getBlock({ blockNumber: block })
    .then(b => b.baseFeePerGas).catch(() => null);
  console.log("  currentBlock :", block.toString());
  console.log("  basefee      :", basefee ? `${Number(basefee)/1e9} gwei` : "n/a");

  // ── 2. Contract ───────────────────────────────────────────────────────────
  sep("2 · Contract");
  const code = await client.getCode({ address: AGENT });
  const nativeBal = await client.getBalance({ address: AGENT });
  console.log("  deployed     :", code && code.length > 2 ? `YES (${(code.length-2)/2} bytes)` : "NO — not deployed!");
  console.log("  nativeBal    :", formatEther(nativeBal), "RITUAL");

  // ── 3. RitualWallet ───────────────────────────────────────────────────────
  sep("3 · RitualWallet (contract as payer)");
  const rwBal  = await safeRead("balanceOf", () => client.readContract({ address: WALLET, abi: walletAbi, functionName: "balanceOf", args: [AGENT] }));
  const rwLock = await safeRead("lockUntil", () => client.readContract({ address: WALLET, abi: walletAbi, functionName: "lockUntil", args: [AGENT] }));
  console.log("  balance      :", rwBal  != null ? `${formatEther(rwBal)} RITUAL` : "error");
  console.log("  lockUntil    :", rwLock != null ? rwLock.toString() : "error");
  if (rwLock != null) {
    const lockOk = rwLock >= block;
    const blocksLeft = lockOk ? rwLock - block : 0n;
    console.log("  lock status  :", lockOk ? `VALID — ${blocksLeft} blocks left` : "EXPIRED ← fee lock expired, ticks will be dropped");
  }
  const minGasCost = 3_000_000n * (basefee ?? 1_000_000_000n);
  const llmEscrow  = 310_000_000_000_000_000n; // 0.31 RITUAL worst-case
  if (rwBal != null) {
    const needsGas = rwBal < minGasCost;
    const needsLLM = rwBal < llmEscrow;
    console.log("  ≥ min gas (3M×basefee =", formatEther(minGasCost),"RITUAL):", needsGas ? "NO ← too low" : "YES");
    console.log("  ≥ LLM escrow (0.31 RITUAL):", needsLLM ? "NO ← LLM ticks will be dropped" : "YES");
  }

  // ── 4. Portfolio ──────────────────────────────────────────────────────────
  sep("4 · Portfolio registration");
  const p = await safeRead("portfolios", () => client.readContract({ address: AGENT, abi: agentAbi, functionName: "portfolios", args: [OWNER] }));
  if (p) {
    // viem may return tuple fields as indexed array — normalise
    const registered = p.registered  ?? p[0];
    const riskMode   = p.riskMode    ?? p[1];
    const ethBps     = p.ethBps      ?? p[2];
    const wbtcBps    = p.wbtcBps     ?? p[3];
    const usdcBps    = p.usdcBps     ?? p[4];
    const executor   = p.executor    ?? p[5];
    const scheduleId = p.scheduleId  ?? p[6] ?? 0n;
    const usdtBps = 10000 - Number(ethBps??0) - Number(wbtcBps??0) - Number(usdcBps??0);
    console.log("  registered   :", registered ? "YES" : "NO ← portfolio not registered!");
    console.log("  risk         :", RISK_NAMES[Number(riskMode??0)] ?? riskMode);
    console.log("  ethBps       :", ethBps != null ? `${ethBps} (${Number(ethBps)/100}%)` : "n/a");
    console.log("  wbtcBps      :", wbtcBps != null ? `${wbtcBps} (${Number(wbtcBps)/100}%)` : "n/a");
    console.log("  usdcBps      :", usdcBps != null ? `${usdcBps} (${Number(usdcBps)/100}%)` : "n/a");
    console.log("  usdtBps      :", usdtBps, `(${usdtBps/100}%) ← implied`);
    console.log("  executor     :", executor ?? "n/a");
    console.log("  scheduleId   :", scheduleId.toString(), scheduleId === 0n ? "← no active schedule" : "");
    // re-export for later sections
    p._norm = { registered, riskMode, ethBps, wbtcBps, usdcBps, executor, scheduleId };
  }

  // ── 5. Tick state ─────────────────────────────────────────────────────────
  sep("5 · Tick state");
  const tick    = await safeRead("tickIndex",   () => client.readContract({ address: AGENT, abi: agentAbi, functionName: "tickIndex",    args: [OWNER] }));
  const cycleId = await safeRead("lastCycleId", () => client.readContract({ address: AGENT, abi: agentAbi, functionName: "lastCycleId",  args: [OWNER] }));
  const prices  = await safeRead("lastPrices",  () => client.readContract({ address: AGENT, abi: agentAbi, functionName: "lastPricesBody", args: [OWNER] }));
  console.log("  tickIndex    :", tick != null ? tick.toString() : "error");
  console.log("  lastCycleId  :", cycleId != null ? cycleId.toString() : "error");
  console.log("  pricesBody   :", prices != null ? (prices.length > 2 ? `${(prices.length-2)/2} bytes` : "empty (HTTP tick hasn't settled yet)") : "error");
  if (tick != null) {
    const nextPhase = Number(tick) % 2 === 0 ? "HTTP (even)" : "LLM (odd)";
    console.log("  next tick    : idx", tick.toString(), "→", nextPhase);
  }

  // ── 6. Schedule ───────────────────────────────────────────────────────────
  sep("6 · Scheduler state");
  const schedId = p?._norm?.scheduleId ?? null;
  if (!schedId || schedId === 0n) {
    console.log("  scheduleId   : 0 — no schedule registered, automation not started");
  } else {
    console.log("  scheduleId   :", schedId.toString());
    const state = await safeRead("getCallState", () =>
      client.readContract({ address: SCHED, abi: schedAbi, functionName: "getCallState", args: [schedId] }));
    if (state != null) {
      console.log("  state        :", CALL_STATES[Number(state)] ?? state, `(${state})`);
      const terminal = Number(state) >= 2;
      if (terminal) console.log("  ← TERMINAL STATE — scheduler is done, no more ticks");
    } else {
      console.log("  state        : revert — schedule may not exist in Scheduler (completed/expired/cancelled)");
    }

    const callInfo = await safeRead("calls", () =>
      client.readContract({ address: SCHED, abi: schedAbi, functionName: "calls", args: [schedId] }));
    if (callInfo) {
      // viem may return struct as indexed array — normalise
      const ci_to         = callInfo.to          ?? callInfo[0];
      const ci_caller     = callInfo.caller       ?? callInfo[1];
      const ci_startBlock = callInfo.startBlock   ?? callInfo[2];
      const ci_numCalls   = callInfo.numCalls     ?? callInfo[3];
      const ci_frequency  = callInfo.frequency    ?? callInfo[4];
      const ci_gas        = callInfo.gas          ?? callInfo[5];
      const ci_ttl        = callInfo.ttl          ?? callInfo[6];
      const ci_maxFee     = callInfo.maxFeePerGas ?? callInfo[8];
      console.log("  to           :", ci_to);
      console.log("  caller       :", ci_caller);
      console.log("  startBlock   :", ci_startBlock != null ? ci_startBlock.toString() : "n/a");
      console.log("  numCalls     :", ci_numCalls   != null ? ci_numCalls.toString()   : "n/a");
      console.log("  frequency    :", ci_frequency  != null ? ci_frequency.toString()  : "n/a", "blocks");
      console.log("  gas          :", ci_gas        != null ? ci_gas.toString()         : "n/a");
      console.log("  ttl          :", ci_ttl        != null ? ci_ttl.toString()         : "n/a", "blocks");
      console.log("  maxFeePerGas :", ci_maxFee     != null ? Number(ci_maxFee)/1e9     : "n/a", "gwei");
      if (ci_gas  != null && Number(ci_gas)  < 3_000_000) console.log("  ← gas too low (< 3M)");
      if (ci_ttl  != null && Number(ci_ttl)  < 300)       console.log("  ← TTL too low (< 300)");
    }
  }

  // ── 7. LLM executor ───────────────────────────────────────────────────────
  sep("7 · LLM executors (capability=1)");
  const executors = await safeRead("TEE LLM executors", () =>
    client.readContract({ address: TEE_REG, abi: teeAbi, functionName: "getServicesByCapability", args: [1, true] }));
  if (executors) {
    console.log("  count        :", executors.length);
    for (const svc of executors) {
      console.log("  teeAddress   :", svc.node.teeAddress, svc.isValid ? "(valid)" : "(invalid)");
    }
    if (p?._norm?.registered && p._norm.executor) {
      const match = executors.find(s => s.node.teeAddress.toLowerCase() === p._norm.executor.toLowerCase());
      console.log("  registered executor in LLM list:", match ? "YES" : "NO ← executor may be wrong capability");
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  sep("SUMMARY");
  const issues = [];
  if (!p || !p.registered)            issues.push("Portfolio not registered");
  if (rwBal != null && rwBal === 0n)  issues.push("RitualWallet balance = 0 RITUAL — ticks will be silently dropped");
  if (rwLock != null && rwLock < block) issues.push("RitualWallet lock expired — startAutomation will revert");
  if (!schedId || schedId === 0n)     issues.push("No active schedule — automation not started");
  if (p?._norm?.executor === "0x0000000000000000000000000000000000000000") issues.push("executor = address(0) — registerPortfolio required");
  if (schedId != null && schedId === 0n) issues.push("scheduleId = 0 — startAutomation not called");

  if (issues.length === 0) {
    console.log("  No obvious issues found — check for TickFailed events on-chain");
  } else {
    issues.forEach((i, n) => console.log(`  [${n+1}] ${i}`));
  }
  console.log("\n" + "═".repeat(58));
}

main().catch(e => { console.error(e); process.exit(1); });
