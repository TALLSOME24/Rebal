/**
 * Recover RITUAL from the V9 PortfolioAgent RitualWallet.
 * Calls withdrawAllRitualFees() which internally calls IRitualWallet.withdraw()
 * and forwards the RITUAL to the owner wallet.
 *
 * Run: node scripts/recover-v9-ritual.cjs
 */
require("dotenv").config();
const { createPublicClient, createWalletClient, http, formatEther } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const RITUAL_RPC = process.env.RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";
const V9_AGENT   = "0xc94Fcf97F441Ae6a693b8D2C7794778AEeA06Ea6";
const RITUAL_WALLET = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";

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
];

async function main() {
  console.log("=".repeat(58));
  console.log("  Recover RITUAL from PortfolioAgent V9");
  console.log("=".repeat(58));
  console.log("  V9 agent :", V9_AGENT);
  console.log("  owner    :", account.address);

  // Before balances
  const [rwBefore, ownerBefore] = await Promise.all([
    pub.readContract({ address: RITUAL_WALLET, abi: walletAbi, functionName: "balanceOf", args: [V9_AGENT] }),
    pub.getBalance({ address: account.address }),
  ]);

  console.log("\n  --- Before ---");
  console.log("  V9 RitualWallet balance :", formatEther(rwBefore), "RITUAL");
  console.log("  Owner native balance    :", formatEther(ownerBefore), "RITUAL");

  if (rwBefore === 0n) {
    console.log("\n  Nothing to recover — RitualWallet balance is 0.");
    process.exit(0);
  }

  console.log("\n  Calling withdrawAllRitualFees()...");
  let txHash;
  try {
    txHash = await wall.writeContract({
      address: V9_AGENT,
      abi: agentAbi,
      functionName: "withdrawAllRitualFees",
    });
  } catch (err) {
    console.error("  FAILED:", err.shortMessage || err.message);
    process.exit(1);
  }

  console.log("  TX:", txHash);
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  console.log("  status:", receipt.status === "success" ? "SUCCESS" : "REVERTED");

  if (receipt.status !== "success") {
    console.error("  Transaction reverted.");
    process.exit(1);
  }

  // After balances
  const [rwAfter, ownerAfter] = await Promise.all([
    pub.readContract({ address: RITUAL_WALLET, abi: walletAbi, functionName: "balanceOf", args: [V9_AGENT] }),
    pub.getBalance({ address: account.address }),
  ]);

  console.log("\n  --- After ---");
  console.log("  V9 RitualWallet balance :", formatEther(rwAfter), "RITUAL");
  console.log("  Owner native balance    :", formatEther(ownerAfter), "RITUAL");
  console.log("\n  Recovered               :", formatEther(rwBefore - rwAfter), "RITUAL");
  console.log("=".repeat(58));
}

main().catch(e => { console.error(e); process.exit(1); });
