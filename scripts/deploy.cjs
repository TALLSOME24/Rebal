/**
 * Deploy PortfolioAgent to Ritual testnet (chain 1979).
 *
 * .env:
 *   PRIVATE_KEY=0x...
 */
require("dotenv").config();

const hre = require("hardhat");

const SCHEDULER = "0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B";

async function main() {
  const signers = await hre.ethers.getSigners();
  if (!signers.length) {
    throw new Error(
      'Missing deployer: add PRIVATE_KEY=0x... to .env (fund the account with test RITUAL on Ritual chain 1979).'
    );
  }
  const deployer = signers[0];

  console.log("Deployer:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "RITUAL");

  const PortfolioAgent = await hre.ethers.getContractFactory("PortfolioAgent");
  const agent = await PortfolioAgent.deploy(SCHEDULER);
  await agent.waitForDeployment();

  const address = await agent.getAddress();
  console.log("\nPortfolioAgent deployed:", address);
  console.log("Explorer:", `https://explorer.ritualfoundation.org/address/${address}`);
  console.log("\nSet your frontend env:\n  NEXT_PUBLIC_PORTFOLIO_AGENT=" + address);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
