import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { deployM7, settleM7, load, contract, manager, trader, chainId, asOrder } from './m7.mjs';
import { signCuratedOrder } from './curated-order.mjs';

await deployM7();
const state = await load();
const pool = await contract('BCoWPool', state.pool);
const helper = await contract('BCoWHelper', state.helper);
const prices = state.tokens.map((token) => 10n ** BigInt(36 - token.decimals));
prices[0] = prices[0] * 11n / 10n;
const quote = await helper.order(pool.address, prices.map(String));
const order = asOrder(quote[0]);
// Give the order a real limit surplus, independently of solver price improvement.
order.sellAmount = order.sellAmount.mul(99).div(100);
const signed = await signCuratedOrder(order, pool, manager, chainId, state.settlement);
assert.equal(await pool.appDataHash(signed.h0, order.buyAmount), signed.order.appData);
assert.equal(ethers.utils.toUtf8String(await pool.appData(signed.h0, order.buyAmount)), signed.fullAppData);
const beforeBuy = await pool.getBalance(order.buyToken);
const beforeSell = await pool.getBalance(order.sellToken);
const baseline = await pool.calcInGivenOut(beforeBuy, await pool.getDenormalizedWeight(order.buyToken),
  beforeSell, await pool.getDenormalizedWeight(order.sellToken), order.sellAmount, 0);
const expected = order.buyAmount.sub(baseline).mul(await pool.curatorFeeBps()).div(10_000);
const fill = await settleM7(state, prices, [order], true);
assert.equal(fill.curatorFee, expected.toString());
assert.ok(expected.gt(0));
const escrow = await contract('BCoWFeeEscrow', await pool.feeEscrow());
const earned = await escrow.claimable(manager.address, order.buyToken);
await (await pool.setCurator(trader.address)).wait();
assert.ok((await escrow.claimable(manager.address, order.buyToken)).eq(earned), 'Replacement took old fees');
await (await pool.connect(trader).revoke(1)).wait();
assert.ok((await pool.minEpoch()).eq(1));
const token = await contract('LocalStockToken', order.buyToken);
const beforeWithdrawal = await token.balanceOf(manager.address);
await (await escrow.withdraw(order.buyToken, manager.address)).wait();
assert.ok((await token.balanceOf(manager.address)).sub(beforeWithdrawal).eq(earned));
assert.ok((await escrow.claimable(manager.address, order.buyToken)).isZero());
console.log('Verified: independent appData, off-chain signing, real hook fee, curator replacement, epoch revocation and old-curator withdrawal.');
