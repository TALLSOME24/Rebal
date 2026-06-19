/**
 * Clears the stuck pendingJobId on PortfolioAgent v12.
 * Run: node scripts/clear-pending-job.cjs
 */
require("dotenv").config();
const { createPublicClient, createWalletClient, http, toHex } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const RITUAL_RPC = process.env.RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";
const AGENT      = process.env.AGENT_ADDRESS   || "0x607ac0c71a855f6df488868210a0b2d6e4eebbc1";

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
    name: "pendingJobId",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "lastCycleId",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "clearPendingJob",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "portfolioOwner", type: "address" }],
    outputs: [],
  },
];

const ZERO_JOB = "0x0000000000000000000000000000000000000000000000000000000000000000";

async function readState(label) {
  const jobId   = await pub.readContract({ address: AGENT, abi: agentAbi, functionName: "pendingJobId", args: [account.address] });
  const cycleId = await pub.readContract({ address: AGENT, abi: agentAbi, functionName: "lastCycleId",  args: [account.address] });
  console.log(`\n  [${label}]`);
  console.log("  pendingJobId :", jobId);
  console.log("  lastCycleId  :", cycleId.toString());
  const stuck = jobId !== ZERO_JOB;
  console.log("  stuck        :", stuck ? `YES — ${jobId}` : "NO — agent is idle");
  return { jobId, cycleId, stuck };
}

// Check if clearPendingJob selector exists in deployed bytecode
async function functionExistsOnChain() {
  // selector: keccak256("clearPendingJob(address)")[0:4]
  // = 0x... compute it
  const { keccak256, toBytes } = require("viem");
  const sel = keccak256(toBytes("clearPendingJob(address)")).slice(0, 10); // "0x" + 8 hex chars
  console.log("\n  clearPendingJob selector :", sel);
  const code = await pub.getCode({ address: AGENT });
  if (!code || code.length < 4) { console.log("  bytecode     : NOT DEPLOYED"); return false; }
  const exists = code.toLowerCase().includes(sel.slice(2).toLowerCase());
  console.log("  in bytecode  :", exists ? "YES — function exists on deployed contract" : "NO — function missing, redeploy required");
  return exists;
}

async function main() {
  const block = await pub.getBlockNumber();
  console.log("=".repeat(58));
  console.log("  clear-pending-job  --  PortfolioAgent v12");
  console.log("=".repeat(58));
  console.log("  agent  :", AGENT);
  console.log("  owner  :", account.address);
  console.log("  block  :", block.toString());

  // 1. Verify function exists in deployed bytecode
  console.log("\n" + "-".repeat(58));
  console.log("  Step 1: Verify clearPendingJob() in deployed bytecode");
  const exists = await functionExistsOnChain();

  if (!exists) {
    console.log("\n  RESULT: clearPendingJob() is NOT on the deployed contract.");
    console.log("  Action: Redeploy contract with clearPendingJob() added.");
    console.log("=".repeat(58));
    process.exit(0);
  }

  // 2. Read state before
  console.log("\n" + "-".repeat(58));
  console.log("  Step 2: State BEFORE clear");
  const before = await readState("before");

  if (!before.stuck) {
    console.log("\n  pendingJobId is already zero — nothing to clear.");
    console.log("=".repeat(58));
    process.exit(0);
  }

  // 3. Call clearPendingJob
  console.log("\n" + "-".repeat(58));
  console.log("  Step 3: clearPendingJob(" + account.address + ")");
  let hash;
  try {
    hash = await wall.writeContract({
      address: AGENT,
      abi: agentAbi,
      functionName: "clearPendingJob",
      args: [account.address],
    });
  } catch (err) {
    console.error("  clearPendingJob FAILED:", err.shortMessage || err.message);
    process.exit(1);
  }
  console.log("  TX:", hash);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log("  status:", receipt.status === "success" ? "SUCCESS" : "REVERTED");
  if (receipt.status !== "success") {
    console.error("  Transaction reverted.");
    process.exit(1);
  }

  // 4. Read state after
  console.log("\n" + "-".repeat(58));
  console.log("  Step 4: State AFTER clear");
  const after = await readState("after");

  console.log("\n" + "=".repeat(58));
  console.log("  RESULT");
  if (!after.stuck) {
    console.log("  pendingJobId cleared — agent is now idle and ready for a new schedule.");
  } else {
    console.log("  WARNING: pendingJobId still set:", after.jobId);
  }
  console.log("=".repeat(58));
}

main().catch(e => { console.error(e.shortMessage || e.message); process.exit(1); });
