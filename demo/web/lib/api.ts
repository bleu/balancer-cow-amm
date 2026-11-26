export async function api<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw Error(data.error ?? "Request failed");
  return data as T;
}
export function errorText(error: unknown): string {
  if (error && typeof error === "object" && "shortMessage" in error)
    return String(error.shortMessage);
  return error instanceof Error ? error.message : "Transaction failed";
}
export const short = (address: string) =>
  address.slice(0, 6) + "…" + address.slice(-4);
export const money = (value: bigint | null | undefined) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(Number(value) / 1e8);
