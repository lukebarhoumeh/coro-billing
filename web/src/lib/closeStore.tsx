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

export interface CloseStore {
  readonly files: Partial<Readonly<Record<SlotKey, LoadedSlot>>>;
  readonly demo: boolean;
  readonly period: Period;
  readonly model: CloseModel | null;
  readonly review: ReviewState;
  /** Last per-slot error message (cleared on a successful drop). */
  readonly errors: Partial<Readonly<Record<SlotKey, string>>>;
  /** Bundled month packet, when the deployment carries one. */
  readonly packet: PacketManifest | null;
  readonly packetLoading: boolean;
  ingestFile(slot: SlotKey, file: File): Promise<void>;
  clearSlot(slot: SlotKey): void;
  loadDemo(): void;
  loadPacket(): Promise<void>;
  setReview(slug: string, entry: ReviewEntry | null): void;
}

const Ctx = createContext<CloseStore | null>(null);

const DEFAULT_PERIOD: Period = "2026-08";

function loadReview(key: string): ReviewState {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as ReviewState) : {};
  } catch {
    return {}; // private mode / quota / corrupt JSON — start clean, never crash
  }
}

function saveReview(key: string, review: ReviewState): void {
  try {
    localStorage.setItem(key, JSON.stringify(review));
  } catch {
    // Persistence is best-effort; the in-memory state still works.
  }
}

export function CloseProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<Partial<Record<SlotKey, LoadedSlot>>>({});
  const [errors, setErrors] = useState<Partial<Record<SlotKey, string>>>({});
  const [demo, setDemo] = useState(false);
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);
  const [review, setReviewState] = useState<ReviewState>({});
  const [packet, setPacket] = useState<PacketManifest | null>(null);
  const [packetLoading, setPacketLoading] = useState(false);

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

  // (Re)hydrate review whenever the month identity changes.
  useEffect(() => {
    setReviewState(storageKey ? loadReview(storageKey) : {});
  }, [storageKey]);

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
      setReviewState((r) => {
        const next: Record<string, ReviewEntry> = { ...r };
        if (entry === null) delete next[slug];
        else next[slug] = entry;
        if (storageKey) saveReview(storageKey, next);
        return next;
      });
    },
    [storageKey]
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

  const store = useMemo<CloseStore>(
    () => ({
      files, demo, period, model, review, errors, packet, packetLoading,
      ingestFile, clearSlot, loadDemo, loadPacket, setReview,
    }),
    [files, demo, period, model, review, errors, packet, packetLoading,
      ingestFile, clearSlot, loadDemo, loadPacket, setReview]
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useClose(): CloseStore {
  const ctx = useContext(Ctx);
  if (ctx === null) throw new Error("useClose outside CloseProvider");
  return ctx;
}
