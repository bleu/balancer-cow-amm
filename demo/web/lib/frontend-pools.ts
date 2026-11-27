import type { DemoConfig, PoolEntry } from "./types";

// UI listings only. These do not extend the server's price watchlist or enroll
// a pool in the curator; those remain controlled by the server environment.
const frontendPools: PoolEntry[] = [
  {
    chainId: 56,
    address: "0x44363bddb3fafd262a416567B7827e46D266F86D",
    name: "WBNB-USDC",
  },
];

export function withFrontendPools(config: DemoConfig): DemoConfig {
  const pools = new Map(
    [
      ...frontendPools.filter((pool) => pool.chainId === config.chainId),
      ...config.pools,
    ].map((pool) => [pool.address.toLowerCase(), pool])
  );
  return { ...config, pools: [...pools.values()] };
}
