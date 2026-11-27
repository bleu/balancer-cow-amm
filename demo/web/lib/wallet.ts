"use client";
import {
  useConfig,
  useConnect,
  useConnectors,
  useConnection,
  usePublicClient,
  useSwitchChain,
} from "wagmi";
import { getWalletClient } from "wagmi/actions";
import {
  encodeFunctionData,
  formatEther,
  getAddress,
  maxUint256,
  parseAbi,
  parseEther,
  toHex,
  zeroAddress,
  type Abi,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { FACTORY_ABI, POOL_ABI, TOKEN_ABI } from "../../lib/shared.mjs";
import type { DemoConfig, Draft, Progress } from "./types";
import { savePool } from "./catalog";
export const factoryAbi = parseAbi(FACTORY_ABI),
  poolAbi = parseAbi(POOL_ABI),
  tokenAbi = parseAbi(TOKEN_ABI);
export class PoolActions {
  constructor(
    readonly publicClient: PublicClient,
    readonly wallet: WalletClient,
    readonly config: DemoConfig,
    readonly account: Address
  ) {}
  async guard() {
    if ((await this.wallet.getChainId()) !== this.config.chainId)
      throw Error("Wallet network changed. Reconnect before transacting.");
    const [current] = await this.wallet.getAddresses();
    if (current?.toLowerCase() !== this.account.toLowerCase())
      throw Error("Wallet account changed. Reopen this flow.");
  }
  async send(
    address: Address,
    abi: Abi,
    functionName: string,
    args: readonly unknown[],
    label: string,
    progress: Progress
  ) {
    await this.guard();
    progress(label + " — simulating…");
    const target = { address, abi, functionName, args, account: this.account };
    const { request } = await this.publicClient.simulateContract(target);
    const data = encodeFunctionData({ abi, functionName, args });
    const [gas, gasPrice] = await Promise.all([
      this.publicClient.estimateGas({
        account: this.account,
        to: address,
        data,
      }),
      this.publicClient.getGasPrice(),
    ]);
    progress(
      `${label}\nEstimated execution fee: ${formatEther(gas * gasPrice)} ${
        this.config.nativeCurrency.symbol
      }${
        this.config.chainId === 8453 ? " (plus Base L1 data fee)" : ""
      }\nConfirm in your wallet.`
    );
    await this.guard();
    const hash = await this.wallet.writeContract({
      ...request,
      gas,
      chain: this.wallet.chain,
      account: this.account,
    });
    progress(`${label}\nSubmitted ${hash}\nWaiting for confirmation…`);
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      confirmations: this.config.confirmations,
      pollingInterval: this.config.localDev ? 200 : 2000,
    });
    if (receipt.status !== "success") throw Error(label + " reverted");
    return receipt;
  }
  async supportsTradingOptions() {
    if (!this.config.factory) return false;
    try {
      return (
        (await this.publicClient.readContract({
          address: this.config.factory,
          abi: factoryAbi,
          functionName: "POOL_SETTINGS_VERSION",
        })) >= 2n
      );
    } catch {
      return false;
    }
  }
  async validateTradingOptions(fee: bigint, solverEnabled: boolean) {
    const modern = await this.supportsTradingOptions();
    if (!modern && (fee !== 999999000000000000n || solverEnabled))
      throw Error(
        "This factory predates custom fees and solver access. Configure the new factory version to use these options."
      );
    return modern;
  }
  async initialize(draft: Draft, progress: Progress) {
    const p = this.publicClient,
      c = this.config;
    if (draft.chainId !== c.chainId)
      throw Error("This setup belongs to a different chain");
    if (draft.creator.toLowerCase() !== this.account.toLowerCase())
      throw Error("Connect the creator wallet to resume");
    if (draft.factory.toLowerCase() !== c.factory?.toLowerCase())
      throw Error("This setup belongs to a different factory");
    const publicFee = BigInt(draft.publicSwapFee ?? "999999000000000000");
    const modern = await this.validateTradingOptions(
      publicFee,
      draft.solverOrdersEnabled ?? false
    );
    let address = await p.readContract({
      address: draft.factory,
      abi: factoryAbi,
      functionName: "createdPool",
      args: [this.account, draft.requestId],
    });
    if (address === zeroAddress) {
      await this.send(
        draft.factory,
        factoryAbi,
        "createPool",
        [
          draft.requestId,
          draft.name,
          draft.symbol,
          draft.curator,
          180,
          draft.feeBps ?? c.curatorFeeBps,
          ...(modern ? [publicFee, draft.solverOrdersEnabled ?? false] : []),
        ],
        "Create pool",
        progress
      );
      address = await p.readContract({
        address: draft.factory,
        abi: factoryAbi,
        functionName: "createdPool",
        args: [this.account, draft.requestId],
      });
    }
    if (address === zeroAddress)
      throw Error(
        "Creation address not available yet; retry the same stored request"
      );
    draft.address = getAddress(address);
    savePool(draft);
    const read = <
      T extends
        | "getController"
        | "creator"
        | "curator"
        | "orderDuration"
        | "curatorFeeBps"
        | "isFinalized"
        | "getCurrentTokens"
        | "MAX_FEE"
        | "getSwapFee"
        | "totalSupply"
    >(
      functionName: T
    ) => p.readContract({ address, abi: poolAbi, functionName });
    const unfinished = !(await read("isFinalized"));
    if (unfinished) {
      if (
        (await read("getController")).toLowerCase() !==
        this.account.toLowerCase()
      )
        throw Error("Connected wallet is not the initialization controller");
      for (let i = 0; i < c.assets.length; i++) {
        const asset = c.assets[i],
          args = [asset.address] as const;
        if (
          await p.readContract({
            address,
            abi: poolAbi,
            functionName: "isBound",
            args,
          })
        ) {
          if (
            (await p.readContract({
              address,
              abi: poolAbi,
              functionName: "getDenormalizedWeight",
              args,
            })) !== parseEther(String(asset.denorm))
          )
            throw Error("Existing bound weight differs from preset");
          continue;
        }
        const amount = BigInt(draft.seedAmounts[i]);
        if (
          (await p.readContract({
            address: asset.address,
            abi: tokenAbi,
            functionName: "allowance",
            args: [this.account, address],
          })) < amount
        )
          await this.send(
            asset.address,
            tokenAbi,
            "approve",
            [address, amount],
            "Approve " + asset.symbol + " seed",
            progress
          );
        await this.send(
          address,
          poolAbi,
          "bind",
          [asset.address, amount, parseEther(String(asset.denorm))],
          "Bind " + asset.symbol,
          progress
        );
      }
      const bound = await read("getCurrentTokens");
      if (
        bound.length !== 7 ||
        bound.some(
          (a) =>
            !c.assets.some((t) => t.address.toLowerCase() === a.toLowerCase())
        )
      )
        throw Error("Bound token set differs from MAG7 preset");
      if (
        (await read("creator")).toLowerCase() !== this.account.toLowerCase() ||
        (await read("curator")).toLowerCase() !== draft.curator.toLowerCase() ||
        (await read("orderDuration")) !== 180 ||
        (await read("curatorFeeBps")) !== (draft.feeBps ?? c.curatorFeeBps)
      )
        throw Error("Pool authority or settings differ from setup");
      for (let i = 0; i < c.assets.length; i++)
        if (
          (await p.readContract({
            address,
            abi: poolAbi,
            functionName: "getBalance",
            args: [c.assets[i].address],
          })) !== BigInt(draft.seedAmounts[i])
        )
          throw Error("Bound seed amount differs from saved setup");
      if ((await read("getSwapFee")) !== publicFee) {
        if (modern)
          throw Error("Fixed public swap fee differs from saved setup");
        await this.send(
          address,
          poolAbi,
          "setSwapFee",
          [publicFee],
          "Set protective swap fee",
          progress
        );
      }
      await this.send(
        address,
        poolAbi,
        "finalize",
        [],
        "Finalize MAG7 pool",
        progress
      );
      const settlement = await p.readContract({
        address: draft.factory,
        abi: factoryAbi,
        functionName: "SOLUTION_SETTLER",
      });
      const relayer = await p.readContract({
        address: settlement,
        abi: parseAbi(["function vaultRelayer() view returns(address)"]),
        functionName: "vaultRelayer",
      });
      for (const a of c.assets)
        if (
          (await p.readContract({
            address: a.address,
            abi: tokenAbi,
            functionName: "allowance",
            args: [address, relayer],
          })) !== maxUint256
        )
          throw Error("Finalized relayer allowance mismatch");
      if (
        (await read("totalSupply")) !== parseEther("100") ||
        (await p.readContract({
          address,
          abi: poolAbi,
          functionName: "balanceOf",
          args: [this.account],
        })) !== parseEther("100")
      )
        throw Error("Initial LP shares mismatch");
    }
    progress("Pool initialized. Saved only in this browser. " + address);
    return address;
  }
}
export function usePoolWallet(config: DemoConfig) {
  const wagmi = useConfig(),
    connection = useConnection(),
    connect = useConnect(),
    connectors = useConnectors(),
    switchChain = useSwitchChain(),
    publicClient = usePublicClient();
  async function ensure() {
    if (!publicClient) throw Error("RPC client unavailable");
    let chainId = connection.chainId;
    if (!connection.address) {
      if (!connectors[0])
        throw Error("Install an Ethereum wallet to use pool actions.");
      const connected = await connect.mutateAsync({ connector: connectors[0] });
      chainId = connected.chainId;
    }
    if (chainId !== config.chainId)
      await switchChain.mutateAsync({ chainId: config.chainId });
    const wallet = await getWalletClient(wagmi, { chainId: config.chainId });
    return new PoolActions(
      publicClient,
      wallet,
      config,
      wallet.account.address
    );
  }
  return {
    address: connection.address,
    chainId: connection.chainId,
    publicClient,
    ensure,
  };
}
export const requestId = () =>
  toHex(crypto.getRandomValues(new Uint8Array(32)));
