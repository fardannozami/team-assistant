/**
 * Today's USD → IDR rate for fee statements, from open.er-api.com (free, no
 * key, updated daily). Cached for an hour; null when the service is down so
 * a statement still renders in USD alone.
 */
const RATE_URL = "https://open.er-api.com/v6/latest/USD";
const TTL_MS = 60 * 60 * 1000;

export type UsdRate = { idr: number; updatedAt: Date };

let cached: { rate: UsdRate; at: number } | null = null;

export async function usdToIdr(): Promise<UsdRate | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.rate;
  try {
    const res = await fetch(RATE_URL, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return cached?.rate ?? null;
    const body = (await res.json()) as { result?: string; rates?: { IDR?: number }; time_last_update_unix?: number };
    const idr = body.rates?.IDR;
    if (body.result !== "success" || !idr || !Number.isFinite(idr)) return cached?.rate ?? null;
    const rate = { idr, updatedAt: new Date((body.time_last_update_unix ?? Date.now() / 1000) * 1000) };
    cached = { rate, at: Date.now() };
    return rate;
  } catch {
    // An older rate beats none; without any the PDF just leaves Rupiah out.
    return cached?.rate ?? null;
  }
}

export const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
