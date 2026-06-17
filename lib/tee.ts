import type { Address } from "viem";

// Hardcoded cap-0 sovereign executor for Ritual testnet.
// Source: TEEServiceRegistry.getServicesByCapability(0, true)[0].node.teeAddress
export const SOVEREIGN_EXECUTOR_ADDRESS: Address =
  "0x9dc11412391Dc3EDF59811FC9Ee7bEbFD41c8b4C";

export async function fetchSovereignExecutor(): Promise<Address> {
  return SOVEREIGN_EXECUTOR_ADDRESS;
}
