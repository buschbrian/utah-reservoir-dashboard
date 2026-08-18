# ADR-051: Revalidate, do not refetch

## Status

Accepted

## Date

2026-08-17

## Context

Every runtime fetch went out with `cache: "no-store"`. ADR-002 chose it for a
good reason and stated it plainly: the payload is rewritten every morning and
that commit is the deploy, so a cached copy shows yesterday's numbers. The
alternative it considered — a cache-busting key derived from `as_of` — was
rejected as circular, because the client only learns `as_of` by fetching the
payload. `no-store` was called "the honest version of the same intent".

It is honest. It is also the most expensive way to keep that promise, because
`no-store` refuses the cache entirely, and refusing the cache means refusing
the *conditional* request as well. The browser cannot ask "has this changed?"
— it can only ask for the whole thing.

There is a third option ADR-002 did not consider, and it is the one HTTP was
designed around. Measured against the published site:

```
$ curl -sSD- -o/dev/null -H 'Accept-Encoding: gzip' .../snowpack.json
HTTP/1.1 200 OK
Content-Length: 233583
ETag: W/"6a83a376-1de2c0"
Cache-Control: max-age=600
Content-Encoding: gzip

$ curl -sSD- -o/dev/null -H 'If-None-Match: W/"6a83a376-1de2c0"' .../snowpack.json
HTTP/1.1 304 Not Modified
```

GitHub Pages issues an `ETag` and answers a conditional request with **304 Not
Modified** and no body. So the question "has this changed?" already has a
cheap answer, and this project has been paying 228 KB to hear it.

## Decision

`cache: "no-cache"`, not `"no-store"`.

The name is unhelpfully close to its opposite. `no-cache` does not mean "do
not cache" — it means **never use a stored copy without asking the server
first**. Every request still goes to the network, every response is still
validated against the origin, and a payload rewritten this morning can never
be served out of this morning's cache.

The freshness guarantee ADR-002 wrote down is kept exactly. What changes is
the price of keeping it: a reader who already has today's numbers pays the
headers instead of the file.

## Consequences

A repeat visit inside a day costs a round trip rather than a download. On the
snow page that is **228 KB against a 304**, and on the storage page about 42
KB. Nothing changes on a first visit, and nothing changes on the morning the
numbers move — the ETag differs and the body arrives.

`Cache-Control: max-age=600` on the origin is deliberately *not* relied on.
Under the default cache mode the browser would serve a stored copy for ten
minutes without asking, which is exactly the staleness ADR-002 refused.
`no-cache` overrides that and revalidates every time.

This does not weaken the deploy check. `generated_at` must still be absent
from `dist/assets`, and the payload is still copied rather than imported.

One caveat worth stating: a 304 still costs a round trip, so this helps
bandwidth and not latency. The page still waits for the server on every load.
A payload that never changed within a session could be held in memory instead,
which `loadReference` already does per URL; extending that is a separate
question from this one.

## Related

- Amends [ADR-002](ADR-002-data-is-copied-never-bundled.md), which chose
  `no-store` on the reasoning above and keeps everything else it decided.
- The measurements are in `docs/data-transfer.md`.
