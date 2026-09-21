/**
 * Test for the claimed defect: can allocQty=0 and allocH>0 occur together
 * in the invoice close?
 */
import { describe, it, expect } from "vitest";
import { Money } from "../../src/lib/money.js";
import { allocateInteger, allocateCents } from "../../src/lib/allocate.js";

describe("Largest-remainder allocation — testing the defect claim", () => {
  it("shows that with qty=1 and weights=[1,1], bucket 1 gets qty=0 but H=0", () => {
    // The scenario from the defect claim: 1 unit split across 2 buckets.
    // qtyAlloc should give [1, 0] by tie-break.
    const qtyAlloc = allocateInteger(1, [1, 1]);
    expect(qtyAlloc).toEqual([1, 0]);
    expect(qtyAlloc.some(q => q !== 0)).toBe(true);

    // Since qtyAlloc.some() is true, we use qtyAlloc as weights for cents.
    // This means bucket 1 (with qty weight 0) will get 0 cents.
    const hTotal = Money.of(100);
    const centsAlloc = allocateCents(hTotal, qtyAlloc);
    
    
    // Bucket 1: allocQty=0, allocH should be 0 (because weight=0 in cents alloc)
    expect(qtyAlloc[1]).toBe(0);
    expect(centsAlloc[1]!.isZero()).toBe(true);
    // So line 393 would skip this bucket — no problem.
  });

  it("shows that the second branch (all-zero qty) only happens with g.qty=0", () => {
    // The code uses the second branch (original weights) only when 
    // qtyAlloc.some(q => q !== 0) is FALSE.
    // This ONLY happens when allocateInteger returns all zeros, which occurs
    // ONLY when g.qty === 0.

    const qtyAlloc = allocateInteger(0, [1, 1]);
    expect(qtyAlloc).toEqual([0, 0]);
    expect(qtyAlloc.some(q => q !== 0)).toBe(false);

    // In this case, centsAlloc = allocateCents(Money.zero(), ...)
    // This will give all buckets Money.zero().
    const hTotal = Money.zero();
    const centsAlloc = allocateCents(hTotal, [1, 1]); // original weights
    
    expect(centsAlloc).toEqual([Money.zero(), Money.zero()]);
  });

  it("demonstrates: if we manually used original weights instead of qtyAlloc, we could get the defect", () => {
    // This is a HYPOTHETICAL: what if line 337 always used original weights?
    // qty=1, weights=[1, 1], with one customer winning the qty (qty=0 for other)
    // but if we allocated cents using original weights:

    const qtyAlloc = allocateInteger(1, [1, 1]);
    expect(qtyAlloc).toEqual([1, 0]);

    // If we mistakenly used original weights for cents instead of qtyAlloc:
    const hTotal = Money.of(100);
    const badCentsAlloc = allocateCents(hTotal, [1, 1]); // WRONG: should use qtyAlloc
    
    // With equal weights, 100 cents → [50, 50]
    expect(badCentsAlloc.map(m => m.toFixed2())).toEqual(["50.00", "50.00"]);
    
    // NOW we'd have: bucket[1] allocQty=0, allocH=50.00 — THE DEFECT!
    expect(qtyAlloc[1]).toBe(0);
    expect(badCentsAlloc[1]!.isZero()).toBe(false);
  });
});
