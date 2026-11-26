import type { Asset, PoolEntry, SavedPool } from "../web/lib/types";
export const ASSETS: Asset[];
export const BONE: bigint;
export const USD: bigint;
export const ZERO: "0x0000000000000000000000000000000000000000";
export const FACTORY_ABI: readonly [
  "function createPool(bytes32,string,string,address,uint32,uint16) returns(address)",
  "function createdPool(address,bytes32) view returns(address)",
  "function isBPool(address) view returns(bool)",
  "function SOLUTION_SETTLER() view returns(address)",
  "function HOOKS_TRAMPOLINE() view returns(address)"
];
export const POOL_ABI: readonly [
  "function name() view returns(string)",
  "function symbol() view returns(string)",
  "function FACTORY() view returns(address)",
  "function isFinalized() view returns(bool)",
  "function getFinalTokens() view returns(address[])",
  "function getCurrentTokens() view returns(address[])",
  "function isBound(address) view returns(bool)",
  "function getBalance(address) view returns(uint256)",
  "function getDenormalizedWeight(address) view returns(uint256)",
  "function getTotalDenormalizedWeight() view returns(uint256)",
  "function getSwapFee() view returns(uint256)",
  "function MAX_FEE() view returns(uint256)",
  "function getController() view returns(address)",
  "function creator() view returns(address)",
  "function curator() view returns(address)",
  "function minEpoch() view returns(uint256)",
  "function orderDuration() view returns(uint32)",
  "function curatorFeeBps() view returns(uint16)",
  "function feeEscrow() view returns(address)",
  "function hooksTrampoline() view returns(address)",
  "function totalSupply() view returns(uint256)",
  "function balanceOf(address) view returns(uint256)",
  "function bind(address,uint256,uint256)",
  "function unbind(address)",
  "function setSwapFee(uint256)",
  "function finalize()",
  "function joinPool(uint256,uint256[])",
  "function exitPool(uint256,uint256[])",
  "function setCurator(address)",
  "function revoke(uint256)",
  "function calcInGivenOut(uint256,uint256,uint256,uint256,uint256,uint256) pure returns(uint256)",
  "function calcOutGivenIn(uint256,uint256,uint256,uint256,uint256,uint256) pure returns(uint256)",
  "function SOLUTION_SETTLER_DOMAIN_SEPARATOR() view returns(bytes32)",
  "function verify((address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,bytes32 kind,bool partiallyFillable,bytes32 sellTokenBalance,bytes32 buyTokenBalance)) view",
  "function appDataHash(bytes32,uint256) view returns(bytes32)"
];
export const TOKEN_ABI: readonly [
  "function name() view returns(string)",
  "function symbol() view returns(string)",
  "function decimals() view returns(uint8)",
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)"
];
export const ESCROW_ABI: readonly [
  "function claimable(address,address) view returns(uint256)",
  "function withdraw(address,address)"
];
export function lower(a: string): string;
export function units(value: string | number, decimals?: number): bigint;
export function decimal(
  raw: string | bigint,
  decimals?: number,
  places?: number
): string;
export function liquidityAmounts(
  reserves: bigint[],
  shares: bigint,
  supply: bigint
): bigint[];
export function portfolio<
  T extends {
    address: string;
    balance: string;
    denorm: string;
    decimals: number;
  }
>(
  tokens: T[],
  prices: Record<string, { usd: string; updatedAt: number }>
): {
  total: bigint;
  assets: (T & { value: bigint; target: bigint; gap: bigint })[];
};
export function mergeCatalog(
  whitelisted: PoolEntry[],
  local: SavedPool[],
  chainId: number
): PoolEntry[];
