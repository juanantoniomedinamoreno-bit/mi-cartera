import { NextResponse } from "next/server";
import { lookupAsset } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const symbols = (new URL(req.url).searchParams.get("symbols") ?? "")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 40);
  const result: Record<string, { name: string; type: string }> = {};
  await Promise.all(symbols.map(async (s) => { const r = await lookupAsset(s); if (r) result[s] = r; }));
  return NextResponse.json(result);
}
