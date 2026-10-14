import { NextResponse } from "next/server";
import { CRYPTO, ISIN, resolveIsin, toEur, yahooQuote } from "@/lib/market";

export const dynamic = "force-dynamic";

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
      const q = await yahooQuote(ticker);
      if (!q) return;
      const rate = await toEur(q.currency);
      if (!Number.isFinite(rate)) return;
      result[s] = { price: q.price * rate, change24h: q.prev ? ((q.price - q.prev) / q.prev) * 100 : undefined };
    })
  );
  return NextResponse.json(result);
}
