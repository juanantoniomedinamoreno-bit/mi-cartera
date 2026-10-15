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

export const CRYPTO_NAMES: Record<string, string> = {
  BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", ADA: "Cardano", DOT: "Polkadot", AVAX: "Avalanche",
  MATIC: "Polygon", LINK: "Chainlink", XRP: "XRP", DOGE: "Dogecoin", LTC: "Litecoin", BNB: "BNB",
};
const QUOTE_TYPES: Record<string, string> = { EQUITY: "Acción", ETF: "ETF", MUTUALFUND: "Fondo de inversión", CRYPTOCURRENCY: "Cripto" };

export function guessType(symbol: string): string {
  return CRYPTO[symbol] ? "Cripto" : ISIN.test(symbol) ? "Fondo de inversión" : "Acción";
}

type Found = { name: string; type: string; symbol: string; exact: boolean };
type YQuote = { symbol?: string; shortname?: string; longname?: string; quoteType?: string };
const tokens = (t: string) => new Set(t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 1));

async function searchOnce(q: string, byName: boolean, upper: string): Promise<Found | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`,
      { headers: HEADERS, cache: "no-store" }
    );
    const quotes: YQuote[] = (await res.json())?.quotes ?? [];
    const typed = quotes.filter((x) => x.quoteType && QUOTE_TYPES[x.quoteType]);
    let pick: YQuote | undefined;
    if (byName) {
      const want = tokens(q);
      let best = -1;
      for (const x of typed) {
        const have = tokens(`${x.longname ?? ""} ${x.shortname ?? ""}`);
        let score = 0;
        want.forEach((w) => { if (have.has(w)) score++; });
        if (score > best) { best = score; pick = x; }
      }
      if (best < 1) pick = undefined;
    } else {
      pick = quotes.find((x) => x.symbol?.toUpperCase() === upper) ?? typed[0] ?? quotes[0];
    }
    if (!pick?.symbol) return null;
    return {
      name: pick.longname || pick.shortname || q,
      type: QUOTE_TYPES[pick.quoteType ?? ""] ?? "Otro",
      symbol: pick.symbol,
      exact: pick.symbol.toUpperCase() === upper,
    };
  } catch {
    return null;
  }
}

// Busca el activo por símbolo, ISIN o nombre y devuelve su nombre, tipo y símbolo de mercado.
export async function lookupAsset(raw: string): Promise<Found | null> {
  const q = raw.trim().replace(/\s+/g, " ");
  const upper = q.toUpperCase();
  if (!q) return null;
  if (CRYPTO[upper]) return { name: CRYPTO_NAMES[upper] ?? upper, type: "Cripto", symbol: upper, exact: true };
  const byCryptoName = Object.entries(CRYPTO_NAMES).find(([, n]) => n.toLowerCase() === q.toLowerCase());
  if (byCryptoName) return { name: byCryptoName[1], type: "Cripto", symbol: byCryptoName[0], exact: false };
  const byName = /\s/.test(q) || (q.length > 12 && !ISIN.test(upper));
  if (!byName) return searchOnce(q, false, upper);
  const words = q.replace(/[.,()]/g, " ").replace(/\s+/g, " ").trim().split(" ");
  const noise = /^(s|sa|sl|slu|inc|corp|ltd|plc|ag|nv|se|ie|acc|dist|eur|usd|gbp|clase|class|fund|fondo|r|p|s|a|b|c|d|i)$/i;
  const core = words.filter((w) => !noise.test(w) && !/^[A-Za-z]-?acc/i.test(w));
  const variants = [...new Set([words.join(" "), core.join(" "), core.slice(0, 4).join(" "), core.slice(0, 3).join(" "), core.slice(0, 2).join(" ")])].filter((v) => v.length >= 3);
  for (const v of variants) {
    const r = await searchOnce(v, true, upper);
    if (r) return r;
  }
  return null;
}
