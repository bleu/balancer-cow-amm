import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASSETS,
  BONE,
  USD,
  units,
  liquidityAmounts,
  portfolio,
  nextPair,
  mergeCatalog,
  lower,
} from "../public/shared.mjs";
const holdings = () =>
  ASSETS.map((a) => ({
    ...a,
    balance: String(BigInt(a.weight) * 100n * 10n ** 8n),
    denorm: String(BigInt(a.denorm) * BONE),
  }));
const prices = () =>
  Object.fromEntries(
    ASSETS.map((a) => [lower(a.address), { usd: String(USD), updatedAt: 1 }])
  );
test("Folio allocation equilibrium, then most overweight asset routes to a deficit", () => {
  const tokens = holdings(),
    p = prices();
  assert.equal(nextPair(portfolio(tokens, p)), null);
  p[lower(ASSETS[0].address)].usd = String((USD * 11n) / 10n);
  const pair = nextPair(portfolio(tokens, p));
  assert.equal(pair.sell.address, ASSETS[0].address);
  assert.ok(pair.buy.gap < 0n);
  assert.equal(pair.priority.address, ASSETS[0].address);
});
test("Largest underweight asset is bought and strict $0.10 boundary is respected", () => {
  const tokens = holdings(),
    p = prices();
  p[lower(ASSETS[0].address)].usd = String(USD / 2n);
  const pair = nextPair(portfolio(tokens, p));
  assert.equal(pair.buy.address, ASSETS[0].address);
  const view = {
    assets: [
      { address: "a", gap: USD / 10n },
      { address: "b", gap: -USD / 10n },
    ],
  };
  assert.equal(nextPair(view), null);
  view.assets[0].gap++;
  assert.equal(nextPair(view).priority.address, "a");
});
test("Quote sizes and proportional amounts preserve raw decimal units", () => {
  assert.deepEqual(
    liquidityAmounts([80000000000n, 60000000000n], BONE, 100n * BONE),
    [800000000n, 600000000n]
  );
  assert.throws(() => liquidityAmounts([1n, 2n], 1n, 100n * BONE), /rounds/);
  assert.equal(units("0.10", 8), 10000000n);
  assert.throws(() => units("1e4"), /decimal/);
});
test("Whitelisted entries win over local entries without publishing other local pools", () => {
  const address = ASSETS[0].address;
  const local = [
    { chainId: 8453, address, name: "mine" },
    { chainId: 1, address: ASSETS[1].address },
  ];
  const publicPools = [{ address: address.toLowerCase(), name: "official" }];
  const entries = mergeCatalog(publicPools, local, 8453);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].public, true);
  assert.equal(entries[0].name, "official");
  assert.equal(local[0].public, undefined);
});
