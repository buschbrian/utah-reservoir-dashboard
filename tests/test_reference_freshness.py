"""The reference-freshness registry, tested for shape and never for dates.

`tools/check_reference_freshness.py` is a tool and must never become a test:
a check that fails when a date passes turns the build red on a morning when
no code changed, and a red build freezes the published numbers. So nothing
here reads a review interval against today. What is tested is that every
registered file exists and carries the date field its policy names -- a
registry pointing at a path nothing writes reports "missing / REVIEW"
forever, which reads exactly like a file nobody has reviewed.

The drainage entries are the reason this file exists. They are resolved from
`watershed_scopes.DRAWN_SCOPES` rather than written down (ADR-063), and the
failure that rule was written from is silent: when the drawn scope moves
files, a hard-coded path goes on reviewing the retired geography's date.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

import check_reference_freshness as F  # noqa: E402
import watershed_scopes  # noqa: E402


def all_entries() -> tuple[dict, ...]:
    return (*F.REFERENCES, *F.drainage_references())


def test_every_registered_reference_names_a_file_that_exists():
    for entry in all_entries():
        path = ROOT / entry["path"]
        assert path.exists(), f"{entry['path']} is registered and absent"


def test_every_registered_reference_carries_its_own_date():
    """The generators stamp the date; a file that does not carry one cannot
    be reviewed, and would report as due forever."""
    for entry in all_entries():
        stamped = F.read_date(ROOT / entry["path"], entry["field"])
        assert stamped, (
            f"{entry['path']} carries no {entry['field']!r} date")


def test_every_registered_reference_states_a_review_interval():
    for entry in all_entries():
        assert isinstance(entry["days"], int) and entry["days"] > 0, entry["path"]
        assert entry["what"], entry["path"]


def test_the_drawn_boundaries_are_reviewed_at_every_level_the_maps_draw():
    """Resolved from the registry, so a scope that moves files moves this too.

    Named paths would leave the tool reviewing a geography nothing draws --
    which is the ADR-063 rule, and it is categorical because the files have
    moved once already.
    """
    resolved = {entry["path"] for entry in F.drainage_references()}
    expected = {watershed_scopes.get_scope(name).output
                for name in watershed_scopes.DRAWN_SCOPES.values()}
    assert resolved == expected
    assert len(resolved) == len(watershed_scopes.DRAWN_SCOPES)
    # And no path is written down twice, once here and once in the registry.
    assert resolved.isdisjoint({entry["path"] for entry in F.REFERENCES})


def test_the_review_reports_every_entry_and_never_fails():
    """A tool, not a gate: it answers for every file and exits zero."""
    import datetime as dt

    rows = F.review(dt.date(2026, 8, 20))
    assert len(rows) == len(all_entries())
    for row in rows:
        assert "due" in row
