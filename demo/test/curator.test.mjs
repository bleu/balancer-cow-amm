import { test } from "node:test";
import assert from "node:assert/strict";
import { Curator } from "../lib/curator.mjs";
import { ASSETS, BONE, USD, lower } from "../lib/shared.mjs";
function fixture() {
  let time = 1000,
    posts = 0,
    snapshots = 0;
  const owner = "0x0000000000000000000000000000000000000011",
    pool = "0x0000000000000000000000000000000000000022";
  const tokens = ASSETS.map((a) => ({
    ...a,
    denorm: String(BigInt(a.denorm) * BONE),
    balance: String(BigInt(a.weight) * 100n * 10n ** 8n),
  }));
  const values = Object.fromEntries(
    ASSETS.map((a, i) => [
      lower(a.address),
      { usd: String(i === 0 ? USD * 2n : USD), updatedAt: time },
    ])
  );
  const chain = {
    provider: { getBlock: async () => ({ timestamp: time }) },
    snapshot: async () => {
      snapshots++;
      return {
        tokens: structuredClone(tokens),
        curator: owner,
        epoch: "0",
        duration: 180,
        timestamp: time,
      };
    },
    verify: async () => {},
  };
  const prices = { get: async () => ({ values }), assertFresh: () => {} };
  const cow = {
    sign: async (o) => ({ uid: "order-" + posts }),
    post: async () => {
      posts++;
      return "order-" + (posts - 1);
    },
    filledAndConfirmed: async () => true,
  };
  const config = {
    curatedPools: [{ address: pool }],
    curatorAddress: owner,
    orderSeconds: 180,
    intervalSeconds: 3600,
    minDriftUsd: "0.10",
    live: true,
  };
  const worker = new Curator(config, {
    chain,
    prices,
    cow,
    signer: { getAddress: async () => owner },
    log: () => {},
    wait: async () => {
      time += 181;
    },
  });
  worker.prepare = async (address, snapshot, pair) => ({
    pool: { address },
    order: { validTo: time + 180 },
    epoch: "0",
    settlement: owner,
  });
  return {
    worker,
    chain,
    config,
    tokens,
    setTime: (t) => {
      time = t;
    },
    get posts() {
      return posts;
    },
    get snapshots() {
      return snapshots;
    },
  };
}
test("Multiple candidates execute sequentially and every fill triggers a new reserve read", async () => {
  const f = fixture();
  await f.worker.initialize();
  f.setTime(1181);
  await f.worker.cycle();
  assert.ok(f.posts >= 2);
  assert.ok(f.posts <= 7);
  assert.ok(f.snapshots >= f.posts * 2);
  assert.equal(f.worker.active, null);
});
test("Restart drain and concurrent-cycle guard prevent another signing window", async () => {
  const f = fixture();
  await f.worker.cycle();
  assert.equal(f.posts, 0);
  f.worker.running = true;
  f.setTime(2000);
  assert.equal(await f.worker.cycle(), false);
  assert.equal(f.posts, 0);
});
test("Ambiguous POST retains active order until chain-time expiry and then continues", async () => {
  const f = fixture();
  f.worker.cow.post = async () => {
    throw Error("timeout");
  };
  f.worker.cow.filledAndConfirmed = async () => {
    throw Error("404");
  };
  await f.worker.initialize();
  f.setTime(1181);
  await f.worker.cycle();
  assert.equal(f.worker.active, null);
  assert.equal(f.worker.running, false);
});
test("Curator replacement stops signing and paused worker does not run", async () => {
  const f = fixture();
  f.chain.snapshot = async () => ({
    curator: "0x0000000000000000000000000000000000000099",
    duration: 180,
    timestamp: 2000,
    tokens: f.tokens,
  });
  await f.worker.initialize();
  f.setTime(1181);
  await f.worker.cycle();
  assert.equal(f.posts, 0);
  assert.match(f.worker.status.reason, /does not match/);
  f.worker.pause();
  assert.equal(await f.worker.cycle(), false);
});
test("An unfillable priority asset does not stop consideration of other assets", async () => {
  const f = fixture();
  let attempts = 0;
  f.worker.prepare = async () => {
    attempts++;
    throw Error("No executable quote");
  };
  await f.worker.initialize();
  f.setTime(1181);
  await f.worker.cycle();
  assert.equal(attempts, 7);
  assert.equal(f.posts, 0);
});

test("An unpriced custom pool is skipped without blocking another enrolled pool", async () => {
  const f = fixture();
  const unpriced = "0x0000000000000000000000000000000000000033";
  f.config.curatedPools.unshift({ address: unpriced });
  const snapshot = f.chain.snapshot;
  f.chain.snapshot = async (address) => {
    const s = await snapshot();
    if (address === unpriced)
      s.tokens = [
        { ...s.tokens[0], address: unpriced, symbol: "UNKNOWN" },
        s.tokens[1],
      ];
    return s;
  };
  f.worker.prices.assertFresh = (prices, time, tokens) => {
    if (tokens.some((t) => !prices.values[lower(t.address)]))
      throw Error("Missing price/timestamp for UNKNOWN");
  };
  await f.worker.initialize();
  f.setTime(1181);
  await f.worker.cycle();
  assert.ok(f.posts > 0);
  assert.equal(f.worker.status.pools[unpriced].state, "skipped");
  assert.match(f.worker.status.pools[unpriced].reason, /Missing price/);
});
