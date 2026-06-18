/**
 * Recover locked RITUAL from PortfolioAgent v10 RitualWallet.
 *
 * The v10 RitualWallet lock expires at block 34,109,793.
 * Run this script after that block to withdraw ~0.68 RITUAL back to the owner wallet.
 *
 * Run: node scripts/recover-v10-ritual.cjs
 */
require("dotenv").config();
const {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const RITUAL_RPC  = process.env.RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";
const V10_AGENT   = "0x26b3a6c452a9a24cb10fa7892340ca6cc7631016";
const RITUAL_WALLET = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
const LOCK_EXPIRES_AT = 34_109_793n;

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

const agentAbi = [
  {
    name: "withdrawAllRitualFees",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
];

const walletAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "lockUntil",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];

async function main() {
  const block = await pub.getBlockNumber();

  console.log("=".repeat(58));
  console.log("  recover-v10-ritual  --  PortfolioAgent v10");
  console.log("=".repeat(58));
  console.log("  v10 agent  :", V10_AGENT);
  console.log("  owner      :", account.address);
  console.log("  block      :", block.toString());

  // ── Check lock status ──────────────────────────────────────────────────────
  const rwBal  = await pub.readContract({ address: RITUAL_WALLET, abi: walletAbi, functionName: "balanceOf", args: [V10_AGENT] });
  const rwLock = await pub.readContract({ address: RITUAL_WALLET, abi: walletAbi, functionName: "lockUntil", args: [V10_AGENT] });

  console.log("\n  RitualWallet balance :", formatEther(rwBal), "RITUAL");
  console.log("  lockUntil            :", rwLock.toString());

  if (rwBal === 0n) {
    console.log("\n  Nothing to withdraw — RitualWallet balance is 0.");
    process.exit(0);
  }

  if (block < rwLock) {
    const blocksLeft = rwLock - block;
    const minutesLeft = Math.round(Number(blocksLeft) * 60 / 1000);
    console.log("\n  Lock has NOT expired yet.");
    console.log(`  Expires in : ${blocksLeft.toString()} blocks (~${minutesLeft} min at 60ms/block)`);
    console.log(`  Try again after block ${rwLock.toString()}`);
    process.exit(0);
  }

  console.log("\n  Lock EXPIRED — proceeding with withdrawal.");

  // ── Before balance ─────────────────────────────────────────────────────────
  const ownerBefore = await pub.getBalance({ address: account.address });
  console.log("\n  owner RITUAL (before) :", formatEther(ownerBefore));

  // ── withdrawAllRitualFees ──────────────────────────────────────────────────
  console.log("\n  Calling withdrawAllRitualFees() on v10...");
  let txHash;
  try {
    txHash = await wall.writeContract({
      address: V10_AGENT,
      abi: agentAbi,
      functionName: "withdrawAllRitualFees",
    });
  } catch (err) {
    console.error("  withdrawAllRitualFees FAILED:", err.shortMessage || err.message);
    process.exit(1);
  }

  console.log("  TX:", txHash);
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  console.log("  status:", receipt.status === "success" ? "SUCCESS" : "REVERTED");

  if (receipt.status !== "success") {
    console.error("  Transaction reverted.");
    process.exit(1);
  }

  // ── After balances ─────────────────────────────────────────────────────────
  const ownerAfter  = await pub.getBalance({ address: account.address });
  const rwBalAfter  = await pub.readContract({ address: RITUAL_WALLET, abi: walletAbi, functionName: "balanceOf", args: [V10_AGENT] });

  console.log("\n  owner RITUAL (after)  :", formatEther(ownerAfter));
  console.log("  recovered             :", formatEther(ownerAfter - ownerBefore), "RITUAL (net of gas)");
  console.log("  v10 RitualWallet bal  :", formatEther(rwBalAfter), "RITUAL (should be 0)");

  console.log("\n" + "=".repeat(58));
  console.log("  DONE");
  console.log("=".repeat(58));
}

main().catch(e => { console.error(e); process.exit(1); });
