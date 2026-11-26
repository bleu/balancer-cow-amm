import fs from "node:fs/promises";
import { deployM7, load, manager, provider } from "../script/local/m7.mjs";
import { localFixtureEnv, serializeEnv } from "./lib/local-env.mjs";
if ((await provider.getNetwork()).chainId !== 31338)
  throw Error("Local fixture deployment requires Anvil chain 31338");
await deployM7();
const state = await load();
const env = localFixtureEnv(
  state,
  process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8546",
  manager.address
);
await fs.mkdir(new URL("../.local/", import.meta.url), { recursive: true });
await fs.writeFile(
  new URL("../.local/demo.env", import.meta.url),
  serializeEnv(env)
);
console.log("Start: pnpm demo:serve:local");
console.log(
  "Synthetic fixture only. Fund another local wallet with LocalStockToken.mint to exercise deposits."
);
