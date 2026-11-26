import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnv } from "node:util";
import { readFileSync } from "node:fs";
import { ethers } from "ethers";
import { loadConfig, publicConfig } from "../lib/config.mjs";
import { localFixtureEnv, serializeEnv } from "../lib/local-env.mjs";
import { ASSETS } from "../public/shared.mjs";
const address = "0x0000000000000000000000000000000000000011";
test("Defaults and the example env start in read-only Base setup mode", () => {
  const defaults = loadConfig({});
  assert.equal(defaults.chainId, 8453);
  assert.equal(defaults.factory, null);
  assert.deepEqual(defaults.pools, []);
  assert.equal(defaults.live, false);
  assert.equal(defaults.orderSeconds, 180);
  assert.equal(defaults.intervalSeconds, 3600);
  assert.deepEqual(
    loadConfig(
      parseEnv(
        readFileSync(new URL("../../.env.example", import.meta.url), "utf8")
      )
    ),
    defaults
  );
});
test("All deployment and policy settings come from env, including JSON pool lists", () => {
  const c = loadConfig({
    DEMO_CHAIN_ID: "8453",
    DEMO_NETWORK_NAME: "My Base demo",
    BASE_RPC_URL: "https://rpc.example/private",
    DEMO_EXPLORER_URL: "https://explorer.example",
    DEMO_FACTORY_ADDRESS: address,
    CURATOR_ADDRESS: address,
    DEMO_POOLS: JSON.stringify([{ address, name: "MAG7" }]),
    CURATOR_POOLS: JSON.stringify([{ address }]),
    COW_API_URL: "https://cow.example/base/api/v1/",
    CURATOR_INTERVAL_SECONDS: "7200",
    CURATOR_ORDER_SECONDS: "180",
    COINGECKO_MAX_AGE_SECONDS: "900",
    DEMO_SLIPPAGE_BPS: "25",
    CURATOR_FEE_BPS: "50",
    CURATOR_MIN_DRIFT_USD: "0.25",
    CURATOR_LIMIT_BUFFER_BPS: "20",
    CURATOR_MAX_SIZING_ATTEMPTS: "4",
    DEMO_CONFIRMATIONS: "3",
    DEMO_HOST: "0.0.0.0",
    DEMO_PORT: "4000",
    COINGECKO_API_KEY: "secret-price-key",
  });
  assert.equal(c.name, "My Base demo");
  assert.equal(c.rpcUrl, "https://rpc.example/private");
  assert.equal(c.explorerUrl, "https://explorer.example");
  assert.equal(c.factory, address);
  assert.equal(c.curatorAddress, address);
  assert.equal(c.pools[0].name, "MAG7");
  assert.equal(c.curatedPools[0].address, address);
  assert.equal(c.cowApi, "https://cow.example/base/api/v1");
  assert.equal(c.intervalSeconds, 7200);
  assert.equal(c.orderSeconds, 180);
  assert.equal(c.priceMaxAgeSeconds, 900);
  assert.equal(c.slippageBps, 25);
  assert.equal(c.curatorFeeBps, 50);
  assert.equal(c.minDriftUsd, "0.25");
  assert.equal(c.limitBufferBps, 20);
  assert.equal(c.maxSizingAttempts, 4);
  assert.equal(c.confirmations, 3);
  assert.equal(c.host, "0.0.0.0");
  assert.equal(c.port, 4000);
  assert.equal(c.coingeckoApiKey, "secret-price-key");
  const published = JSON.stringify(publicConfig(c));
  assert.ok(!published.includes("secret-price-key"));
  assert.ok(!published.includes("rpc.example"));
  assert.ok(!published.includes("cow.example"));
});
test("Malformed env and unsafe policy settings fail before starting the service", () => {
  for (const env of [
    { DEMO_CONFIG: "old-config.json" },
    { DEMO_POOLS: "not-json" },
    { CURATOR_POOLS: "{}" },
    { DEMO_FACTORY_ADDRESS: "wrong" },
    { DEMO_PORT: "" },
    { DEMO_PORT: "65536" },
    { CURATOR_LIVE: "yes" },
    { DEMO_CHAIN_ID: "1" },
    { CURATOR_INTERVAL_SECONDS: "12oops" },
    { CURATOR_INTERVAL_SECONDS: "60" },
    { CURATOR_ORDER_SECONDS: "300" },
    { CURATOR_FEE_BPS: "1.5" },
    { CURATOR_MIN_DRIFT_USD: "0.01" },
    { BASE_RPC_URL: "file:///private" },
    { COW_API_URL: "https://cow.example/v2" },
    { DEMO_POOLS: JSON.stringify([{ address }]) },
  ])
    assert.throws(() => loadConfig(env));
});
test("The server signer is validated and secrets stay out of public config", () => {
  const key = "0x" + "01".repeat(32);
  const signer = new ethers.Wallet(key);
  const c = loadConfig({
    CURATOR_PRIVATE_KEY: key,
    CURATOR_LIVE: "true",
    DEMO_FACTORY_ADDRESS: address,
  });
  assert.equal(c.curatorAddress, signer.address);
  assert.equal(c.live, true);
  assert.ok(!JSON.stringify(publicConfig(c)).includes(key));
  assert.throws(
    () => loadConfig({ CURATOR_PRIVATE_KEY: key, CURATOR_ADDRESS: address }),
    /does not match/
  );
  assert.throws(() => loadConfig({ CURATOR_LIVE: "true" }), /requires/);
});
test("Generated local env round-trips JSON and never substitutes synthetic data on Base", () => {
  const state = {
    factory: address,
    pool: address,
    tokens: ASSETS.map((a) => ({ address: a.address, decimals: a.decimals })),
  };
  const env = localFixtureEnv(state, "http://127.0.0.1:8546", address);
  const c = loadConfig(parseEnv(serializeEnv(env)));
  assert.equal(c.chainId, 31338);
  assert.equal(c.localDev, true);
  assert.equal(c.explorerUrl, "");
  assert.equal(c.pools[0].address, address);
  assert.equal(c.localAssets.length, 7);
  assert.equal(c.fixturePrices[ASSETS[0].address.toLowerCase()], 1.1);
  assert.throws(
    () => loadConfig({ ...env, DEMO_CHAIN_ID: "8453" }),
    /local chain/
  );
  assert.throws(
    () => loadConfig({ ...env, CURATOR_LIVE: "true" }),
    /live posting disabled/
  );
  assert.throws(
    () => loadConfig({ DEMO_FIXTURE_PRICES: "{}" }),
    /require DEMO_LOCAL_DEV/
  );
  assert.throws(
    () => loadConfig({ ...env, DEMO_LOCAL_ASSETS: "[]" }),
    /DEMO_LOCAL_ASSETS/
  );
});
