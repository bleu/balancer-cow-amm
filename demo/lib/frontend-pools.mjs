// Public UI listings. Shared with read-only pricing discovery, never curator enrollment.
export const FRONTEND_POOLS = [
  {
    chainId: 56,
    address: "0x44363bddb3fafd262a416567B7827e46D266F86D",
    name: "WBNB-USDC",
  },
];
export function frontendPoolsFor(chainId) {
  return FRONTEND_POOLS.filter((pool) => pool.chainId === chainId);
}
