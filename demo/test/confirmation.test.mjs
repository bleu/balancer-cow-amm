import { test } from "node:test";
import assert from "node:assert/strict";
import { Chain } from "../lib/chain.mjs";
import { Cow } from "../lib/cow.mjs";
test("A fill releases the guard only after successful canonical confirmations", async () => {
  const chain = new Chain({
    chainId: 31338,
    rpcUrl: "http://127.0.0.1:8546",
    confirmations: 2,
  });
  let height = 10,
    hash = "0xcanonical",
    status = 1;
  chain.provider = {
    getTransactionReceipt: async () => ({
      status,
      blockNumber: 10,
      blockHash: "0xcanonical",
    }),
    getBlockNumber: async () => height,
    getBlock: async () => ({ hash }),
  };
  const cow = new Cow({ cowApi: "https://api.cow.fi/base/api/v1" });
  cow.order = async () => ({ status: "fulfilled" });
  cow.trades = async () => [{ txHash: "0xtx" }];
  assert.equal(await cow.filledAndConfirmed("uid", chain), false);
  height = 11;
  assert.equal(await cow.filledAndConfirmed("uid", chain), true);
  hash = "0xreorg";
  assert.equal(await cow.filledAndConfirmed("uid", chain), false);
  hash = "0xcanonical";
  status = 0;
  assert.equal(await cow.filledAndConfirmed("uid", chain), false);
});
