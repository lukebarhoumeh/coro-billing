// AreaChart.tsx — one filled series + optional dashed companions, with labels.
import { buildAreaPath, buildSparklinePath, scaleLinear } from "./chartGeometry";

export interface AreaSeries {
  readonly label: string;
  readonly values: readonly number[]; // one per period, same length as periods
  readonly color: string;
  readonly dashed?: boolean; // companion series are dashed (line-style, not color, distinguishes)
}

export function AreaChart({
  periods, series, h = 150, ariaSummary,
}: { periods: readonly string[]; series: readonly AreaSeries[]; h?: number; ariaSummary: string }) {
  const w = 640;
  const pad = 30;
  const x = scaleLinear([0, Math.max(periods.length - 1, 1)], [pad + 30, w - pad - 30]);
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={ariaSummary}>
      {[0.25, 0.55, 0.85].map((f) => (
        <line key={f} x1={0} x2={w} y1={h * f} y2={h * f} stroke="rgba(255,255,255,.06)" />
      ))}
      {series.map((s) => (
        <g key={s.label}>
          {!s.dashed && <path d={buildAreaPath(s.values, w, h - 22, 8)} fill={s.color} opacity={0.14} />}
          <path d={buildSparklinePath(s.values, w, h - 22, 8)} fill="none" stroke={s.color}
            strokeWidth={s.dashed ? 2 : 2.5} strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinecap="round" />
        </g>
      ))}
      {periods.map((p, i) => (
        <text key={p} x={x(i)} y={h - 6} fill="hsl(var(--muted-foreground))" fontSize={9} textAnchor="middle">{p}</text>
      ))}
    </svg>
  );
}
