"use client";
import { useMemo, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { createConfig, WagmiProvider, injected } from "wagmi";
import { custom, defineChain } from "viem";
import { api } from "../lib/api";
import type { DemoConfig } from "../lib/types";
import { Demo } from "./demo";
function ConfiguredApp() {
  const query = useQuery({
    queryKey: ["config"],
    queryFn: () => api<DemoConfig>("/api/config"),
    staleTime: Infinity,
  });
  return query.data ? (
    <WalletProvider config={query.data} />
  ) : (
    <main className="mx-auto max-w-6xl p-10">
      <h1 className="text-3xl font-semibold">Folio / MAG7</h1>
      <p role="status" className="mt-5">
        {query.error?.message ?? "Loading pool configuration…"}
      </p>
    </main>
  );
}
function WalletProvider({ config }: { config: DemoConfig }) {
  const wagmi = useMemo(() => {
    const chain = defineChain({
      id: config.chainId,
      name: config.name,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: {
        default: {
          http: [
            config.localDev
              ? "http://127.0.0.1:8546"
              : "https://mainnet.base.org",
          ],
        },
      },
      ...(config.explorerUrl
        ? {
            blockExplorers: {
              default: { name: "Explorer", url: config.explorerUrl },
            },
          }
        : {}),
    });
    const transport = custom(
      {
        request: async ({ method, params }) =>
          (
            await api<{ result: unknown }>(
              "/api/rpc?method=" +
                encodeURIComponent(method) +
                "&params=" +
                encodeURIComponent(JSON.stringify(params ?? []))
            )
          ).result,
      },
      { retryCount: 0 }
    );
    return createConfig({
      chains: [chain],
      connectors: [injected()],
      transports: { [chain.id]: transport },
      ssr: true,
    });
  }, [config]);
  return (
    <WagmiProvider config={wagmi} reconnectOnMount={false}>
      <Demo config={config} />
    </WagmiProvider>
  );
}
export function Providers() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
      })
  );
  return (
    <QueryClientProvider client={client}>
      <ConfiguredApp />
    </QueryClientProvider>
  );
}
