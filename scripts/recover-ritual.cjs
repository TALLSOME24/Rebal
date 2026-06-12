/**
 * Diagnose and attempt RITUAL recovery from old PortfolioAgent deployments.
 *
 * Background: RitualWallet.withdraw(amount) can only be called by the SAME
 * address that deposited (the agent contract). The old contracts (v4-v7) have
 * depositFeesForCaller() but NO withdrawFees() function, so the deposited RITUAL
 * is permanently locked inside those contracts.
 *
 * This script:
 *   1. Reads balanceOf + lockUntil for every known contract version
 *   2. Attempts withdrawFees() on each — reverts immediately if function is absent
 *   3. Reports exactly what is stuck and why
 *
 * v8 (with withdrawFees) will be deployed separately.
 *
 * Run: node scripts/recover-ritual.cjs
 */
require("dotenv").config();
const { createPublicClient, createWalletClient, http, formatEther } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const RITUAL_RPC = process.env.RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";
const PK = process.env.PRIVATE_KEY;
if (!PK) { console.error("PRIVATE_KEY not in .env"); process.exit(1); }
const account = privateKeyToAccount(PK);

const chain = {
  id: 1979,
  name: "Ritual",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: { default: { http: [RITUAL_RPC] } },
};
const pub  = createPublicClient({ chain, transport: http() });
const wall = createWalletClient({ account, chain, transport: http() });

const RITUAL_WALLET = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";

const walletAbi = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "lockUntil",  type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
];

// withdrawFees ABI — only v8+ will have this selector
const withdrawAbi = [
  { name: "withdrawFees", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
];

const VERSIONS = [
  { label: "v4", address: "0x971681AB0aeE3E4ED237305618CB95e2cEA3f4db" },
  { label: "v5", address: "0x72B1e7DaCbFEf5072E52db9A9884F0Dca2D5DEA2" },
  { label: "v6", address: "0x51bebdC4aF5F6058D826Fc8621A854e896c5e3ED" },
  { label: "v7", address: "0xB2f331A2403d35C79BcAc72885a55676B17B8348" },
];

async function main() {
  const block = await pub.getBlockNumber();
  const eoa   = await pub.getBalance({ address: account.address });

  console.log("═".repeat(64));
  console.log("  RITUAL Recovery Diagnostic");
  console.log("═".repeat(64));
  console.log("  owner wallet :", account.address);
  console.log("  EOA balance  :", formatEther(eoa), "RITUAL");
  console.log("  current block:", block.toString());
  console.log();

  let totalStuck = 0n;
  let totalRecoverable = 0n;
  const rows = [];

  for (const v of VERSIONS) {
    const bal  = await pub.readContract({
      address: RITUAL_WALLET, abi: walletAbi, functionName: "balanceOf", args: [v.address],
    });
    const lock = await pub.readContract({
      address: RITUAL_WALLET, abi: walletAbi, functionName: "lockUntil", args: [v.address],
    });

    const lockExpired = lock < block;
    const status = bal === 0n ? "empty" : lockExpired ? "LOCK EXPIRED" : "LOCKED";

    rows.push({ ...v, bal, lock, lockExpired, status });
    totalStuck += bal;
  }

  // Table header
  console.log(
    "  " + "Version".padEnd(8) +
    "Address".padEnd(44) +
    "Balance".padEnd(14) +
    "Lock Status"
  );
  console.log("  " + "─".repeat(90));

  for (const r of rows) {
    const balStr  = (parseFloat(formatEther(r.bal))).toFixed(4).padEnd(14);
    const lockStr = r.bal === 0n ? "n/a" :
      r.lockExpired ? `EXPIRED (block ${r.lock})` : `active until ${r.lock}`;
    console.log(
      "  " + r.label.padEnd(8) +
      r.address.padEnd(44) +
      balStr +
      lockStr
    );
  }

  console.log("  " + "─".repeat(90));
  console.log("  " + "TOTAL".padEnd(52) + formatEther(totalStuck).slice(0, 10).padEnd(14) + "RITUAL");
  console.log();

  // Attempt withdrawFees on each non-empty version
  console.log("─".repeat(64));
  console.log("  Attempting withdrawFees() on each contract...");
  console.log("─".repeat(64));

  for (const r of rows) {
    if (r.bal === 0n) {
      console.log(`  ${r.label}  (${r.address.slice(0, 14)}...)  empty — skip`);
      continue;
    }

    process.stdout.write(`  ${r.label}  (${r.address.slice(0, 14)}...)  `);

    try {
      // Simulate first — will revert if the function doesn't exist
      await pub.simulateContract({
        address: r.address,
        abi: withdrawAbi,
        functionName: "withdrawFees",
        args: [r.bal],
        account: account.address,
      });

      // Simulation succeeded — the contract has withdrawFees()
      const hash = await wall.writeContract({
        address: r.address,
        abi: withdrawAbi,
        functionName: "withdrawFees",
        args: [r.bal],
      });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status === "success") {
        console.log(`RECOVERED ${formatEther(r.bal)} RITUAL  tx:${hash.slice(0, 14)}...`);
        totalRecoverable += r.bal;
      } else {
        console.log(`TX REVERTED  tx:${hash.slice(0, 14)}...`);
      }
    } catch (e) {
      const msg = e.shortMessage || e.message || String(e);
      if (msg.includes("Function") || msg.includes("selector") || msg.includes("unknown") ||
          msg.includes("revert") || msg.includes("0x")) {
        console.log(`NO withdrawFees() — ${formatEther(r.bal)} RITUAL STUCK`);
      } else {
        console.log(`FAILED: ${msg.slice(0, 80)}`);
      }
    }
  }

  console.log();
  console.log("═".repeat(64));
  console.log("  SUMMARY");
  console.log("═".repeat(64));
  console.log(`  Total RITUAL scanned : ${formatEther(totalStuck)} RITUAL`);
  console.log(`  Successfully recovered: ${formatEther(totalRecoverable)} RITUAL`);
  console.log(`  Permanently stuck     : ${formatEther(totalStuck - totalRecoverable)} RITUAL`);
  console.log();

  if (totalStuck - totalRecoverable > 0n) {
    console.log("  WHY funds are stuck:");
    console.log("  ─────────────────────────────────────────────────────────");
    console.log("  RitualWallet.withdraw() can only be called by the address");
    console.log("  that deposited (the agent contract). Old PortfolioAgent");
    console.log("  versions (v4–v7) have depositFeesForCaller() but no");
    console.log("  withdrawFees() function, so the contract cannot call");
    console.log("  RitualWallet.withdraw() on behalf of the owner.");
    console.log();
    console.log("  PATH FORWARD:");
    console.log("  ─────────────────────────────────────────────────────────");
    console.log("  PortfolioAgent v8 adds withdrawFees(uint256) which calls");
    console.log("  RitualWallet.withdraw(amount) from the contract's own");
    console.log("  context. Future deposits to v8 will be recoverable.");
    console.log("  Deploy: npx hardhat run scripts/deploy.cjs --network ritual");
  }
  console.log("═".repeat(64));
}

main().catch(e => { console.error(e); process.exit(1); });
