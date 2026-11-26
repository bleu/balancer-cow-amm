import { test } from "node:test";
import assert from "node:assert/strict";
import { Prices } from "../lib/prices.mjs";
import { ASSETS, lower, USD } from "../public/shared.mjs";
const config = { intervalSeconds: 3600, priceMaxAgeSeconds: 1800 };
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
