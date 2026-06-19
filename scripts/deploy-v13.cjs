/**
 * Deploy PortfolioAgent v13 + PortfolioAgentFactory v4 (security audit fixes).
 * Run: node scripts/deploy-v13.cjs
 *
 * Steps:
 *   1. Deploy PortfolioAgentFactory v4 (with AgentOverridden event, allAgents fix)
 *   2. Call deployAgent() to get a v13 PortfolioAgent
 *   3. Register portfolio (Balanced: 40/30/20/10)
 *   4. depositFeesForCaller (0.05 RITUAL)
 *   5. overrideAgent in factory to point user → v13 agent
 *   6. startAutomation (freq=5000, numCalls=2, gas=3M, maxFee=1gwei, ttl=500)
 *   7. Write .factory-address.json
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {
  createPublicClient,
  createWalletClient,
  http,
  parseGwei,
  parseEther,
  formatEther,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

// ─── Chain / account ─────────────────────────────────────────────────────────
const RITUAL_RPC = process.env.RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";
const PK = process.env.PRIVATE_KEY;
if (!PK) { console.error("PRIVATE_KEY not set"); process.exit(1); }
const account = privateKeyToAccount(PK);

const chain = {
  id: 1979,
  name: "Ritual",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: { default: { http: [RITUAL_RPC] } },
};
const pub  = createPublicClient({ chain, transport: http() });
const wall = createWalletClient({ account, chain, transport: http() });

// ─── Bytecode (compiled inline via solc) — we'll use the pre-built artifacts ─
// Read from hardhat artifacts if available, otherwise error with clear message.
function loadArtifact(name) {
  const paths = [
    path.join(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`),
    path.join(__dirname, `../artifacts/contracts/dex/${name}.sol/${name}.json`),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  }
  throw new Error(`Artifact not found for ${name}. Run: npx hardhat compile`);
}

// ─── Automation params (same as v12) ─────────────────────────────────────────
const FREQ      = 5000;
const NUM_CALLS = 2;
const GAS       = 3_000_000;
const TTL       = 500;
const MAX_FEE   = parseGwei("1");
const LOCK_DUR  = 200_000n;
const DEPOSIT   = parseEther("0.05");

// ─── Known addresses ──────────────────────────────────────────────────────────
const DEX_ROUTER  = process.env.DEX_ROUTER  || "0xB44b8646281886Bc3F63280C1287CF1349A936b9";
const RITUAL_WALLET = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";

const walletAbi = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "lockUntil", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
];

// ─── Minimal ABIs ─────────────────────────────────────────────────────────────
const agentAbi = [
  { name: "registerPortfolio", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "risk",      type: "uint8"  },
      { name: "ethBps_",   type: "uint16" },
      { name: "wbtcBps_",  type: "uint16" },
      { name: "usdcBps_",  type: "uint16" },
    ], outputs: [] },
  { name: "depositFeesForCaller", type: "function", stateMutability: "payable",
    inputs: [{ name: "lockDurationBlocks", type: "uint256" }], outputs: [] },
  { name: "startAutomation", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "frequencyBlocks", type: "uint32"  },
      { name: "numCalls",        type: "uint32"  },
      { name: "gasLimit",        type: "uint32"  },
      { name: "maxFeePerGas",    type: "uint256" },
      { name: "schedulerTtl",    type: "uint32"  },
    ], outputs: [] },
  { name: "portfolios", type: "function", stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "registered",  type: "bool"    },
      { name: "riskMode",    type: "uint8"   },
      { name: "ethBps",      type: "uint16"  },
      { name: "wbtcBps",     type: "uint16"  },
      { name: "usdcBps",     type: "uint16"  },
      { name: "executor",    type: "address" },
      { name: "scheduleId",  type: "uint256" },
    ] },
  {
    type: "event", name: "AutomationScheduled",
    inputs: [
      { name: "owner",     type: "address", indexed: true  },
      { name: "callId",    type: "uint256", indexed: true  },
      { name: "frequency", type: "uint32",  indexed: false },
      { name: "numCalls",  type: "uint32",  indexed: false },
    ],
  },
];

const factoryAbi = [
  { name: "deployAgent", type: "function", stateMutability: "nonpayable",
    inputs: [], outputs: [{ type: "address" }] },
  { name: "overrideAgent", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "user", type: "address" }, { name: "agent", type: "address" }], outputs: [] },
  { name: "agentOf", type: "function", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }], outputs: [{ type: "address" }] },
  {
    type: "event", name: "AgentDeployed",
    inputs: [
      { name: "user",  type: "address", indexed: true },
      { name: "agent", type: "address", indexed: true },
    ],
  },
];

async function send(label, fn) {
  let hash;
  try { hash = await fn(); }
  catch (err) {
    console.error(`  ${label} FAILED:`, err.shortMessage || err.message.slice(0, 120));
    process.exit(1);
  }
  console.log(`  TX (${label}):`, hash);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") { console.error(`  ${label} REVERTED`); process.exit(1); }
  console.log(`  status: SUCCESS`);
  return r;
}

async function main() {
  const block = await pub.getBlockNumber();
  console.log("=".repeat(58));
  console.log("  deploy-v13  —  PortfolioAgent v13 + Factory v4");
  console.log("=".repeat(58));
  console.log("  deployer :", account.address);
  console.log("  block    :", block.toString());
  console.log("  DEX      :", DEX_ROUTER);

  // Load artifacts
  let factoryArtifact, agentArtifact;
  try {
    factoryArtifact = loadArtifact("PortfolioAgentFactory");
    agentArtifact   = loadArtifact("PortfolioAgent");
  } catch (e) {
    console.error("\n  ERROR:", e.message);
    console.error("  Run: npx hardhat compile   then retry.");
    process.exit(1);
  }
  console.log("  artifacts loaded ✓");

  // ── Step 1: Deploy Factory v4 ────────────────────────────────────────────
  console.log("\n" + "-".repeat(58));
  console.log("  Step 1: Deploy PortfolioAgentFactory v4");
  const factoryReceipt = await send("deployFactory", () =>
    wall.deployContract({
      abi:      factoryArtifact.abi,
      bytecode: factoryArtifact.bytecode,
      args:     [DEX_ROUTER],
    })
  );
  const FACTORY = factoryReceipt.contractAddress;
  console.log("  Factory v4 :", FACTORY);

  // ── Step 2: deployAgent() via factory ───────────────────────────────────
  console.log("\n" + "-".repeat(58));
  console.log("  Step 2: deployAgent() via factory");
  const deployReceipt = await send("deployAgent", () =>
    wall.writeContract({ address: FACTORY, abi: factoryAbi, functionName: "deployAgent" })
  );

  // Extract agent address from AgentDeployed event
  const deployedTopic = "0x" + require("crypto")
    .createHash("sha256").update("").digest("hex"); // placeholder
  let AGENT = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "agentOf", args: [account.address] });
  console.log("  Agent v13  :", AGENT);

  // ── Step 3: registerPortfolio (Balanced: 40/30/20/10) ───────────────────
  console.log("\n" + "-".repeat(58));
  console.log("  Step 3: registerPortfolio (Balanced, 40/30/20/10)");
  await send("registerPortfolio", () =>
    wall.writeContract({
      address: AGENT, abi: agentAbi, functionName: "registerPortfolio",
      args: [1, 4000, 3000, 2000],
    })
  );

  // ── Step 4: depositFeesForCaller ────────────────────────────────────────
  console.log("\n" + "-".repeat(58));
  console.log("  Step 4: depositFeesForCaller (0.05 RITUAL, lock 200k blocks)");
  await send("depositFees", () =>
    wall.writeContract({
      address: AGENT, abi: agentAbi, functionName: "depositFeesForCaller",
      args: [LOCK_DUR], value: DEPOSIT,
    })
  );

  const rwBal  = await pub.readContract({ address: RITUAL_WALLET, abi: walletAbi, functionName: "balanceOf", args: [AGENT] });
  const rwLock = await pub.readContract({ address: RITUAL_WALLET, abi: walletAbi, functionName: "lockUntil", args: [AGENT] });
  console.log("  RW balance :", formatEther(rwBal), "RITUAL");
  console.log("  lockUntil  :", rwLock.toString(), "(must be >=", (block + BigInt(TTL)).toString(), ")");
  if (rwLock < block + BigInt(TTL)) {
    console.error("  Lock too short — abort."); process.exit(1);
  }

  // ── Step 5: startAutomation ──────────────────────────────────────────────
  console.log("\n" + "-".repeat(58));
  console.log("  Step 5: startAutomation");
  console.log(`    freq=${FREQ} numCalls=${NUM_CALLS} gas=${GAS} maxFee=1gwei ttl=${TTL}`);
  const startReceipt = await send("startAutomation", () =>
    wall.writeContract({
      address: AGENT, abi: agentAbi, functionName: "startAutomation",
      args: [FREQ, NUM_CALLS, GAS, MAX_FEE, TTL],
    })
  );

  // Decode scheduleId from AutomationScheduled log
  let scheduleId = "unknown";
  const schedLog = startReceipt.logs.find(
    l => l.address.toLowerCase() === AGENT.toLowerCase() && l.topics.length === 3
  );
  if (schedLog) scheduleId = BigInt(schedLog.topics[2]).toString();
  console.log("  scheduleId :", scheduleId);

  // ── Write .factory-address.json ───────────────────────────────────────────
  const out = {
    factoryV4:  FACTORY,
    agentV13:   AGENT,
    dexRouter:  DEX_ROUTER,
    deployedAt: block.toString(),
    scheduleId,
  };
  fs.writeFileSync(".factory-address.json", JSON.stringify(out, null, 2));
  console.log("\n  Wrote .factory-address.json");

  console.log("\n" + "=".repeat(58));
  console.log("  DONE");
  console.log("  Factory v4 :", FACTORY);
  console.log("  Agent v13  :", AGENT);
  console.log("  scheduleId :", scheduleId);
  console.log("  Update lib/constants.ts with these addresses.");
  console.log("=".repeat(58));
}

main().catch(e => { console.error(e); process.exit(1); });
