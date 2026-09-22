/**
 * Tests for usage product-code → special-pricing row resolution
 * (src/config/productMap.ts).
 *
 * The rule set comes from Luke (2026-09-21): "under the usage report on column J
 * where it says MOD first that is a module flex sku … the product will say just
 * NETWORK then the product code will be MODNETWflex that = modules flex" — with
 * the refinement that a partner's product-SPECIFIC flex row (Amplivity "Network
 * Flex") beats the generic Modules Flex rate, and Modsatflex prices from "SAT
 * Flex" where it exists (exactly how Coro billed Evolve on invoice 2193).
 */
import { describe, it, expect } from "vitest";
import { resolvePricingRow } from "../../src/config/productMap.js";
import { Money } from "../../src/lib/money.js";
import type { PricingPartner, PricingRow } from "../../src/domain/types.js";

let nextRow = 10;
function row(product: string, netMsp: string | null, listPrice = "15.00"): PricingRow {
  return {
    product,
    listPrice: Money.of(listPrice),
    netMsp: netMsp === null ? null : Money.of(netMsp),
    mspDiscountPct: 50,
    hubDiscountPct: 5,
    netHubStated: null,
    totalDiscountPct: 55,
    sourceRow: nextRow++,
  };
}

function partner(name: string, rows: PricingRow[]): PricingPartner {
  return {
    name,
    workspaceId: `${name.toLowerCase().replace(/\s+/g, "")}_test_b`,
    rows,
    approxMonthlySpend: null,
    activeUsers: null,
    totalWorkspaces: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    address: null,
    sourceRow: 1,
  };
}

describe("resolvePricingRow — current-gen exact codes", () => {
  const p = partner("Seven Star Systems", [
    row("Coro AI Complete", "6.40"),
    row("Coro AI Essentials", "3.20"),
    row("Coro AI Endpoint", "4.00"),
    row("Coro AI Lite", "4.00"),
    row("Coro Managed/Monthly", "4.00"),
  ]);

  it("maps COR-COMP-C to Coro AI Complete", () => {
    const m = resolvePricingRow(p, "COR-COMP-C");
    expect(m.kind).toBe("exact");
    expect(m.row!.netMsp!.toFixed2()).toBe("6.40");
  });

  it("maps COR-MANAGE-C to Coro Managed/Monthly OR Coro Managed", () => {
    expect(resolvePricingRow(p, "COR-MANAGE-C").row!.product).toBe("Coro Managed/Monthly");
    const p2 = partner("Other", [row("Coro Managed", "2.50")]);
    expect(resolvePricingRow(p2, "COR-MANAGE-C").row!.product).toBe("Coro Managed");
  });

  it("is case-insensitive on the code", () => {
    expect(resolvePricingRow(p, "cor-ess-c").row!.product).toBe("Coro AI Essentials");
  });
});

describe("resolvePricingRow — MOD* = Modules Flex (Luke, 2026-09-21)", () => {
  it("prefers the product-specific flex row: Amplivity MODNETWflex → 'Network Flex'", () => {
    const amplivity = partner("Amplivity", [
      row("Coro AI Modules", "6.00"),
      row("Network Flex", "3.00"),
    ]);
    const m = resolvePricingRow(amplivity, "MODNETWflex");
    expect(m.kind).toBe("specific-flex");
    expect(m.row!.product).toBe("Network Flex");
    expect(m.row!.netMsp!.toFixed2()).toBe("3.00");
  });

  it("falls back to the generic 'Modules Flex' row (Cyber Construction idiom)", () => {
    const cc = partner("Cyber Construction", [
      row("Coro AI Modules", "6.00"),
      row("Modules Flex", "3.00"),
    ]);
    const m = resolvePricingRow(cc, "MODEMAILflex");
    expect(m.kind).toBe("modules-flex");
    expect(m.row!.product).toBe("Modules Flex");
  });

  it("accepts the 'Coro Module Flex' spelling (Net-Tech idiom)", () => {
    const nt = partner("Net-Tech", [
      row("Coro AI Modules", "1.92"),
      row("Coro Module Flex", "3.00"),
    ]);
    const m = resolvePricingRow(nt, "MODUSRDATAflex");
    expect(m.kind).toBe("modules-flex");
    expect(m.row!.product).toBe("Coro Module Flex");
  });

  it("last-resorts to 'Coro AI Modules' as fallback-current", () => {
    const bare = partner("Bare", [row("Coro AI Modules", "6.00")]);
    const m = resolvePricingRow(bare, "MODCLOUDflex");
    expect(m.kind).toBe("fallback-current");
    expect(m.row!.product).toBe("Coro AI Modules");
  });

  it("routes Modsatflex to 'SAT Flex' when present (Evolve, invoice 2193 line 14)", () => {
    const evolve = partner("Evolve Technologies", [
      row("Coro AI Modules", "6.00"),
      row("SAT Flex", "1.40"),
    ]);
    const m = resolvePricingRow(evolve, "Modsatflex");
    expect(m.kind).toBe("sat-flex");
    expect(m.row!.netMsp!.toFixed2()).toBe("1.40");
  });

  it("routes Modsatflex through the modules chain when no SAT Flex row exists", () => {
    const noSat = partner("NoSat", [row("Modules Flex", "3.00")]);
    const m = resolvePricingRow(noSat, "Modsatflex");
    expect(m.kind).toBe("modules-flex");
  });
});

describe("resolvePricingRow — legacy bundles", () => {
  it("maps BUCOMflex to 'Complete Flex' when present", () => {
    const p = partner("Live-Tech", [
      row("Coro AI Complete", "6.40"),
      row("Complete Flex", "6.40"),
    ]);
    const m = resolvePricingRow(p, "BUCOMflex");
    expect(m.kind).toBe("exact");
    expect(m.row!.product).toBe("Complete Flex");
  });

  it("falls back BUCOMflex → 'Coro AI Complete' with fallback-current (Rocker idiom)", () => {
    const rocker = partner("Rocker", [row("Coro AI Complete", "6.40")]);
    const m = resolvePricingRow(rocker, "BUCOMflex");
    expect(m.kind).toBe("fallback-current");
    expect(m.row!.product).toBe("Coro AI Complete");
  });

  it("maps BUCOROflex through Essentials Flex → Coro AI Essentials", () => {
    const a = partner("A", [row("Essentials Flex", "3.75"), row("Coro AI Essentials", "3.75")]);
    expect(resolvePricingRow(a, "BUCOROflex").row!.product).toBe("Essentials Flex");
    const b = partner("B", [row("Coro AI Essentials", "3.20")]);
    const mb = resolvePricingRow(b, "BUCOROflex");
    expect(mb.kind).toBe("fallback-current");
    expect(mb.row!.product).toBe("Coro AI Essentials");
  });

  it("maps BUCOCLASSflex through Classic Flex spellings", () => {
    const p = partner("GOA", [row("Coro Classic", "7.20")]);
    const m = resolvePricingRow(p, "BUCOCLASSflex");
    expect(m.row!.product).toBe("Coro Classic");
  });
});

describe("resolvePricingRow — ADD*, NFR, unknowns", () => {
  it("routes ADDMDRflex through the modules chain as add-module (confirmed by Coro 2026-09-22)", () => {
    const p = partner("TechLead", [row("Modules Flex", "3.00")]);
    const m = resolvePricingRow(p, "ADDMDRflex");
    expect(m.kind).toBe("add-module");
    expect(m.reason).toContain("confirmed by Coro 2026-09-22");
    expect(m.row!.product).toBe("Modules Flex");
  });

  it("marks COR-COMP-NFR non-billable", () => {
    const p = partner("Hurricane IT", [row("Coro AI Complete", "12.00")]);
    const m = resolvePricingRow(p, "COR-COMP-NFR");
    expect(m.kind).toBe("nfr");
    expect(m.row).toBeNull();
  });

  it("returns none for an unknown code", () => {
    const p = partner("Anyone", [row("Coro AI Complete", "12.00")]);
    const m = resolvePricingRow(p, "XYZZYflex");
    expect(m.kind).toBe("none");
    expect(m.row).toBeNull();
  });

  it("returns none (not a match) when the chain matches a row that exists nowhere", () => {
    const empty = partner("Empty", []);
    expect(resolvePricingRow(empty, "MODNETWflex").kind).toBe("none");
    expect(resolvePricingRow(empty, "COR-COMP-C").kind).toBe("none");
  });
});

describe("resolvePricingRow — 2026-09-22 sheet revision (Coro's answers)", () => {
  it("maps BUEMAILflex to the new 'BUEmail Flex' spelling (Net-Tech / 1Wire rename)", () => {
    const nt = partner("Net-Tech", [row("BUEmail Flex", "3.00", "7.50")]);
    const m = resolvePricingRow(nt, "BUEMAILflex");
    expect(m.kind).toBe("exact");
    expect(m.row!.product).toBe("BUEmail Flex");
  });

  it("maps BUCOCLASSMNflex to the new 'Managed Coro Classic' spelling (Cyber Construction)", () => {
    const cc = partner("Cyber Construction", [row("Managed Coro Classic", "10.20", "16.99")]);
    const m = resolvePricingRow(cc, "BUCOCLASSMNflex");
    expect(m.kind).toBe("exact");
    expect(m.row!.product).toBe("Managed Coro Classic");
  });

  it("prefers 'Coro Module Flex' over 'Modules Flex' when both exist (CC label swap)", () => {
    // On the 2026-09-22 sheet Cyber Construction's row NAMED "Modules Flex" carries the
    // $11.99 Classic list; the true modules rate lives on "Coro Module Flex".
    const cc = partner("Cyber Construction", [
      row("Modules Flex", "7.20", "11.99"),
      row("Coro Module Flex", "3.00", "7.50"),
    ]);
    const m = resolvePricingRow(cc, "MODCLOUDflex");
    expect(m.kind).toBe("modules-flex");
    expect(m.row!.product).toBe("Coro Module Flex");
    expect(m.row!.netMsp!.toFixed2()).toBe("3.00");
  });

  it("resolves BUCOCLASSflex via the mislabel signature: 'Modules Flex' at exactly $11.99 list", () => {
    const cc = partner("Cyber Construction", [
      row("Modules Flex", "7.20", "11.99"),
      row("Coro Module Flex", "3.00", "7.50"),
    ]);
    const m = resolvePricingRow(cc, "BUCOCLASSflex");
    expect(m.kind).toBe("mislabel-override");
    expect(m.row!.netMsp!.toFixed2()).toBe("7.20");
    expect(m.reason).toContain("mislabel");
  });

  it("mislabel override is signature-guarded: a $7.50-list 'Modules Flex' never matches Classic", () => {
    const normal = partner("Anyone", [row("Modules Flex", "3.00", "7.50")]);
    expect(resolvePricingRow(normal, "BUCOCLASSflex").kind).toBe("none");
  });

  it("a real Classic row beats the mislabel override", () => {
    const both = partner("Fixed Sheet", [
      row("Modules Flex", "7.20", "11.99"),
      row("Coro Classic Flex", "7.20", "11.99"),
    ]);
    const m = resolvePricingRow(both, "BUCOCLASSflex");
    expect(m.kind).toBe("exact");
    expect(m.row!.product).toBe("Coro Classic Flex");
  });
});
