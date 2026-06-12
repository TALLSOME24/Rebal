/**
 * Deploy PortfolioAgentFactory to Ritual testnet (chain 1979).
 * Each user calls factory.deployAgent() to get their own PortfolioAgent instance.
 *
 * .env: PRIVATE_KEY=0x...
 * Run: npx hardhat run scripts/deploy-factory.cjs --network ritual
 */
require("dotenv").config();
const hre = require("hardhat");
const fs  = require("fs");
const path = require("path");

async function main() {
  const signers = await hre.ethers.getSigners();
  if (!signers.length) throw new Error("PRIVATE_KEY not set in .env");
  const deployer = signers[0];

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance :", hre.ethers.formatEther(balance), "RITUAL");

  const Factory = await hre.ethers.getContractFactory("PortfolioAgentFactory");
  const nonce   = await hre.ethers.provider.getTransactionCount(deployer.address, "pending");

  console.log("\nDeploying PortfolioAgentFactory... (nonce:", nonce, ")");
  const factory = await Factory.deploy({
    nonce,
    maxFeePerGas:         hre.ethers.parseUnits("2", "gwei"),
    maxPriorityFeePerGas: hre.ethers.parseUnits("1", "gwei"),
  });
  await factory.waitForDeployment();

  const address = await factory.getAddress();
  console.log("\nPortfolioAgentFactory deployed:", address);
  console.log("Explorer:", `https://explorer.ritualfoundation.org/address/${address}`);

  // Save address so CI / frontend can pick it up
  const out = { factoryAddress: address, deployedAt: new Date().toISOString(), deployer: deployer.address };
  const outPath = path.join(__dirname, "..", ".factory-address.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("\nSaved to .factory-address.json");
  console.log("\nAdd to lib/constants.ts:");
  console.log(`  export const FACTORY_ADDRESS: Address = "${address}";`);
}

main().catch(e => { console.error(e); process.exit(1); });
