/**
 * Full setup for PortfolioAgent v7 (FIX: convoHistory double-encoding causing 'length insufficient 224 require 288'):
 *   1. depositFeesForCaller (0.05 RITUAL, lockDuration=200000 blocks)
 *   2. registerPortfolio (Balanced, 40/20/25, LLM executor=cap-1, HTTP executor=cap-0)
 *   3. startAutomation (freq=80, cycles=12, gas=3M, maxFee=2gwei, ttl=350)
 *
 * Run: node scripts/setup-v7.cjs
 *   1. depositFeesForCaller (0.35 RITUAL, lockDuration=200000 blocks)
 *   2. registerPortfolio (Balanced, 40/30/30, LLM executor=cap-1, HTTP executor=cap-0)
 *   3. startAutomation (freq=80, cycles=12, gas=3M, maxFee=2gwei, ttl=350)
 *
 * Run: node scripts/setup-v7.cjs
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
const AGENT      = "0xB2f331A2403d35C79BcAc72885a55676B17B8348"; // v7
const WALLET     = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
const TEE_REG    = "0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F";

const PK = process.env.PRIVATE_KEY;
if (!PK) { console.error("PRIVATE_KEY not in .env"); process.exit(1); }
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
  { name: "depositFeesForCaller", type: "function", stateMutability: "payable",
    inputs: [{ name: "lockDurationBlocks", type: "uint256" }], outputs: [] },
  { name: "registerPortfolio", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "risk", type: "uint8" },
      { name: "ethBps_", type: "uint16" },
      { name: "wbtcBps_", type: "uint16" },
      { name: "usdcBps_", type: "uint16" },
      { name: "executor", type: "address" },
      { name: "httpExecutor_", type: "address" },
    ], outputs: [] },
  { name: "startAutomation", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "frequencyBlocks", type: "uint32" },
      { name: "numCycles", type: "uint32" },
      { name: "gasLimit", type: "uint32" },
      { name: "maxFeePerGas", type: "uint256" },
      { name: "schedulerTtl", type: "uint32" },
    ], outputs: [] },
  { name: "portfolios", type: "function", stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "registered", type: "bool" },
      { name: "riskMode", type: "uint8" },
      { name: "ethBps", type: "uint16" },
      { name: "wbtcBps", type: "uint16" },
      { name: "usdcBps", type: "uint16" },
      { name: "executor", type: "address" },
      { name: "scheduleId", type: "uint256" },
      { name: "httpExecutor", type: "address" },
    ] },
];
const walletAbi = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "lockUntil", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
];
const teeAbi = [
  { name: "getServicesByCapability", type: "function", stateMutability: "view",
    inputs: [{ name: "capability", type: "uint8" }, { name: "checkValidity", type: "bool" }],
    outputs: [{ name: "services", type: "tuple[]", components: [
      { name: "node", type: "tuple", components: [
        { name: "paymentAddress", type: "address" },
        { name: "teeAddress", type: "address" },
        { name: "teeType", type: "uint8" },
        { name: "publicKey", type: "bytes" },
        { name: "endpoint", type: "string" },
        { name: "certPubKeyHash", type: "bytes32" },
        { name: "capability", type: "uint8" },
      ]},
      { name: "isValid", type: "bool" },
      { name: "workloadId", type: "bytes32" },
    ]}] },
];

const RISK     = 1;       // Balanced
const ETH_BPS  = 4000;
const WBTC_BPS = 3000;
const USDC_BPS = 3000;
const FREQ     = 80;
const CYCLES   = 12;
const GAS      = 3_000_000;
const MAX_FEE  = parseGwei("2");
const TTL      = 350;
const LOCK_DUR = 200_000n;
const DEPOSIT  = parseEther("0.05");

async function send(label, fn) {
  process.stdout.write(`  ${label}... `);
  try {
    const hash = await fn();
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      console.log("REVERTED  txHash:", hash);
      return false;
    }
    console.log("OK  (" + hash.slice(0, 14) + "...)");
    return true;
  } catch (e) {
    console.log("FAILED:", e.shortMessage || e.message.slice(0, 120));
    return false;
  }
}

async function main() {
  const block = await pub.getBlockNumber();
  const bal   = await pub.getBalance({ address: account.address });
  console.log("═".repeat(60));
  console.log("  PortfolioAgent v7 Setup");
  console.log("═".repeat(60));
  console.log("  agent      :", AGENT);
  console.log("  owner      :", account.address);
  console.log("  block      :", block.toString());
  console.log("  EOA balance:", formatEther(bal), "RITUAL");

  // ── Fetch executor addresses from TEEServiceRegistry ──────────────────────
  const llmSvcs  = await pub.readContract({
    address: TEE_REG, abi: teeAbi, functionName: "getServicesByCapability", args: [1, true]
  });
  const httpSvcs = await pub.readContract({
    address: TEE_REG, abi: teeAbi, functionName: "getServicesByCapability", args: [0, true]
  });
  if (!llmSvcs.length)  { console.error("No LLM executor! Abort."); process.exit(1); }
  if (!httpSvcs.length) { console.error("No HTTP executor! Abort."); process.exit(1); }

  const LLM_EXEC  = llmSvcs[0].node.teeAddress;
  const HTTP_EXEC = httpSvcs[0].node.teeAddress;
  console.log("  LLM exec   :", LLM_EXEC);
  console.log("  HTTP exec  :", HTTP_EXEC);

  // ── 1. Deposit ────────────────────────────────────────────────────────────
  console.log("\n  [1] depositFeesForCaller", formatEther(DEPOSIT), "RITUAL  lock=200000");
  const ok1 = await send("deposit", () =>
    wall.writeContract({
      address: AGENT, abi: agentAbi, functionName: "depositFeesForCaller",
      args: [LOCK_DUR], value: DEPOSIT,
    })
  );
  if (!ok1) process.exit(1);

  const rwBal  = await pub.readContract({ address: WALLET, abi: walletAbi, functionName: "balanceOf", args: [AGENT] });
  const rwLock = await pub.readContract({ address: WALLET, abi: walletAbi, functionName: "lockUntil", args: [AGENT] });
  const cur    = await pub.getBlockNumber();
  console.log("  RW balance :", formatEther(rwBal), "RITUAL");
  console.log("  RW lock    :", rwLock.toString(), "  current:", cur.toString(), " valid:", rwLock > cur ? "YES" : "NO");

  // ── 2. Register portfolio ─────────────────────────────────────────────────
  console.log("\n  [2] registerPortfolio (Balanced ETH40/WBTC30/USDC30)");
  const ok2 = await send("registerPortfolio", () =>
    wall.writeContract({
      address: AGENT, abi: agentAbi, functionName: "registerPortfolio",
      args: [RISK, ETH_BPS, WBTC_BPS, USDC_BPS, LLM_EXEC, HTTP_EXEC],
    })
  );
  if (!ok2) process.exit(1);

  const p = await pub.readContract({ address: AGENT, abi: agentAbi, functionName: "portfolios", args: [account.address] });
  const reg      = p.registered ?? p[0];
  const httpExec = p.httpExecutor ?? p[7];
  console.log("  registered :", reg ? "YES" : "NO");
  console.log("  httpExecutor:", httpExec);

  // ── 3. Start automation ───────────────────────────────────────────────────
  console.log("\n  [3] startAutomation freq=80 cycles=12 gas=3M maxFee=2gwei ttl=350");
  const ok3 = await send("startAutomation", () =>
    wall.writeContract({
      address: AGENT, abi: agentAbi, functionName: "startAutomation",
      args: [FREQ, CYCLES, GAS, MAX_FEE, TTL],
    })
  );
  if (!ok3) process.exit(1);

  const p2 = await pub.readContract({ address: AGENT, abi: agentAbi, functionName: "portfolios", args: [account.address] });
  const schedId = p2.scheduleId ?? p2[6] ?? 0n;
  console.log("  scheduleId :", schedId.toString());

  console.log("\n" + "═".repeat(60));
  console.log("  v7 setup DONE!  scheduleId:", schedId.toString());
  console.log("  First HTTP tick fires in ~80 blocks (~28s)");
  console.log("  Monitor: node scripts/check-agent.cjs");
  console.log("═".repeat(60));
}

main().catch(e => { console.error(e); process.exit(1); });
