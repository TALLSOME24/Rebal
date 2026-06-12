export const portfolioAgentFactoryABI = [
  {
    name: "deployAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "getAgent",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "hasAgent",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "agentOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "AgentDeployed",
    type: "event",
    inputs: [
      { name: "user",  type: "address", indexed: true },
      { name: "agent", type: "address", indexed: true },
    ],
  },
] as const;
