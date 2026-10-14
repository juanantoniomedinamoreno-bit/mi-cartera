"use client";
import Chart from "./Chart";
import { parseCsv } from "@/lib/csv";
import { getFb } from "@/lib/firebase";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { analyze, buildSeries, type Account, type Hist, type Live, type Position } from "@/lib/analysis";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";


const KEY = "gq_positions_v2";
const KEYA = "gq_accounts_v1";
const MAIN: Account = { id: "main", name: "Principal" };
const fixPositions = (ps: Position[]): Position[] => ps.map((p) => ({ ...p, accountId: p.accountId ?? "main" }));
const ensureAccounts = (accs: Account[], ps: Position[]): Account[] => {
  const out = accs.length ? [...accs] : [MAIN];
  for (const p of ps) if (!out.some((a) => a.id === p.accountId)) out.push({ id: p.accountId, name: p.accountId === "main" ? "Principal" : "Cartera" });
  return out;
};
const COLORS = ["#0f8a5f", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];
const money = (v: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(v);
const pct = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2).replace(".", ",") + "%";
const cls = (v: number) => (v >= 0 ? "up" : "down");

export default function Home() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([MAIN]);
  const [tab, setTab] = useState("all");
  const [live, setLive] = useState<Live>({});
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [fbOn, setFbOn] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [saveState, setSaveState] = useState<"" | "saving" | "saved" | "error">("");
  const [range, setRange] = useState("1y");
  const [hist, setHist] = useState<Hist>({});
  const [histLoading, setHistLoading] = useState(false);
  const dlg = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState("");

  useEffect(() => {
    let lp: Position[] = [], la: Account[] = [];
    try { lp = fixPositions(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch {}
    try { la = JSON.parse(localStorage.getItem(KEYA) || "[]"); } catch {}
    setPositions(lp);
    setAccounts(ensureAccounts(la, lp));
    setLoaded(true);
    const fb = getFb();
    if (!fb) { setUser(null); return; }
    setFbOn(true);
    return onAuthStateChanged(fb.auth, async (u) => {
      if (!u) { setUser(null); setCloudReady(false); return; }
      try {
        const snap = await getDoc(doc(fb.db, "users", u.uid));
        const cloud: Position[] = snap.exists() ? fixPositions(snap.data().positions ?? []) : [];
        const cloudAcc: Account[] = snap.exists() ? (snap.data().accounts ?? []) : [];
        let local: Position[] = [], localAcc: Account[] = [];
        try { local = fixPositions(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch {}
        try { localAcc = JSON.parse(localStorage.getItem(KEYA) || "[]"); } catch {}
        const ids = new Set(cloud.map((p) => p.id));
        const merged = [...cloud, ...local.filter((p) => !ids.has(p.id))];
        const aids = new Set(cloudAcc.map((a) => a.id));
        setPositions(merged);
        setAccounts(ensureAccounts([...cloudAcc, ...localAcc.filter((a) => !aids.has(a.id))], merged));
        try { localStorage.removeItem(KEY); localStorage.removeItem(KEYA); } catch {}
        setUser(u);
        setCloudReady(true);
      } catch {
        setAuthError("No se pudieron cargar tus datos de la nube. Revisa la configuración de Firestore.");
        setUser(u);
      }
    });
  }, []);

  useEffect(() => {
    if (!loaded || user === undefined) return;
    if (user) {
      if (!cloudReady) return;
      const fb = getFb();
      if (!fb) return;
      setSaveState("saving");
      const t = setTimeout(async () => {
        try {
          await setDoc(doc(fb.db, "users", user.uid), { positions: JSON.parse(JSON.stringify(positions)), accounts, updatedAt: Date.now() });
          setSaveState("saved");
        } catch { setSaveState("error"); }
      }, 600);
      return () => clearTimeout(t);
    }
    try { localStorage.setItem(KEY, JSON.stringify(positions)); localStorage.setItem(KEYA, JSON.stringify(accounts)); } catch {}
  }, [positions, accounts, loaded, user, cloudReady]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const buf = await f.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("\uFFFD")) text = new TextDecoder("windows-1252").decode(buf);
    const res = parseCsv(text);
    if (res.error) { setImportMsg(res.error); return; }
    let accs = [...accounts];
    const target = tab !== "all" ? tab : accs[0]?.id ?? "main";
    const mapped: Position[] = res.positions.map(({ account, ...p }) => {
      let accountId = target;
      if (account) {
        let a = accs.find((x) => x.name.toLowerCase() === account.toLowerCase());
        if (!a) { a = { id: crypto.randomUUID(), name: account }; accs = [...accs, a]; }
        accountId = a.id;
      }
      return { ...p, accountId, id: crypto.randomUUID() };
    });
    setAccounts(accs);
    setPositions((prev) => [...prev, ...mapped]);
    setImportMsg(`Se importaron ${res.positions.length} posiciones` + (res.skipped ? ` (${res.skipped} filas ignoradas por datos incompletos)` : "") + ".");
  }

  function downloadTemplate() {
    const csv = "\uFEFFSímbolo;Nombre;Tipo;Cantidad;Precio medio;Fecha compra;Cuenta\nAAPL;Apple;Acción;10;150,50;2024-03-15;Degiro\nIE00B03HCZ61;Fondo de ejemplo;Fondo de inversión;25,5;42,10;15/06/2023;MyInvestor\nBTC;Bitcoin;Cripto;0,05;30000;2023-01-10;Cripto\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "plantilla-cartera.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const login = async () => {
    const fb = getFb();
    if (!fb) return;
    setAuthError("");
    try { await signInWithPopup(fb.auth, new GoogleAuthProvider()); }
    catch (e) {
      const code = (e as { code?: string })?.code ?? "error";
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") setAuthError(`No se pudo iniciar sesión (${code}).`);
    }
  };
  const logout = async () => {
    const fb = getFb();
    if (!fb) return;
    setPositions([]); setAccounts([MAIN]); setTab("all"); setCloudReady(false); setSaveState("");
    await signOut(fb.auth);
  };

  const activeTab = tab === "all" || accounts.some((a) => a.id === tab) ? tab : "all";
  const view = useMemo(() => (activeTab === "all" ? positions : positions.filter((p) => p.accountId === activeTab)), [positions, activeTab]);
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "—";
  const tabName = activeTab === "all" ? "Agregado" : accName(activeTab);

  function addAccount() {
    const name = prompt("Nombre de la nueva cartera (por ejemplo, MyInvestor o Degiro)")?.trim();
    if (!name) return;
    const a = { id: crypto.randomUUID(), name };
    setAccounts((prev) => [...prev, a]);
    setTab(a.id);
  }
  function renameAccount() {
    const name = prompt("Nuevo nombre de la cartera", accName(activeTab))?.trim();
    if (name) setAccounts((prev) => prev.map((a) => (a.id === activeTab ? { ...a, name } : a)));
  }
  function deleteAccount() {
    const n = positions.filter((p) => p.accountId === activeTab).length;
    if (!confirm(`¿Eliminar la cartera «${accName(activeTab)}» y sus ${n} posiciones? No se puede deshacer.`)) return;
    setPositions((prev) => prev.filter((p) => p.accountId !== activeTab));
    setAccounts((prev) => prev.filter((a) => a.id !== activeTab));
    setTab("all");
  }

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

  useEffect(() => {
    if (!loaded || !symbolsKey) { setHist({}); return; }
    let cancelled = false;
    setHistLoading(true);
    fetch(`/api/history?symbols=${encodeURIComponent(symbolsKey)}&range=${range}`)
      .then((r) => r.json())
      .then((h) => { if (!cancelled) setHist(h); })
      .catch(() => { if (!cancelled) setHist({}); })
      .finally(() => { if (!cancelled) setHistLoading(false); });
    return () => { cancelled = true; };
  }, [loaded, symbolsKey, range]);

  const series = useMemo(() => buildSeries(view, hist), [view, hist]);
  const insights = useMemo(() => analyze(view, live, series.points, accounts), [view, live, series.points, accounts]);

  const priceOf = (p: Position) => live[p.symbol]?.price ?? p.price;

  const totals = useMemo(() => {
    let v = 0, c = 0, day = 0;
    view.forEach((p) => {
      const val = p.qty * (live[p.symbol]?.price ?? p.price);
      v += val; c += p.qty * p.avg;
      const ch = live[p.symbol]?.change24h;
      if (ch != null) day += val - val / (1 + ch / 100);
    });
    return { v, c, pl: v - c, plp: c > 0 ? ((v - c) / c) * 100 : 0, day, dayp: v - day > 0 ? (day / (v - day)) * 100 : 0 };
  }, [view, live]);

  const items = view.map((p) => ({ n: p.symbol, v: p.qty * priceOf(p) })).filter((i) => i.v > 0);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const symbol = String(d.get("symbol")).trim().toUpperCase();
    const qty = parseFloat(String(d.get("qty")));
    const avg = parseFloat(String(d.get("avg")));
    if (!symbol || !(qty > 0) || !(avg >= 0)) return;
    setPositions((prev) => [...prev, {
      id: crypto.randomUUID(), symbol, name: String(d.get("name")).trim() || symbol,
      accountId: String(d.get("account") || accounts[0]?.id || "main"),
      type: String(d.get("type")), qty, avg, price: avg,
      buyDate: String(d.get("date") || "") || undefined,
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
        <div className="row" style={{ flexWrap: "wrap" }}>
          {fbOn && user && (
            <span className="label">
              {user.displayName ?? user.email}
              {saveState === "saving" && " · guardando…"}{saveState === "saved" && " · guardado ✓"}{saveState === "error" && " · error al guardar"}
            </span>
          )}
          {fbOn && user === null && <button className="ghost" onClick={login}>Iniciar sesión con Google</button>}
          {fbOn && user && <button className="ghost" onClick={logout}>Salir</button>}
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onFile} />
          <button className="ghost" onClick={() => fileRef.current?.click()}>Importar CSV</button>
          <button className="ghost" onClick={refresh} disabled={loading}>{loading ? "Actualizando…" : "Actualizar precios"}</button>
          <button className="btn" onClick={() => dlg.current?.showModal()}>Añadir posición</button>
        </div>
      </header>

      {importMsg && (
        <p role="status" className="note" style={{ fontSize: 14, color: "var(--text)" }}>
          {importMsg} <button className="ghost" style={{ padding: "2px 8px", marginLeft: 6 }} onClick={() => setImportMsg("")}>Cerrar</button>
        </p>
      )}
      {authError && <p className="down" role="alert">{authError}</p>}

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={activeTab === "all"} className={activeTab === "all" ? "tab on" : "tab"} onClick={() => setTab("all")}>Agregado</button>
        {accounts.map((a) => (
          <button key={a.id} role="tab" aria-selected={activeTab === a.id} className={activeTab === a.id ? "tab on" : "tab"} onClick={() => setTab(a.id)}>{a.name}</button>
        ))}
        <button className="tab" onClick={addAccount}>+ Agregar cartera</button>
        {activeTab !== "all" && (
          <span className="row" style={{ marginLeft: "auto" }}>
            <button className="ghost" style={{ padding: "3px 10px" }} onClick={renameAccount}>Renombrar</button>
            {accounts.length > 1 && <button className="ghost" style={{ padding: "3px 10px" }} onClick={deleteAccount}>Eliminar cartera</button>}
          </span>
        )}
      </div>

      <section className="hero">
        <div className="label">{tabName} · Valor total{updated && ` · precios de las ${updated.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`}</div>
        <div className="total">{money(totals.v)}</div>
        {totals.day !== 0 && <div className={cls(totals.day)}>{totals.day >= 0 ? "↗" : "↘"} {pct(totals.dayp)} ({money(totals.day)}) hoy</div>}
        <div className="meta">
          <div><span className="label">Invertido</span><b>{money(totals.c)}</b></div>
          <div><span className="label">Ganancia / pérdida</span><b className={cls(totals.pl)}>{money(totals.pl)}</b></div>
          <div><span className="label">Rentabilidad</span><b className={cls(totals.plp)}>{pct(totals.plp)}</b></div>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Evolución</h2>
          <div className="row">
            {[["1w", "1S"], ["1m", "1M"], ["6m", "6M"], ["ytd", "YTD"], ["1y", "1A"], ["5y", "5A"], ["max", "Máx"]].map(([k, l]) => (
              <button key={k} className={range === k ? "btn" : "ghost"} style={{ padding: "5px 12px" }} onClick={() => setRange(k)}>{l}</button>
            ))}
          </div>
        </div>
        {view.length === 0 ? <p className="empty">Añade posiciones para ver su evolución.</p>
          : histLoading ? <p className="empty">Cargando histórico…</p>
          : <Chart points={series.points} />}
        {series.missing.length > 0 && !histLoading && view.length > 0 && (
          <p className="note">Sin histórico para: {series.missing.join(", ")}. No se incluyen en el gráfico.</p>
        )}
        <p className="note">Se calcula con los precios históricos y la cantidad actual de cada posición desde su fecha de compra. Si una posición no tiene fecha, se cuenta desde el inicio del periodo. Los activos en otras divisas usan el tipo de cambio de hoy.</p>
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
            {view.length === 0 ? <p className="empty">Aún no hay posiciones en esta cartera. Pulsa «Añadir posición» para crear la primera.</p> : (
              <table>
                <thead><tr><th>Activo</th><th>Cantidad</th><th>P. medio</th><th>Precio actual</th><th>24h</th><th>Valor</th><th>P/L</th><th /></tr></thead>
                <tbody>
                  {view.map((p) => {
                    const lv = live[p.symbol];
                    const price = priceOf(p), val = p.qty * price, cost = p.qty * p.avg, g = val - cost, gp = cost > 0 ? (g / cost) * 100 : 0;
                    return (
                      <tr key={p.id}>
                        <td><div className="sym">{p.symbol}</div><div className="nm">{p.name} · {p.type}</div>{activeTab === "all" && accounts.length > 1 && <span className="acc">{accName(p.accountId)}</span>}</td>
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
          <p className="note">Punto verde: precio en vivo, convertido a euros. Punto gris: no se encontró ese símbolo; escribe el precio a mano. <button className="ghost" style={{ padding: "2px 8px" }} onClick={downloadTemplate}>Descargar plantilla CSV</button> Si no inicias sesión, los datos se guardan solo en este navegador.</p>
        </section>
      </div>

      {insights.length > 0 && (
        <section className="panel" style={{ marginTop: 16 }}>
          <h2>Análisis de la cartera</h2>
          <div className="insights">
            {insights.map((i, k) => (
              <div key={k} className="insight">
                <div className="label">{i.title}</div>
                <div className={i.tone ?? ""}>{i.text}</div>
              </div>
            ))}
          </div>
          <p className="note">Es un resumen automático de tus datos, no asesoramiento financiero. La rentabilidad pasada no garantiza la futura.</p>
        </section>
      )}

      <dialog ref={dlg}>
        <form onSubmit={onSubmit}>
          <h2>Añadir posición</h2>
          <label>Cartera<select name="account" key={activeTab} defaultValue={activeTab === "all" ? accounts[0]?.id : activeTab}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label>Símbolo o ISIN<input name="symbol" required placeholder="AAPL, BTC, VWCE.DE, IE00B03HCZ61…" /></label>
          <label>Nombre (opcional)<input name="name" placeholder="Apple" /></label>
          <div className="two">
            <label>Tipo<select name="type"><option>Acción</option><option>ETF</option><option>Fondo de inversión</option><option>Cripto</option><option>Otro</option></select></label>
            <label>Cantidad / participaciones<input name="qty" type="number" step="any" min="0" required /></label>
          </div>
          <label>Precio medio de compra (en €)<input name="avg" type="number" step="any" min="0" required /></label>
          <label>Fecha de compra (opcional)<input name="date" type="date" /></label>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 6 }}>
            <button type="button" className="ghost" onClick={() => dlg.current?.close()}>Cancelar</button>
            <button className="btn" type="submit">Guardar</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
