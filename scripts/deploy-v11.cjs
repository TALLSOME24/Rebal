/**
 * Deploy PortfolioAgent v11 (fix: correct 0x080C jobId decode) on Ritual testnet.
 * Then registers portfolio and starts automation in one flow.
 *
 * v11 changes vs v10:
 *   - _callSovereignAgent: reads jobId from ret[96:128] (not abi.decode(ret,(bytes32)))
 *   - clearPendingJob(address): admin escape hatch for stuck pendingJobId
 *
 * Run: node scripts/deploy-v11.cjs
 */
require("dotenv").config();
const fs   = require("fs");
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

const RITUAL_RPC = process.env.RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";
const DEX_ROUTER = process.env.DEX_ROUTER || "0x0000000000000000000000000000000000000000";
const WALLET     = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
const FACTORY    = process.env.NEXT_PUBLIC_FACTORY_ADDRESS || "0x5ecadae5ee001670db3f64abb9b45aec66132ad3";

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

const artifactPath = path.join(__dirname, "../artifacts/contracts/PortfolioAgent.sol/PortfolioAgent.json");
if (!fs.existsSync(artifactPath)) { console.error("Run: npx hardhat compile"); process.exit(1); }
const { abi, bytecode } = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

const walletAbi = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "lockUntil", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
];

const factoryAbi = [
  { name: "overrideAgent", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "user", type: "address" }, { name: "agent", type: "address" }], outputs: [] },
];

// Automation params (freq * numCalls = MAX_LIFESPAN = 10,000)
const FREQ      = 5000;
const NUM_CALLS = 2;
const GAS       = 3_000_000;
const TTL       = 500;
const MAX_FEE   = parseGwei("30");
const LOCK_DUR  = 200_000n;
const DEPOSIT   = parseEther("0.4");

async function send(fn, label) {
  let hash;
  try { hash = await fn(); }
  catch (err) { console.error(`  ${label} FAILED:`, err.shortMessage || err.message); process.exit(1); }
  console.log(`  TX: ${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") { console.error(`  ${label} REVERTED`); process.exit(1); }
  console.log(`  ${label}: SUCCESS`);
  return receipt;
}

async function main() {
  const block = await pub.getBlockNumber();
  const bal   = await pub.getBalance({ address: account.address });
  console.log("=".repeat(62));
  console.log("  Deploy PortfolioAgent v11  --  Ritual Testnet (1979)");
  console.log("=".repeat(62));
  console.log("  deployer  :", account.address);
  console.log("  balance   :", formatEther(bal), "RITUAL");
  console.log("  block     :", block.toString());

  // ── 1. Deploy ───────────────────────────────────────────────────────────────
  console.log("\n─── Step 1: Deploy ─────────────────────────────────────────");
  const deployReceipt = await send(
    () => wall.deployContract({ abi, bytecode, args: [account.address, DEX_ROUTER] }),
    "Deploy"
  );
  const AGENT = deployReceipt.contractAddress;
  console.log("  agent v11 :", AGENT);

  // ── 2. Register portfolio ────────────────────────────────────────────────────
  console.log("\n─── Step 2: registerPortfolio ──────────────────────────────");
  console.log("  risk=Balanced, ethBps=4000, wbtcBps=3000, usdcBps=2000");
  await send(
    () => wall.writeContract({ address: AGENT, abi, functionName: "registerPortfolio",
      args: [1, 4000, 3000, 2000] }),
    "registerPortfolio"
  );

  // ── 3. RitualWallet top-up ───────────────────────────────────────────────────
  console.log("\n─── Step 3: depositFeesForCaller ───────────────────────────");
  const rwBal  = await pub.readContract({ address: WALLET, abi: walletAbi, functionName: "balanceOf", args: [AGENT] });
  const rwLock = await pub.readContract({ address: WALLET, abi: walletAbi, functionName: "lockUntil", args: [AGENT] });
  const needsDeposit = rwLock < block + BigInt(TTL) || rwBal === 0n;
  if (!needsDeposit) {
    console.log(`  SKIPPED — lock valid, balance ${formatEther(rwBal)} RITUAL`);
  } else {
    console.log(`  Depositing ${formatEther(DEPOSIT)} RITUAL, lock=${LOCK_DUR} blocks`);
    await send(
      () => wall.writeContract({ address: AGENT, abi, functionName: "depositFeesForCaller",
        args: [LOCK_DUR], value: DEPOSIT }),
      "depositFeesForCaller"
    );
    const newBal  = await pub.readContract({ address: WALLET, abi: walletAbi, functionName: "balanceOf", args: [AGENT] });
    const newLock = await pub.readContract({ address: WALLET, abi: walletAbi, functionName: "lockUntil", args: [AGENT] });
    console.log(`  balance   : ${formatEther(newBal)} RITUAL`);
    console.log(`  lockUntil : ${newLock.toString()} (current block+TTL = ${(block + BigInt(TTL)).toString()})`);
    if (newLock < block + BigInt(TTL)) { console.error("  Lock too short!"); process.exit(1); }
  }

  // ── 4. Update factory mapping ────────────────────────────────────────────────
  console.log("\n─── Step 4: overrideAgent in factory ───────────────────────");
  console.log(`  factory   : ${FACTORY}`);
  console.log(`  owner     : ${account.address}`);
  console.log(`  new agent : ${AGENT}`);
  await send(
    () => wall.writeContract({ address: FACTORY, abi: factoryAbi, functionName: "overrideAgent",
      args: [account.address, AGENT] }),
    "overrideAgent"
  );

  // ── 5. startAutomation ──────────────────────────────────────────────────────
  console.log("\n─── Step 5: startAutomation ────────────────────────────────");
  console.log(`  freq=${FREQ}, numCalls=${NUM_CALLS}, gas=${GAS}, ttl=${TTL}`);
  const startReceipt = await send(
    () => wall.writeContract({ address: AGENT, abi, functionName: "startAutomation",
      args: [FREQ, NUM_CALLS, GAS, MAX_FEE, TTL] }),
    "startAutomation"
  );

  // Decode scheduleId from AutomationScheduled log
  let scheduleId = "unknown";
  const schedLog = startReceipt.logs.find(
    l => l.address.toLowerCase() === AGENT.toLowerCase() && l.topics.length === 3
  );
  if (schedLog) scheduleId = BigInt(schedLog.topics[2]).toString();

  console.log("\n" + "=".repeat(62));
  console.log("  PortfolioAgent v11 DEPLOYED AND RUNNING");
  console.log("  agent       :", AGENT);
  console.log("  scheduleId  :", scheduleId);
  console.log(`  first tick  : block ${(block + BigInt(FREQ)).toString()} (~${Math.round(Number(FREQ) * 60 / 1000)} min)`);
  console.log("=".repeat(62));
  console.log("\n  Update .env:");
  console.log(`    AGENT_ADDRESS=${AGENT}`);
  console.log(`    NEXT_PUBLIC_PORTFOLIO_AGENT=${AGENT}`);
  console.log("\n  Run: node scripts/check-agent.cjs");
}

main().catch(e => { console.error(e); process.exit(1); });
