# Creator trading options

This revision keeps seven-asset proportional joins/exits and adds two independent trading settings. It requires new pool bytecode and a new factory deployment; it does not upgrade the already deployed Base factory or pools.

## Public swap fee

The creator chooses `publicSwapFee` in pool constructor settings, in Balancer's 1e18 scale. Values range from `MIN_FEE` (`1e12`, 0.0001%) through `MAX_FEE` (`1e18 - 1e12`, 99.9999%). The fee applies to ordinary `swapExactAmountIn` / `swapExactAmountOut` calls and remains with LP reserves. There is no mutable-fee window: `BCoWPool.setSwapFee` always reverts with `PublicSwapFeeIsFixed`, before and after finalization, including for the creator/controller. Ordinary `BPool` retains its existing pre-finalization setter.

Public swaps and CoW orders remain separate. CoW verification still uses the zero-fee curve. The immutable `curatorFeeBps` and limit-surplus escrow calculation are unchanged for curator-signed and solver-originated orders; they do not use the public swap fee. A curve-priced solver order can have no payable limit surplus. As before, omitting/reverting the fee post-hook leaves that fee with LP reserves; canonical appData alone does not force an on-chain solver to execute the post-hook.

## Opt-in unsigned solver orders

`solverOrdersEnabled` is initialized during creation (default false). Only the immutable creator can change it using `setSolverOrdersEnabled(bool)`. Changing the liquidity controller or the curator does not grant this authority. Policy changes reject execution while a settlement commitment holds the pool lock.

The ERC-1271 payload remains `abi.encode(order, epoch, curatorSig)`:

- A nonempty signature must recover the current curator, exactly as before. Enabling solver access does not make invalid curator signatures acceptable.
- An empty signature is accepted only if the pool opted in, `msg.sender` is the configured settlement contract, and `SOLUTION_SETTLER.authenticator().isSolver(tx.origin)` currently returns true.
- Both branches enforce the pending commitment, exact committed limit, canonical appData, order digest, minimum epoch, receiver, token pair, amount/curve, validity window, zero protocol `feeAmount` and fill-or-kill checks. The existing transaction-scoped lock and fee hook are unchanged.

The origin requirement deliberately implements the requested policy. An authorized solver contract whose transaction originates from a different, non-whitelisted address is excluded. The policy consults the live authenticator, so solver removal takes effect immediately. A creator can disable unsigned orders without disabling curator-signed orders.

Unsigned orders are intended for solver-built JIT settlement. Ordinary orderbook validation does not automatically supply a whitelisted transaction origin; enabling this option does not establish production orderbook acceptance or integrate/discover the pool in every solver. `BCoWHelper` returns an unsigned payload using the current `minEpoch`; the curator can sign it or an eligible solver can use it in the supported execution context. Epoch revocation rejects stale payloads; a solver can construct a fresh payload with the current epoch while solver access remains enabled. Use the creator toggle to disable that authority.

## Factory and frontend

The updated factory exposes `POOL_SETTINGS_VERSION() == 2`. The extended creation methods are:

```solidity
newBPool(name, symbol, curator, duration, curatorFeeBps, publicSwapFee, solverOrdersEnabled)
createPool(requestId, name, symbol, curator, duration, curatorFeeBps, publicSwapFee, solverOrdersEnabled)
```

Existing overloads remain available and choose `MAX_FEE` plus solver access disabled. Request IDs remain namespaced by creator, duplicate requests revert atomically, and creator/controller assignment and factory membership are preserved. New clients must not follow creation with a fee-setting transaction.

The Next frontend adds a fixed public-fee percentage field and an opt-in solver checkbox to creation. Both settings are persisted with the resumable browser draft. Details show the actual public fee and solver policy; the creator can enable/disable solver access, but cannot edit fees. The curator's strict MAG7 snapshot check now accepts valid low-fee pools instead of requiring the protective fee. Standing orders are still checked against live balances, so public trades can make outstanding quotes unexecutable.

The frontend detects older factories. It can still create/resume protective, curator-only legacy pools using the previous ABI and initialization sequence. Requests for custom fees or solver access fail before a creation transaction or draft is submitted when the configured factory lacks support. Older pools remain readable and display no solver toggle.

No USDC entry/exit, basket intents, smart accounts, hooks for user liquidity, or new user signing flows are included. Deposits and withdrawals still require/return all constituent tokens.

## Validation and migration

Coverage includes fee bounds, immutability before/after finalization and after controller replacement, low-fee public swaps, unchanged CoW fee calculation, creator-only solver policy, authenticated/unauthenticated origins and callers, live solver revocation, invalid signatures/epochs/curves/hooks, commitment locking, and actual unsigned settlement through pinned CoW contracts locally and on a mainnet fork. The browser journey creates a 0.3% public-fee pool with solver access, tests setup recovery, checks strict curator snapshots, and toggles solver access without changing the fee. Existing all-asset LP flows remain covered.

The existing legacy helper fuzz failure for tiny quotes rounding to zero remains reproducible and is separate from these changes. See the PR validation results for current suite counts.

Review and deploy the new factory before configuring it for the new options. Keep the current `.env` and existing production deployment unchanged until that deployment is explicitly authorized. Source verification inputs exported for the old Base deployment continue to describe that old version, not this revision.
