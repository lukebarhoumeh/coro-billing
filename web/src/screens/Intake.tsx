/**
 * Intake — the month starts here. Three drop targets (pricing CSV, usage XLSX,
 * optional Coro invoice XLSX), a per-file parse report, a bundled-packet
 * loader when the deployment carries one, and demo mode.
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
  PackageOpen,
  Loader2,
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

function SlotCard({ spec, index }: { spec: SlotSpec; index: number }) {
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
        "rise",
        dragOver && "border-primary bg-primary/5 shadow-ledger-lift",
        loaded && "border-success/40"
      )}
      style={{ "--rise-i": index } as React.CSSProperties}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 normal-case tracking-normal text-foreground">
          <Icon className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{spec.title}</span>
          <Badge variant="muted">{spec.required ? "required" : "optional"}</Badge>
        </CardTitle>
        {loaded && (
          <button
            className="text-muted-foreground transition-colors hover:text-foreground"
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
              {" · "}
              <span className="font-mono">{loaded.fingerprint.slice(0, 12)}</span>
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
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-center text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground">
            <span>
              Drop the file here or <span className="text-primary underline underline-offset-4">browse</span>
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
  const { model, loadDemo, demo, period, packet, packetLoading, loadPacket } = useClose();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="rise space-y-2" style={{ "--rise-i": 0 } as React.CSSProperties}>
        <h1 className="figure rule-brass text-2xl">Month intake</h1>
        <p className="pt-1 text-sm text-muted-foreground">
          Drop the month's Coro files. Everything is parsed in your browser —{" "}
          <span className="inline-flex items-center gap-1 text-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-success" />
            nothing is uploaded anywhere.
          </span>
        </p>
      </div>

      {packet !== null && (
        <Card
          className="rise border-primary/40 bg-primary/5"
          style={{ "--rise-i": 1 } as React.CSSProperties}
        >
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="flex items-center gap-3 text-sm">
              <PackageOpen className="h-5 w-5 text-primary" />
              <div>
                <div className="font-medium text-foreground">{packet.label}</div>
                <div className="text-xs text-muted-foreground">
                  This deployment carries the month's packet — load all files in one click.
                </div>
              </div>
            </div>
            <Button data-testid="load-packet" disabled={packetLoading} onClick={() => void loadPacket()}>
              {packetLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageOpen className="h-4 w-4" />}
              Load {packet.period} packet
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {SLOTS.map((s, i) => (
          <SlotCard key={s.slot} spec={s} index={i + 2} />
        ))}
      </div>

      {model !== null ? (
        <Card className="rise border-success/40" style={{ "--rise-i": 5 } as React.CSSProperties}>
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
        <Card className="rise" style={{ "--rise-i": 5 } as React.CSSProperties}>
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
