import type { Address, Hex } from "viem";
export interface Asset {
  symbol: string;
  name: string;
  address: Address;
  weight: number;
  denorm: number;
  decimals: number;
  color: string;
}
export interface PoolEntry {
  address: Address;
  name?: string;
  chainId?: number;
  public?: boolean;
}
export interface SavedPool {
  chainId: number;
  address?: Address;
  name: string;
  requestId?: Hex;
  creator?: Address;
  factory?: Address;
  symbol?: string;
  curator?: Address;
  feeBps?: number;
  seedAmounts?: string[];
  publicSwapFee?: string;
  solverOrdersEnabled?: boolean;
}
export interface Draft extends SavedPool {
  requestId: Hex;
  creator: Address;
  factory: Address;
  symbol: string;
  curator: Address;
  seedAmounts: string[];
}
export interface DemoConfig {
  chainId: number;
  name: string;
  explorerUrl: string;
  factory: Address | null;
  pools: PoolEntry[];
  curatorAddress: Address | null;
  slippageBps: number;
  curatorFeeBps: number;
  priceMaxAgeSeconds: number;
  localDev: boolean;
  assets: Asset[];
}
export interface PoolToken {
  address: Address;
  balance: string;
  denorm: string;
  decimals: number;
  symbol: string;
  name: string;
  walletBalance?: string;
  allowance?: string;
  curatorClaimable: string;
}
export interface PoolSnapshot {
  address: Address;
  name: string;
  symbol: string;
  finalized: boolean;
  tokens: PoolToken[];
  supply: string;
  curator: Address;
  creator: Address;
  controller: Address;
  duration: number;
  feeBps: number;
  swapFee: string;
  solverOrdersEnabled: boolean | null;
  maxFee: string;
  epoch: string;
  escrow: Address;
  block: number;
  blockHash: Hex;
  timestamp: number;
  walletShares: string;
}
export interface PriceSnapshot {
  values: Record<string, { usd: string; updatedAt: number }>;
  fetchedAt: number;
  source: string;
}
export interface WorkerState {
  state: string;
  reason: string | null;
  pool?: Address;
}
export interface WorkerStatus extends WorkerState {
  live: boolean;
  paused: boolean;
  registeredPools: Address[];
  lastCheck: number | null;
  nextCheck: number | null;
  currentOrder: Hex | null;
  pools: Record<string, WorkerState>;
}
export interface CowOrder {
  uid: Hex;
  kind: string;
  status: string;
  creationDate?: string;
}
export type Progress = (text: string) => void;
