import { ASSETS } from "./shared.mjs";

// Pinned from Ondo's official token registry; never discover assets by ticker or logs.
export const ONDO_ASSETS = [
  ["NVDAon", "0xA9eE28C80f960B889dFbd1902055218cBa016F75"],
  ["MSFTon", "0x6Bfe75D1ad432050eA973C3A3DcD88F02e2444C3"],
  ["AAPLon", "0x390a684EF9cADE28A7AD0DFa61AB1Eb3842618c4"],
  ["AMZNon", "0x4553cFe1C09f37f38b12dC509F676964e392F8Fc"],
  ["GOOGLon", "0x091FC7778e6932d4009B087B191D1EE3bac5729A"],
  ["METAon", "0xD7dF5863A3e742F0c767768cDfcb63f09E0422f6"],
  ["TSLAon", "0x2494b603319d4D9F9715c9f4496d9E0364B59d93"],
].map(([symbol, address], i) => ({
  ...ASSETS[i],
  symbol,
  address,
  decimals: 18,
}));

export const SETTLEMENT = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41";
export const TRAMPOLINE = "0x60Bf78233f48eC42eE3F101b9a05eC7878728006";

export function networkProfile(chainId) {
  if (chainId === 56)
    return {
      name: "BNB Smart Chain",
      rpcUrl: "https://bsc-rpc.publicnode.com",
      explorerUrl: "https://bscscan.com",
      cowApi: "https://api.cow.fi/bnb/api/v1",
      coingeckoPlatform: "binance-smart-chain",
      assets: ONDO_ASSETS,
      nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    };
  if (chainId === 8453)
    return {
      name: "Base",
      rpcUrl: "https://mainnet.base.org",
      explorerUrl: "https://basescan.org",
      cowApi: "https://api.cow.fi/base/api/v1",
      coingeckoPlatform: "base",
      assets: ASSETS,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    };
  if ([31337, 31338].includes(chainId))
    return {
      ...networkProfile(8453),
      name: "Local Anvil",
      rpcUrl: "http://127.0.0.1:8546",
      explorerUrl: "",
    };
  throw Error("Only BNB, Base or explicit local fixtures supported");
}
