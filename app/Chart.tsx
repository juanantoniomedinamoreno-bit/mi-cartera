"use client";
import { useState } from "react";
import type { Point } from "@/lib/analysis";

const eur = (v: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(v);
const fdate = (d: string) => new Date(d).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });

export default function Chart({ points }: { points: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <p className="empty">No hay histórico suficiente para dibujar el gráfico.</p>;

  const W = 600, H = 220, P = 8, n = points.length;
  const vals = points.flatMap((p) => [p.value, p.invested]);
  const min = Math.min(...vals), span = Math.max(...vals) - min || 1;
  const x = (i: number) => P + (i / (n - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - min) / span) * (H - 2 * P);
  const path = (k: "value" | "invested") => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[k]).toFixed(1)}`).join("");

  const i = hover ?? n - 1, pt = points[i], pl = pt.value - pt.invested;
  const color = points[n - 1].value >= points[n - 1].invested ? "var(--up)" : "var(--down)";
  const at = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left) / r.width) * (n - 1)))));
  };

  return (
    <div>
      <div className="meta" style={{ marginBottom: 8 }}>
        <div><span className="label">{fdate(pt.d)}</span><b>{eur(pt.value)}</b></div>
        <div><span className="label">Invertido</span><b>{eur(pt.invested)}</b></div>
        <div><span className="label">Ganancia / pérdida</span><b className={pl >= 0 ? "up" : "down"}>{eur(pl)}</b></div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", touchAction: "pan-y" }} role="img" aria-label="Evolución del valor de la cartera"
        onMouseMove={(e) => at(e.clientX, e.currentTarget)} onMouseLeave={() => setHover(null)}
        onTouchMove={(e) => at(e.touches[0].clientX, e.currentTarget)} onTouchEnd={() => setHover(null)}>
        <path d={path("invested")} fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        <path d={path("value")} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {hover !== null && <line x1={x(i)} x2={x(i)} y1={P} y2={H - P} stroke="var(--muted)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        <circle cx={x(i)} cy={y(pt.value)} r="4" fill={color} />
      </svg>
      <p className="note" style={{ marginTop: 6 }}>Línea de color: valor de la cartera. Línea discontinua: dinero invertido.</p>
    </div>
  );
}
