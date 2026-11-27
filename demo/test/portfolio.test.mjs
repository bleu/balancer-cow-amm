import { test } from "node:test";
import assert from "node:assert/strict";
import { customPortfolio, setupAssets } from "../lib/portfolio.mjs";
import { ASSETS, BONE, units } from "../lib/shared.mjs";
const rows = (weights) =>
  weights.map((weight, i) => ({
    address: "0x" + String(i + 1).padStart(40, "0"),
    weight,
    decimals: i ? 6 : 18,
    symbol: "T" + i,
    name: "Token " + i,
  }));
test("Custom weights map exactly to contract weights, including boundary and fractional weights", () => {
  for (const weights of [
    ["98", "2"],
    ["33.33", "66.67"],
    Array(8).fill("12.5"),
  ]) {
    const assets = customPortfolio(rows(weights));
    assert.equal(
      assets.reduce((n, a) => n + units(a.denorm, 18), 0n),
      50n * BONE
    );
    for (const a of assets)
      assert.equal(
        (units(a.denorm, 18) * 10000n) / (50n * BONE),
        units(a.weight, 2)
      );
  }
});
test("Invalid custom baskets fail before initialization", () => {
  for (const weights of [
    ["100"],
    Array(9).fill("10"),
    ["99", "1"],
    ["50", "40"],
    ["50.001", "49.999"],
  ])
    assert.throws(() => customPortfolio(rows(weights)));
  const duplicate = rows(["50", "50"]);
  duplicate[1].address = duplicate[0].address;
  assert.throws(() => customPortfolio(duplicate), /Duplicate/);
  const zero = rows(["50", "50"]);
  zero[0].address = "0x" + "0".repeat(40);
  assert.throws(() => customPortfolio(zero), /nonzero/);
  assert.throws(
    () =>
      customPortfolio(rows(["50", "50"]).map((a) => ({ ...a, decimals: 256 }))),
    /decimals/
  );
});
test("Saved custom setup survives preset changes; legacy MAG7 drafts retain fallback", () => {
  const assets = customPortfolio(rows(["50", "50"]));
  const draft = { assets, seedAmounts: ["1000000", "1000000"] };
  assert.deepEqual(setupAssets(draft, ASSETS), assets);
  assert.deepEqual(
    setupAssets({ seedAmounts: ASSETS.map(() => "1000000") }, ASSETS),
    ASSETS
  );
  assert.throws(
    () => setupAssets({ ...draft, seedAmounts: ["1000000"] }, ASSETS),
    /match/
  );
  assert.throws(
    () => setupAssets({ ...draft, seedAmounts: ["999999", "1000000"] }, ASSETS),
    /minimum/
  );
});
