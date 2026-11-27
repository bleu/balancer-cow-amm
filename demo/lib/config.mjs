import { ethers } from "ethers";
import { networkProfile } from "./networks.mjs";
export function loadConfig(env = process.env) {
  if (env.DEMO_CONFIG)
    throw Error(
      "DEMO_CONFIG is no longer supported; use the variables in .env.example"
    );
  const number = (name, fallback) => {
    const raw = env[name] ?? String(fallback);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
      throw Error(`Invalid ${name}`);
    return Number(raw);
  };
  const bool = (name) => {
    const raw = env[name] ?? "false";
    if (!["true", "false"].includes(raw))
      throw Error(`Invalid ${name}; use true or false`);
    return raw === "true";
  };
  const json = (name, fallback) => {
    if (env[name] === undefined || env[name] === "") return fallback;
    try {
      return JSON.parse(env[name]);
    } catch {
      throw Error(`Invalid JSON in ${name}`);
    }
  };
  const chainId = number("DEMO_CHAIN_ID", 56);
  const profile = networkProfile(chainId);
  if (env.BASE_RPC_URL && !env.RPC_URL && chainId === 56)
    throw Error("BASE_RPC_URL is only for Base; set RPC_URL for BNB");
  const config = {
    chainId,
    name: env.DEMO_NETWORK_NAME ?? profile.name,
    rpcUrl: env.RPC_URL || env.BASE_RPC_URL || profile.rpcUrl,
    publicRpcUrl: profile.rpcUrl,
    nativeCurrency: profile.nativeCurrency,
    coingeckoPlatform: profile.coingeckoPlatform,
    assets: profile.assets,
    explorerUrl: env.DEMO_EXPLORER_URL ?? profile.explorerUrl,
    factory: env.DEMO_FACTORY_ADDRESS?.trim() || null,
    curatorAddress: env.CURATOR_ADDRESS?.trim() || null,
    pools: json("DEMO_POOLS", []),
    curatedPools: json("CURATOR_POOLS", []),
    cowApi: (env.COW_API_URL ?? profile.cowApi).replace(/\/$/, ""),
    intervalSeconds: number("CURATOR_INTERVAL_SECONDS", 3600),
    orderSeconds: number("CURATOR_ORDER_SECONDS", 180),
    priceMaxAgeSeconds: number("COINGECKO_MAX_AGE_SECONDS", 1800),
    slippageBps: number("DEMO_SLIPPAGE_BPS", 50),
    curatorFeeBps: number("CURATOR_FEE_BPS", 100),
    minDriftUsd: env.CURATOR_MIN_DRIFT_USD ?? "0.10",
    limitBufferBps: number("CURATOR_LIMIT_BUFFER_BPS", 10),
    maxSizingAttempts: number("CURATOR_MAX_SIZING_ATTEMPTS", 8),
    confirmations: number("DEMO_CONFIRMATIONS", 2),
    localDev: bool("DEMO_LOCAL_DEV"),
    localAssets: json("DEMO_LOCAL_ASSETS", null),
    fixturePrices: json("DEMO_FIXTURE_PRICES", null),
    host: env.DEMO_HOST ?? "127.0.0.1",
    port: number("DEMO_PORT", 3000),
    live: bool("CURATOR_LIVE"),
    key: env.CURATOR_PRIVATE_KEY || null,
    coingeckoApiKey: env.COINGECKO_API_KEY || null,
  };
  for (const field of ["rpcUrl", "cowApi", "explorerUrl"]) {
    if (field === "explorerUrl" && config[field] === "") continue;
    try {
      if (!["http:", "https:"].includes(new URL(config[field]).protocol))
        throw Error();
    } catch {
      throw Error(`Invalid ${field} URL`);
    }
  }
  if (!config.cowApi.endsWith("/v1"))
    throw Error("COW_API_URL must end in /v1");
  if (
    new URL(config.cowApi).hostname === "api.cow.fi" &&
    config.cowApi !== profile.cowApi
  )
    throw Error("CoW API network does not match DEMO_CHAIN_ID");
  if (!config.host || config.port < 1 || config.port > 65535)
    throw Error("Invalid DEMO_HOST or DEMO_PORT");
  if (config.localDev) {
    if (![31337, 31338].includes(config.chainId) || config.live)
      throw Error(
        "Local fixtures require a local chain and live posting disabled"
      );
    if (
      !Array.isArray(config.localAssets) ||
      config.localAssets.length !== 7 ||
      config.localAssets.some(
        (a) =>
          !a ||
          !ethers.utils.isAddress(a.address) ||
          !Number.isInteger(a.decimals) ||
          a.decimals < 0 ||
          a.decimals > 18
      )
    )
      throw Error("Invalid DEMO_LOCAL_ASSETS");
    if (
      config.fixturePrices &&
      config.localAssets.some(
        (a) =>
          !Number.isFinite(config.fixturePrices[a.address.toLowerCase()]) ||
          config.fixturePrices[a.address.toLowerCase()] <= 0
      )
    )
      throw Error("Invalid DEMO_FIXTURE_PRICES");
  } else if (config.localAssets || config.fixturePrices)
    throw Error("Fixture assets/prices require DEMO_LOCAL_DEV=true");
  if (
    ![56, 8453].includes(config.chainId) &&
    !(config.localDev && [31337, 31338].includes(config.chainId))
  )
    throw Error("Only BNB, Base or explicit local fixtures supported");
  for (const field of ["factory", "curatorAddress"])
    if (config[field] && !ethers.utils.isAddress(config[field]))
      throw Error(`Invalid ${field}`);
  for (const list of ["pools", "curatedPools"])
    if (
      !Array.isArray(config[list]) ||
      config[list].some((x) => !x || !ethers.utils.isAddress(x.address))
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
  if (config.localDev) config.assets = config.localAssets;
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
      "assets",
      "publicRpcUrl",
      "nativeCurrency",
      "confirmations",
      "localDev",
    ].map((k) => [k, c[k] ?? null])
  );
}
