/**
 * Deploy PortfolioAgent v10 (Sovereign Agent architecture) on Ritual testnet.
 *
 * What this does:
 *   1. Reads PortfolioAgent artifact from Hardhat compilation output
 *   2. Deploys the contract with (owner, dexRouter) constructor args
 *   3. Prints the new agent address — update AGENT_ADDRESS in .env
 *
 * After deploy:
 *   export AGENT_ADDRESS=<new address>
 *   node scripts/check-agent.cjs
 *
 * Run: node scripts/deploy-v10.cjs
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const RITUAL_RPC = process.env.RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";
const DEX_ROUTER = process.env.DEX_ROUTER || "0x0000000000000000000000000000000000000000";

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

// Load compiled artifact
const artifactPath = path.join(__dirname, "../artifacts/contracts/PortfolioAgent.sol/PortfolioAgent.json");
if (!fs.existsSync(artifactPath)) {
  console.error("Artifact not found. Run: npx hardhat compile");
  process.exit(1);
}
const { abi, bytecode } = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

async function main() {
  const block = await pub.getBlockNumber();
  const bal   = await pub.getBalance({ address: account.address });

  console.log("=".repeat(60));
  console.log("  Deploy PortfolioAgent v10  --  Ritual Testnet (1979)");
  console.log("=".repeat(60));
  console.log("  deployer   :", account.address);
  console.log("  balance    :", formatEther(bal), "RITUAL");
  console.log("  block      :", block.toString());
  console.log("  dexRouter  :", DEX_ROUTER);

  if (bal === 0n) {
    console.error("Deployer has no RITUAL for gas.");
    process.exit(1);
  }

  console.log("\n  Deploying PortfolioAgent...");
  let txHash;
  try {
    txHash = await wall.deployContract({
      abi,
      bytecode,
      args: [account.address, DEX_ROUTER],
    });
  } catch (err) {
    console.error("  Deploy FAILED:", err.shortMessage || err.message);
    process.exit(1);
  }

  console.log("  TX:", txHash);
  console.log("  Waiting for receipt...");
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  console.log("  status     :", receipt.status === "success" ? "SUCCESS" : "REVERTED");

  if (receipt.status !== "success" || !receipt.contractAddress) {
    console.error("  Deployment reverted or contractAddress missing.");
    process.exit(1);
  }

  const agentAddress = receipt.contractAddress;

  console.log("\n" + "=".repeat(60));
  console.log("  PortfolioAgent v10 deployed!");
  console.log("  address    :", agentAddress);
  console.log("  gasUsed    :", receipt.gasUsed.toString());
  console.log("=".repeat(60));
  console.log("\n  Next steps:");
  console.log(`  1. Add AGENT_ADDRESS=${agentAddress} to .env`);
  console.log("  2. registerPortfolio (include ECIES-encrypted secrets)");
  console.log("  3. node scripts/relock-and-start.cjs");
  console.log("  4. node scripts/check-agent.cjs");
  console.log("\n  ECIES secrets (encrypt off-chain with nonce=12):");
  console.log('  plaintext: {"LLM_PROVIDER":"ritual"}');
  console.log("  encrypt to executor node.publicKey from TEEServiceRegistry cap=0");
}

main().catch(e => { console.error(e); process.exit(1); });
