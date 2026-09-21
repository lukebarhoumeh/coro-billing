/** Overview — STUB: full screen lands in the screens fan-out (plan T10-T12). */
import type { ScreenProps } from "@/lib/nav";
import { useClose } from "@/lib/closeStore";

export function OverviewScreen(_props: ScreenProps) {
  const { model } = useClose();
  return (
    <div className="text-sm text-muted-foreground">
      Overview screen — under construction ({model?.partners.length ?? 0} partner drafts loaded).
    </div>
  );
}
