/**
 * Intake — the month starts here. Three drop targets (pricing CSV, usage XLSX,
 * optional Coro invoice XLSX), a per-file parse report, and demo mode.
 * Everything parses in the browser; bytes never leave the machine.
 */
import { useCallback, useState, type DragEvent } from "react";
import {
  FileSpreadsheet,
  FileText,
  Receipt,
  CheckCircle2,
  XCircle,
  Sparkles,
  ShieldCheck,
  X,
} from "lucide-react";
import { useClose } from "@/lib/closeStore";
import type { SlotKey } from "@/lib/loadFiles";
import type { ScreenProps } from "@/lib/nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

interface SlotSpec {
  readonly slot: SlotKey;
  readonly title: string;
  readonly required: boolean;
  readonly hint: string;
  readonly icon: typeof FileText;
  readonly accept: string;
}

const SLOTS: readonly SlotSpec[] = [
  {
    slot: "pricing",
    title: "Special pricing (rate card)",
    required: true,
    hint: "Coro Special MSP Pricing(Special Pricing).csv",
    icon: FileText,
    accept: ".csv",
  },
  {
    slot: "usage",
    title: "Monthly usage report",
    required: true,
    hint: "MSP Hub_<Month> <Year> Usage.xlsx",
    icon: FileSpreadsheet,
    accept: ".xlsx,.xls",
  },
  {
    slot: "invoice",
    title: "Coro invoice (optional)",
    required: false,
    hint: "Coro_Invoice_INVCUS….xlsx — unlocks the cost cross-check",
    icon: Receipt,
    accept: ".xlsx,.xls",
  },
];

function SlotCard({ spec }: { spec: SlotSpec }) {
  const { files, errors, ingestFile, clearSlot } = useClose();
  const [dragOver, setDragOver] = useState(false);
  const loaded = files[spec.slot];
  const error = errors[spec.slot];
  const Icon = spec.icon;

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void ingestFile(spec.slot, file);
    },
    [ingestFile, spec.slot]
  );

  return (
    <Card
      className={cn(
        "transition-colors",
        dragOver && "border-primary bg-primary/5",
        loaded && "border-success/40"
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Icon className="h-4 w-4 text-primary" />
          {spec.title}
          {spec.required ? (
            <Badge variant="muted">required</Badge>
          ) : (
            <Badge variant="muted">optional</Badge>
          )}
        </CardTitle>
        {loaded && (
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={() => clearSlot(spec.slot)}
            title="Remove this file"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {loaded ? (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span className="break-all font-medium">{loaded.fileName}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {loaded.report.rowsRead.toLocaleString()} rows read
              {loaded.report.partners !== undefined && <> · {loaded.report.partners} partners</>}
              {" · "}fingerprint <span className="tabular">{loaded.fingerprint.slice(0, 12)}</span>
            </div>
            {loaded.report.warnings.length > 0 && (
              <ul className="space-y-1 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-warning">
                {loaded.report.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-center text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
            )}
          >
            <span>
              Drop the file here or <span className="text-primary underline">browse</span>
            </span>
            <span className="text-xs">{spec.hint}</span>
            <input
              type="file"
              accept={spec.accept}
              className="sr-only"
              data-testid={`file-input-${spec.slot}`}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void ingestFile(spec.slot, file);
                e.target.value = "";
              }}
            />
          </label>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function IntakeScreen({ onNavigate }: ScreenProps) {
  const { model, loadDemo, demo, period } = useClose();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Month intake</h1>
        <p className="text-sm text-muted-foreground">
          Drop the month's Coro files. Everything is parsed in your browser —{" "}
          <span className="inline-flex items-center gap-1 text-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-success" />
            nothing is uploaded anywhere.
          </span>
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {SLOTS.map((s) => (
          <SlotCard key={s.slot} spec={s} />
        ))}
      </div>

      {model !== null ? (
        <Card className="border-success/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="text-sm">
              <span className="font-medium text-success">Close ready</span>
              <span className="text-muted-foreground">
                {" "}
                — {period}: {model.partners.length} partner drafts, {model.findings.length} findings
                {demo && " (synthetic demo)"}
              </span>
            </div>
            <Button data-testid="go-overview" onClick={() => onNavigate("overview")}>
              Open the close →
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-sm text-muted-foreground">
              No files yet? Walk the whole workflow on loudly-labeled synthetic data.
            </p>
            <Button variant="outline" data-testid="load-demo" onClick={loadDemo}>
              <Sparkles className="h-4 w-4" />
              Load demo data
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
