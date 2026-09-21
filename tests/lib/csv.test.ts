/**
 * Tests for the RFC4180 CSV parser (src/lib/csv.ts).
 *
 * Exists for the Coro special-pricing rate card, which is a raw CSV (not xlsx):
 * quoted fields carry embedded commas ("6090 Surety Dr Ste 295 El Paso, TX 79905")
 * and occasionally embedded newlines. Excel-style doubled quotes must survive.
 */
import { describe, it, expect } from "vitest";
import { parseCsv } from "../../src/lib/csv.js";

describe("parseCsv", () => {
  it("splits simple rows and drops the trailing-newline empty row", () => {
    expect(parseCsv("a,b,c\r\n1,2,3\r\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("honors quoted fields with commas, doubled quotes and newlines", () => {
    expect(parseCsv('name,addr\n"Doe, Jane","169 Madison Ave\n#36073"\n"say ""hi"""\n')).toEqual([
      ["name", "addr"],
      ["Doe, Jane", "169 Madison Ave\n#36073"],
      ['say "hi"'],
    ]);
  });

  it("keeps empty cells and ragged rows as-is (caller pads)", () => {
    expect(parseCsv("a,,c\nd\n")).toEqual([
      ["a", "", "c"],
      ["d"],
    ]);
  });

  it("handles a file with no terminal newline", () => {
    expect(parseCsv("x,y")).toEqual([["x", "y"]]);
  });

  it("returns [] for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("ignores bare \\r outside quotes but keeps it inside quotes", () => {
    expect(parseCsv('"a\r\nb",c\r\n')).toEqual([["a\r\nb", "c"]]);
  });
});
