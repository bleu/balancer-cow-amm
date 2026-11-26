# Base MAG7 demo

A wallet frontend and a single-process curator service for the [demo plan](../docs/base-mag7-demo.md). Uses production CoW's Base API and the native B20 stock tokens. The default configuration displays setup instructions: no funded Base factory or pool is bundled.

The frontend creates and resumes pools, recovers abandoned seed assets, imports pools by address, joins/exits proportionally, reads reserves and current curator fees, and lets the creator replace the curator. Financial state comes from RPC. Creation addresses come from `factory.createdPool(creator, requestId)`, without log scanning or receipt event decoding.

## Frontend stack

The frontend lives in `demo/web`: Next.js App Router, React, strict TypeScript and Tailwind CSS. Wagmi manages injected-wallet connections and account/network changes; viem reads, simulates, estimates and submits contract transactions. TanStack Query caches and refreshes API reads. Shared basket math and ABI definitions live in `demo/lib/shared.mjs` with TypeScript declarations.

`pnpm dev` (Base) and `pnpm dev:local` (Anvil) run the Next development server with live reload. A single Node process serves Next pages, the existing read-only `/api/*` routes and the curator loop. Wallet transactions go through the injected wallet. Next builds do not start the curator or contact RPC/price services, and no signing key or RPC credential is bundled into the frontend.

For production:

```sh
pnpm demo:build
pnpm demo:start                   # loads .env
# Or pnpm demo:start:local for an explicit local production-build preview.
```

`pnpm demo:typecheck` checks the frontend without emitting JavaScript. Next build output and generated types are ignored in `demo/web/.next`.

## Local demo

Requires Node **22.9+**, pnpm 10, Foundry and the repository dependencies.

```sh
asdf install                     # selects Node 22.9.0 from .tool-versions
node --version                   # must be v22.9.0 or newer
corepack enable                  # enables the pinned pnpm version
pnpm install --frozen-lockfile
pnpm prepare                     # installs Git hooks explicitly
pnpm local:chain
```

In another terminal:

```sh
pnpm demo:local:deploy
pnpm dev:local
```

Open <http://127.0.0.1:3000>. This explicitly labeled Anvil fixture uses synthetic prices and test stocks with mixed decimals. Import an Anvil test account into a development wallet, use chain 31338 / RPC <http://127.0.0.1:8546>, and fund its stock balances using `LocalStockToken.mint`. The fixture's manager already has stocks and ETH. Never use those public test keys for Base. `.local/` artifacts are ignored.

The local fixture does not call production CoW for order history and is not enrolled in live curation. The separate existing `pnpm test:local:settlement` exercises real pinned settlement bytecode locally.

## Configure Base

1. Copy `.env.example` to `.env` and set the demo environment variables there (or inject them through your host). Configure `BASE_RPC_URL` for a Base RPC supporting ordinary reads and simulations. `pnpm dev` loads `.env`; no JSON configuration file is used or served to the browser.
2. Deploy the **new** factory version supporting request IDs. `DEPLOYER_ADDRESS=0x... pnpm demo:deploy:base` outputs an unsigned deployment transaction. Inspect that transaction and its admin/production settlement/trampoline addresses. Only an explicit `pnpm demo:deploy:base --broadcast`, with `DEPLOYER_PRIVATE_KEY`, submits it. The deployer needs Base ETH. `FACTORY_ADMIN` defaults to the deployer. Deployment writes a public receipt to `.local/base-factory.json`.
3. Set `DEMO_FACTORY_ADDRESS` and the server curator's **public** `CURATOR_ADDRESS` in `.env`. Start the app with `CURATOR_LIVE=false`. Use the creation flow to seed/finalize a MAG7 pool from a wallet holding all seven native B20 assets. The preset uses Folio weights: 20/15/15/15/15/10/10. Finalized pools use a protective `MAX_FEE` for direct swaps. Initial LP supply is the contract's fixed 100 shares; the USD seed helper only suggests constituent amounts.
4. Inspect the pool's finalized state, assets, weights, curator, order duration, relayer allowances and intended seed allocation. Add its address explicitly to **both** `DEMO_POOLS` and `CURATOR_POOLS`, then restart. `DEMO_POOLS` publishes the catalog; `CURATOR_POOLS` enables evaluation. Production config rejects public entries missing from the watchlist. An on-chain curator address alone never enrolls a pool. A user's creation is stored only in their browser until this operator action.
5. Put `CURATOR_PRIVATE_KEY` in the service environment; it must match `CURATOR_ADDRESS`. Run one process per signing key/watchlist. With `CURATOR_LIVE=false`, the service prepares and verifies candidates but never signs or posts them. After reviewing real token behavior and executable hook-aware quotes, set `CURATOR_LIVE=true` to enable order submission. The key needs no user seed assets and is never sent to the client.

Use the factory deployed by this branch; an existing factory does not gain `createdPool` automatically. Clearing browser storage removes local discovery and initialization drafts, not assets or deployed contracts. Save pool addresses/request IDs for recovery. Importing an address validates configured factory membership. Initialization recovery requires the original controller wallet.

## Environment settings

`.env.example` lists every supported setting and its default: network/RPC/explorer, factory and curator addresses, CoW API URL, both pool lists, timing, drift/fees/slippage, sizing and confirmations. Empty addresses keep the frontend in setup mode. `DEMO_CONFIG` is removed; migrate any previous JSON fields to these variables.

Pool lists use JSON arrays inside a single-quoted environment value:

```dotenv
DEMO_FACTORY_ADDRESS=0xYourFactory
CURATOR_ADDRESS=0xYourCurator
DEMO_POOLS='[{"address":"0xYourPool","name":"MAG7"}]'
CURATOR_POOLS='[{"address":"0xYourPool"}]'
```

The local deploy script generates `.local/demo.env` with public fixture addresses, `DEMO_LOCAL_ASSETS` and `DEMO_FIXTURE_PRICES`. `pnpm dev:local` loads that file directly, so copying it over your Base `.env` is unnecessary. Synthetic assets/prices are only accepted with `DEMO_LOCAL_DEV=true` and a local chain ID; live posting is refused in that mode. Runtime environment variables take precedence over values loaded from env files. Never export production curator variables into a local fixture process.

## Curator operation

Every approximately one hour, the service reads reserves at one block and caches CoinGecko token USD prices. It ranks all seven assets by absolute allocation gap, processes candidates from largest gap downward, and rereads after each confirmed fill or expiry. Each order is fill-or-kill, zero protocol `feeAmount`, with at most 180 seconds of validity and canonical pre/post hooks from the shared contract signing helper. The demo has a stricter **one active order across the whole worker** guard. A process must not be replicated.

The drift floor is strictly **greater than $0.10**. Sizing starts with the smaller paired gap, caps sell quantity by the pool ratio, and halves up to eight times. The pool curve, a final hook-aware CoW quote, estimated execution cost (including the quote's fee) and projected net allocation improvement all have to pass. `CURATOR_LIMIT_BUFFER_BPS=10` gives 0.1% limit headroom; live mode also requires the final API response's `verified: true`. Bad/missing/stale prices, unverified quotes and changed curator/epoch stop signing. Native B20 liquidity can still make a candidate unexecutable.

The default curator fee is **100 bps (1%) of contract-defined limit surplus**, displayed before pool creation. `CURATOR_FEE_BPS` selects it for new pools; existing pools retain their on-chain setting. The worker includes a conservative fee bound in its cost/drift checks. It does not claim escrow fees automatically. Current claimable amounts for the current curator are direct reads; an old curator can still withdraw its own accrued fees from escrow.

CoinGecko's keyless endpoint currently limits calls to one contract address. The price client attempts a batch, then remembers this limitation and fetches the seven assets sequentially with spacing, once per hour. An optional free Demo `COINGECKO_API_KEY` stays server-side. Browser visits only read the cache. `COINGECKO_MAX_AGE_SECONDS=1800` applies to upstream update times, independently of cache fetch time. Missing/stale market data pauses trading; stale reference values are labeled in the UI. Each successful price fetch is used without adding another B20 share multiplier.

No database or persisted signing ledger is used. On restart, the worker waits until chain time exceeds startup time plus 180 seconds before signing. An uncertain POST keeps the exact signed UID guarded until a canonically confirmed fill or strict expiry; it never immediately signs a replacement. A fill requires orderbook fulfillment plus confirmed canonical transaction receipts. CoW API history provides activity; structured stdout and in-memory `/api/status` provide operational status. Restarting loses logs/status unless the host captures stdout. There is no historical NAV/performance chart.

`kill -USR2 <server-pid>` toggles posting pause. Pausing does not revoke an already signed order. The immutable creator can replace the curator from the UI; this invalidates the previous signer's signatures. After replacement, update the server environment/config and restart before curation resumes. Receipt confirmation depth defaults to two blocks.

The HTTP service binds to `127.0.0.1` by default. Put a public deployment behind TLS/reverse proxy and set `DEMO_HOST` as needed. Its API exposes a bounded RPC read/estimate allowlist; it rejects log queries, tracing, arbitrary writes and signing requests. Wallet transactions go through the user's wallet. RPC credentials and the curator key are omitted from browser configuration. There are no API endpoints to mutate either whitelist.

## Validation

```sh
pnpm demo:build                    # production Next build + TypeScript checks
pnpm demo:typecheck                # standalone strict frontend typecheck
pnpm test:demo                     # deterministic service/math/signing/security tests
pnpm test:demo:local               # requires the deployed Anvil fixture; real pool curve + quote stub
pnpm test:local:settlement         # pinned CoW settlement, seven-asset pool

# With the local server running; browser binaries installed once:
pnpm playwright install chromium
DEMO_BROWSER_URL=http://127.0.0.1:3000 pnpm test:demo:browser
# Or set BROWSER_EXECUTABLE to a local Chromium/Chrome executable.

# Read-only Base simulation; RPC must support eth_call state overrides:
pnpm demo:probe:b20
```

The browser journey mints **local** stocks, deposits, withdraws, interrupts pool initialization, recovers seeded assets, resumes/finalizes the same pool, reloads it, verifies a second browser cannot discover it, and checks mobile overflow. It refuses any network/configuration other than the explicit local fixture. Screenshots go to `.local/demo-desktop.png` and `.local/demo-mobile.png`.

The native B20 probe uses actual Base token implementations and balances, with ephemeral source/harness code overrides only. It covers all seven tokens through allowance, binding, finalization, LP join/exit, real pinned vault-relayer transfers, capped trampoline hooks, curator fee credit and escrow withdrawal. **It never sends a transaction.** The source helper is deliberately unsafe test code: never broadcast `script/demo/B20Probe.sol`.

The measured run at Base block 62,513,466 passed all seven sell/buy rotations: pre-hook 12,198 gas and post-hook 71,752–88,761 gas, including trampoline overhead, against 100k/150k caps. These are **warm setup-state** measurements, not cold settlement proofs. Re-run the probe against current state; exact block/hash/results are written to `.local/b20-probe.json`.

A real production quote endpoint was exercised read-only, but funded production order acceptance/fill has **not** been demonstrated. Before using funds, complete the plan's cold-gas measurements, policy/restriction and share-multiplier scenarios, and a small funded Base end-to-end fill. Neither a quote stub nor state overrides prove live solver liquidity. The default unset `DEMO_FACTORY_ADDRESS` / empty catalog makes that deployment prerequisite visible.

Validation note: the full Foundry unit run produced 290 passes, one skipped test and one existing failure in `BCoWHelperTest.test_OrderFromBuyAmountWhenThePoolIsSupported`: a tiny amount rounds the helper's sell amount to zero and pool verification rejects it with `InvalidTradeDeltas`. The identical saved counterexample reproduces on the unchanged base commit `2fef388`. The demo constructs its own orders, rejects zero-sized candidates and validates the real pool curve; it does not use this legacy helper path. The new request-ID contract tests and demo tests pass.

Local deployment gas snapshots were refreshed: factory creation 7,117,061 gas and pool creation 5,038,588 gas (default optimizer settings, isolated local measurement). The UI simulates and estimates each wallet transaction before submission. Displayed execution fees exclude the additional Base L1 data fee; wallet confirmation provides the final transaction estimate. These local gas counts do not establish production token hook budgets.
