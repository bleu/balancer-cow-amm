import { ethers } from "ethers";
import { jsonRequest } from "./http.mjs";
import { signCuratedOrder } from "../../script/local/curated-order.mjs";
export class Cow {
  constructor(
    config,
    {
      request = jsonRequest,
      wait = (ms) => new Promise((r) => setTimeout(r, ms)),
    } = {}
  ) {
    this.config = config;
    this.request = request;
    this.wait = wait;
    this.nextQuote = 0;
  }
  call(path, options) {
    return this.request(this.config.cowApi + path, options);
  }
  async quote(pool, order, fullAppData) {
    await this.wait(Math.max(0, this.nextQuote - Date.now()));
    this.nextQuote = Date.now() + 1100;
    return this.call("/quote", {
      method: "POST",
      body: {
        from: pool,
        sellToken: order.sellToken,
        buyToken: order.buyToken,
        receiver: pool,
        kind: "sell",
        sellAmountBeforeFee: String(order.sellAmount),
        validTo: order.validTo,
        partiallyFillable: false,
        signingScheme: "eip1271",
        priceQuality: "verified",
        ...(fullAppData ? { appData: fullAppData } : {}),
      },
    });
  }
  async sign(order, pool, signer, epoch, settlement) {
    const signed = await signCuratedOrder(
      order,
      pool,
      signer,
      this.config.chainId,
      settlement,
      epoch
    );
    signed.uid = ethers.utils.hexConcat([
      signed.orderHash,
      pool.address,
      ethers.utils.hexZeroPad(ethers.utils.hexlify(order.validTo), 4),
    ]);
    return signed;
  }
  async post(pool, signed) {
    // The API wants just the ERC-1271 payload; the settlement adds the owner prefix.
    const signature = "0x" + signed.signature.slice(42);
    const body = {
      ...signed.order,
      from: pool,
      appData: signed.fullAppData,
      appDataHash: signed.order.appData,
      sellAmount: String(signed.order.sellAmount),
      buyAmount: String(signed.order.buyAmount),
      feeAmount: "0",
      kind: "sell",
      sellTokenBalance: "erc20",
      buyTokenBalance: "erc20",
      signingScheme: "eip1271",
      signature,
    };
    return this.call("/orders", { method: "POST", body });
  }
  order(uid) {
    return this.call("/orders/" + uid);
  }
  trades(uid) {
    return this.request(
      this.config.cowApi.replace(/\/v1$/, "/v2") +
        "/trades?orderUid=" +
        encodeURIComponent(uid)
    );
  }
  async filledAndConfirmed(uid, chain) {
    const order = await this.order(uid);
    if (order.status !== "fulfilled") return false;
    const trades = await this.trades(uid);
    if (!Array.isArray(trades) || !trades.length) return false;
    for (const trade of trades)
      if (!trade.txHash || !(await chain.confirmed(trade.txHash))) return false;
    return true;
  }
  activity(owner) {
    return this.call("/account/" + owner + "/orders?limit=20&offset=0");
  }
}
