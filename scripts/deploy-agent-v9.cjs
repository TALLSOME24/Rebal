/**
 * Deploy PortfolioAgentFactory v9 (with dexRouter param) to Ritual Chain 1979.
 * Updates .factory-address.json.
 *
 * Run: npx hardhat run scripts/deploy-agent-v9.cjs --network ritual
 */
require("dotenv").config();
const hre = require("hardhat");
const fs  = require("fs");
const path = require("path");

const DEX = require("../.dex-addresses.json");

const TX_OPTS = {
  maxFeePerGas:         hre.ethers.parseUnits("2", "gwei"),
  maxPriorityFeePerGas: hre.ethers.parseUnits("1", "gwei"),
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance :", hre.ethers.formatEther(balance), "RITUAL");
  console.log("DEX Router:", DEX.router, "\n");

  const Factory = await hre.ethers.getContractFactory("PortfolioAgentFactory");
  const factory = await Factory.deploy(DEX.router, TX_OPTS);
  await factory.waitForDeployment();
  const addr = await factory.getAddress();

  const out = {
    factoryAddress: addr,
    dexRouter: DEX.router,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    version: "v9",
  };
  const outPath = path.join(__dirname, "..", ".factory-address.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  PortfolioAgentFactory v9 DEPLOYED");
  console.log("  Factory :", addr);
  console.log("  Router  :", DEX.router);
  console.log("  Saved to .factory-address.json");
  console.log("═══════════════════════════════════════════════════════════════");
}

main().catch(e => { console.error(e); process.exit(1); });
