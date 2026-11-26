import fs from "node:fs/promises";
import { ethers } from "ethers";
const provider = new ethers.providers.JsonRpcProvider(
  {
    url: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
    timeout: 30000,
  },
  8453
);
if ((await provider.getNetwork()).chainId !== 8453)
  throw Error("Deployment requires Base chain 8453");
const settlement = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
  trampoline = "0x60Bf78233f48eC42eE3F101b9a05eC7878728006";
const broadcast = process.argv.includes("--broadcast");
const artifact = JSON.parse(
  await fs.readFile(
    new URL("../out/BCoWFactory.sol/BCoWFactory.json", import.meta.url),
    "utf8"
  )
);
if ((artifact.deployedBytecode.object.length - 2) / 2 > 24576)
  throw Error("Factory exceeds EIP-170");
let wallet;
try {
  if (process.env.DEPLOYER_PRIVATE_KEY)
    wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
} catch {
  throw Error("Invalid server deployer key");
}
const from = wallet?.address ?? process.env.DEPLOYER_ADDRESS;
if (!ethers.utils.isAddress(from ?? ""))
  throw Error(
    "Set DEPLOYER_ADDRESS for an unsigned deployment, or DEPLOYER_PRIVATE_KEY for broadcasting"
  );
const admin = ethers.utils.getAddress(process.env.FACTORY_ADMIN ?? from);
const iface = new ethers.utils.Interface([
  "function settlement() view returns(address)",
]);
const result = await provider.call({
  to: trampoline,
  data: iface.encodeFunctionData("settlement"),
});
if (
  ethers.utils.getAddress(
    iface.decodeFunctionResult("settlement", result)[0]
  ) !== ethers.utils.getAddress(settlement)
)
  throw Error("Trampoline settlement mismatch");
const factory = new ethers.ContractFactory(
  artifact.abi,
  artifact.bytecode.object,
  wallet ?? provider
);
const tx = factory.getDeployTransaction(settlement, trampoline, admin);
if (!broadcast) {
  console.log(
    JSON.stringify(
      {
        chainId: 8453,
        from,
        admin,
        to: null,
        data: tx.data,
        note: "Unsigned deployment only; inspect and fund gas before --broadcast.",
      },
      null,
      2
    )
  );
} else {
  if (!wallet) throw Error("--broadcast requires DEPLOYER_PRIVATE_KEY");
  const deployed = await factory.deploy(settlement, trampoline, admin);
  const receipt = await deployed.deployTransaction.wait(2);
  const report = {
    chainId: 8453,
    factory: deployed.address,
    admin,
    transactionHash: receipt.transactionHash,
    block: receipt.blockNumber,
  };
  await fs.mkdir(new URL("../.local/", import.meta.url), { recursive: true });
  await fs.writeFile(
    new URL("../.local/base-factory.json", import.meta.url),
    JSON.stringify(report, null, 2) + "\n"
  );
  console.log(JSON.stringify(report, null, 2));
}
