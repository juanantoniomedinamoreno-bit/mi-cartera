export const CRYPTO: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", ADA: "cardano", DOT: "polkadot",
  AVAX: "avalanche-2", MATIC: "matic-network", LINK: "chainlink", XRP: "ripple",
  DOGE: "dogecoin", LTC: "litecoin", BNB: "binancecoin",
};
export const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; MiCartera/1.0)" };

export async function yahooRaw(symbol: string, range = "5d", interval = "1d") {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`,
      { headers: HEADERS, cache: "no-store" }
    );
    return (await res.json())?.chart?.result?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function yahooQuote(symbol: string) {
  const r = await yahooRaw(symbol);
  const meta = r?.meta;
  if (!meta?.regularMarketPrice) return null;
  return {
    price: meta.regularMarketPrice as number,
    prev: (meta.chartPreviousClose ?? meta.previousClose) as number | undefined,
    currency: (meta.currency || "USD") as string,
  };
}

export async function resolveIsin(isin: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${isin}&quotesCount=1&newsCount=0`,
      { headers: HEADERS, cache: "no-store" }
    );
    return (await res.json())?.quotes?.[0]?.symbol ?? null;
  } catch {
    return null;
  }
}

const fxCache: Record<string, number> = {};
export async function toEur(currency: string): Promise<number> {
  if (currency === "EUR") return 1;
  const pence = currency === "GBp" || currency === "GBX";
  const cur = pence ? "GBP" : currency;
  if (!(cur in fxCache)) fxCache[cur] = (await yahooQuote(`${cur}EUR=X`))?.price ?? NaN;
  return pence ? fxCache[cur] / 100 : fxCache[cur];
}
