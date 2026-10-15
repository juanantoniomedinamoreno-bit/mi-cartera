import type { Position } from "./analysis";
import { CRYPTO, ISIN } from "./market";

type NewPosition = Omit<Position, "id" | "accountId"> & { account?: string; typeAuto?: boolean; nameAuto?: boolean };

const ALIASES: Record<string, string[]> = {
  symbol: ["simbolo", "symbol", "ticker", "isin", "codigo", "codigoisin"],
  name: ["nombre", "name", "descripcion", "producto", "activo"],
  type: ["tipo", "type", "clase", "categoria"],
  qty: ["cantidad", "quantity", "qty", "participaciones", "acciones", "shares", "unidades", "titulos"],
  avg: ["preciomedio", "preciomediocompra", "preciodecompra", "preciocompra", "avgprice", "avg", "costemedio", "pmc", "precio", "price"],
  account: ["cuenta", "account", "broker", "cartera", "banco"],
  date: ["fechacompra", "fechadecompra", "fecha", "buydate", "date"],
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

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

function num(s: string): number {
  let t = s.replace(/[^\d.,\-]/g, "");
  if (!t) return NaN;
  const lc = t.lastIndexOf(","), ld = t.lastIndexOf(".");
  if (lc > -1 && ld > -1) t = lc > ld ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (lc > -1) t = t.replace(",", ".");
  return parseFloat(t);
}

function date(s: string): string | undefined {
  const t = s.trim();
  let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return undefined;
}

function type(raw: string, symbol: string): string {
  const t = norm(raw);
  if (/^(accion|stock|equity|acciones)/.test(t)) return "Acción";
  if (t.startsWith("etf")) return "ETF";
  if (/^(fondo|fund)/.test(t)) return "Fondo de inversión";
  if (/^(cripto|crypto)/.test(t)) return "Cripto";
  if (t) return "Otro";
  return CRYPTO[symbol] ? "Cripto" : ISIN.test(symbol) ? "Fondo de inversión" : "Acción";
}

export function parseCsv(input: string): { positions: NewPosition[]; skipped: number; error?: string } {
  const text = input.replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/)[0] ?? "";
  const delim = [";", "\t", ","].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows = parseRows(text, delim);
  if (rows.length < 2) return { positions: [], skipped: 0, error: "El archivo está vacío o solo tiene la cabecera." };

  const head = rows[0].map(norm);
  const col: Record<string, number> = {};
  for (const [k, names] of Object.entries(ALIASES)) {
    for (const n of names) { const i = head.indexOf(n); if (i > -1) { col[k] = i; break; } }
  }
  const missing = ["symbol", "qty", "avg"].filter((k) => col[k] === undefined);
  if (missing.length) {
    const label: Record<string, string> = { symbol: "Símbolo", qty: "Cantidad", avg: "Precio medio" };
    return { positions: [], skipped: 0, error: `No encuentro estas columnas en la primera fila: ${missing.map((m) => label[m]).join(", ")}.` };
  }

  const positions: NewPosition[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const symbol = (r[col.symbol] ?? "").trim().toUpperCase();
    const qty = num(r[col.qty] ?? ""), avg = num(r[col.avg] ?? "");
    if (!symbol || !(qty > 0) || !(avg >= 0)) { skipped++; continue; }
    positions.push({
      symbol, qty, avg, price: avg,
      name: (col.name !== undefined ? (r[col.name] ?? "").trim() : "") || symbol,
      type: type(col.type !== undefined ? r[col.type] ?? "" : "", symbol),
      typeAuto: col.type === undefined || !(r[col.type] ?? "").trim(),
      nameAuto: col.name === undefined || !(r[col.name] ?? "").trim(),
      account: col.account !== undefined ? (r[col.account] ?? "").trim() || undefined : undefined,
      buyDate: col.date !== undefined ? date(r[col.date] ?? "") : undefined,
    });
  }
  if (!positions.length) return { positions, skipped, error: "No se pudo leer ninguna fila válida. Revisa que haya símbolo, cantidad y precio medio." };
  return { positions, skipped };
}
