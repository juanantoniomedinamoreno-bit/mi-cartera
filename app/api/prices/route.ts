import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CRYPTO: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", ADA: "cardano", DOT: "polkadot",
  AVAX: "avalanche-2", MATIC: "matic-network", LINK: "chainlink", XRP: "ripple",
  DOGE: "dogecoin", LTC: "litecoin", BNB: "binancecoin",
};
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; MiCartera/1.0)" };

type Quote = { price: number; prev?: number; currency: string };

async function yahooChart(symbol: string): Promise<Quote | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
      { headers: HEADERS, cache: "no-store" }
    );
    const meta = (await res.json())?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;
    return {
      price: meta.regularMarketPrice,
      prev: meta.chartPreviousClose ?? meta.previousClose,
      currency: meta.currency || "USD",
    };
  } catch {
    return null;
  }
}

async function resolveIsin(isin: string): Promise<string | null> {
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
async function toEur(currency: string): Promise<number> {
  if (currency === "EUR") return 1;
  const pence = currency === "GBp" || currency === "GBX";
  const cur = pence ? "GBP" : currency;
  if (!(cur in fxCache)) {
    const q = await yahooChart(`${cur}EUR=X`);
    fxCache[cur] = q?.price ?? NaN;
  }
  const rate = fxCache[cur];
  return pence ? rate / 100 : rate;
}

export async function GET(req: Request) {
  const symbols = (new URL(req.url).searchParams.get("symbols") ?? "")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const result: Record<string, { price: number; change24h?: number }> = {};

  const cryptos = symbols.filter((s) => CRYPTO[s]);
  if (cryptos.length) {
    try {
      const ids = cryptos.map((s) => CRYPTO[s]).join(",");
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=eur&include_24hr_change=true`,
        { cache: "no-store" }
      );
      const data = await res.json();
      for (const s of cryptos) {
        const d = data[CRYPTO[s]];
        if (d) result[s] = { price: d.eur, change24h: d.eur_24h_change };
      }
    } catch {}
  }

  await Promise.all(
    symbols.filter((s) => !CRYPTO[s]).map(async (s) => {
      const ticker = ISIN.test(s) ? await resolveIsin(s) : s;
      if (!ticker) return;
      const q = await yahooChart(ticker);
      if (!q) return;
      const rate = await toEur(q.currency);
      if (!Number.isFinite(rate)) return;
      result[s] = {
        price: q.price * rate,
        change24h: q.prev ? ((q.price - q.prev) / q.prev) * 100 : undefined,
      };
    })
  );

  return NextResponse.json(result);
}
