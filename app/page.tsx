"use client";
import Chart from "./Chart";
import { parseCsv } from "@/lib/csv";
import { getFb } from "@/lib/firebase";
import { guessType } from "@/lib/market";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { analyze, buildSeries, consolidate, mergeImport, mergeManual, replay, type Account, type Hist, type Live, type Point, type Position } from "@/lib/analysis";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const KEY = "gq_positions_v2";
const KEYA = "gq_accounts_v1";
const MAIN: Account = { id: "main", name: "Principal" };
const fixPositions = (ps: Position[]): Position[] => consolidate(ps.map((p) => ({ ...p, accountId: p.accountId ?? "main" })));
const ensureAccounts = (accs: Account[], ps: Position[]): Account[] => {
  const out = accs.length ? [...accs] : [MAIN];
  for (const p of ps) if (!out.some((a) => a.id === p.accountId)) out.push({ id: p.accountId, name: p.accountId === "main" ? "Principal" : "Cartera" });
  return out;
};

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const money = (v: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(v);
const pct = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2).replace(".", ",") + "%";
const cls = (v: number) => (v >= 0 ? "up" : "down");
const fdate = (d: string) => new Date(d).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
const RANGES = [["1w", "1S"], ["1m", "1M"], ["6m", "6M"], ["ytd", "YTD"], ["1y", "1A"], ["5y", "5A"], ["max", "Máx"]];
const GROUPS = [["asset", "Activo"], ["type", "Tipo"], ["acc", "Cartera"]];

type Det = { q: string; name: string; type: string; found: boolean };

async function lookup(symbols: string[]): Promise<Record<string, { name: string; type: string }>> {
  try {
    const r = await fetch(`/api/lookup?symbols=${encodeURIComponent(symbols.join(","))}`);
    return await r.json();
  } catch { return {}; }
}

function Big({ v }: { v: number }) {
  const [i, d] = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v).split(",");
  return <div className="big">{i}<small>,{d} €</small></div>;
}

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
  const [hoverPt, setHoverPt] = useState<Point | null>(null);
  const [groupBy, setGroupBy] = useState("asset");
  const [theme, setTheme] = useState("dark");
  const [importMsg, setImportMsg] = useState("");
  const [symInput, setSymInput] = useState("");
  const [det, setDet] = useState<Det | null>(null);
  const [manualType, setManualType] = useState("");
  const dlg = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let lp: Position[] = [], la: Account[] = [];
    try { lp = fixPositions(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch {}
    try { la = JSON.parse(localStorage.getItem(KEYA) || "[]"); } catch {}
    try { const t = localStorage.getItem("gq_theme"); if (t) setTheme(t); } catch {}
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
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("gq_theme", theme); } catch {}
  }, [theme]);

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

  // Detección automática del tipo de activo mientras se escribe el símbolo
  useEffect(() => {
    const q = symInput.trim().toUpperCase();
    if (q.length < 2) { setDet(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await lookup([q]);
      if (cancelled) return;
      setDet(r[q] ? { q, name: r[q].name, type: r[q].type, found: true } : { q, name: q, type: guessType(q), found: false });
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [symInput]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) {
      setImportMsg("Este archivo es de Excel. Ábrelo y guárdalo como CSV (Archivo → Guardar como → CSV) y súbelo de nuevo.");
      return;
    }
    const buf = new Uint8Array(await f.arrayBuffer());
    let enc = "utf-8";
    if (buf[0] === 0xff && buf[1] === 0xfe) enc = "utf-16le";
    else if (buf[0] === 0xfe && buf[1] === 0xff) enc = "utf-16be";
    let text = new TextDecoder(enc).decode(buf);
    if (enc === "utf-8" && text.includes("\uFFFD")) text = new TextDecoder("windows-1252").decode(buf);
    const res = parseCsv(text);
    if (res.error) { setImportMsg(res.error); return; }

    let accs = [...accounts];
    const target = tab !== "all" && accs.some((a) => a.id === tab) ? tab : accs[0]?.id ?? "main";
    const autos = new Map<string, { typeAuto: boolean; nameAuto: boolean }>();
    const incoming: Position[] = res.positions.map((ip) => {
      let accountId = target;
      if (ip.account) {
        let a = accs.find((x) => x.name.toLowerCase() === ip.account!.toLowerCase());
        if (!a) { a = { id: crypto.randomUUID(), name: ip.account }; accs = [...accs, a]; }
        accountId = a.id;
      }
      if (ip.typeAuto || ip.nameAuto) autos.set(ip.symbol, { typeAuto: ip.typeAuto, nameAuto: ip.nameAuto });
      const { qty, avg } = replay(ip.lots);
      return { id: crypto.randomUUID(), accountId, symbol: ip.symbol, name: ip.name, type: ip.type, qty, avg, price: ip.current ?? avg, lots: ip.lots };
    });
    const m = mergeImport(positions, incoming, res.kind);
    setAccounts(accs);
    setPositions(m.positions);

    const parts = [`${res.positions.length} posiciones leídas`];
    if (m.added) parts.push(`${m.added} nuevas`);
    if (m.updated) parts.push(`${m.updated} actualizadas`);
    if (res.kind === "transactions") parts.unshift("Historial de operaciones: compras y ventas agrupadas por activo con precio medio");
    if (res.closed) parts.push(`${res.closed} ya vendidas por completo`);
    if (m.dup) parts.push(`${m.dup} operaciones repetidas ignoradas`);
    if (res.otherOps) parts.push(`${res.otherOps} filas que no son compras ni ventas ignoradas`);
    if (res.skipped) parts.push(`${res.skipped} filas incompletas ignoradas`);
    setImportMsg(parts.join(" · ") + "." + (res.warnings.length ? " " + res.warnings.join(" ") : ""));

    if (autos.size) {
      const info = await lookup([...autos.keys()]);
      setPositions((prev) => prev.map((p) => {
        const d = info[p.symbol], f = autos.get(p.symbol);
        if (!d || !f) return p;
        return { ...p, type: f.typeAuto ? d.type : p.type, name: f.nameAuto && (!p.name || p.name === p.symbol) ? d.name : p.name };
      }));
    }
  }

  function downloadTemplate() {
    const csv = "\uFEFFSímbolo;Cantidad;Precio medio;Fecha compra;Cuenta\nAAPL;10;150,50;2024-03-15;Degiro\nAAPL;5;165,00;2024-06-20;Degiro\nIE00B03HCZ61;25,5;42,10;15/06/2023;MyInvestor\nBTC;0,05;30000;2023-01-10;Cripto\n";
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

  const items = useMemo(() => {
    const m = new Map<string, number>();
    view.forEach((p) => {
      const key = groupBy === "asset" ? p.symbol : groupBy === "type" ? p.type : accounts.find((a) => a.id === p.accountId)?.name ?? "—";
      m.set(key, (m.get(key) ?? 0) + p.qty * (live[p.symbol]?.price ?? p.price));
    });
    return [...m].map(([n, v]) => ({ n, v })).filter((i) => i.v > 0).sort((a, b) => b.v - a.v);
  }, [view, live, groupBy, accounts]);

  function closeDlg() {
    dlg.current?.close();
    setSymInput(""); setDet(null); setManualType("");
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const symbol = symInput.trim().toUpperCase();
    const qty = parseFloat(String(d.get("qty")));
    const avg = parseFloat(String(d.get("avg")));
    if (!symbol || !(qty > 0) || !(avg >= 0)) return;
    let info = det && det.q === symbol ? det : null;
    if (!info) {
      const r = await lookup([symbol]);
      info = r[symbol] ? { q: symbol, name: r[symbol].name, type: r[symbol].type, found: true } : { q: symbol, name: symbol, type: guessType(symbol), found: false };
    }
    const type = info.found ? info.type : manualType || info.type;
    setPositions((prev) => mergeManual(prev, {
      id: crypto.randomUUID(), accountId: String(d.get("account") || accounts[0]?.id || "main"),
      symbol, name: info.name, type, qty, avg, price: avg,
      buyDate: String(d.get("date") || "") || undefined,
    }));
    form.reset();
    closeDlg();
  }

  const setManual = (id: string, v: number) =>
    v >= 0 && setPositions((prev) => prev.map((p) => (p.id === id ? { ...p, price: v } : p)));

  const closeMenu = (e: React.MouseEvent) => (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");

  const heroDelta = hoverPt
    ? { v: hoverPt.value - hoverPt.invested, p: hoverPt.invested > 0 ? ((hoverPt.value - hoverPt.invested) / hoverPt.invested) * 100 : 0, label: "sobre lo invertido" }
    : totals.day !== 0 ? { v: totals.day, p: totals.dayp, label: "hoy" } : { v: totals.pl, p: totals.plp, label: "en total" };

  let off = 25;
  return (
    <div className="wrap">
      <header>
        <h1>Mi cartera</h1>
        <div className="row">
          {fbOn && user === null && <button className="ghost" onClick={login}>Iniciar sesión con Google</button>}
          {fbOn && user && (
            <span className="label">{saveState === "saving" ? "guardando…" : saveState === "saved" ? "guardado ✓" : saveState === "error" ? "error al guardar" : ""}</span>
          )}
          {fbOn && user?.photoURL && <img className="avatar-u" src={user.photoURL} alt="" referrerPolicy="no-referrer" />}
          <button className="btn" onClick={() => dlg.current?.showModal()}>Añadir posición</button>
          <details className="menu">
            <summary aria-label="Más opciones">···</summary>
            <div>
              {fbOn && user && <div className="who">{user.displayName ?? user.email}</div>}
              <button onClick={(e) => { closeMenu(e); fileRef.current?.click(); }}>Importar CSV</button>
              <button onClick={(e) => { closeMenu(e); downloadTemplate(); }}>Descargar plantilla CSV</button>
              <button onClick={(e) => { closeMenu(e); refresh(); }} disabled={loading}>{loading ? "Actualizando…" : "Actualizar precios"}</button>
              <button onClick={(e) => { closeMenu(e); setTheme(theme === "dark" ? "light" : "dark"); }}>{theme === "dark" ? "Tema claro" : "Tema oscuro"}</button>
              {fbOn && user && <button onClick={(e) => { closeMenu(e); logout(); }}>Cerrar sesión</button>}
            </div>
          </details>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden onChange={onFile} />
        </div>
      </header>

      {importMsg && (
        <p role="status" className="note" style={{ fontSize: 14, color: "var(--text)", marginTop: 0 }}>
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
          <span className="row" style={{ marginLeft: "auto", paddingLeft: 12 }}>
            <button className="ghost" style={{ padding: "3px 10px" }} onClick={renameAccount}>Renombrar</button>
            {accounts.length > 1 && <button className="ghost" style={{ padding: "3px 10px" }} onClick={deleteAccount}>Eliminar</button>}
          </span>
        )}
      </div>

      <section className="card">
        <div className="hero-top">
          <div>
            <div className="label">
              {hoverPt ? fdate(hoverPt.d) : <>{updated && <span className="live" title="Precios en vivo" />}{tabName} · valor total{updated && ` · ${updated.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`}</>}
            </div>
            <Big v={hoverPt ? hoverPt.value : totals.v} />
            <div className={`delta ${cls(heroDelta.v)}`}>{heroDelta.v >= 0 ? "↗" : "↘"} {pct(heroDelta.p)} ({money(heroDelta.v)}) <span className="label">{heroDelta.label}</span></div>
          </div>
          <div className="pills">
            {RANGES.map(([k, l]) => (
              <button key={k} className={range === k ? "pill on" : "pill"} onClick={() => setRange(k)}>{l}</button>
            ))}
          </div>
        </div>

        <div className="chartbox">
          {view.length === 0 ? <p className="empty">Añade posiciones para ver su evolución.</p>
            : histLoading ? <p className="empty">Cargando histórico…</p>
            : <Chart points={series.points} onHover={setHoverPt} />}
        </div>
        {series.missing.length > 0 && !histLoading && view.length > 0 && (
          <p className="note">Sin histórico para: {series.missing.join(", ")}. No se incluyen en el gráfico.</p>
        )}

        <div className="stats">
          <div><span className="label">Invertido</span><b>{money(totals.c)}</b></div>
          <div><span className="label">Ganancia / pérdida</span><b className={cls(totals.pl)}>{money(totals.pl)}</b></div>
          <div><span className="label">Rentabilidad</span><b className={cls(totals.plp)}>{pct(totals.plp)}</b></div>
        </div>
      </section>

      <div className="grid">
        <section className="card">
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Distribución</h2>
            <div className="pills">
              {GROUPS.map(([k, l]) => <button key={k} className={groupBy === k ? "pill on" : "pill"} style={{ padding: "4px 10px", fontSize: 13 }} onClick={() => setGroupBy(k)}>{l}</button>)}
            </div>
          </div>
          {items.length === 0 || totals.v <= 0 ? <p className="empty">Sin datos todavía</p> : (
            <>
              <svg viewBox="0 0 42 42" width="100%" style={{ maxWidth: 220, display: "block", margin: "0 auto" }} role="img" aria-label="Distribución de la cartera">
                <circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--surface2)" strokeWidth="5" />
                {items.map((i, k) => {
                  const share = (i.v / totals.v) * 100;
                  const el = <circle key={k} cx="21" cy="21" r="15.915" fill="none" stroke={COLORS[k % COLORS.length]} strokeWidth="5" strokeDasharray={`${Math.max(share - 0.6, 0)} ${100 - Math.max(share - 0.6, 0)}`} strokeDashoffset={off} />;
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

        <section className="card">
          <h2>Posiciones</h2>
          <div className="scroll">
            {view.length === 0 ? <p className="empty">Aún no hay posiciones en esta cartera.</p> : (
              <table>
                <thead><tr><th>Activo</th><th>Precio</th><th>Cantidad</th><th>Valor</th><th>P/L</th><th /></tr></thead>
                <tbody>
                  {view.map((p) => {
                    const lv = live[p.symbol];
                    const price = priceOf(p), val = p.qty * price, cost = p.qty * p.avg, g = val - cost, gp = cost > 0 ? (g / cost) * 100 : 0;
                    return (
                      <tr key={p.id}>
                        <td>
                          <div className="cell">
                            <div className="av" style={{ background: COLORS[hash(p.symbol) % COLORS.length] }}>{p.symbol.slice(0, 2)}</div>
                            <div>
                              <div className="sym">{p.name !== p.symbol ? p.name : p.symbol}</div>
                              <div className="nm">{p.symbol} · {p.type}{activeTab === "all" && accounts.length > 1 && <span className="badge">{accName(p.accountId)}</span>}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          {lv ? <><span className="live" title="Precio en vivo" />{money(lv.price)}
                            {lv.change24h != null && <div><span className={`chip ${cls(lv.change24h)}`}>{pct(lv.change24h)}</span></div>}</> : (
                            <><span className="manual" title="Precio manual: no se encontró en vivo" />
                              <input type="number" step="any" min="0" defaultValue={p.price} key={p.price}
                                onBlur={(e) => setManual(p.id, parseFloat(e.target.value))} aria-label={`Precio manual de ${p.symbol}`} /></>
                          )}
                        </td>
                        <td>{p.qty}<div className="nm">p. medio {money(p.avg)}</div></td>
                        <td><b>{money(val)}</b></td>
                        <td className={cls(g)}>{money(g)}<div><span className={`chip ${cls(g)}`}>{pct(gp)}</span></div></td>
                        <td><button className="x" aria-label={`Eliminar ${p.symbol}`} onClick={() => setPositions((prev) => prev.filter((x) => x.id !== p.id))}>×</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <p className="note">Punto verde: precio en vivo, convertido a euros. Punto gris: no se encontró ese símbolo; escribe el precio a mano. Si no inicias sesión, los datos se guardan solo en este navegador.</p>
        </section>
      </div>

      {insights.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
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

      <dialog ref={dlg} onClose={() => { setSymInput(""); setDet(null); setManualType(""); }}>
        <form onSubmit={onSubmit}>
          <h2 style={{ margin: 0 }}>Añadir posición</h2>
          <label>Cartera<select name="account" key={activeTab} defaultValue={activeTab === "all" ? accounts[0]?.id : activeTab}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label>Símbolo o ISIN
            <input value={symInput} onChange={(e) => setSymInput(e.target.value)} required autoComplete="off" placeholder="AAPL, BTC, VWCE.DE, IE00B03HCZ61…" />
          </label>
          {symInput.trim().length >= 2 && (
            <div className="det" aria-live="polite">
              {!det || det.q !== symInput.trim().toUpperCase() ? "Buscando…" : det.found ? <>✓ <b>{det.name}</b> · {det.type}</> : (
                <>
                  No lo encuentro en el mercado. Elige el tipo:
                  <select style={{ marginTop: 8 }} value={manualType || det.type} onChange={(e) => setManualType(e.target.value)}>
                    <option>Acción</option><option>ETF</option><option>Fondo de inversión</option><option>Cripto</option><option>Otro</option>
                  </select>
                </>
              )}
            </div>
          )}
          <div className="two">
            <label>Cantidad / participaciones<input name="qty" type="number" step="any" min="0" required /></label>
            <label>Precio medio de compra (€)<input name="avg" type="number" step="any" min="0" required /></label>
          </div>
          <label>Fecha de compra (opcional)<input name="date" type="date" /></label>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" className="ghost" onClick={closeDlg}>Cancelar</button>
            <button className="btn" type="submit">Guardar</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
