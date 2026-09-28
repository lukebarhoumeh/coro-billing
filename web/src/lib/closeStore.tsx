/**
 * Close store — the single source of state for the dashboard.
 *
 * Holds the three dropped files (parsed payloads + fingerprints), derives the
 * CloseModel whenever pricing+usage are present, and owns the account team's
 * review state (approve / needs-review + note per partner), persisted to
 * localStorage keyed by period + file fingerprints so re-dropping identical
 * files keeps the review.
 *
 * Demo mode feeds the loudly-synthetic packet through the SAME parse+close
 * path — nothing is faked downstream of the fixtures. Dropping any real file
 * exits demo mode.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { closeFromRateCard } from "@pipeline/close/rateCardClose.js";
import { isOk } from "@pipeline/lib/result.js";
import type { CloseModel, Period } from "@pipeline/domain/types.js";
import {
  snapshotFromClose,
  type CloseSnapshot,
  type CreditStatus,
} from "@pipeline/domain/snapshot.js";
import { CONFIRMED_RATES_REVISION } from "@pipeline/config/confirmedRates.js";
import { buildRateCardDemo, SYNTHETIC_BANNER } from "@fixtures/synthetic/rateCardDemo.js";
import {
  fingerprintBytes,
  parseSlotBytes,
  periodFromFileName,
  reviewStorageKey,
  type ParsedSlot,
  type SlotKey,
  type SlotPayload,
  type SlotReport,
} from "@/lib/loadFiles";
import {
  exportArchive,
  importArchive,
  listPeriods,
  loadSnapshot,
  saveSnapshot,
  setCreditStatus,
} from "@/lib/closeArchive";
import { downloadText } from "@/lib/download";

export { SYNTHETIC_BANNER };

export interface LoadedSlot {
  readonly fileName: string;
  readonly fingerprint: string;
  readonly payload: SlotPayload;
  readonly report: SlotReport;
}

export type ReviewStatus = "approved" | "needs_review";
export interface ReviewEntry {
  readonly status: ReviewStatus;
  readonly note: string;
}
export type ReviewState = Readonly<Record<string, ReviewEntry>>;

/**
 * A month packet bundled with the deployment (web/public/packet/manifest.json).
 * Absent by default — the button only lights up when someone has deliberately
 * placed the files there. `invoice` is optional.
 */
export interface PacketManifest {
  readonly period: Period;
  readonly label: string;
  readonly files: Partial<Readonly<Record<SlotKey, string>>>;
}

export type ExportKind = "excel" | "qbcsv" | "qbiif";

/** The month-end checklist state, derived live from the model + review. */
export interface CloseProgress {
  readonly filesReady: boolean;
  readonly invoiceLoaded: boolean;
  readonly blockers: number; // block-severity findings still standing
  readonly approved: number;
  readonly totalDrafts: number;
  readonly exportedAny: boolean;
}

/** Stable identity for a finding, for the acknowledge burn-down. */
export function findingKey(f: {
  kind: string;
  partner: string;
  sku: string;
  sourceRow?: number;
}): string {
  return `${f.kind}|${f.partner}|${f.sku}|${f.sourceRow ?? ""}`;
}

/** KV marker: ISO timestamp of the last archive export (drives "unexported changes"). */
export const ARCHIVE_LAST_EXPORT_KEY = "coro-archive:v1:last-export";

/** KV key holding the fingerprints a re-save with DIFFERENT files replaced. */
export function archiveSupersededKey(period: string): string {
  return `coro-archive:v1:superseded:${period}`;
}

function sameFingerprints(
  a: CloseSnapshot["fingerprints"],
  b: CloseSnapshot["fingerprints"]
): boolean {
  return (
    a.pricing === b.pricing && a.usage === b.usage && (a.invoice ?? null) === (b.invoice ?? null)
  );
}

export interface CloseStore {
  readonly files: Partial<Readonly<Record<SlotKey, LoadedSlot>>>;
  readonly demo: boolean;
  readonly period: Period;
  readonly model: CloseModel | null;
  readonly review: ReviewState;
  /** Acknowledged finding keys (findingKey()) — the exception burn-down. */
  readonly acked: ReadonlySet<string>;
  /** ISO timestamps of exports taken for this month's files. */
  readonly exported: Partial<Readonly<Record<ExportKind, string>>>;
  /** The live month-end checklist. */
  readonly progress: CloseProgress;
  /**
   * Set when a loaded Coro invoice's service month differs from the close
   * month on ≥half its lines — the July-invoice-vs-August-usage trap.
   */
  readonly invoicePeriodMismatch: { readonly invoicePeriod: Period; readonly lines: number } | null;
  /** Last per-slot error message (cleared on a successful drop). */
  readonly errors: Partial<Readonly<Record<SlotKey, string>>>;
  /** Bundled month packet, when the deployment carries one. */
  readonly packet: PacketManifest | null;
  readonly packetLoading: boolean;
  /** Archived close periods (sorted ascending) — the local close archive. */
  readonly archivePeriods: readonly string[];
  /**
   * Every draft is approved but this close (period + file fingerprints) isn't
   * archived yet — Overview offers the save banner. Never auto-saves (spec §3).
   */
  readonly archivePromptDue: boolean;
  ingestFile(slot: SlotKey, file: File): Promise<void>;
  clearSlot(slot: SlotKey): void;
  loadDemo(): void;
  loadPacket(): Promise<void>;
  setReview(slug: string, entry: ReviewEntry | null): void;
  /** Bulk-approve (keeps any existing notes). */
  approveMany(slugs: readonly string[]): void;
  toggleAck(key: string): void;
  markExported(kind: ExportKind): void;
  /** Snapshot the current close into the archive (preserves credit-status edits). */
  saveCurrentToArchive(): { ok: boolean; period?: string };
  loadArchived(period: string): CloseSnapshot | null;
  /** Download the whole archive as JSON and stamp the last-export marker. */
  exportArchiveFile(): void;
  /** Merge an exported archive file — newest savedAt wins per period. */
  importArchiveFile(text: string): { imported: number; skipped: number } | { error: string };
  /** Move an archived credit through expected → memo-received → applied. */
  setCredit(period: string, slug: string, status: CreditStatus): void;
}

const Ctx = createContext<CloseStore | null>(null);

const DEFAULT_PERIOD: Period = "2026-08";

/** Everything persisted per (period, file fingerprints). */
interface MonthState {
  readonly review: ReviewState;
  readonly acked: readonly string[];
  readonly exported: Partial<Record<ExportKind, string>>;
}

const EMPTY_MONTH: MonthState = { review: {}, acked: [], exported: {} };

function loadMonthState(key: string): MonthState {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return EMPTY_MONTH;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && "review" in parsed) {
      return {
        review: (parsed["review"] as ReviewState) ?? {},
        acked: Array.isArray(parsed["acked"]) ? (parsed["acked"] as string[]) : [],
        exported: (parsed["exported"] as MonthState["exported"]) ?? {},
      };
    }
    // Legacy shape: the blob WAS the review map.
    return { ...EMPTY_MONTH, review: parsed as unknown as ReviewState };
  } catch {
    return EMPTY_MONTH; // private mode / quota / corrupt JSON — start clean, never crash
  }
}

function saveMonthState(key: string, state: MonthState): void {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Persistence is best-effort; the in-memory state still works.
  }
}

export function CloseProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<Partial<Record<SlotKey, LoadedSlot>>>({});
  const [errors, setErrors] = useState<Partial<Record<SlotKey, string>>>({});
  const [demo, setDemo] = useState(false);
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);
  const [month, setMonth] = useState<MonthState>(EMPTY_MONTH);
  const [packet, setPacket] = useState<PacketManifest | null>(null);
  const [packetLoading, setPacketLoading] = useState(false);
  // Bumped after every archive write so archive-derived state recomputes.
  const [archiveTick, setArchiveTick] = useState(0);

  // Discover a bundled month packet, if this deployment carries one.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/packet/manifest.json", { cache: "no-store" });
        if (!res.ok) return;
        const m = (await res.json()) as PacketManifest;
        if (!cancelled && m && typeof m.period === "string" && m.files) setPacket(m);
      } catch {
        // No packet — the normal case.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const model = useMemo<CloseModel | null>(() => {
    const pricing = files.pricing?.payload;
    const usage = files.usage?.payload;
    if (pricing?.slot !== "pricing" || usage?.slot !== "usage") return null;
    const invoice = files.invoice?.payload;
    return closeFromRateCard({
      pricing: pricing.pricing,
      usage: usage.usage,
      coroInvoiceLines: invoice?.slot === "invoice" ? invoice.lines : undefined,
      period,
    });
  }, [files, period]);

  const storageKey = useMemo(() => {
    if (!files.pricing || !files.usage) return null;
    return reviewStorageKey(period, files.pricing.fingerprint, files.usage.fingerprint);
  }, [files.pricing, files.usage, period]);

  // (Re)hydrate review/ack/export state whenever the month identity changes.
  useEffect(() => {
    setMonth(storageKey ? loadMonthState(storageKey) : EMPTY_MONTH);
  }, [storageKey]);

  /** Update the month state and write through to localStorage. */
  const patchMonth = useCallback(
    (fn: (m: MonthState) => MonthState) => {
      setMonth((m) => {
        const next = fn(m);
        if (storageKey) saveMonthState(storageKey, next);
        return next;
      });
    },
    [storageKey]
  );

  const ingestFile = useCallback(
    async (slot: SlotKey, file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // A usage file names the month — adopt it for the whole close.
      const filePeriod = periodFromFileName(file.name);
      const nextPeriod = slot === "usage" && filePeriod !== null ? filePeriod : period;
      const parsed = parseSlotBytes(slot, file.name, bytes, nextPeriod);
      if (!isOk(parsed)) {
        setErrors((e) => ({ ...e, [slot]: parsed.error }));
        return;
      }
      const fingerprint = await fingerprintBytes(bytes);
      const loaded: LoadedSlot = { fileName: file.name, fingerprint, ...parsed.value };
      if (slot === "usage" && filePeriod !== null) setPeriod(filePeriod);
      setErrors((e) => ({ ...e, [slot]: undefined }));
      setFiles((f) => {
        // Dropping a real file exits demo mode and clears demo payloads.
        const base = demo ? {} : f;
        return { ...base, [slot]: loaded };
      });
      setDemo(false);
    },
    [demo, period]
  );

  const clearSlot = useCallback((slot: SlotKey) => {
    setFiles((f) => {
      const next = { ...f };
      delete next[slot];
      return next;
    });
    setErrors((e) => ({ ...e, [slot]: undefined }));
  }, []);

  const loadDemo = useCallback(() => {
    const d = buildRateCardDemo();
    const pricing = parseSlotBytes(
      "pricing",
      "DEMO pricing.csv",
      new TextEncoder().encode(d.pricingCsv),
      d.period
    );
    if (!isOk(pricing)) return; // fixture bug — surfaced by tests, not the UI
    setFiles({
      pricing: {
        fileName: "DEMO pricing.csv",
        fingerprint: "demo-pricing",
        ...pricing.value,
      },
      usage: {
        fileName: "DEMO usage (synthetic)",
        fingerprint: "demo-usage",
        payload: { slot: "usage", usage: d.usage },
        report: { rowsRead: d.usage.length, warnings: [] },
      },
      invoice: {
        fileName: "DEMO Coro invoice (synthetic)",
        fingerprint: "demo-invoice",
        payload: { slot: "invoice", lines: d.coroInvoiceLines },
        report: { rowsRead: d.coroInvoiceLines.length, warnings: [] },
      },
    });
    setErrors({});
    setPeriod(d.period);
    setDemo(true);
  }, []);

  const setReview = useCallback(
    (slug: string, entry: ReviewEntry | null) => {
      patchMonth((m) => {
        const review: Record<string, ReviewEntry> = { ...m.review };
        if (entry === null) delete review[slug];
        else review[slug] = entry;
        return { ...m, review };
      });
    },
    [patchMonth]
  );

  const approveMany = useCallback(
    (slugs: readonly string[]) => {
      patchMonth((m) => {
        const review: Record<string, ReviewEntry> = { ...m.review };
        for (const slug of slugs) {
          review[slug] = { status: "approved", note: review[slug]?.note ?? "" };
        }
        return { ...m, review };
      });
    },
    [patchMonth]
  );

  const toggleAck = useCallback(
    (key: string) => {
      patchMonth((m) => {
        const acked = m.acked.includes(key)
          ? m.acked.filter((k) => k !== key)
          : [...m.acked, key];
        return { ...m, acked };
      });
    },
    [patchMonth]
  );

  const markExported = useCallback(
    (kind: ExportKind) => {
      patchMonth((m) => ({
        ...m,
        exported: { ...m.exported, [kind]: new Date().toISOString() },
      }));
    },
    [patchMonth]
  );

  /** Load the deployment's bundled month packet through the SAME parse path as drops. */
  const loadPacket = useCallback(async () => {
    if (packet === null || packetLoading) return;
    setPacketLoading(true);
    try {
      const next: Partial<Record<SlotKey, LoadedSlot>> = {};
      for (const slot of ["pricing", "usage", "invoice"] as const) {
        const url = packet.files[slot];
        if (url === undefined) continue;
        const res = await fetch(url);
        if (!res.ok) {
          setErrors((e) => ({ ...e, [slot]: `packet file missing: ${url} (${res.status})` }));
          continue;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        const fileName = decodeURIComponent(url.split("/").pop() ?? url);
        const parsed = parseSlotBytes(slot, fileName, bytes, packet.period);
        if (!isOk(parsed)) {
          setErrors((e) => ({ ...e, [slot]: parsed.error }));
          continue;
        }
        next[slot] = { fileName, fingerprint: await fingerprintBytes(bytes), ...parsed.value };
      }
      if (next.pricing && next.usage) {
        setFiles(next);
        setErrors({});
        setPeriod(packet.period);
        setDemo(false);
      }
    } finally {
      setPacketLoading(false);
    }
  }, [packet, packetLoading]);

  const acked = useMemo(() => new Set(month.acked), [month.acked]);

  const progress = useMemo<CloseProgress>(() => {
    const totalDrafts = model?.partners.length ?? 0;
    const approved =
      model?.partners.filter((p) => month.review[p.slug]?.status === "approved").length ?? 0;
    return {
      filesReady: files.pricing !== undefined && files.usage !== undefined,
      invoiceLoaded: files.invoice !== undefined,
      blockers: model?.findings.filter((f) => f.severity === "block").length ?? 0,
      approved,
      totalDrafts,
      exportedAny: Object.keys(month.exported).length > 0,
    };
  }, [files, model, month.review, month.exported]);

  // The July-invoice-vs-August-usage trap: warn when the loaded Coro invoice's
  // service month disagrees with the close month on at least half its lines.
  const invoicePeriodMismatch = useMemo(() => {
    const invoice = files.invoice?.payload;
    if (invoice?.slot !== "invoice" || invoice.lines.length === 0) return null;
    const counts = new Map<Period, number>();
    for (const l of invoice.lines) {
      if (l.servicePeriod !== undefined) {
        counts.set(l.servicePeriod, (counts.get(l.servicePeriod) ?? 0) + 1);
      }
    }
    let top: Period | null = null;
    let topCount = 0;
    for (const [p, n] of counts) if (n > topCount) { top = p; topCount = n; }
    if (top === null || top === period) return null;
    if (topCount * 2 < invoice.lines.length) return null;
    return { invoicePeriod: top, lines: topCount };
  }, [files.invoice, period]);

  // ---- Close archive (localStorage-backed; see web/src/lib/closeArchive.ts) ----

  /** Snapshot fingerprints = 12-char prefixes, same discipline as the review key. */
  const currentFingerprints = useMemo(() => {
    if (!files.pricing || !files.usage) return null;
    return {
      pricing: files.pricing.fingerprint.slice(0, 12),
      usage: files.usage.fingerprint.slice(0, 12),
      ...(files.invoice ? { invoice: files.invoice.fingerprint.slice(0, 12) } : {}),
    };
  }, [files.pricing, files.usage, files.invoice]);

  const archivePeriods = useMemo(() => {
    void archiveTick; // re-read after every archive write
    return listPeriods(localStorage);
  }, [archiveTick]);

  const saveCurrentToArchive = useCallback((): { ok: boolean; period?: string } => {
    if (model === null || currentFingerprints === null) return { ok: false };
    const fresh = snapshotFromClose(
      model,
      currentFingerprints,
      CONFIRMED_RATES_REVISION,
      new Date().toISOString()
    );
    const existing = loadSnapshot(localStorage, fresh.period);
    if (existing !== null && !sameFingerprints(existing.fingerprints, fresh.fingerprints)) {
      // Keep the replaced snapshot's fingerprints so Trends can note the supersede.
      try {
        localStorage.setItem(archiveSupersededKey(fresh.period), JSON.stringify(existing.fingerprints));
      } catch {
        // Best-effort marker; the save below still proceeds.
      }
    }
    // Preserve any credit-status edits made against an earlier save of this period.
    saveSnapshot(localStorage, {
      ...fresh,
      creditStatus: { ...fresh.creditStatus, ...(existing?.creditStatus ?? {}) },
    });
    setArchiveTick((t) => t + 1);
    return { ok: true, period: fresh.period };
  }, [model, currentFingerprints]);

  const loadArchived = useCallback(
    (p: string): CloseSnapshot | null => loadSnapshot(localStorage, p),
    []
  );

  const exportArchiveFile = useCallback(() => {
    const tag = listPeriods(localStorage).at(-1) ?? period;
    downloadText(`coro-close-archive-${tag}.json`, "application/json", exportArchive(localStorage));
    try {
      localStorage.setItem(ARCHIVE_LAST_EXPORT_KEY, new Date().toISOString());
    } catch {
      // Best-effort marker; the download already happened.
    }
    setArchiveTick((t) => t + 1);
  }, [period]);

  const importArchiveFile = useCallback(
    (text: string): { imported: number; skipped: number } | { error: string } => {
      try {
        const res = importArchive(localStorage, text);
        setArchiveTick((t) => t + 1);
        return res;
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
    []
  );

  const setCredit = useCallback((p: string, slug: string, status: CreditStatus) => {
    setCreditStatus(localStorage, p, slug, status);
    setArchiveTick((t) => t + 1);
  }, []);

  // The archive nudge: every draft approved (the checklist's own condition) but
  // this period+files combination isn't archived yet. Prompt only — never auto-save.
  const archivePromptDue = useMemo(() => {
    void archiveTick;
    if (model === null || currentFingerprints === null) return false;
    if (!(progress.totalDrafts > 0 && progress.approved === progress.totalDrafts)) return false;
    const existing = loadSnapshot(localStorage, model.period);
    return existing === null || !sameFingerprints(existing.fingerprints, currentFingerprints);
  }, [model, currentFingerprints, progress.totalDrafts, progress.approved, archiveTick]);

  const store = useMemo<CloseStore>(
    () => ({
      files, demo, period, model, review: month.review, acked, exported: month.exported,
      progress, invoicePeriodMismatch, errors, packet, packetLoading,
      archivePeriods, archivePromptDue,
      ingestFile, clearSlot, loadDemo, loadPacket, setReview, approveMany, toggleAck, markExported,
      saveCurrentToArchive, loadArchived, exportArchiveFile, importArchiveFile, setCredit,
    }),
    [files, demo, period, model, month.review, acked, month.exported, progress,
      invoicePeriodMismatch, errors, packet, packetLoading, archivePeriods, archivePromptDue,
      ingestFile, clearSlot, loadDemo, loadPacket, setReview, approveMany, toggleAck, markExported,
      saveCurrentToArchive, loadArchived, exportArchiveFile, importArchiveFile, setCredit]
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useClose(): CloseStore {
  const ctx = useContext(Ctx);
  if (ctx === null) throw new Error("useClose outside CloseProvider");
  return ctx;
}
