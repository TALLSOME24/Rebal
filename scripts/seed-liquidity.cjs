/**
 * Seed initial liquidity into Rebal DEX pairs.
 * Mints tokens to deployer, approves router, adds liquidity.
 * LP tokens go to deployer address.
 *
 * Run: node scripts/seed-liquidity.cjs
 *
 * Seed amounts:
 *   WETH/USDC : 0.3  WETH + 900  USDC
 *   WETH/USDT : 0.3  WETH + 900  USDT
 *   WETH/WBTC : 0.05 WETH + 0.001 WBTC
 */
require("dotenv").config();
const {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const DEX = require("../.dex-addresses.json");

const PK = process.env.PRIVATE_KEY;
if (!PK) { console.error("PRIVATE_KEY not set in .env"); process.exit(1); }
const account = privateKeyToAccount(PK);

const RITUAL_RPC = process.env.RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";
const chain = {
  id: 1979,
  name: "Ritual",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: { default: { http: [RITUAL_RPC] } },
};

const pub  = createPublicClient({ chain, transport: http() });
const wall = createWalletClient({ account, chain, transport: http() });

const ERC20_ABI = [
  { name: "mint",      type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve",   type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "decimals",  type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { name: "symbol",    type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
];

const ROUTER_ABI = [
  {
    name: "addLiquidity",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenA",         type: "address" },
      { name: "tokenB",         type: "address" },
      { name: "amountADesired", type: "uint256" },
      { name: "amountBDesired", type: "uint256" },
      { name: "amountAMin",     type: "uint256" },
      { name: "amountBMin",     type: "uint256" },
      { name: "to",             type: "address" },
      { name: "deadline",       type: "uint256" },
    ],
    outputs: [
      { name: "amountA",    type: "uint256" },
      { name: "amountB",    type: "uint256" },
      { name: "liquidity",  type: "uint256" },
    ],
  },
];

const PAIR_ABI = [
  { name: "balanceOf",   type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "totalSupply", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }] },
];

// Ritual block.timestamp is in milliseconds — use far-future ms deadline
const DEADLINE = 9_999_999_999_999n;

async function send(label, fn) {
  let hash;
  try { hash = await fn(); }
  catch (err) { console.error(`  ${label} FAILED:`, err.shortMessage || err.message); process.exit(1); }
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") { console.error(`  ${label} REVERTED`); process.exit(1); }
  return receipt;
}

async function mintToken(addr, sym, decimals, amount) {
  console.log(`  minting ${formatUnits(amount, decimals)} ${sym} to ${account.address}...`);
  await send(`mint ${sym}`, () =>
    wall.writeContract({ address: addr, abi: ERC20_ABI, functionName: "mint",
      args: [account.address, amount] })
  );
  const bal = await pub.readContract({ address: addr, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] });
  console.log(`  ${sym} balance: ${formatUnits(bal, decimals)}`);
  return bal;
}

async function addLiquidity(label, tokenA, tokenB, symA, symB, decA, decB, amountA, amountB, pairAddr) {
  console.log(`\n── ${label} ─────────────────────────────────────────`);

  const balA = await pub.readContract({ address: tokenA, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] });
  const balB = await pub.readContract({ address: tokenB, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] });
  console.log(`  ${symA} balance: ${formatUnits(balA, decA)}`);
  console.log(`  ${symB} balance: ${formatUnits(balB, decB)}`);
  if (balA < amountA) { console.log(`  !! Insufficient ${symA} — skipping`); return; }
  if (balB < amountB) { console.log(`  !! Insufficient ${symB} — skipping`); return; }

  await send(`approve ${symA}`, () =>
    wall.writeContract({ address: tokenA, abi: ERC20_ABI, functionName: "approve",
      args: [DEX.router, amountA] })
  );
  await send(`approve ${symB}`, () =>
    wall.writeContract({ address: tokenB, abi: ERC20_ABI, functionName: "approve",
      args: [DEX.router, amountB] })
  );
  console.log(`  approved router for ${symA} + ${symB}`);

  await send(`addLiquidity ${label}`, () =>
    wall.writeContract({ address: DEX.router, abi: ROUTER_ABI, functionName: "addLiquidity",
      args: [tokenA, tokenB, amountA, amountB, 0n, 0n, account.address, DEADLINE] })
  );

  const lpBal   = await pub.readContract({ address: pairAddr, abi: PAIR_ABI, functionName: "balanceOf",   args: [account.address] });
  const lpTotal = await pub.readContract({ address: pairAddr, abi: PAIR_ABI, functionName: "totalSupply", args: [] });
  console.log(`  LP minted  : ${formatUnits(lpBal,   18)}`);
  console.log(`  LP total   : ${formatUnits(lpTotal, 18)}`);
  console.log(`  ✓ ${label} done`);
}

async function main() {
  console.log("═".repeat(62));
  console.log("  seed-liquidity  —  Ritual Testnet (1979)");
  console.log("═".repeat(62));
  console.log("  deployer :", account.address);
  console.log("  router   :", DEX.router);

  const WETH = DEX.tokens.WETH;
  const WBTC = DEX.tokens.WBTC;
  const USDC = DEX.tokens.USDC;
  const USDT = DEX.tokens.USDT;

  // ── Mint all tokens ────────────────────────────────────────────────────────
  console.log("\n── Minting tokens ──────────────────────────────────────────────");
  await mintToken(WETH, "WETH", 18, parseUnits("0.65",  18));
  await mintToken(USDC, "USDC",  6, parseUnits("900",    6));
  await mintToken(USDT, "USDT",  6, parseUnits("900",    6));
  await mintToken(WBTC, "WBTC",  8, parseUnits("0.001",  8));

  // ── Add liquidity to each pair ─────────────────────────────────────────────
  await addLiquidity(
    "WETH/USDC",
    WETH, USDC, "WETH", "USDC", 18, 6,
    parseUnits("0.3", 18), parseUnits("900", 6),
    DEX.pairs["WETH/USDC"]
  );

  await addLiquidity(
    "WETH/USDT",
    WETH, USDT, "WETH", "USDT", 18, 6,
    parseUnits("0.3", 18), parseUnits("900", 6),
    DEX.pairs["WETH/USDT"]
  );

  await addLiquidity(
    "WETH/WBTC",
    WETH, WBTC, "WETH", "WBTC", 18, 8,
    parseUnits("0.05", 18), parseUnits("0.001", 8),
    DEX.pairs["WETH/WBTC"]
  );

  console.log("\n" + "═".repeat(62));
  console.log("  DONE — liquidity seeded, LP tokens held by deployer");
  console.log("═".repeat(62));
}

main().catch(e => { console.error(e); process.exit(1); });
