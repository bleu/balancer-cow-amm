import type { Asset, Draft } from "../web/lib/types";
export function customPortfolio(
  rows: {
    address: string;
    weight: string;
    decimals: number;
    symbol: string;
    name: string;
  }[]
): Asset[];
export function validateAssets(assets: Asset[]): Asset[];
export function setupAssets(draft: Draft, preset: Asset[]): Asset[];
