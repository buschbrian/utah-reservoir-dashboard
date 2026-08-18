/*
 * Every runtime fetch, with a deadline.
 *
 * A request that hangs never rejects, and a promise that never settles is a
 * loading state that never ends: the storage summary sat on "Loading
 * reservoir data" forever, and the overview held a bare loader with no
 * `catch` path ever reached. A spinner that cannot resolve is not a loading
 * state, it is an error the reader is not being told about.
 *
 * The basemap chain has had a deadline since the fallback work
 * (`arcgis/fallback.ts`); the data path had none. This is the same idea,
 * with the request actually cancelled rather than raced -- an abandoned
 * download that keeps running still competes for the connection the retry
 * needs.
 */

/**
 * Long enough that a slow connection on a phone still succeeds, short
 * enough that a reader is told something is wrong before they give up and
 * reload. The basemap chain uses 10s for a resource the page can do
 * without; this is for the data the page is about, so it waits longer.
 */
export const DATA_TIMEOUT_MS = 15000;

/**
 * Fetches a runtime file, or throws.
 *
 * Turns three different silences into one thrown error the caller can put on
 * screen: a hang, a network failure, and an HTTP status that is not OK.
 */
export async function fetchWithin(
  url: string,
  timeoutMs = DATA_TIMEOUT_MS
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      /*
       * Revalidate, do not refetch.
       *
       * `no-store` was here because the payload is rewritten every morning
       * and the deploy is that commit (ADR-002), so a stale copy shows
       * yesterday's numbers. It kept that promise by refusing the cache
       * entirely -- which also refuses the conditional request, and pays for
       * the whole file to be told nothing changed.
       *
       * `no-cache` keeps the same promise and stops paying for it: the
       * browser must ask the server every time, and never serves a stale
       * copy without asking. Measured against the published site, which
       * answers `ETag: W/"..."` and `304 Not Modified` to a conditional
       * request -- so a reader who has already seen today's numbers pays
       * headers rather than 228 KB. See ADR-051.
       */
      cache: "no-cache",
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    /* `AbortSignal.timeout` rejects with a `TimeoutError`. Rewritten here
     * because the DOM's own message says only "signal timed out", which
     * names neither the file nor the deadline -- and this is the error a
     * reader's console will be read for when the dashboard is blank. */
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(`${url} did not answer within ${timeoutMs}ms`);
    }
    throw error;
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} loading ${url}`);
  return response;
}
