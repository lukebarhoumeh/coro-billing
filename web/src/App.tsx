import { useMemo, useState } from "react";
import type { ComponentType } from "react";
import {
  LayoutDashboard,
  FileText,
  Scale,
  TriangleAlert,
  ShieldAlert,
} from "lucide-react";
import { runDemo, DATASETS, BANNER, type DatasetKey, type DemoResult } from "@/lib/pipeline";
import { cn } from "@/lib/cn";
import { OverviewScreen } from "@/screens/Overview";
import { InvoicesScreen } from "@/screens/Invoices";
import { ReconcileScreen } from "@/screens/Reconcile";
import { ExceptionsScreen } from "@/screens/Exceptions";

/**
 * MSP Hub — Coro Billing dashboard shell.
 *
 * Runs the REAL pipeline in-browser (via runDemo) over loudly-labeled SYNTHETIC
 * fixtures. This file is the frame: a persistent synthetic banner, a left rail
 * navigating the four screens, a header with the dataset switcher, and a footer.
 * All numbers live in DemoResult; each screen is purely presentational.
 */

type SectionKey = "overview" | "invoices" | "reconcile" | "exceptions";

interface Section {
  readonly key: SectionKey;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly Screen: ComponentType<{ result: DemoResult }>;
  /** Optional live count badge in the nav (e.g. exceptions needing review). */
  readonly count?: (r: DemoResult) => number;
}

const SECTIONS: readonly Section[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, Screen: OverviewScreen },
  { key: "invoices", label: "Invoices", icon: FileText, Screen: InvoicesScreen },
  { key: "reconcile", label: "Reconcile", icon: Scale, Screen: ReconcileScreen },
  {
    key: "exceptions",
    label: "Exceptions",
    icon: TriangleAlert,
    Screen: ExceptionsScreen,
    count: (r) => r.exceptions.length,
  },
];

export default function App() {
  const [dataset, setDataset] = useState<DatasetKey>("consistent");
  const [section, setSection] = useState<SectionKey>("overview");

  const result = useMemo(() => runDemo(dataset), [dataset]);

  const active = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0]!;
  const ActiveScreen = active.Screen;
  const meta = DATASETS.find((d) => d.key === dataset) ?? DATASETS[0]!;

  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      {/* Persistent SYNTHETIC banner — never presented as a real close. */}
      <div className="flex items-center justify-center gap-2 bg-warning px-4 py-1.5 text-center text-xs font-semibold text-warning-foreground">
        <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
        <span>{BANNER} — figures are illustrative, not a real Coro close.</span>
      </div>

      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Left rail. */}
        <aside className="shrink-0 border-b border-border bg-card/40 lg:w-64 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2.5 px-5 py-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Scale className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">MSP Hub</div>
              <div className="text-xs text-muted-foreground">Coro Billing</div>
            </div>
          </div>

          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-4">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const isActive = s.key === section;
              const count = s.count?.(result) ?? 0;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSection(s.key)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-3 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 text-left">{s.label}</span>
                  {count > 0 && (
                    <span
                      className={cn(
                        "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular",
                        isActive
                          ? "bg-primary/20 text-primary"
                          : "bg-warning/15 text-warning"
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="hidden px-5 pb-5 lg:block">
            <p className="text-xs leading-relaxed text-muted-foreground">
              The automated version of Lindita&apos;s manual workbook — usage in, H &amp; L
              applied, QuickBooks out.
            </p>
          </div>
        </aside>

        {/* Main column. */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header. */}
          <header className="border-b border-border px-6 py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <h1 className="text-lg font-semibold tracking-tight">MSP Hub — Coro Billing</h1>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Internal accounting close ·{" "}
                  <span className="tabular text-foreground">{result.period}</span>
                </p>
              </div>

              {/* Dataset switcher — segmented control over DATASETS. */}
              <div className="shrink-0">
                <div className="inline-flex items-center rounded-lg border border-border bg-card p-1">
                  {DATASETS.map((d) => {
                    const isActive = d.key === dataset;
                    return (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() => setDataset(d.key)}
                        aria-pressed={isActive}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          isActive
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 max-w-md text-xs leading-relaxed text-muted-foreground lg:text-right">
                  {meta.blurb}
                </p>
              </div>
            </div>

            {/* Ingest error banner (should be none for synthetic fixtures). */}
            {result.ingestErrors.length > 0 && (
              <div className="mt-4 rounded-lg border border-danger/40 bg-danger/10 p-4">
                <div className="flex items-start gap-2.5">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-danger">
                      Ingest errors — the close cannot be trusted
                    </div>
                    <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                      {result.ingestErrors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </header>

          {/* Active screen. */}
          <main className="flex-1 px-6 py-6">
            <ActiveScreen result={result} />
          </main>

          {/* Footer. */}
          <footer className="border-t border-border px-6 py-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Runs the real pipeline in-browser over synthetic fixtures ·{" "}
              <span className="text-foreground/70">H (our cost) stays internal</span> ·
              QuickBooks is the system of record.
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}
