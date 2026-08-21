"""Late, and gone: the two different faults a quiet feed can have.

`carry_forward` keeps publishing a quiet feed's last value, because a point
vanishing from the map with no explanation is worse than one that says it is a
few days behind. That is true for days and false for months, so past
`WITHDRAW_AFTER_DAYS` the record leaves the payload entirely (ADR-056) -- the
regional total sums current storage with no freshness filter, so a spring
figure would not merely be shown out of season, it would be added into a total
presented as now.

A withdrawal notice carries no measurement. The validator rejects one that
does.
"""

import pandas as pd

from .constants import WITHDRAW_AFTER_DAYS


def carry_forward(previous: dict, today: pd.Timestamp, reason: str) -> dict:
    """Reuse yesterday's record for a reservoir we couldn't refresh today.

    Dropping the reservoir entirely (the old behavior) silently removed the
    point from the map with no explanation, which is strictly worse than
    showing the last known value clearly labeled as stale.
    """
    record = dict(previous)
    as_of = pd.Timestamp(record.get("as_of"))
    record["days_stale"] = int((today - as_of).days) if not pd.isna(as_of) else None
    record["is_stale"] = True
    record["fetch_ok"] = False
    record["fetch_error"] = reason
    return record


def partition_by_age(records: list[dict]) -> tuple[list[dict], list[dict]]:
    """Split the run's records into what is published and what is withdrawn.

    A record older than WITHDRAW_AFTER_DAYS is not published. It is not
    deleted either: it comes back on its own the morning its source resumes,
    because the roster it is fetched from is committed and this decision is
    made fresh on every run from the age of the data alone.

    A record with no `as_of` at all -- a reservoir that has never fetched
    successfully -- is published rather than withdrawn. That is a different
    fault with a different remedy, it is already visible through `fetch_ok`,
    and withdrawing on a missing field would hide a configuration error
    behind the mechanism built for a quiet feed.
    """
    published, withdrawn = [], []
    for record in records:
        days = record.get("days_stale")
        if days is not None and days > WITHDRAW_AFTER_DAYS:
            withdrawn.append(record)
        else:
            published.append(record)
    withdrawn.sort(key=lambda r: -(r.get("days_stale") or 0))
    return published, withdrawn


def withdrawal_notice(record: dict) -> dict:
    """What the payload says about a reservoir it is not publishing.

    Deliberately not a reservoir record: no storage, no percent full, no
    baseline. Publishing the figure in a quieter shape would be publishing
    the figure. This is the name, when it was last real, and how long ago
    that was -- enough for a reader to know the roster changed and why, and
    not enough for anything to chart it.
    """
    return {
        "name": record.get("name"),
        "as_of": record.get("as_of"),
        "days_stale": record.get("days_stale"),
        "source_label": record.get("source_label"),
        "reason": "no reading inside the publication window",
    }
