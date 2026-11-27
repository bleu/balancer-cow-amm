// Local Anvil integration: deploys two non-preset tokens and submits wallet transactions.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { ethers } from "ethers";
import { manager, provider, load, deploy } from "../../script/local/m7.mjs";
import { Chain } from "../lib/chain.mjs";
const origin = process.env.DEMO_BROWSER_URL ?? "http://127.0.0.1:3000";
const config = await (await fetch(origin + "/api/config")).json();
assert.equal(config.localDev, true);
assert.equal(config.chainId, 31338);
assert.equal((await provider.getNetwork()).chainId, 31338);
assert.equal(
  config.factory.toLowerCase(),
  (await load()).factory.toLowerCase()
);
const originalAutomine = await provider.send("anvil_getAutomine", []);
let browser;
try {
  await provider.send("anvil_setIntervalMining", [1]);
  const tokens = [];
  for (const [name, symbol, decimals] of [
    ["Custom Alpha", "ALPHA", 18],
    ["Custom Beta", "BETA", 6],
  ]) {
    const token = await deploy("LocalStockToken", [name, symbol, decimals]);
    await (
      await token.mint(
        manager.address,
        ethers.utils.parseUnits("1000", decimals)
      )
    ).wait();
    tokens.push(token);
  }
  assert.ok(
    tokens.every(
      (t) =>
        !config.assets.some(
          (a) => a.address.toLowerCase() === t.address.toLowerCase()
        )
    )
  );
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let binds = 0,
    rejectSecond = true;
  const bindSelector = ethers.utils
    .id("bind(address,uint256,uint256)")
    .slice(0, 10);
  await page.exposeFunction("walletRpc", async ({ method, params = [] }) => {
    if (["eth_requestAccounts", "eth_accounts"].includes(method))
      return [manager.address];
    if (method === "wallet_switchEthereumChain") return null;
    if (method === "eth_sendTransaction") {
      const t = params[0];
      if (rejectSecond && t.data?.startsWith(bindSelector) && ++binds === 2) {
        rejectSecond = false;
        throw Error("Intentional local rejection of second custom bind");
      }
      return (
        await manager.sendTransaction({
          to: t.to,
          data: t.data,
          value: t.value,
          gasLimit: t.gas,
          gasPrice: t.gasPrice,
        })
      ).hash;
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
  await page.goto(origin);
  await page.locator("#create").click();
  await page.locator("#preset-custom").click();
  for (let i = 0; i < 2; i++)
    await page.locator("#custom-token-" + i).fill(tokens[i].address);
  await page.locator("#custom-weight-0").fill("99");
  await page.locator("#custom-weight-1").fill("1");
  await page.locator("#custom-load-tokens").click();
  await page.waitForFunction(() =>
    document.querySelector("#progress")?.textContent.includes("2%")
  );
  assert.ok(await page.locator("#create-confirm").isDisabled());
  await page.locator("#custom-weight-0").fill("33.33");
  await page.locator("#custom-weight-1").fill("66.67");
  await page.locator("#custom-load-tokens").click();
  await page.waitForSelector("#seed-1");
  assert.ok(
    await page.locator("#suggest").isDisabled(),
    "Missing prices must not prevent manual seed entry"
  );
  await page.locator("#seed-0").fill("10");
  await page.locator("#seed-1").fill("20");
  await page.locator("#new-name").fill("Custom Alpha Beta");
  await page.locator("#new-symbol").fill("AB");
  await page.locator("#public-swap-fee").fill("0.3");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  );
  await page.screenshot({
    path: ".local/custom-create-mobile.png",
    fullPage: true,
  });
  await page.locator("#create-confirm").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#create-confirm")?.textContent ===
        "Resume initialization" &&
      !document.querySelector("#create-confirm").disabled
  );
  const draft = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("folio-cow-pools-v1")).find(
      (p) => p.name === "Custom Alpha Beta"
    )
  );
  assert.equal(draft.assets.length, 2);
  assert.ok(draft.address);
  await page.reload();
  await page.waitForSelector("#create");
  await page.goto(origin + "#" + draft.address);
  await page.locator("#connect").click();
  await page.locator("#resume").click();
  await page.locator("#initialize-confirm").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#progress")
      ?.textContent.includes("Pool initialized.")
  );
  await page.locator("#close-modal").click();
  await page.reload();
  await page.waitForSelector("#holdings tr");
  assert.equal(await page.locator("#holdings tr").count(), 2);
  assert.match(
    await page.locator('[data-field="Pool value"]').textContent(),
    /USD prices unavailable for this portfolio/
  );
  assert.match(
    await page.locator('[data-field="Rebalance service"]').textContent(),
    /Not enrolled/
  );
  const chain = new Chain({ ...config, rpcUrl: provider.connection.url });
  const actual = await chain.snapshot(draft.address);
  assert.equal(actual.finalized, true);
  assert.equal(actual.tokens.length, 2);
  assert.deepEqual(
    actual.tokens.map((t) => t.denorm),
    [
      ethers.utils.parseEther("16.665").toString(),
      ethers.utils.parseEther("33.335").toString(),
    ]
  );
  assert.deepEqual(
    actual.tokens.map((t) => t.decimals),
    [18, 6]
  );
  assert.equal(actual.supply, ethers.utils.parseEther("100").toString());
  await page.locator("#connect").click();
  for (const operation of ["deposit", "withdraw"]) {
    await page.locator("#" + operation).click();
    await page.waitForFunction(
      () => document.querySelector("#liquidity-confirm")?.disabled === false
    );
    await page.locator("#liquidity-confirm").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#progress")
        ?.textContent.includes("Confirmed. Your position")
    );
    await page.locator("#close-modal").click();
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({
    path: ".local/custom-pool-desktop.png",
    fullPage: true,
  });
  const isolated = await browser.newContext();
  const other = await isolated.newPage();
  await other.goto(origin);
  await other.waitForSelector("[data-pool]");
  assert.equal(
    await other.locator('[data-pool="' + draft.address + '"]').count(),
    0
  );
  await other.locator("#import").click();
  await other.locator("#pool-address").fill(draft.address);
  await other.locator("#save-pool").click();
  await other.waitForSelector("#holdings tr");
  assert.equal(await other.locator("#holdings tr").count(), 2);
  await isolated.close();
  assert.deepEqual(errors, []);
  console.log(
    "Custom non-preset tokens, fractional weights, mixed decimals, rejection/reload/resume, unavailable prices, deposit/withdraw, local-only discovery and import passed."
  );
} finally {
  await browser?.close();
  await provider.send("anvil_setIntervalMining", [0]);
  await provider.send("evm_setAutomine", [originalAutomine]);
}
