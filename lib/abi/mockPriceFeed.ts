export const mockPriceFeedAbi = [
  {
    name: "latestBody",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes" }],
  },
  {
    name: "latestStatus",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint16" }],
  },
] as const;
