import { getAddress, isAddress, zeroAddress } from "viem";
import { BONE, lower, units } from "./shared.mjs";

// Percentages accept two decimal places. A total denormalized weight of 50
// gives every supported percentage (2% or more) an exact on-chain weight.
export function customPortfolio(rows) {
  if (rows.length < 2 || rows.length > 8)
    throw Error("Choose between 2 and 8 tokens");
  const weights = rows.map((r) => units(r.weight, 2));
  if (weights.some((w) => w < 200n || w > 9800n))
    throw Error(
      "Each weight must be between 2% and 98%, with at most two decimal places"
    );
  if (weights.reduce((n, w) => n + w, 0n) !== 10000n)
    throw Error("Weights must total 100%");
  const assets = rows.map((r, i) => ({
    ...r,
    address: getAddress(r.address.trim()),
    weight: Number(weights[i]) / 100,
    denorm: Number(weights[i]) / 200,
    color: "#8dc647",
  }));
  validateAssets(assets);
  return assets;
}

export function validateAssets(assets) {
  if (!Array.isArray(assets) || assets.length < 2 || assets.length > 8)
    throw Error("Choose between 2 and 8 tokens");
  const addresses = new Set();
  let total = 0n;
  for (const a of assets) {
    if (!isAddress(a.address) || lower(a.address) === zeroAddress)
      throw Error("Each token needs a nonzero contract address");
    if (addresses.has(lower(a.address))) throw Error("Duplicate token address");
    addresses.add(lower(a.address));
    if (!Number.isInteger(a.decimals) || a.decimals < 0 || a.decimals > 255)
      throw Error("Invalid token decimals");
    const weight = units(String(a.denorm), 18);
    if (weight < BONE || weight > 50n * BONE)
      throw Error("Token weight is outside the pool limits");
    total += weight;
  }
  if (total > 50n * BONE) throw Error("Total weight exceeds the pool limit");
  return assets;
}

export function setupAssets(draft, preset) {
  // Old MAG7 drafts deliberately retain the legacy configuration fallback.
  const assets = validateAssets(draft.assets ?? preset);
  if (
    !Array.isArray(draft.seedAmounts) ||
    draft.seedAmounts.length !== assets.length
  )
    throw Error("Seed amounts do not match the saved portfolio");
  if (draft.seedAmounts.some((n) => !/^\d+$/.test(n) || BigInt(n) < 1000000n))
    throw Error("Every seed must meet the pool minimum of 1,000,000 raw units");
  return assets;
}
