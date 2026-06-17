/**
 * Encrypts sovereign agent secrets for PortfolioAgent v10.
 *
 * Fetches the cap=0 (sovereign agent) executor's public key from TEEServiceRegistry,
 * then ECIES-encrypts {"LLM_PROVIDER":"ritual"} with nonce length = 12 (required).
 *
 * Output: .encrypted-secrets.json  (hex blob + metadata)
 *
 * Run: node scripts/encrypt-secrets.cjs
 */
require("dotenv").config();
const fs   = require("fs");
const path = require("path");
const { createPublicClient, http } = require("viem");
const { ECIES_CONFIG, encrypt, PublicKey } = require("eciesjs");

const RITUAL_RPC = process.env.RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";
const TEE_REG    = "0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F";

const chain = {
  id: 1979,
  name: "Ritual",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: { default: { http: [RITUAL_RPC] } },
};
const client = createPublicClient({ chain, transport: http() });

const teeAbi = [
  {
    name: "getServicesByCapability",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "capability",    type: "uint8" },
      { name: "checkValidity", type: "bool"  },
    ],
    outputs: [{ name: "services", type: "tuple[]", components: [
      { name: "node", type: "tuple", components: [
        { name: "paymentAddress",  type: "address" },
        { name: "teeAddress",      type: "address" },
        { name: "teeType",         type: "uint8"   },
        { name: "publicKey",       type: "bytes"   },
        { name: "endpoint",        type: "string"  },
        { name: "certPubKeyHash",  type: "bytes32" },
        { name: "capability",      type: "uint8"   },
      ]},
      { name: "isValid",    type: "bool"    },
      { name: "workloadId", type: "bytes32" },
    ]}],
  },
];

// Set nonce length to 12 BEFORE any encrypt call.
// eciesjs defaults to 16; Ritual TEE decryption requires exactly 12.
ECIES_CONFIG.symmetricNonceLength = 12;

async function main() {
  console.log("=".repeat(60));
  console.log("  encrypt-secrets  --  PortfolioAgent v10 sovereign agent");
  console.log("=".repeat(60));
  console.log("  TEEServiceRegistry :", TEE_REG);
  console.log("  RPC                :", RITUAL_RPC);
  console.log("  nonce length       :", ECIES_CONFIG.symmetricNonceLength, "(must be 12)");

  // Fetch cap=0 executors (sovereign agent capability)
  console.log("\n  Fetching cap=0 executor(s)...");
  let services;
  try {
    services = await client.readContract({
      address: TEE_REG,
      abi: teeAbi,
      functionName: "getServicesByCapability",
      args: [0, true],   // cap=0, checkValidity=true
    });
  } catch (err) {
    console.error("  TEEServiceRegistry read failed:", err.shortMessage || err.message);
    process.exit(1);
  }

  if (!services || services.length === 0) {
    console.error("  No valid cap=0 executors found.");
    process.exit(1);
  }

  console.log(`  Found ${services.length} executor(s):`);
  for (const svc of services) {
    console.log(`    teeAddress : ${svc.node.teeAddress}  ${svc.isValid ? "(valid)" : "(invalid)"}`);
    console.log(`    pubKey len : ${svc.node.publicKey.length} chars (hex with 0x)`);
  }

  // Use the first valid executor
  const executor = services[0];
  const teeAddress = executor.node.teeAddress;
  const pubKeyHex  = executor.node.publicKey; // 0x-prefixed hex

  console.log(`\n  Using executor : ${teeAddress}`);
  console.log(`  Public key     : ${pubKeyHex.slice(0, 20)}...${pubKeyHex.slice(-8)}`);

  // Convert hex pubkey to Buffer (strip 0x prefix)
  const pubKeyBuf = Buffer.from(pubKeyHex.slice(2), "hex");
  console.log(`  pubKey bytes   : ${pubKeyBuf.length} bytes`);

  if (pubKeyBuf.length === 0) {
    console.error("  Public key is empty — executor may not have registered its key yet.");
    process.exit(1);
  }

  // Construct secrets payload
  const secretsJson = JSON.stringify({ LLM_PROVIDER: "ritual" });
  console.log(`\n  Plaintext      : ${secretsJson}`);

  // ECIES encrypt
  let encrypted;
  try {
    const pubKey = new PublicKey(pubKeyBuf);
    encrypted = encrypt(pubKey.toHex(), Buffer.from(secretsJson, "utf8"));
  } catch (err) {
    console.error("  ECIES encrypt failed:", err.message);
    process.exit(1);
  }

  const encryptedHex = "0x" + encrypted.toString("hex");
  const encryptedRaw = encrypted.toString("hex"); // no 0x prefix — for Solidity hex"..."

  console.log(`  Encrypted len  : ${encrypted.length} bytes`);
  console.log(`  Encrypted hex  : ${encryptedHex.slice(0, 30)}...`);

  // Save to JSON file
  const output = {
    teeAddress,
    capability: 0,
    plaintextJson: secretsJson,
    nonceLength: ECIES_CONFIG.symmetricNonceLength,
    encryptedHex,        // 0x-prefixed (for JS/TS use)
    encryptedRaw,        // no prefix (for Solidity hex"...")
    encryptedLength: encrypted.length,
    timestamp: new Date().toISOString(),
  };

  const outPath = path.join(__dirname, "../.encrypted-secrets.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log("\n" + "=".repeat(60));
  console.log("  Saved: .encrypted-secrets.json");
  console.log();
  console.log("  Copy this into contracts/PortfolioAgent.sol:");
  console.log();
  console.log(`  bytes public constant ENCRYPTED_SECRETS = hex"${encryptedRaw}";`);
  console.log();
  console.log("  Then update _callSovereignAgent to use ENCRYPTED_SECRETS");
  console.log("  instead of _encryptedSecrets[portfolioOwner].");
  console.log("=".repeat(60));
}

main().catch(e => { console.error(e); process.exit(1); });
