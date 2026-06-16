/**
 * Fetch ALL events from the PortfolioAgent contract starting from the scheduler start block.
 * Uses eth_getLogs with no topic filter to catch every event emitted.
 */
require("dotenv").config();
const { createPublicClient, http, decodeEventLog, hexToString } = require("viem");

const RITUAL_RPC = process.env.RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";
const AGENT = "0xc94Fcf97F441Ae6a693b8D2C7794778AEeA06Ea6";
const FROM_BLOCK = 33520322n;

const chain = {
  id: 1979,
  name: "Ritual",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: { default: { http: [RITUAL_RPC] } },
};

const pub = createPublicClient({ chain, transport: http() });

// Full ABI for decoding — all known events on PortfolioAgent v9
const AGENT_ABI = [
  {
    type: "event", name: "PortfolioRegistered",
    inputs: [
      { name: "owner",    type: "address", indexed: true },
      { name: "riskMode", type: "uint8",   indexed: false },
      { name: "ethBps",   type: "uint16",  indexed: false },
      { name: "wbtcBps",  type: "uint16",  indexed: false },
      { name: "usdcBps",  type: "uint16",  indexed: false },
    ],
  },
  {
    type: "event", name: "AutomationScheduled",
    inputs: [
      { name: "owner",     type: "address", indexed: true  },
      { name: "callId",    type: "uint256", indexed: true  },
      { name: "frequency", type: "uint32",  indexed: false },
      { name: "numCalls",  type: "uint32",  indexed: false },
    ],
  },
  {
    type: "event", name: "PricesSnapshot",
    inputs: [
      { name: "owner",       type: "address", indexed: true  },
      { name: "cycleId",     type: "uint256", indexed: false },
      { name: "tickIdx",     type: "uint256", indexed: false },
      { name: "ethPriceUsd", type: "uint256", indexed: false },
      { name: "btcPriceUsd", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event", name: "RebalanceDecision",
    inputs: [
      { name: "owner",             type: "address", indexed: true  },
      { name: "cycleId",           type: "uint256", indexed: false },
      { name: "tickIdx",           type: "uint256", indexed: false },
      { name: "llmHasError",       type: "bool",    indexed: false },
      { name: "completionPayload", type: "bytes",   indexed: false },
      { name: "errorMessage",      type: "string",  indexed: false },
    ],
  },
  {
    type: "event", name: "TickFailed",
    inputs: [
      { name: "owner",   type: "address", indexed: true  },
      { name: "tickIdx", type: "uint256", indexed: false },
      { name: "phase",   type: "string",  indexed: false },
      { name: "reason",  type: "string",  indexed: false },
    ],
  },
  {
    type: "event", name: "SwapExecuted",
    inputs: [
      { name: "owner",     type: "address", indexed: true  },
      { name: "tokenIn",   type: "address", indexed: false },
      { name: "tokenOut",  type: "address", indexed: false },
      { name: "amountIn",  type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event", name: "TokenDeposited",
    inputs: [
      { name: "token",  type: "address", indexed: true  },
      { name: "from",   type: "address", indexed: true  },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event", name: "TokenWithdrawn",
    inputs: [
      { name: "token",  type: "address", indexed: true  },
      { name: "to",     type: "address", indexed: true  },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
];

// Build topic0 → ABI entry map for decoding
const { keccak256, toBytes, encodeEventTopics } = require("viem");

function sig(event) {
  const inputs = event.inputs.map((i) => i.type).join(",");
  return `${event.name}(${inputs})`;
}

async function main() {
  const latest = await pub.getBlockNumber();
  const from = FROM_BLOCK;
  const to = latest;

  console.log("═".repeat(64));
  console.log("  Event scan — PortfolioAgent v9");
  console.log("═".repeat(64));
  console.log(`  address    : ${AGENT}`);
  console.log(`  fromBlock  : ${from}`);
  console.log(`  toBlock    : ${to}  (latest)`);
  console.log(`  range      : ${to - from} blocks`);
  console.log();

  // Fetch ALL logs from the contract — no topic filter
  let logs;
  try {
    logs = await pub.request({
      method: "eth_getLogs",
      params: [{
        address: AGENT,
        fromBlock: "0x" + from.toString(16),
        toBlock:   "0x" + to.toString(16),
      }],
    });
  } catch (err) {
    console.error("eth_getLogs failed:", err.message);
    process.exit(1);
  }

  console.log(`  Total raw logs: ${logs.length}`);
  console.log();

  if (logs.length === 0) {
    console.log("  ⚠  No events found at all — scheduler may not be triggering.");
    console.log("     Check if scheduleId is still SCHEDULED on the Ritual explorer.");
    return;
  }

  // Build a map: topic0 hex → event definition
  const sig2abi = {};
  for (const ev of AGENT_ABI) {
    const inputs = ev.inputs.map((i) => i.type).join(",");
    const signature = `${ev.name}(${inputs})`;
    const topic0 = keccak256(toBytes(signature));
    sig2abi[topic0.toLowerCase()] = ev;
  }

  // Decode and print each log
  const counts = {};
  for (const log of logs) {
    const topic0 = log.topics?.[0]?.toLowerCase();
    const evDef = topic0 ? sig2abi[topic0] : undefined;
    const evName = evDef?.name ?? `UNKNOWN(${topic0?.slice(0, 10)}…)`;
    counts[evName] = (counts[evName] ?? 0) + 1;

    const blockNum = BigInt(log.blockNumber).toString();
    const txHash = log.transactionHash;

    console.log(`─────────────────────────────────────────────────────────────`);
    console.log(`  Event     : ${evName}`);
    console.log(`  Block     : ${blockNum}`);
    console.log(`  Tx        : ${txHash}`);

    if (evDef) {
      try {
        const decoded = decodeEventLog({
          abi: [evDef],
          data: log.data,
          topics: log.topics,
        });
        const args = decoded.args;
        for (const [k, v] of Object.entries(args)) {
          if (k === "completionPayload" && v && v !== "0x") {
            try {
              const text = Buffer.from(v.slice(2), "hex").toString("utf8");
              const parsed = JSON.parse(text);
              console.log(`  ${k.padEnd(18)}: (JSON) ${JSON.stringify(parsed).slice(0, 300)}`);
            } catch {
              console.log(`  ${k.padEnd(18)}: ${String(v).slice(0, 120)}`);
            }
          } else {
            console.log(`  ${k.padEnd(18)}: ${String(v)}`);
          }
        }
      } catch (decErr) {
        console.log(`  (decode failed: ${decErr.message})`);
        console.log(`  data     : ${log.data?.slice(0, 80)}…`);
      }
    } else {
      console.log(`  topics   : ${log.topics.join(", ")}`);
      console.log(`  data     : ${log.data?.slice(0, 80)}${log.data?.length > 80 ? "…" : ""}`);
    }
  }

  console.log();
  console.log("═".repeat(64));
  console.log("  SUMMARY");
  console.log("═".repeat(64));
  for (const [name, count] of Object.entries(counts)) {
    console.log(`  ${name.padEnd(24)}: ${count}`);
  }
  console.log();

  const hasDecision = !!counts["RebalanceDecision"];
  const hasFailed   = !!counts["TickFailed"];
  const hasSnapshot = !!counts["PricesSnapshot"];

  if (!hasSnapshot && !hasDecision && !hasFailed) {
    console.log("  ⚠  Only non-tick events found (registration / scheduling).");
    console.log("     The scheduler has not triggered a tick yet, OR the");
    console.log("     Infernet node is not picking up the schedule.");
  } else if (hasSnapshot && !hasDecision) {
    console.log("  HTTP ticks are firing (PricesSnapshot) but LLM ticks are not");
    console.log("  completing. TickFailed events would indicate the failure reason.");
  } else if (hasDecision) {
    console.log("  ✓ RebalanceDecision events found — LLM ticks are completing.");
  }
  if (hasFailed) {
    console.log("  ✗ TickFailed events found — see reason fields above.");
  }
  console.log("═".repeat(64));
}

main().catch((e) => { console.error(e); process.exit(1); });
