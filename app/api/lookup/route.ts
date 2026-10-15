import { NextResponse } from "next/server";
import { lookupAsset } from "@/lib/market";

export const dynamic = "force-dynamic";

type Item = { q: string; ref?: number; d?: string };

async function run(items: Item[]) {
  const result: Record<string, { name: string; type: string; symbol: string; exact: boolean }> = {};
  for (let i = 0; i < items.length; i += 4) {
    await Promise.all(items.slice(i, i + 4).map(async (it) => {
      const r = await lookupAsset(it.q, it.ref && it.ref > 0 ? { p: it.ref, d: it.d } : undefined);
      if (r) result[it.q] = r;
    }));
  }
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const items: Item[] = Array.isArray(body?.items)
    ? body.items.map((x: Item) => ({ q: String(x.q), ref: Number(x.ref) || undefined, d: x.d ? String(x.d) : undefined }))
    : Array.isArray(body?.symbols) ? body.symbols.map((s: unknown) => ({ q: String(s) })) : [];
  return run(items.slice(0, 80));
}

export async function GET(req: Request) {
  const symbols = (new URL(req.url).searchParams.get("symbols") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 40);
  return run(symbols.map((q) => ({ q })));
}
