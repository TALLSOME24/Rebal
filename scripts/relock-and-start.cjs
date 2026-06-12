/**
 * Re-locks the RitualWallet for PortfolioAgent v6, then starts automation.
 *
 * Why: startAutomation requires lockUntil(address(this)) >= block + TTL.
 * After the previous schedule completes/expires the lock is not auto-renewed,
 * so depositFeesForCaller must be called again before startAutomation.
 *
 * Run: node scripts/relock-and-start.cjs
 */
require("dotenv").config();
const {
  createPublicClient,
  createWalletClient,
  http,
  parseGwei,
  parseEther,
  formatEther,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const RITUAL_RPC = process.env.RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";
const AGENT  = "0xee71797530a584E9391F8E97E9BA6E91DBAe3c5e"; // v8
const WALLET = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";

const PK = process.env.PRIVATE_KEY;
if (!PK) { console.error("PRIVATE_KEY not set in .env"); process.exit(1); }
const account = privateKeyToAccount(PK);

const chain = {
  id: 1979,
  name: "Ritual",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: { default: { http: [RITUAL_RPC] } },
};

const pub  = createPublicClient({ chain, transport: http() });
const wall = createWalletClient({ account, chain, transport: http() });

const agentAbi = [
  {
    name: "depositFeesForCaller",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "lockDurationBlocks", type: "uint256" }],
    outputs: [],
  },
  {
    name: "startAutomation",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "frequencyBlocks", type: "uint32" },
      { name: "numCycles",       type: "uint32" },
      { name: "gasLimit",        type: "uint32" },
      { name: "maxFeePerGas",    type: "uint256" },
      { name: "schedulerTtl",    type: "uint32" },
    ],
    outputs: [],
  },
  {
    name: "portfolios",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "registered",  type: "bool"    },
      { name: "riskMode",    type: "uint8"   },
      { name: "ethBps",      type: "uint16"  },
      { name: "wbtcBps",     type: "uint16"  },
      { name: "usdcBps",     type: "uint16"  },
      { name: "executor",    type: "address" },
      { name: "scheduleId",  type: "uint256" },
      { name: "httpExecutor", type: "address" },
    ],
  },
  {
    type: "event",
    name: "AutomationScheduled",
    inputs: [
      { name: "owner",     type: "address", indexed: true  },
      { name: "callId",    type: "uint256", indexed: true  },
      { name: "frequency", type: "uint32",  indexed: false },
      { name: "numCalls",  type: "uint32",  indexed: false },
    ],
  },
];

const walletAbi = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "lockUntil", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
];

// Parameters — must match what startAutomation validates
const FREQ      = 80;
const CYCLES    = 12;           // 24 total ticks (HTTP+LLM pairs)
const GAS       = 3_000_000;
const TTL       = 350;
const MAX_FEE   = parseGwei("30");
const LOCK_DUR  = 200_000n;     // >> TTL, gives ~20 days of lock on Ritual testnet
const DEPOSIT   = parseEther("0.35"); // top up + lock

async function main() {
  const block = await pub.getBlockNumber();
  console.log("═".repeat(58));
  console.log("  relock-and-start  —  PortfolioAgent v6");
  console.log("═".repeat(58));
  console.log("  agent  :", AGENT);
  console.log("  owner  :", account.address);
  console.log("  block  :", block.toString());

  // Pre-flight
  const p = await pub.readContract({ address: AGENT, abi: agentAbi, functionName: "portfolios", args: [account.address] });
  const registered = p.registered ?? p[0];
  const executor   = p.executor   ?? p[5];
  console.log("\n  registered :", registered ? "YES" : "NO ← ABORT");
  if (!registered) { console.error("Portfolio not registered."); process.exit(1); }
  console.log("  executor   :", executor);
  if (!executor || executor === "0x0000000000000000000000000000000000000000") {
    console.error("executor = address(0) — call registerPortfolio first"); process.exit(1);
  }

  const rwBal  = await pub.readContract({ address: WALLET, abi: walletAbi, functionName: "balanceOf", args: [AGENT] });
  const rwLock = await pub.readContract({ address: WALLET, abi: walletAbi, functionName: "lockUntil", args: [AGENT] });
  console.log("\n  RitualWallet balance :", formatEther(rwBal), "RITUAL");
  console.log("  lockUntil            :", rwLock.toString(), rwLock < block ? "(EXPIRED)" : "(valid)");

  // Step 1 — depositFeesForCaller to re-extend lock
  console.log("\n─".repeat(58));
  console.log("  Step 1: depositFeesForCaller");
  console.log(`    lockDurationBlocks : ${LOCK_DUR.toString()}`);
  console.log(`    value              : ${formatEther(DEPOSIT)} RITUAL`);

  let depositHash;
  try {
    depositHash = await wall.writeContract({
      address: AGENT,
      abi: agentAbi,
      functionName: "depositFeesForCaller",
      args: [LOCK_DUR],
      value: DEPOSIT,
    });
  } catch (err) {
    console.error("\n  depositFeesForCaller FAILED:", err.shortMessage || err.message);
    process.exit(1);
  }
  console.log("  TX:", depositHash);
  const depositReceipt = await pub.waitForTransactionReceipt({ hash: depositHash });
  console.log("  status:", depositReceipt.status === "success" ? "SUCCESS ✓" : "REVERTED ✗");
  if (depositReceipt.status !== "success") { console.error("  Deposit reverted."); process.exit(1); }

  // Verify lock is now valid
  const newLock = await pub.readContract({ address: WALLET, abi: walletAbi, functionName: "lockUntil", args: [AGENT] });
  const newBal  = await pub.readContract({ address: WALLET, abi: walletAbi, functionName: "balanceOf", args: [AGENT] });
  console.log("  new lockUntil :", newLock.toString(), "(must be ≥", (block + BigInt(TTL)).toString(), ")");
  console.log("  new balance   :", formatEther(newBal), "RITUAL");
  if (newLock < block + BigInt(TTL)) {
    console.error("  Lock still too short — unexpected."); process.exit(1);
  }

  // Step 2 — startAutomation
  console.log("\n─".repeat(58));
  console.log("  Step 2: startAutomation");
  console.log(`    frequencyBlocks : ${FREQ}`);
  console.log(`    numCycles       : ${CYCLES}  (${CYCLES * 2} total ticks)`);
  console.log(`    gasLimit        : ${GAS.toLocaleString()}`);
  console.log(`    maxFeePerGas    : ${Number(MAX_FEE) / 1e9} gwei`);
  console.log(`    schedulerTtl    : ${TTL} blocks`);

  let startHash;
  try {
    startHash = await wall.writeContract({
      address: AGENT,
      abi: agentAbi,
      functionName: "startAutomation",
      args: [FREQ, CYCLES, GAS, MAX_FEE, TTL],
    });
  } catch (err) {
    console.error("\n  startAutomation FAILED:", err.shortMessage || err.message);
    process.exit(1);
  }
  console.log("  TX:", startHash);
  const startReceipt = await pub.waitForTransactionReceipt({ hash: startHash });
  console.log("  status:", startReceipt.status === "success" ? "SUCCESS ✓" : "REVERTED ✗");
  if (startReceipt.status !== "success") { console.error("  startAutomation reverted."); process.exit(1); }

  // Decode schedule ID from logs
  let newCallId = "unknown";
  const schedLog = startReceipt.logs.find(l => l.address.toLowerCase() === AGENT.toLowerCase() && l.topics.length === 3);
  if (schedLog) newCallId = BigInt(schedLog.topics[2]).toString();

  console.log("\n" + "═".repeat(58));
  console.log("  DONE");
  console.log("  new scheduleId :", newCallId);
  console.log("  first tick fires in ~", FREQ, "blocks (~", Math.round(FREQ * 350 / 60), "seconds)");
  console.log("  Run: node scripts/check-agent.cjs to verify");
  console.log("═".repeat(58));
}

main().catch(e => { console.error(e); process.exit(1); });
