import type { DemoConfig } from "./types";

import { frontendPoolsFor } from "../../lib/frontend-pools.mjs";

export function withFrontendPools(config: DemoConfig): DemoConfig {
  const pools = new Map(
    [...frontendPoolsFor(config.chainId), ...config.pools].map((pool) => [
      pool.address.toLowerCase(),
      pool,
    ])
  );
  return { ...config, pools: [...pools.values()] };
}
