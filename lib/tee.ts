import { createPublicClient, http } from "viem";
import type { Address } from "viem";
import { ritualChain } from "./chain";
import { HTTP_CALL_CAPABILITY, LLM_CAPABILITY, TEE_SERVICE_REGISTRY } from "./constants";

const registryAbi = [
  {
    inputs: [
      { name: "capability", type: "uint8" },
      { name: "checkValidity", type: "bool" },
    ],
    name: "getServicesByCapability",
    outputs: [
      {
        type: "tuple[]",
        components: [
          {
            name: "node",
            type: "tuple",
            components: [
              { name: "paymentAddress", type: "address" },
              { name: "teeAddress", type: "address" },
              { name: "teeType", type: "uint8" },
              { name: "publicKey", type: "bytes" },
              { name: "endpoint", type: "string" },
              { name: "certPubKeyHash", type: "bytes32" },
              { name: "capability", type: "uint8" },
            ],
          },
          { name: "isValid", type: "bool" },
          { name: "workloadId", type: "bytes32" },
        ],
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

const publicClient = createPublicClient({
  chain: ritualChain,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.ritualfoundation.org"),
});

export async function fetchHttpExecutor(): Promise<Address> {
  const services = await publicClient.readContract({
    address: TEE_SERVICE_REGISTRY,
    abi: registryAbi,
    functionName: "getServicesByCapability",
    args: [HTTP_CALL_CAPABILITY, true],
  });
  if (!services.length) throw new Error("No HTTP_CALL executors in registry");
  return services[0].node.teeAddress as Address;
}

// LLM executor uses capability 1 — different from HTTP capability 0
export async function fetchLlmExecutor(): Promise<Address> {
  const services = await publicClient.readContract({
    address: TEE_SERVICE_REGISTRY,
    abi: registryAbi,
    functionName: "getServicesByCapability",
    args: [LLM_CAPABILITY, true],
  });
  if (!services.length) throw new Error("No LLM executors in registry");
  return services[0].node.teeAddress as Address;
}

// Fetches the LLM executor — use this for registerPortfolio
// so the contract uses the correct executor for LLM ticks
export async function fetchExecutorForPortfolio(): Promise<Address> {
  return fetchLlmExecutor();
}