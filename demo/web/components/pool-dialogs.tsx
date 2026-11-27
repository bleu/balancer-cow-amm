"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getAddress, isAddress, zeroAddress } from "viem";
import { decimal, liquidityAmounts, units } from "../../lib/shared.mjs";
import { api, errorText } from "../lib/api";
import { customPortfolio } from "../../lib/portfolio.mjs";
import { savePool } from "../lib/catalog";
import { poolAbi, requestId, tokenAbi, type PoolActions } from "../lib/wallet";
import { EyeMark } from "./brand";
import type {
  Asset,
  DemoConfig,
  Draft,
  PoolSnapshot,
  PriceSnapshot,
  Progress,
} from "../lib/types";
interface Tools {
  busy: boolean;
  progress: Progress;
  run: (fn: () => Promise<void>) => Promise<void>;
}
const Context = createContext<Tools | null>(null);
function useTools() {
  const tools = useContext(Context);
  if (!tools) throw Error("Missing dialog");
  return tools;
}
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    [busy, setBusy] = useState(false),
    [text, setText] = useState("");
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const active = useRef(false);
  const run = async (fn: () => Promise<void>) => {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setText(errorText(e));
    } finally {
      active.current = false;
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={ref}
      id="modal"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      className="warden-dialog fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-auto border text-ink"
    >
      <p className="dialog-eyebrow">
        <EyeMark /> WARDEN / YOUR BASKET
      </p>
      <div className="mb-5 flex items-start justify-between gap-4">
        <h2 className="text-xl font-semibold">{title}</h2>
        <button
          id="close-modal"
          aria-label="Close dialog"
          onClick={onClose}
          disabled={busy}
          className="px-2 text-2xl"
        >
          ×
        </button>
      </div>
      <Context.Provider value={{ busy, progress: setText, run }}>
        <fieldset disabled={busy}>{children}</fieldset>
      </Context.Provider>
      <div
        id="progress"
        role="status"
        aria-live="polite"
        className="mt-5 whitespace-pre-wrap break-words text-sm leading-relaxed text-forest"
      >
        {text}
      </div>
    </dialog>
  );
}
interface Shared {
  config: DemoConfig;
  ensure: () => Promise<PoolActions>;
  complete: (address?: `0x${string}`) => Promise<void>;
}
function CustomPortfolioEditor({
  ensure,
  onApply,
}: Pick<Shared, "ensure"> & {
  onApply: (assets: Asset[]) => void;
}) {
  const { run, busy, progress } = useTools();
  const [rows, setRows] = useState([
    { address: "", weight: "50" },
    { address: "", weight: "50" },
  ]);
  function change(next: typeof rows) {
    setRows(next);
    onApply([]);
  }
  return (
    <section
      className="mt-5 rounded-xl border border-line p-4"
      aria-label="Custom portfolio tokens"
    >
      <p className="note">
        Choose 2–8 ERC-20 tokens on this network. Weights must total 100%, with
        at least 2% per token and up to two decimal places. Weights are fixed
        after initialization.
      </p>
      {rows.map((row, i) => (
        <div key={i} className="mt-4 border-t border-line pt-3">
          <label htmlFor={"custom-token-" + i}>Token {i + 1} address</label>
          <input
            id={"custom-token-" + i}
            value={row.address}
            onChange={(e) =>
              change(
                rows.map((r, j) =>
                  j === i ? { ...r, address: e.target.value } : r
                )
              )
            }
            autoComplete="off"
          />
          <div className="flex items-end gap-3">
            <div className="min-w-0 flex-1">
              <label htmlFor={"custom-weight-" + i}>Target weight (%)</label>
              <input
                id={"custom-weight-" + i}
                inputMode="decimal"
                value={row.weight}
                onChange={(e) =>
                  change(
                    rows.map((r, j) =>
                      j === i ? { ...r, weight: e.target.value } : r
                    )
                  )
                }
              />
            </div>
            <button
              type="button"
              className="button secondary"
              disabled={rows.length <= 2 || busy}
              onClick={() => change(rows.filter((_, j) => j !== i))}
              aria-label={"Remove token " + (i + 1)}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          id="custom-add-token"
          type="button"
          className="button secondary"
          disabled={rows.length >= 8 || busy}
          onClick={() => change([...rows, { address: "", weight: "" }])}
        >
          Add token
        </button>
        <button
          id="custom-load-tokens"
          type="button"
          className="button primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              // Validate addresses and weights before sending any RPC requests.
              customPortfolio(
                rows.map((r) => ({
                  ...r,
                  decimals: 18,
                  symbol: "TOKEN",
                  name: "Token",
                }))
              );
              const w = await ensure();
              const assets = await Promise.all(
                rows.map(async (row) => {
                  const address = getAddress(row.address.trim());
                  if ((await w.publicClient.getCode({ address })) === undefined)
                    throw Error("Token address has no contract code");
                  const [decimals, symbol, name] = await Promise.all([
                    w.publicClient.readContract({
                      address,
                      abi: tokenAbi,
                      functionName: "decimals",
                    }),
                    w.publicClient
                      .readContract({
                        address,
                        abi: tokenAbi,
                        functionName: "symbol",
                      })
                      .catch(() => "TOKEN"),
                    w.publicClient
                      .readContract({
                        address,
                        abi: tokenAbi,
                        functionName: "name",
                      })
                      .catch(() => "Unknown token"),
                  ]);
                  return { ...row, address, decimals, symbol, name };
                })
              );
              onApply(customPortfolio(assets));
              progress("Tokens and weights loaded. Enter seed amounts below.");
            })
          }
        >
          Read tokens and apply weights
        </button>
      </div>
      <p className="note mt-3">
        Token metadata does not establish transfer compatibility or CoW
        liquidity. Curator enrollment is separate.
      </p>
    </section>
  );
}
export function CreateForm({
  config,
  ensure,
  prices,
  complete,
  initialCurator,
}: { prices: PriceSnapshot | null; initialCurator: `0x${string}` } & Shared) {
  const { busy, run, progress } = useTools(),
    [custom, setCustom] = useState(false),
    [customAssets, setCustomAssets] = useState<Asset[]>([]),
    [name, setName] = useState("Magnificent Seven"),
    [symbol, setSymbol] = useState("MAG7"),
    [curator, setCurator] = useState<string>(
      config.curatorAddress ?? initialCurator
    ),
    [publicFee, setPublicFee] = useState("99.9999"),
    [solverEnabled, setSolverEnabled] = useState(false),
    [usd, setUsd] = useState("1000"),
    [seeds, setSeeds] = useState(config.assets.map(() => "0")),
    [done, setDone] = useState(false),
    [pending, setPending] = useState(false);
  const draft = useRef<Draft | null>(null);

  const assets = custom ? customAssets : config.assets;
  const fresh =
    !!prices &&
    assets.length >= 2 &&
    assets.every((a) => {
      const p = prices.values[a.address.toLowerCase()];
      return p && Date.now() / 1000 - p.updatedAt <= config.priceMaxAgeSeconds;
    });
  function suggest() {
    if (!prices || !fresh) return;
    try {
      const value = units(usd, 8);
      setSeeds(
        assets.map((a) =>
          decimal(
            (value * units(String(a.weight), 2) * 10n ** BigInt(a.decimals)) /
              10000n /
              BigInt(prices.values[a.address.toLowerCase()].usd),
            a.decimals,
            a.decimals
          )
        )
      );
    } catch (e) {
      progress(errorText(e));
    }
  }
  async function submit() {
    const w = await ensure();
    if (!draft.current) {
      if (assets.length < 2)
        throw Error("Read tokens and apply valid weights first");
      if (!config.factory)
        throw Error("Deploy and configure the demo factory first");
      const fee = units(publicFee, 16);
      if (fee < 1000000000000n || fee > 999999000000000000n)
        throw Error("Public fee must be between 0.0001% and 99.9999%");
      await w.validateTradingOptions(fee, solverEnabled);
      const amounts = assets.map((a, i) => units(seeds[i], a.decimals));
      if (amounts.some((n) => n < 1000000n))
        throw Error(
          "Every seed must meet the pool minimum of 1,000,000 raw units"
        );
      const address = getAddress(curator.trim());
      if (address === zeroAddress) throw Error("Curator cannot be zero");
      if (!name.trim() || !symbol.trim())
        throw Error("Pool name and symbol required");
      for (let i = 0; i < assets.length; i++)
        if (
          (await w.publicClient.readContract({
            address: assets[i].address,
            abi: tokenAbi,
            functionName: "balanceOf",
            args: [w.account],
          })) < amounts[i]
        )
          throw Error("Insufficient " + assets[i].symbol);
      draft.current = {
        chainId: config.chainId,
        factory: config.factory,
        creator: w.account,
        requestId: requestId(),
        name: name.trim(),
        symbol: symbol.trim(),
        curator: address,
        feeBps: config.curatorFeeBps,
        publicSwapFee: fee.toString(),
        solverOrdersEnabled: solverEnabled,
        seedAmounts: amounts.map(String),
        assets: assets.map((a) => ({ ...a })),
      };
      savePool(draft.current);
      setPending(true);
    }
    const address = await w.initialize(draft.current, progress);
    setDone(true);
    await complete(address);
  }
  return (
    <>
      <p className="note">
        {custom ? "Custom weights" : "MAG7 preset"} ·{" "}
        {config.curatorFeeBps / 100}% curator share of surplus · 3-minute
        orders. Creation stays in this browser. Automated rebalancing requires
        separate registration. Setup requires several wallet transactions.
      </p>
      <fieldset disabled={pending || busy}>
        <div className="mt-5 flex gap-3" aria-label="Portfolio type">
          <button
            id="preset-mag7"
            type="button"
            className={"button " + (!custom ? "primary" : "secondary")}
            aria-pressed={!custom}
            onClick={() => {
              setCustom(false);
              setName("Magnificent Seven");
              setSymbol("MAG7");
              setSeeds(config.assets.map(() => "0"));
            }}
          >
            MAG7 preset
          </button>
          <button
            id="preset-custom"
            type="button"
            className={"button " + (custom ? "primary" : "secondary")}
            aria-pressed={custom}
            onClick={() => {
              setCustom(true);
              setName("My portfolio");
              setSymbol("WARDEN");
              setCustomAssets([]);
              setSeeds([]);
            }}
          >
            Custom portfolio
          </button>
        </div>
        {custom && (
          <CustomPortfolioEditor
            ensure={ensure}
            onApply={(next) => {
              setCustomAssets(next);
              setSeeds(next.map(() => "0"));
            }}
          />
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="new-name">Pool name</label>
            <input
              id="new-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
            />
          </div>
          <div>
            <label htmlFor="new-symbol">LP symbol</label>
            <input
              id="new-symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              maxLength={12}
            />
          </div>
        </div>
        <label htmlFor="new-curator">Curator address</label>
        <input
          id="new-curator"
          value={curator}
          onChange={(e) => setCurator(e.target.value)}
        />
        <label htmlFor="public-swap-fee">Public swap fee (%)</label>
        <input
          id="public-swap-fee"
          inputMode="decimal"
          value={publicFee}
          onChange={(e) => setPublicFee(e.target.value)}
        />
        <p className="note mt-2">
          Fixed when the pool is deployed. Lower fees permit ordinary public
          trading; 99.9999% is the protective setting. This fee does not apply
          to CoW orders.
        </p>
        <label className="flex items-start gap-3">
          <input
            id="allow-solver-orders"
            type="checkbox"
            className="mt-1 w-auto"
            checked={solverEnabled}
            onChange={(e) => setSolverEnabled(e.target.checked)}
          />
          <span>
            Allow CoW solver orders
            <small>
              Eligible solver origins can trade without a curator signature,
              using the same curve and CoW fee checks. The creator can change
              this permission later.
            </small>
          </span>
        </label>
        <label htmlFor="seed-usd">Suggest seed amounts from USD value</label>
        <div className="flex gap-3">
          <input
            id="seed-usd"
            inputMode="decimal"
            value={usd}
            onChange={(e) => setUsd(e.target.value)}
          />
          <button
            id="suggest"
            className="button secondary shrink-0"
            disabled={!fresh}
            onClick={suggest}
          >
            Use cached prices
          </button>
        </div>
        {!fresh && (
          <p className="note mt-3">
            USD seed suggestions require cached prices for every selected token.
            You can enter seed amounts manually.
          </p>
        )}
        {assets.map((a, i) => (
          <div key={a.address}>
            <label htmlFor={"seed-" + i}>
              {a.symbol} · {a.weight}% target
              <small>
                {a.address} · {a.decimals} decimals
              </small>
            </label>
            <input
              id={"seed-" + i}
              inputMode="decimal"
              value={seeds[i]}
              onChange={(e) =>
                setSeeds((old) =>
                  old.map((n, j) => (j === i ? e.target.value : n))
                )
              }
            />
          </div>
        ))}
      </fieldset>
      <button
        id="create-confirm"
        className="button primary mt-5 w-full"
        disabled={busy || done || assets.length < 2}
        onClick={() => run(submit)}
      >
        {done
          ? "Pool initialized"
          : pending
          ? "Resume initialization"
          : "Create and initialize"}
      </button>
    </>
  );
}
export function InitializeForm({
  draft,
  ensure,
  complete,
}: Pick<Shared, "ensure" | "complete"> & { draft: Draft }) {
  const { busy, run, progress } = useTools(),
    [done, setDone] = useState(false);
  return (
    <>
      <p className="note">
        Resume the stored request. On-chain reads determine which tokens need
        binding. Previously successful transactions are not repeated.
      </p>
      <button
        id="initialize-confirm"
        className="button primary mt-5 w-full"
        disabled={busy || done}
        onClick={() =>
          run(async () => {
            const w = await ensure();
            const address = await w.initialize(draft, progress);
            setDone(true);
            await complete(address);
          })
        }
      >
        Continue setup
      </button>
    </>
  );
}
export function ImportForm({
  config,
  complete,
}: Pick<Shared, "config" | "complete">) {
  const { busy, run } = useTools(),
    [input, setInput] = useState("");
  return (
    <>
      <p className="note">
        Adds a pool to this browser only. It does not publish the pool or enroll
        it with the curator.
      </p>
      <label htmlFor="pool-address">Pool address</label>
      <input
        id="pool-address"
        value={input}
        placeholder="0x…"
        onChange={(e) => setInput(e.target.value)}
      />
      <button
        id="save-pool"
        className="button primary mt-5 w-full"
        disabled={busy}
        onClick={() =>
          run(async () => {
            const address = getAddress(input.trim());
            const p = await api<PoolSnapshot>("/api/pool?address=" + address);
            savePool({ chainId: config.chainId, address, name: p.name });
            await complete(address);
          })
        }
      >
        Validate and save locally
      </button>
    </>
  );
}
interface Preview {
  snapshot: PoolSnapshot;
  shares: bigint;
  amounts: bigint[];
  bounds: bigint[];
  account: `0x${string}`;
}
export function LiquidityForm({
  pool,
  mode,
  config,
  ensure,
  complete,
}: Shared & { pool: PoolSnapshot; mode: "deposit" | "withdraw" }) {
  const { busy, run, progress } = useTools(),
    [amount, setAmount] = useState("1"),
    [preview, setPreview] = useState<Preview | null>(null),
    [calculating, setCalculating] = useState(false);
  const deposit = mode === "deposit";
  const generation = useRef(0);
  async function calculate() {
    const version = ++generation.current;
    setPreview(null);
    setCalculating(true);
    try {
      const w = await ensure(),
        s = await api<PoolSnapshot>(
          "/api/pool?address=" + pool.address + "&wallet=" + w.account
        );
      const shares = units(amount, 18);
      if (!deposit && shares > BigInt(s.walletShares))
        throw Error("Insufficient LP shares");
      const amounts = liquidityAmounts(
        s.tokens.map((t) => BigInt(t.balance)),
        shares,
        BigInt(s.supply)
      );
      const bounds = amounts.map((a) =>
        deposit
          ? (a * BigInt(10000 + config.slippageBps) + 9999n) / 10000n
          : (a * BigInt(10000 - config.slippageBps)) / 10000n
      );
      if (
        deposit &&
        s.tokens.some((t, i) => BigInt(t.walletBalance ?? "0") < bounds[i])
      )
        throw Error(
          "Your wallet needs all required token amounts, including the configured movement buffer"
        );
      if (version === generation.current)
        setPreview({
          snapshot: s,
          shares,
          amounts,
          bounds,
          account: w.account,
        });
    } catch (e) {
      if (version === generation.current) progress(errorText(e));
    } finally {
      if (version === generation.current) setCalculating(false);
    }
  }
  useEffect(() => {
    void calculate();
    return () => {
      generation.current++;
    };
  }, []);
  async function submit() {
    if (!preview) throw Error("Refresh the preview first");
    const w = await ensure();
    if (w.account.toLowerCase() !== preview.account.toLowerCase())
      throw Error("Wallet account changed. Refresh the preview.");
    const { snapshot: s, bounds, shares } = preview;
    if (deposit)
      for (let i = 0; i < s.tokens.length; i++) {
        const t = s.tokens[i];
        if (
          (await w.publicClient.readContract({
            address: t.address,
            abi: tokenAbi,
            functionName: "allowance",
            args: [w.account, s.address],
          })) < bounds[i]
        )
          await w.send(
            t.address,
            tokenAbi,
            "approve",
            [s.address, bounds[i]],
            "Approve " + t.symbol,
            progress
          );
      }
    await w.send(
      s.address,
      poolAbi,
      deposit ? "joinPool" : "exitPool",
      [shares, bounds],
      deposit
        ? "Deposit all portfolio assets"
        : "Withdraw all portfolio assets",
      progress
    );
    setPreview(null);
    progress("Confirmed. Your position has been refreshed.");
    await complete();
  }
  return (
    <>
      <p className="note">
        {deposit
          ? "Bring every portfolio asset. Deposits follow current reserves, which may differ from target weights."
          : "Receive all constituent tokens in current reserve proportions."}{" "}
        Amount bounds allow {config.slippageBps / 100}% reserve movement;
        otherwise the transaction reverts.
      </p>
      <label htmlFor="lp-amount">
        {pool.symbol} shares {deposit ? "to receive" : "to redeem"}
      </label>
      <input
        id="lp-amount"
        inputMode="decimal"
        value={amount}
        onChange={(e) => {
          generation.current++;
          setCalculating(false);
          setAmount(e.target.value);
          setPreview(null);
        }}
      />
      <div id="liquidity-preview">
        {preview?.snapshot.tokens.map((t, i) => (
          <div
            key={t.address}
            className="flex justify-between gap-4 border-b border-line py-3 text-right text-sm"
          >
            <span className="text-left">
              {t.symbol}
              <small>
                Wallet {decimal(t.walletBalance ?? "0", t.decimals, 5)}
              </small>
            </span>
            <span>
              {decimal(preview.amounts[i], t.decimals, 6)}
              <small>
                {deposit ? "Maximum" : "Minimum"}{" "}
                {decimal(preview.bounds[i], t.decimals, 6)}
              </small>
            </span>
          </div>
        ))}
      </div>
      <button
        id="preview"
        className="button secondary mt-4 w-full"
        disabled={busy || calculating}
        onClick={() => void calculate()}
      >
        {calculating ? "Reading current reserves…" : "Refresh preview"}
      </button>
      <button
        id="liquidity-confirm"
        className="button primary mt-3 w-full"
        disabled={busy || !preview}
        onClick={() => run(submit)}
      >
        {deposit ? "Approve and deposit" : "Withdraw tokens"}
      </button>
    </>
  );
}
export function RecoverForm({
  pool,
  ensure,
  complete,
}: Pick<Shared, "ensure" | "complete"> & { pool: PoolSnapshot }) {
  const { busy, run, progress } = useTools();
  return (
    <>
      <p className="note">
        Unbinds each seed token back to the controller wallet. Available only
        before finalization.
      </p>
      <button
        id="recover-confirm"
        className="button secondary mt-5 w-full"
        disabled={busy}
        onClick={() =>
          run(async () => {
            const w = await ensure(),
              p = w.publicClient;
            if (
              await p.readContract({
                address: pool.address,
                abi: poolAbi,
                functionName: "isFinalized",
              })
            )
              throw Error("Pool already finalized; use Withdraw instead");
            if (
              (
                await p.readContract({
                  address: pool.address,
                  abi: poolAbi,
                  functionName: "getController",
                })
              ).toLowerCase() !== w.account.toLowerCase()
            )
              throw Error("Connect the controller wallet");
            for (const token of await p.readContract({
              address: pool.address,
              abi: poolAbi,
              functionName: "getCurrentTokens",
            }))
              await w.send(
                pool.address,
                poolAbi,
                "unbind",
                [token],
                "Recover " + token,
                progress
              );
            progress(
              "Seeded assets recovered. You may resume initialization later."
            );
            await complete();
          })
        }
      >
        Unbind seeded tokens
      </button>
    </>
  );
}
export function CuratorForm({
  pool,
  ensure,
  complete,
}: Pick<Shared, "ensure" | "complete"> & { pool: PoolSnapshot }) {
  const { busy, run, progress } = useTools(),
    [input, setInput] = useState("");
  return (
    <>
      <p className="note">
        Only the immutable creator can replace the signer. Old signatures stop
        validating. The new address is not automatically enrolled with a
        service.
      </p>
      <label htmlFor="curator-address">New curator address</label>
      <input
        id="curator-address"
        placeholder="0x…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      <button
        id="curator-confirm"
        className="button primary mt-5 w-full"
        disabled={busy}
        onClick={() =>
          run(async () => {
            if (
              !isAddress(input.trim()) ||
              getAddress(input.trim()) === zeroAddress
            )
              throw Error("Enter a nonzero curator address");
            const w = await ensure();
            await w.send(
              pool.address,
              poolAbi,
              "setCurator",
              [getAddress(input.trim())],
              "Replace curator",
              progress
            );
            progress("Curator replaced.");
            await complete();
          })
        }
      >
        Replace curator
      </button>
    </>
  );
}

export function SolverPolicyForm({
  pool,
  ensure,
  complete,
}: Pick<Shared, "ensure" | "complete"> & { pool: PoolSnapshot }) {
  const { busy, run, progress } = useTools();
  const [done, setDone] = useState(false);
  const enabled = !pool.solverOrdersEnabled;
  return (
    <>
      <p className="note">
        {enabled ? "Enable" : "Disable"} unsigned orders from CoW-authenticated
        transaction origins. Curator signatures, public swap fees and the CoW
        curve/fee rules are independent. Contract-based solvers whose origin is
        not whitelisted are not covered by this mode.
      </p>
      <button
        id="solver-confirm"
        className="button primary mt-5 w-full"
        disabled={busy || done}
        onClick={() =>
          run(async () => {
            const w = await ensure();
            await w.send(
              pool.address,
              poolAbi,
              "setSolverOrdersEnabled",
              [enabled],
              enabled ? "Enable solver orders" : "Disable solver orders",
              progress
            );
            setDone(true);
            progress("Solver policy updated.");
            await complete();
          })
        }
      >
        {enabled ? "Enable" : "Disable"} solver orders
      </button>
    </>
  );
}
