require("dotenv").config();
const { ethers } = require("hardhat");

async function main() {
  const MOCK_PRICE_FEED = "0x7e2c33923f895215A07a706E1D4E99fE64386985";
  
  const abi = [
    "function fetchPrices(address executor, uint256 ttl) external returns (uint16, bytes memory)",
    "function latestBody() external view returns (bytes memory)",
    "function latestStatus() external view returns (uint16)"
  ];

  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);

  const feed = new ethers.Contract(MOCK_PRICE_FEED, abi, signer);

  // Use signer as executor, TTL of 300 seconds
  console.log("Calling fetchPrices()...");
  const tx = await feed.fetchPrices(signer.address, 300);
  await tx.wait();
  console.log("Done! tx:", tx.hash);

  const body = await feed.latestBody();
  const status = await feed.latestStatus();
  console.log("Status:", status);
  console.log("Prices:", Buffer.from(body.slice(2), "hex").toString());
}

main().catch(console.error);