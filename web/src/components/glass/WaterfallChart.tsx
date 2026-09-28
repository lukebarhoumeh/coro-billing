// WaterfallChart.tsx — bridge bars with arrows + labels on EVERY bar (spec §6).
import { layoutWaterfall, type WaterfallInput } from "./chartGeometry";

const COLORS = {
  total: "#3d6ea8",
  up: "hsl(var(--success))",
  down: "hsl(var(--danger))",
};

export function WaterfallChart({
  buckets, h = 170, ariaSummary, formatCents,
}: {
  buckets: readonly WaterfallInput[];
  h?: number;
  ariaSummary: string;
  formatCents: (cents: number) => string;
}) {
  const w = 560;
  const bars = layoutWaterfall(buckets, w, h);
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={ariaSummary}>
      <line x1={0} x2={w} y1={h - 30} y2={h - 30} stroke="rgba(255,255,255,.08)" />
      {bars.map((b, i) => (
        <g key={b.key}>
          {i > 0 && (
            <line x1={bars[i - 1]!.x + bars[i - 1]!.w} y1={b.kind === "delta" ? (b.up ? b.y + b.h : b.y) : b.y}
              x2={b.x} y2={b.kind === "delta" ? (b.up ? b.y + b.h : b.y) : b.y}
              stroke="rgba(255,255,255,.18)" strokeDasharray="3 3" />
          )}
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={5}
            fill={b.kind === "total" ? COLORS.total : b.up ? COLORS.up : COLORS.down}
            opacity={b.kind === "total" ? 1 : 0.9} />
          <text x={b.x + b.w / 2} y={b.y - 7} fontSize={10} textAnchor="middle"
            fill={b.kind === "total" ? "#9fc4ee" : b.up ? "hsl(var(--success))" : "hsl(var(--danger))"}>
            {b.kind === "delta" ? (b.up ? "▲ +" : "▼ ") : ""}{formatCents(b.amountCents)}
          </text>
          <text x={b.x + b.w / 2} y={h - 14} fontSize={9} textAnchor="middle" fill="hsl(var(--muted-foreground))">
            {b.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
