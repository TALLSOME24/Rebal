/**
 * Seed initial liquidity into Rebal DEX pairs.
 * Mints tokens to deployer (within daily limits), approves router, adds liquidity.
 * LP tokens go to deployer address — NOT a dead address.
 *
 * Run: npx hardhat run scripts/seed-liquidity.cjs --network ritual
 *
 * Seed amounts (within 1000-unit/day MockERC20 limit):
 *   WETH/USDC : 0.3  WETH + 900 USDC   (~$540 total @ WETH=$1800)
 *   WETH/USDT : 0.3  WETH + 900 USDT   (~$540 total)
 *   WETH/WBTC : 0.05 WETH + 0.001 WBTC (~$90  total @ WBTC=$18k)
 */
require("dotenv").config();
const hre = require("hardhat");

const DEX = require("../.dex-addresses.json");

const ERC20_ABI = [
  "function mint(uint256 amount) external",
  "function balanceOf(address account) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function dailyMintLimit() external view returns (uint256)",
  "function mintedToday(address) external view returns (uint256)",
];

const ROUTER_ABI = [
  "function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB, uint256 liquidity)",
];

const TX_OPTS = {
  maxFeePerGas:         hre.ethers.parseUnits("2", "gwei"),
  maxPriorityFeePerGas: hre.ethers.parseUnits("1", "gwei"),
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Router  :", DEX.router);
  console.log("Chain   :", DEX.chainId, "\n");

  const router = new hre.ethers.Contract(DEX.router, ROUTER_ABI, deployer);
  // Ritual chain uses millisecond block.timestamp (~13 digits); use a far-future ms deadline
  const deadline = 9_999_999_999_999;

  const WETH = new hre.ethers.Contract(DEX.tokens.WETH, ERC20_ABI, deployer);
  const WBTC = new hre.ethers.Contract(DEX.tokens.WBTC, ERC20_ABI, deployer);
  const USDC = new hre.ethers.Contract(DEX.tokens.USDC, ERC20_ABI, deployer);
  const USDT = new hre.ethers.Contract(DEX.tokens.USDT, ERC20_ABI, deployer);

  // ── Mint tokens ──────────────────────────────────────────────────────────────
  // WETH: 0.3 + 0.3 + 0.05 = 0.65 WETH total (18 dec) → well within 1000/day limit
  // USDC: 900 (6 dec)
  // USDT: 900 (6 dec)
  // WBTC: 0.001 (8 dec)
  const mintAmounts = [
    { token: WETH, sym: "WETH", amount: hre.ethers.parseUnits("0.65", 18) },
    { token: USDC, sym: "USDC", amount: hre.ethers.parseUnits("900",  6)  },
    { token: USDT, sym: "USDT", amount: hre.ethers.parseUnits("900",  6)  },
    { token: WBTC, sym: "WBTC", amount: hre.ethers.parseUnits("0.001", 8) },
  ];

  console.log("── Minting tokens ──────────────────────────────────────────────");
  for (const { token, sym, amount } of mintAmounts) {
    const limit  = await token.dailyMintLimit();
    const minted = await token.mintedToday(deployer.address);
    const remaining = limit - minted;
    const mintAmt = amount > remaining ? remaining : amount;
    if (mintAmt <= 0n) {
      console.log(`  ${sym}: daily limit already reached — using existing balance`);
      continue;
    }
    const tx = await token.mint(mintAmt, TX_OPTS);
    await tx.wait();
    const bal = await token.balanceOf(deployer.address);
    console.log(`  ${sym}: minted ${hre.ethers.formatUnits(mintAmt, await token.decimals())}  (balance: ${hre.ethers.formatUnits(bal, await token.decimals())})`);
  }
  console.log();

  // ── Pair 1: WETH / USDC ──────────────────────────────────────────────────────
  const wethForUsdc  = hre.ethers.parseUnits("0.3", 18);
  const usdcForPool  = hre.ethers.parseUnits("900", 6);
  await addLiquidity(router, deployer, WETH, USDC, wethForUsdc, usdcForPool, "WETH/USDC", deadline);

  // ── Pair 2: WETH / USDT ──────────────────────────────────────────────────────
  const wethForUsdt  = hre.ethers.parseUnits("0.3",   18);
  const usdtForPool  = hre.ethers.parseUnits("900",    6);
  await addLiquidity(router, deployer, WETH, USDT, wethForUsdt, usdtForPool, "WETH/USDT", deadline);

  // ── Pair 3: WETH / WBTC ──────────────────────────────────────────────────────
  const wethForWbtc  = hre.ethers.parseUnits("0.05",  18);
  const wbtcForPool  = hre.ethers.parseUnits("0.001",  8);
  await addLiquidity(router, deployer, WETH, WBTC, wethForWbtc, wbtcForPool, "WETH/WBTC", deadline);

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  LIQUIDITY SEEDED — LP tokens held by deployer");
  console.log("  Run recover-liquidity.cjs to pull liquidity back at any time.");
  console.log("═══════════════════════════════════════════════════════════════");
}

async function addLiquidity(router, deployer, tokenA, tokenB, amountA, amountB, label, deadline) {
  console.log(`── Adding liquidity: ${label} ───────────────────────────────────`);
  const decA = await tokenA.decimals();
  const decB = await tokenB.decimals();
  const symA = await tokenA.symbol();
  const symB = await tokenB.symbol();

  // Check balances
  const balA = await tokenA.balanceOf(deployer.address);
  const balB = await tokenB.balanceOf(deployer.address);
  console.log(`  ${symA} balance: ${hre.ethers.formatUnits(balA, decA)}`);
  console.log(`  ${symB} balance: ${hre.ethers.formatUnits(balB, decB)}`);
  if (balA < amountA) { console.log(`  !! Insufficient ${symA} balance — skipping`); return; }
  if (balB < amountB) { console.log(`  !! Insufficient ${symB} balance — skipping`); return; }

  // Approve
  const appA = await tokenA.approve(router.target || router.address, amountA, TX_OPTS);
  await appA.wait();
  const appB = await tokenB.approve(router.target || router.address, amountB, TX_OPTS);
  await appB.wait();
  console.log(`  Approved router for ${symA} + ${symB}`);

  // Add liquidity
  const tx = await router.addLiquidity(
    tokenA.target || tokenA.address,
    tokenB.target || tokenB.address,
    amountA,
    amountB,
    0n,          // amountAMin — no slippage guard needed for seed
    0n,          // amountBMin
    deployer.address,   // LP tokens to deployer
    deadline,
    TX_OPTS
  );
  const receipt = await tx.wait();

  // Parse Mint event for liquidity amount
  const pair = new hre.ethers.Contract(
    await (new hre.ethers.Contract(
      require("../.dex-addresses.json").factory,
      ["function getPair(address,address) external view returns (address)"],
      deployer
    )).getPair(tokenA.target || tokenA.address, tokenB.target || tokenB.address),
    ["function balanceOf(address) external view returns (uint256)", "function totalSupply() external view returns (uint256)"],
    deployer
  );
  const lpBal = await pair.balanceOf(deployer.address);
  const lpTotal = await pair.totalSupply();
  console.log(`  LP minted  : ${hre.ethers.formatUnits(lpBal, 18)}`);
  console.log(`  LP total   : ${hre.ethers.formatUnits(lpTotal, 18)}`);
  console.log(`  ✓ ${label} liquidity added\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
