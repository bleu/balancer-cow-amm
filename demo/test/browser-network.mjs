// UI-only network test with mocked config, prices and wallet. Never sends transactions.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { loadConfig, publicConfig } from "../lib/config.mjs";
import { units } from "../lib/shared.mjs";

const address = "0x0000000000000000000000000000000000000011";
const config = publicConfig(
  loadConfig({ DEMO_FACTORY_ADDRESS: address, CURATOR_ADDRESS: address })
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage();
  const calls = [];
  let chainId = "0x2105",
    installed = false;
  await page.exposeFunction("networkWallet", async ({ method, params }) => {
    calls.push({ method, params });
    if (["eth_requestAccounts", "eth_accounts"].includes(method))
      return [address];
    if (method === "eth_chainId") return chainId;
    if (method === "wallet_switchEthereumChain") {
      if (!installed)
        throw Object.assign(Error("Unknown chain"), { code: 4902 });
      chainId = params[0].chainId;
      return null;
    }
    if (method === "wallet_addEthereumChain") {
      installed = true;
      chainId = params[0].chainId;
      return null;
    }
    throw Error("Unexpected wallet method: " + method);
  });
  // Keep the provider's 4902 error code across the Playwright bridge.
  await page.addInitScript(() => {
    window.ethereum = {
      request: async (args) => {
        try {
          return await window.networkWallet(args);
        } catch (error) {
          if (String(error).includes("Unknown chain")) error.code = 4902;
          throw error;
        }
      },
      on: () => {},
      removeListener: () => {},
    };
  });
  await page.route("**/api/config", (route) => route.fulfill({ json: config }));
  await page.route("**/api/status", (route) =>
    route.fulfill({ json: { state: "idle", pools: {}, registeredPools: [] } })
  );
  await page.route("**/api/prices", (route) =>
    route.fulfill({
      json: {
        snapshot: {
          fetchedAt: Math.floor(Date.now() / 1000),
          source: "Test fixture",
          values: Object.fromEntries(
            config.assets.map((a) => [
              a.address.toLowerCase(),
              { usd: "10000000000", updatedAt: Math.floor(Date.now() / 1000) },
            ])
          ),
        },
        error: null,
      },
    })
  );
  await page.goto(process.env.DEMO_BROWSER_URL || "http://127.0.0.1:3000");
  await page.waitForSelector("#create");
  assert.ok((await page.textContent("body")).includes("BNB Smart Chain"));
  await page.locator("#create").click();
  await page.waitForSelector("#seed-usd");
  await page.locator("#seed-usd").fill("10");
  await page.locator("#suggest").click();
  for (let i = 0; i < 7; ++i) {
    assert.equal(
      units(await page.locator("#seed-" + i).inputValue(), 18),
      BigInt(config.assets[i].weight) * 10n ** 15n
    );
    assert.ok(
      (await page.textContent("body")).includes(config.assets[i].symbol)
    );
  }
  const add = calls.find((c) => c.method === "wallet_addEthereumChain");
  assert.equal(add.params[0].chainId, "0x38");
  assert.equal(add.params[0].nativeCurrency.symbol, "BNB");
  assert.deepEqual(add.params[0].rpcUrls, ["https://bsc-rpc.publicnode.com"]);
  assert.ok(!calls.some((c) => /send|sign/i.test(c.method)));
  console.log(
    "BNB wallet network addition, Ondo preset and $10 seed suggestions passed without signing."
  );
} finally {
  await browser.close();
}
