/**
 * Deploy PortfolioAgentFactory v2 (adds overrideAgent admin function),
 * then immediately call overrideAgent to map owner → v10 agent.
 *
 * Run: node scripts/deploy-factory-v2.cjs
 */
require("dotenv").config();
const fs   = require("fs");
const path = require("path");
const { createPublicClient, createWalletClient, http, formatEther } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const RITUAL_RPC   = process.env.RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";
const V10_AGENT    = "0x26b3a6c452a9a24cb10fa7892340ca6cc7631016";
const DEX_ROUTER   = process.env.DEX_ROUTER || "0xB44b8646281886Bc3F63280C1287CF1349A936b9";

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

// Load compiled factory artifact
const artifactPath = path.join(
  __dirname, "../artifacts/contracts/PortfolioAgentFactory.sol/PortfolioAgentFactory.json"
);
if (!fs.existsSync(artifactPath)) {
  console.error("Artifact not found — run: npx hardhat compile");
  process.exit(1);
}
const { abi, bytecode } = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

async function main() {
  const block = await pub.getBlockNumber();
  const bal   = await pub.getBalance({ address: account.address });

  console.log("=".repeat(60));
  console.log("  Deploy PortfolioAgentFactory v2  --  Ritual Testnet");
  console.log("=".repeat(60));
  console.log("  deployer  :", account.address);
  console.log("  balance   :", formatEther(bal), "RITUAL");
  console.log("  block     :", block.toString());
  console.log("  dexRouter :", DEX_ROUTER);
  console.log("  v10 agent :", V10_AGENT);

  if (bal === 0n) { console.error("No RITUAL for gas."); process.exit(1); }

  // Step 1 — Deploy factory
  console.log("\n  Deploying PortfolioAgentFactory v2...");
  let deployHash;
  try {
    deployHash = await wall.deployContract({ abi, bytecode, args: [DEX_ROUTER] });
  } catch (err) {
    console.error("  Deploy FAILED:", err.shortMessage || err.message);
    process.exit(1);
  }
  console.log("  TX:", deployHash);
  const deployReceipt = await pub.waitForTransactionReceipt({ hash: deployHash });
  if (deployReceipt.status !== "success" || !deployReceipt.contractAddress) {
    console.error("  Deployment reverted."); process.exit(1);
  }
  const factoryAddress = deployReceipt.contractAddress;
  console.log("  Factory address:", factoryAddress);
  console.log("  Gas used       :", deployReceipt.gasUsed.toString());

  // Step 2 — overrideAgent(owner, v10)
  console.log("\n  Calling overrideAgent(owner, v10)...");
  const overrideAbi = [{
    name: "overrideAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user",  type: "address" },
      { name: "agent", type: "address" },
    ],
    outputs: [],
  }];
  let overrideHash;
  try {
    overrideHash = await wall.writeContract({
      address: factoryAddress,
      abi: overrideAbi,
      functionName: "overrideAgent",
      args: [account.address, V10_AGENT],
    });
  } catch (err) {
    console.error("  overrideAgent FAILED:", err.shortMessage || err.message);
    process.exit(1);
  }
  console.log("  TX:", overrideHash);
  const overrideReceipt = await pub.waitForTransactionReceipt({ hash: overrideHash });
  console.log("  status:", overrideReceipt.status === "success" ? "SUCCESS" : "REVERTED");

  // Verify
  const getAgentAbi = [{
    name: "getAgent",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "address" }],
  }];
  const mapped = await pub.readContract({
    address: factoryAddress,
    abi: getAgentAbi,
    functionName: "getAgent",
    args: [account.address],
  });
  console.log("  factory.getAgent(owner) =", mapped);
  const ok = mapped.toLowerCase() === V10_AGENT.toLowerCase();
  console.log("  mapping correct:", ok ? "YES ✓" : "NO ✗");
  if (!ok) { console.error("  Mapping mismatch!"); process.exit(1); }

  // Save
  const out = {
    factoryAddress,
    deployedAt: new Date().toISOString(),
    deployer: account.address,
    overrideUser: account.address,
    overrideAgent: V10_AGENT,
  };
  fs.writeFileSync(path.join(__dirname, "../.factory-address.json"), JSON.stringify(out, null, 2));

  console.log("\n" + "=".repeat(60));
  console.log("  DONE");
  console.log("  New factory:", factoryAddress);
  console.log("  Update lib/constants.ts:");
  console.log(`    FACTORY_ADDRESS = "${factoryAddress}"`);
  console.log("=".repeat(60));
}

main().catch(e => { console.error(e); process.exit(1); });
