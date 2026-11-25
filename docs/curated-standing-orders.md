# Curated Standing Orders for CoW AMM

Nov 25, 2026 · Jean Neiverth · [Claude Doc](https://claude.ai/artifact/Md9VdZ8YBNfXc5nz5boyxo)

## Summary

A trusted curator signs the pool's CoW orders off-chain and posts them to the CoW order book as ordinary ERC-1271 orders. It earns 1% of how far each order's limit beats the pool's curve. The curator sends no on-chain transaction per order.

Each order's appData carries two hooks. A pre-hook, `commit(h0, buyAmount)`, ties the settlement to that one order. A fixed post-hook, `transferFee()`, pays the curator in the same transaction. The pool derives the only valid appData for each order on-chain, so the lock always identifies exactly one order. Solvers need no CoW AMM-specific code, because drivers add appData hooks to settlements automatically.

The curve check in `verify` stays. Together with the per-order lock, it means no curator, stolen curator key or solver can make the pool trade below its curve. The curator is trusted only for price quality and timing.

## Problem

Solvers rarely trade with CoW AMM pools because building the pool's order is their job, and it is awkward. A solver has to:

1. Read the pool's current reserves and work out a curve-valid order inside its own solution, usually with `BCoWHelper.order()`.
2. Add a `commit(orderHash)` call before the trades in its settlement, since `isValidSignature` only accepts the committed order (`src/contracts/BCoWPool.sol:77`).
3. Make sure only one of the pool's orders is in the batch, because `commit` holds a single hash per settlement.

None of this applies to ordinary user orders. In practice, solvers have not built it, so pools sit idle while the market moves.

CoW's built-in CoW AMM support doesn't cover multi-token pools such as M7 either:

- The deployed `BCoWHelper` rejects pools that don't have exactly two tokens, so CoW's autopilot can't index them.
- A helper that supports more tokens would need CoW to add its factory to the autopilot configuration.
- The autopilot leaves a pool out of an auction when any of its tokens lacks a native price. That would happen often for thin tokens such as tokenized stocks.

## Goals and non-goals

**Goals**

- Solvers trade with the pool without any CoW AMM-specific code.
- The curator sends no on-chain transaction per order.
- No curator, stolen curator key or solver can make the pool trade below its curve, enforced on-chain.
- Someone outside CoW and the solvers is paid to keep the pool's order current.
- No forced settlement reverts in normal operation.

**Non-goals**

- Permissionless order placement. The curator is a single trusted address.
- Protection against a curator who trades ahead of the pool or delays it on purpose. LPs can exit at no fee.
- Changes to pool math, weights or the protective direct-swap fee.

## Design overview

| Part | Role |
| --- | --- |
| Curator | Trusted address, set by the pool creator, who can replace it. Signs orders off-chain, posts them to the order book, earns the fee. |
| `commit(h0, buyAmount)` pre-hook | Ties the settlement to one order. Records the order's limit and the pool's pre-trade balances. |
| `isValidSignature` | Accepts only the committed order, with its derived appData and a valid curator signature. Still runs `verify`. |
| `transferFee()` post-hook | Measures the trade from the pool's balance changes and pays the fee to escrow in the same transaction. |
| Escrow | A separate contract that holds earned fees until the curator withdraws them. |

Several curator orders can be live at once, and that is safe for the curve. `verify` checks each fill against the reserves at that moment, and the lock allows only one pool order per settlement. The lock is needed because GPv2Settlement checks every signature before moving any tokens. Without it, two pool orders in one batch would both be checked against the same starting reserves, and together they could take more than the curve allows.

## How a settlement runs

```
GPv2Settlement.settle
 ├─ interactions[0]: HooksTrampoline.execute(pre-hooks)
 │    └─ pool.commit(h0, buyAmount)       lock = h0; limit and balances to transient storage
 ├─ computeTradeExecutions
 │    └─ pool.isValidSignature(hash, sig) lock, appData, curator signature, verify
 ├─ transfers in, interactions[1], transfers out
 └─ interactions[2]: HooksTrampoline.execute(post-hooks)
      └─ pool.transferFee()               fee from balance changes → escrow
```

The lock stays set until the transaction ends. `joinPool`, `exitPool` and direct swaps revert for the rest of the transaction, so nobody can change the reserves during the settlement.

Drivers convert appData hooks into `HooksTrampoline.execute` interactions. The trampoline can only be called by the settlement, and it ignores hook failures. A solver that leaves out the pre-hook can't fill the order, because the lock is empty. A solver that leaves out the post-hook fills the order, but the fee is forfeited to LPs.

## Contract changes

All changes are in `BCoWPool`, plus a new escrow contract. Pool math, `BPool` swaps and `BCoWHelper` are unchanged.

| Function | Caller | Behaviour |
| --- | --- | --- |
| `commit(h0, buyAmount)` | HooksTrampoline or settlement | `_viewlock_`, so a second commit in the same transaction reverts. Sets the lock to `h0`. Stores `buyAmount`, a pending flag and all token balances in transient storage. Moves no tokens. |
| `isValidSignature(hash, sig)` | Settlement | Decodes `(order, epoch, curatorSig)` and requires everything listed below, then runs `verify`. |
| `verify(order)` | Anyone (view) | Existing checks, plus `partiallyFillable == false` (fill-or-kill) and `validTo <= block.timestamp + orderDuration`. |
| `transferFee()` | HooksTrampoline or settlement | Only while a commit is pending, and it clears the flag before transferring, so it pays once. Uses no `_lock_` or `_viewlock_`. Requires exactly one token out and one token in. Pays the fee to escrow. |
| `revoke(newMinEpoch)` | Curator | Raises `minEpoch`, which invalidates every live order signed with a lower epoch. |
| `setCurator(newCurator)` | Pool creator | Replaces the curator immediately. Every live order signed by the old curator stops validating, because `isValidSignature` checks the signer against the current curator. |

`isValidSignature` requires:

1. `h0`, the order's EIP-712 hash computed with `appData` set to zero, equals the lock, and `order.buyAmount` equals the stored `buyAmount`.
2. `order.appData == F(h0, buyAmount)`, the hash of the canonical appData described below.
3. `order.hash(domain) == hash`.
4. `curatorSig` is the curator's EIP-712 signature over the order hash and `epoch`, with the pool and chain in the signing domain, and `epoch >= minEpoch`.

`register`, `cancel`, the active-order slot, `settlePending()` and the `APP_DATA` constant are removed. The HooksTrampoline address is a constructor argument, kept as an immutable, and `commit` and `transferFee` accept it as caller. It is `0x60Bf78233f48eC42eE3F101b9a05eC7878728006` on mainnet, Arbitrum, Base and most other chains. On Gnosis the order book uses an older trampoline, `0x01DcB88678aedD0C4cC9552B20F4718550250574`. Both are immutable, have no admin, and accept calls only from the settlement `0x9008D19f58AAbD9eD0D60971565AA8510560ab41`, checked on-chain on mainnet, Gnosis, Arbitrum and Base. The `MAX_ORDER_DURATION` constant (`src/contracts/BCoWConst.sol:14`, 5 minutes) becomes the upper limit on `orderDuration`, checked at creation.

**Settings**

The pool creator (whoever deploys the pool) sets these at deployment. Only `curator` can change afterwards, through `setCurator`. The rest are immutable.

- `orderDuration`: maximum order lifetime. `isValidSignature` (through `verify`) rejects any order with `validTo > block.timestamp + orderDuration`. The constructor requires `MIN_ORDER_DURATION <= orderDuration <= MAX_ORDER_DURATION`. The lower bound exists because the order book rejects orders with `validTo` less than its minimum validity period ahead (60 s by default, 120 s in some deployments). An order must satisfy both checks when it's created, so `orderDuration` must be above the order book's minimum, plus room for latency. Something like 3 minutes.
- `curatorFeeBps`: the curator's share of the surplus, 100 = 1%. Must be below 100% at creation, so the pool stays at or above its curve after paying the fee.
- `curator`: the trusted address that signs orders. Mutable by the creator.
- `creator`: the deployer, immutable. The only address allowed to call `setCurator`.
- Optional flat fee per fill, capped at the order's surplus, for small pools.

## Order appData

The pre-hook can't contain the order hash or UID, because the hash covers the appData and the appData would contain the hash. `commit` therefore takes `h0`, the order hash with `appData` set to zero, which the curator can compute before the appData exists.

On its own, `h0` doesn't identify one order: two orders that differ only in appData would share it, and both could settle against one commit. To prevent that, the pool accepts only one appData for each `h0`. It builds the canonical appData JSON from a fixed template on-chain and requires `order.appData` to equal its keccak hash:

```
F(h0, buyAmount) = keccak256(
  {"version":"1.6.0","appCode":"Bleu CoW AMM","metadata":{"hooks":{
    "pre":[{"target":"<pool>","callData":"<commit(h0, buyAmount)>","gasLimit":"100000"}],
    "post":[{"target":"<pool>","callData":"<transferFee()>","gasLimit":"150000"}]
  }}}
)
```

The line breaks above are for reading only. The real document has no whitespace, keys in exactly this order, lowercase hex with a `0x` prefix, and gas limits as decimal strings. CoW's backend reads only `metadata.hooks`. `version` and `appCode` are there for CoW's schema and tools: `appCode` labels the pool's orders in CoW's explorer and analytics.

`version` is the version of CoW's appData schema, not of this project. The backend never reads it (`crates/app-data/src/app_data.rs`), but CoW's SDK and explorer validate documents against the published schema. `1.6.0` is the latest published version (`@cowprotocol/app-data` 3.3.1), and its `hooks` schema allows exactly `target`, `callData`, `gasLimit` and an optional `dappId`. `0.1` isn't a published version, and `0.1.0` has no `hooks`.

**Gas limits.** `G_pre = 100000` and `G_post = 150000` are provisional. They are compile-time constants, because they are part of the hashed document. Changing them means a new pool. The limit is only a reservation: solvers pay for gas actually used, but the trampoline wastes all gas if less than the limit is available. Estimates for an 8-token pool:

- `commit`: about 50k. That covers one `balanceOf` per token, mostly cold the first time (about 5k each), plus a few transient stores.
- `transferFee`: about 40–60k. That covers warm `balanceOf` calls, one token transfer to escrow and one escrow storage write.

Too low a `G_pre` makes every order unfillable, since the commit never happens. Too low a `G_post` makes the post-hook fail silently, and the curator loses the fee. Generous limits cost nothing extra.

**Building F on-chain.** A prototype (`.scratch/appdata-proto`, run with `forge test` there) builds the document like this:

- The constant text, the `commit` selector (`0xe900ead8`) and the full `transferFee()` calldata (`0xacb2ad6f`) are string literals.
- The pool's address in hex is computed once in the constructor and kept in two immutables.
- At call time, only `h0` and `buyAmount` are converted to hex, with a branch-free routine that handles 16 bytes per step.

`F` costs about 3.1k gas, against about 31k for a byte-by-byte loop. The document is 412 bytes, well under the 8192-byte limit. The hash matched a document built off-chain with `cast` byte for byte, so the curator's tooling can rebuild it independently.

Each `h0` then corresponds to exactly one valid order, so committing to `h0` identifies the order as precisely as committing to its hash. Two orders with the same fields have the same appData and the same UID, and GPv2's `filledAmount` stops a second fill.

The exact JSON bytes, including the schema version, key order and whitespace, must match what the curator uploads to the order book, because the order book checks `keccak256(fullAppData) == appData`.

## Order lifecycle

1. The curator chooses a pair, a sell amount and a limit, using any price source it wants. The contract's only price constraint is the pool's curve.
2. It computes `h0`, builds the canonical appData and signs the order hash with the current epoch.
3. It uploads the appData and posts the order to the order book with `from = pool` and `signingScheme = eip1271`.
4. A solver includes the order, and its driver adds the hooks.
5. The order ends when it fills, when `validTo` passes, or when `minEpoch` is raised above its epoch.

CoW's order book can't cancel ERC-1271 orders through its API, which only accepts ECDSA cancellation signatures. Orders end by expiring or by an on-chain `revoke`. Short `validTo` values keep stale orders rare. The autopilot doesn't re-check ERC-1271 signatures in each auction, so an order that has become invalid stays listed until `validTo`, and solvers' simulations reject it.

## Curator fee

The curator earns a share of how far the order's limit beats the pool's curve, paid in the token the pool bought:

```
fee = curatorFeeBps × (buyAmount − baseline)
```

`buyAmount` is the order's limit, stored by `commit`. The baseline is the curve's minimum `buyAmount` for the amount sold, computed from the pre-trade balances that `commit` recorded. For example, if the curve gives 2,000 USDC for 1 ETH and the curator signs 1 ETH → 2,100 USDC, the fee is 1% × 100 = 1 USDC.

- **Based on the limit, not the execution price.** Solver surplus above the limit goes entirely to LPs.
- **Size can't be gamed.** At a given limit, the surplus peaks near the healthy rebalance size, so oversized orders earn less.
- **Only real fills pay.** `transferFee()` pays only when the balance changes show one token out and one token in after a pending commit.
- **The curve still holds after the fee.** The fee is at most a fraction of the surplus over the baseline, rounded down, so the pool keeps at least the baseline.
- **A skipped hook forfeits the fee to LPs.** No fallback is needed, and no fee is left pending for exiting LPs to take.
- **No per-order gas for the curator.** Solvers pay for both hooks, which comes out of the order's surplus. This is small on an L2.

`transferFee()` sends the fee to the escrow contract and credits it to whoever is curator at that moment, so fees already earned stay with the old curator after `setCurator`. It never pays the curator directly, so a blocklisted curator address can't block settlements. The escrow has to be outside the pool, because `verify` and `exitPool` both read `balanceOf(address(this))`.

## Trust model and security

The curator is trusted for when the pool trades and for keeping orders confidential. The pool creator is trusted to appoint a good curator and to keep its own key safe: `creator` is immutable, so a lost creator key means the curator can't be replaced, and a stolen one can appoint a hostile curator. The curve is enforced by the contract. Solver competition protects the price above it.

**What a curator can't do**

- Make the pool trade below its curve, even with a stolen key. The per-order lock and `verify` enforce it.
- Inflate its fee through order size, or by exiting and rejoining as an LP.
- Churn trades for fees. If prices don't move, no order above the curve can fill.
- Be paid for an order that didn't fill.

**Why the curve can't be broken**

- The lock covers every order field that `verify` relies on, and the derived appData makes it unique to one order.
- After `commit`, tokens can leave the pool only through this trade. Joins, exits and swaps revert, and the vault relayer only moves tokens for orders the pool accepts.
- Anything a solver does before `commit`, such as a join or a direct swap at the protective fee, changes the reserves for real, so checking the curve against them is correct.
- `transferFee()` pays once at most, only after a matching trade, and at most a fraction of the surplus over the curve.
- Pool tokens must be standard ERC-20s. Fee-on-transfer tokens, rebasing tokens and tokens with transfer callbacks would break `verify`'s assumptions.

**Remaining risks**

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Several live orders | With thin solver competition, a solver fills the live order with the lowest limit and keeps the difference. | Short `validTo`, `revoke`. |
| Curator stops posting | Pool can't rebalance. No value leaks, since direct swaps carry the protective fee. | Visible to LPs, who can exit at no fee. The creator replaces the curator. |
| Trading ahead of the pool | On large pools, the curator profits from the pool's own effect on the price. | Trust. Grows with pool size relative to market depth. |
| Strategic delay | The curator holds back rebalances when that suits it. | Trust. There is deliberately no per-order fee cap. Over time the total fee is roughly the same whether it rebalances often or rarely. |
| Stolen curator key | Can't break the curve. Can sign poor prices, down to the curve. | The creator calls `setCurator`, which invalidates the stolen key's live orders at once. Orders last at most `orderDuration`. |
| Creator appoints a bad curator | Same as a stolen curator key. | Trust in the creator. LPs exit at no fee. |
| Curator prices from a stale source | For tokenized stocks, orders signed while the market is closed may be far from the price when it reopens. | Off-chain: the curator stops posting while the market is closed and keeps `validTo` short. |
| Post-hook not run | That fill pays no fee. | Generous hook gas limit. Safe for LPs. |
| Protocol fee | The pool's orders are ordinary limit orders, so CoW's protocol fee applies. | A cost to LPs. Check CoW's current fee policy. |

## Alternatives considered

The design started with permissionless order placement. Each attempt to make an open placer market safe added a mechanism, and a trusted curator removed the need for all of them. Moving the curator's orders off-chain then removed the per-order transaction.

| Alternative | Why it was dropped |
| --- | --- |
| Anyone can place orders, first come first served | An order that can't fill locks the slot, and placers who do the work get copied. |
| Grace period plus minimum overbid | Freezing still costs the attacker only one transaction per order duration, and an attacker with a financial motive will pay it. |
| Reputation score per placer | New accounts start at 0, so negative scores never bind. Score is cheap to farm. |
| Locked BPT as priority | Joining and exiting is free (`EXIT_FEE = 0`), so a flash loan can supply the balance unless it's locked. |
| Fixed schedule of bid, score and stake phases | The last-block bid wins or gets copied, and the builder of the bid block can censor bids. |
| On-chain `register` of each order | One transaction per order. With a pure 1% fee, the curator needs a price move about 10 times larger than a solver needs before its fee covers its gas. |
| Fixed appData with a constant `commit()` | The lock can't tell orders apart, so two orders can be filled in one batch. |
| Order hash or UID in the pre-hook | Circular: the hash covers the appData, which would contain the hash. |
| `h0` lock without deriving the appData | Two orders that differ only in appData share a lock, so curve safety would depend on the curator never signing such a pair. |
| No pre-hook | Joins and exits work in the middle of a settlement, after the pool's tokens leave and before its proceeds arrive, so a solver can take LP value. |
| Lazy fee claim using `filledAmount` | Solvers can wipe `filledAmount` after expiry with `freeFilledAmountStorage`, and exiting LPs take unclaimed fees. |
| Payment only by post-hook, with no commit-time snapshot | The post-hook can't learn the order or the pre-trade reserves. The snapshot in `commit` fixes this. |

## Open questions

- [ ] **Measured hook gas.** Replace the provisional `G_pre` and `G_post` with measured values plus a safety margin, once `commit` and `transferFee` are implemented. Use an 8-token pool with cold tokens.

Resolved:

- **AppData `version`.** Use the published schema version `1.6.0`. Building `F` on-chain is cheap, about 3.1k gas (see Order appData).
- **Order-book acceptance.** For an ERC-1271 order with pre-hooks, the order book runs `Signatures.validate` through `settlement.simulateDelegatecall` (`crates/signature-validator/src/simulation.rs`, `contracts/solidity/Signatures.sol`). That executes the trampoline-wrapped pre-hooks from the settlement's address and then calls `isValidSignature` in the same transaction, so the commit's transient lock is visible. The order is accepted if `commit` accepts the trampoline as caller and the order passes `verify` against the current balances. Constraints found along the way:
  - `orderDuration` must be above the order book's minimum validity (see Settings).
  - Out-of-market limit orders count toward 10 live orders per owner.
  - The post-hook isn't simulated at creation.
  - Still to confirm end to end against CoW's staging order book.
- **HooksTrampoline address.** Addresses and on-chain checks are under Contract changes.

## Testing plan

- Unit tests for `commit`, `isValidSignature`, `transferFee()` and `revoke`, including every allowed and refused path.
- `commit` through the HooksTrampoline. A second commit in the same settlement leaves the second order invalid.
- Two orders that differ only in appData can't both settle.
- `F(h0, buyAmount)` on-chain matches the off-chain appData builder byte for byte. Start from the prototype in `.scratch/appdata-proto`.
- Gas of `commit` and `transferFee()` on an 8-token pool with cold tokens, to set `G_pre` and `G_post`.
- The constructor rejects `orderDuration` outside `[MIN_ORDER_DURATION, MAX_ORDER_DURATION]` and `curatorFeeBps >= 100%`. Only `creator` can call `setCurator`, and after it the old curator's live orders stop validating.
- `transferFee()` pays at most once, only after a matching trade, and the pool stays at or above its curve after the fee. Fuzz across mixed decimals and all 42 pair directions of the M7 pool.
- With the post-hook skipped, the trade settles and no fee is paid.
- Joins, exits and swaps revert after `commit` in the same transaction.
- Local settlement through real CoW contracts on Anvil, reusing the `local:demo` setup, with the hooks run through a deployed HooksTrampoline.
- End-to-end order-book acceptance, using the services e2e setup or CoW's staging order book. Post an order with the derived appData and `validTo` near `orderDuration`.

## Sources

- [CoW hooks reference](https://docs.cow.fi/cow-protocol/reference/core/intents/hooks)
- [CoW orderbook API spec](https://github.com/cowprotocol/services/blob/main/crates/orderbook/openapi.yml), for the cancellation signing schemes
- [GPv2Settlement.sol](https://github.com/cowprotocol/contracts/blob/main/src/contracts/GPv2Settlement.sol), for the settlement order of operations, `filledAmount` and `freeFilledAmountStorage`
- [GPv2Signing.sol](https://github.com/cowprotocol/contracts/blob/main/src/contracts/mixins/GPv2Signing.sol), for the signing schemes and the ERC-1271 call
- [HooksTrampoline.sol](https://github.com/cowprotocol/hooks-trampoline/blob/main/src/HooksTrampoline.sol), for settlement-only calls and ignored hook failures
- [EIP-1271](https://eips.ethereum.org/EIPS/eip-1271)
- CoW services: `crates/shared/src/order_validation.rs` for hook conversion and the creation-time signature check, and `crates/autopilot/src/solvable_orders.rs` for skipped ERC-1271 re-validation and CoW AMM indexing
