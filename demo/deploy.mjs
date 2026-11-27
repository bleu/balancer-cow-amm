import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { ethers } from "ethers";
import { createPublicClient, http } from "viem";
import { base, bsc } from "viem/chains";
import { safeReason } from "./lib/curator.mjs";
import { networkProfile, SETTLEMENT, TRAMPOLINE } from "./lib/networks.mjs";

async function main() {
  const chainId = Number(process.argv[process.argv.indexOf("--chain") + 1]);
  if (![56, 8453].includes(chainId))
    throw Error("Specify --chain 56 or --chain 8453");
  const profile = networkProfile(chainId);
  const network = chainId === 56 ? "bnb" : "base";
  const provider = new ethers.providers.JsonRpcProvider({
    url:
      process.env.RPC_URL ||
      (chainId === 8453 ? process.env.BASE_RPC_URL : null) ||
      profile.rpcUrl,
    timeout: 30000,
  });
  if ((await provider.getNetwork()).chainId !== chainId)
    throw Error("Deployment RPC network mismatch");
  const artifact = JSON.parse(
    await fs.readFile(
      new URL("../out/BCoWFactory.sol/BCoWFactory.json", import.meta.url),
      "utf8"
    )
  );
  if ((artifact.deployedBytecode.object.length - 2) / 2 > 24576)
    throw Error("Factory exceeds EIP-170");
  let wallet = null;
  try {
    if (process.env.DEPLOYER_PRIVATE_KEY)
      wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  } catch {
    throw Error("Invalid DEPLOYER_PRIVATE_KEY");
  }
  const from = wallet?.address ?? process.env.DEPLOYER_ADDRESS;
  if (!ethers.utils.isAddress(from ?? ""))
    throw Error(
      "Set DEPLOYER_ADDRESS for a dry-run or DEPLOYER_PRIVATE_KEY to broadcast"
    );
  const admin = ethers.utils.getAddress(process.env.FACTORY_ADMIN || from);
  const trampoline = new ethers.Contract(
    TRAMPOLINE,
    ["function settlement() view returns(address)"],
    provider
  );
  if (
    (await trampoline.settlement()).toLowerCase() !== SETTLEMENT.toLowerCase()
  )
    throw Error("Trampoline settlement mismatch");
  if ((await provider.getCode(SETTLEMENT)) === "0x")
    throw Error("Settlement is not deployed");
  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode.object,
    wallet ?? undefined
  );
  const tx = factory.getDeployTransaction(SETTLEMENT, TRAMPOLINE, admin);
  const [estimate, gasPrice, balance] = await Promise.all([
    provider.estimateGas({ ...tx, from }),
    provider.getGasPrice(),
    provider.getBalance(from),
  ]);
  // Use the RPC's current gas price, avoiding ethers' fixed 1.5 gwei priority default.
  const gasLimit = estimate.mul(110).div(100);
  const maxGasPrice = gasPrice.mul(2);
  const budget = gasLimit.mul(maxGasPrice);
  const summary = {
    chainId,
    from,
    admin,
    estimatedGas: estimate.toString(),
    gasLimit: gasLimit.toString(),
    gasPriceWei: maxGasPrice.toString(),
    maximumExecutionCost: ethers.utils.formatEther(budget),
    nativeSymbol: profile.nativeCurrency.symbol,
    balance: ethers.utils.formatEther(balance),
    note:
      chainId === 8453
        ? "Base L1 data fee is additional."
        : "BNB execution estimate; wallet balance must cover gas.",
  };
  const dir = new URL(
    `../.local/${network}-factory-verification-v2/`,
    import.meta.url
  );
  await fs.mkdir(dir, { recursive: true });
  const input = JSON.parse(
    execFileSync(
      "forge",
      [
        "verify-contract",
        "0x0000000000000000000000000000000000000001",
        "src/contracts/BCoWFactory.sol:BCoWFactory",
        "--chain",
        String(chainId),
        "--show-standard-json-input",
      ],
      {
        env: {
          ...process.env,
          ETHERSCAN_API_KEY: process.env.ETHERSCAN_API_KEY || "unused",
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
  );
  // Ensure the upload includes the exact source contents used by this artifact.
  for (const [name, meta] of Object.entries(artifact.metadata.sources)) {
    if (
      !input.sources[name]?.content ||
      ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(input.sources[name].content)
      ) !== meta.keccak256
    )
      throw Error("Verification sources differ from build: " + name);
  }
  await fs.writeFile(
    new URL("BCoWFactory.standard-input.json", dir),
    JSON.stringify(input, null, 2) + "\n"
  );
  const args = ethers.utils.defaultAbiCoder.encode(
    ["address", "address", "address"],
    [SETTLEMENT, TRAMPOLINE, admin]
  );
  await fs.writeFile(
    new URL("constructor-arguments.txt", dir),
    args.slice(2) + "\n"
  );
  await fs.writeFile(
    new URL("unsigned-deployment.json", dir),
    JSON.stringify({ ...summary, to: null, data: tx.data }, null, 2) + "\n"
  );
  console.log(JSON.stringify(summary, null, 2));
  if (!process.argv.includes("--broadcast")) {
    console.log(
      `Dry-run only. Verification input and unsigned transaction: .local/${network}-factory-verification-v2/`
    );
  } else {
    if (!wallet) throw Error("--broadcast requires DEPLOYER_PRIVATE_KEY");
    if (
      balance.lt(
        budget.add(chainId === 8453 ? ethers.utils.parseEther("0.00002") : 0)
      )
    )
      throw Error("Insufficient deployment balance");
    const sent = await wallet.sendTransaction({
      ...tx,
      gasLimit,
      gasPrice: maxGasPrice,
    });
    await fs.writeFile(
      new URL("broadcast.json", dir),
      JSON.stringify({ transactionHash: sent.hash }, null, 2) + "\n"
    );
    console.log("Broadcast " + sent.hash);
    // BNB block/receipt extensions are not consistently parsed by ethers v5's
    // confirmation waiter. Use viem's chain-aware receipt parser after broadcasting.
    const publicClient = createPublicClient({
      chain: chainId === 56 ? bsc : base,
      transport: http(provider.connection.url),
    });
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: sent.hash,
      confirmations: 2,
    });
    if (receipt.status !== "success" || !receipt.contractAddress)
      throw Error("Deployment failed");
    const deployed = new ethers.Contract(
      receipt.contractAddress,
      artifact.abi,
      provider
    );
    if (!(await deployed.POOL_SETTINGS_VERSION()).eq(2))
      throw Error("Unexpected factory version");
    if (
      (await publicClient.getTransaction({ hash: sent.hash })).input !== tx.data
    )
      throw Error("Deployment input mismatch");
    const report = {
      chainId,
      factory: receipt.contractAddress,
      admin,
      transactionHash: sent.hash,
      block: Number(receipt.blockNumber),
    };
    await fs.writeFile(
      new URL("deployment.json", dir),
      JSON.stringify(report, null, 2) + "\n"
    );
    await fs.writeFile(
      new URL(`../.local/${network}-factory.json`, import.meta.url),
      JSON.stringify(report, null, 2) + "\n"
    );
    await fs.writeFile(
      new URL("README.txt", dir),
      `Verify: ${profile.explorerUrl}/verifyContract?a=${report.factory}\nCompiler type: Solidity (Standard-Json-Input)\nCompiler: v${artifact.metadata.compiler.version}\nLicense: GNU GPLv3\nUpload BCoWFactory.standard-input.json\nContract: src/contracts/BCoWFactory.sol:BCoWFactory\nPaste constructor-arguments.txt without 0x.\nOptimizer: 500 runs; Cancun; viaIR disabled. Settings are embedded in the JSON.\nNo API key is required for browser verification.\nTransaction: ${profile.explorerUrl}/tx/${sent.hash}\n`
    );
    console.log(JSON.stringify(report, null, 2));
  }
}
await main().catch((error) => {
  console.error("Deployment failed: " + safeReason(error));
  process.exitCode = 1;
});
