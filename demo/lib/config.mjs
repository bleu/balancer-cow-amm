import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
export function loadConfig(env = process.env) {
  const file = path.resolve(
    env.DEMO_CONFIG ?? new URL("../config.json", import.meta.url).pathname
  );
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  config.rpcUrl = env.BASE_RPC_URL ?? config.rpcUrl;
  if (
    config.chainId !== 8453 &&
    !(config.localDev && [31337, 31338].includes(config.chainId))
  )
    throw Error("Only Base or explicit local fixtures supported");
  for (const field of ["factory", "curatorAddress"])
    if (config[field] && !ethers.utils.isAddress(config[field]))
      throw Error(`Invalid ${field}`);
  for (const list of ["pools", "curatedPools"])
    if (
      !Array.isArray(config[list]) ||
      config[list].some((x) => !ethers.utils.isAddress(x.address))
    )
      throw Error(`Invalid ${list}`);
  if (
    !config.localDev &&
    config.pools.some(
      (p) =>
        !config.curatedPools.some(
          (c) => c.address.toLowerCase() === p.address.toLowerCase()
        )
    )
  )
    throw Error(
      "Public pools must also be explicitly registered in the curator watchlist"
    );
  for (const k of [
    "intervalSeconds",
    "priceMaxAgeSeconds",
    "maxSizingAttempts",
    "confirmations",
  ])
    if (!Number.isInteger(config[k]) || config[k] <= 0)
      throw Error(`Invalid ${k}`);
  if (
    config.orderSeconds !== 180 ||
    config.intervalSeconds < 3600 ||
    config.maxSizingAttempts > 16
  )
    throw Error("Use hourly cycles, 180-second orders and bounded sizing");
  for (const k of ["curatorFeeBps", "limitBufferBps", "slippageBps"])
    if (!Number.isInteger(config[k])) throw Error(`Invalid ${k}`);
  if (
    !/^\d+(\.\d{1,8})?$/.test(config.minDriftUsd) ||
    Number(config.minDriftUsd) < 0.1
  )
    throw Error("Minimum drift must be at least $0.10");
  if (
    config.curatorFeeBps < 0 ||
    config.curatorFeeBps >= 10000 ||
    config.limitBufferBps < 0 ||
    config.limitBufferBps > 1000 ||
    config.slippageBps < 0 ||
    config.slippageBps > 1000
  )
    throw Error("Invalid fee/buffer");
  config.live = env.CURATOR_LIVE === "true";
  config.key = env.CURATOR_PRIVATE_KEY || null;
  if (config.key) {
    let address;
    try {
      address = new ethers.Wallet(config.key).address;
    } catch {
      throw Error("Invalid server curator key");
    }
    if (
      config.curatorAddress &&
      address.toLowerCase() !== config.curatorAddress.toLowerCase()
    )
      throw Error("Configured curator does not match signing key");
    config.curatorAddress = address;
  }
  if (config.live && (!config.key || !config.factory))
    throw Error("Live posting requires a curator key and configured factory");
  // Never return config.key or credential-bearing RPC URLs to the browser.
  return config;
}
export function publicConfig(c) {
  return Object.fromEntries(
    [
      "chainId",
      "name",
      "explorerUrl",
      "factory",
      "pools",
      "curatorAddress",
      "slippageBps",
      "curatorFeeBps",
      "priceMaxAgeSeconds",
      "localAssets",
      "localDev",
    ].map((k) => [k, c[k] ?? null])
  );
}
