import { NextResponse } from "next/server";
import { CRYPTO, ISIN, resolveIsin, toEur, yahooRaw } from "@/lib/market";

export const dynamic = "force-dynamic";

const RANGES: Record<string, [string, string]> = {
  "1w": ["5d", "1d"], "1m": ["1mo", "1d"], "ytd": ["ytd", "1d"], "max": ["max", "1mo"], "6m": ["6mo", "1d"], "1y": ["1y", "1d"], "5y": ["5y", "1wk"],
};

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const symbols = (sp.get("symbols") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const [range, interval] = RANGES[sp.get("range") ?? "1y"] ?? RANGES["1y"];
  const result: Record<string, { t: number[]; p: number[] }> = {};

  await Promise.all(
    symbols.map(async (s) => {
      const ticker = CRYPTO[s] ? `${s}-EUR` : ISIN.test(s) ? await resolveIsin(s) : s;
      if (!ticker) return;
      const r = await yahooRaw(ticker, range, interval);
      const ts: number[] | undefined = r?.timestamp;
      const close: (number | null)[] | undefined = r?.indicators?.quote?.[0]?.close;
      if (!ts || !close) return;
      const rate = await toEur(r.meta?.currency || "EUR");
      if (!Number.isFinite(rate)) return;
      const t: number[] = [], p: number[] = [];
      ts.forEach((x, i) => { if (close[i] != null) { t.push(x); p.push(close[i]! * rate); } });
      if (t.length) result[s] = { t, p };
    })
  );
  return NextResponse.json(result);
}
