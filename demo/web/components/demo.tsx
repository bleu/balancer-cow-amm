"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAddress, isAddress, type Address } from "viem";
import { decimal, mergeCatalog, portfolio } from "../../lib/shared.mjs";
import { api, errorText, money, short } from "../lib/api";
import { isDraft, readSaved } from "../lib/catalog";
import { usePoolWallet } from "../lib/wallet";
import { ArrowIcon, BasketEye, EyeMark } from "./brand";
import type {
  DemoConfig,
  Draft,
  PoolEntry,
  PoolSnapshot,
  PriceSnapshot,
  SavedPool,
  WorkerStatus,
  CowOrder,
} from "../lib/types";
import {
  Dialog,
  CreateForm,
  InitializeForm,
  ImportForm,
  LiquidityForm,
  RecoverForm,
  CuratorForm,
  SolverPolicyForm,
} from "./pool-dialogs";
type Modal =
  | { kind: "create"; curator: Address }
  | { kind: "import" }
  | { kind: "initialize"; draft: Draft }
  | {
      kind: "deposit" | "withdraw" | "recover" | "curator" | "solver";
      pool: PoolSnapshot;
    };
const assetTints = [
  "#8dc647",
  "#6dac37",
  "#a4d473",
  "#4e8f29",
  "#badf97",
  "#7ba35c",
  "#d2e8bc",
];
const assetTint = (index: number) => assetTints[index] ?? assetTints[0];
function useCatalog() {
  const [saved, setSaved] = useState<SavedPool[]>([]);
  useEffect(() => {
    const read = () => setSaved(readSaved());
    read();
    window.addEventListener("storage", read);
    window.addEventListener("folio:catalog", read);
    return () => {
      window.removeEventListener("storage", read);
      window.removeEventListener("folio:catalog", read);
    };
  }, []);
  return saved;
}
function useRoute() {
  const [address, setAddress] = useState<Address | null>(null);
  useEffect(() => {
    const update = () => {
      const value = location.hash.slice(1);
      setAddress(isAddress(value) ? getAddress(value) : null);
    };
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return address;
}
export function Demo({ config }: { config: DemoConfig }) {
  const wallet = usePoolWallet(config),
    saved = useCatalog(),
    address = useRoute(),
    client = useQueryClient();
  const [notice, setNotice] = useState(""),
    [modal, setModal] = useState<Modal | null>(null),
    [connecting, setConnecting] = useState(false);
  const prices = useQuery({
    queryKey: ["prices"],
    queryFn: () =>
      api<{ snapshot: PriceSnapshot | null; error: string | null }>(
        "/api/prices"
      ),
    refetchInterval: 30000,
  });
  const status = useQuery({
    queryKey: ["status"],
    queryFn: () => api<WorkerStatus>("/api/status"),
    refetchInterval: 15000,
  });
  const pool = useQuery({
    queryKey: ["pool", address, wallet.address],
    queryFn: () =>
      api<PoolSnapshot>(
        "/api/pool?address=" +
          address +
          (wallet.address ? "&wallet=" + wallet.address : "")
      ),
    enabled: !!address,
    refetchInterval: 30000,
  });
  const entries = mergeCatalog(config.pools, saved, config.chainId),
    snapshot = prices.data?.snapshot ?? null;
  const priceMessage =
    prices.isError || prices.data?.error
      ? "CoinGecko prices unavailable"
      : "Loading market prices…";
  async function connect() {
    setConnecting(true);
    try {
      await wallet.ensure();
      setNotice("");
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      setConnecting(false);
    }
  }
  async function open(next: Modal) {
    try {
      if (next.kind !== "import") await wallet.ensure();
      setNotice("");
      setModal(next);
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function complete(next?: Address) {
    if (next) location.hash = next;
    await client.invalidateQueries({ queryKey: ["pool"] });
    await client.invalidateQueries({ queryKey: ["catalog-pool"] });
  }
  const shared = { config, ensure: wallet.ensure, complete };
  let dialog: React.ReactNode = null,
    title = "";
  if (modal) {
    if (modal.kind === "create") {
      title = "Create a MAG7 pool";
      dialog = (
        <CreateForm
          {...shared}
          prices={snapshot}
          initialCurator={modal.curator}
        />
      );
    } else if (modal.kind === "import") {
      title = "Add a pool by address";
      dialog = (
        <ImportForm
          config={config}
          complete={async (next) => {
            await complete(next);
            setModal(null);
          }}
        />
      );
    } else if (modal.kind === "initialize") {
      title = "Initialize " + modal.draft.name;
      dialog = (
        <InitializeForm
          draft={modal.draft}
          ensure={wallet.ensure}
          complete={complete}
        />
      );
    } else if (modal.kind === "deposit" || modal.kind === "withdraw") {
      title =
        modal.kind === "deposit"
          ? "Deposit into the basket"
          : "Withdraw from the basket";
      dialog = (
        <LiquidityForm {...shared} pool={modal.pool} mode={modal.kind} />
      );
    } else if (modal.kind === "recover") {
      title = "Recover unfinalized seed assets";
      dialog = (
        <RecoverForm
          pool={modal.pool}
          ensure={wallet.ensure}
          complete={complete}
        />
      );
    } else if (modal.kind === "solver") {
      title = "Configure solver orders";
      dialog = (
        <SolverPolicyForm
          pool={modal.pool}
          ensure={wallet.ensure}
          complete={complete}
        />
      );
    } else {
      title = "Replace curator";
      dialog = (
        <CuratorForm
          pool={modal.pool}
          ensure={wallet.ensure}
          complete={complete}
        />
      );
    }
  }
  return (
    <>
      <header className="app-header">
        <div className="header-inner">
          <a href="#" className="brand" aria-label="Warden home">
            <EyeMark className="brand-mark" />
            <span className="wordmark">warden</span>
          </a>
          <div className="flex items-center gap-4 sm:gap-6">
            <span id="network" className="network-pill">
              {config.localDev ? "Local fixture" : config.name}
            </span>
            <button
              id="connect"
              className={"button " + (wallet.address ? "secondary" : "primary")}
              disabled={connecting}
              onClick={connect}
            >
              {connecting
                ? "Connecting…"
                : wallet.address
                ? short(wallet.address)
                : "Connect wallet"}
            </button>
          </div>
        </div>
      </header>
      <main className="app-main">
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <a href="#">Explore baskets</a>
          <span aria-hidden="true">/</span>
          <span>
            {address ? pool.data?.name ?? "Pool details" : "MAG7 collection"}
          </span>
        </nav>
        {config.localDev && (
          <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Local synthetic-token fixture. This is not a funded production pool
            or production CoW execution.
          </div>
        )}
        {notice && (
          <div
            id="notice"
            role="status"
            className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"
          >
            {notice}
          </div>
        )}
        {address ? (
          pool.data ? (
            <Details
              config={config}
              pool={pool.data}
              prices={snapshot}
              priceMessage={priceMessage}
              status={status.data}
              statusError={status.isError}
              wallet={wallet.address}
              saved={saved}
              open={open}
              notify={setNotice}
            />
          ) : (
            <p role="status" className="panel">
              {pool.error?.message ?? "Reading pool state…"}
            </p>
          )
        ) : (
          <Catalog
            config={config}
            entries={entries}
            saved={saved}
            wallet={wallet.address}
            prices={snapshot}
            priceMessage={priceMessage}
            open={open}
            create={async () => {
              try {
                const w = await wallet.ensure();
                setModal({ kind: "create", curator: w.account });
              } catch (e) {
                setNotice(errorText(e));
              }
            }}
          />
        )}
      </main>
      <footer className="app-footer">
        <span className="footer-brand">
          <EyeMark /> warden{" "}
          <span className="text-slate-500">
            / a watchful approach to baskets
          </span>
        </span>
        <span>{config.name} · CoW Protocol · No indexer</span>
      </footer>
      {modal && (
        <Dialog key={modal.kind} title={title} onClose={() => setModal(null)}>
          {dialog}
        </Dialog>
      )}
    </>
  );
}
function Catalog({
  config,
  entries,
  saved,
  wallet,
  prices,
  priceMessage,
  open,
  create,
}: {
  config: DemoConfig;
  entries: PoolEntry[];
  saved: SavedPool[];
  wallet?: Address;
  prices: PriceSnapshot | null;
  priceMessage: string;
  open: (modal: Modal) => Promise<void>;
  create: () => Promise<void>;
}) {
  const drafts = saved
    .filter(isDraft)
    .filter(
      (p) =>
        p.chainId === config.chainId &&
        !p.address &&
        (!wallet || p.creator.toLowerCase() === wallet.toLowerCase())
    );
  return (
    <section id="catalog-view">
      <div className="hero">
        <div className="hero-copy">
          <p className="eyebrow">ONCHAIN BASKETS. A WATCHFUL EYE.</p>
          <h1>
            Set a portfolio.
            <br />
            <em>Warden watches it.</em>
          </h1>
          <p className="hero-description">
            Bring your assets together. Explore weighted baskets, see what you
            hold, and follow every rebalance through CoW Protocol.
          </p>
          <button
            id="create"
            className="button primary"
            disabled={!config.factory}
            onClick={create}
          >
            Create a basket <ArrowIcon />
          </button>
        </div>
        <BasketEye />
        <div className="hero-foot">
          <span>
            <b>01</b> Diversify in one basket
          </span>
          <span>
            <b>02</b> Keep your holdings in view
          </span>
          <span>
            <b>03</b> Follow the curator
          </span>
        </div>
      </div>
      <div className="catalog-layout">
        <div>
          <div className="section-heading">
            <h2>
              Your next basket{" "}
              <span className="ml-2 text-xs text-slate-500">
                / {String(entries.length).padStart(2, "0")}
              </span>
            </h2>
            <button
              id="import"
              className="text-button"
              onClick={() => open({ kind: "import" })}
            >
              Add a pool <span aria-hidden="true">+</span>
            </button>
          </div>
          <div id="pools" className="pool-grid">
            {!entries.length && (
              <div className="panel">
                <h2 className="text-xl font-semibold">
                  {config.factory
                    ? "Your first basket starts here."
                    : `Ready for a ${config.name} deployment.`}
                </h2>
                <p className="note mt-3">
                  {config.factory
                    ? "Create a MAG7 pool or add a known pool address. New pools stay in this browser until explicitly registered."
                    : "The MAG7 preset is configured. Deploy a demo factory and fund a pool to enable live wallet flows."}
                </p>
              </div>
            )}
            {entries.map((e) => (
              <PoolCard
                key={e.address}
                entry={e}
                prices={prices}
                priceMessage={priceMessage}
              />
            ))}
            {drafts.map((d) => (
              <button
                key={d.requestId}
                className="panel text-left"
                onClick={() => open({ kind: "initialize", draft: d })}
              >
                Recover creation: {d.name}
              </button>
            ))}
          </div>
          <p className="catalog-note">
            Pools created here stay in this browser. Public listing and the
            curator service require explicit registration.
          </p>
        </div>
        <section className="basket-blueprint" aria-label="MAG7 target weights">
          <div className="blueprint-title">
            <div>
              <p className="eyebrow">THE MAG7 BLUEPRINT</p>
              <h2>
                Familiar companies.
                <br />A shared perspective.
              </h2>
            </div>
            <EyeMark className="blueprint-eye" />
          </div>
          <div className="allocation-strip mb-5" aria-hidden="true">
            {config.assets.map((a, i) => (
              <span
                key={a.address}
                style={{ flex: a.weight, background: assetTint(i) }}
              />
            ))}
          </div>
          {config.assets.map((a) => (
            <div key={a.address} className="preset-row">
              <span className="preset-asset">
                <span className="asset-index" aria-hidden="true">
                  {a.symbol.slice(0, 2).toUpperCase()}
                </span>
                <span>
                  {a.name}
                  <small>{a.symbol}</small>
                </span>
              </span>
              <strong className="preset-weight">{a.weight}%</strong>
            </div>
          ))}
          <p className="mt-4 text-[10px] leading-relaxed text-slate-500">
            Fixed target weights · Seven constituent assets
          </p>
        </section>
      </div>
      <div className="principles">
        <div>
          <p className="eyebrow">01 / THE BASKET</p>
          <h3>Know what you hold.</h3>
          <p>
            Every asset, balance, and target weight in one place. Pool state
            comes directly from the chain.
          </p>
        </div>
        <div>
          <p className="eyebrow">02 / THE WATCH</p>
          <h3>Curation you can follow.</h3>
          <p>
            Hourly evaluations and CoW orders, with one curator order at a time.
            Each pool shows its service status.
          </p>
        </div>
        <div>
          <p className="eyebrow">03 / YOUR POSITION</p>
          <h3>A clear way in. And out.</h3>
          <p>
            Deposit the basket’s assets to receive pool shares. Withdraw your
            shares for the underlying assets.
          </p>
        </div>
      </div>
    </section>
  );
}
function PoolCard({
  entry,
  prices,
  priceMessage,
}: {
  entry: PoolEntry;
  prices: PriceSnapshot | null;
  priceMessage: string;
}) {
  const pool = useQuery({
    queryKey: ["catalog-pool", entry.address],
    queryFn: () => api<PoolSnapshot>("/api/pool?address=" + entry.address),
    refetchInterval: 30000,
  });
  let value = "Loading reserves…";
  if (pool.error) value = "Unavailable";
  else if (pool.data) {
    try {
      value = pool.data.finalized
        ? prices
          ? money(portfolio(pool.data.tokens, prices.values).total)
          : priceMessage
        : "Initialization pending";
    } catch {
      value = "Prices unavailable";
    }
  }
  return (
    <a
      href={"#" + entry.address}
      data-pool={entry.address}
      className="pool-card"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="basket-monogram">M7</span>
        <span className="badge">
          {entry.public ? "Whitelisted" : "Saved locally"}
        </span>
      </div>
      <h3 className="mt-6">{entry.name ?? pool.data?.name ?? "MAG7 pool"}</h3>
      <p className="mt-2 text-xs text-slate-500">
        Seven assets · Fixed target weights
      </p>
      <div
        className="pool-card-value"
        data-unpriced={!prices || !pool.data?.finalized}
      >
        {value}
      </div>
      <small>Pool value · {short(entry.address)}</small>
      <div className="pool-card-foot">
        <span>Explore the basket</span>
        <span className="card-arrow">
          <ArrowIcon diagonal />
        </span>
      </div>
    </a>
  );
}
function Details({
  config,
  pool,
  prices,
  priceMessage,
  status,
  statusError,
  wallet,
  saved,
  open,
  notify,
}: {
  config: DemoConfig;
  pool: PoolSnapshot;
  prices: PriceSnapshot | null;
  priceMessage: string;
  status?: WorkerStatus;
  statusError: boolean;
  wallet?: Address;
  saved: SavedPool[];
  open: (modal: Modal) => Promise<void>;
  notify: (text: string) => void;
}) {
  let view: ReturnType<
    typeof portfolio<PoolSnapshot["tokens"][number]>
  > | null = null;
  try {
    if (prices && pool.tokens.length)
      view = portfolio(pool.tokens, prices.values);
  } catch {}
  const registered = status?.registeredPools.some(
    (a) => a.toLowerCase() === pool.address.toLowerCase()
  );
  const worker = status?.pools?.[pool.address.toLowerCase()] ?? status;
  const totalWeight = pool.tokens.reduce((n, t) => n + BigInt(t.denorm), 0n);
  const stale =
    prices &&
    Object.values(prices.values).some(
      (p) => Date.now() / 1000 - p.updatedAt > config.priceMaxAgeSeconds
    );
  const draft = saved.find(
    (p) => p.address?.toLowerCase() === pool.address.toLowerCase() && isDraft(p)
  );
  const publicPool = config.pools.some(
    (p) => p.address.toLowerCase() === pool.address.toLowerCase()
  );
  const settings = [
    ["Creator", short(pool.creator)],
    ["Curator", short(pool.curator)],
    ["Order lifetime", pool.duration + " seconds"],
    ["Curator fee", pool.feeBps / 100 + "% of limit surplus"],
    [
      "Accrued curator fees",
      pool.tokens
        .map((t) => decimal(t.curatorClaimable, t.decimals, 5) + " " + t.symbol)
        .join(" · "),
    ],
    ["LP supply", decimal(pool.supply, 18, 4)],
    [
      "Solver orders",
      pool.solverOrdersEnabled === null
        ? "Legacy pool"
        : pool.solverOrdersEnabled
        ? "Enabled"
        : "Disabled",
    ],
    ["Direct swap fee", (Number(pool.swapFee) / 1e16).toFixed(4) + "%"],
    ["State", pool.finalized ? "Finalized" : "Initialization pending"],
  ];
  return (
    <section id="detail-view">
      <div className="detail-header">
        <div className="min-w-0">
          <div className="detail-title">
            <span className="basket-monogram" aria-hidden="true">
              M7
            </span>
            <div>
              <p className="eyebrow">
                {publicPool ? "Whitelisted pool" : "Locally viewed pool"} /{" "}
                {config.name}
              </p>
              <h1 id="pool-name">{pool.name}</h1>
            </div>
          </div>
          <button
            id="copy-address"
            className="mt-4 max-w-full break-all text-left font-mono text-[10px] text-slate-500 underline"
            onClick={() =>
              navigator.clipboard
                .writeText(pool.address)
                .then(() => notify("Pool address copied."))
                .catch(() =>
                  notify("Clipboard unavailable. Copy the displayed address.")
                )
            }
          >
            {pool.address} · Copy
          </button>
        </div>
        <div className="flex gap-3">
          <button
            id="deposit"
            className="button primary"
            disabled={!pool.finalized}
            onClick={() => open({ kind: "deposit", pool })}
          >
            Deposit
          </button>
          <button
            id="withdraw"
            className="button secondary"
            disabled={!pool.finalized}
            onClick={() => open({ kind: "withdraw", pool })}
          >
            Withdraw
          </button>
        </div>
      </div>
      <div className="stats-grid">
        <Stat
          label="Pool value"
          value={view ? money(view.total) : "—"}
          detail={
            prices
              ? `${stale ? "Stale reference" : "Reference prices"} · ${new Date(
                  prices.fetchedAt * 1000
                ).toLocaleTimeString()} · ${prices.source}`
              : priceMessage
          }
        />
        <Stat
          label="Your position"
          value={
            wallet && view && BigInt(pool.supply) > 0n
              ? money(
                  (view.total * BigInt(pool.walletShares)) / BigInt(pool.supply)
                )
              : "—"
          }
          detail={
            wallet
              ? decimal(pool.walletShares, 18, 6) +
                " " +
                pool.symbol +
                " shares"
              : "Connect your wallet"
          }
        />
        <Stat
          label="Rebalance service"
          value={
            statusError
              ? "Offline"
              : !status
              ? "Connecting…"
              : !registered
              ? "Not enrolled"
              : status?.live
              ? worker?.state ?? "Starting"
              : "Dry run"
          }
          detail={
            statusError
              ? "Curator status unavailable"
              : !status
              ? "Reading curator service…"
              : registered
              ? worker?.state === "startup-wait"
                ? "Waiting for previous orders to expire."
                : worker?.reason ?? "Awaiting check"
              : "Local creation does not enroll this pool for automated rebalancing."
          }
        >
          <small>
            {registered && status?.lastCheck
              ? "Last check " +
                new Date(status.lastCheck * 1000).toLocaleTimeString()
              : ""}
            {registered && status?.nextCheck
              ? " · Next " +
                new Date(status.nextCheck * 1000).toLocaleTimeString()
              : ""}
            {registered && status?.currentOrder
              ? " · Live order " + short(status.currentOrder)
              : ""}
          </small>
        </Stat>
      </div>
      <div className="panel holdings-panel">
        <div className="flex flex-wrap justify-between gap-3">
          <h2 className="text-lg font-semibold">Inside the basket</h2>
          <span className="text-xs text-slate-500">
            Current allocation / target
          </span>
        </div>
        <div className="allocation-strip my-6">
          {pool.tokens.map((t) => (
            <span
              key={t.address}
              title={t.symbol}
              style={{
                background: assetTint(
                  config.assets.findIndex(
                    (a) => a.address.toLowerCase() === t.address.toLowerCase()
                  )
                ),
                flex: Number(
                  view?.assets.find((a) => a.address === t.address)?.value ??
                    t.denorm
                ),
              }}
            />
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[540px]">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Holdings</th>
                <th>Value</th>
                <th>Allocation</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody id="holdings">
              {pool.tokens.map((t) => {
                const v = view?.assets.find((a) => a.address === t.address);
                return (
                  <tr key={t.address}>
                    <td>
                      <span className="holding-identity">
                        <span className="asset-index" aria-hidden="true">
                          {t.symbol.slice(0, 2).toUpperCase()}
                        </span>
                        <span>
                          <strong>{t.symbol}</strong>
                          <small>{t.name}</small>
                        </span>
                      </span>
                    </td>
                    <td>{decimal(t.balance, t.decimals, 5)}</td>
                    <td>{v ? money(v.value) : "—"}</td>
                    <td>
                      <span className="allocation-value">
                        {v && view
                          ? (
                              (Number(v.value) * 100) /
                              Number(view.total)
                            ).toFixed(2) + "%"
                          : "—"}
                      </span>
                    </td>
                    <td>
                      {totalWeight
                        ? (
                            Number((BigInt(t.denorm) * 10000n) / totalWeight) /
                            100
                          ).toFixed(2) + "%"
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Activity pool={pool.address} chainId={config.chainId} />
        <section className="panel settings-panel">
          <h2>Pool settings</h2>
          <dl className="settings-grid">
            {settings.map(([name, value]) => (
              <div key={name} className="contents">
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {wallet?.toLowerCase() === pool.creator.toLowerCase() && (
            <>
              {" "}
              <button
                id="replace-curator"
                className="text-button mt-6"
                onClick={() => open({ kind: "curator", pool })}
              >
                Replace curator
              </button>
              {pool.solverOrdersEnabled !== null && (
                <button
                  id="configure-solvers"
                  className="text-button mt-4 block"
                  onClick={() => open({ kind: "solver", pool })}
                >
                  {pool.solverOrdersEnabled ? "Disable" : "Enable"} solver
                  orders
                </button>
              )}
            </>
          )}
        </section>
      </div>
      {!pool.finalized && draft && isDraft(draft) && (
        <section className="panel mt-5">
          <h2 className="text-lg font-semibold">
            Finish initializing your pool
          </h2>
          <p className="note my-3">
            Progress is read on-chain. Bound tokens will not be deposited twice.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              id="resume"
              className="button primary"
              onClick={() => open({ kind: "initialize", draft })}
            >
              Resume initialization
            </button>
            <button
              id="recover-assets"
              className="button secondary"
              onClick={() => open({ kind: "recover", pool })}
            >
              Recover seeded assets
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
function Stat({
  label,
  value,
  detail,
  children,
}: {
  label: string;
  value: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <article className="panel stat-card" data-field={label}>
      <span className="stat-label">
        {label}
        {label === "Rebalance service" && (
          <EyeMark className="w-6 text-forest" />
        )}
      </span>
      <strong className="stat-value">{value}</strong>
      <small>{detail}</small>
      {children}
    </article>
  );
}
function Activity({ pool, chainId }: { pool: Address; chainId: number }) {
  const orders = useQuery({
    queryKey: ["activity", pool],
    queryFn: () => api<CowOrder[]>("/api/activity?pool=" + pool),
    refetchInterval: 30000,
  });
  return (
    <section className="panel activity-panel">
      <div className="flex justify-between">
        <h2 className="text-lg font-semibold">CoW activity</h2>
        <button
          id="refresh-activity"
          className="text-button"
          onClick={() => void orders.refetch()}
        >
          Refresh
        </button>
      </div>
      <div id="activity" className="mt-5 text-xs text-slate-500">
        {orders.error
          ? "Order activity unavailable. Pool state and wallet actions still use RPC."
          : !orders.data
          ? "Loading orders…"
          : !orders.data.length
          ? "No CoW orders yet. Orders and their settlement status will appear here."
          : orders.data.slice(0, 8).map((o) => (
              <div
                key={o.uid}
                className="flex justify-between gap-4 border-b border-line py-3"
              >
                <div>
                  {o.kind} order · {o.status}
                  <small>
                    {o.creationDate
                      ? new Date(o.creationDate).toLocaleString()
                      : short(o.uid)}
                  </small>
                </div>
                <a
                  className="text-forest underline"
                  href={`https://explorer.cow.fi/${chainId}/orders/${encodeURIComponent(
                    o.uid
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Order details
                </a>
              </div>
            ))}
      </div>
    </section>
  );
}
