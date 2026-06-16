/**
 * Recover liquidity from all Rebal DEX pairs back to the deployer.
 * Reads LP balances, approves pair contracts, calls removeLiquidity.
 *
 * Run: npx hardhat run scripts/recover-liquidity.cjs --network ritual
 */
require("dotenv").config();
const hre = require("hardhat");

const DEX = require("../.dex-addresses.json");

const LP_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function totalSupply() external view returns (uint256)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
];

const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
];

const ROUTER_ABI = [
  "function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB)",
];

const TX_OPTS = {
  maxFeePerGas:         hre.ethers.parseUnits("2", "gwei"),
  maxPriorityFeePerGas: hre.ethers.parseUnits("1", "gwei"),
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const router = new hre.ethers.Contract(DEX.router, ROUTER_ABI, deployer);
  // Ritual chain uses millisecond block.timestamp (~13 digits); use a far-future ms deadline
  const deadline = 9_999_999_999_999;

  console.log("Deployer:", deployer.address);
  console.log("Router  :", DEX.router, "\n");

  const pairs = Object.entries(DEX.pairs || {});
  if (pairs.length === 0) {
    console.log("No pairs in .dex-addresses.json");
    return;
  }

  for (const [label, pairAddr] of pairs) {
    console.log(`── ${label} (${pairAddr}) ────────────────────────────────────────`);
    const lp = new hre.ethers.Contract(pairAddr, LP_ABI, deployer);
    const lpBal = await lp.balanceOf(deployer.address);

    if (lpBal === 0n) {
      console.log("  No LP balance — skipping\n");
      continue;
    }
    console.log(`  LP balance: ${hre.ethers.formatUnits(lpBal, 18)}`);

    const token0Addr = await lp.token0();
    const token1Addr = await lp.token1();

    // Approve pair contract to spend LP tokens
    const appTx = await lp.approve(router.target || router.address, lpBal, TX_OPTS);
    await appTx.wait();
    console.log(`  Approved LP for router`);

    // Remove liquidity → tokens to deployer
    const tx = await router.removeLiquidity(
      token0Addr,
      token1Addr,
      lpBal,
      0n,               // amountAMin — accept any
      0n,               // amountBMin
      deployer.address,
      deadline,
      TX_OPTS
    );
    await tx.wait();

    // Report recovered balances
    const t0 = new hre.ethers.Contract(token0Addr, ERC20_ABI, deployer);
    const t1 = new hre.ethers.Contract(token1Addr, ERC20_ABI, deployer);
    const [sym0, dec0, bal0] = await Promise.all([t0.symbol(), t0.decimals(), t0.balanceOf(deployer.address)]);
    const [sym1, dec1, bal1] = await Promise.all([t1.symbol(), t1.decimals(), t1.balanceOf(deployer.address)]);
    console.log(`  Recovered ${sym0}: balance now ${hre.ethers.formatUnits(bal0, dec0)}`);
    console.log(`  Recovered ${sym1}: balance now ${hre.ethers.formatUnits(bal1, dec1)}`);
    console.log(`  ✓ ${label} liquidity removed\n`);
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  LIQUIDITY RECOVERED — all LP burned, tokens returned to deployer");
  console.log("═══════════════════════════════════════════════════════════════");
}

main().catch(e => { console.error(e); process.exit(1); });
