import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { Cow } from "../lib/cow.mjs";
import {
  orderTuple,
  hashOrder,
  buildAppData,
} from "../../script/local/curated-order.mjs";
import { ASSETS, ZERO } from "../lib/shared.mjs";
test("API payload strips settlement owner prefix, retains canonical hooks and zero fee", async () => {
  const signer = new ethers.Wallet("0x" + "11".repeat(32));
  const address = "0x0000000000000000000000000000000000000022",
    settlement = "0x0000000000000000000000000000000000000033";
  const pool = { address, hooksTrampoline: async () => address };
  let sent;
  const cow = new Cow(
    { chainId: 8453, cowApi: "https://example.invalid/api/v1" },
    {
      request: async (url, opts) => {
        sent = { url, ...opts };
        return "uid";
      },
    }
  );
  const o = {
    sellToken: ASSETS[0].address,
    buyToken: ASSETS[1].address,
    receiver: ZERO,
    sellAmount: "1000000",
    buyAmount: "2000000",
    validTo: 10000,
    appData: ethers.constants.HashZero,
    feeAmount: "0",
    kind: ethers.utils.id("sell"),
    partiallyFillable: false,
    sellTokenBalance: ethers.utils.id("erc20"),
    buyTokenBalance: ethers.utils.id("erc20"),
  };
  const signed = await cow.sign(o, pool, signer, "7", settlement);
  await cow.post(address, signed, "7");
  assert.equal(ethers.utils.hexDataLength(signed.uid), 56);
  assert.equal(sent.body.from, address);
  assert.equal(sent.body.feeAmount, "0");
  assert.equal(sent.body.signingScheme, "eip1271");
  const [order, epoch, sig] = ethers.utils.defaultAbiCoder.decode(
    [orderTuple, "uint256", "bytes"],
    sent.body.signature
  );
  assert.equal(epoch.toString(), "7");
  assert.equal(
    order.appData,
    ethers.utils.keccak256(ethers.utils.toUtf8Bytes(sent.body.appData))
  );
  assert.equal(ethers.utils.hexDataLength(sig), 65);
  const h0 = hashOrder(
    { ...o, appData: ethers.constants.HashZero },
    8453,
    settlement
  );
  assert.equal(sent.body.appData, buildAppData(address, h0, o.buyAmount));
});
