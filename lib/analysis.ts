export type Account = { id: string; name: string };
export type Position = { id: string; accountId: string; symbol: string; name: string; type: string; qty: number; avg: number; price: number; buyDate?: string };
export type Live = Record<string, { price: number; change24h?: number }>;
export type Hist = Record<string, { t: number[]; p: number[] }>;
export type Point = { d: string; value: number; invested: number };

const day = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);

export function buildSeries(positions: Position[], hist: Hist) {
  const maps: Record<string, Map<string, number>> = {};
  const days = new Set<string>();
  const missing: string[] = [];
  for (const sym of new Set(positions.map((p) => p.symbol))) {
    const h = hist[sym];
    if (!h || !h.t.length) { missing.push(sym); continue; }
    const m = new Map<string, number>();
    h.t.forEach((t, i) => { const k = day(t); m.set(k, h.p[i]); days.add(k); });
    maps[sym] = m;
  }
  const last: Record<string, number> = {};
  const points: Point[] = [];
  for (const d of [...days].sort()) {
    for (const sym in maps) { const v = maps[sym].get(d); if (v !== undefined) last[sym] = v; }
    let value = 0, invested = 0;
    for (const p of positions) {
      if (last[p.symbol] === undefined || (p.buyDate && p.buyDate > d)) continue;
      value += p.qty * last[p.symbol];
      invested += p.qty * p.avg;
    }
    if (invested > 0) points.push({ d, value, invested });
  }
  return { points, missing };
}

export type Insight = { title: string; text: string; tone?: "up" | "down" };
const eur = (v: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(v);
const pc = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1).replace(".", ",") + "%";
const fdate = (d: string) => new Date(d).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });

export function analyze(positions: Position[], live: Live, points: Point[], accounts: Account[] = []): Insight[] {
  if (!positions.length) return [];
  const out: Insight[] = [];
  const rows = positions.map((p) => {
    const price = live[p.symbol]?.price ?? p.price, v = p.qty * price, c = p.qty * p.avg;
    return { p, v, c, plp: c > 0 ? ((v - c) / c) * 100 : 0, ch: live[p.symbol]?.change24h };
  });
  const total = rows.reduce((s, r) => s + r.v, 0);

  const withCh = rows.filter((r) => r.ch != null);
  if (withCh.length) {
    const delta = withCh.reduce((s, r) => s + (r.v - r.v / (1 + r.ch! / 100)), 0);
    out.push({ title: "Hoy", text: `Tu cartera ${delta >= 0 ? "sube" : "baja"} ${eur(Math.abs(delta))} (${pc((delta / (total - delta)) * 100)}) respecto al cierre anterior.`, tone: delta >= 0 ? "up" : "down" });
  }
  if (rows.length >= 2) {
    const sorted = [...rows].sort((a, b) => b.plp - a.plp);
    const best = sorted[0], worst = sorted[sorted.length - 1];
    out.push({ title: "Mejor posición", text: `${best.p.symbol}: ${pc(best.plp)} sobre lo invertido.`, tone: best.plp >= 0 ? "up" : "down" });
    out.push({ title: "Peor posición", text: `${worst.p.symbol}: ${pc(worst.plp)} sobre lo invertido.`, tone: worst.plp >= 0 ? "up" : "down" });
  }
  if (total > 0) {
    const top = [...rows].sort((a, b) => b.v - a.v)[0];
    const w = (top.v / total) * 100;
    const verdict = rows.length === 1 ? "Con una sola posición, todo depende de un único activo."
      : w > 40 ? "Es una concentración alta: un mal movimiento en ese activo afecta mucho al total."
      : w > 25 ? "Es una concentración notable, conviene vigilarla."
      : "El reparto entre posiciones es equilibrado.";
    out.push({ title: "Concentración", text: `Tu mayor posición es ${top.p.symbol}, con el ${w.toFixed(0)}% de la cartera. ${verdict}` });
    const byType: Record<string, number> = {};
    rows.forEach((r) => { byType[r.p.type] = (byType[r.p.type] ?? 0) + r.v; });
    out.push({ title: "Por tipo de activo", text: Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, v]) => `${t} ${((v / total) * 100).toFixed(0)}%`).join(" · ") });
  }
  if (total > 0 && accounts.length > 1) {
    const byAcc: Record<string, number> = {};
    rows.forEach((r) => { byAcc[r.p.accountId] = (byAcc[r.p.accountId] ?? 0) + r.v; });
    if (Object.keys(byAcc).length > 1) {
      const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? "Otra";
      out.push({ title: "Por cartera", text: Object.entries(byAcc).sort((a, b) => b[1] - a[1]).map(([id, v]) => `${name(id)} ${((v / total) * 100).toFixed(0)}%`).join(" · ") });
    }
  }
  if (points.length > 1) {
    const pl = points.map((p) => ({ d: p.d, r: ((p.value - p.invested) / p.invested) * 100 }));
    const best = pl.reduce((a, b) => (b.r > a.r ? b : a)), worst = pl.reduce((a, b) => (b.r < a.r ? b : a));
    out.push({ title: "Mejor momento del periodo", text: `${fdate(best.d)}, con ${pc(best.r)} de rentabilidad.`, tone: best.r >= 0 ? "up" : "down" });
    out.push({ title: "Peor momento del periodo", text: `${fdate(worst.d)}, con ${pc(worst.r)} de rentabilidad.`, tone: worst.r >= 0 ? "up" : "down" });
  }
  return out;
}
