import { isAddress, isHex } from "viem";
import type { SavedPool, Draft } from "./types";
export const storageKey = "folio-cow-pools-v1";
export function readSaved(): SavedPool[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(value)
      ? value.filter(
          (p): p is SavedPool =>
            !!p &&
            typeof p === "object" &&
            typeof p.chainId === "number" &&
            typeof p.name === "string" &&
            (!p.address || isAddress(p.address))
        )
      : [];
  } catch {
    return [];
  }
}
export function isDraft(value: SavedPool): value is Draft {
  return !!(
    value.requestId &&
    isHex(value.requestId) &&
    value.factory &&
    value.creator &&
    value.curator &&
    value.symbol &&
    value.seedAmounts
  );
}
export function savePool(entry: SavedPool) {
  const list = readSaved().filter(
    (p) =>
      !(
        p.chainId === entry.chainId &&
        ((entry.requestId && p.requestId === entry.requestId) ||
          (entry.address &&
            p.address?.toLowerCase() === entry.address.toLowerCase()))
      )
  );
  list.push(entry);
  localStorage.setItem(storageKey, JSON.stringify(list));
  window.dispatchEvent(new Event("folio:catalog"));
}
