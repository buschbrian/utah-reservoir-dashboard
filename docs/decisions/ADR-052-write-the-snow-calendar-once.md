# ADR-052: Write the snow calendar once

## Status

Accepted

## Date

2026-08-17

## Context

`snowpack.json` is the biggest thing this site asks a reader to download, and
the expansion plan named it the forcing case: about 15.5 MB at western scale
against a 30-second timeout.

Measured before acting, because the plan's figure is a **raw** one and no
reader downloads raw bytes — GitHub Pages serves this gzipped:

| | raw | gzip |
|---|---:|---:|
| `snowpack.json` | 1,913 KB | **217 KB** |
| of which `sites` | 1,651 KB | |
| of which `sites[].series` | 1,569 KB | |

So the series is 82% of the file, and the file on the wire is 217 KB rather
than 1.9 MB. Both facts matter: the plan's regional split was aimed at a
number eight times larger than the real one, and it was aimed at the wrong
axis — the bytes are in the time series, not in the geography.

Inside the series, the expensive column is the date. Every site carries its
own copy of the same water-year calendar, so `"2025-10-01"` is written 217
times over, once per site, for each of 320 days.

## Decision

The dates are written once, at the top of the file, as `series_dates`. Each
site publishes three parallel columns: `series_days` — the positions in that
calendar it actually published — and `series_values` and `series_normals`
beside it.

Positions rather than a start index and a length, because seven sites have
gaps in the middle of their record and a contiguous slice drops them without
saying so. Positions rather than a full-length array with a hole marker,
because null already means something here: one row has no reading and 13,910
have no normal, and **"no row for this day" has to stay a different fact from
"a row that reads null"**.

The client rebuilds the rows in `validateSnowpackPayload`. Every reader
downstream — `snow-model.ts`, `weekly-model.ts`, the map, the charts — sees
exactly the `[date, value, normal]` rows it saw before. The saving is on the
wire, not in the model, and nothing that draws a curve had to learn anything.

## Consequences

| | raw | gzip |
|---|---:|---:|
| Before | 1,913 KB | 216.6 KB |
| After | 1,166 KB | **98.8 KB** |
| Saved | 747 KB | **117.8 KB (54%)** |

The saving is proportional to site count, so it holds at western scale: the
plan's ~1.8 MB gzipped estimate for ~1,725 sites becomes roughly 0.8 MB.

`schema_version` goes to 2. The published shape changed, and `data.html`
documents the new columns.

The rebuild was verified by round-tripping the committed file: every one of
the 68,540 rows comes back identical, asserted before the re-encoded file was
written. The validator refuses a payload whose columns differ in length, whose
day positions fall outside the calendar, or whose dates are not ascending —
each of which would otherwise rebuild a complete, plausible curve against the
wrong days, which is worse than a thrown error.

**The regional split is not done, and is deliberately deferred.** Splitting
per HUC-2 region would divide a 51-reservoir, 217-site payload that describes
one state into files a Utah reader would have to fetch two or three of. It
earns its place when the data is actually regional, which is Phase D, and it
composes with this rather than competing: this change is proportional to the
number of sites however they are filed.

## Related

- [ADR-051](ADR-051-revalidate-do-not-refetch.md) is the other half of the
  same measurement: this makes the file smaller, that stops paying for it
  twice.
- The figures and the method are in `docs/data-transfer.md`.
