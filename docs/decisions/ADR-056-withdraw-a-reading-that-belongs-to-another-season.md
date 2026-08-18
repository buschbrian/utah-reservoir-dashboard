# ADR-056: Withdraw a reading that belongs to another season

- Status: Accepted
- Date: 2026-08-18

## Context

`carry_forward` exists because dropping a reservoir on a failed fetch was
worse than keeping it. Its docstring says so plainly: a point vanishing from
the map with no explanation is strictly worse than the last known value shown
clearly as late. That reasoning is correct, and this record does not overturn
it. It bounds it.

The behaviour was designed against a gap measured in days. RISE publishes
through yesterday, so `STALE_AFTER_DAYS` is 2; a month-end feed gets 45. Both
thresholds ask the same question — *is this reading later than its source's
own schedule?* — and answer it with a label. Neither asks how old the reading
actually is, so neither has an upper bound. A feed that stops entirely is
carried forward for as long as it stays stopped.

Elkhead Reservoir stopped on 2026-05-31 and by 2026-08-18 was 79 days old,
against a next-oldest of 18. It was still on the map, still in the list, and
still labelled late.

**Being late and being from another season are different faults, and the
second is not fixed by a label.** A May reading standing in an August column
is not a late measurement of August. It is an accurate measurement of spring,
and in this geography the difference between those two things is most of the
melt. This is the same reasoning the seasonal normal already runs on: it
compares a date against the same date in prior years rather than against an
annual mean, precisely because storage here is strongly seasonal.

The label was also doing less than it appeared to. `statewideRollup` sums
`current_storage_af` across the scope with **no freshness filter** — `isLate`
exists and is used for the dashed ring and the "Late" badge, but not for
arithmetic. So a carried-forward spring figure was not merely displayed out of
season. It was added into a regional total presented as now.

## Decision

A record whose newest reading is older than **`WITHDRAW_AFTER_DAYS = 60`** is
not published. `partition_by_age` splits the run before the payload is
assembled; the record does not reach `reservoirs`, any rollup, any chart, or
the map.

**60 days rather than a strict calendar two months.** The threshold has to
clear a month-end feed that has missed one publication, which can legitimately
reach about 45 days before anything is wrong. 60 leaves that room without
letting a season through. Today it separates Elkhead at 79 days from a
next-oldest of 18 — the gap is wide, and no threshold in that range is
delicate.

**A withdrawal is stated, not silent.** The payload carries
`withdraw_after_days`, `withdrawn_count`, and a `withdrawn` array of notices.
A notice is deliberately *not* a reservoir record: name, `as_of`,
`days_stale`, source label, reason, and nothing else. Publishing the figure in
a quieter shape would be publishing the figure, and the validator rejects a
notice carrying `current_storage_af` for exactly that reason. Without these
fields the roster would just be quietly shorter, and a reader comparing two
mornings could not tell a withdrawal from a reservoir that had never been
here.

**Nothing is deleted.** The roster is committed, and the judgement is remade
from the data's age on every run, so a withdrawn reservoir returns on its own
the morning its source resumes. `partition_by_age` runs before
`attach_watersheds`, so a withdrawn record is not assigned a drainage area
either — it is absent, not present-and-empty.

**A record with no `as_of` at all is published, not withdrawn.** A reservoir
that has never fetched successfully is a different fault with a different
remedy, already visible through `fetch_ok`. Withdrawing on a missing field
would hide a configuration error behind the mechanism built for a quiet feed.

**Withdrawal gets its own self-healing issue,** labelled `withdrawn-feed`,
beside the existing `stale-feed` one. Stale is "watch this". Withdrawn is
"this reservoir left the map, and someone has to decide whether the feed is
returning or the reservoir needs re-sourcing". Same shape, so it also closes
itself.

## Consequences

**A drainage area can now be empty, and one is.** Withdrawing Elkhead leaves
White-Yampa (140500) with no tracked reservoir. This turned out to need no
code: `storageAgainstDrought` already omits an area with no reading rather
than drawing it at zero, on the stated grounds that an area with no reservoirs
is not an area whose reservoirs are empty. The invariant that every published
drainage area has a tracked reservoir moves from the payload to the roster,
which is where it was always really true.

**Two tests were measuring publication when they meant geography.** The HUC
assignment tests read coordinates from `reservoirs.json`, so a quiet feed
would have quietly retired an assertion. They now read the roster, and go on
checking a reservoir that is not currently published. Where a reservoir sits
does not depend on whether its feed reported this week.

**The payload's withdrawal fields are optional in the validator,** like the
comparison metadata before them. A file written before this record has no
withdrawal record and is old, not malformed; refusing it would refuse a file
this project itself published. Present, they are checked strictly.

The published roster drops from 69 to 68 today.

## Alternatives considered

**Keep publishing and exclude from rollups only.** Fixes the arithmetic and
leaves the display problem: a spring figure still sits in a list of August
figures, and every reader who reads a value off the map rather than out of a
total still reads it. It also splits one rule across two layers, which is the
arrangement `isLate`'s own docstring warns about after the dashed ring and the
"Late" badge spent a while disagreeing.

**Grey the reservoir out past 60 days.** A stronger label. The objection to
labels applies unchanged — and the value would still be in the total.

**Refuse to withdraw the last reservoir in a drainage area.** Considered
because Elkhead is exactly that. Rejected: it makes publication depend on
which other feeds are healthy, so the same reading would be published or not
depending on its neighbours, and the rule could not be stated to a reader in
one sentence.

**A calendar two months rather than 60 days.** Same intent, variable length,
and it puts a month-end feed's fate on which month it is. 60 is fixed and
clears the month-end case in every month.
