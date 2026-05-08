/**
 * Deploy Rebal mock assets to Ritual testnet (chain 1979).
 *
 * .env:
 *   PRIVATE_KEY=0x...
 */
require("dotenv").config();

const hre = require("hardhat");

async function main() {
  const signers = await hre.ethers.getSigners();
  if (!signers.length) {
    throw new Error("Missing deployer: add PRIVATE_KEY=0x... to .env.");
  }

  const deployer = signers[0];
  console.log("Deployer:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "RITUAL");

  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const specs = [
    ["Wrapped Ether", "WETH", 18],
    ["Wrapped Bitcoin", "WBTC", 8],
    ["USD Coin", "USDC", 6],
    ["Tether", "USDT", 6],
  ];

  const deployed = {};
  for (const [name, symbol, decimals] of specs) {
    const token = await MockERC20.deploy(name, symbol, decimals);
    await token.waitForDeployment();
    const address = await token.getAddress();
    deployed[symbol] = address;
    console.log(`${symbol} deployed:`, address);
    console.log(`${symbol} explorer:`, `https://explorer.ritualfoundation.org/address/${address}`);
  }

  const MockPriceFeed = await hre.ethers.getContractFactory("MockPriceFeed");
  const priceFeed = await MockPriceFeed.deploy();
  await priceFeed.waitForDeployment();
  deployed.MOCK_PRICE_FEED = await priceFeed.getAddress();
  console.log("MockPriceFeed deployed:", deployed.MOCK_PRICE_FEED);
  console.log("MockPriceFeed explorer:", `https://explorer.ritualfoundation.org/address/${deployed.MOCK_PRICE_FEED}`);

  console.log("\nFrontend env:");
  console.log(`NEXT_PUBLIC_MOCK_WETH=${deployed.WETH}`);
  console.log(`NEXT_PUBLIC_MOCK_WBTC=${deployed.WBTC}`);
  console.log(`NEXT_PUBLIC_MOCK_USDC=${deployed.USDC}`);
  console.log(`NEXT_PUBLIC_MOCK_USDT=${deployed.USDT}`);
  console.log(`NEXT_PUBLIC_MOCK_PRICE_FEED=${deployed.MOCK_PRICE_FEED}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
