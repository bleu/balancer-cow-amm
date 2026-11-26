import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.mjs";
import { publicConfig } from "../lib/config.mjs";
const config = {
  chainId: 8453,
  name: "Base",
  factory: null,
  pools: [],
  curatedPools: [],
  curatorAddress: null,
  key: null,
  rpcUrl: "https://user:password@rpc.invalid/private-key",
  live: false,
};
test("Public API omits signing/RPC secrets and rejects log or write RPC methods", async () => {
  const c = { ...config, key: "secret-test-value" };
  assert.ok(!JSON.stringify(publicConfig(c)).includes("secret-test-value"));
  assert.ok(!JSON.stringify(publicConfig(c)).includes("password"));
  const worker = { status: { state: "idle" }, paused: false };
  const chain = {
    provider: {
      send: async (method) => {
        assert.equal(method, "eth_chainId");
        return "0x2105";
      },
    },
  };
  const { server } = createApp(config, {
    chain,
    worker,
    prices: { cache: null, error: null },
    cow: {},
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const raw = await (await fetch(base + "/api/config")).text();
    assert.ok(!raw.includes("password"));
    for (const method of [
      "eth_getLogs",
      "eth_sendRawTransaction",
      "debug_traceCall",
      "eth_subscribe",
    ])
      assert.equal(
        (await fetch(base + "/api/rpc?method=" + method)).status,
        403
      );
    assert.equal(
      (await fetch(base + "/api/config", { method: "POST" })).status,
      405
    );
    assert.deepEqual(
      await (await fetch(base + "/api/rpc?method=eth_chainId")).json(),
      { result: "0x2105" }
    );
    assert.equal((await fetch(base + "/../.env")).status, 404);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("Next handles pages while API method restrictions stay in the service", async () => {
  let pageCalls = 0;
  const { server } = createApp(config, {
    chain: {},
    prices: {},
    cow: {},
    worker: { status: {}, paused: false },
    pageHandler: (_req, res) => {
      pageCalls++;
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<main>Next page</main>");
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  try {
    assert.equal(
      await (await fetch(origin + "/")).text(),
      "<main>Next page</main>"
    );
    assert.equal(
      (await fetch(origin + "/api/config", { method: "POST" })).status,
      405
    );
    assert.equal((await fetch(origin + "/api/unknown")).status, 404);
    assert.equal(pageCalls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
