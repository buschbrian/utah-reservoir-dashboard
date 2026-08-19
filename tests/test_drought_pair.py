"""The guard that keeps the two drought files on the same week.

The drought view refuses to draw when the polygons and the coverage figures
name different weeks. That refusal protects the reader; this tool protects the
commit, by catching the mismatch in the refresh workflow while both files can
still be put back. These tests hold it to that job.

They stay data-independent, like the coverage tests beside them: nothing here
asserts this week's drought, so a Thursday release cannot turn the suite red.
"""

import json
import re
import sys
from datetime import date
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from check_drought_pair import (  # noqa: E402
    coverage_paths,
    LATE_AFTER_DAYS,
    check_pair,
    days_since,
)


class TestPairAgreement:
    def test_agreeing_files_report_no_problems(self):
        week = {"map_date": "2026-08-11", "release_date": "2026-08-13"}
        assert check_pair(dict(week), dict(week)) == []

    def test_a_stale_coverage_file_is_named_with_both_weeks(self):
        problems = check_pair(
            {"map_date": "2026-08-11", "release_date": "2026-08-13"},
            {"map_date": "2026-08-04", "release_date": "2026-08-06"})

        assert len(problems) == 2
        joined = " ".join(problems)
        assert "2026-08-11" in joined and "2026-08-04" in joined

    def test_a_release_date_alone_is_enough_to_fail(self):
        """The map week can match while the release does not -- a corrected
        republish of the same week. The files still came from two downloads,
        so they still have to be regenerated as a pair."""
        problems = check_pair(
            {"map_date": "2026-08-11", "release_date": "2026-08-14"},
            {"map_date": "2026-08-11", "release_date": "2026-08-13"})

        assert len(problems) == 1
        assert "release_date" in problems[0]

    def test_a_missing_field_is_a_disagreement_not_a_crash(self):
        problems = check_pair({}, {"map_date": "2026-08-11"})
        assert problems  # and it returned rather than raising


class TestReleaseAge:
    def test_counts_whole_days_from_the_release(self):
        assert days_since("2026-08-13", date(2026, 8, 13)) == 0
        assert days_since("2026-08-13", date(2026, 8, 16)) == 3
        assert days_since("2026-08-13", date(2026, 9, 1)) == 19

    def test_a_release_dated_in_the_future_reads_as_negative(self):
        """Not clamped to zero. A future release date is a data fault, and a
        caller that sees -2 can tell that from a fresh release; one that sees
        0 cannot."""
        assert days_since("2026-08-20", date(2026, 8, 18)) == -2

    def test_the_threshold_allows_a_slipped_release_but_not_a_missed_one(self):
        """A weekly cadence plus two days of slack. Eight days is a release
        that ran late; ten is one that did not happen."""
        assert days_since("2026-08-13", date(2026, 8, 21)) < LATE_AFTER_DAYS
        assert days_since("2026-08-13", date(2026, 8, 23)) >= LATE_AFTER_DAYS


def test_the_late_threshold_matches_the_one_the_page_shows():
    """The pipeline and the page have to agree about what "late" means.

    The page marks a release late after this many days and says so to the
    reader; the workflow opens an issue on the same rule. Two copies of one
    number in two languages is exactly the kind of thing that drifts and is
    never chased, because each side looks right on its own.
    """
    source = (ROOT / "src" / "drought-model.ts").read_text(encoding="utf-8")
    match = re.search(r"LATE_AFTER_DAYS\s*=\s*(\d+)", source)

    assert match, "src/drought-model.ts no longer declares LATE_AFTER_DAYS"
    assert int(match.group(1)) == LATE_AFTER_DAYS


class TestCommittedFiles:
    def test_every_committed_coverage_file_describes_the_same_week(self):
        """The state the workflow exists to preserve, asserted on what is
        actually in the repository. The coverage suite checks this too, from
        the other direction; this is the one that names the tool to run.

        Every offered level, not just the one the map opens at: a reader who
        changes the level fetches a different file (ADR-064), and one left
        behind would put them on another week with nothing said.
        """
        polygons = json.loads(
            (ROOT / "data" / "drought" / "usdm-current.geojson")
            .read_text(encoding="utf-8"))
        published = coverage_paths()

        assert [path.name for path in published] == [
            "usdm-huc4.json", "usdm-huc6.json"]
        for path in published:
            coverage = json.loads(path.read_text(encoding="utf-8"))
            assert check_pair(polygons, coverage) == [], (
                f"{path.name} describes a different week from the polygons; "
                "run tools/compute_drought_coverage.py")

    def test_the_archive_is_not_mistaken_for_a_week(self):
        """It is a series of weeks, not one, and has no `map_date` to agree
        on -- so a glob that swept it in would report a permanent mismatch."""
        assert not any(path.name.endswith("-history.json")
                       for path in coverage_paths())
