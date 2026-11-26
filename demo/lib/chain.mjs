import { ethers } from "ethers";
import {
  POOL_ABI,
  FACTORY_ABI,
  TOKEN_ABI,
  ASSETS,
  lower,
  ESCROW_ABI,
} from "./shared.mjs";
export class Chain {
  constructor(config) {
    this.config = config;
    this.provider = new ethers.providers.JsonRpcProvider(
      { url: config.rpcUrl, timeout: 20000 },
      config.chainId
    );
  }
  pool(address) {
    return new ethers.Contract(address, POOL_ABI, this.provider);
  }
  async snapshot(address, { wallet, strict = true } = {}) {
    const c = this.config,
      p = this.pool(address);
    const block = await this.provider.getBlock("latest");
    const opt = { blockTag: block.number };
    if ((await this.provider.getNetwork()).chainId !== c.chainId)
      throw Error("RPC network mismatch");
    if (!c.factory) throw Error("Factory not configured");
    const factory = new ethers.Contract(c.factory, FACTORY_ABI, this.provider);
    const [ownerFactory, registered, finalized] = await Promise.all([
      p.FACTORY(opt),
      factory.isBPool(address, opt),
      p.isFinalized(opt),
    ]);
    if (lower(ownerFactory) !== lower(c.factory) || !registered)
      throw Error("Pool is not registered by the configured factory");
    const addresses = await p[
      finalized ? "getFinalTokens" : "getCurrentTokens"
    ](opt);
    const preset = c.localAssets ?? ASSETS;
    const tokens = await Promise.all(
      addresses.map(async (a) => {
        const token = new ethers.Contract(a, TOKEN_ABI, this.provider);
        const fallback = preset.find((x) => lower(x.address) === lower(a));
        const [balance, denorm, decimals, symbol, name] = await Promise.all([
          p.getBalance(a, opt),
          p.getDenormalizedWeight(a, opt),
          token.decimals(opt),
          token.symbol(opt).catch(() => fallback?.symbol ?? "TOKEN"),
          token.name(opt).catch(() => fallback?.name ?? "Unknown token"),
        ]);
        const item = {
          address: a,
          balance: balance.toString(),
          denorm: denorm.toString(),
          decimals,
          symbol,
          name,
        };
        if (wallet) {
          const [bal, allowance] = await Promise.all([
            token.balanceOf(wallet, opt),
            token.allowance(wallet, address, opt),
          ]);
          item.walletBalance = bal.toString();
          item.allowance = allowance.toString();
        }
        return item;
      })
    );
    const [
      name,
      symbol,
      supply,
      curator,
      creator,
      controller,
      duration,
      feeBps,
      swapFee,
      maxFee,
      epoch,
      escrow,
    ] = await Promise.all([
      p.name(opt),
      p.symbol(opt),
      p.totalSupply(opt),
      p.curator(opt),
      p.creator(opt),
      p.getController(opt),
      p.orderDuration(opt),
      p.curatorFeeBps(opt),
      p.getSwapFee(opt),
      p.MAX_FEE(opt),
      p.minEpoch(opt),
      p.feeEscrow(opt),
    ]);
    // Older deployed factories/pools remain readable; they have no solver-order toggle.
    const solverOrdersEnabled = await p
      .solverOrdersEnabled(opt)
      .catch(() => null);
    const feeContract = new ethers.Contract(escrow, ESCROW_ABI, this.provider);
    await Promise.all(
      tokens.map(async (t) => {
        t.curatorClaimable = (
          await feeContract.claimable(curator, t.address, opt)
        ).toString();
      })
    );
    if (strict) {
      if (!finalized || tokens.length !== 7 || duration !== 180)
        throw Error("Pool is incomplete or does not match MAG7 settings");
      for (const t of tokens) {
        const a = preset.find((a) => lower(a.address) === lower(t.address));
        if (
          !a ||
          t.denorm !== ethers.utils.parseEther(String(a.denorm)).toString() ||
          t.decimals !== a.decimals
        )
          throw Error("Pool token/weight configuration mismatch");
      }
    }
    return {
      address,
      name,
      symbol,
      finalized,
      tokens,
      supply: supply.toString(),
      curator,
      creator,
      controller,
      duration,
      feeBps,
      swapFee: swapFee.toString(),
      solverOrdersEnabled,
      maxFee: maxFee.toString(),
      epoch: epoch.toString(),
      escrow,
      block: block.number,
      blockHash: block.hash,
      timestamp: block.timestamp,
      walletShares: wallet ? (await p.balanceOf(wallet, opt)).toString() : "0",
    };
  }
  async verify(order, address) {
    await this.pool(address).verify(order);
  }
  async confirmed(txHash) {
    const receipt = await this.provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) return false;
    const head = await this.provider.getBlockNumber();
    if (head - receipt.blockNumber + 1 < this.config.confirmations)
      return false;
    const block = await this.provider.getBlock(receipt.blockNumber);
    return block.hash === receipt.blockHash;
  }
}
