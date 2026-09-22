/**
 * MSP Hub — Coro Billing workbench shell ("Midnight Ledger" design system).
 *
 * Six screens over one CloseModel: Intake (drop the month's files) → Overview →
 * Rate Cards → Reconcile → Invoices (the payoff: per-MSP drafts the account
 * team approves) → Exceptions. All state lives in closeStore; screens are
 * presentational. The SYNTHETIC banner renders ONLY in demo mode — real files
 * never show it.
 */
import { useMemo, useState, type ComponentType } from "react";
import {
  Inbox,
  LayoutDashboard,
  BadgeDollarSign,
  Scale,
  FileText,
  TriangleAlert,
  ShieldAlert,
} from "lucide-react";
import { useClose, SYNTHETIC_BANNER } from "@/lib/closeStore";
import type { ScreenProps, SectionKey } from "@/lib/nav";
import { cn } from "@/lib/cn";
import { CloseChecklist } from "@/components/CloseChecklist";
import { HelpDialog } from "@/components/HelpDialog";
import { IntakeScreen } from "@/screens/Intake";
import { OverviewScreen } from "@/screens/Overview";
import { RateCardsScreen } from "@/screens/RateCards";
import { ReconcileScreen } from "@/screens/Reconcile";
import { InvoicesScreen } from "@/screens/Invoices";
import { ExceptionsScreen } from "@/screens/Exceptions";

interface Section {
  readonly key: SectionKey;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly Screen: ComponentType<ScreenProps>;
  readonly needsModel: boolean;
}

const SECTIONS: readonly Section[] = [
  { key: "intake", label: "Intake", icon: Inbox, Screen: IntakeScreen, needsModel: false },
  { key: "overview", label: "Overview", icon: LayoutDashboard, Screen: OverviewScreen, needsModel: true },
  { key: "ratecards", label: "Rate Cards", icon: BadgeDollarSign, Screen: RateCardsScreen, needsModel: true },
  { key: "reconcile", label: "Reconcile", icon: Scale, Screen: ReconcileScreen, needsModel: true },
  { key: "invoices", label: "Invoices", icon: FileText, Screen: InvoicesScreen, needsModel: true },
  { key: "exceptions", label: "Exceptions", icon: TriangleAlert, Screen: ExceptionsScreen, needsModel: true },
];

/** The real MSPHUB wordmark on a white chip (the brand asset is blue-on-white). */
function Mark() {
  return (
    <div className="inline-flex items-center rounded-md bg-white px-2.5 py-2 shadow-sm">
      <img src="/brand/msphub-logo.jpeg" alt="MSP Hub" className="h-4 w-auto" />
    </div>
  );
}

function FileChip({ label, loaded }: { label: string; loaded: string | undefined }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-44 items-center gap-1.5 truncate rounded-full border px-2.5 py-1 text-xs",
        loaded
          ? "border-success/40 bg-success/10 text-success"
          : "border-border bg-muted/40 text-muted-foreground"
      )}
      title={loaded ?? `${label} not loaded`}
    >
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", loaded ? "bg-success" : "bg-muted-foreground/50")}
      />
      <span className="truncate">{loaded ?? label}</span>
    </span>
  );
}

export default function App() {
  const store = useClose();
  const [section, setSection] = useState<SectionKey>("intake");
  const [context, setContext] = useState<string | undefined>(undefined);

  const onNavigate = (next: SectionKey, ctx?: string) => {
    setSection(next);
    setContext(ctx);
  };

  const badges = useMemo(() => {
    const m = store.model;
    if (!m) return { exceptions: 0, invoices: 0 };
    const unreviewed = m.partners.filter((p) => store.review[p.slug] === undefined).length;
    return { exceptions: m.findings.length, invoices: unreviewed };
  }, [store.model, store.review]);

  const active = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0]!;
  const ActiveScreen = active.Screen;

  return (
    <div className="flex min-h-full flex-col bg-transparent text-foreground">
      {store.demo && (
        <div className="flex items-center justify-center gap-2 bg-warning px-4 py-1.5 text-center text-xs font-semibold text-warning-foreground">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          <span>{SYNTHETIC_BANNER} — figures are illustrative, not a real Coro close.</span>
        </div>
      )}

      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Left rail */}
        <aside className="shrink-0 border-b border-border bg-card/60 backdrop-blur lg:w-64 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3 px-5 pb-4 pt-6">
            <Mark />
            <div>
              <div className="font-display text-[15px] font-semibold tracking-tight">
                Coro Billing
              </div>
              <div className="microlabel mt-0.5">Close workbench</div>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto p-3 lg:flex-col">
            {SECTIONS.map((s) => {
              const disabled = s.needsModel && store.model === null;
              const count =
                s.key === "exceptions"
                  ? badges.exceptions
                  : s.key === "invoices"
                    ? badges.invoices
                    : 0;
              return (
                <button
                  key={s.key}
                  data-testid={`nav-${s.key}`}
                  disabled={disabled}
                  onClick={() => onNavigate(s.key)}
                  className={cn(
                    "flex items-center gap-2.5 whitespace-nowrap rounded-md border-l-2 border-transparent px-3 py-2 text-sm transition-colors",
                    section === s.key
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    disabled && "opacity-40"
                  )}
                >
                  <s.icon className="h-4 w-4 shrink-0" />
                  {s.label}
                  {count > 0 && (
                    <span
                      className={cn(
                        "tabular ml-auto rounded-full px-1.5 py-0.5 text-xs",
                        section === s.key ? "bg-primary/20" : "bg-muted"
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
          <CloseChecklist onNavigate={(s) => onNavigate(s)} />
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="ledger-lines flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-3.5">
            <div className="flex items-baseline gap-2">
              <span className="figure text-lg text-foreground">{store.period}</span>
              <span className="microlabel">close</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FileChip label="pricing" loaded={store.files.pricing?.fileName} />
              <FileChip label="usage" loaded={store.files.usage?.fileName} />
              <FileChip label="invoice" loaded={store.files.invoice?.fileName} />
              <HelpDialog />
            </div>
          </header>

          {store.invoicePeriodMismatch !== null && (
            <div
              className="flex items-center justify-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-1.5 text-center text-xs text-warning"
              data-testid="period-mismatch"
            >
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
              <span>
                The loaded Coro invoice is mostly <b>{store.invoicePeriodMismatch.invoicePeriod}</b>{" "}
                service ({store.invoicePeriodMismatch.lines} lines) but this close is{" "}
                <b>{store.period}</b> — cost cross-checks won't line up. Load the matching month's
                invoice, or the matching usage.
              </span>
            </div>
          )}

          <main className="flex-1 overflow-auto p-6 lg:p-8">
            {active.needsModel && store.model === null ? (
              <div className="mx-auto mt-20 max-w-md text-center">
                <p className="figure mb-2 text-xl text-foreground">Nothing on the ledger yet</p>
                <p className="mb-4 text-sm text-muted-foreground">
                  Drop the month's files first — the close builds itself.
                </p>
                <button className="text-sm text-primary underline underline-offset-4" onClick={() => onNavigate("intake")}>
                  Go to intake
                </button>
              </div>
            ) : (
              <ActiveScreen key={active.key} onNavigate={onNavigate} context={context} />
            )}
          </main>

          <footer className="border-t border-border px-6 py-2 text-xs text-muted-foreground/80">
            All parsing and pricing runs in your browser — files never leave this machine. Every
            number traces to a source row or a written Coro rate; anything unpriceable is HELD, never
            invented.
          </footer>
        </div>
      </div>
    </div>
  );
}
