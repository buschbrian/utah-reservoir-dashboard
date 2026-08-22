# ADR-079: Rename through a former-name table, and publish the operator

- Status: Accepted
- Date: 2026-08-22

## Context

Twenty-six roster names carried provider debris: operator initials in
parentheticals applied by `str.title()` (`Courtright (Pg&E)`), gauge
abbreviations (`Marlette Lk nr Carson City`, `Viva Naughton Res`), plant
numbering standing where a water's name should be (`Pit R No 7 Reservoir`),
and one name already formatted like the site's own disambiguated labels
(`Rye Patch Re nr Rye Patch, NV`). The reviewer accepted all twenty-six
proposed display names, with evidence recorded per row.

Renaming was gated on two things this record settles:

**How old links survive.** `?reservoir=<name>` is name-keyed; every saved
link written against an old spelling would break. Of the three ways out the
scoping named, this takes option 1:

**A committed former-name table** read by `findReservoir` as its fourth and
last resolution step — after station id, qualified label, and bare name.
Embedded in the client bundle rather than fetched, for the same reason
`public/retired-route.js` embeds its URL translations: a former name is part
of the link contract, not an observation about the world, and resolving one
must not cost a request or an async hop inside a synchronous lookup. The
fourth step only fires when nothing live answers, so it can never shadow a
real name that collides with an old spelling.

## Decision

**Names change at their reviewed sources, never during the daily refresh.**
The twenty-one California names changed in `admitted_cdec_reservoirs.json`,
the five federal ones in `admitted_reservoirs.json` — the reviewed rosters,
edited by a person, exactly as the water-body scoping required. The next
refresh publishes them like any other reviewed input.

**The operator is published beside the name rather than deleted with the
parenthetical.** Nine of these reservoirs were searchable as "PG&E" only
because the provider field had been pasted into the name. The admitted
California roster already carried `"operator"`; the payload now publishes it
(optional, absent where no operator is named) and search matches it, so
"PG&E" still finds Courtright after "Courtright (Pg&E)" becomes "Courtright
Reservoir".

## Consequences

Every surface that displays a name shows the new one automatically; every
surface that resolves one accepts the old spelling indefinitely. The former-
name table grows only by reviewed decision — an entry is a rename someone
made, not a synonym list anyone may extend. If two future renames ever chain
(an old name later renamed again), the table points at the station id, so it
cannot go stale the way old-name-to-new-name pairs would.
