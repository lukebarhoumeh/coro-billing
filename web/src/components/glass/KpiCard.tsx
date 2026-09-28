import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { AnimatedNumber } from "./AnimatedNumber";

export function KpiCard({
  label, value, hero, valueClassName, delta, spark, animate,
}: {
  label: string; value: string; hero?: boolean;
  valueClassName?: string; delta?: ReactNode; spark?: ReactNode;
  /** count-up (hero card only per spec motion budget) */
  animate?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-glass border border-edge p-4 shadow-glass",
        "backdrop-blur-[14px] transition-[transform,box-shadow] duration-200 ease-glass",
        "hover:-translate-y-[3px] hover:shadow-glass-lift",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        "[border-top-color:hsl(var(--edge-hi))]",
        hero
          ? "border-primary/35 bg-gradient-to-br from-primary/15 to-primary/[0.03]"
          : "bg-glass-1"
      )}
    >
      <div className="mb-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "font-display text-[27px] font-semibold tabular-nums",
          hero && "text-primary [text-shadow:0_0_26px_hsl(var(--brass-glow))]",
          valueClassName
        )}
      >
        {animate ? <AnimatedNumber value={value} /> : <span className="tabular-nums">{value}</span>}
      </div>
      {delta !== undefined && <div className="mt-1.5">{delta}</div>}
      {spark !== undefined && <div className="absolute right-3 top-3.5 opacity-85">{spark}</div>}
    </div>
  );
}
