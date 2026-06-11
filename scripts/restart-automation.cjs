/**
 * Calls startAutomation on PortfolioAgent v4.
 * The existing terminal schedule (2380345) will be silently skipped by the
 * try/catch in startAutomation; tickIndex is reset to 0.
 *
 * Run: node scripts/restart-automation.cjs
 */
require("dotenv").config();
const {
  createPublicClient,
  createWalletClient,
  http,
  parseGwei,
  formatEther,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const RITUAL_RPC =
  process.env.RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";
const AGENT = "0x971681AB0aeE3E4ED237305618CB95e2cEA3f4db";

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
    ],
  },
  {
    name: "tickIndex",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "uint256" }],
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

// Parameters — must match deployment_history constraints:
//   frequency × numCycles × 2 ≤ 10000 (lifespan)
//   gasLimit ≥ 3_000_000
//   schedulerTtl ≥ 300, ≤ 500
const FREQ    = 80;   // blocks between ticks
const CYCLES  = 12;   // HTTP+LLM pairs → 24 total ticks → lifespan=1920 ✓
const GAS     = 3_000_000;
const TTL     = 350;  // blocks per-tick TTL
const MAX_FEE = parseGwei("30"); // 30 gwei

async function main() {
  const block = await pub.getBlockNumber();
  const basefee = await pub
    .getBlock({ blockNumber: block })
    .then((b) => b.baseFeePerGas)
    .catch(() => null);

  console.log("═".repeat(58));
  console.log("  restart-automation  —  Ritual Testnet (1979)");
  console.log("═".repeat(58));
  console.log("  agent    :", AGENT);
  console.log("  owner    :", account.address);
  console.log("  block    :", block.toString());
  console.log("  basefee  :", basefee ? `${Number(basefee) / 1e9} gwei` : "n/a");

  // Pre-flight: confirm portfolio is registered
  const p = await pub.readContract({
    address: AGENT,
    abi: agentAbi,
    functionName: "portfolios",
    args: [account.address],
  });
  const registered = p.registered ?? p[0];
  const executor   = p.executor   ?? p[5];
  const oldSchedId = p.scheduleId ?? p[6] ?? 0n;
  console.log("\n  portfolio registered :", registered ? "YES" : "NO ← ABORT");
  if (!registered) {
    console.error("Portfolio not registered — call registerPortfolio first");
    process.exit(1);
  }
  console.log("  executor             :", executor);
  console.log("  old scheduleId       :", oldSchedId.toString());

  const tick = await pub.readContract({
    address: AGENT,
    abi: agentAbi,
    functionName: "tickIndex",
    args: [account.address],
  });
  console.log("  tickIndex (before)   :", tick.toString());

  console.log("\n  Sending startAutomation...");
  console.log(`    frequencyBlocks : ${FREQ}`);
  console.log(`    numCycles       : ${CYCLES}  (${CYCLES * 2} total ticks)`);
  console.log(`    gasLimit        : ${GAS.toLocaleString()}`);
  console.log(`    maxFeePerGas    : ${Number(MAX_FEE) / 1e9} gwei`);
  console.log(`    schedulerTtl    : ${TTL} blocks`);

  let hash;
  try {
    hash = await wall.writeContract({
      address: AGENT,
      abi: agentAbi,
      functionName: "startAutomation",
      args: [FREQ, CYCLES, GAS, MAX_FEE, TTL],
    });
  } catch (err) {
    console.error("\n  TX FAILED:", err.shortMessage || err.message);
    process.exit(1);
  }

  console.log("\n  TX submitted:", hash);
  console.log("  Waiting for receipt...");

  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log("  status      :", receipt.status === "success" ? "SUCCESS" : "REVERTED");
  console.log("  gasUsed     :", receipt.gasUsed.toString());

  if (receipt.status !== "success") {
    console.error("  Transaction reverted — check gas or contract state");
    process.exit(1);
  }

  // Decode AutomationScheduled log
  const iface = agentAbi.find((x) => x.name === "AutomationScheduled");
  const schedLog = receipt.logs.find(
    (l) =>
      l.address.toLowerCase() === AGENT.toLowerCase() && l.topics.length === 3
  );

  let newCallId = "unknown";
  if (schedLog) {
    // topic[1] = owner (indexed), topic[2] = callId (indexed)
    newCallId = BigInt(schedLog.topics[2]).toString();
  }

  const tickAfter = await pub.readContract({
    address: AGENT,
    abi: agentAbi,
    functionName: "tickIndex",
    args: [account.address],
  });

  console.log("\n" + "═".repeat(58));
  console.log("  NEW scheduleId  :", newCallId);
  console.log("  tickIndex (after):", tickAfter.toString());
  console.log("  Expected: first HTTP tick fires in ~", FREQ, "blocks");
  console.log("           (~", Math.round((FREQ * 350) / 60), "seconds at 350ms/block)");
  console.log("\n  Now run: node scripts/check-agent.cjs");
  console.log("  And watch for PricesSnapshot + RebalanceDecision events");
  console.log("═".repeat(58));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
