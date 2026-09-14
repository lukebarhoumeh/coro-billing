/**
 * A tiny Result type for deterministic, exception-free error handling.
 *
 * The pipeline is an accounting close: every failure must be *visible and
 * traceable*, never a thrown surprise deep in a parser. Ingest/rating/recon
 * functions return Result<T, E> so callers must handle the error path.
 *
 * Spec anchor (README): "Parsed tables are separate and deterministic."
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = string> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return !r.ok;
}

/** Map the success value, passing errors through untouched. */
export function map<T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}

/** Unwrap or throw — use only at the outermost boundary (CLI), never in library code. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error(`unwrap() called on Err: ${JSON.stringify(r.error)}`);
}

/**
 * Collect an array of Results into a Result of an array.
 * Fails on the first error (fail-closed): a partial close is not a close.
 */
export function all<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const out: T[] = [];
  for (const r of results) {
    if (!r.ok) return r;
    out.push(r.value);
  }
  return ok(out);
}
