/** Section keys for the six-screen shell. Lives here (not App.tsx) so screens
 * can navigate (e.g. an Exceptions row jumping to its source screen) without a
 * circular import. */
export type SectionKey =
  | "intake"
  | "overview"
  | "ratecards"
  | "reconcile"
  | "invoices"
  | "margins"
  | "exceptions";

/** Props every data screen receives; screens read the model via useClose(). */
export interface ScreenProps {
  readonly onNavigate: (section: SectionKey, context?: string) => void;
  /** Optional navigation context (e.g. a partner slug to focus). */
  readonly context?: string;
}
