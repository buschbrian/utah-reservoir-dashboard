/* The deadline is the difference between "the dashboard is loading" and
 * "the dashboard is broken and nobody said so". These tests are about the
 * three silences it converts into a thrown error, and none of them reads
 * the published payload -- a stub answers, so a morning's refresh cannot
 * reach them. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DATA_TIMEOUT_MS, fetchWithin } from "./fetch";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

describe("a runtime fetch with a deadline", () => {
  it("returns the response when the server answers", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const response = await fetchWithin("./reservoirs.json");
    expect(response.ok).toBe(true);
  });

  it("asks for a fresh copy, because the file is rewritten every morning", async () => {
    let init: RequestInit | undefined;
    globalThis.fetch = vi.fn(async (_url: unknown, options?: RequestInit) => {
      init = options;
      return new Response("{}", { status: 200 });
    }) as typeof globalThis.fetch;
    await fetchWithin("./reservoirs.json");
    expect(init).toMatchObject({ cache: "no-store" });
  });

  it("throws on a status that is not OK, naming the status and the file", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 503 }));
    await expect(fetchWithin("./reservoirs.json")).rejects.toThrow(/503.*reservoirs\.json/);
  });

  /* The one that matters. A request that hangs used to leave the panel on
   * "Loading reservoir data" with no path to an error state, because the
   * promise never settled and `setDataState` was never reached. */
  it("gives up on a request that never answers", async () => {
    globalThis.fetch = vi.fn((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("signal timed out", "TimeoutError"));
        });
      })) as typeof globalThis.fetch;

    await expect(fetchWithin("./reservoirs.json", 20))
      .rejects.toThrow(/did not answer within 20ms/);
  });

  it("cancels the request rather than abandoning it", async () => {
    let seen: AbortSignal | undefined;
    globalThis.fetch = vi.fn((_url: unknown, init?: { signal?: AbortSignal }) => {
      seen = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("signal timed out", "TimeoutError"));
        });
      });
    }) as typeof globalThis.fetch;

    await expect(fetchWithin("./reservoirs.json", 20)).rejects.toThrow();
    // An abandoned download that keeps running still competes for the
    // connection a retry would need.
    expect(seen?.aborted).toBe(true);
  });

  it("passes a network failure through as itself", async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await expect(fetchWithin("./reservoirs.json")).rejects.toThrow(/Failed to fetch/);
  });

  it("waits longer than the basemap chain, which the page can do without", () => {
    // The basemap has a 10s deadline; this is for the data the page is
    // about, so it is not shorter.
    expect(DATA_TIMEOUT_MS).toBeGreaterThan(10000);
  });
});
