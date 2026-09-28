/**
 * Trends — the insights layer over locally archived closes (spec §3–§4).
 *
 * Everything on this screen renders from CloseSnapshots in the browser's
 * archive store: month chips pick the focus month, the area chart tracks
 * billed vs gross profit across every archived month, the waterfall bridges
 * the prior month's billed total into the chosen one (new partners /
 * discontinued / volume / rate), the credit tracker walks each expected Coro
 * credit through memo-received to applied, and the archive panel owns
 * export/import. Nothing leaves this machine except the archive file the
 * user downloads.
 */
import { useMemo, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { trendSeries, waterfall } from "@pipeline/close/trends.js";
import type { CloseSnapshot, CreditStatus } from "@pipeline/domain/snapshot.js";
import { ARCHIVE_LAST_EXPORT_KEY, archiveSupersededKey, useClose } from "@/lib/closeStore";
import type { ScreenProps } from "@/lib/nav";
import { moneyStr } from "@/lib/format";
import { GlassPanel } from "@/components/glass/GlassPanel";
import { AreaChart } from "@/components/glass/AreaChart";
import { WaterfallChart } from "@/components/glass/WaterfallChart";
import { StatusPill } from "@/components/glass/StatusPill";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/** "$1,234.56" / "−$1,234.56" from signed cents — charts and tables share it. */
function fmtCents(c: number): string {
  return (
    (c < 0 ? "−" : "") +
    "$" +
    Math.abs(c / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** localStorage read that never throws (private mode / quota weirdness). */
function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const CREDIT_STATUSES: readonly CreditStatus[] = ["expected", "memo-received", "applied"];

interface CreditRow {
  readonly period: string;
  readonly slug: string;
  readonly name: string;
  readonly expected: string;
  readonly status: CreditStatus;
}

export function TrendsScreen(_props: ScreenProps) {
  const {
    model,
    period,
    archivePeriods,
    loadArchived,
    exportArchiveFile,
    importArchiveFile,
    setCredit,
  } = useClose();
  const [selected, setSelected] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const snaps = useMemo(
    () => archivePeriods.map((p) => loadArchived(p)).filter((s): s is CloseSnapshot => s !== null),
    [archivePeriods, loadArchived]
  );
  const series = useMemo(() => trendSeries(snaps), [snaps]);

  // Chips choose the focus month (curr); prev = the archived month right before it.
  const curr =
    selected !== null && archivePeriods.includes(selected)
      ? selected
      : (archivePeriods.at(-1) ?? null);
  const currIdx = curr === null ? -1 : archivePeriods.indexOf(curr);
  const prevPeriod = currIdx > 0 ? archivePeriods[currIdx - 1]! : null;
  const currSnap = curr === null ? null : (snaps.find((s) => s.period === curr) ?? null);
  const prevSnap =
    prevPeriod === null ? null : (snaps.find((s) => s.period === prevPeriod) ?? null);

  const buckets = useMemo(
    () => (prevSnap !== null && currSnap !== null ? waterfall(prevSnap, currSnap) : null),
    [prevSnap, currSnap]
  );

  // Credit tracker: every (month, partner) with an expected credit, across the archive.
  const creditRows = useMemo<readonly CreditRow[]>(() => {
    const rows: CreditRow[] = [];
    for (const s of snaps) {
      for (const p of s.partners) {
        if (p.creditExpected !== "0.00") {
          rows.push({
            period: s.period,
            slug: p.slug,
            name: p.cardName,
            expected: p.creditExpected,
            status: s.creditStatus[p.slug] ?? "expected",
          });
        }
      }
    }
    rows.sort((a, b) => b.period.localeCompare(a.period) || Number(b.expected) - Number(a.expected));
    return rows;
  }, [snaps]);
  const outstandingCents = creditRows.reduce(
    (s, r) => s + (r.status !== "applied" ? Math.round(Number(r.expected) * 100) : 0),
    0
  );

  const lastExport = readKey(ARCHIVE_LAST_EXPORT_KEY);
  const unexported = snaps.some((s) => lastExport === null || s.savedAt > lastExport);
  // The live close, when it hasn't been archived yet — shown as a ghost chip.
  const unsavedGhost = model !== null && !archivePeriods.includes(period);

  const onImportFile = async (file: File | undefined) => {
    if (file === undefined) return;
    const res = importArchiveFile(await file.text());
    setImportResult(
      "error" in res
        ? `import failed: ${res.error}`
        : `imported ${res.imported} · skipped ${res.skipped}`
    );
  };

  const exportImportButtons = (idSuffix: string) => (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        className="h-auto px-2.5 py-1.5 text-xs"
        data-testid={`archive-export${idSuffix}`}
        onClick={exportArchiveFile}
      >
        <Download className="h-3.5 w-3.5" />
        Export
      </Button>
      <Button
        variant="outline"
        className="h-auto px-2.5 py-1.5 text-xs"
        data-testid={`archive-import${idSuffix}`}
        onClick={() => fileRef.current?.click()}
      >
        <Upload className="h-3.5 w-3.5" />
        Import
      </Button>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="fade-up space-y-2">
        <h1 className="figure rule-brass text-2xl">Trends</h1>
        <p className="pt-1 text-sm text-muted-foreground">
          Month over month from the local close archive — save each close from Overview and the
          charts, bridge, and credit tracker build themselves. Data stays in this browser.
        </p>
      </div>

      {/* Month chips — archived periods + the live close as a ghost when unsaved. */}
      <div className="fade-up flex flex-wrap items-center gap-2" style={{ animationDelay: "40ms" }}>
        {archivePeriods.map((p) => (
          <button
            key={p}
            data-testid={`trends-chip-${p}`}
            onClick={() => setSelected(p)}
            className={cn(
              "tabular rounded-full border px-3 py-1 text-xs transition-colors",
              p === curr
                ? "border-primary/40 bg-primary/15 font-medium text-primary"
                : "border-edge bg-glass-1 text-muted-foreground hover:bg-glass-2 hover:text-foreground"
            )}
          >
            {p}
          </button>
        ))}
        {unsavedGhost && (
          <span
            data-testid="trends-chip-unsaved"
            className="tabular rounded-full border border-dashed border-edge px-3 py-1 text-xs text-muted-foreground/70"
            title="The current close isn't archived yet — save it from Overview."
          >
            {period} · unsaved
          </span>
        )}
        {archivePeriods.length === 0 && !unsavedGhost && (
          <span className="text-xs text-muted-foreground">no archived months yet</span>
        )}
      </div>

      {snaps.length < 2 ? (
        /* Empty state — charts need two months. Export/import still works here. */
        <div className="fade-up" style={{ animationDelay: "80ms" }}>
          <GlassPanel title="Not enough months yet">
            <div className="space-y-4 p-5">
              <p className="text-sm text-muted-foreground">
                Trends light up with two archived months — save July and August from Overview.
              </p>
              {exportImportButtons("-empty")}
            </div>
          </GlassPanel>
        </div>
      ) : (
        <>
          {/* Billed vs GP across every archived month. */}
          <div className="fade-up" style={{ animationDelay: "80ms" }}>
            <GlassPanel
              title="Billed & gross profit"
              hint="every archived month"
              right={
                <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="h-0.5 w-5 rounded-full bg-primary" />
                    billed
                  </span>
                  <span className="flex items-center gap-1.5">
                    <svg width="20" height="2" aria-hidden>
                      <line
                        x1="0"
                        y1="1"
                        x2="20"
                        y2="1"
                        stroke="hsl(var(--success))"
                        strokeWidth="2"
                        strokeDasharray="4 3"
                      />
                    </svg>
                    GP (dashed)
                  </span>
                </span>
              }
            >
              <div className="p-4" data-testid="trends-area-chart">
                <AreaChart
                  periods={series.map((p) => p.period)}
                  series={[
                    {
                      label: "Billed",
                      values: series.map((p) => p.billedCents / 100),
                      color: "hsl(var(--primary))",
                    },
                    {
                      label: "Gross profit",
                      values: series.map((p) => p.marginCents / 100),
                      color: "hsl(var(--success))",
                      dashed: true,
                    },
                  ]}
                  ariaSummary="Billed and gross profit by month"
                />
              </div>
            </GlassPanel>
          </div>

          {/* The bridge: what moved billed from prev to curr. */}
          {buckets !== null && prevSnap !== null && currSnap !== null && (
            <div className="fade-up" style={{ animationDelay: "120ms" }}>
              <GlassPanel
                title={`Billed bridge — ${prevSnap.period} → ${currSnap.period}`}
                hint="new partners · discontinued · volume · rate"
              >
                <div className="p-4" data-testid="trends-waterfall">
                  <WaterfallChart
                    buckets={buckets}
                    ariaSummary={`Billed bridge from ${prevSnap.period} to ${currSnap.period}; the table below carries the exact figures`}
                    formatCents={fmtCents}
                  />
                  {/* Accessible fallback — the canonical figures behind the bars. */}
                  <table className="mt-4 w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="py-1 pr-3 font-normal">Bucket</th>
                        <th className="py-1 text-right font-normal">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {buckets.map((b) => (
                        <tr key={b.key} className="border-t border-edge">
                          <td className="py-1.5 pr-3">{b.label}</td>
                          <td
                            className={cn(
                              "tabular py-1.5 text-right",
                              b.kind === "delta" &&
                                (b.amountCents >= 0 ? "text-success" : "text-danger")
                            )}
                          >
                            {b.kind === "delta" && b.amountCents >= 0 ? "+" : ""}
                            {fmtCents(b.amountCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-[11px] text-muted-foreground/70">
                    Rate changes include the qty×rate cross term and any rounding residue, so the
                    bridge ties exactly.
                  </p>
                </div>
              </GlassPanel>
            </div>
          )}
        </>
      )}

      {/* Coro credit tracker — expected credits across every archived month. */}
      {creditRows.length > 0 && (
        <div className="fade-up" style={{ animationDelay: "160ms" }}>
          <GlassPanel
            title="Coro credit tracker"
            hint="expected → memo received → applied"
            right={
              <span className="text-xs text-muted-foreground">
                outstanding{" "}
                <span className="tabular font-medium text-primary">
                  {fmtCents(outstandingCents)}
                </span>
              </span>
            }
          >
            <div className="px-4 pb-4 pt-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1.5 pr-3 font-normal">Partner</th>
                    <th className="py-1.5 pr-3 font-normal">Month</th>
                    <th className="py-1.5 pr-3 text-right font-normal">Expected</th>
                    <th className="py-1.5 font-normal">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {creditRows.map((r) => (
                    <tr
                      key={`${r.period}-${r.slug}`}
                      className="border-t border-edge transition-colors hover:bg-glass-2"
                    >
                      <td className="py-2 pr-3 font-medium">{r.name}</td>
                      <td className="tabular py-2 pr-3 text-muted-foreground">{r.period}</td>
                      <td className="tabular py-2 pr-3 text-right">{moneyStr(r.expected)}</td>
                      <td className="py-2">
                        <span className="flex items-center gap-2">
                          <StatusPill status={r.status} />
                          <select
                            aria-label={`Credit status for ${r.name} ${r.period}`}
                            data-testid={`credit-status-${r.period}-${r.slug}`}
                            value={r.status}
                            onChange={(e) =>
                              setCredit(r.period, r.slug, e.target.value as CreditStatus)
                            }
                            className="rounded-md border border-edge bg-glass-1 px-2 py-1 text-xs text-foreground"
                          >
                            {CREDIT_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-edge">
                    <td colSpan={2} className="py-2 pr-3 text-xs text-muted-foreground">
                      running balance (status ≠ applied)
                    </td>
                    <td
                      className="tabular py-2 pr-3 text-right font-medium text-primary"
                      data-testid="credit-outstanding"
                    >
                      {fmtCents(outstandingCents)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </GlassPanel>
        </div>
      )}

      {/* Archive — the periods on disk, export/import, and the backup nudge. */}
      {archivePeriods.length > 0 && (
        <div className="fade-up" style={{ animationDelay: "200ms" }}>
          <GlassPanel
            title="Archive"
            hint="local to this browser — export for backup"
            right={
              <div className="flex items-center gap-2">
                {unexported && (
                  <span
                    data-testid="archive-unexported"
                    className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10.5px] text-warning"
                  >
                    unexported changes
                  </span>
                )}
                {exportImportButtons("")}
              </div>
            }
          >
            <div className="space-y-2 p-4">
              {snaps.map((s) => {
                const superseded = readKey(archiveSupersededKey(s.period)) !== null;
                return (
                  <div
                    key={s.period}
                    data-testid={`archive-period-${s.period}`}
                    className="rounded-[10px] border border-edge bg-glass-1 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className="figure text-sm">{s.period}</span>
                      <span className="text-[11px] text-muted-foreground">
                        saved {s.savedAt.slice(0, 10)}
                      </span>
                      <span className="tabular text-[10px] text-muted-foreground/70">
                        p:{s.fingerprints.pricing.slice(0, 6)} · u:
                        {s.fingerprints.usage.slice(0, 6)}
                        {s.fingerprints.invoice !== undefined
                          ? ` · i:${s.fingerprints.invoice.slice(0, 6)}`
                          : ""}
                      </span>
                      <span className="tabular ml-auto text-xs text-muted-foreground">
                        billed {moneyStr(s.totals.billedL)}
                      </span>
                    </div>
                    {superseded && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground/60">
                        superseded an earlier snapshot (different files)
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </GlassPanel>
        </div>
      )}

      {importResult !== null && (
        <p
          data-testid="archive-import-result"
          className={cn(
            "text-xs",
            importResult.startsWith("import failed") ? "text-danger" : "text-success"
          )}
        >
          {importResult}
        </p>
      )}

      {/* One shared file input — both Import buttons trigger it. */}
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        data-testid="archive-import-input"
        onChange={(e) => {
          void onImportFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
