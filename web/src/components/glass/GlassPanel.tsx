import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Obsidian Glass panel. Blur lives HERE (bounded surface) — never on table
 * rows (spec §1 blur budget: ≤6 blurred surfaces per viewport).
 */
export function GlassPanel({
  title, hint, right, children, className, flat,
}: {
  title?: ReactNode; hint?: ReactNode; right?: ReactNode;
  children: ReactNode; className?: string;
  /** flat: translucent surface WITHOUT backdrop blur (for busy screens near budget) */
  flat?: boolean;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-glass border border-edge shadow-glass",
        "bg-glass-1 [border-top-color:hsl(var(--edge-hi))]",
        !flat && "backdrop-blur-[12px]",
        className
      )}
    >
      {(title !== undefined || right !== undefined) && (
        <header className="flex items-center gap-2.5 border-b border-edge px-4 py-3">
          {title !== undefined && <h3 className="font-display text-[15px] text-foreground">{title}</h3>}
          {hint !== undefined && <span className="text-[11px] text-muted-foreground/70">{hint}</span>}
          {right !== undefined && <div className="ml-auto flex items-center gap-2">{right}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
