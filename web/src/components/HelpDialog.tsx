/**
 * "How the close works" — a plain-English glossary for the accounting team.
 * Opened from the header "?" button; pure overlay, no routing.
 */
import { X, CircleHelp } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const ENTRIES: readonly { term: string; def: string }[] = [
  {
    term: "Partner price (unit price)",
    def: 'What the MSP partner pays MSP Hub per unit — column E, "Net Price to MSP", on Coro\'s special pricing sheet. Every draft invoice line uses this. It is read from the sheet, never computed.',
  },
  {
    term: "Our cost — the additive rule (confirmed)",
    def: "Coro confirmed (2026-09-22) that our cost is the discounts stacked additively off list price: partner % + our additional % (45 minus the partner's, floored at 5) — a 58%+5% partner is billed at 63% off. The sheet's col H mostly still carries the older partner-price × 0.95 reading; it's shown as reference only. When you load the Coro invoice, its actual billed amounts win.",
  },
  {
    term: "Classic exception",
    def: "Coro Classic and Managed Classic are the one legacy family where partner-specific discounts do NOT apply to our cost: flat 45% off list regardless (Coro, 2026-09-22). Where a partner's card row says otherwise, the platform uses the flat rule and flags the row.",
  },
  {
    term: "Credit expected",
    def: "Coro confirmed partner-specific discounts apply to legacy flex — but their invoices billed those lines at the flat legacy rate, which over-charged us. Each over-billed line shows the credit due (Coro says credits are in progress). GP stays cash-true until the credit memo lands; the after-credits figure is shown alongside.",
  },
  {
    term: "“Mislabel fix”",
    def: "Coro's corrected sheet renamed Cyber Construction's Coro Classic Flex row to “Modules Flex” ($11.99 list). The platform recognizes the mislabel by its exact list price, prices Classic usage from it, and flags every such line until Coro fixes the label.",
  },
  {
    term: "GP / GM",
    def: "Gross profit = what we bill the partner minus what Coro bills us. Gross margin = GP as a percent of what we bill. Tracked per line, per partner, and for the whole month.",
  },
  {
    term: "HELD line",
    def: "Usage exists but the partner's sheet has no price for that product, so the platform refuses to guess. Held lines are amber, excluded from totals, and listed under Exceptions — the fix is getting Coro to add the rate row.",
  },
  {
    term: "Approve / Needs review",
    def: "Your sign-off per draft invoice, with an optional note. Saved in this browser for this month's exact files — re-loading the same files restores it. QuickBooks exports include approved drafts only (you're asked before drafts are included).",
  },
  {
    term: "“Team billed differently”",
    def: "When the accounting team's manual workbook (its Client Price column) is loaded and its keyed bill-out rate differs from the special-pricing card, the line shows both. The draft always uses the card; if the workbook price is the negotiated one, the card needs updating — that's a Coro/Danny conversation, not an edit here.",
  },
  {
    term: "Acknowledge (findings)",
    def: "A checkbox per finding on the Exceptions screen so the team can burn the list down. Acknowledging records that a human saw it — it does not change any number.",
  },
  {
    term: "Findings severity",
    def: "Block = stops money (missing rate, unknown product). Warn = numbers disagree somewhere (quantities, Coro's billed rate) — billable but review. Info = worth knowing (sheet math inconsistencies, assumed mappings).",
  },
  {
    term: "NFR",
    def: "Not-for-resale workspaces (e.g. a partner's own trial). Listed for completeness, never billed.",
  },
];

export function HelpDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        data-testid="help-open"
        onClick={() => setOpen(true)}
        title="How the close works"
      >
        <CircleHelp className="h-4 w-4" />
        Help
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-lg border border-border bg-card p-6 shadow-ledger-lift"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="figure rule-brass text-xl">How the close works</h2>
                <p className="mt-3 text-sm text-muted-foreground">
                  Drop the month's files → the platform drafts one invoice per partner → you clear
                  blockers, approve, and export. Everything parses in your browser; nothing is
                  uploaded. No number is ever invented — anything unpriceable is HELD.
                </p>
              </div>
              <Button variant="ghost" data-testid="help-close" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <dl className="space-y-4">
              {ENTRIES.map((e) => (
                <div key={e.term}>
                  <dt className="text-sm font-medium text-primary">{e.term}</dt>
                  <dd className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{e.def}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </>
  );
}
