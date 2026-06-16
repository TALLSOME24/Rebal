export const uniswapV2PairABI = [
  {
    name: "getReserves",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserve0",          type: "uint112" },
      { name: "reserve1",          type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
  {
    name: "token0",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    name: "token1",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount",  type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to",     type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "event",
    name: "Swap",
    inputs: [
      { name: "sender",     type: "address",  indexed: true  },
      { name: "amount0In",  type: "uint256",  indexed: false },
      { name: "amount1In",  type: "uint256",  indexed: false },
      { name: "amount0Out", type: "uint256",  indexed: false },
      { name: "amount1Out", type: "uint256",  indexed: false },
      { name: "to",         type: "address",  indexed: true  },
    ],
  },
  {
    type: "event",
    name: "Mint",
    inputs: [
      { name: "sender",  type: "address", indexed: true  },
      { name: "amount0", type: "uint256", indexed: false },
      { name: "amount1", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Burn",
    inputs: [
      { name: "sender",  type: "address", indexed: true  },
      { name: "amount0", type: "uint256", indexed: false },
      { name: "amount1", type: "uint256", indexed: false },
      { name: "to",      type: "address", indexed: true  },
    ],
  },
  {
    type: "event",
    name: "Sync",
    inputs: [
      { name: "reserve0", type: "uint112", indexed: false },
      { name: "reserve1", type: "uint112", indexed: false },
    ],
  },
] as const;
