"use client";

import { useQuery } from "@tanstack/react-query";

export type Prices = {
  ethPrice: number;
  btcPrice: number;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
};

async function fetchCoinGeckoPrices(): Promise<{ ethPrice: number; btcPrice: number }> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin&vs_currencies=usd"
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = (await res.json()) as {
    ethereum?: { usd?: number };
    bitcoin?: { usd?: number };
  };
  const eth = data.ethereum?.usd;
  const btc = data.bitcoin?.usd;
  if (!eth || !btc) throw new Error("Missing price data");
  return { ethPrice: eth, btcPrice: btc };
}

export function usePrices(): Prices {
  const { data, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ["coingecko-prices"],
    queryFn: fetchCoinGeckoPrices,
    refetchInterval: 60_000,
    staleTime: 55_000,
    retry: 2,
  });

  return {
    ethPrice: data?.ethPrice ?? 0,
    btcPrice: data?.btcPrice ?? 0,
    loading: isLoading,
    error: error ? (error instanceof Error ? error.message : "Price fetch failed") : null,
    lastUpdated: dataUpdatedAt ? new Date(dataUpdatedAt) : null,
  };
}
