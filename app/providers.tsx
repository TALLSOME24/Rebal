"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { ritualChain } from "@/lib/chain";

const queryClient = new QueryClient();

const transportUrl =
  typeof window !== "undefined" && process.env.NEXT_PUBLIC_USE_RPC_PROXY === "true"
    ? "/api/rpc"
    : (process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.ritualfoundation.org");

const config = createConfig({
  chains: [ritualChain],
  connectors: [injected()],
  transports: {
    [ritualChain.id]: http(transportUrl),
  },
  ssr: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
