import { test } from "node:test";
import assert from "node:assert/strict";
import { Prices } from "../lib/prices.mjs";
import { ASSETS, lower, USD } from "../lib/shared.mjs";
const config = {
  intervalSeconds: 3600,
  priceMaxAgeSeconds: 1800,
  assets: ASSETS,
  coingeckoPlatform: "base",
};
test("One batched request per hour, callers share cache, freshness checked separately", async () => {
  let calls = 0,
    now = 10000000;
  const prices = new Prices(
    { ...config, coingeckoApiKey: "test-env-price-key" },
    {
      now: () => now,
      request: async (url, options) => {
        assert.equal(
          options.headers["x-cg-demo-api-key"],
          "test-env-price-key"
        );
        calls++;
        assert.equal(
          new URL(url).searchParams.get("contract_addresses").split(",").length,
          7
        );
        return Object.fromEntries(
          ASSETS.map((a) => [
            lower(a.address),
            { usd: 100, last_updated_at: 10000 },
          ])
        );
      },
    }
  );
  const [a, b] = await Promise.all([prices.get(), prices.get()]);
  assert.equal(a, b);
  assert.equal(calls, 1);
  await prices.get();
  assert.equal(calls, 1);
  prices.assertFresh(a, 10000);
  assert.throws(() => prices.assertFresh(a, 11801), /stale/);
  now += 3600001;
  await prices.get();
  assert.equal(calls, 2);
});
test("Missing price never becomes a zero-valued holding and failed attempts back off", async () => {
  let calls = 0;
  const prices = new Prices(config, {
    now: () => 10000000,
    request: async () => {
      calls++;
      return {};
    },
  });
  await assert.rejects(prices.get(), /Missing price/);
  await assert.rejects(prices.get(), /Missing price/);
  assert.equal(calls, 1);
  assert.equal(prices.cache, null);
});
test("Keyless one-address limit falls back once to paced per-token hourly requests", async () => {
  let calls = 0,
    waits = 0;
  const prices = new Prices(config, {
    now: () => 10000000,
    wait: async () => {
      waits++;
    },
    request: async (url) => {
      calls++;
      const addresses = new URL(url).searchParams
        .get("contract_addresses")
        .split(",");
      if (addresses.length > 1) {
        const e = Error(
          "contract address count exceeds limit of 1 contract address"
        );
        e.status = 400;
        throw e;
      }
      return { [lower(addresses[0])]: { usd: 100, last_updated_at: 10000 } };
    },
  });
  const snapshot = await prices.get();
  assert.equal(Object.keys(snapshot.values).length, 7);
  assert.equal(calls, 8);
  assert.equal(waits, 7);
  await prices.get();
  assert.equal(calls, 8);
});

test("Only server-listed pools extend the hourly price watchlist; missing custom prices do not erase priced pools", async () => {
  const extra = {
    address: "0x0000000000000000000000000000000000000012",
    symbol: "CUSTOM",
  };
  let reads = 0,
    calls = 0;
  const prices = new Prices(
    {
      ...config,
      pools: [{ address: extra.address }],
      curatedPools: [{ address: extra.address }],
    },
    {
      now: () => 10000000,
      chain: {
        snapshot: async (address, options) => {
          reads++;
          assert.equal(address, extra.address);
          assert.equal(options.strict, false);
          return { tokens: [extra] };
        },
      },
      request: async (url) => {
        calls++;
        assert.ok(
          new URL(url).searchParams
            .get("contract_addresses")
            .includes(extra.address)
        );
        return Object.fromEntries(
          ASSETS.map((a) => [
            lower(a.address),
            { usd: 100, last_updated_at: 10000 },
          ])
        );
      },
    }
  );
  const snapshot = await prices.get();
  await prices.get();
  assert.equal(reads, 1);
  assert.equal(calls, 1);
  assert.equal(Object.keys(snapshot.values).length, 7);
  assert.match(prices.error, /CUSTOM/);
  prices.assertFresh(snapshot, 10000, ASSETS);
  assert.throws(
    () => prices.assertFresh(snapshot, 10000, [extra]),
    /Missing price/
  );
});

test("Frontend-listed BNB portfolios receive hourly USD prices without server enrollment", async () => {
  const wbnb = {
    address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    symbol: "WBNB",
  };
  const usdc = {
    address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    symbol: "USDC",
  };
  const frontendPool = "0x44363bddb3fafd262a416567b7827e46d266f86d";
  const c = { ...config, chainId: 56, pools: [], curatedPools: [] };
  let reads = 0,
    requests = 0;
  const prices = new Prices(c, {
    now: () => 10000000,
    chain: {
      snapshot: async (address) => {
        assert.equal(address, frontendPool);
        reads++;
        return { tokens: [wbnb, usdc] };
      },
    },
    request: async (url) => {
      requests++;
      const watched = new URL(url).searchParams
        .get("contract_addresses")
        .split(",")
        .map(lower);
      assert.ok(watched.includes(lower(wbnb.address)));
      assert.ok(watched.includes(lower(usdc.address)));
      return Object.fromEntries(
        watched.map((address) => [
          address,
          { usd: 100, last_updated_at: 10000 },
        ])
      );
    },
  });
  const snapshot = await prices.get();
  await prices.get();
  prices.assertFresh(snapshot, 10000, [wbnb, usdc]);
  assert.equal(reads, 1);
  assert.equal(requests, 1);
  assert.deepEqual(c.pools, []);
  assert.deepEqual(c.curatedPools, []);
});
