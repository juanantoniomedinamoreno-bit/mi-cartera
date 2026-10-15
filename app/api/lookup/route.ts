import { NextResponse } from "next/server";
import { lookupAsset } from "@/lib/market";

export const dynamic = "force-dynamic";

async function run(symbols: string[]) {
  const result: Record<string, { name: string; type: string; symbol: string; exact: boolean }> = {};
  for (let i = 0; i < symbols.length; i += 5) {
    await Promise.all(symbols.slice(i, i + 5).map(async (s) => { const r = await lookupAsset(s); if (r) result[s] = r; }));
  }
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const symbols: string[] = Array.isArray(body?.symbols) ? body.symbols.map(String).slice(0, 80) : [];
  return run(symbols);
}

export async function GET(req: Request) {
  const symbols = (new URL(req.url).searchParams.get("symbols") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 40);
  return run(symbols);
}
