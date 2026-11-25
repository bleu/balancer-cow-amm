# Curated standing orders

The contract design is in [Curated Standing Orders for CoW AMM](curated-standing-orders.md).

## Deployment and migration

This changes the pool and factory ABI and requires new deployments. Existing deployed pools are unaffected.

Deploy `BCoWFactory(settlement, hooksTrampoline, bdaoMsig)` with the chain's settlement-only HooksTrampoline. `script/Params.s.sol` selects the older trampoline on Gnosis and the current trampoline on Ethereum, Arbitrum, Base and Sepolia. A factory creator can call:

```solidity
factory.newBPool(name, symbol, curator, orderDuration, curatorFeeBps);
```

The caller becomes the pool's immutable `creator` and its initial liquidity controller. `newBPool(name, symbol)` remains available, choosing the caller as curator, 180 seconds and 100 basis points. Transferring the liquidity controller does not transfer creator authority. A directly deployed pool takes a `BCoWPool.Settings` struct. Duration is between 60 and 300 seconds inclusive; the fee is below 10,000 basis points. Use sufficient duration for the order book's minimum validity and latency.

The factory uses an immutable `BCoWPoolDeployer` module because embedding pool creation code in factory runtime exceeds EIP-170. The module stores STOP-prefixed bytecode fragments in two immutable data contracts. Its only deploy entry point requires execution in the creating factory's context. The factory delegatecalls it, so CREATE still makes the factory the pool's deployer and initial controller. Constructor errors propagate without wrapping. This adds no admin, upgrade mechanism or storage writes in the module.

Pool math and the protective direct-swap fee are unchanged. Keep `MAX_FEE` configured before finalizing a protected pool. `BCoWHelper` keeps its quote calculations and pair APIs; its return metadata now describes canonical fill-or-kill orders and both hooks. Its signature return contains an empty curator signature and cannot authorize a settlement. It is a curator quote tool; old solver-side JIT integration is no longer supported.

## Signing and posting

1. Choose a sell-token/buy-token pair and a curve-valid limit. Use a zero receiver, sell kind, ERC20 balance markers, zero fee and `partiallyFillable = false`.
2. Compute `h0` as the CoW EIP-712 order digest with `appData = bytes32(0)`.
3. Build the exact canonical document with `buildAppData(pool, h0, buyAmount)` in `script/local/curated-order.mjs`, or read `pool.appData(h0, buyAmount)`. The JSON uses schema `1.6.0`, lowercase hex, fixed key order and no whitespace.
4. Set `order.appData = keccak256(fullAppData)` and compute the final CoW order hash.
5. Sign `CuratedOrder(bytes32 orderHash,uint256 epoch)` using the EIP-712 domain `{ name: "Bleu CoW AMM", version: "1", chainId, verifyingContract: pool }`. `epoch` must be at least `pool.minEpoch()`. `pool.curatorDigest(orderHash, epoch)` exposes the digest for independent verification. The curator is an ECDSA signer; contract-wallet curator signatures are not supported.
6. The ERC-1271 payload is `abi.encode(order, epoch, curatorSig)`. Post it with `from = pool` and `signingScheme = "eip1271"`, supplying the full appData document. Settlement trade signatures additionally prefix the pool's 20-byte address; the order-book signature field does not.

`signCuratedOrder` in the same module performs these steps and produces the trampoline interactions for local testing. It signs off-chain; it submits no curator transaction.

The order book simulates pre-hooks before validating ERC-1271, while the pool checks the pending commitment, limit, canonical appData, full order digest, curator epoch/signature and curve. The local test invokes the upstream services `Signatures.validate` through the real settlement's `simulateDelegatecall` to verify this transaction context. Live order-book HTTP acceptance still requires an actual supported-network pool and funded tokens; it is not established by local simulation.

## Fees and revocation

`transferFee()` snapshots the trade from the pre-hook's balances and pays a fraction of `limit - curveBaseline` into the pool-specific escrow. Solver improvements above the limit remain with LPs. It checks exactly one reserve decreased and one increased. It consumes the pending flag before external transfers, pays at most once and leaves the settlement mutex held until transaction end. Omitting or reverting the post-hook leaves the fee with LPs.

The inverse curve quote and forward curve check use slightly different rounding. The fee is rounded down, and payment is skipped if subtracting it would fail the same forward curve used by `verify`. This conservatively favors LPs near rounding boundaries. There is no optional flat fee in this implementation.

Only the curator can raise `minEpoch` using `revoke`. Only the immutable creator can replace the curator with `setCurator`; the previous curator's unfilled signatures stop validating immediately. Both calls reject execution during a committed settlement. Earned fees remain in `feeEscrow.claimable(oldCurator, token)`. The curator withdraws them with `feeEscrow.withdraw(token, recipient)`, so an alternate recipient can be used when necessary. Pool tokens must be standard ERC20s, without transfer fees, rebases or callbacks.

## Validation

```sh
forge test --match-path 'test/unit/**'
forge test --match-path 'test/local/**'
forge test --match-contract BCoWPoolIsValidSignature --match-test test_HookGasEightTokens -vv
npm run local:chain  # separate terminal
npm run local:demo
npm run test:local:curator  # fee, curator replacement, revoke and withdrawal
```

Unit tests that directly call both hooks must keep those calls in the same transaction: do not use Foundry's `--isolate` for those unit tests. Real-settlement integration tests keep both hooks within one `settle` call and support isolation.

Eight-token hook budgets are 100,000 pre-hook gas and 150,000 post-hook gas. These values are part of canonical appData and cannot change for an existing pool. The gas test measures cold token reads at commit and warmed token reads plus a first escrow credit at payment. Recheck the budgets for any new token implementation, compiler configuration or curve-weight distribution.

Validation on November 25, 2026 (Foundry 1.4.4, solc 0.8.25, default optimizer settings):

- Unit suite: 288 passed, one existing skip, 1,000 fuzz runs per fuzz test.
- Local contracts: 19 passed, including the upstream signature validator simulation and skipped-post-hook settlement.
- Mainnet fork suite at block 20,012,063: 17 passed, two existing skips, using an archive RPC.
- Anvil: normal demo, curator fee/replacement/revocation/withdrawal, progressive rebalance, protective-fee liquidity checks, funded auction and independent historical verification passed.
- Eight-token hooks: 74,909 gas for commit and 99,776 gas for fee payment in the unit measurement; the real trampoline tests also enforce the canonical budgets.
- Default deployed bytecode: factory approximately 3.6 KB, pool approximately 22.4 KB, deployment module under 1 KB. Tests assert EIP-170 limits and preserved factory/controller/creator context.
- Solidity formatting, Solhint and NatSpec checks pass. Generated tracked smocks match regeneration. Bulloak 0.9.2 checks the updated standing-order tree, but its full legacy-tree check reports pre-existing test-name mismatches (reproduced from the original branch). Build validation sets `FOUNDRY_LINT_LINT_ON_BUILD=false`, consistent with the local scripts, because the repository's newer Forge lint reports existing unsafe-cast warnings with warnings denied.

A live order-book HTTP acceptance test and production deployment remain outside this local validation. No live pool or order was created.
