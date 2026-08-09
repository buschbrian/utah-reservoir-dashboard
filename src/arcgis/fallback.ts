/* Try a list of resources in order; take the first one that loads.
 *
 * Refusing to prompt for credentials (see ./auth) turns a secured resource
 * from a modal into a rejected promise, which is an improvement only if
 * something catches it. Otherwise the map just has no basemap and the page
 * says nothing about why.
 *
 * The ordering this exists to express: prefer the Esri basemaps the current
 * page already uses, fall back to a keyless vector tile layer, and if even
 * that fails render with no basemap and a visible notice rather than a blank
 * frame. The spike found the first two serve anonymously today, so this
 * chain is insurance against that changing, not a workaround for a problem
 * we have.
 *
 * Deliberately not SDK-typed. Anything with a `load()` fits, which keeps the
 * retry policy unit-testable and means the same helper covers feature layers
 * -- the other thing that can turn out to be secured.
 */

export interface Loadable {
  load(): Promise<unknown>;
}

export interface Candidate<T extends Loadable> {
  /** Human-readable, and used in the notice when a fallback is taken. */
  name: string;
  /** Deferred: a candidate must not be constructed until it is needed. */
  create(): T;
}

export interface Attempt {
  name: string;
  error: Error;
}

export interface Resolution<T extends Loadable> {
  resource: T | null;
  name: string | null;
  /** Every candidate that failed before this one, in order. */
  failures: readonly Attempt[];
  /** True when the first choice was unavailable and something else is in use. */
  degraded: boolean;
}

const DEFAULT_TIMEOUT_MS = 10000;

function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${name} did not load within ${ms}ms`)), ms);
    })
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * Loads candidates in order and resolves with the first success.
 *
 * Never rejects. A caller that has run out of options needs to render
 * something and say so, not handle another exception; `resource: null` with
 * the full failure list is that outcome.
 */
export async function resolveFirstLoadable<T extends Loadable>(
  candidates: readonly Candidate<T>[],
  options: { timeoutMs?: number } = {}
): Promise<Resolution<T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const failures: Attempt[] = [];

  for (const candidate of candidates) {
    try {
      const resource = candidate.create();
      // A candidate whose load hangs is as unusable as one that rejects, and
      // an unbounded wait here is exactly the failure the auth prompt caused.
      await withTimeout(resource.load(), timeoutMs, candidate.name);
      return {
        resource,
        name: candidate.name,
        failures,
        degraded: failures.length > 0
      };
    } catch (error) {
      failures.push({
        name: candidate.name,
        error: error instanceof Error ? error : new Error(String(error))
      });
    }
  }

  return { resource: null, name: null, failures, degraded: candidates.length > 0 };
}
