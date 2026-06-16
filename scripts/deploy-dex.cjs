/**
 * Deploy Rebal DEX (Uniswap V2 fork) to Ritual Chain 1979.
 * Deploys: RebalFactory, RebalRouter, creates 4 pairs.
 *
 * Run: npx hardhat run scripts/deploy-dex.cjs --network ritual
 */
require("dotenv").config();
const hre = require("hardhat");
const fs  = require("fs");
const path = require("path");

// Ritual Chain token addresses (mock ERC20s)
const WETH = "0xF42c8B335EE1ee9eD84109C68C238E50E0EE27EC";
const WBTC = "0x9Ca60C0d83EAD718D43C5f2134013e2bA4Ce3ec7";
const USDC = "0x031CbE4EbC5aF2ca432Ae3df4DbD65053F1A6584";
const USDT = "0xEa9E6a94E83E4B46eA7Dff6802D269F9a4e21E02";

const TX_OPTS = {
  maxFeePerGas:         hre.ethers.parseUnits("2", "gwei"),
  maxPriorityFeePerGas: hre.ethers.parseUnits("1", "gwei"),
};

async function deploy(name, args = []) {
  const Factory = await hre.ethers.getContractFactory(name);
  const contract = await Factory.deploy(...args, TX_OPTS);
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log(`  ${name}: ${addr}`);
  return { contract, addr };
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("PRIVATE_KEY not set in .env");

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance :", hre.ethers.formatEther(balance), "RITUAL\n");

  // 1. Deploy RebalFactory
  console.log("1. Deploying RebalFactory...");
  const { contract: factory, addr: factoryAddr } = await deploy("RebalFactory", [deployer.address]);

  // 2. Deploy RebalRouter
  console.log("2. Deploying RebalRouter...");
  const { contract: router, addr: routerAddr } = await deploy("RebalRouter", [factoryAddr]);

  // 3. Create pairs via factory
  console.log("\n3. Creating pairs...");
  const pairs = {};
  const pairDefs = [
    { name: "WETH/USDC", a: WETH, b: USDC },
    { name: "WETH/USDT", a: WETH, b: USDT },
    { name: "WETH/WBTC", a: WETH, b: WBTC },
    { name: "USDC/USDT", a: USDC, b: USDT },
  ];

  for (const { name, a, b } of pairDefs) {
    const tx = await factory.createPair(a, b, TX_OPTS);
    const receipt = await tx.wait();
    const pairAddr = await factory.getPair(a, b);
    pairs[name] = pairAddr;
    console.log(`  ${name}: ${pairAddr}`);
  }

  // 4. Save addresses
  const out = {
    factory:   factoryAddr,
    router:    routerAddr,
    pairs,
    tokens:    { WETH, WBTC, USDC, USDT },
    deployedAt: new Date().toISOString(),
    deployer:  deployer.address,
    chainId:   1979,
  };
  const outPath = path.join(__dirname, "..", ".dex-addresses.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log("\n═══════════════════════════════════════");
  console.log("  REBAL DEX DEPLOYED");
  console.log("═══════════════════════════════════════");
  console.log("  Factory :", factoryAddr);
  console.log("  Router  :", routerAddr);
  console.log("  Pairs   :");
  for (const [name, addr] of Object.entries(pairs)) {
    console.log(`    ${name.padEnd(12)}: ${addr}`);
  }
  console.log("\n  Saved to .dex-addresses.json");
  console.log("\n  Add to lib/constants.ts:");
  console.log(`  export const DEX_FACTORY: Address = "${factoryAddr}";`);
  console.log(`  export const DEX_ROUTER:  Address = "${routerAddr}";`);
  console.log("\n  Explorer:");
  console.log(`    Factory : https://explorer.ritualfoundation.org/address/${factoryAddr}`);
  console.log(`    Router  : https://explorer.ritualfoundation.org/address/${routerAddr}`);
}

main().catch(e => { console.error(e); process.exit(1); });
