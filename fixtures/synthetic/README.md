# `fixtures/synthetic/` — SYNTHETIC — not real Coro/partner data

> **SYNTHETIC — not real Coro/partner data.** Everything under this folder is
> **fabricated** to exercise the pipeline end-to-end. It contains **no** real
> Coro, MSP Hub, Brandon/Jack, or partner numbers. Do **not** use any value here
> for a real close.

## Why this exists

The real month-end inputs (Coro usage, Brandon/Jack special pricing, Lindita's
manual workbook) are **not** committed to this repo (`data/README.md` and the
top-level `README.md` both note they still need to be dropped in). To prove the
pipeline works before those binaries land, the end-to-end golden test
(`tests/e2e.golden.test.ts`) runs the whole loop over a **self-consistent
synthetic trio** built in memory with SheetJS — so there are **no committed
binary `.xlsx` fixtures** (`docs/ARCHITECTURE.md` §"Synthetic fixtures").

This mirrors Dane's acceptance test — *"recreate the August invoice and see any
discrepancies we have against Lita's manual one"* — with fake data, so the CI can
assert the pipeline reproduces "Lindita" cent-exact.

## Obviously-fake identities

Partners are deliberately un-real: **Acme MSP**, **Globex MSP**, **Initech MSP**.
Workspaces (`Acme Retail`, `Globex Media`, `Initech HQ`, …) and SKUs (`CORO-EPP`,
`CORO-XDR`, `CORO-LEGACY-SIEM`, …) are invented. Prices are round, made-up
numbers.

## What `build.ts` produces (in memory)

`build.ts` exports two builders. Every synthetic sheet carries a loud
`SYNTHETIC — not real Coro/partner data` banner as its first row (the parsers'
header-row auto-detection skips it).

| Builder | Purpose |
| --- | --- |
| `buildConsistentTrio()` | usage + rate card + Lindita that reconcile **cent-exact**: `DiscrepancyReport.matched === true`, total cents diff `=== 0`. |
| `buildDiscrepancyTrio()` | the same shape with two deliberate faults: **(i)** the legacy **"$6 vs $9"** landmine — the rate card charges L = `$6` on `CORO-LEGACY-SIEM` but Lindita hand-wrote `$9` (Dane's exact example) → a `charge` `Discrepancy`; **(ii)** an **unpriced** usage row (`Initech MSP` / `CORO-UNPRICED-NEW`) absent from the rate card → a `MISSING_RATE_CARD_ROW` exception. `matched === false`. |

Each builder returns a `SyntheticTrio { period, usage, rateCard, lindita, rows }`
where `usage`/`rateCard`/`lindita` are `WorkbookInput`s (in-memory
`{ workbook }`) ready to hand to the parsers, and `rows` is the plain seed table
the three files are derived from (exposed so tests can assert against the source
of truth).

## Traceability

The trio is consistent **by construction**: usage quantities, rate-card H/L, and
Lindita's H/L/qty are all derived from one plain `SyntheticRow[]` seed, so a human
can eyeball that the pipeline is genuinely computing the tie-out rather than
"cheating". The consistent set also encodes the "partners are on different stuff"
rule — `Acme MSP` and `Globex MSP` carry **different** prices for the **same**
`CORO-EPP` SKU.
