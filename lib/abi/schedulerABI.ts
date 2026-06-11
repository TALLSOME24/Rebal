// Scheduler contract at 0x56e776BAE2DD60664b69Bd5F865F1180fFB7D58B
export const schedulerABI = [
  {
    name: "approveScheduler",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "consumerContract", type: "address" }],
    outputs: [],
  },
  {
    name: "schedule",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "data", type: "bytes" },
      { name: "gasLimit", type: "uint32" },
      { name: "startBlock", type: "uint32" },
      { name: "numCalls", type: "uint32" },
      { name: "frequency", type: "uint32" },
      { name: "ttl", type: "uint32" },
      { name: "maxFeePerGas", type: "uint256" },
      { name: "maxPriorityFeePerGas", type: "uint256" },
      { name: "value", type: "uint256" },
      { name: "payer", type: "address" },
    ],
    outputs: [{ name: "callId", type: "uint256" }],
  },
  {
    name: "cancel",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "callId", type: "uint256" }],
    outputs: [],
  },
] as const;
