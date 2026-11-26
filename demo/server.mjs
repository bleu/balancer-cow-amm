import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { loadConfig, publicConfig } from "./lib/config.mjs";
import { Chain } from "./lib/chain.mjs";
import { Prices } from "./lib/prices.mjs";
import { Cow } from "./lib/cow.mjs";
import { Curator, safeReason } from "./lib/curator.mjs";
import { ASSETS, lower, USD } from "./lib/shared.mjs";
const root = path.dirname(fileURLToPath(import.meta.url));
const json = (res, status, data) => {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(data));
};
export function createApp(
  config,
  {
    chain = new Chain(config),
    prices = new Prices(config),
    cow = new Cow(config),
    worker,
    pageHandler,
  } = {}
) {
  const signer = config.key
    ? new ethers.Wallet(config.key, chain.provider)
    : null;
  worker ??= new Curator(config, { chain, prices, cow, signer });
  const rates = new Map();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (!url.pathname.startsWith("/api/")) {
        if (pageHandler) return pageHandler(req, res);
        return json(res, 404, { error: "Not found" });
      }
      if (req.method !== "GET")
        return json(res, 405, { error: "Read-only API" });
      // Only bounded reads and explicit RPC methods; never accept arbitrary relay payloads or log requests.
      const key = req.socket.remoteAddress;
      const bucket = rates.get(key) ?? { count: 0, start: Date.now() };
      if (Date.now() - bucket.start > 60000) {
        bucket.count = 0;
        bucket.start = Date.now();
      }
      bucket.count++;
      rates.set(key, bucket);
      if (bucket.count > 600) return json(res, 429, { error: "Slow down" });
      if (rates.size > 10000) rates.clear();
      if (url.pathname === "/api/config")
        return json(res, 200, {
          ...publicConfig(config),
          assets: config.localAssets ?? ASSETS,
        });
      if (url.pathname === "/api/status")
        return json(res, 200, {
          ...worker.status,
          live: config.live,
          paused: worker.paused,
          registeredPools: config.curatedPools.map((p) => p.address),
        });
      if (url.pathname === "/api/prices")
        return json(res, 200, { snapshot: prices.cache, error: prices.error });
      if (url.pathname === "/api/rpc") {
        const method = url.searchParams.get("method");
        let params;
        try {
          params = JSON.parse(url.searchParams.get("params") ?? "[]");
        } catch {
          return json(res, 400, { error: "Invalid parameters" });
        }
        if (
          ![
            "eth_call",
            "eth_getCode",
            "eth_chainId",
            "eth_blockNumber",
            "eth_getBlockByNumber",
            "eth_getTransactionReceipt",
            "eth_getTransactionByHash",
            "eth_getTransactionCount",
            "eth_estimateGas",
            "eth_gasPrice",
            "eth_getBalance",
          ].includes(method)
        )
          return json(res, 403, { error: "RPC method not allowed" });
        if (!Array.isArray(params) || JSON.stringify(params).length > 16000)
          return json(res, 400, { error: "Request too large" });
        return json(res, 200, {
          result: await chain.provider.send(method, params),
        });
      }
      if (url.pathname === "/api/activity") {
        const address = url.searchParams.get("pool");
        if (!ethers.utils.isAddress(address ?? ""))
          return json(res, 400, { error: "Invalid address" });
        // The API read does not enroll a local pool in curation or public discovery.
        const data = config.localDev ? [] : await cow.activity(address);
        return json(res, 200, data);
      }
      if (url.pathname === "/api/pool") {
        const address = url.searchParams.get("address"),
          wallet = url.searchParams.get("wallet");
        if (
          !ethers.utils.isAddress(address ?? "") ||
          (wallet && !ethers.utils.isAddress(wallet))
        )
          return json(res, 400, { error: "Invalid address" });
        return json(
          res,
          200,
          await chain.snapshot(address, {
            wallet: wallet || undefined,
            strict: false,
          })
        );
      }
      return json(res, 404, { error: "Not found" });
    } catch (e) {
      json(res, 502, { error: safeReason(e) });
    }
  });
  return { server, worker, chain, prices };
}
async function main() {
  const config = loadConfig();
  const { default: next } = await import("next");
  const web = next({
    dev: process.env.NODE_ENV !== "production",
    dir: path.join(root, "web"),
    webpack: true,
    hostname: config.host,
    port: config.port,
  });
  await web.prepare();
  const app = createApp(config, { pageHandler: web.getRequestHandler() });
  if (config.localDev && config.fixturePrices) {
    app.prices.get = async () =>
      (app.prices.cache = {
        source: "Local synthetic fixture (not market prices)",
        fetchedAt: Math.floor(Date.now() / 1000),
        values: Object.fromEntries(
          config.localAssets.map((a) => [
            lower(a.address),
            {
              usd: String(
                Math.round(config.fixturePrices[lower(a.address)] * Number(USD))
              ),
              updatedAt: Math.floor(Date.now() / 1000),
            },
          ])
        ),
      });
  }
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    const tickStarted = Date.now();
    try {
      if (config.curatedPools.length) await app.worker.cycle();
      else {
        await app.prices.get();
        app.worker.emit(
          "idle",
          config.factory
            ? "No pools registered for curation"
            : "Deploy and configure the demo factory to enable wallet flows"
        );
      }
    } catch (e) {
      app.worker.emit("error", safeReason(e));
    }
    if (stopped) return;
    const waiting = app.worker.status.state === "startup-wait";
    timer = setTimeout(
      tick,
      waiting
        ? 5000
        : Math.max(
            1000,
            config.intervalSeconds * 1000 - (Date.now() - tickStarted)
          )
    );
  };
  let timer;
  process.on("SIGUSR2", () => app.worker.pause());
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    app.worker.paused = true;
    app.server.close(() => web.close());
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const { port, host } = config;
  app.server.listen(port, host, () => {
    console.log(
      `MAG7 demo: http://${host}:${port} (${
        config.live ? "LIVE POSTING" : "read-only / dry-run curator"
      })`
    );
    tick();
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error("Demo startup failed: " + safeReason(error));
    process.exitCode = 1;
  });
