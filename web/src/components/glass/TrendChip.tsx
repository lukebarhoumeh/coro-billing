import { cn } from "@/lib/cn";

export type TrendTone = "up" | "down" | "flat" | "warn" | "new";

/** Small delta chip: ▲ +4.2% / ▼ −1.1% / NEW / — . Icon+text, never color alone. */
export function TrendChip({ tone, children }: { tone: TrendTone; children?: React.ReactNode }) {
  const arrow = tone === "up" ? "▲" : tone === "down" ? "▼" : "";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] tabular-nums",
        tone === "up" && "border-success/25 bg-success/10 text-success",
        tone === "down" && "border-danger/25 bg-danger/10 text-danger",
        tone === "flat" && "border-edge bg-glass-1 text-muted-foreground",
        tone === "warn" && "border-warning/30 bg-warning/10 text-warning",
        tone === "new" && "border-accent/30 bg-accent/10 text-accent"
      )}
    >
      {tone === "new" ? "NEW" : (<><span aria-hidden>{arrow}</span>{children}</>)}
    </span>
  );
}
