import { ASSETS, lower, USD } from "../public/shared.mjs";
import { jsonRequest } from "./http.mjs";
export class Prices {
  constructor(
    config,
    {
      request = jsonRequest,
      now = () => Date.now(),
      wait = (ms) => new Promise((r) => setTimeout(r, ms)),
    } = {}
  ) {
    this.config = config;
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
  async fetch() {
    const c = this.config,
      assets = c.localAssets ?? ASSETS;
    // Cache both successful and failed attempts. Browser requests never cause a refresh.
    this.nextFetch = this.now() + c.intervalSeconds * 1000;
    try {
      const url = new URL(
        "https://api.coingecko.com/api/v3/simple/token_price/base"
      );
      url.searchParams.set(
        "contract_addresses",
        assets.map((x) => x.address).join(",")
      );
      url.searchParams.set("vs_currencies", "usd");
      url.searchParams.set("include_last_updated_at", "true");
      url.searchParams.set("precision", "full");
      const options = {
        headers: process.env.COINGECKO_API_KEY
          ? { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY }
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
        // Keyless currently permits one address per request. Seven slow requests
        // per hour remain bounded; an error stops this cycle without signing.
        for (const asset of assets) {
          await this.wait(12500);
          const single = new URL(url);
          single.searchParams.set("contract_addresses", asset.address);
          Object.assign(raw, await this.request(single, options));
        }
      }
      const values = {};
      for (const asset of assets) {
        const p = raw[lower(asset.address)];
        if (
          !p ||
          !Number.isFinite(p.usd) ||
          p.usd <= 0 ||
          !Number.isSafeInteger(p.last_updated_at)
        )
          throw Error(`Missing price/timestamp for ${asset.symbol}`);
        values[lower(asset.address)] = {
          usd: BigInt(Math.round(p.usd * Number(USD))).toString(),
          updatedAt: p.last_updated_at,
        };
      }
      this.cache = {
        values,
        fetchedAt: Math.floor(this.now() / 1000),
        source: "CoinGecko token USD",
      };
      this.error = null;
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
  assertFresh(snapshot, chainTime) {
    if (!snapshot) throw Error("Prices unavailable");
    for (const p of Object.values(snapshot.values)) {
      if (
        p.updatedAt > chainTime + 60 ||
        chainTime - p.updatedAt > this.config.priceMaxAgeSeconds
      )
        throw Error("CoinGecko price snapshot is stale");
    }
  }
}
