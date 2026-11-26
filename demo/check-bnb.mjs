// Read-only checks. Quotes are not orders; this script never signs or broadcasts.
import fs from "node:fs/promises";
import { ethers } from "ethers";
import { loadConfig } from "./lib/config.mjs";
import { Prices } from "./lib/prices.mjs";
import { SETTLEMENT, TRAMPOLINE } from "./lib/networks.mjs";
import { jsonRequest } from "./lib/http.mjs";
import { units, lower, USD, TOKEN_ABI } from "./lib/shared.mjs";

const config = loadConfig({
  DEMO_CHAIN_ID: "56",
  RPC_URL:
    process.env.BNB_RPC_URL ||
    process.env.RPC_URL ||
    "https://bsc-rpc.publicnode.com",
  COINGECKO_API_KEY: process.env.COINGECKO_API_KEY,
});
const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
if ((await provider.getNetwork()).chainId !== 56)
  throw Error("BNB RPC network mismatch");
const block = await provider.getBlock("latest");
const report = {
  chainId: 56,
  block: block.number,
  blockHash: block.hash,
  tokens: [],
  quotes: [],
  limits:
    "EOA liquidity quotes only, not a funded pool ERC-1271/hook verification or production settlement. No orders posted.",
};
for (const a of config.assets) {
  const token = new ethers.Contract(a.address, TOKEN_ABI, provider);
  const decimals = await token.decimals({ blockTag: block.number });
  if (decimals !== a.decimals) throw Error("Unexpected decimals: " + a.symbol);
  report.tokens.push({ symbol: a.symbol, address: a.address, decimals });
}
const trampoline = new ethers.Contract(
  TRAMPOLINE,
  ["function settlement() view returns(address)"],
  provider
);
if ((await trampoline.settlement()).toLowerCase() !== SETTLEMENT.toLowerCase())
  throw Error("Wrong trampoline settlement");
if ((await provider.getCode(SETTLEMENT)) === "0x")
  throw Error("Missing settlement");
const prices = new Prices(config);
let failed = false;
try {
  const snapshot = await prices.get();
  prices.assertFresh(snapshot, Math.floor(Date.now() / 1000));
  report.prices = snapshot;
  const usd = units(process.env.CHECK_TRADE_USD || "1", 8);
  if (usd <= 0n) throw Error("CHECK_TRADE_USD must be positive");
  for (let i = 0; i < 7; ++i) {
    const sell = config.assets[i],
      buy = config.assets[(i + 1) % 7];
    const amount =
      (usd * 10n ** BigInt(sell.decimals)) /
      BigInt(snapshot.values[lower(sell.address)].usd);
    const row = {
      sell: sell.symbol,
      buy: buy.symbol,
      sellAmount: String(amount),
      intendedUsd: String(usd / USD),
    };
    try {
      const response = await jsonRequest(config.cowApi + "/quote", {
        method: "POST",
        timeout: 45000,
        body: {
          from: "0x0000000000000000000000000000000000000001",
          sellToken: sell.address,
          buyToken: buy.address,
          sellAmountBeforeFee: String(amount),
          kind: "sell",
          validTo: Math.floor(Date.now() / 1000) + 180,
          partiallyFillable: false,
          signingScheme: "eip712",
          priceQuality: "optimal",
        },
      });
      if (!response.quote || BigInt(response.quote.buyAmount ?? 0) <= 0n)
        throw Error("No usable quote");
      Object.assign(row, {
        success: true,
        buyAmount: response.quote.buyAmount,
        feeAmount: response.quote.feeAmount,
        verified: response.verified === true,
      });
    } catch (e) {
      Object.assign(row, { success: false, error: e.message });
      failed = true;
      if (e.status === 429) {
        report.quotes.push(row);
        console.log(JSON.stringify(row));
        break;
      }
    }
    report.quotes.push(row);
    console.log(JSON.stringify(row));
    if (i < 6) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
} catch (e) {
  failed = true;
  report.priceError = e.message;
}
await fs.mkdir(new URL("../.local/", import.meta.url), { recursive: true });
await fs.writeFile(
  new URL("../.local/bnb-readiness.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n"
);
console.log("Read-only report: .local/bnb-readiness.json");
if (failed || report.quotes.length !== 7) {
  console.error(
    "Readiness incomplete; inspect the report. Do not infer funded pool support from EOA quotes."
  );
  process.exitCode = 1;
}
