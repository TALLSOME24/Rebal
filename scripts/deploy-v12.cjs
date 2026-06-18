/**
 * Deploy PortfolioAgent v12 + PortfolioAgentFactory v3 on Ritual testnet.
 *
 * v12 changes vs v11:
 *   - IUniswapV2Factory interface added
 *   - LLM callback parses fromToken/toToken/amountBps from JSON and calls _executeSwap directly
 *   - _jsonStr / _jsonUint / _parseLLMSwap / _tokenAddr helpers added
 *
 * Steps:
 *   1. Deploy PortfolioAgentFactory v3 (with real dexRouter)
 *   2. Deploy PortfolioAgent v12 via factory (inherits dexRouter)
 *   3. registerPortfolio on new agent
 *   4. depositFeesForCaller (fund RitualWallet)
 *   5. overrideAgent on new factory to record the mapping
 *   6. startAutomation
 *
 * Run: node scripts/deploy-v12.cjs
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
const DEX_ROUTER = "0xB44b8646281886Bc3F63280C1287CF1349A936b9";
const DEX_FACTORY = "0xD2D774e8ca44Eb3449d9028d89d4861cE56a867c";
const RITUAL_WALLET = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";

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

// Load artifacts
function artifact(name) {
  const p = path.join(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`);
  if (!fs.existsSync(p)) { console.error(`Artifact not found: ${p}\nRun: npx hardhat compile`); process.exit(1); }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
const agentArt   = artifact("PortfolioAgent");
const factoryArt = artifact("PortfolioAgentFactory");

const walletAbi = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "lockUntil", type: "function", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
];

const FREQ      = 5000;
const NUM_CALLS = 2;
const GAS       = 3_000_000;
const MAX_FEE   = parseGwei("1");   // real basefee ~7e-9 gwei; 1 gwei >> actual cost
const TTL       = 500;
const LOCK_DUR  = 200_000n;

async function send(label, fn) {
  let hash;
  try { hash = await fn(); }
  catch (e) { console.error(`  ${label} FAILED:`, e.shortMessage || e.message); process.exit(1); }
  console.log(`  TX: ${hash}`);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") { console.error(`  ${label} REVERTED`); process.exit(1); }
  console.log(`  ${label}: OK`);
  return r;
}

async function main() {
  const block = await pub.getBlockNumber();
  const bal   = await pub.getBalance({ address: account.address });
  console.log("=".repeat(64));
  console.log("  Deploy PortfolioAgent v12 + Factory v3  —  Ritual (1979)");
  console.log("=".repeat(64));
  console.log("  deployer   :", account.address);
  console.log("  balance    :", formatEther(bal), "RITUAL");
  console.log("  block      :", block.toString());
  console.log("  dexRouter  :", DEX_ROUTER);

  // ── 1. Deploy factory v3 ────────────────────────────────────────────────────
  console.log("\n─── Step 1: Deploy PortfolioAgentFactory v3 ────────────────");
  const factReceipt = await send("Deploy factory",
    () => wall.deployContract({ abi: factoryArt.abi, bytecode: factoryArt.bytecode, args: [DEX_ROUTER] })
  );
  const FACTORY = factReceipt.contractAddress;
  console.log("  factory v3 :", FACTORY);

  // ── 2. Deploy agent v12 via factory ─────────────────────────────────────────
  console.log("\n─── Step 2: Deploy PortfolioAgent v12 via factory ──────────");
  const deployAgentReceipt = await send("deployAgent",
    () => wall.writeContract({ address: FACTORY, abi: factoryArt.abi, functionName: "deployAgent" })
  );
  // Agent address from AgentDeployed event (topic2 = agent address)
  const agentLog = deployAgentReceipt.logs.find(
    l => l.address.toLowerCase() === FACTORY.toLowerCase() && l.topics.length === 3
  );
  const AGENT = agentLog ? "0x" + agentLog.topics[2].slice(26) : null;
  if (!AGENT) { console.error("Could not find agent address in AgentDeployed event"); process.exit(1); }
  console.log("  agent v12  :", AGENT);

  // Verify dexRouter was set correctly
  const agentAbi = agentArt.abi;
  const routerSet = await pub.readContract({ address: AGENT, abi: agentAbi, functionName: "dexRouter" });
  console.log("  dexRouter  :", routerSet, routerSet.toLowerCase() === DEX_ROUTER.toLowerCase() ? "(✓ correct)" : "(!! WRONG)");

  // ── 3. Register portfolio ────────────────────────────────────────────────────
  console.log("\n─── Step 3: registerPortfolio (Balanced 40/30/20/10) ───────");
  await send("registerPortfolio",
    () => wall.writeContract({ address: AGENT, abi: agentAbi, functionName: "registerPortfolio",
      args: [1, 4000, 3000, 2000] })
  );

  // ── 4. Fund RitualWallet ─────────────────────────────────────────────────────
  console.log("\n─── Step 4: depositFeesForCaller ───────────────────────────");
  const rwBal  = await pub.readContract({ address: RITUAL_WALLET, abi: walletAbi, functionName: "balanceOf", args: [AGENT] });
  const rwLock = await pub.readContract({ address: RITUAL_WALLET, abi: walletAbi, functionName: "lockUntil", args: [AGENT] });
  const blockNow = await pub.getBlockNumber();

  if (rwBal > 0n && rwLock >= blockNow + BigInt(TTL)) {
    console.log(`  SKIPPED — balance ${formatEther(rwBal)} RITUAL, lock valid`);
  } else {
    // Use 0.05 RITUAL (well above the 1gwei * 3M gas = 0.003 RITUAL min balance check)
    const DEPOSIT = parseEther("0.05");
    console.log(`  depositing ${formatEther(DEPOSIT)} RITUAL, lockDur=${LOCK_DUR}`);
    await send("depositFeesForCaller",
      () => wall.writeContract({ address: AGENT, abi: agentAbi, functionName: "depositFeesForCaller",
        args: [LOCK_DUR], value: DEPOSIT })
    );
    const newBal  = await pub.readContract({ address: RITUAL_WALLET, abi: walletAbi, functionName: "balanceOf", args: [AGENT] });
    const newLock = await pub.readContract({ address: RITUAL_WALLET, abi: walletAbi, functionName: "lockUntil", args: [AGENT] });
    console.log(`  balance   : ${formatEther(newBal)} RITUAL`);
    console.log(`  lockUntil : ${newLock}`);
  }

  // ── 5. startAutomation ──────────────────────────────────────────────────────
  console.log("\n─── Step 5: startAutomation ────────────────────────────────");
  console.log(`  freq=${FREQ}, numCalls=${NUM_CALLS}, gas=${GAS.toLocaleString()}, maxFee=${Number(MAX_FEE)/1e9}gwei, ttl=${TTL}`);
  const startReceipt = await send("startAutomation",
    () => wall.writeContract({ address: AGENT, abi: agentAbi, functionName: "startAutomation",
      args: [FREQ, NUM_CALLS, GAS, MAX_FEE, TTL] })
  );
  const schedLog = startReceipt.logs.find(
    l => l.address.toLowerCase() === AGENT.toLowerCase() && l.topics.length === 3
  );
  const scheduleId = schedLog ? BigInt(schedLog.topics[2]).toString() : "unknown";
  const finalBlock = await pub.getBlockNumber();

  // ── 6. Write .factory-address.json ──────────────────────────────────────────
  const outPath = path.join(__dirname, "..", ".factory-address.json");
  fs.writeFileSync(outPath, JSON.stringify({
    factoryAddress: FACTORY,
    agentAddress:   AGENT,
    dexRouter:      DEX_ROUTER,
    dexFactory:     DEX_FACTORY,
    deployedAt:     new Date().toISOString(),
    deployer:       account.address,
    version:        "v12",
  }, null, 2));

  console.log("\n" + "=".repeat(64));
  console.log("  PortfolioAgent v12 + Factory v3 LIVE");
  console.log("  factory    :", FACTORY);
  console.log("  agent      :", AGENT);
  console.log("  dexRouter  :", DEX_ROUTER);
  console.log("  scheduleId :", scheduleId);
  console.log(`  first tick : block ~${(finalBlock + BigInt(FREQ)).toString()} (~${Math.round(FREQ * 60 / 1000)} min)`);
  console.log("=".repeat(64));
  console.log("\n  Update lib/constants.ts:");
  console.log(`    PORTFOLIO_AGENT = "${AGENT}"`);
  console.log(`    FACTORY_ADDRESS = "${FACTORY}"`);
  console.log("\n  Update .env:");
  console.log(`    AGENT_ADDRESS=${AGENT}`);
  console.log(`    NEXT_PUBLIC_PORTFOLIO_AGENT=${AGENT}`);
  console.log(`    NEXT_PUBLIC_FACTORY_ADDRESS=${FACTORY}`);
}

main().catch(e => { console.error(e); process.exit(1); });
