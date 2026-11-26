import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { loadConfig, publicConfig } from "../lib/config.mjs";
import { ONDO_ASSETS } from "../lib/networks.mjs";
import { Prices } from "../lib/prices.mjs";

test("BNB selects all seven Ondo contracts, 18 decimals and Folio weights together", () => {
  const c = loadConfig({ DEMO_CHAIN_ID: "56" });
  assert.equal(c.assets, ONDO_ASSETS);
  assert.deepEqual(
    c.assets.map((a) => a.symbol),
    ["NVDAon", "MSFTon", "AAPLon", "AMZNon", "GOOGLon", "METAon", "TSLAon"]
  );
  assert.deepEqual(
    c.assets.map((a) => a.weight),
    [20, 15, 15, 15, 15, 10, 10]
  );
  assert.equal(new Set(c.assets.map((a) => a.address.toLowerCase())).size, 7);
  for (const a of c.assets) {
    assert.ok(ethers.utils.isAddress(a.address));
    assert.equal(a.decimals, 18);
  }
  assert.equal(c.cowApi, "https://api.cow.fi/bnb/api/v1");
  assert.equal(c.explorerUrl, "https://bscscan.com");
  const published = publicConfig(c);
  assert.equal(published.nativeCurrency.symbol, "BNB");
  assert.equal(published.publicRpcUrl, "https://bsc-rpc.publicnode.com");
  assert.equal(published.assets, c.assets);
});

test("Base compatibility stays explicit and a stale Base RPC/API cannot silently select BNB", () => {
  const c = loadConfig({
    DEMO_CHAIN_ID: "8453",
    BASE_RPC_URL: "https://rpc.example/private",
  });
  assert.equal(c.assets[0].symbol, "NVDAc");
  assert.equal(c.assets[0].decimals, 8);
  assert.equal(c.nativeCurrency.symbol, "ETH");
  assert.equal(c.coingeckoPlatform, "base");
  assert.equal(c.rpcUrl, "https://rpc.example/private");
  assert.throws(
    () => loadConfig({ BASE_RPC_URL: "https://mainnet.base.org" }),
    /BASE_RPC_URL/
  );
  assert.throws(
    () => loadConfig({ COW_API_URL: "https://api.cow.fi/base/api/v1" }),
    /network does not match/
  );
  assert.throws(() => loadConfig({ DEMO_CHAIN_ID: "1" }), /Only BNB/);
});

test("BNB pricing requests exact Ondo addresses on the BNB platform without applying a second multiplier", async () => {
  const c = loadConfig({});
  const now = Math.floor(Date.now() / 1000);
  const p = new Prices(c, {
    request: async (url) => {
      assert.equal(
        url.pathname,
        "/api/v3/simple/token_price/binance-smart-chain"
      );
      assert.deepEqual(
        url.searchParams.get("contract_addresses").split(","),
        c.assets.map((a) => a.address)
      );
      return Object.fromEntries(
        c.assets.map((a) => [
          a.address.toLowerCase(),
          { usd: 123.45, last_updated_at: now },
        ])
      );
    },
  });
  const snapshot = await p.get();
  assert.equal(Object.values(snapshot.values).length, 7);
  assert.equal(
    snapshot.values[c.assets[0].address.toLowerCase()].usd,
    "12345000000"
  );
  p.assertFresh(snapshot, now);
});
