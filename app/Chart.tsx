"use client";
import { useId, useState } from "react";
import type { Point } from "@/lib/analysis";

export default function Chart({ points, onHover }: { points: Point[]; onHover?: (p: Point | null) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, "");
  if (points.length < 2) return <p className="empty">No hay histórico suficiente para dibujar el gráfico.</p>;

  const W = 600, H = 260, P = 10, n = points.length;
  const vals = points.flatMap((p) => [p.value, p.invested]);
  const min = Math.min(...vals), span = Math.max(...vals) - min || 1;
  const x = (i: number) => P + (i / (n - 1)) * (W - 2 * P);
  const y = (v: number) => H - 24 - ((v - min) / span) * (H - 24 - P);
  const path = (k: "value" | "invested") => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[k]).toFixed(1)}`).join("");

  const last = points[n - 1];
  const color = last.value >= last.invested ? "var(--up)" : "var(--down)";
  const line = path("value");
  const area = `${line}L${x(n - 1).toFixed(1)} ${H}L${x(0).toFixed(1)} ${H}Z`;

  const at = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left) / r.width) * (n - 1))));
    setHover(i);
    onHover?.(points[i]);
  };
  const leave = () => { setHover(null); onHover?.(null); };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} style={{ display: "block", touchAction: "pan-y" }}
      role="img" aria-label="Evolución del valor de la cartera"
      onMouseMove={(e) => at(e.clientX, e.currentTarget)} onMouseLeave={leave}
      onTouchMove={(e) => at(e.touches[0].clientX, e.currentTarget)} onTouchEnd={leave}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={path("invested")} fill="none" stroke="var(--muted)" strokeWidth="1.2" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--muted)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
