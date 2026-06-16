// IRitualWallet — verified against PortfolioAgent.sol interface
export const ritualWalletABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "lockDuration", type: "uint256" }],
    outputs: [],
  },
  {
    name: "depositFor",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "user", type: "address" },
      { name: "lockDuration", type: "uint256" },
    ],
    outputs: [],
  },
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
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;
