export const ASSETS = [
  [
    "NVDAc",
    "NVIDIA",
    "0xb20000000000000000000078ee7ce2fE4908108C",
    20,
    8,
    "#b8f36a",
  ],
  [
    "MSFTc",
    "Microsoft",
    "0xB200000000000000000000Ab99cFa739E253872B",
    15,
    6,
    "#9ccaf1",
  ],
  [
    "AAPLc",
    "Apple",
    "0xb200000000000000000000C2e324d24d7eEcd1fb",
    15,
    6,
    "#d4d9e3",
  ],
  [
    "AMZNc",
    "Amazon",
    "0xb200000000000000000000d9192b6B456483C2E8",
    15,
    6,
    "#efb96f",
  ],
  [
    "GOOGLc",
    "Alphabet",
    "0xb2000000000000000000002D0BA3164cc74f58B7",
    15,
    6,
    "#92d6bc",
  ],
  [
    "METAc",
    "Meta",
    "0xb2000000000000000000008bC8786B856E61707C",
    10,
    4,
    "#b8abed",
  ],
  [
    "TSLAc",
    "Tesla",
    "0xb2000000000000000000001e800a7f5189430cD0",
    10,
    4,
    "#ee9e9e",
  ],
].map(([symbol, name, address, weight, denorm, color]) => ({
  symbol,
  name,
  address,
  weight,
  denorm,
  decimals: 8,
  color,
}));
export const BONE = 10n ** 18n;
export const USD = 10n ** 8n;
export const ZERO = "0x0000000000000000000000000000000000000000";
export const FACTORY_ABI = [
  "function createPool(bytes32,string,string,address,uint32,uint16) returns(address)",
  "function createdPool(address,bytes32) view returns(address)",
  "function isBPool(address) view returns(bool)",
  "function SOLUTION_SETTLER() view returns(address)",
  "function HOOKS_TRAMPOLINE() view returns(address)",
];
export const POOL_ABI = [
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
  "function appDataHash(bytes32,uint256) view returns(bytes32)",
];
export const TOKEN_ABI = [
  "function name() view returns(string)",
  "function symbol() view returns(string)",
  "function decimals() view returns(uint8)",
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
];
export const ESCROW_ABI = [
  "function claimable(address,address) view returns(uint256)",
  "function withdraw(address,address)",
];
export const lower = (a) => a.toLowerCase();
export function units(value, decimals = 18) {
  const str = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(str))
    throw Error("Enter a positive decimal amount");
  const [whole, part = ""] = str.split(".");
  if (part.length > decimals)
    throw Error(`Use at most ${decimals} decimal places`);
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(part.padEnd(decimals, "0") || "0")
  );
}
export function decimal(raw, decimals = 18, places = 6) {
  const n = BigInt(raw);
  const sign = n < 0n ? "-" : "";
  const x = n < 0n ? -n : n;
  const d = 10n ** BigInt(decimals);
  return (
    sign +
    (x / d).toString() +
    (places
      ? "." +
        (x % d)
          .toString()
          .padStart(decimals, "0")
          .slice(0, places)
          .padEnd(places, "0")
      : "")
  );
}
export const bmul = (a, b) => (a * b + BONE / 2n) / BONE;
export const bdiv = (a, b) => (a * BONE + b / 2n) / b;
export function liquidityAmounts(reserves, shares, supply) {
  if (shares <= 0n || supply <= 0n)
    throw Error("Amount and LP supply must be positive");
  const ratio = bdiv(shares, supply);
  const amounts = reserves.map((r) => bmul(r, ratio));
  if (amounts.some((x) => x === 0n))
    throw Error("Amount rounds to zero for a constituent");
  return amounts;
}
export function portfolio(tokens, prices) {
  const values = tokens.map(
    (t) =>
      (BigInt(t.balance) * BigInt(prices[lower(t.address)].usd)) /
      10n ** BigInt(t.decimals)
  );
  const total = values.reduce((a, b) => a + b, 0n);
  if (total <= 0n) throw Error("Pool has no priced reserves");
  const totalWeight = tokens.reduce((a, t) => a + BigInt(t.denorm), 0n);
  return {
    total,
    assets: tokens.map((t, i) => ({
      ...t,
      value: values[i],
      target: (total * BigInt(t.denorm)) / totalWeight,
      gap: values[i] - (total * BigInt(t.denorm)) / totalWeight,
    })),
  };
}
const abs = (n) => (n < 0n ? -n : n);
export function nextPair(view, processed = new Set(), floor = USD / 10n) {
  const ranked = view.assets
    .filter((t) => !processed.has(lower(t.address)) && abs(t.gap) > floor)
    .sort((a, b) =>
      abs(a.gap) === abs(b.gap)
        ? lower(a.address).localeCompare(lower(b.address))
        : abs(a.gap) > abs(b.gap)
        ? -1
        : 1
    );
  for (const priority of ranked) {
    const counterparts = view.assets
      .filter((t) => t.gap * priority.gap < 0n)
      .sort((a, b) => (abs(a.gap) > abs(b.gap) ? -1 : 1));
    if (counterparts.length) {
      const other = counterparts[0];
      return {
        priority,
        sell: priority.gap > 0n ? priority : other,
        buy: priority.gap < 0n ? priority : other,
        correction:
          abs(priority.gap) < abs(other.gap)
            ? abs(priority.gap)
            : abs(other.gap),
      };
    }
  }
  return null;
}
export function mergeCatalog(whitelisted, local, chainId) {
  const entries = new Map();
  for (const entry of [
    ...local.filter((x) => x.chainId === chainId),
    ...whitelisted.map((x) => ({ ...x, chainId, public: true })),
  ]) {
    if (
      typeof entry.address === "string" &&
      /^0x[0-9a-fA-F]{40}$/.test(entry.address)
    )
      entries.set(lower(entry.address), entry);
  }
  return [...entries.values()];
}
