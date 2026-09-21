/**
 * The month-end checklist — lives in the left rail so the close's state is
 * always visible: Load files → Clear blockers → Approve drafts → Export.
 * Each step navigates to where the work happens.
 */
import { Check, Circle, CircleAlert } from "lucide-react";
import { useClose } from "@/lib/closeStore";
import type { SectionKey } from "@/lib/nav";
import { cn } from "@/lib/cn";

interface Step {
  readonly label: string;
  readonly detail: string;
  readonly state: "done" | "attention" | "todo";
  readonly target: SectionKey;
}

export function CloseChecklist({ onNavigate }: { onNavigate: (s: SectionKey) => void }) {
  const { progress, model } = useClose();

  const steps: Step[] = [
    {
      label: "Load files",
      detail: progress.filesReady
        ? progress.invoiceLoaded
          ? "3 of 3 loaded"
          : "2 of 3 · Coro invoice optional"
        : "drop pricing + usage",
      state: progress.filesReady ? "done" : "todo",
      target: "intake",
    },
    {
      label: "Clear blockers",
      detail:
        model === null
          ? "waiting on files"
          : progress.blockers === 0
            ? "none standing"
            : `${progress.blockers} blocked line${progress.blockers === 1 ? "" : "s"}`,
      state: model === null ? "todo" : progress.blockers === 0 ? "done" : "attention",
      target: "exceptions",
    },
    {
      label: "Approve drafts",
      detail:
        model === null
          ? "waiting on files"
          : `${progress.approved} of ${progress.totalDrafts} approved`,
      state:
        model === null
          ? "todo"
          : progress.totalDrafts > 0 && progress.approved === progress.totalDrafts
            ? "done"
            : progress.approved > 0
              ? "attention"
              : "todo",
      target: "invoices",
    },
    {
      label: "Export",
      detail: progress.exportedAny ? "exported this month" : "Excel · QuickBooks",
      state: progress.exportedAny ? "done" : "todo",
      target: "invoices",
    },
  ];

  return (
    <div className="mx-3 mb-3 mt-2 rounded-lg border border-border/70 bg-background/40 p-3">
      <div className="microlabel mb-2">Month-end checklist</div>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={s.label}>
            <button
              className="group flex w-full items-start gap-2 text-left"
              data-testid={`checklist-${i}`}
              onClick={() => onNavigate(s.target)}
            >
              {s.state === "done" ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              ) : s.state === "attention" ? (
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              ) : (
                <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
              )}
              <span className="min-w-0">
                <span
                  className={cn(
                    "block text-xs font-medium leading-tight",
                    s.state === "done" ? "text-muted-foreground" : "text-foreground",
                    "group-hover:text-primary"
                  )}
                >
                  {s.label}
                </span>
                <span className="block text-[0.6875rem] leading-tight text-muted-foreground">
                  {s.detail}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
