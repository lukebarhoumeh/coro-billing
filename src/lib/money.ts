/**
 * Money — accounting-safe arithmetic.
 *
 * Coro billing is a financial close: floating point drift is not acceptable.
 * Dane's August example ("billing 16,000, 3,000 in profit") must reconcile to
 * the cent against Lindita's manual workbook. We wrap decimal.js and round to
 * cents (2 dp, banker's rounding) only at output boundaries.
 *
 * Rates/discounts (e.g. the 45% legacy discount, the 5% buffer) are kept as
 * exact decimals mid-calculation; money is rounded to cents when it lands on an
 * invoice line or a reconciliation row.
 */
import { Decimal } from "decimal.js";

// Round half-to-even ("banker's rounding") — standard for financial totals.
Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN });

export type MoneyInput = number | string | Decimal | Money;

export class Money {
  private readonly d: Decimal;

  private constructor(d: Decimal) {
    this.d = d;
  }

  static of(value: MoneyInput): Money {
    if (value instanceof Money) return value;
    return new Money(new Decimal(value));
  }

  static zero(): Money {
    return new Money(new Decimal(0));
  }

  add(other: MoneyInput): Money {
    return new Money(this.d.plus(Money.of(other).d));
  }

  sub(other: MoneyInput): Money {
    return new Money(this.d.minus(Money.of(other).d));
  }

  /** Multiply by a scalar (e.g. quantity, or a rate factor like 0.55). */
  mul(scalar: number | string | Decimal): Money {
    return new Money(this.d.times(new Decimal(scalar)));
  }

  /** Divide by a scalar. Throws on divide-by-zero (a real bug, not a data condition). */
  div(scalar: number | string | Decimal): Money {
    const s = new Decimal(scalar);
    if (s.isZero()) throw new Error("Money.div by zero");
    return new Money(this.d.dividedBy(s));
  }

  /** Apply a discount percent expressed 0..1 (0.45 => keep 55%). */
  applyDiscount(fraction: number | string | Decimal): Money {
    const f = new Decimal(fraction);
    return new Money(this.d.times(new Decimal(1).minus(f)));
  }

  /** Apply a markup/buffer percent expressed 0..1 (0.05 => multiply by 1.05). */
  applyMarkup(fraction: number | string | Decimal): Money {
    const f = new Decimal(fraction);
    return new Money(this.d.times(new Decimal(1).plus(f)));
  }

  isZero(): boolean {
    return this.d.isZero();
  }

  isNegative(): boolean {
    return this.d.isNegative();
  }

  /** Compare at cent precision, so 10.001 and 10.004 are "equal cents". */
  equalsCents(other: MoneyInput): boolean {
    return this.roundedCents().equals(Money.of(other).roundedCents());
  }

  /** Absolute cent difference vs another amount — used by reconciliation diffs. */
  centsDiff(other: MoneyInput): Money {
    return new Money(this.roundedCents().minus(Money.of(other).roundedCents()).abs());
  }

  private roundedCents(): Decimal {
    return this.d.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
  }

  /** Number of cents as an integer (e.g. for exact equality keys). */
  toCents(): number {
    return this.roundedCents().times(100).toNumber();
  }

  /** Rounded to cents, as a plain number. Prefer toFixed2 for display/CSV. */
  toNumber(): number {
    return this.roundedCents().toNumber();
  }

  /** "1234.50" — canonical for CSV/QuickBooks export. */
  toFixed2(): string {
    return this.roundedCents().toFixed(2);
  }

  toString(): string {
    return this.toFixed2();
  }
}

/** Sum a list of amounts exactly. */
export function sum(amounts: readonly MoneyInput[]): Money {
  return amounts.reduce<Money>((acc, a) => acc.add(a), Money.zero());
}
