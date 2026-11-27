import type { Asset } from "../web/lib/types";
export const ONDO_ASSETS: Asset[];
export const SETTLEMENT: `0x${string}`;
export const TRAMPOLINE: `0x${string}`;
export function networkProfile(chainId: number): {
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  cowApi: string;
  coingeckoPlatform: string;
  assets: Asset[];
  nativeCurrency: { name: string; symbol: string; decimals: 18 };
};
