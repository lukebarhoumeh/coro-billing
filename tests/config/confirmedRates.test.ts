/**
 * Period gating of confirmed bill-out rates (src/config/confirmedRates.ts).
 *
 * Two gates exist:
 *   - `period`  — a historical rate that applied to exactly ONE month
 *                 (Net-Tech's pre-migration August rates);
 *   - `through` — a rate that applied up to AND INCLUDING a month and then
 *                 retired to the card (GOA-Tech's Classic: billed 6.59 in
 *                 Aug/Sept per QB inv 10551, but Lida flagged the October
 *                 draft 2026-10-29 — "the app selected the wrong price" — the
 *                 card's 7.20 rules from October on).
 */
import { describe, it, expect } from "vitest";
import { resolveConfirmedRate } from "../../src/config/confirmedRates.js";

describe("resolveConfirmedRate period gating", () => {
  it("applies an ungated entry in any period", () => {
    for (const period of ["2026-08", "2026-09", "2026-10"] as const) {
      const r = resolveConfirmedRate(period, "Avox", "BUCOROflex");
      expect(r?.rate.toFixed2()).toBe("6.00");
    }
  });

  it("applies a period-gated entry ONLY in its own month (Net-Tech Aug legacy)", () => {
    expect(
      resolveConfirmedRate("2026-08", "Net-Tech", "BUCOCLASSflex")?.rate.toFixed2()
    ).toBe("6.59");
    expect(resolveConfirmedRate("2026-09", "Net-Tech", "BUCOCLASSflex")).toBeNull();
    expect(resolveConfirmedRate("2026-10", "Net-Tech", "BUCOCLASSflex")).toBeNull();
  });

  it("applies a through-gated entry up to its month, then the card rules (GOA-Tech Classic)", () => {
    // Aug: as actually billed (QB inv 10551). Sept: preserved as pinned (she
    // invoiced Sept manually; no GOA artifact in repo) — history stays byte-identical.
    expect(
      resolveConfirmedRate("2026-08", "GOA-Tech", "BUCOCLASSflex")?.rate.toFixed2()
    ).toBe("6.59");
    expect(
      resolveConfirmedRate("2026-09", "GOA-Tech", "BUCOCLASSflex")?.rate.toFixed2()
    ).toBe("6.59");
    // Oct forward: retired — the card's 7.20 (sheet col E) drafts. 6.59 is the
    // Hub COST (11.99 × 55%); billing it is a zero-margin mistake (Lida, 2026-10-29).
    expect(resolveConfirmedRate("2026-10", "GOA-Tech", "BUCOCLASSflex")).toBeNull();
    expect(resolveConfirmedRate("2026-11", "GOA-Tech", "BUCOCLASSflex")).toBeNull();
  });

  it("retires the other cost-equal Classic entries the same way (Cyber, Rocker)", () => {
    // Same zero-margin trap: Cyber's 6.59 fired in Aug (pinned), Rocker's 6.60
    // never fired anywhere. Both dormant since (migrated off Classic) — if
    // legacy Classic usage reappears, the card must rule, not the stale cost.
    expect(
      resolveConfirmedRate("2026-08", "Cyber Construction", "BUCOCLASSflex")?.rate.toFixed2()
    ).toBe("6.59");
    expect(resolveConfirmedRate("2026-10", "Cyber Construction", "BUCOCLASSflex")).toBeNull();
    expect(
      resolveConfirmedRate("2026-09", "Rocker", "BUCOCLASSflex")?.rate.toFixed2()
    ).toBe("6.60");
    expect(resolveConfirmedRate("2026-10", "Rocker", "BUCOCLASSflex")).toBeNull();
    // Rocker's Complete Flex is a genuine sell rate (not cost) — stays ungated.
    expect(
      resolveConfirmedRate("2026-10", "Rocker", "BUCOMflex")?.rate.toFixed2()
    ).toBe("8.25");
  });

  it("matches card name and SKU case-insensitively with trimming", () => {
    expect(
      resolveConfirmedRate("2026-09", "  goa-tech ", "BuCoClassFLEX")?.rate.toFixed2()
    ).toBe("6.59");
  });
});
