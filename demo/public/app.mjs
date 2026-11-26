import {
  USD,
  ZERO,
  POOL_ABI,
  FACTORY_ABI,
  TOKEN_ABI,
  lower,
  units,
  decimal,
  liquidityAmounts,
  portfolio,
  mergeCatalog,
} from "./shared.mjs";
const $ = (id) => document.getElementById(id);
const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ])
  );
const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "—");
const money = (n) =>
  n === null || n === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(Number(n) / Number(USD));
async function api(path) {
  const r = await fetch(path);
  const x = await r.json();
  if (!r.ok) throw Error(x.error ?? "Request failed");
  return x;
}
let config,
  provider,
  walletProvider,
  wallet,
  signer,
  selected,
  prices,
  status,
  busy = false;
class ReadProvider extends ethers.providers.JsonRpcProvider {
  constructor(chainId) {
    super(undefined, chainId);
  }
  async send(method, params) {
    const data = await api(
      "/api/rpc?method=" +
        encodeURIComponent(method) +
        "&params=" +
        encodeURIComponent(JSON.stringify(params))
    );
    return data.result;
  }
}
const storageKey = "folio-cow-pools-v1";
function saved() {
  try {
    const x = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
}
function save(entry) {
  const list = saved().filter(
    (x) =>
      !(
        x.chainId === entry.chainId &&
        ((entry.requestId && x.requestId === entry.requestId) ||
          (entry.address && lower(x.address ?? "") === lower(entry.address)))
      )
  );
  list.push(entry);
  localStorage.setItem(storageKey, JSON.stringify(list));
}
function catalog() {
  return mergeCatalog(config.pools, saved(), config.chainId);
}
function notice(text) {
  $("notice").textContent = text;
  $("notice").hidden = !text;
}
function progress(text) {
  $("progress").textContent = text;
}
function errorText(e) {
  return e?.reason ?? e?.data?.message ?? e?.message ?? "Transaction failed";
}
function modal(title, body) {
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = body;
  progress("");
  if (!$("modal").open) $("modal").showModal();
}
function stalePrices() {
  return (
    !prices ||
    Object.values(prices.values).some(
      (p) => Date.now() / 1000 - p.updatedAt > config.priceMaxAgeSeconds
    )
  );
}
async function connect() {
  if (!window.ethereum)
    throw Error(
      "Install an Ethereum wallet to use pool actions. Read-only browsing is available."
    );
  await window.ethereum.request({ method: "eth_requestAccounts" });
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ethers.utils.hexValue(config.chainId) }],
    });
  } catch (e) {
    if (e.code !== 4902) throw e;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: ethers.utils.hexValue(config.chainId),
          chainName: config.name,
          rpcUrls: [
            config.localDev
              ? "http://127.0.0.1:8546"
              : "https://mainnet.base.org",
          ],
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          blockExplorerUrls: config.localDev ? undefined : [config.explorerUrl],
        },
      ],
    });
  }
  walletProvider = new ethers.providers.Web3Provider(window.ethereum, "any");
  walletProvider.pollingInterval = config.localDev ? 200 : 2000;
  signer = walletProvider.getSigner();
  wallet = await signer.getAddress();
  $("connect").textContent = short(wallet);
  notice("");
  if (selected) await detail(selected.address);
  else await renderCatalog();
}
async function requireWallet() {
  if (!wallet) await connect();
  if ((await walletProvider.getNetwork()).chainId !== config.chainId)
    throw Error("Switch your wallet to " + config.name);
}
async function transact(contract, method, args, label) {
  if ((await walletProvider.getNetwork()).chainId !== config.chainId)
    throw Error("Wallet network changed");
  progress(label + " — simulating…");
  await contract.callStatic[method](...args);
  const gas = await contract.estimateGas[method](...args);
  const gasPrice = await walletProvider.getGasPrice();
  progress(
    `${label}\nEstimated execution fee: ${ethers.utils.formatEther(
      gas.mul(gasPrice)
    )} ETH (plus Base L1 data fee)\nConfirm in your wallet.`
  );
  const tx = await contract[method](...args);
  progress(label + "\nSubmitted " + tx.hash + "\nWaiting for confirmation…");
  const receipt = await tx.wait(2);
  if (receipt.status !== 1) throw Error(label + " reverted");
  return receipt;
}
async function action(fn) {
  if (busy) return;
  busy = true;
  document
    .querySelectorAll("#modal button")
    .forEach((b) => (b.disabled = true));
  try {
    await fn();
  } catch (e) {
    progress(errorText(e));
  } finally {
    busy = false;
    document
      .querySelectorAll("#modal button")
      .forEach((b) => (b.disabled = b.dataset.locked === "true"));
  }
}
function bind(id, fn) {
  $(id).onclick = () =>
    Promise.resolve(fn()).catch((e) => notice(errorText(e)));
}
async function refreshShared() {
  const [p, s] = await Promise.all([api("/api/prices"), api("/api/status")]);
  prices = p.snapshot;
  status = s;
}
async function renderCatalog() {
  await refreshShared();
  $("catalog-view").hidden = false;
  $("detail-view").hidden = true;
  $("breadcrumb").textContent = "MAG7 collection";
  $("create").disabled = !config.factory;
  const entries = catalog();
  if (!entries.length) {
    $("pools").innerHTML = `<div class="empty-state"><div><h2>${
      config.factory
        ? "Your first basket starts here."
        : "Ready for a Base deployment."
    }</h2><p>${
      config.factory
        ? "Create a MAG7 pool or add a known pool address. Newly created pools stay in this browser until explicitly registered."
        : "The MAG7 preset is configured. A new demo factory and a funded pool must be deployed before live wallet flows are available. No live pool address has been invented."
    }</p></div><span class="badge">${
      config.factory ? "No saved pools" : "Setup required"
    }</span></div>`;
  } else {
    $("pools").innerHTML = entries
      .map(
        (e) =>
          `<button class="pool-card" data-pool="${esc(
            e.address
          )}"><div class="card-top"><span class="asset-monogram">M7</span><span class="badge">${
            e.public ? "Whitelisted" : "Saved locally"
          }</span></div><h3>${esc(e.name || "MAG7 pool")}</h3><p>${esc(
            short(e.address)
          )}<br>Seven assets · Fixed target weights</p><div class="card-footer"><span data-card-value="${esc(
            lower(e.address)
          )}">Loading reserves…</span><span>View pool</span></div></button>`
      )
      .join("");
    document.querySelectorAll("[data-pool]").forEach(
      (b) =>
        (b.onclick = () => {
          location.hash = b.dataset.pool;
        })
    );
    await Promise.allSettled(
      entries.map(async (e) => {
        try {
          const p = await api("/api/pool?address=" + e.address);
          const el = document.querySelector(
            `[data-card-value="${lower(e.address)}"]`
          );
          if (el)
            el.textContent = p.finalized
              ? prices
                ? money(portfolio(p.tokens, prices.values).total)
                : "Prices unavailable"
              : "Initialization pending";
        } catch {
          const el = document.querySelector(
            `[data-card-value="${lower(e.address)}"]`
          );
          if (el) el.textContent = "Unavailable";
        }
      })
    );
  }
  const drafts = saved().filter(
    (x) =>
      x.chainId === config.chainId &&
      !x.address &&
      x.requestId &&
      (!wallet || lower(x.creator) === lower(wallet))
  );
  for (const d of drafts) {
    const b = document.createElement("button");
    b.className = "pool-card";
    b.textContent = `Recover creation: ${d.name}`;
    b.onclick = () => resumeDraft(d);
    $("pools").append(b);
  }
}
async function detail(address) {
  selected = await api(
    "/api/pool?address=" + address + (wallet ? "&wallet=" + wallet : "")
  );
  await refreshShared();
  const entry = catalog().find((x) => lower(x.address) === lower(address));
  $("catalog-view").hidden = true;
  $("detail-view").hidden = false;
  $("breadcrumb").textContent = selected.name;
  $("pool-name").textContent = selected.name;
  $("pool-kind").textContent =
    (entry?.public ? "Whitelisted pool" : "Locally viewed pool") +
    " / " +
    config.name;
  $("copy-address").textContent = selected.address + " · Copy";
  const view =
    prices && selected.tokens.length
      ? (() => {
          try {
            return portfolio(selected.tokens, prices.values);
          } catch {
            return null;
          }
        })()
      : null;
  $("nav-value").textContent = view ? money(view.total) : "—";
  $("price-time").textContent = prices
    ? `${stalePrices() ? "Stale reference" : "Reference prices"} · ${new Date(
        prices.fetchedAt * 1000
      ).toLocaleTimeString()} · ${prices.source}`
    : "CoinGecko prices unavailable";
  $("position-value").textContent =
    wallet && view && BigInt(selected.supply) > 0n
      ? money(
          (view.total * BigInt(selected.walletShares)) / BigInt(selected.supply)
        )
      : "—";
  $("shares-value").textContent = wallet
    ? decimal(selected.walletShares, 18, 6) + " " + selected.symbol + " shares"
    : "Connect your wallet";
  const registered = status.registeredPools.some(
    (a) => lower(a) === lower(address)
  );
  const poolStatus = status.pools?.[lower(address)] ?? status;
  $("worker-state").textContent = registered
    ? status.live
      ? poolStatus.state
      : "Dry run"
    : "Not enrolled";
  $("worker-reason").textContent = registered
    ? poolStatus.reason ?? "Awaiting check"
    : "Local creation does not enroll this pool for automated rebalancing.";
  $("worker-timing").textContent = registered
    ? [
        status.lastCheck
          ? "Last check " +
            new Date(status.lastCheck * 1000).toLocaleTimeString()
          : "Awaiting first check",
        status.nextCheck
          ? "Next check " +
            new Date(status.nextCheck * 1000).toLocaleTimeString()
          : null,
        status.currentOrder ? "Live order " + short(status.currentOrder) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  $("allocation-bar").replaceChildren(
    ...selected.tokens.map((t) => {
      const a = config.assets.find(
        (a) => lower(a.address) === lower(t.address)
      );
      const v = view?.assets.find((x) => lower(x.address) === lower(t.address));
      const el = document.createElement("span");
      el.style.background = /^#[0-9a-f]{6}$/i.test(a?.color ?? "")
        ? a.color
        : "#bac9b4";
      el.style.flex = String(v ? Number(v.value) : Number(t.denorm));
      el.title = t.symbol;
      return el;
    })
  );
  const weightTotal = selected.tokens.reduce(
    (n, t) => n + BigInt(t.denorm),
    0n
  );
  $("holdings").innerHTML = selected.tokens
    .map((t) => {
      const v = view?.assets.find((x) => lower(x.address) === lower(t.address));
      return `<tr><td><strong><span class="token-letter">${esc(
        t.symbol.slice(0, 2)
      )}</span>${esc(t.symbol)}</strong><small>${esc(
        t.name
      )}</small></td><td>${decimal(t.balance, t.decimals, 5)}</td><td>${
        v ? money(v.value) : "—"
      }</td><td>${
        v
          ? ((Number(v.value) * 100) / Number(view.total)).toFixed(2) + "%"
          : "—"
      }</td><td>${
        weightTotal
          ? (Number((BigInt(t.denorm) * 10000n) / weightTotal) / 100).toFixed(
              2
            ) + "%"
          : "—"
      }</td></tr>`;
    })
    .join("");
  const settings = [
    ["Creator", short(selected.creator)],
    ["Curator", short(selected.curator)],
    ["Order lifetime", selected.duration + " seconds"],
    ["Curator fee", selected.feeBps / 100 + "% of limit surplus"],
    [
      "Accrued curator fees",
      selected.tokens
        .map(
          (t) =>
            decimal(t.curatorClaimable ?? "0", t.decimals, 5) + " " + t.symbol
        )
        .join(" · "),
    ],
    ["LP supply", decimal(selected.supply, 18, 4)],
    ["Direct swap fee", (Number(selected.swapFee) / 1e16).toFixed(4) + "%"],
    ["State", selected.finalized ? "Finalized" : "Initialization pending"],
  ];
  $("settings").innerHTML = settings
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
    .join("");
  $("deposit").disabled = !selected.finalized;
  $("withdraw").disabled = !selected.finalized;
  $("creator-controls").innerHTML =
    wallet && lower(wallet) === lower(selected.creator)
      ? '<button id="replace-curator" class="link-button">Replace curator</button>'
      : "";
  if ($("replace-curator")) bind("replace-curator", replaceCurator);
  const draft = saved().find(
    (x) => x.address && lower(x.address) === lower(address) && x.seedAmounts
  );
  $("initialize-panel").hidden = selected.finalized || !draft;
  if (!selected.finalized && draft) {
    $("initialize-panel").innerHTML =
      '<h2>Finish initializing your pool</h2><p class="form-note">Progress is read on-chain. Bound tokens will not be deposited twice.</p><button id="resume" class="button primary">Resume initialization</button> <button id="recover-assets" class="text-button">Recover seeded assets</button>';
    bind("resume", () => initializeModal(draft));
    bind("recover-assets", () => recoverAssets(draft));
  }
  await activity();
}
async function activity() {
  if (!selected) return;
  try {
    const orders = await api("/api/activity?pool=" + selected.address);
    $("activity").innerHTML = orders.length
      ? orders
          .slice(0, 8)
          .map(
            (o) =>
              `<div class="activity-row"><div>${esc(
                o.kind ?? "sell"
              )} order · ${esc(o.status ?? "unknown")}<small>${esc(
                o.creationDate
                  ? new Date(o.creationDate).toLocaleString()
                  : short(o.uid)
              )}</small></div><a target="_blank" rel="noopener noreferrer" href="https://explorer.cow.fi/${
                config.chainId
              }/orders/${encodeURIComponent(o.uid)}">Order details</a></div>`
          )
          .join("")
      : "No CoW orders yet. Local pools are not curated automatically.";
  } catch {
    $("activity").textContent =
      "Order activity unavailable. Pool state and wallet actions still use RPC.";
  }
}
async function importPool() {
  modal(
    "Add a pool by address",
    '<p class="form-note">Adds a pool to this browser only. It does not publish the pool or enroll it with the curator.</p><label for="pool-address">Pool address</label><input id="pool-address" placeholder="0x…"><button id="save-pool" class="button primary full">Validate and save locally</button>'
  );
  bind("save-pool", () =>
    action(async () => {
      const address = ethers.utils.getAddress($("pool-address").value.trim());
      const p = await api("/api/pool?address=" + address);
      save({ chainId: config.chainId, address, name: p.name });
      $("modal").close();
      location.hash = address;
      await detail(address);
    })
  );
}
async function creationModal() {
  if (!config.factory)
    throw Error("Deploy and configure the new demo factory first");
  await requireWallet();
  const curator = config.curatorAddress;
  modal(
    "Create a MAG7 pool",
    `<p class="form-note">Folio weights · ${
      config.curatorFeeBps / 100
    }% curator share of surplus · 3-minute orders.<br>Creation stays in this browser. Automated rebalancing requires separate registration. Setup requires several wallet transactions, each with a gas fee.</p><div class="field-row"><div><label for="new-name">Pool name</label><input id="new-name" value="Magnificent Seven" maxlength="64"></div><div><label for="new-symbol">LP symbol</label><input id="new-symbol" value="MAG7" maxlength="12"></div></div><label for="new-curator">Curator address</label><input id="new-curator" value="${esc(
      curator ?? wallet
    )}"><label for="seed-usd">Suggest seed amounts from USD value</label><div class="field-row"><input id="seed-usd" inputmode="decimal" value="1000"><button id="suggest" class="button secondary" ${
      !prices || stalePrices() ? "disabled" : ""
    }>Use cached prices</button></div><div id="seed-inputs">${config.assets
      .map(
        (a, i) =>
          `<label for="seed-${i}">${esc(a.symbol)} · ${
            a.weight
          }% target</label><input id="seed-${i}" inputmode="decimal" value="0">`
      )
      .join(
        ""
      )}</div><button id="create-confirm" class="button primary full">Create and initialize</button>`
  );
  bind("suggest", () => {
    const value = units($("seed-usd").value, 8);
    config.assets.forEach((a, i) => {
      const price = prices.values[lower(a.address)];
      if (!price) throw Error("Missing token price");
      $("seed-" + i).value = decimal(
        (value * BigInt(a.weight) * 10n ** BigInt(a.decimals)) /
          100n /
          BigInt(price.usd),
        a.decimals,
        a.decimals
      );
    });
  });
  let pendingDraft = null;
  bind("create-confirm", () =>
    action(async () => {
      if (pendingDraft) {
        await createAndInitialize(pendingDraft);
        $("create-confirm").dataset.locked = "true";
        return;
      }
      const amounts = config.assets.map((a, i) =>
        units($("seed-" + i).value, a.decimals)
      );
      if (amounts.some((x) => x < 1000000n))
        throw Error(
          "Every seed must meet the pool minimum of 1,000,000 raw units"
        );
      const address = ethers.utils.getAddress($("new-curator").value.trim());
      if (address === ZERO) throw Error("Curator cannot be zero");
      const name = $("new-name").value.trim(),
        symbol = $("new-symbol").value.trim();
      if (!name || !symbol) throw Error("Pool name and symbol required");
      for (let i = 0; i < config.assets.length; i++) {
        const t = new ethers.Contract(
          config.assets[i].address,
          TOKEN_ABI,
          provider
        );
        if ((await t.balanceOf(wallet)).lt(amounts[i].toString()))
          throw Error("Insufficient " + config.assets[i].symbol);
      }
      const draft = {
        chainId: config.chainId,
        factory: config.factory,
        creator: wallet,
        requestId: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        name,
        symbol,
        curator: address,
        feeBps: config.curatorFeeBps,
        seedAmounts: amounts.map(String),
      };
      pendingDraft = draft;
      save(draft);
      document
        .querySelectorAll("#modal input")
        .forEach((el) => (el.disabled = true));
      await createAndInitialize(draft);
      $("create-confirm").dataset.locked = "true";
    })
  );
}
async function resumeDraft(draft) {
  await requireWallet();
  initializeModal(draft);
}
function initializeModal(draft) {
  modal(
    "Initialize " + draft.name,
    '<p class="form-note">Resume the stored request. On-chain reads determine which tokens still need binding. Previously successful transactions are not repeated.</p><button id="initialize-confirm" class="button primary full">Continue setup</button>'
  );
  bind("initialize-confirm", () => action(() => createAndInitialize(draft)));
}
async function createAndInitialize(draft) {
  if (lower(wallet) !== lower(draft.creator))
    throw Error("Connect the creator wallet to resume");
  if (lower(draft.factory) !== lower(config.factory))
    throw Error("This setup belongs to a different factory");
  const factory = new ethers.Contract(config.factory, FACTORY_ABI, signer);
  let address = await factory.createdPool(wallet, draft.requestId);
  if (address === ZERO) {
    await transact(
      factory,
      "createPool",
      [
        draft.requestId,
        draft.name,
        draft.symbol,
        draft.curator,
        180,
        draft.feeBps ?? config.curatorFeeBps,
      ],
      "Create pool"
    );
    address = await factory.createdPool(wallet, draft.requestId);
  }
  if (address === ZERO)
    throw Error(
      "Creation address not available yet; retry the same stored request"
    );
  const createdNow = !(await new ethers.Contract(
    address,
    POOL_ABI,
    provider
  ).isFinalized());
  draft.address = address;
  save(draft);
  const pool = new ethers.Contract(address, POOL_ABI, signer);
  if (!(await pool.isFinalized())) {
    if (lower(await pool.getController()) !== lower(wallet))
      throw Error("Connected wallet is not the initialization controller");
    for (let i = 0; i < config.assets.length; i++) {
      const a = config.assets[i];
      if (await pool.isBound(a.address)) {
        if (
          !(await pool.getDenormalizedWeight(a.address)).eq(
            ethers.utils.parseEther(String(a.denorm))
          )
        )
          throw Error("Existing bound weight differs from preset");
        continue;
      }
      const token = new ethers.Contract(a.address, TOKEN_ABI, signer),
        amount = draft.seedAmounts[i];
      if ((await token.allowance(wallet, address)).lt(amount))
        await transact(
          token,
          "approve",
          [address, amount],
          "Approve " + a.symbol + " seed"
        );
      await transact(
        pool,
        "bind",
        [a.address, amount, ethers.utils.parseEther(String(a.denorm))],
        "Bind " + a.symbol
      );
    }
    const bound = await pool.getCurrentTokens();
    if (
      bound.length !== 7 ||
      bound.some(
        (a) => !config.assets.some((t) => lower(t.address) === lower(a))
      )
    )
      throw Error("Bound token set differs from MAG7 preset");
    if (
      lower(await pool.creator()) !== lower(wallet) ||
      lower(await pool.curator()) !== lower(draft.curator) ||
      (await pool.orderDuration()) !== 180 ||
      (await pool.curatorFeeBps()) !== (draft.feeBps ?? config.curatorFeeBps)
    )
      throw Error("Pool authority or duration differs from setup");
    for (let i = 0; i < config.assets.length; i++)
      if (
        !(await pool.getBalance(config.assets[i].address)).eq(
          draft.seedAmounts[i]
        )
      )
        throw Error("Bound seed amount differs from saved setup");
    const max = await pool.MAX_FEE();
    if (!(await pool.getSwapFee()).eq(max))
      await transact(pool, "setSwapFee", [max], "Set protective swap fee");
    await transact(pool, "finalize", [], "Finalize MAG7 pool");
  }
  if (createdNow) {
    const settlement = new ethers.Contract(
      await factory.SOLUTION_SETTLER(),
      ["function vaultRelayer() view returns(address)"],
      provider
    );
    const relayer = await settlement.vaultRelayer();
    for (const a of config.assets) {
      const t = new ethers.Contract(a.address, TOKEN_ABI, provider);
      if (
        !(await t.allowance(address, relayer)).eq(ethers.constants.MaxUint256)
      )
        throw Error("Finalized relayer allowance mismatch");
    }
    if (
      !(await pool.totalSupply()).eq(ethers.utils.parseEther("100")) ||
      !(await pool.balanceOf(wallet)).eq(ethers.utils.parseEther("100"))
    )
      throw Error("Initial LP shares mismatch");
  }
  // Replace the pending draft rather than leaving an extra recovery card.
  const list = saved().filter((x) => x.requestId !== draft.requestId);
  list.push(draft);
  localStorage.setItem(storageKey, JSON.stringify(list));
  progress("Pool initialized. Saved only in this browser. " + address);
  location.hash = address;
  await detail(address);
}
async function recoverAssets(draft) {
  await requireWallet();
  modal(
    "Recover unfinalized seed assets",
    '<p class="form-note">Unbinds each seed token back to the controller wallet. Available only before finalization.</p><button id="recover-confirm" class="button secondary full">Unbind seeded tokens</button>'
  );
  bind("recover-confirm", () =>
    action(async () => {
      const pool = new ethers.Contract(draft.address, POOL_ABI, signer);
      if (await pool.isFinalized())
        throw Error("Pool already finalized; use Withdraw instead");
      if (lower(await pool.getController()) !== lower(wallet))
        throw Error("Connect the controller wallet");
      for (const token of await pool.getCurrentTokens())
        await transact(pool, "unbind", [token], "Recover " + short(token));
      progress("Seeded assets recovered. You may resume initialization later.");
      await detail(draft.address);
    })
  );
}
async function liquidityModal(mode) {
  await requireWallet();
  await detail(selected.address);
  if (!selected.finalized) throw Error("Pool is not finalized");
  const isDeposit = mode === "deposit";
  modal(
    isDeposit ? "Deposit into the basket" : "Withdraw from the basket",
    `<p class="form-note">${
      isDeposit
        ? "Bring all seven assets. Deposits follow current reserve proportions, not necessarily the target weights."
        : "Receive all seven constituent tokens in current reserve proportions."
    } Amount bounds allow ${
      config.slippageBps / 100
    }% reserve movement; otherwise the transaction reverts.</p><label for="lp-amount">${esc(
      selected.symbol
    )} shares ${
      isDeposit ? "to receive" : "to redeem"
    }</label><input id="lp-amount" inputmode="decimal" value="1"><div id="liquidity-preview"></div><button id="preview" class="button secondary full">Refresh preview</button><button id="liquidity-confirm" class="button primary full" disabled>${
      isDeposit ? "Approve and deposit" : "Withdraw tokens"
    }</button>`
  );
  let preview = null;
  async function calculate() {
    const s = await api(
      "/api/pool?address=" + selected.address + "&wallet=" + wallet
    );
    const shares = units($("lp-amount").value, 18);
    if (!isDeposit && shares > BigInt(s.walletShares))
      throw Error("Insufficient LP shares");
    const amounts = liquidityAmounts(
      s.tokens.map((t) => BigInt(t.balance)),
      shares,
      BigInt(s.supply)
    );
    const bounds = amounts.map((a) =>
      isDeposit
        ? (a * BigInt(10000 + config.slippageBps) + 9999n) / 10000n
        : (a * BigInt(10000 - config.slippageBps)) / 10000n
    );
    if (
      isDeposit &&
      s.tokens.some((t, i) => BigInt(t.walletBalance) < bounds[i])
    )
      throw Error(
        "Your wallet needs all seven amounts, including the configured movement buffer"
      );
    preview = { s, shares, bounds };
    $("liquidity-preview").innerHTML = s.tokens
      .map(
        (t, i) =>
          `<div class="amount-row"><span>${esc(
            t.symbol
          )}<small>Wallet ${decimal(
            t.walletBalance,
            t.decimals,
            5
          )}</small></span><span>${decimal(amounts[i], t.decimals, 6)}<small>${
            isDeposit ? "Maximum" : "Minimum"
          } ${decimal(bounds[i], t.decimals, 6)}</small></span></div>`
      )
      .join("");
    $("liquidity-confirm").disabled = false;
    $("liquidity-confirm").dataset.locked = "false";
  }
  $("lp-amount").oninput = () => {
    preview = null;
    $("liquidity-confirm").disabled = true;
    $("liquidity-confirm").dataset.locked = "true";
  };
  bind("preview", () =>
    calculate().catch((e) => {
      preview = null;
      $("liquidity-confirm").disabled = true;
      $("liquidity-confirm").dataset.locked = "true";
      progress(errorText(e));
    })
  );
  bind("liquidity-confirm", () =>
    action(async () => {
      if (!preview) throw Error("Refresh the preview first");
      const { s, shares, bounds } = preview,
        pool = new ethers.Contract(s.address, POOL_ABI, signer);
      if (isDeposit)
        for (let i = 0; i < s.tokens.length; i++) {
          const t = new ethers.Contract(s.tokens[i].address, TOKEN_ABI, signer);
          if ((await t.allowance(wallet, s.address)).lt(bounds[i].toString()))
            await transact(
              t,
              "approve",
              [s.address, bounds[i].toString()],
              "Approve " + s.tokens[i].symbol
            );
        }
      await transact(
        pool,
        isDeposit ? "joinPool" : "exitPool",
        [shares.toString(), bounds.map(String)],
        isDeposit ? "Deposit all seven assets" : "Withdraw all seven assets"
      );
      progress("Confirmed. Your position has been refreshed.");
      preview = null;
      $("liquidity-confirm").dataset.locked = "true";
      $("liquidity-confirm").disabled = true;
      await detail(s.address);
    })
  );
  await calculate().catch((e) => progress(errorText(e)));
}
async function replaceCurator() {
  await requireWallet();
  modal(
    "Replace curator",
    '<p class="form-note">Only the immutable pool creator can replace the signing address. Old signatures stop validating. Changing the address does not register the pool with a new service.</p><label for="curator-address">New curator address</label><input id="curator-address" placeholder="0x…"><button id="curator-confirm" class="button primary full">Replace curator</button>'
  );
  bind("curator-confirm", () =>
    action(async () => {
      const a = ethers.utils.getAddress($("curator-address").value.trim());
      if (a === ZERO) throw Error("Curator cannot be zero");
      await transact(
        new ethers.Contract(selected.address, POOL_ABI, signer),
        "setCurator",
        [a],
        "Replace curator"
      );
      progress("Curator replaced.");
      await detail(selected.address);
    })
  );
}
async function route() {
  const address = location.hash.slice(1);
  if (ethers.utils.isAddress(address)) {
    await detail(ethers.utils.getAddress(address));
  } else {
    selected = null;
    await renderCatalog();
  }
}
async function main() {
  config = await api("/api/config");
  provider = new ReadProvider(config.chainId);
  $("network").textContent = config.localDev ? "Local fixture" : config.name;
  $("preset-assets").innerHTML = config.assets
    .map(
      (a, i) =>
        `<div class="preset-asset"><span><i class="swatch" data-color="${i}"></i>${esc(
          a.name
        )} <small>${esc(a.symbol)}</small></span><strong>${
          a.weight
        }%</strong></div>`
    )
    .join("");
  document.querySelectorAll("[data-color]").forEach((el) => {
    const color = config.assets[Number(el.dataset.color)].color;
    el.style.background = /^#[0-9a-f]{6}$/i.test(color ?? "")
      ? color
      : "#bac9b4";
  });
  bind("connect", connect);
  bind("create", creationModal);
  bind("import", importPool);
  bind("copy-address", () =>
    navigator.clipboard
      .writeText(selected.address)
      .then(() => notice("Pool address copied."))
  );
  bind("deposit", () => liquidityModal("deposit"));
  bind("withdraw", () => liquidityModal("withdraw"));
  bind("refresh-activity", activity);
  $("close-modal").onclick = () => {
    if (!busy) $("modal").close();
  };
  window.addEventListener("hashchange", () =>
    route().catch((e) => notice(errorText(e)))
  );
  window.ethereum?.on?.("accountsChanged", () => {
    wallet = null;
    signer = null;
    $("connect").textContent = "Connect wallet";
    route().catch((e) => notice(errorText(e)));
  });
  window.ethereum?.on?.("chainChanged", () => {
    wallet = null;
    signer = null;
    notice("Network changed. Reconnect your wallet before transacting.");
  });
  if (config.localDev)
    notice(
      "Local synthetic-token fixture. This is not a funded Base pool or production CoW execution."
    );
  await route();
  setInterval(() => {
    if (!busy) route().catch((e) => notice(errorText(e)));
  }, 30000);
}
main().catch((e) => notice(errorText(e)));
