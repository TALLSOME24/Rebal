// ABI for PortfolioAgent v10 — Sovereign Agent (0x080C) single-tick architecture.
export const portfolioAgentABI = [
  // ─── Portfolio management ──────────────────────────────────────────────────
  {
    name: "registerPortfolio",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "risk",    type: "uint8"  },
      { name: "ethBps_",  type: "uint16" },
      { name: "wbtcBps_", type: "uint16" },
      { name: "usdcBps_", type: "uint16" },
    ],
    outputs: [],
  },
  {
    name: "portfolios",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "registered",  type: "bool"    },
      { name: "riskMode",    type: "uint8"   },
      { name: "ethBps",      type: "uint16"  },
      { name: "wbtcBps",     type: "uint16"  },
      { name: "usdcBps",     type: "uint16"  },
      { name: "executor",    type: "address" },
      { name: "scheduleId",  type: "uint256" },
    ],
  },
  // ─── Automation ───────────────────────────────────────────────────────────
  {
    name: "startAutomation",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "frequencyBlocks", type: "uint32"  },
      { name: "numCalls",        type: "uint32"  },
      { name: "gasLimit",        type: "uint32"  },
      { name: "maxFeePerGas",    type: "uint256" },
      { name: "schedulerTtl",    type: "uint32"  },
    ],
    outputs: [],
  },
  {
    name: "cancelAutomation",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  // ─── Async state ──────────────────────────────────────────────────────────
  {
    name: "pendingJobId",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "jobOwner",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
  {
    name: "lastCycleId",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  // ─── Callbacks ────────────────────────────────────────────────────────────
  {
    name: "onScheduledTick",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "executionIndex",  type: "uint256" },
      { name: "portfolioOwner", type: "address"  },
    ],
    outputs: [],
  },
  {
    name: "onSovereignAgentResult",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId",  type: "bytes32" },
      { name: "result", type: "bytes"   },
    ],
    outputs: [],
  },
  // ─── Token custody ────────────────────────────────────────────────────────
  {
    name: "depositToken",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token",  type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "withdrawToken",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token",  type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "withdrawAll",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }],
    outputs: [],
  },
  // ─── RitualWallet ─────────────────────────────────────────────────────────
  {
    name: "depositFeesForCaller",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "lockDurationBlocks", type: "uint256" }],
    outputs: [],
  },
  {
    name: "withdrawFees",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "withdrawRitualFees",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "withdrawAllRitualFees",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "ritualBalance",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "contractRitualBalance",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  // ─── DEX ──────────────────────────────────────────────────────────────────
  {
    name: "dexRouter",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    name: "setDexRouter",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_router", type: "address" }],
    outputs: [],
  },
  // ─── Immutables ───────────────────────────────────────────────────────────
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  // ─── Events ───────────────────────────────────────────────────────────────
  {
    type: "event",
    name: "PortfolioRegistered",
    inputs: [
      { name: "owner",   type: "address", indexed: true  },
      { name: "risk",    type: "uint8",   indexed: false },
      { name: "ethBps",  type: "uint16",  indexed: false },
      { name: "wbtcBps", type: "uint16",  indexed: false },
      { name: "usdcBps", type: "uint16",  indexed: false },
    ],
  },
  {
    type: "event",
    name: "FeesDepositFor",
    inputs: [
      { name: "user",      type: "address", indexed: true  },
      { name: "amountWei", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AutomationScheduled",
    inputs: [
      { name: "owner",    type: "address", indexed: true  },
      { name: "callId",   type: "uint256", indexed: true  },
      { name: "frequency", type: "uint32", indexed: false },
      { name: "numCalls", type: "uint32",  indexed: false },
    ],
  },
  {
    type: "event",
    name: "AutomationCancelled",
    inputs: [
      { name: "owner",  type: "address", indexed: true },
      { name: "callId", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "AutomationTriggered",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "jobId", type: "bytes32", indexed: true },
    ],
  },
  {
    type: "event",
    name: "SovereignAgentResult",
    inputs: [
      { name: "owner",        type: "address", indexed: true  },
      { name: "jobId",        type: "bytes32", indexed: true  },
      { name: "cycleId",      type: "uint256", indexed: false },
      { name: "hasError",     type: "bool",    indexed: false },
      { name: "textResponse", type: "string",  indexed: false },
      { name: "errorMessage", type: "string",  indexed: false },
    ],
  },
  {
    type: "event",
    name: "TickFailed",
    inputs: [
      { name: "owner",   type: "address", indexed: true  },
      { name: "tickIdx", type: "uint256", indexed: true  },
      { name: "phase",   type: "string",  indexed: false },
      { name: "reason",  type: "string",  indexed: false },
    ],
  },
  {
    type: "event",
    name: "SwapExecuted",
    inputs: [
      { name: "portfolioOwner", type: "address", indexed: true  },
      { name: "tokenIn",        type: "address", indexed: true  },
      { name: "tokenOut",       type: "address", indexed: true  },
      { name: "amountIn",       type: "uint256", indexed: false },
      { name: "amountOut",      type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TokenDeposited",
    inputs: [
      { name: "token",  type: "address", indexed: true  },
      { name: "from",   type: "address", indexed: true  },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TokenWithdrawn",
    inputs: [
      { name: "token",  type: "address", indexed: true },
      { name: "to",     type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;
