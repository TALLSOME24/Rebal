/**
 * Cancels the active automation schedule on PortfolioAgent v12.
 * Run: node scripts/cancel-schedule.cjs
 */
require("dotenv").config();
const { createPublicClient, createWalletClient, http, formatEther } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const RITUAL_RPC = process.env.RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";
const AGENT      = process.env.AGENT_ADDRESS   || "0x607ac0c71a855f6df488868210a0b2d6e4eebbc1";
const SCHED      = "0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B";

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
    name: "cancelAutomation",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
];

const schedAbi = [
  {
    name: "getCallState",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "callId", type: "uint256" }],
    outputs: [{ name: "state", type: "uint8" }],
  },
  {
    name: "calls",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "callId", type: "uint256" }],
    outputs: [
      { name: "to",                   type: "address" },
      { name: "caller",               type: "address" },
      { name: "startBlock",           type: "uint32"  },
      { name: "numCalls",             type: "uint32"  },
      { name: "frequency",            type: "uint32"  },
      { name: "gas",                  type: "uint32"  },
      { name: "ttl",                  type: "uint32"  },
      { name: "state",                type: "uint8"   },
      { name: "maxFeePerGas",         type: "uint256" },
      { name: "maxPriorityFeePerGas", type: "uint256" },
      { name: "value",                type: "uint256" },
      { name: "data",                 type: "bytes"   },
    ],
  },
];

const CALL_STATES = ["SCHEDULED", "EXECUTING", "COMPLETED", "CANCELLED", "EXPIRED"];

async function checkSchedule(scheduleId) {
  try {
    const state = await pub.readContract({
      address: SCHED, abi: schedAbi, functionName: "getCallState", args: [scheduleId],
    });
    const info = await pub.readContract({
      address: SCHED, abi: schedAbi, functionName: "calls", args: [scheduleId],
    });
    const stateNum = Number(state);
    console.log("  scheduleId :", scheduleId.toString());
    console.log("  state      :", CALL_STATES[stateNum] ?? String(stateNum), `(${stateNum})`);
    console.log("  startBlock :", (info.startBlock ?? info[2])?.toString());
    console.log("  numCalls   :", (info.numCalls   ?? info[3])?.toString());
    console.log("  frequency  :", (info.frequency  ?? info[4])?.toString(), "blocks");
    console.log("  gas        :", (info.gas        ?? info[5])?.toString());
    return stateNum;
  } catch (e) {
    console.log("  could not read schedule:", e.shortMessage || e.message.slice(0, 80));
    return null;
  }
}

async function main() {
  const block = await pub.getBlockNumber();
  console.log("=".repeat(58));
  console.log("  cancel-schedule  --  PortfolioAgent v12");
  console.log("=".repeat(58));
  console.log("  agent  :", AGENT);
  console.log("  owner  :", account.address);
  console.log("  block  :", block.toString());

  // 1. Read current scheduleId from contract
  console.log("\n" + "-".repeat(58));
  console.log("  Step 1: Read scheduleId from contract");
  const p = await pub.readContract({
    address: AGENT, abi: agentAbi, functionName: "portfolios", args: [account.address],
  });
  const scheduleId = p.scheduleId ?? p[6] ?? 0n;
  console.log("  contract scheduleId :", scheduleId.toString());

  // Use hardcoded known ID as fallback if contract shows 0
  const TARGET_ID = scheduleId > 0n ? scheduleId : 2607359n;
  if (TARGET_ID !== scheduleId) {
    console.log("  (using known scheduleId 2607359 as fallback)");
  }

  // 2. Check current state before cancel
  console.log("\n" + "-".repeat(58));
  console.log("  Step 2: Schedule state BEFORE cancel");
  const stateBefore = await checkSchedule(TARGET_ID);

  if (stateBefore !== null && stateBefore >= 2) {
    console.log("\n  Schedule is already in terminal state (" + CALL_STATES[stateBefore] + ") -- no cancel needed.");
    console.log("  No RITUAL is being consumed.");
    console.log("=".repeat(58));
    return;
  }

  // 3. Call cancelAutomation() on the agent
  console.log("\n" + "-".repeat(58));
  console.log("  Step 3: cancelAutomation()");
  let cancelHash;
  try {
    cancelHash = await wall.writeContract({
      address: AGENT,
      abi: agentAbi,
      functionName: "cancelAutomation",
    });
  } catch (err) {
    console.error("  cancelAutomation FAILED:", err.shortMessage || err.message);
    process.exit(1);
  }
  console.log("  TX:", cancelHash);
  const receipt = await pub.waitForTransactionReceipt({ hash: cancelHash });
  console.log("  status:", receipt.status === "success" ? "SUCCESS" : "REVERTED");
  if (receipt.status !== "success") {
    console.error("  cancelAutomation reverted -- schedule may already be terminal.");
    process.exit(1);
  }

  // 4. Verify state after cancel
  console.log("\n" + "-".repeat(58));
  console.log("  Step 4: Schedule state AFTER cancel");
  const stateAfter = await checkSchedule(TARGET_ID);

  // 5. Also check what scheduleId the contract now shows
  const p2 = await pub.readContract({
    address: AGENT, abi: agentAbi, functionName: "portfolios", args: [account.address],
  });
  const newSchedId = p2.scheduleId ?? p2[6] ?? 0n;

  console.log("\n" + "=".repeat(58));
  console.log("  DONE");
  console.log("  Schedule state  :", stateAfter !== null ? (CALL_STATES[stateAfter] ?? String(stateAfter)) : "unknown");
  console.log("  contract sched  :", newSchedId.toString(), newSchedId === 0n ? "(cleared)" : "");
  const cancelled = stateAfter === 3;
  console.log("  Confirmed cancelled:", cancelled ? "YES -- no more ticks will fire" : "CHECK MANUALLY");
  console.log("=".repeat(58));
}

main().catch(e => { console.error(e); process.exit(1); });
