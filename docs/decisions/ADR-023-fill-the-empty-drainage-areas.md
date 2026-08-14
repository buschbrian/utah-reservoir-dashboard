# ADR-023: Add reviewed sites to the empty drainage areas

## Status

Accepted.

## Date

2026-08-14

## Context

Three of the fourteen published six-digit drainage areas had no tracked
reservoir: Colorado Headwaters, White-Yampa, and Lower San Juan. The areas
were not empty. The first inventory was centered on Utah facilities, while
these storage sites are in Colorado and Wyoming.

The discovery tool found ten storage stations in Colorado Headwaters, four in
White-Yampa, and one in Lower San Juan. All fifteen have an observed storage
series and a stable station identifier. The position-first admission audit
matched each station to a dam in the U.S. Army Corps of Engineers National
Inventory of Dams. Every match passed the maximum-pool check in ADR-015.

The audit did not add them because it was designed to write nothing. Its job
was to produce evidence for a publication decision. There was no reviewed
configuration between that evidence and the daily refresh.

## Decision

Publish all fifteen capacity-admissible stations in the three previously
empty drainage areas.

Commit the selection in `connected_reservoirs.json`. Each row keeps the
storage station, coordinates, update schedule, capacity value and basis, dam
inventory identifier, dam name, dam coordinates, match distance, and match
method together.

Use a daily series when it is currently reporting. Use the current monthly
series when no current daily series exists or when the daily series has
stopped but monthly values continue. The existing late-data rules still
apply; admission does not make an old reading current.

Keep the accepted geography unchanged. These sites appear in the connected
view because their dams are inside drainage areas that touch Utah and belong
to the Colorado River or Great Basin systems. They do not become Utah
waterbodies.

## Consequences

- The published inventory increases from 54 to 69 reservoirs.
- Colorado Headwaters gains ten tracked reservoirs, White-Yampa gains four,
  and Lower San Juan gains one. Every published drainage area now has at
  least one tracked reservoir.
- Nine additions use daily values and six use monthly values.
- The connected totals and charts change. The Utah-waterbody totals do not,
  because all fifteen additions are outside Utah and do not cross its border.
- Future reviews can rerun discovery and admission without silently changing
  the published set. A new site still needs a deliberate change to the
  committed configuration.
