/**
 * Full setup for PortfolioAgent v5:
 *   1. depositFeesForCaller (0.35 RITUAL, lockDuration=200000 blocks)
 *   2. registerPortfolio (Balanced, 40/30/30, LLM executor)
 *   3. startAutomation (freq=80, cycles=12, gas=3M, maxFee=2gwei, ttl=350)
 *
 * Run: node scripts/setup-v5.cjs
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
const AGENT      = "0x72b1e7dacbfef5072e52db9a9884f0dca2d5dea2"; // v5
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

// ── ABIs ────────────────────────────────────────────────────────────────────
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

// ── Parameters ───────────────────────────────────────────────────────────────
const RISK      = 1;          // Balanced
const ETH_BPS   = 4000;
const WBTC_BPS  = 3000;
const USDC_BPS  = 3000;
const FREQ      = 80;         // blocks between ticks
const CYCLES    = 12;         // 24 total ticks
const GAS       = 3_000_000;
const MAX_FEE   = parseGwei("2"); // 2 gwei — much lower than the 30 gwei that caused drops
const TTL       = 350;
const LOCK_DUR  = 200_000n;   // blocks for RitualWallet lock

// Deposit: 0.35 RITUAL (covers LLM escrow 0.31 + gas)
const DEPOSIT   = parseEther("0.35");

async function send(label, fn) {
  process.stdout.write(`  ${label}... `);
  try {
    const hash = await fn();
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      console.log("REVERTED ←");
      console.log("    txHash:", hash);
      return false;
    }
    console.log("OK  (tx:", hash.slice(0, 12), "...)");
    return true;
  } catch (e) {
    console.log("FAILED:", e.shortMessage || e.message.slice(0, 120));
    return false;
  }
}

async function main() {
  const block = await pub.getBlockNumber();
  const bal   = await pub.getBalance({ address: account.address });
  console.log("═".repeat(58));
  console.log("  PortfolioAgent v5 Setup");
  console.log("═".repeat(58));
  console.log("  agent   :", AGENT);
  console.log("  owner   :", account.address);
  console.log("  block   :", block.toString());
  console.log("  EOA bal :", formatEther(bal), "RITUAL");

  // ── 0. Verify LLM executor ─────────────────────────────────────────────────
  const llmSvcs = await pub.readContract({
    address: TEE_REG, abi: teeAbi, functionName: "getServicesByCapability", args: [1, true]
  });
  if (!llmSvcs.length) { console.error("No LLM executor! Aborting."); process.exit(1); }
  const LLM_EXEC = llmSvcs[0].node.teeAddress;
  console.log("  LLM exec:", LLM_EXEC, "(valid)");

  const httpSvcs = await pub.readContract({
    address: TEE_REG, abi: teeAbi, functionName: "getServicesByCapability", args: [0, true]
  });
  console.log("  HTTP exec count:", httpSvcs.length, "(capability-0, queried at tick time by contract)");

  // ── 1. Deposit fees ────────────────────────────────────────────────────────
  console.log("\n  [1] depositFeesForCaller", formatEther(DEPOSIT), "RITUAL, lock=200000 blocks");
  const ok1 = await send("sending deposit", async () => {
    return wall.writeContract({
      address: AGENT, abi: agentAbi, functionName: "depositFeesForCaller",
      args: [LOCK_DUR],
      value: DEPOSIT,
    });
  });
  if (!ok1) process.exit(1);

  // Verify
  const rwBal  = await pub.readContract({ address: WALLET, abi: walletAbi, functionName: "balanceOf", args: [AGENT] });
  const rwLock = await pub.readContract({ address: WALLET, abi: walletAbi, functionName: "lockUntil", args: [AGENT] });
  const curBlock = await pub.getBlockNumber();
  console.log("  RW balance :", formatEther(rwBal), "RITUAL");
  console.log("  RW lockUntil:", rwLock.toString(), "(current:", curBlock.toString(), "valid:", rwLock > curBlock ? "YES" : "NO PROBLEM");

  // ── 2. Register portfolio ──────────────────────────────────────────────────
  console.log("\n  [2] registerPortfolio (Balanced, ETH40%/WBTC30%/USDC30%)");
  const ok2 = await send("sending registerPortfolio", () =>
    wall.writeContract({
      address: AGENT, abi: agentAbi, functionName: "registerPortfolio",
      args: [RISK, ETH_BPS, WBTC_BPS, USDC_BPS, LLM_EXEC],
    })
  );
  if (!ok2) process.exit(1);

  // Verify
  const p = await pub.readContract({ address: AGENT, abi: agentAbi, functionName: "portfolios", args: [account.address] });
  const registered = p.registered ?? p[0];
  console.log("  registered :", registered ? "YES" : "NO ← PROBLEM");

  // ── 3. Start automation ────────────────────────────────────────────────────
  console.log("\n  [3] startAutomation (freq=80, cycles=12, gas=3M, maxFee=2gwei, ttl=350)");
  const ok3 = await send("sending startAutomation", () =>
    wall.writeContract({
      address: AGENT, abi: agentAbi, functionName: "startAutomation",
      args: [FREQ, CYCLES, GAS, MAX_FEE, TTL],
    })
  );
  if (!ok3) process.exit(1);

  // Verify schedule
  const p2 = await pub.readContract({ address: AGENT, abi: agentAbi, functionName: "portfolios", args: [account.address] });
  const scheduleId = p2.scheduleId ?? p2[6] ?? 0n;
  console.log("  scheduleId :", scheduleId.toString());

  console.log("\n" + "═".repeat(58));
  console.log("  Setup complete! Schedule", scheduleId.toString(), "is live.");
  console.log("  First HTTP tick fires in ~80 blocks (~28s at 350ms/block)");
  console.log("  Run: node scripts/check-agent.cjs  to monitor");
  console.log("═".repeat(58));
}

main().catch(e => { console.error(e); process.exit(1); });
