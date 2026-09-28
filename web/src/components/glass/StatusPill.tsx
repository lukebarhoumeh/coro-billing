import { cn } from "@/lib/cn";

/** Inline until Task 7 lands src/domain/snapshot.ts; then swap to that import. */
type CreditStatus = "expected" | "memo-received" | "applied";

const LABEL: Record<CreditStatus, string> = {
  expected: "expected",
  "memo-received": "memo received",
  applied: "applied",
};

export function StatusPill({ status }: { status: CreditStatus }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-[10.5px]",
        status === "expected" && "border-warning/30 bg-warning/10 text-warning",
        status === "memo-received" && "border-accent/30 bg-accent/10 text-accent",
        status === "applied" && "border-success/25 bg-success/10 text-success"
      )}
    >
      {LABEL[status]}
    </span>
  );
}
