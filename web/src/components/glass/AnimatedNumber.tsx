import { useEffect, useRef, useState } from "react";

/**
 * Counts a preformatted money string up on mount (hero KPIs only, 900ms
 * cubic ease-out). value must look like "$13,957.76" or "13,957.76".
 * Under prefers-reduced-motion it renders the final value immediately.
 */
export function AnimatedNumber({ value, durationMs = 900 }: { value: string; durationMs?: number }) {
  const [text, setText] = useState(value);
  const raf = useRef(0);
  useEffect(() => {
    const numeric = Number(value.replace(/[^0-9.-]/g, ""));
    const prefix = value.startsWith("$") ? "$" : "";
    if (
      !Number.isFinite(numeric) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) { setText(value); return; }
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setText(prefix + (numeric * eased).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else setText(value);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, durationMs]);
  return <span className="tabular-nums">{text}</span>;
}
