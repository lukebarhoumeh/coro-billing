import { buildSparklinePath } from "./chartGeometry";

export function Sparkline({
  values, color = "hsl(var(--primary))", w = 72, h = 26, dashed,
}: { values: readonly number[]; color?: string; w?: number; h?: number; dashed?: boolean }) {
  const d = buildSparklinePath(values, w, h, 4);
  if (d === "") return null;
  const last = values.length - 1;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round"
        strokeDasharray={dashed ? "3 3" : undefined} />
      {!dashed && <circle cx={w - 4} cy={h - 4 - ((values[last]! - Math.min(...values)) / Math.max(Math.max(...values) - Math.min(...values), 1)) * (h - 8)} r={2.6} fill={color} />}
    </svg>
  );
}
