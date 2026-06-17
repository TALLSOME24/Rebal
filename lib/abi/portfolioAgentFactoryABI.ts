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
    name: "overrideAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user",  type: "address" },
      { name: "agent", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "setDexRouter",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_router", type: "address" }],
    outputs: [],
  },
  {
    name: "dexRouter",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    name: "factoryOwner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
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
