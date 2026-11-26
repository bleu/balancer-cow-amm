import { ethers } from "ethers";
import {
  lower,
  portfolio,
  nextPair,
  units,
  FACTORY_ABI,
  ZERO,
} from "../public/shared.mjs";
import { buildAppData, hashOrder } from "../../script/local/curated-order.mjs";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const abs = (n) => (n < 0n ? -n : n);
const min = (a, b) => (a < b ? a : b);
export class Curator {
  constructor(
    config,
    {
      chain,
      prices,
      cow,
      signer,
      now = () => Date.now(),
      wait = sleep,
      log = console.log,
    } = {}
  ) {
    Object.assign(this, { config, chain, prices, cow, signer, now, wait, log });
    this.running = false;
    this.paused = false;
    this.active = null;
    this.startupUntil = null;
    this.status = {
      state: "starting",
      lastCheck: null,
      nextCheck: null,
      currentOrder: null,
      reason: null,
      pools: {},
    };
  }
  emit(state, reason, extra = {}) {
    if (extra.pool)
      this.status.pools[lower(extra.pool)] = { state, reason, ...extra };
    this.status = { ...this.status, state, reason, ...extra };
    this.log(
      JSON.stringify({
        time: new Date(this.now()).toISOString(),
        state,
        reason,
        ...extra,
      })
    );
  }
  pause() {
    this.paused = !this.paused;
    this.emit(
      this.paused ? "paused" : "idle",
      this.paused
        ? "New posting paused; any signed order remains valid until expiry"
        : "Resumed"
    );
  }
  async initialize() {
    const block = await this.chain.provider.getBlock("latest");
    this.startupUntil = block.timestamp + this.config.orderSeconds;
    this.emit(
      "startup-wait",
      "Waiting for any previous process orders to expire",
      { startupUntil: this.startupUntil }
    );
  }
  eligible(address) {
    return this.config.curatedPools.some(
      (p) => lower(p.address) === lower(address)
    );
  }
  async canSign(address, snapshot, priceSnapshot) {
    if (this.paused) throw Error("Posting paused");
    if (!this.eligible(address))
      throw Error("Pool not registered for curation");
    const signerAddress = this.signer
      ? await this.signer.getAddress()
      : this.config.curatorAddress;
    if (!signerAddress || lower(signerAddress) !== lower(snapshot.curator))
      throw Error("On-chain curator does not match server signer");
    if (snapshot.duration !== 180) throw Error("Unexpected order duration");
    this.prices.assertFresh(priceSnapshot, snapshot.timestamp);
  }
  async prepare(address, snapshot, pair, priceSnapshot) {
    const c = this.config,
      pool = this.chain.pool(address),
      by = priceSnapshot.values;
    const sellValue = pair.correction;
    let amount =
      (sellValue * 10n ** BigInt(pair.sell.decimals)) /
      BigInt(by[lower(pair.sell.address)].usd);
    amount = min(amount, BigInt(pair.sell.balance) / 3n); // MAX_OUT_RATIO, conservatively floored.
    const settlement = await new ethers.Contract(
      c.factory,
      FACTORY_ABI,
      this.chain.provider
    ).SOLUTION_SETTLER();
    for (
      let attempt = 0;
      attempt < c.maxSizingAttempts && amount > 0n;
      attempt++, amount /= 2n
    ) {
      try {
        const curveBuy = await pool.calcInGivenOut(
          pair.buy.balance,
          pair.buy.denorm,
          pair.sell.balance,
          pair.sell.denorm,
          amount.toString(),
          0
        );
        if (curveBuy.isZero()) throw Error("Curve amount rounds to zero");
        // No key is needed for pricing/dry-run construction. Signing is the last step.
        let order = {
          sellToken: pair.sell.address,
          buyToken: pair.buy.address,
          receiver: ZERO,
          sellAmount: amount.toString(),
          buyAmount: curveBuy.toString(),
          validTo: snapshot.timestamp + c.orderSeconds,
          appData: ethers.constants.HashZero,
          feeAmount: "0",
          kind: ethers.utils.id("sell"),
          partiallyFillable: false,
          sellTokenBalance: ethers.utils.id("erc20"),
          buyTokenBalance: ethers.utils.id("erc20"),
        };
        let fullAppData;
        let previousLimit = null;
        let quote;
        let verified = false;
        // Quote again with the exact canonical hooks. If changing the amount changes
        // appData, converge or skip; never apply a quote for a different final document.
        for (let pass = 0; pass < 4; pass++) {
          const response = await this.cow.quote(address, order, fullAppData);
          quote = response.quote;
          verified = response.verified === true;
          if (
            !quote ||
            BigInt(quote.buyAmount ?? 0) <= 0n ||
            BigInt(quote.sellAmount ?? 0) + BigInt(quote.feeAmount ?? 0) !==
              amount
          )
            throw Error("Unexpected quote amounts");
          if (
            lower(quote.sellToken) !== lower(order.sellToken) ||
            lower(quote.buyToken) !== lower(order.buyToken)
          )
            throw Error("Unexpected quote pair");
          const limit =
            (BigInt(quote.buyAmount) * BigInt(10000 - c.limitBufferBps)) /
            10000n;
          if (limit < BigInt(curveBuy.toString()))
            throw Error("CoW quote does not meet the intended pool curve");
          if (previousLimit !== null && limit >= previousLimit) break;
          if (pass === 3) throw Error("Hook-aware quote did not stabilize");
          previousLimit = limit;
          order.buyAmount = String(limit);
          const h0 = hashOrder(
            { ...order, appData: ethers.constants.HashZero },
            c.chainId,
            settlement
          );
          fullAppData = buildAppData(address, h0, order.buyAmount);
          order.appData = ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes(fullAppData)
          );
        }
        if (!fullAppData || BigInt(order.buyAmount) <= 0n)
          throw Error("No canonical quote");
        if (c.live && !verified)
          throw Error("CoW did not verify the final hook-aware quote");
        const fresh = await this.chain.snapshot(address);
        await this.canSign(address, fresh, priceSnapshot);
        if (
          fresh.epoch !== snapshot.epoch ||
          fresh.timestamp >= order.validTo - 60
        )
          throw Error("Quote state/deadline changed");
        await this.chain.verify(order, address);
        const soldUsd =
          (amount * BigInt(by[lower(order.sellToken)].usd)) /
          10n ** BigInt(pair.sell.decimals);
        const boughtUsd =
          (BigInt(order.buyAmount) * BigInt(by[lower(order.buyToken)].usd)) /
          10n ** BigInt(pair.buy.decimals);
        const quoteFeeUsd =
          (BigInt(quote.feeAmount ?? 0) *
            BigInt(by[lower(order.sellToken)].usd)) /
          10n ** BigInt(pair.sell.decimals);
        const loss = soldUsd > boughtUsd ? soldUsd - boughtUsd : 0n;
        const executionCost = loss > quoteFeeUsd ? loss : quoteFeeUsd;
        // Conservative maximum curator payment; actual fee is only a fraction of surplus.
        const maxCuratorFee =
          (BigInt(order.buyAmount) * BigInt(fresh.feeBps)) / 10000n;
        const feeUsd =
          (maxCuratorFee * BigInt(by[lower(order.buyToken)].usd)) /
          10n ** BigInt(pair.buy.decimals);
        if (soldUsd <= executionCost + feeUsd)
          throw Error("Correction does not exceed execution costs");
        const before = portfolio(fresh.tokens, by);
        const projected = fresh.tokens.map((t) => ({
          ...t,
          balance: String(
            BigInt(t.balance) +
              (lower(t.address) === lower(order.sellToken)
                ? -amount
                : lower(t.address) === lower(order.buyToken)
                ? BigInt(order.buyAmount) - maxCuratorFee
                : 0n)
          ),
        }));
        const after = portfolio(projected, by);
        if (
          after.assets.reduce((n, t) => n + abs(t.gap), 0n) >=
          before.assets.reduce((n, t) => n + abs(t.gap), 0n)
        )
          throw Error("Trade does not reduce allocation drift");
        return {
          order,
          pool,
          settlement,
          epoch: fresh.epoch,
          correctionUsd: String(soldUsd),
          costUsd: String(executionCost + feeUsd),
        };
      } catch (e) {
        this.emit("sizing", `Candidate rejected: ${safeReason(e)}`, {
          pool: address,
          attempt,
        });
      }
    }
    throw Error(
      "No curve-valid, cost-effective hook-aware quote within sizing limit"
    );
  }
  async waitActive() {
    const a = this.active;
    if (!a) return;
    while (true) {
      const block = await this.chain.provider.getBlock("latest");
      if (block.timestamp > a.validTo) {
        this.emit("expired", "Order window ended", {
          pool: a.pool,
          currentOrder: null,
        });
        this.active = null;
        return;
      }
      try {
        if (await this.cow.filledAndConfirmed(a.uid, this.chain)) {
          this.emit("filled", "Confirmed CoW fill", {
            pool: a.pool,
            currentOrder: null,
          });
          this.active = null;
          return;
        }
      } catch (e) {
        this.emit(
          "monitoring",
          "Order status unavailable; keeping the live-order guard",
          { pool: a.pool, currentOrder: a.uid }
        );
      }
      await this.wait(3000);
    }
  }
  async cycle() {
    if (this.running || this.paused) return false;
    this.running = true;
    let checkingPool = null;
    try {
      if (this.startupUntil === null) await this.initialize();
      const block = await this.chain.provider.getBlock("latest");
      if (block.timestamp <= this.startupUntil) {
        this.emit("startup-wait", "Previous signing window has not drained");
        return false;
      }
      await this.waitActive();
      if (this.paused) return false;
      this.emit("checking", "Hourly MAG7 evaluation", {
        lastCheck: Math.floor(this.now() / 1000),
        nextCheck: Math.floor(this.now() / 1000) + this.config.intervalSeconds,
      });
      const priceSnapshot = await this.prices.get();
      for (const entry of this.config.curatedPools) {
        checkingPool = entry.address;
        this.emit("checking", "Reading pool state", { pool: entry.address });
        const processed = new Set();
        for (let count = 0; count < 7 && !this.paused; count++) {
          const snapshot = await this.chain.snapshot(entry.address);
          await this.canSign(entry.address, snapshot, priceSnapshot);
          const pair = nextPair(
            portfolio(snapshot.tokens, priceSnapshot.values),
            processed,
            units(this.config.minDriftUsd, 8)
          );
          if (!pair) break;
          processed.add(lower(pair.priority.address));
          this.emit(
            "quoting",
            `Evaluate ${pair.sell.symbol} to ${pair.buy.symbol}`,
            { pool: entry.address }
          );
          let candidate;
          try {
            candidate = await this.prepare(
              entry.address,
              snapshot,
              pair,
              priceSnapshot
            );
          } catch (e) {
            this.emit("skipped", safeReason(e), { pool: entry.address });
            continue;
          }
          if (!this.config.live) {
            this.emit(
              "dry-run",
              "Executable candidate prepared; live posting disabled",
              {
                pool: entry.address,
                correctionUsd: candidate.correctionUsd,
                costUsd: candidate.costUsd,
              }
            );
            continue;
          }
          // Recheck key authority and reserve-dependent verification immediately before signing/posting.
          const latest = await this.chain.snapshot(entry.address);
          await this.canSign(entry.address, latest, priceSnapshot);
          if (
            latest.epoch !== candidate.epoch ||
            latest.timestamp >= candidate.order.validTo - 60
          )
            throw Error("Signing state changed");
          await this.chain.verify(candidate.order, entry.address);
          const signed = await this.cow.sign(
            candidate.order,
            candidate.pool,
            this.signer,
            candidate.epoch,
            candidate.settlement
          );
          this.active = {
            pool: entry.address,
            uid: signed.uid,
            validTo: candidate.order.validTo,
          };
          this.emit("submitting", "Submitting canonical curator order", {
            pool: entry.address,
            currentOrder: signed.uid,
          });
          try {
            const returned = await this.cow.post(
              entry.address,
              signed,
              candidate.epoch
            );
            if (returned !== signed.uid) throw Error("Unexpected order UID");
          } catch (e) {
            this.emit(
              "monitoring",
              "Submission uncertain; retaining guard until confirmed fill or expiry",
              { pool: entry.address, currentOrder: signed.uid }
            );
          }
          await this.waitActive();
        }
      }
      this.emit(this.paused ? "paused" : "idle", "Cycle finished", {
        currentOrder: this.active?.uid ?? null,
      });
      return true;
    } catch (e) {
      this.emit(
        "error",
        safeReason(e),
        checkingPool ? { pool: checkingPool } : {}
      );
      return false;
    } finally {
      this.running = false;
    }
  }
}
export function safeReason(error) {
  const s = String(error?.reason ?? error?.message ?? "Unknown error");
  return s
    .replace(/https?:\/\/\S+/g, "[upstream]")
    .replace(/0x[a-fA-F0-9]{64}/g, "[hash]")
    .slice(0, 240);
}
