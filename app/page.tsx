"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Position = { id: string; symbol: string; name: string; type: string; qty: number; avg: number; price: number };
type Live = Record<string, { price: number; change24h?: number }>;

const KEY = "gq_positions_v2";
const COLORS = ["#0f8a5f", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];
const money = (v: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(v);
const pct = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2).replace(".", ",") + "%";
const cls = (v: number) => (v >= 0 ? "up" : "down");

export default function Home() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [live, setLive] = useState<Live>({});
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState<Date | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    try { setPositions(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) try { localStorage.setItem(KEY, JSON.stringify(positions)); } catch {}
  }, [positions, loaded]);

  const symbolsKey = useMemo(() => [...new Set(positions.map((p) => p.symbol))].sort().join(","), [positions]);

  const refresh = useCallback(async () => {
    if (!symbolsKey) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/prices?symbols=${encodeURIComponent(symbolsKey)}`);
      setLive(await res.json());
      setUpdated(new Date());
    } catch {}
    setLoading(false);
  }, [symbolsKey]);

  useEffect(() => {
    if (!loaded) return;
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [loaded, refresh]);

  const priceOf = (p: Position) => live[p.symbol]?.price ?? p.price;

  const totals = useMemo(() => {
    let v = 0, c = 0;
    positions.forEach((p) => { v += p.qty * (live[p.symbol]?.price ?? p.price); c += p.qty * p.avg; });
    return { v, c, pl: v - c, plp: c > 0 ? ((v - c) / c) * 100 : 0 };
  }, [positions, live]);

  const items = positions.map((p) => ({ n: p.symbol, v: p.qty * priceOf(p) })).filter((i) => i.v > 0);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const symbol = String(d.get("symbol")).trim().toUpperCase();
    const qty = parseFloat(String(d.get("qty")));
    const avg = parseFloat(String(d.get("avg")));
    if (!symbol || !(qty > 0) || !(avg >= 0)) return;
    setPositions((prev) => [...prev, {
      id: crypto.randomUUID(), symbol, name: String(d.get("name")).trim() || symbol,
      type: String(d.get("type")), qty, avg, price: avg,
    }]);
    dlg.current?.close();
    e.currentTarget.reset();
  }

  const setManual = (id: string, v: number) =>
    v >= 0 && setPositions((prev) => prev.map((p) => (p.id === id ? { ...p, price: v } : p)));

  let off = 25;
  return (
    <div className="wrap">
      <header>
        <h1>Mi cartera</h1>
        <div className="row">
          <button className="ghost" onClick={refresh} disabled={loading}>{loading ? "Actualizando…" : "Actualizar precios"}</button>
          <button className="btn" onClick={() => dlg.current?.showModal()}>Añadir posición</button>
        </div>
      </header>

      <section className="hero">
        <div className="label">Valor total{updated && ` · precios de las ${updated.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`}</div>
        <div className="total">{money(totals.v)}</div>
        <div className="meta">
          <div><span className="label">Invertido</span><b>{money(totals.c)}</b></div>
          <div><span className="label">Ganancia / pérdida</span><b className={cls(totals.pl)}>{money(totals.pl)}</b></div>
          <div><span className="label">Rentabilidad</span><b className={cls(totals.plp)}>{pct(totals.plp)}</b></div>
        </div>
      </section>

      <div className="grid">
        <section className="panel">
          <h2>Distribución</h2>
          {items.length === 0 || totals.v <= 0 ? <p className="empty">Sin datos todavía</p> : (
            <>
              <svg viewBox="0 0 42 42" width="100%" style={{ maxWidth: 220, display: "block", margin: "0 auto" }} role="img" aria-label="Distribución de la cartera">
                <circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--line)" strokeWidth="6" />
                {items.map((i, k) => {
                  const share = (i.v / totals.v) * 100;
                  const el = <circle key={k} cx="21" cy="21" r="15.915" fill="none" stroke={COLORS[k % COLORS.length]} strokeWidth="6" strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={off} />;
                  off -= share;
                  return el;
                })}
              </svg>
              <ul className="legend">
                {items.map((i, k) => (
                  <li key={k}><span><span className="dot" style={{ background: COLORS[k % COLORS.length] }} />{i.n}</span><span>{((i.v / totals.v) * 100).toFixed(1).replace(".", ",")}%</span></li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="panel">
          <h2>Posiciones</h2>
          <div className="scroll">
            {positions.length === 0 ? <p className="empty">Aún no hay posiciones. Pulsa «Añadir posición» para crear la primera.</p> : (
              <table>
                <thead><tr><th>Activo</th><th>Cantidad</th><th>P. medio</th><th>Precio actual</th><th>24h</th><th>Valor</th><th>P/L</th><th /></tr></thead>
                <tbody>
                  {positions.map((p) => {
                    const lv = live[p.symbol];
                    const price = priceOf(p), val = p.qty * price, cost = p.qty * p.avg, g = val - cost, gp = cost > 0 ? (g / cost) * 100 : 0;
                    return (
                      <tr key={p.id}>
                        <td><div className="sym">{p.symbol}</div><div className="nm">{p.name} · {p.type}</div></td>
                        <td>{p.qty}</td>
                        <td>{money(p.avg)}</td>
                        <td>
                          {lv ? <><span className="live" title="Precio en vivo" />{money(lv.price)}</> : (
                            <><span className="manual" title="Precio manual: no se encontró en vivo" />
                              <input type="number" step="any" min="0" defaultValue={p.price} key={p.price}
                                onBlur={(e) => setManual(p.id, parseFloat(e.target.value))} aria-label={`Precio manual de ${p.symbol}`} /></>
                          )}
                        </td>
                        <td className={lv?.change24h != null ? cls(lv.change24h) : ""}>{lv?.change24h != null ? pct(lv.change24h) : "—"}</td>
                        <td>{money(val)}</td>
                        <td className={cls(g)}>{money(g)}<div className="nm">{pct(gp)}</div></td>
                        <td><button className="x" aria-label={`Eliminar ${p.symbol}`} onClick={() => setPositions((prev) => prev.filter((x) => x.id !== p.id))}>×</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <p className="note">Punto verde: precio en vivo, convertido a euros. Punto gris: no se encontró ese símbolo; escribe el precio a mano. Los datos se guardan en este navegador.</p>
        </section>
      </div>

      <dialog ref={dlg}>
        <form onSubmit={onSubmit}>
          <h2>Añadir posición</h2>
          <label>Símbolo o ISIN<input name="symbol" required placeholder="AAPL, BTC, VWCE.DE, IE00B03HCZ61…" /></label>
          <label>Nombre (opcional)<input name="name" placeholder="Apple" /></label>
          <div className="two">
            <label>Tipo<select name="type"><option>Acción</option><option>ETF</option><option>Fondo de inversión</option><option>Cripto</option><option>Otro</option></select></label>
            <label>Cantidad / participaciones<input name="qty" type="number" step="any" min="0" required /></label>
          </div>
          <label>Precio medio de compra (en €)<input name="avg" type="number" step="any" min="0" required /></label>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 6 }}>
            <button type="button" className="ghost" onClick={() => dlg.current?.close()}>Cancelar</button>
            <button className="btn" type="submit">Guardar</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
