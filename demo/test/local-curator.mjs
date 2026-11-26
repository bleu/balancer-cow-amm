// Integration test against the explicit local fixture, never production posting.
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { Chain } from "../lib/chain.mjs";
import { Curator } from "../lib/curator.mjs";
import { portfolio, nextPair, USD, lower } from "../public/shared.mjs";
const c = JSON.parse(
  await fs.readFile(
    new URL("../../.local/demo-config.json", import.meta.url),
    "utf8"
  )
);
assert.equal(c.localDev, true);
assert.ok([31337, 31338].includes(c.chainId));
const chain = new Chain(c),
  address = c.pools[0].address;
const snap = await chain.snapshot(address);
const values = Object.fromEntries(
  c.localAssets.map((a) => [
    lower(a.address),
    {
      usd: String(Math.round(c.fixturePrices[lower(a.address)] * Number(USD))),
      updatedAt: snap.timestamp,
    },
  ])
);
const calls = [];
const cow = {
  quote: async (owner, order, appData) => {
    calls.push(appData);
    const sell = snap.tokens.find(
        (t) => lower(t.address) === lower(order.sellToken)
      ),
      buy = snap.tokens.find((t) => lower(t.address) === lower(order.buyToken));
    const received =
      (BigInt(order.sellAmount) *
        BigInt(values[lower(sell.address)].usd) *
        10n ** BigInt(buy.decimals)) /
      10n ** BigInt(sell.decimals) /
      BigInt(values[lower(buy.address)].usd);
    return {
      verified: true,
      quote: {
        sellToken: order.sellToken,
        buyToken: order.buyToken,
        sellAmount: order.sellAmount,
        buyAmount: String(received),
        feeAmount: "0",
      },
    };
  },
};
c.curatedPools = [{ address }];
c.live = false;
const worker = new Curator(c, {
  chain,
  cow,
  prices: { assertFresh: () => {} },
  log: () => {},
});
const pair = nextPair(portfolio(snap.tokens, values));
assert.ok(pair);
const result = await worker.prepare(address, snap, pair, { values });
await chain.verify(result.order, address);
assert.ok(
  calls.some(
    (x) => x?.includes("transferFee") === false && x?.includes("acb2ad6f")
  )
);
assert.equal(result.order.partiallyFillable, false);
assert.equal(result.order.feeAmount, "0");
c.live = true;
const verifiedQuote = cow.quote;
cow.quote = async (...args) => ({
  ...(await verifiedQuote(...args)),
  verified: false,
});
await assert.rejects(
  worker.prepare(address, snap, pair, { values }),
  /No curve-valid/
);
console.log(
  "Real local pool curve + hook-aware quote convergence passed (quote service stub; no posting)."
);
