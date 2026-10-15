import { replay, type Lot } from "./analysis";
import { CRYPTO, ISIN } from "./market";

export type ImportedPosition = {
  symbol: string; name: string; type: string; account?: string; lots: Lot[];
  current?: number; ref?: number; typeAuto: boolean; nameAuto: boolean; needsResolve?: boolean;
};
export type ParseResult = {
  positions: ImportedPosition[]; kind: "snapshot" | "transactions";
  skipped: number; otherOps: number; closed: number; warnings: string[]; error?: string;
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

const A = {
  ticker: ["simbolo", "symbol", "ticker", "codigo", "asset", "coin", "instrumento", "valorticker"],
  isin: ["isin", "codigoisin"],
  combined: ["simboloisin", "symbolisin", "isinsimbolo"],
  name: ["nombre", "producto", "empresa", "company", "valordescripcion", "valorsubyacente", "name", "descripcion", "producto", "activo", "fondo", "security", "titulo", "denominacion", "nombredelactivo", "nombredelfondo"],
  type: ["tipo", "type", "tipodeoperacion", "operacion", "transaction", "transactiontype", "accion", "side", "direccion", "movimiento", "concepto", "clase", "categoria", "tipodeactivo", "tipodeproducto", "assetclass", "clasedeactivo", "producttype"],
  qty: ["cantidad", "uds", "unid", "titulosnumero", "cant", "quantity", "qty", "participaciones", "numerodeparticipaciones", "acciones", "shares", "unidades", "titulos", "numero", "volume", "volumen", "nominal", "number", "nacciones", "numtitulos"],
  avg: ["preciomedio", "coste", "costo", "costemedio", "preciocoste", "precioadquisicion", "preciodeadquisicion", "preciomediocompra", "preciomediodecompra", "avgprice", "avg", "averageprice", "avgcost", "costemedio", "costepromedio", "preciopromedio", "pmc", "preciodecompra", "preciocompra", "buyprice", "openprice", "preciodeapertura", "costeunitario"],
  price: ["precio", "price", "valorliquidativo", "vl", "unitprice", "preciounitario", "preciodeejecucion", "executionprice", "pricepershare", "preciopor", "preciopoaccion", "cotizacion"],
  current: ["cierre", "preciodecierre", "closeprice", "currentprice", "lastprice", "preciodemercado", "marketprice", "precioactual", "ultimoprecio"],
  amount: ["valornetodetransaccion", "valornetotransaccion", "importe", "total", "amount", "importetotal", "totalamount", "proceeds", "importeneto", "importebruto", "valorlocal", "efectivo", "costetotal"],
  date: ["fechaoperacion", "fechadeoperacion", "fechaejecucion", "fechadecompra", "fechacompra", "fecha", "date", "datetime", "tradedate", "opentime", "buydate", "timestamp", "time", "fechadecontratacion"],
  account: ["cuenta", "account", "broker", "cartera", "banco", "entidad"],
  currency: ["divisa", "currency", "ccy", "monedadeoperacion"],
};
const KNOWN = new Set(Object.values(A).flat());

const SUFFIX: Record<string, string> = { UK: ".L", ES: ".MC", FR: ".PA", NL: ".AS", IT: ".MI", PL: ".WA", PT: ".LS", BE: ".BR", CH: ".SW", DK: ".CO", SE: ".ST", FI: ".HE", NO: ".OL" };

function cleanSymbol(raw: string): string {
  let s = raw.trim().toUpperCase().replace(/["']/g, "");
  const isin = s.match(/[A-Z]{2}[A-Z0-9]{9}[0-9]/);
  if (isin && s.length > 12) return isin[0];
  s = s.split(/[\s|]+/)[0];
  const pair = s.match(/^([A-Z0-9]{2,6})[/\-](EUR|USD|USDT|USDC)$/);
  if (pair && CRYPTO[pair[1]]) return pair[1];
  const suf = s.match(/^([A-Z0-9\-]+)\.([A-Z]{2})$/);
  if (suf) {
    if (suf[2] === "US") return suf[1];
    if (SUFFIX[suf[2]]) return suf[1] + SUFFIX[suf[2]];
  }
  return s;
}

function parseRows(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

function detectDelim(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 40);
  let best = ",", bestScore = -1;
  for (const d of [";", "\t", ",", "|"]) {
    const freq = new Map<number, number>();
    for (const l of lines) { const c = l.split(d).length; freq.set(c, (freq.get(c) ?? 0) + 1); }
    let score = 0;
    freq.forEach((v, k) => { if (k > 1) score = Math.max(score, v * k); });
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

function num(s: string, commaDecimal: boolean): number {
  let t = s.replace(/[\u2212\u2013]/g, "-").replace(/\s|\u00a0/g, "");
  const neg = /^\(.*\)$/.test(t) || /-$/.test(t);
  t = t.replace(/[^\d.,\-]/g, "").replace(/^-+/, (m) => (m ? "-" : ""));
  if (!/\d/.test(t)) return NaN;
  const lc = t.lastIndexOf(","), ld = t.lastIndexOf(".");
  if (lc > -1 && ld > -1) t = lc > ld ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (lc > -1) t = /^-?\d{1,3}(,\d{3})+$/.test(t) && !commaDecimal ? t.replace(/,/g, "") : t.replace(/,/g, ".");
  else if (ld > -1 && commaDecimal && /^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const v = parseFloat(t.replace(/-$/, ""));
  return neg && v > 0 ? -v : v;
}

function parseDate(s: string): string | undefined {
  const t = s.trim();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})\b/);
  if (m) return `20${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return undefined;
}

function opKind(v: string): "buy" | "sell" | "other" | null {
  const t = norm(v);
  if (!t) return null;
  if (/entrant|incoming|transferin|traspasoentrada|recibid/.test(t)) return "buy";
  if (/salient|outgoing|transferout|traspasosalida|enviad/.test(t)) return "sell";
  if (/buy|compra|suscrip|purchase|aportac/.test(t)) return "buy";
  if (/sell|venta|vender|reembols|rescate|sold/.test(t)) return "sell";
  return "other";
}

function assetType(raw: string): string {
  const t = norm(raw);
  if (!t) return "";
  if (/^(accion|stock|equity|share)/.test(t)) return "Acción";
  if (t.startsWith("etf") || t.startsWith("etc")) return "ETF";
  if (/^(fondo|fund|mutual|instit)/.test(t)) return "Fondo de inversión";
  if (/^(cripto|crypto)/.test(t)) return "Cripto";
  return "Otro";
}
const guess = (s: string) => (CRYPTO[s] ? "Cripto" : ISIN.test(s) ? "Fondo de inversión" : "Acción");

const isIsin = (v: string) => /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(v.trim().toUpperCase());
const hasLetters = (v: string) => /[a-zA-Z\u00C0-\u017F]{2,}/.test(v);

function colValues(rows: string[][], c: number) { return rows.map((r) => (r[c] ?? "").trim()).filter(Boolean); }
function share(vals: string[], f: (v: string) => boolean) { return vals.length ? vals.filter(f).length / vals.length : 0; }

// Sin cabecera reconocible: se deduce el papel de cada columna mirando su contenido.
function guessHeaderless(rows: string[][], cd: boolean): string[] | null {
  const sample = rows.slice(0, 200);
  const n = Math.max(...sample.map((r) => r.length));
  const head: string[] = Array(n).fill("");
  const numeric: number[] = [];
  let nameC = -1, nameLen = 0, isinC = -1;
  for (let c = 0; c < n; c++) {
    const v = colValues(sample, c);
    if (!v.length) continue;
    if (share(v, isIsin) >= 0.6) { if (isinC < 0) isinC = c; continue; }
    if (share(v, (x) => parseDate(x) !== undefined) >= 0.6) { head[c] = "fecha"; continue; }
    if (share(v, (x) => { const k = opKind(x); return k === "buy" || k === "sell"; }) >= 0.2) { head[c] = "tipodeoperacion"; continue; }
    if (share(v, (x) => Number.isFinite(num(x, cd)) && !hasLetters(x)) >= 0.8) { numeric.push(c); continue; }
    if (share(v, hasLetters) >= 0.7) {
      const len = v.reduce((a, x) => a + x.length, 0) / v.length;
      if (len > nameLen) { nameLen = len; nameC = c; }
    }
  }
  if (isinC > -1) head[isinC] = "isin";
  if (nameC > -1) head[nameC] = "nombre";
  if (isinC < 0 && nameC < 0) return null;
  if (numeric.length < 2) return null;
  head[numeric[0]] = "cantidad";
  head[numeric[1]] = "precio";
  return head;
}

export function parseCsv(input: string): ParseResult {
  const fail = (error: string): ParseResult => ({ positions: [], kind: "snapshot", skipped: 0, otherOps: 0, closed: 0, warnings: [], error });
  const text = input.replace(/^\uFEFF/, "");
  const rows = parseRows(text, detectDelim(text));
  if (rows.length < 2) return fail("El archivo está vacío o solo tiene una fila.");

  const commaDecimal = rows.flat().some((c) => /^-?\d+,\d+\s*€?$/.test(c.trim()));
  const warnings: string[] = [];

  // La cabecera no tiene por qué ser la primera fila: se busca la que más columnas conocidas tiene.
  let hi = -1, bestScore = 0;
  rows.slice(0, 40).forEach((r, i) => {
    const score = new Set(r.map(norm).filter((c) => c && KNOWN.has(c))).size;
    if (score > bestScore) { bestScore = score; hi = i; }
  });
  let head: string[], body: string[][], shown: string;
  if (hi >= 0 && bestScore >= 2) {
    head = rows[hi].map(norm);
    body = rows.slice(hi + 1);
    shown = rows[hi].filter((h) => h.trim()).slice(0, 14).join(", ");
  } else {
    const g = guessHeaderless(rows, commaDecimal);
    if (!g) return fail(`No reconozco el formato del archivo. Primera fila: ${rows[0].slice(0, 10).join(" | ")}`);
    head = g;
    body = rows;
    shown = "(sin cabecera)";
    warnings.push("El archivo no tiene una cabecera reconocible: deduje las columnas por su contenido (primera columna numérica = cantidad, segunda = precio). Revisa que los datos salgan bien.");
  }
  const find = (names: string[]) => { for (const n of names) { const i = head.indexOf(n); if (i > -1) return i; } return -1; };
  const eurCol = (() => {
    for (const pre of ["valor", "importe", "amount", "total"]) {
      const i = head.findIndex((h) => new RegExp(`^${pre}(en)?(eur|euros)$`).test(h));
      if (i > -1) return i;
    }
    return -1;
  })();

  // Si no hay columna de símbolo, se busca un ISIN en cualquier columna o, si no, se usará el nombre del activo.
  if (find(A.ticker) < 0 && find(A.isin) < 0 && find(A.combined) < 0) {
    const used = new Set(head.map((h, i) => (A.type.includes(h) || A.account.includes(h) || A.currency.includes(h) || A.date.includes(h) ? i : -1)).filter((i) => i > -1));
    let isinC = -1;
    for (let c = 0; c < head.length && isinC < 0; c++) if (!used.has(c) && share(colValues(body, c), isIsin) >= 0.6) isinC = c;
    if (isinC > -1) head[isinC] = "isin";
    else if (find(A.name) < 0) {
      let best = -1, bestLen = 0;
      for (let c = 0; c < head.length; c++) {
        if (used.has(c)) continue;
        const v = colValues(body, c);
        if (v.length && share(v, hasLetters) >= 0.7 && share(v, (x) => { const k = opKind(x); return k === "buy" || k === "sell"; }) < 0.2) {
          const len = v.reduce((a, x) => a + x.length, 0) / v.length;
          if (len > bestLen) { bestLen = len; best = c; }
        }
      }
      if (best > -1) head[best] = "nombre";
    }
  }
  const tickerCol = find(A.ticker), isinCol = find(A.isin), combCol = find(A.combined);
  const byName = tickerCol < 0 && isinCol < 0 && combCol < 0;
  if (byName && find(A.name) < 0) return fail(`No encuentro ninguna columna con el símbolo, el ISIN o el nombre del activo. Columnas que veo: ${shown}.`);
  if (byName) warnings.push("El archivo no trae símbolo ni ISIN: busco cada activo por su nombre.");
  const avgCol = find(A.avg), priceCol = find(A.price), curCol = find(A.current);
  let amtCol = find(A.amount);
  // Si hay varias columnas que podrían ser la cantidad (p. ej. "Títulos" y "Cantidad", donde esta última es el importe),
  // se elige la que cumple cantidad × precio ≈ importe.
  let qtyCol = find(A.qty);
  const qtyCands = head.map((h, i) => (A.qty.includes(h) ? i : -1)).filter((i) => i > -1);
  const pc = priceCol > -1 ? priceCol : avgCol;
  if (qtyCands.length > 1 && pc > -1) {
    const nv = (r: string[], c: number) => num((r[c] ?? "").trim(), commaDecimal);
    let bestShare = 0;
    for (const q of qtyCands) {
      const others = [...qtyCands.filter((c) => c !== q), amtCol].filter((c) => c > -1);
      let ok = 0, tot = 0;
      for (const r of body) {
        const qv = nv(r, q), pv = nv(r, pc);
        if (!Number.isFinite(qv) || !Number.isFinite(pv)) continue;
        tot++;
        if (others.some((o) => { const ov = nv(r, o); return Number.isFinite(ov) && Math.abs(Math.abs(qv * pv) - Math.abs(ov)) <= Math.max(0.02 * Math.abs(ov), 0.05); })) ok++;
      }
      const sh = tot ? ok / tot : 0;
      if (sh > bestShare) { bestShare = sh; qtyCol = q; }
    }
    if (amtCol < 0) amtCol = qtyCands.find((c) => c !== qtyCol) ?? -1;
  }
  if (qtyCol < 0) return fail(`No encuentro la columna de cantidad. Columnas que veo: ${shown}.`);
  if ([avgCol, priceCol, curCol, amtCol, eurCol].every((c) => c < 0)) return fail(`No encuentro ninguna columna de precio o importe. Columnas que veo: ${shown}.`);
  const nameCol = find(A.name), dateCol = find(A.date), accCol = find(A.account), curCcyCol = find(A.currency);

  // De las columnas "tipo" se distingue cuál es la operación (compra/venta) y cuál el tipo de activo.
  const typeCols = head.map((h, i) => (A.type.includes(h) ? i : -1)).filter((i) => i > -1);
  const opShare = (c: number) => {
    const v = body.map((r) => (r[c] ?? "").trim()).filter(Boolean);
    return v.length ? v.filter((x) => { const k = opKind(x); return k === "buy" || k === "sell"; }).length / v.length : 0;
  };
  const opCol = typeCols.filter((c) => opShare(c) >= 0.2).sort((a, b) => opShare(b) - opShare(a))[0] ?? -1;
  const typeCol = typeCols.find((c) => c !== opCol) ?? -1;

  const N = (c: number, r: string[]) => (c > -1 ? num((r[c] ?? "").trim(), commaDecimal) : NaN);
  const negQty = qtyCol > -1 && body.some((r) => N(qtyCol, r) < 0);
  const kind: "snapshot" | "transactions" = opCol > -1 || (dateCol > -1 && negQty) ? "transactions" : "snapshot";

  let skipped = 0, otherOps = 0, foreign = 0, usedCurrent = 0;
  const groups = new Map<string, ImportedPosition>();

  // Muchos brokers exportan lo más reciente arriba: se recorre en orden cronológico para que las operaciones del mismo día se apliquen bien.
  const dated = dateCol > -1 ? body.map((r) => parseDate((r[dateCol] ?? "").trim())).filter(Boolean) as string[] : [];
  const descending = dated.length > 1 && dated[0] > dated[dated.length - 1];
  for (const r of descending ? [...body].reverse() : body) {
    const cell = (c: number) => (c > -1 ? (r[c] ?? "").trim() : "");
    const symbol = byName ? cell(nameCol).toUpperCase().replace(/\s+/g, " ") : cleanSymbol(cell(tickerCol) || cell(isinCol) || cell(combCol));
    if (!symbol) { skipped++; continue; }
    const op = opCol > -1 ? opKind(cell(opCol)) : null;
    if (op === "other") { otherOps++; continue; }
    const qty = N(qtyCol, r);
    if (!Number.isFinite(qty) || qty === 0) { skipped++; continue; }

    let price = NaN, current: number | undefined;
    if (kind === "transactions") {
      const eur = N(eurCol, r);
      if (Number.isFinite(eur) && eur !== 0) price = Math.abs(eur) / Math.abs(qty);
      else {
        price = Number.isFinite(N(priceCol, r)) ? N(priceCol, r) : Number.isFinite(N(avgCol, r)) ? N(avgCol, r) : Math.abs(N(amtCol, r)) / Math.abs(qty);
        if (curCcyCol > -1 && cell(curCcyCol) && cell(curCcyCol).toUpperCase() !== "EUR") foreign++;
      }
    } else {
      if (qty < 0) { skipped++; continue; }
      const c = N(curCol, r), pr = N(priceCol, r), av = N(avgCol, r);
      price = Number.isFinite(av) ? av : Number.isFinite(pr) ? pr : c;
      if (Number.isFinite(c)) current = c;
      if (!Number.isFinite(av) && !Number.isFinite(pr)) {
        if (!Number.isFinite(price)) { const v = N(eurCol, r); price = Number.isFinite(v) ? Math.abs(v) / qty : Math.abs(N(amtCol, r)) / qty; }
        usedCurrent++;
      }
    }
    if (!Number.isFinite(price) || price < 0) { skipped++; continue; }

    const sell = kind === "transactions" && (op === "sell" || (op === null && qty < 0));
    const lot: Lot = { d: dateCol > -1 ? parseDate(cell(dateCol)) : undefined, q: sell ? -Math.abs(qty) : Math.abs(qty), p: price };
    const account = cell(accCol) || undefined;
    const key = `${(account ?? "").toLowerCase()}|${symbol}`;
    const g = groups.get(key);
    const name = cell(nameCol), tp = assetType(cell(typeCol));
    if (g) {
      g.lots.push(lot);
      if (!g.name || g.name === g.symbol) { if (name) { g.name = name; g.nameAuto = false; } }
      if (current !== undefined) g.current = current;
    } else {
      groups.set(key, { symbol, name: name || symbol, nameAuto: byName ? false : !name, type: tp || guess(symbol), typeAuto: !tp, account, lots: [lot], current, needsResolve: byName });
    }
  }

  let closed = 0;
  const positions: ImportedPosition[] = [];
  groups.forEach((g) => {
    if (kind === "transactions") {
      let best: Lot | undefined;
      for (const l of g.lots) if (l.d && (!best || l.d > best.d!)) best = l;
      if (best) { g.ref = best.p; if (g.current === undefined) g.current = best.p; }
    }
    if (replay(g.lots).qty > 1e-9) positions.push(g); else closed++;
  });

  if (!positions.length) return fail(`No he podido leer ninguna posición. Columnas que veo: ${shown}.`);
  if (foreign) warnings.push(`${foreign} filas están en una divisa distinta del euro: el precio se tomó tal cual, sin convertir.`);
  if (usedCurrent) warnings.push("El archivo no trae el precio de compra de algunas posiciones: se usó el precio actual, así que su rentabilidad saldrá a 0 % hasta que lo corrijas.");
  return { positions, kind, skipped, otherOps, closed, warnings };
}
