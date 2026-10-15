export type Account = { id: string; name: string };
export type Position = { id: string; accountId: string; symbol: string; name: string; type: string; qty: number; avg: number; price: number; buyDate?: string; lots?: Lot[]; ref?: number; refDate?: string };
export type Live = Record<string, { price: number; change24h?: number }>;
export type Hist = Record<string, { t: number[]; p: number[] }>;
export type Point = { d: string; value: number; invested: number };

const day = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);

export type Lot = { d?: string; q: number; p: number };

// Las ventas gastan primero las compras más antiguas (FIFO), como lo calcula getquin y como se declara en España.
type Queue = { q: number; c: number }[];
export function applyLot(queue: Queue, l: Lot) {
  if (l.q >= 0) { queue.push({ q: l.q, c: l.q * l.p }); return; }
  let s = -l.q;
  while (s > 1e-12 && queue.length) {
    const h = queue[0], take = Math.min(s, h.q);
    h.c -= h.c * (take / h.q); h.q -= take; s -= take;
    if (h.q <= 1e-12) queue.shift();
  }
}
const sums = (queue: Queue) => queue.reduce((a, x) => ({ qty: a.qty + x.q, cost: a.cost + x.c }), { qty: 0, cost: 0 });
const byDate = (a: Lot, b: Lot) => (a.d ?? "").localeCompare(b.d ?? "");
export function replay(lots: Lot[]) {
  const queue: Queue = [];
  for (const l of [...lots].sort(byDate)) applyLot(queue, l);
  const { qty, cost } = sums(queue);
  const q = Math.round(qty * 1e8) / 1e8;
  return { qty: q, avg: q > 1e-9 ? cost / qty : 0 };
}
export const lotsOf = (p: Position): Lot[] => (p.lots?.length ? p.lots : [{ d: p.buyDate, q: p.qty, p: p.avg }]);
export function withLots(p: Position, lots: Lot[]): Position {
  const { qty, avg } = replay(lots);
  const dated = lots.map((l) => l.d).filter(Boolean).sort()[0];
  return { ...p, lots, qty, avg, buyDate: dated };
}

// Junta las posiciones repetidas (mismo activo y misma cartera) recalculando cantidad y precio medio.
export function consolidate(ps: Position[]): Position[] {
  const out: Position[] = [];
  for (const p of ps) {
    const i = out.findIndex((x) => x.accountId === p.accountId && x.symbol === p.symbol);
    if (i < 0) out.push(p);
    else out[i] = withLots(out[i], [...lotsOf(out[i]), ...lotsOf(p)]);
  }
  return out;
}

// Añade una compra a mano: si ya existe ese activo en la cartera, se junta y se recalcula el precio medio.
export function mergeManual(prev: Position[], n: Position): Position[] {
  const lot: Lot = { d: n.buyDate, q: n.qty, p: n.avg };
  const i = prev.findIndex((p) => p.accountId === n.accountId && p.symbol === n.symbol);
  if (i < 0) return [...prev, { ...n, lots: [lot] }];
  return prev.map((p, k) => (k === i ? withLots(p, [...lotsOf(p), lot]) : p));
}

// Importación: una foto de la cartera sustituye al activo existente; un historial de operaciones se suma sin duplicar.
export function mergeImport(prev: Position[], inc: Position[], kind: "snapshot" | "transactions") {
  let added = 0, updated = 0, dup = 0;
  let out = [...prev];
  for (const n of inc) {
    const i = out.findIndex((p) => p.accountId === n.accountId && p.symbol === n.symbol);
    if (i < 0) { out.push(n); added++; continue; }
    const old = out[i];
    if (kind === "snapshot") { out[i] = { ...withLots(old, n.lots ?? lotsOf(n)), price: n.price, ref: n.ref ?? old.ref, refDate: n.refDate ?? old.refDate }; updated++; continue; }
    const have = [...lotsOf(old)], add: Lot[] = [];
    for (const l of n.lots ?? lotsOf(n)) {
      const k = have.findIndex((h) => (h.d ?? "") === (l.d ?? "") && h.q === l.q && h.p === l.p);
      if (k > -1) { have.splice(k, 1); dup++; } else add.push(l);
    }
    if (add.length) { out[i] = { ...withLots(old, [...lotsOf(old), ...add]), ref: n.ref ?? old.ref, refDate: n.refDate ?? old.refDate, price: n.price ?? old.price }; updated++; }
  }
  const before = out.length;
  out = out.filter((p) => p.qty > 1e-9);
  return { positions: out, added, updated, dup, closed: before - out.length };
}

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
  const st = positions.map((p) => ({ sym: p.symbol, ev: [...lotsOf(p)].sort(byDate), i: 0, queue: [] as Queue }));
  const last: Record<string, number> = {};
  const points: Point[] = [];
  for (const d of [...days].sort()) {
    for (const sym in maps) { const v = maps[sym].get(d); if (v !== undefined) last[sym] = v; }
    let value = 0, invested = 0;
    for (const x of st) {
      while (x.i < x.ev.length && (x.ev[x.i].d ?? "") <= d) { applyLot(x.queue, x.ev[x.i]); x.i++; }
      const { qty, cost } = sums(x.queue);
      if (last[x.sym] === undefined || qty <= 1e-9) continue;
      value += qty * last[x.sym];
      invested += cost;
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
