import { lower, USD } from "./shared.mjs";
import { jsonRequest } from "./http.mjs";
export class Prices {
  constructor(
    config,
    {
      chain,
      request = jsonRequest,
      now = () => Date.now(),
      wait = (ms) => new Promise((r) => setTimeout(r, ms)),
    } = {}
  ) {
    this.config = config;
    this.chain = chain;
    this.request = request;
    this.wait = wait;
    this.singleAddressOnly = false;
    this.now = now;
    this.cache = null;
    this.nextFetch = 0;
    this.pending = null;
    this.error = null;
  }
  async get() {
    const now = this.now();
    if (this.pending) return this.pending;
    if (now < this.nextFetch) {
      if (!this.cache) throw Error(this.error ?? "Price request cooling down");
      return this.cache;
    }
    if (this.pending) return this.pending;
    this.pending = this.fetch().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  async watchedAssets() {
    const assets = new Map(
      this.config.assets.map((a) => [lower(a.address), a])
    );
    // Only explicit server lists extend the hourly watchlist. Browser reads and
    // locally cached pools cannot enroll assets or cause CoinGecko requests.
    const pools = new Set(
      [...(this.config.pools ?? []), ...(this.config.curatedPools ?? [])].map(
        (p) => lower(p.address)
      )
    );
    if (this.chain)
      for (const address of pools) {
        try {
          const snapshot = await this.chain.snapshot(address, {
            strict: false,
          });
          for (const token of snapshot.tokens)
            assets.set(lower(token.address), token);
        } catch {
          // A broken listing must not block prices for other configured pools.
        }
      }
    return [...assets.values()];
  }
  async fetch() {
    const c = this.config;
    // Cache both successful and failed attempts. Browser requests never cause a refresh.
    this.nextFetch = this.now() + c.intervalSeconds * 1000;
    try {
      const assets = await this.watchedAssets();
      const url = new URL(
        `https://api.coingecko.com/api/v3/simple/token_price/${c.coingeckoPlatform}`
      );
      url.searchParams.set(
        "contract_addresses",
        assets.map((x) => x.address).join(",")
      );
      url.searchParams.set("vs_currencies", "usd");
      url.searchParams.set("include_last_updated_at", "true");
      url.searchParams.set("precision", "full");
      const options = {
        headers: c.coingeckoApiKey
          ? { "x-cg-demo-api-key": c.coingeckoApiKey }
          : {},
      };
      let raw;
      if (!this.singleAddressOnly) {
        try {
          raw = await this.request(url, options);
        } catch (e) {
          if (
            e.status === 400 &&
            /contract address.*limit|limit.*contract address/i.test(e.message)
          )
            this.singleAddressOnly = true;
          else throw e;
        }
      }
      if (this.singleAddressOnly) {
        raw = {};
        // Keyless currently permits one address per request. Pace the explicit
        // watchlist; an upstream error stops this fetch without signing.
        for (const asset of assets) {
          await this.wait(12500);
          const single = new URL(url);
          single.searchParams.set("contract_addresses", asset.address);
          Object.assign(raw, await this.request(single, options));
        }
      }
      const values = {};
      const missing = [];
      for (const asset of assets) {
        const p = raw[lower(asset.address)];
        if (
          !p ||
          !Number.isFinite(p.usd) ||
          p.usd <= 0 ||
          !Number.isSafeInteger(p.last_updated_at)
        ) {
          missing.push(asset.symbol);
          continue;
        }
        values[lower(asset.address)] = {
          usd: BigInt(Math.round(p.usd * Number(USD))).toString(),
          updatedAt: p.last_updated_at,
        };
      }
      if (!Object.keys(values).length)
        throw Error(`Missing price/timestamp for ${missing.join(", ")}`);
      this.cache = {
        values,
        fetchedAt: Math.floor(this.now() / 1000),
        source: "CoinGecko token USD",
      };
      this.error = missing.length
        ? `Missing price/timestamp for ${missing.join(", ")}`
        : null;
      return this.cache;
    } catch (e) {
      this.error = e.message;
      this.nextFetch = Math.max(
        this.nextFetch,
        this.now() + (e.retryAfter ?? 60) * 1000
      );
      throw e;
    }
  }
  assertFresh(snapshot, chainTime, tokens) {
    if (!snapshot) throw Error("Prices unavailable");
    const values = tokens
      ? tokens.map((t) => {
          const price = snapshot.values[lower(t.address)];
          if (!price) throw Error(`Missing price/timestamp for ${t.symbol}`);
          return price;
        })
      : Object.values(snapshot.values);
    for (const p of values) {
      if (
        p.updatedAt > chainTime + 60 ||
        chainTime - p.updatedAt > this.config.priceMaxAgeSeconds
      )
        throw Error("CoinGecko price snapshot is stale");
    }
  }
}
