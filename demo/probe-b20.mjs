// Read-only remote simulation. No Wallet, sendTransaction or broadcast path.
import fs from "node:fs/promises";
import { ethers } from "ethers";
import { ASSETS, TOKEN_ABI } from "./lib/shared.mjs";
import { jsonRequest } from "./lib/http.mjs";
const provider = new ethers.providers.JsonRpcProvider(
  {
    url: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
    timeout: 60000,
  },
  8453
);
if ((await provider.getNetwork()).chainId !== 8453)
  throw Error("B20 probe requires Base");
const artifact = async (name) =>
  JSON.parse(
    await fs.readFile(
      new URL(`../out/B20Probe.sol/${name}.json`, import.meta.url),
      "utf8"
    )
  );
const [probe, source] = await Promise.all([
  artifact("B20Probe"),
  artifact("ProbeTokenSource"),
]);
const block = await provider.getBlock("latest");
const sources = await Promise.all(
  ASSETS.map(async (asset) => {
    const pairs = await jsonRequest(
      "https://api.dexscreener.com/token-pairs/v1/base/" + asset.address
    );
    const token = new ethers.Contract(asset.address, TOKEN_ABI, provider);
    for (const pair of pairs) {
      if (!ethers.utils.isAddress(pair.pairAddress)) continue;
      if (
        (
          await token.balanceOf(pair.pairAddress, { blockTag: block.number })
        ).gte("400000000")
      )
        return pair.pairAddress;
    }
    throw Error("No sufficiently funded simulation source for " + asset.symbol);
  })
);
const harness = "0x1111111111111111111111111111111111111111";
const overrides = {
  [harness]: {
    code: probe.deployedBytecode.object,
    balance: ethers.utils.hexValue(ethers.utils.parseEther("100")),
  },
};
for (const address of sources)
  overrides[address] = { code: source.deployedBytecode.object };
const iface = new ethers.utils.Interface(probe.abi);
const results = [];
for (let sell = 0; sell < 7; sell++) {
  const buy = (sell + 1) % 7;
  const data = iface.encodeFunctionData("run", [
    ASSETS.map((x) => x.address),
    sources,
    sell,
    buy,
  ]);
  const raw = await provider.send("eth_call", [
    {
      to: harness,
      from: "0x2222222222222222222222222222222222222222",
      data,
      gas: ethers.utils.hexValue(30000000),
    },
    ethers.utils.hexValue(block.number),
    overrides,
  ]);
  const [preGas, postGas, fee] = iface.decodeFunctionResult("run", raw);
  const row = {
    sell: ASSETS[sell].symbol,
    buy: ASSETS[buy].symbol,
    preGas: preGas.toString(),
    postGas: postGas.toString(),
    feeRaw: fee.toString(),
  };
  results.push(row);
  console.log(JSON.stringify(row));
}
const report = {
  chainId: 8453,
  block: block.number,
  blockHash: block.hash,
  method: "eth_call with explicit state overrides",
  sources,
  assets: ASSETS.map((x) => ({ symbol: x.symbol, address: x.address })),
  results,
  limits:
    "Warm setup-state gas measurements include trampoline overhead. Not cold-token gas proof, live order acceptance, solver execution, policy mutation or native multiplier mutation. Only source/harness code overridden; native token implementations and token balances come from Base.",
};
await fs.mkdir(new URL("../.local/", import.meta.url), { recursive: true });
await fs.writeFile(
  new URL("../.local/b20-probe.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n"
);
console.log(
  "Read-only native B20 transfer/approval/LP/relayer/escrow simulation passed. Report: .local/b20-probe.json"
);
