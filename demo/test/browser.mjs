// Explicit local integration journey: mints test tokens and submits Anvil wallet transactions.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { ethers } from "ethers";
import { Chain } from "../lib/chain.mjs";
import { manager, provider, load, contract } from "../../script/local/m7.mjs";
const origin = process.env.DEMO_BROWSER_URL ?? "http://127.0.0.1:3000";
const config = await (await fetch(origin + "/api/config")).json();
assert.equal(
  config.localDev,
  true,
  "Browser transaction tests require the local fixture"
);
assert.equal(config.chainId, 31338);
assert.equal((await provider.getNetwork()).chainId, 31338);
const state = await load();
let rejectThirdBind = false,
  binds = 0;
const bindSelector = ethers.utils
  .id("bind(address,uint256,uint256)")
  .slice(0, 10);
assert.equal(config.factory.toLowerCase(), state.factory.toLowerCase());
for (const token of state.tokens) {
  const t = await contract("LocalStockToken", token.address);
  await (
    await t.mint(
      manager.address,
      ethers.utils.parseUnits("20000", token.decimals)
    )
  ).wait();
}
const originalAutomine = await provider.send("anvil_getAutomine", []);
let browser, page;
try {
  await provider.send("anvil_setIntervalMining", [1]);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
  });
  page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  await page.exposeFunction("walletRpc", async ({ method, params = [] }) => {
    if (["eth_requestAccounts", "eth_accounts"].includes(method))
      return [manager.address];
    if (method === "wallet_switchEthereumChain") return null;
    if (method === "eth_sendTransaction") {
      const t = params[0];
      if (
        rejectThirdBind &&
        t.data?.startsWith(bindSelector) &&
        ++binds === 3
      ) {
        rejectThirdBind = false;
        throw Error("Intentional local wallet rejection during binding");
      }
      const tx = await manager.sendTransaction({
        to: t.to,
        data: t.data,
        value: t.value,
        gasLimit: t.gas,
        gasPrice: t.gasPrice,
      });
      return tx.hash;
    }
    return provider.send(method, params);
  });
  await page.addInitScript(() => {
    window.ethereum = {
      request: (args) => window.walletRpc(args),
      on: () => {},
      removeListener: () => {},
    };
  });
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.locator("#connect").click();
  await page.waitForFunction(() =>
    document.getElementById("connect").textContent.includes("…")
  );
  await page.locator("[data-pool]").first().click();
  await page.waitForSelector("#holdings tr");
  for (const operation of ["deposit", "withdraw"]) {
    await page.locator("#" + operation).click();
    await page.waitForFunction(
      () => document.getElementById("liquidity-confirm")?.disabled === false
    );
    await page.locator("#liquidity-confirm").click();
    await page.waitForFunction(
      () =>
        document
          .getElementById("progress")
          .textContent.includes("Confirmed. Your position"),
      null,
      { timeout: 120000 }
    );
    await page.locator("#close-modal").click();
    console.log(operation + " passed");
  }
  await page.goto(origin);
  await page.locator("#connect").click();
  await page.locator("#create").click();
  await page.locator("#suggest").click();
  await page.locator("#new-name").fill("Browser MAG7");
  await page.locator("#public-swap-fee").fill("0.3");
  await page.locator("#allow-solver-orders").check();
  rejectThirdBind = true;
  await page.locator("#create-confirm").click();
  await page.waitForFunction(
    () =>
      document.getElementById("create-confirm")?.textContent ===
        "Resume initialization" &&
      !document.getElementById("create-confirm").disabled,
    null,
    { timeout: 240000 }
  );
  const pending = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("folio-cow-pools-v1")).find(
      (p) => p.name === "Browser MAG7"
    )
  );
  assert.ok(
    pending.address,
    "Partial initialization must persist the recovered factory address"
  );
  await page.locator("#close-modal").click();
  await page.goto(origin + "#" + pending.address);
  await page.locator("#recover-assets").click();
  await page.locator("#recover-confirm").click();
  await page.waitForFunction(
    () =>
      document
        .getElementById("progress")
        ?.textContent.includes("Seeded assets recovered"),
    null,
    { timeout: 120000 }
  );
  assert.equal(
    (
      await (
        await fetch(origin + "/api/pool?address=" + pending.address)
      ).json()
    ).tokens.length,
    0
  );
  await page.locator("#close-modal").click();
  await page.locator("#resume").click();
  await page.locator("#initialize-confirm").click();
  await page.waitForFunction(
    () => {
      const text = document.getElementById("progress")?.textContent ?? "";
      return (
        text.includes("Pool initialized.") ||
        (text.length > 0 &&
          document.getElementById("initialize-confirm")?.disabled === false)
      );
    },
    null,
    { timeout: 240000 }
  );
  assert.match(
    await page.locator("#progress").textContent(),
    /Pool initialized\./
  );
  assert.equal(await page.locator("#initialize-confirm").isDisabled(), true);
  await page.locator("#close-modal").click();
  await page.reload();
  await page.waitForSelector("#holdings tr");
  assert.equal(await page.locator("#pool-name").textContent(), "Browser MAG7");
  // Strict curator snapshots must accept a low public fee and keep CoW policy separate.
  const chain = new Chain({
    ...config,
    rpcUrl: provider.connection.url,
    localAssets: config.assets,
  });
  const actual = await chain.snapshot(pending.address);
  assert.equal(actual.swapFee, ethers.utils.parseUnits("0.3", 16).toString());
  assert.equal(actual.solverOrdersEnabled, true);
  assert.equal(actual.feeBps, 100);
  await page.locator("#connect").click();
  for (const expected of [false, true]) {
    await page.locator("#configure-solvers").click();
    await page.locator("#solver-confirm").click();
    await page.waitForFunction(
      () =>
        document
          .getElementById("progress")
          ?.textContent.includes("Solver policy updated."),
      null,
      { timeout: 120000 }
    );
    assert.equal(
      (await chain.snapshot(pending.address)).solverOrdersEnabled,
      expected
    );
    assert.equal(
      (await chain.snapshot(pending.address)).swapFee,
      actual.swapFee
    );
    await page.locator("#close-modal").click();
  }
  const poolCount = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("folio-cow-pools-v1")).filter(
        (p) => p.address
      ).length
  );
  assert.equal(
    poolCount,
    1,
    "Request recovery must not duplicate catalog entries"
  );
  const fresh = await browser.newContext();
  const freshPage = await fresh.newPage();
  await freshPage.goto(origin);
  await freshPage.waitForSelector("[data-pool]");
  assert.equal(
    await freshPage.locator("[data-pool]").count(),
    1,
    "Another browser only discovers the configured fixture"
  );
  await fresh.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".local/demo-mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    ),
    true,
    "Mobile layout must not overflow"
  );
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: ".local/demo-desktop.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "Custom fixed public fee, solver opt-in/toggle, deposits/withdrawals, setup recovery and responsive layout passed."
  );
} catch (error) {
  if (page)
    console.error(
      "Browser state:",
      await page
        .evaluate(() => ({
          url: location.href,
          progress: document.getElementById("progress")?.textContent,
          create: document.getElementById("create-confirm")?.textContent,
        }))
        .catch(() => null)
    );
  throw error;
} finally {
  await browser?.close();
  await provider.send("anvil_setIntervalMining", [0]);
  await provider.send("evm_setAutomine", [originalAutomine]);
}
