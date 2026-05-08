export const schedulerAbi = [
  {
    name: "approveScheduler",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "consumerContract", type: "address" }],
    outputs: [],
  },
] as const;
