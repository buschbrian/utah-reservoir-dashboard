# ADR-055: Measure area geodesically, and keep the sampler spherical

- Status: Accepted
- Date: 2026-08-18

## Context

The modernization plan's interface-polish slice closed with an item saying
that the drought engine's area arithmetic should move from its
cosine-latitude-weighted scanline to Albers Equal Area Conic, "the USGS
standard for this kind of extent", and that this "is the change worth making".
It asked for a measured error bound. Issue #23 carried it.

The item was written against a real observation — the engine works in
geographic coordinates, and a degree of longitude is not a fixed distance — but
it never measured what that was costing. Measured now, against the committed
inputs, it costs almost nothing, and the reason is worth writing down because
the same wrong conclusion is easy to reach twice.

**`cos(lat)` is not an approximation of an equal-area projection. It is the
exact area element of a sphere.** A lat-lon cell covers `R² cos(φ) dφ dλ`, so
the engine was already weighting for equal area; the only question was ever
which figure of the earth it assumed. Against the WGS84 ellipsoid the exact
element is `cos(φ) / (1 − e² sin²φ)²`, and across this project's latitude band
— 35.1°N to 43.5°N — that correction runs from 1.00442 to 1.00637.

**A drought share is a ratio taken inside one drainage area, so a systematic
bias cancels.** Only the differential across a single area's own latitude span
survives, and the widest here is 4.5° (Great Salt Lake).

### What was measured

Absolute area of all 14 published drainage areas, as parts per million from
geodesic truth — Karney's algorithm on WGS84, no projection, closed form,
accurate to about 0.1 m² per vertex:

| model | max deviation | character |
|---|---:|---|
| Albers Equal Area Conic, EPSG:5070 | **0.1 ppm** | agrees to machine precision |
| authalic sphere, great-circle edges | **1,530 ppm** | systematic, always low, mean −986 |

Albers and geodesic are the same answer. That is not a coincidence and not a
result about this data: Albers parameterised on an ellipsoid is equal-area by
construction, and the standard parallels move where *shape* distortion is
minimised, never whether area is preserved.

Effect on a **published** figure, in percentage points, against a rounding
boundary of 0.05:

| error term | max | figures that round differently |
|---|---:|---:|
| area model — sphere `cos(lat)` vs WGS84 ellipsoid | **0.004** | 0 of 154 |
| whole switch to Albers — model and edge interpretation together | 0.077 | 6 of 154 |
| **sampling — step 0.01° against convergence** | **0.069** | 3 of 154 |
| control: no latitude weighting at all | 0.286 | 38 of 154 |

Three things follow. The area model is worth 0.004 points and cannot move a
published figure. The Albers row is indistinguishable from the engine's own
sampling noise, and the grid resolutions were matched only approximately, so
part of that 0.077 *is* resampling. And the control row shows the weighting is
doing real work — the finding is not that latitude weighting does not matter,
it is that `cos(lat)` already captures all but the last 1.5% of it.

The live error is **sampling**, and no change of projection touches it. That is
also the term behind the HUC-10 refusal recorded in `watershed_scopes.py`:
same arithmetic, smaller units, fewer points, about 0.21 points.

## Decision

**Geodesic is this project's measure of record for area.** Where an area is
stated, compared, or asserted, it is computed on the WGS84 ellipsoid by
Karney's algorithm. Not Albers, though Albers agrees: geodesic carries no
standard parallels, no central meridian, no zone and no datum choice to select,
document, and keep synchronised between the tool that writes a figure and the
test that checks it. It also asks nothing of the source geometry, which for the
Drought Monitor already arrives reprojected to EPSG:4326 from an Albers
original and generalised to 100 m.

**The drought sampler keeps `cos(lat)` and its 0.01° step.** Both are correct
to well inside the published precision, and the measurements above are the
bound the plan asked for.

**`geographiclib` is a test dependency, never a pipeline dependency.** It goes
in `requirements-test.txt`. The daily refresh stays numpy, pandas and requests.
This is the same arrangement as the frozen colour oracle: an independent,
exact, slower reference that the fast production path is checked *against*
rather than replaced *by*.

`tests/test_area_model.py` holds it. It asserts that every drainage area's
sampled weight-sum matches its geodesic area within tolerance, and that
swapping the spherical weight for the exact ellipsoidal one moves no published
figure across a rounding boundary. A future change to the boundaries, the step,
or the weighting is measured against an oracle that shares none of its
assumptions.

**Exact polygon clipping is refused for now.** It is the only thing that would
retire the 0.069-point sampling term, and it needs a planar geometry library —
binary wheels, in a daily pipeline deliberately kept to three pure
dependencies. The error it would remove is already inside the precision this
file publishes. Revisit if the published precision ever goes past 0.1 of a
point, which is also the condition under which HUC-10 becomes available.

## Consequences

Issue #23 closes as measured rather than as built. The plan's item 6 is
answered: UTM was already refused for the interactive map on two independent
grounds, and Albers turns out to be unnecessary for the arithmetic — correct,
but a change with no consequence a reader could see.

Nothing in the published payload changes. No figure moves.

The other spherical approximations in the pipeline are now named rather than
implicit: `haversine_km` and the `cos(lat)` boundary-distance scale in
`huc.py`, and `distance_km` in `admission.py`. All three are distances, not
areas, and all three feed a dam matcher with a 20 km radius where the
haversine-to-geodesic difference is about 0.1%, or 20 m. They are correct for
what they decide. This record exists so that stays a measurement rather than an
assumption.

## Alternatives considered

**Move the sampler to Albers.** What the plan proposed. It is not wrong — it
would produce the same areas geodesic does — but it buys 0.004 points of real
accuracy, and pays a projection, five constants, and a second transformation of
already-reprojected source geometry for it.

**Adopt the Drought Monitor's own projection to match its published
statistics.** The monitor projects to USA Contiguous Albers Equal Area Conic
for its national and state figures. Attractive, and rejected: this project
computes shares of *drainage areas*, which the monitor does not publish, so
there is no figure to reconcile with. Matching the projection would not make
any two numbers agree that do not already.

**Raise the sampling resolution instead.** A step of 0.005° converges the
figures and costs about four times the runtime. Rejected as unnecessary at a
published precision of 0.1 of a point, and recorded as the first thing to reach
for if that precision ever tightens.
