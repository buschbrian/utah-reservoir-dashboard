# ADR-069: Deduplicate reservoirs by dam identity

- Status: Accepted
- Date: 2026-08-20
- Qualifies: ADR-003 when a reservoir operator's project record conflicts with
  the National Inventory of Dams

## Context

R2 measures the part of the Bureau of Reclamation catalogue inside
`west-huc6` that the configured roster did not already represent. The live
catalogue held 1,012 locations, including 284 classified as Lake/Reservoir and
180 inside the scope. Position removed 96 already tracked locations. Of the 84
that remained, only 38 had a daily acre-foot storage series with observations.

Position could not finish the deduplication. The Bureau locates Lake Mead at
Hoover Dam, 41.9 km from this project's published waterbody point. Its
provider point is instead directly on the reviewed dam point. Blue Mesa,
Navajo and McPhee survived both position comparisons but matched the same
National Inventory of Dams identifiers as configured reservoirs. A dam
identity is stronger evidence than either provider's choice of a representative
point.

The audit also found that a provider's state tag cannot limit the dam search.
Navajo's storage point is tagged Colorado while Navajo Dam is in New Mexico.
The drainage area, not the provider point, determines which U.S. states must be
searched.

Three otherwise admissible reservoirs exposed a second source question. The
inventory's normal-storage value did not agree with the reservoir-specific
record published by the Bureau:

| Reservoir | Inventory normal storage | Bureau project record |
|---|---:|---:|
| Billy Clapp Lake | 64,200 | 21,200 acre-feet |
| Keswick Reservoir | 7,470 | 23,800 acre-feet |
| Lake Cachuma | 172,500 | 205,000 acre-feet |

The observed series supports the scale of the Bureau values: its highest
readings were 22,084, 23,466 and 197,790 acre-feet respectively. The national
inventory remains the right default and the right source for dam identity and
outlet position, but its generic storage fields are not stronger than an
explicit record published by the reservoir's operator.

## Decision

Admit the 25 new daily storage items recorded in
`admitted_rise_reservoirs.json`. The file is a reviewed, source-only roster;
the daily pipeline loads it, while the build continues to publish only the
normalized runtime payload and reference export.

The reproducible R2 audit applies these screens:

1. remove configured reservoirs within 3 km of the Bureau waterbody point;
2. after finding a usable storage item, remove points within 3 km of a
   configured reservoir's reviewed dam point;
3. run the existing capacity-admission rules against dams in every U.S. state
   reached by the drainage area; and
4. remove any admitted candidate whose matched dam identifier is already
   configured.

The last screen is the identity decision. The earlier position screens remain
because they cheaply remove records before the national dam query and explain
which representation caused a duplicate. Future providers should use the same
dam identity when it is available and position only as the fallback.

ADR-003 remains the default capacity rule. A reservoir-specific operator
record may override the inventory only when the conflict is reviewed and the
committed evidence names the record, its URL and the date checked. Billy Clapp,
Keswick and Cachuma are the three accepted exceptions. Their inventory dam
identifier, name, point and all storage fields stay in the evidence; only the
selected full level uses `reclamation_project_record`.

## Consequences

- The configured roster is 228 reservoirs. The delivery-day payload publishes
  223 and names five withdrawn for readings outside the publication window.
- Three additional drainage areas now hold a reservoir: Lower Sacramento, San
  Joaquin and Central California Coastal, bringing the represented total to 43
  of 75.
- Closed-period baselines are available for 24 of the 25 additions. Scooteney
  has no observations in 1991 through 2020 and reports that absence instead of
  substituting recent years.
- The details panel, combined summaries and CSV export name an operator project
  record as a distinct full-level basis. They do not present it as a national
  inventory value.
- The audit compares against the pre-R2 roster deliberately. Otherwise its 25
  committed results would erase their own evidence on the next run by becoming
  "already tracked."
- The three monthly records that also have daily Bureau series remain on their
  current provider. Changing a published station identity and history is a
  separate source-migration decision.

## Alternatives Considered

### Deduplicate only by position

- Rejected: it offers Lake Mead again when comparing water point to water
  point, and offers Blue Mesa, Navajo and McPhee even after the reviewed dam
  point comparison.

### Let a shared name establish identity

- Rejected: names vary by provider and can be shared by different reservoirs.
  A matched national dam identifier is reviewed evidence about the physical
  project.

### Use the national inventory value in all three conflicts

- Rejected: it would publish full levels contradicted by explicit project
  records from the reservoir operator and, for Keswick and Cachuma, by the
  observed storage series.

### Replace every national inventory capacity with a Bureau project record

- Rejected: the national inventory is consistent, structured and already
  reviewed for the other reservoirs. A named exception with retained evidence
  is narrower and reproducible; a wholesale second catalogue would create a
  new parity project without evidence that it improves the remaining rows.
