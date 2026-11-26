import fs from "node:fs/promises";
import { deployM7, load, manager, provider } from "../script/local/m7.mjs";
import { ASSETS, lower } from "./public/shared.mjs";
if ((await provider.getNetwork()).chainId !== 31338)
  throw Error("Local fixture deployment requires Anvil chain 31338");
await deployM7();
const state = await load();
const base = JSON.parse(
  await fs.readFile(new URL("./config.json", import.meta.url), "utf8")
);
const localAssets = state.tokens.map((t, i) => ({
  ...ASSETS[i],
  address: t.address,
  decimals: t.decimals,
}));
const config = {
  ...base,
  chainId: 31338,
  name: "Local Anvil",
  localDev: true,
  rpcUrl: process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8546",
  explorerUrl: "",
  factory: state.factory,
  curatorAddress: manager.address,
  pools: [{ address: state.pool, name: "MAG7 · local fixture" }],
  curatedPools: [],
  localAssets,
  fixturePrices: Object.fromEntries(
    localAssets.map((a, i) => [lower(a.address), i === 0 ? 1.1 : 1])
  ),
};
await fs.mkdir(new URL("../.local/", import.meta.url), { recursive: true });
await fs.writeFile(
  new URL("../.local/demo-config.json", import.meta.url),
  JSON.stringify(config, null, 2) + "\n"
);
console.log("Start: DEMO_CONFIG=.local/demo-config.json node demo/server.mjs");
console.log(
  "Synthetic fixture only. Fund another local wallet with the existing LocalStockToken.mint method to exercise deposits."
);
