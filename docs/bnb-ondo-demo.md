# BNB Chain / Ondo MAG7 demo

The demo now supports BNB Smart Chain (56) with Ondo Global Markets stocks, retaining the Next/React/TypeScript/Tailwind/wagmi/viem frontend and single-process curator. `.env.example` defaults to BNB; the existing private `.env` is intentionally left on Base until a BNB factory is deployed. No production transaction or order was submitted for this migration.

## Assets and unchanged behavior

The seven contracts below were checked against [Ondo's official registry](https://github.com/ondoprotocol/ondo-global-markets-token-list/blob/main/tokenlist.json) and RPC metadata. All have 18 decimals. The pool's unchanged minimum of 1,000,000 raw units is therefore 0.000000000001 tokens.

| Token   | Weight | BNB contract                                 |
| ------- | ------ | -------------------------------------------- |
| NVDAon  | 20%    | `0xA9eE28C80f960B889dFbd1902055218cBa016F75` |
| MSFTon  | 15%    | `0x6Bfe75D1ad432050eA973C3A3DcD88F02e2444C3` |
| AAPLon  | 15%    | `0x390a684EF9cADE28A7AD0DFa61AB1Eb3842618c4` |
| AMZNon  | 15%    | `0x4553cFe1C09f37f38b12dC509F676964e392F8Fc` |
| GOOGLon | 15%    | `0x091FC7778e6932d4009B087B191D1EE3bac5729A` |
| METAon  | 10%    | `0xD7dF5863A3e742F0c767768cDfcb63f09E0422f6` |
| TSLAon  | 10%    | `0x2494b603319d4D9F9715c9f4496d9E0364B59d93` |

Deposits and withdrawals still use all seven assets. Pool discovery remains a whitelist plus chain-scoped browser cache and direct RPC reads; there is no database, indexer or log discovery. Public fees are fixed at deployment, separate from CoW fees. Creator-controlled solver opt-in remains unchanged. The curator retains hourly evaluation, descending correction priority, three-minute validity, one active curator order, and its existing cost/curve/freshness checks.

`demo/lib/networks.mjs` owns the pinned network/asset profiles. The selected assets are supplied consistently to the client, strict pool validation and pricing. `RPC_URL` is server-only. Wallet network addition uses a public RPC URL and BNB currency metadata, never the private server RPC. Explicit Base configuration remains supported, including the old `BASE_RPC_URL` variable for Base/local fixtures. Wrong production CoW network paths are rejected.

## BNB configuration

Keep secrets in `.env`. When the BNB factory has been deployed, update these entries together:

```dotenv
DEMO_CHAIN_ID=56
DEMO_NETWORK_NAME=BNB Smart Chain
RPC_URL=https://bsc-rpc.publicnode.com
DEMO_EXPLORER_URL=https://bscscan.com
COW_API_URL=https://api.cow.fi/bnb/api/v1
DEMO_FACTORY_ADDRESS=<new BNB factory>
CURATOR_LIVE=false
DEMO_POOLS='[]'
CURATOR_POOLS='[]'
```

Remove `BASE_RPC_URL` when moving to BNB. Preserve `CURATOR_ADDRESS` and `CURATOR_PRIVATE_KEY` if reusing the curator, or replace both together. Restart `pnpm dev`. Creating a pool requires BNB for gas plus all seven Ondo assets. The previous Coinbase tokens on Base are different assets and are not converted by this change.

Prices use CoinGecko's `simple/token_price/binance-smart-chain` endpoint with exact contract addresses, cached hourly and paced on the free tier. These are prices per token unit; no second share multiplier is applied. Missing/stale prices stop signing, including if updates stall outside market hours. If a stock-price source is introduced later, it must explicitly account for Ondo's corporate-action multiplier ([reference](https://docs.chain.link/data-feeds/tokenized-equity-feeds/ondo)).

## Validation and reproducible checks

```sh
pnpm test:demo
pnpm demo:build
pnpm demo:typecheck
pnpm test:bnb
pnpm demo:check:bnb
```

`pnpm test:bnb` pins BNB block 135,908,001 and uses the real seven tokens, live settlement, authenticator and hooks trampoline. Set `BNB_RPC_URL` to an archive-capable endpoint when needed; `BNB_FORK_BLOCK` deliberately overrides the pin for a fresh audit. The suite covers small seeds, all-asset LP flows, all seven incoming/outgoing settlement directions, each token's curator escrow withdrawal, signed and unsigned order authority, commitments and issuer restriction failures. Funding uses Foundry balance edits; solver enrollment impersonates the authenticator manager on the local fork only. Blacklist/pause scenarios mock policy answers at the real dependencies. These tests do not mint production stocks, establish backing or grant production solver authority.

The 16 fork tests passed. Cold-access resets before actual settlements tested all seven incoming-token fee hooks at the canonical 100,000/150,000 gas caps. Trace measurements at the pinned block: pool pre-hook 68,857 gas; pool post-hook 109,163–116,236 gas. These are pool-call costs, not total settlement gas or a guarantee for future token upgrades. The real trampoline executed within the caps and fees were asserted/withdrawn. No production pool-contract changes were needed.

`pnpm demo:check:bnb` never signs, posts orders or sends transactions. It checks chain/token metadata, settlement/trampoline alignment, all seven fresh CoinGecko prices and seven sampled stock-to-stock CoW quotes. `CHECK_TRADE_USD` controls the quote size (default $1). It writes `.local/bnb-readiness.json` and fails on missing prices, unusable quotes or rate limiting. The measured run returned all seven $1 quotes successfully; their `verified` values were false. These are EOA routing quotes, not funded pool ERC-1271/hook verification. A successful run is not proof that every pair, trade size or market session is executable.

Browser checks include the existing local transaction journey (creation/recovery, fixed fee, solver toggle, deposit/withdraw) and `demo/test/browser-network.mjs` (mocked BNB wallet addition, correct public RPC/native BNB metadata, seven Ondo assets, $10 seed suggestions). Neither browser test sends BNB transactions. The new BNB fork suite is included in CI.

## Deployment and verification

1. Fund the chosen deployer with BNB. `DEPLOYER_ADDRESS=0x... pnpm demo:deploy:bnb` performs a dry-run without a key and writes the unsigned deployment plus verification inputs. The measured estimate was 7,488,956 gas; the 10% gas-limit buffer and 2x RPC gas-price cap at 0.05 gwei budgeted 0.0008237851 BNB. Re-estimate immediately before deployment.
2. Inspect the chain, admin, current gas estimate and production dependency addresses. The deployment script always checks actual RPC chain ID and trampoline settlement alignment. It never updates `.env` automatically.
3. An explicitly authorized `pnpm demo:deploy:bnb --broadcast` requires `DEPLOYER_PRIVATE_KEY`. Persisted broadcast hash and final receipt are under `.local/`; the receipt includes the deployed address and block. Deploying the factory does not create a pool or post any order.
4. Verify in BscScan's browser UI using `.local/bnb-factory-verification-v2/BCoWFactory.standard-input.json`, **Solidity (Standard-Json-Input)**, compiler **v0.8.25+commit.b61c2a91**, **GNU GPLv3**. Contract name: `src/contracts/BCoWFactory.sol:BCoWFactory`. Paste `constructor-arguments.txt` without `0x`. The JSON embeds optimizer 500 runs, Cancun and viaIR disabled. No browser API key is needed. After broadcasting, `README.txt` includes the exact verification URL and transaction.
5. Update `.env` as above. Create/initialize a pool, confirm all seven balances/weights, fees, curator, allowances and LP shares; add the pool explicitly to both frontend and curator lists.
6. Keep `CURATOR_LIVE=false` until the funded pool obtains a **verified final hook-aware ERC-1271 quote** and a small live order is accepted and settled. Then enable normal operation with stdout logs captured.

Constructor addresses, in order:

- Settlement: `0x9008D19f58AAbD9eD0D60971565AA8510560ab41`
- Hooks trampoline: `0x60Bf78233f48eC42eE3F101b9a05eC7878728006`
- Admin: selected `FACTORY_ADMIN`, defaulting to deployer

The factory source/bytecode is unchanged from the creator-trading-options revision. BNB EIP-1153 support was checked with a read-only TSTORE/TLOAD probe. New network deployment and funded acceptance/settlement are the remaining operational steps, not evidence already supplied by a local fork or EOA quote.
