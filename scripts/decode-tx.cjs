/**
 * Decode a Ritual Chain transaction — topics, input data, AsyncJobTracker lookup.
 * Usage: TX=0x... node scripts/decode-tx.cjs
 */
require("dotenv").config();
const { createPublicClient, http, keccak256, toHex, decodeAbiParameters, parseAbiParameters, formatEther } = require("viem");

const TX_HASH = process.env.TX || "0x833665e39dde313239382f207126583b97196b571437d20d9b21a0f1f8349f91";
const RITUAL_RPC = process.env.RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";

const chain = {
  id: 1979,
  name: "Ritual",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: { default: { http: [RITUAL_RPC] } },
};

const pub = createPublicClient({ chain, transport: http() });

// ── known addresses ──────────────────────────────────────────────────────────
const SOVEREIGN_PRECOMPILE  = "0x000000000000000000000000000000000000080c";
const ASYNC_DELIVERY        = "0x5A16214fF555848411544b005f7Ac063742f39F6";
const AGENT_V10             = "0x26b3a6c452a9a24cb10fa7892340ca6cc7631016";
const RITUAL_WALLET         = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
const SCHEDULER_PRECOMPILE  = "0x0000000000000000000000000000000000000802";
// Ritual's AsyncJobTracker (if deployed)
const ASYNC_JOB_TRACKER     = "0x00000000000000000000000000000000000008a0"; // placeholder — check

// ── event signatures → topics ─────────────────────────────────────────────
const KNOWN_EVENTS = [
  // Our agent events
  { sig: "AutomationTriggered(address,bytes32)",         params: ["address","bytes32"],         indexed: [true,true],  name: "AutomationTriggered" },
  { sig: "SovereignAgentJobSubmitted(bytes32)",          params: ["bytes32"],                   indexed: [true],       name: "SovereignAgentJobSubmitted" },
  { sig: "SovereignAgentResult(address,bytes32,bool,string)", params: ["address","bytes32","bool","string"], indexed: [true,true,false,false], name: "SovereignAgentResult" },
  { sig: "AutomationScheduled(address,uint256,uint32,uint32)", params: ["address","uint256","uint32","uint32"], indexed: [true,true,false,false], name: "AutomationScheduled" },
  { sig: "PortfolioRegistered(address,uint8,uint16,uint16,uint16)", params: ["address","uint8","uint16","uint16","uint16"], indexed: [true,false,false,false,false], name: "PortfolioRegistered" },
  // Ritual precompile / scheduler events
  { sig: "ComputeRequestCreated(bytes32,address,uint64)", params: ["bytes32","address","uint64"], indexed: [true,true,false], name: "ComputeRequestCreated" },
  { sig: "ComputeRequestFulfilled(bytes32,bytes)",        params: ["bytes32","bytes"],            indexed: [true,false],      name: "ComputeRequestFulfilled" },
  { sig: "JobScheduled(uint256,address,uint32,uint32)",   params: ["uint256","address","uint32","uint32"], indexed: [true,true,false,false], name: "JobScheduled" },
  { sig: "JobExecuted(uint256,address)",                  params: ["uint256","address"],          indexed: [true,true],       name: "JobExecuted" },
  { sig: "JobCancelled(uint256)",                         params: ["uint256"],                    indexed: [true],            name: "JobCancelled" },
  { sig: "AsyncJobCreated(bytes32,address)",              params: ["bytes32","address"],          indexed: [true,true],       name: "AsyncJobCreated" },
  { sig: "AsyncJobFulfilled(bytes32,bytes)",              params: ["bytes32","bytes"],            indexed: [true,false],      name: "AsyncJobFulfilled" },
  { sig: "AsyncJobFailed(bytes32,string)",               params: ["bytes32","string"],           indexed: [true,false],      name: "AsyncJobFailed" },
  // Generic transfer/approval
  { sig: "Transfer(address,address,uint256)",             params: ["address","address","uint256"],indexed: [true,true,false], name: "Transfer" },
];

// Compute topic0 for each known event
const TOPIC_MAP = {};
for (const ev of KNOWN_EVENTS) {
  const topic0 = keccak256(toHex(new TextEncoder().encode(ev.sig))).toLowerCase();
  // viem's keccak256(toHex(str)) gives the right answer for ASCII strings
  TOPIC_MAP[topic0] = ev;
}

// Helper: keccak256 of an ASCII string
function keccakStr(str) {
  // We need the hash of the UTF-8 bytes of the string (not its hex encoding)
  const bytes = Buffer.from(str, "utf8");
  const { keccak256: k } = require("viem");
  return k(bytes).toLowerCase();
}

// Re-build the map with correct hashes
const TOPIC_MAP2 = {};
for (const ev of KNOWN_EVENTS) {
  const bytes = Buffer.from(ev.sig, "utf8");
  const { keccak256: k } = require("viem");
  const topic0 = k(bytes).toLowerCase();
  TOPIC_MAP2[topic0] = ev;
}

function addrName(addr) {
  if (!addr) return "null";
  const a = addr.toLowerCase();
  if (a === SOVEREIGN_PRECOMPILE) return `SOVEREIGN_AGENT_PRECOMPILE(0x080C)`;
  if (a === ASYNC_DELIVERY.toLowerCase()) return `ASYNC_DELIVERY(${addr})`;
  if (a === AGENT_V10.toLowerCase()) return `PORTFOLIO_AGENT_V10(${addr})`;
  if (a === RITUAL_WALLET.toLowerCase()) return `RITUAL_WALLET(${addr})`;
  if (a === SCHEDULER_PRECOMPILE) return `SCHEDULER_PRECOMPILE(0x0802)`;
  return addr;
}

function decodeLog(log) {
  const topic0 = log.topics[0]?.toLowerCase();
  const ev = TOPIC_MAP2[topic0];
  if (!ev) return null;

  const indexedParams = ev.params.filter((_, i) => ev.indexed[i]);
  const nonIndexedParams = ev.params.filter((_, i) => !ev.indexed[i]);
  const indexedTopics = log.topics.slice(1);

  const decoded = { name: ev.name, args: {} };

  // Decode indexed params (each is ABI-encoded in a topic)
  let idxCursor = 0;
  ev.params.forEach((type, i) => {
    const argName = `arg${i}`;
    if (ev.indexed[i]) {
      const topic = indexedTopics[idxCursor++];
      if (!topic) return;
      try {
        if (type === "address") {
          decoded.args[argName] = "0x" + topic.slice(26);
        } else if (type === "bytes32") {
          decoded.args[argName] = topic;
        } else if (type.startsWith("uint") || type.startsWith("int")) {
          decoded.args[argName] = BigInt(topic).toString();
        } else {
          decoded.args[argName] = topic;
        }
      } catch { decoded.args[argName] = topic; }
    }
  });

  // Decode non-indexed from data
  if (nonIndexedParams.length > 0 && log.data && log.data !== "0x") {
    try {
      const vals = decodeAbiParameters(
        nonIndexedParams.map(p => ({ type: p })),
        log.data
      );
      let ni = 0;
      ev.params.forEach((type, i) => {
        if (!ev.indexed[i]) {
          decoded.args[`arg${i}`] = typeof vals[ni] === "bigint" ? vals[ni].toString() : vals[ni];
          ni++;
        }
      });
    } catch (e) {
      decoded.args._dataDecodeError = e.message;
    }
  }

  return decoded;
}

async function main() {
  console.log("═".repeat(68));
  console.log("  TX DECODER — Ritual Chain 1979");
  console.log("  " + TX_HASH);
  console.log("═".repeat(68));

  // ── Fetch tx + receipt in parallel ────────────────────────────────────────
  const [tx, receipt, block] = await Promise.all([
    pub.getTransaction({ hash: TX_HASH }),
    pub.getTransactionReceipt({ hash: TX_HASH }),
    pub.getBlockNumber(),
  ]);

  if (!tx) { console.error("Transaction not found."); process.exit(1); }

  // ── 1. Transaction overview ───────────────────────────────────────────────
  console.log("\n┌── 1 · TRANSACTION ────────────────────────────────────────");
  console.log(`  hash         : ${tx.hash}`);
  console.log(`  block        : ${tx.blockNumber?.toString()} (current: ${block})`);
  console.log(`  from         : ${tx.from}  (${addrName(tx.from)})`);
  console.log(`  to           : ${tx.to}    (${addrName(tx.to)})`);
  console.log(`  value        : ${formatEther(tx.value ?? 0n)} RITUAL`);
  console.log(`  gas          : ${tx.gas?.toString()}`);
  console.log(`  gasPrice     : ${tx.gasPrice ? (Number(tx.gasPrice) / 1e9).toFixed(4) + " gwei" : "n/a"}`);
  console.log(`  nonce        : ${tx.nonce}`);
  console.log(`  type         : ${tx.type}`);

  // ── 2. Input data ─────────────────────────────────────────────────────────
  console.log("\n┌── 2 · INPUT DATA ─────────────────────────────────────────");
  const input = tx.input || tx.data || "0x";
  console.log(`  raw (hex)    : ${input}`);
  const selector = input.slice(0, 10);
  console.log(`  selector     : ${selector}`);

  // Known selectors
  const SELECTORS = {
    "0x8ca12055": "deliverCompute(bytes32 jobId, bytes result)",
    "0x12065fe0": "getBalance()",
    "0x449a52f8": "mintTo(address,uint256)",
    "0x2e1a7d4d": "withdraw(uint256)",
    "0x5c975abb": "paused()",
    "0xa1a6d575": "cancelAutomation()",
    "0x3f7c4a6b": "startAutomation(uint32,uint32,uint32,uint256,uint32)",
    "0x4e02c63c": "depositFeesForCaller(uint256)",
    "0xf3f43703": "submitJob(address,bytes,bytes,uint64,address,bytes4)",
    "0xd669e053": "callSovereignAgent(address,bytes,bytes,uint64)",
  };
  const selName = SELECTORS[selector] || "UNKNOWN";
  console.log(`  function     : ${selName}`);

  if (input.length > 10) {
    const calldata = "0x" + input.slice(10);
    console.log(`  calldata     : ${calldata}`);

    // If it's deliverCompute, decode (bytes32 jobId, bytes result)
    if (selector === "0x8ca12055") {
      try {
        const [jobId, result] = decodeAbiParameters(
          [{ name: "jobId", type: "bytes32" }, { name: "result", type: "bytes" }],
          calldata
        );
        console.log(`  [DECODED deliverCompute]`);
        console.log(`    jobId  : ${jobId}`);
        console.log(`    result : ${result}`);
        // Try to decode result as UTF-8
        try {
          const txt = Buffer.from(result.slice(2), "hex").toString("utf8");
          console.log(`    result (utf8) : ${txt.slice(0, 500)}`);
        } catch {}
      } catch (e) {
        console.log(`  [decode failed: ${e.message}]`);
      }
    }

    // If it's callSovereignAgent: decode (address executor, bytes input, bytes secrets, uint64 gasLimit)
    if (selector === "0xd669e053") {
      try {
        const [executor, jobInput, secrets, gasLimit] = decodeAbiParameters(
          [{ name: "executor", type: "address" }, { name: "input", type: "bytes" }, { name: "secrets", type: "bytes" }, { name: "gasLimit", type: "uint64" }],
          calldata
        );
        console.log(`  [DECODED callSovereignAgent]`);
        console.log(`    executor : ${executor}`);
        console.log(`    gasLimit : ${gasLimit}`);
        console.log(`    input    : ${jobInput}`);
        try {
          const txt = Buffer.from(jobInput.slice(2), "hex").toString("utf8");
          console.log(`    input (utf8) : ${txt.slice(0, 800)}`);
        } catch {}
        console.log(`    secrets  : ${jobInput.slice(0, 20)}... (${(secrets.length - 2) / 2} bytes)`);
      } catch (e) {
        console.log(`  [decode failed: ${e.message}]`);
      }
    }

    // submitJob: (address executor, bytes input, bytes secrets, uint64 gasLimit, address callback, bytes4 callbackSelector)
    if (selector === "0xf3f43703") {
      try {
        const [executor, jobInput, secrets, gasLimit, callback, cbSel] = decodeAbiParameters(
          [
            { name: "executor", type: "address" },
            { name: "input",    type: "bytes"   },
            { name: "secrets",  type: "bytes"   },
            { name: "gasLimit", type: "uint64"  },
            { name: "callback", type: "address" },
            { name: "callbackSelector", type: "bytes4" },
          ],
          calldata
        );
        console.log(`  [DECODED submitJob]`);
        console.log(`    executor : ${executor}`);
        console.log(`    gasLimit : ${gasLimit}`);
        console.log(`    callback : ${callback}`);
        console.log(`    cbSel    : ${cbSel}`);
        console.log(`    input (hex) : ${jobInput}`);
        try {
          const txt = Buffer.from(jobInput.slice(2), "hex").toString("utf8");
          console.log(`    input (utf8): ${txt.slice(0, 1000)}`);
        } catch {}
      } catch (e) {
        console.log(`  [decode failed: ${e.message}]`);
      }
    }
  }

  // ── 3. Receipt ────────────────────────────────────────────────────────────
  console.log("\n┌── 3 · RECEIPT ────────────────────────────────────────────");
  console.log(`  status       : ${receipt.status === "success" ? "SUCCESS ✓" : "REVERTED ✗"}`);
  console.log(`  gasUsed      : ${receipt.gasUsed?.toString()}`);
  console.log(`  blockNumber  : ${receipt.blockNumber?.toString()}`);
  console.log(`  logs count   : ${receipt.logs.length}`);

  // ── 4. Logs ───────────────────────────────────────────────────────────────
  console.log("\n┌── 4 · LOGS ───────────────────────────────────────────────");
  if (receipt.logs.length === 0) {
    console.log("  (no logs)");
  }

  for (let i = 0; i < receipt.logs.length; i++) {
    const log = receipt.logs[i];
    console.log(`\n  [Log ${i}]`);
    console.log(`    address  : ${addrName(log.address)}`);
    console.log(`    topics   :`);
    for (let t = 0; t < log.topics.length; t++) {
      console.log(`      [${t}] ${log.topics[t]}`);
    }
    console.log(`    data     : ${log.data}`);

    const decoded = decodeLog(log);
    if (decoded) {
      console.log(`    [DECODED: ${decoded.name}]`);
      for (const [k, v] of Object.entries(decoded.args)) {
        console.log(`      ${k} : ${v}`);
      }
    } else {
      // Try to identify topic0
      const t0 = log.topics[0]?.toLowerCase();
      if (t0) {
        // Print which event sig this could be
        console.log(`    topic0   : ${t0} (unknown event)`);
      }
    }
  }

  // ── 5. Internal calls via eth_getTransactionByHash full trace (debug) ─────
  // Try eth_debug_traceTransaction if available
  console.log("\n┌── 5 · DEBUG TRACE (eth_debug_traceTransaction) ──────────");
  try {
    const trace = await pub.request({
      method: "debug_traceTransaction",
      params: [TX_HASH, { tracer: "callTracer" }],
    });
    function printCalls(call, depth = 0) {
      const indent = "  ".repeat(depth + 1);
      console.log(`${indent}[${call.type}] ${addrName(call.from)} -> ${addrName(call.to)}`);
      console.log(`${indent}  input    : ${(call.input || "0x").slice(0, 80)}${(call.input || "").length > 80 ? "..." : ""}`);
      if (call.output) console.log(`${indent}  output   : ${call.output.slice(0, 80)}${call.output.length > 80 ? "..." : ""}`);
      if (call.error) console.log(`${indent}  ERROR    : ${call.error}`);
      if (call.calls) call.calls.forEach(c => printCalls(c, depth + 1));
    }
    printCalls(trace);
  } catch (e) {
    console.log(`  debug_traceTransaction not available: ${e.message.slice(0, 120)}`);
  }

  // ── 6. Check known jobId in AsyncJobTracker ───────────────────────────────
  console.log("\n┌── 6 · JOB ID SEARCH ──────────────────────────────────────");

  // Collect bytes32 values from logs (indexed topics that look like job IDs)
  const jobIds = new Set();
  for (const log of receipt.logs) {
    for (const topic of log.topics.slice(1)) {
      if (topic && topic !== "0x" + "0".repeat(64)) {
        jobIds.add(topic);
      }
    }
    // Also try data if it starts with a bytes32
    if (log.data && log.data.length >= 66) {
      jobIds.add(log.data.slice(0, 66));
    }
  }

  console.log(`  Candidate jobIds / bytes32 values found in logs:`);
  for (const jid of jobIds) {
    console.log(`    ${jid}`);
  }

  // Try to read pendingJobId from our agent contract for known owners
  const agentABI = [
    { name: "pendingJobId", type: "function", stateMutability: "view",
      inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "bytes32" }] },
    { name: "lastCycleId",  type: "function", stateMutability: "view",
      inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "bytes32" }] },
  ];
  const OWNER = "0x53Ee4EBC921AE15E5d153E2b6AdC805A4D29cFC2";
  try {
    const [pending, last] = await Promise.all([
      pub.readContract({ address: AGENT_V10, abi: agentABI, functionName: "pendingJobId", args: [OWNER] }),
      pub.readContract({ address: AGENT_V10, abi: agentABI, functionName: "lastCycleId",  args: [OWNER] }),
    ]);
    console.log(`\n  Agent v10 state for owner ${OWNER}:`);
    console.log(`    pendingJobId : ${pending}`);
    console.log(`    lastCycleId  : ${last}`);

    const pendingInTx = receipt.logs.some(l =>
      l.topics.some(t => t?.toLowerCase() === pending?.toLowerCase())
      || l.data?.toLowerCase().includes(pending?.slice(2).toLowerCase())
    );
    console.log(`    pending jobId present in this TX's logs: ${pendingInTx ? "YES" : "NO"}`);
  } catch (e) {
    console.log(`  [agent read failed: ${e.message}]`);
  }

  console.log("\n" + "═".repeat(68));
  console.log("  DONE");
  console.log("═".repeat(68));
}

main().catch(e => { console.error(e); process.exit(1); });
