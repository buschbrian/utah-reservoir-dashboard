"""The county axis, at the pipeline end (ADR-058).

Network-free. The assignment is committed, so these read the file rather than
the service -- which is the property being tested as much as anything: a
county that can change underneath you is not reproducible.
"""

import json
from pathlib import Path

import pytest

import refresh_reservoirs

ROOT = Path(__file__).resolve().parent.parent
COUNTIES = json.loads((ROOT / "counties.json").read_text(encoding="utf-8"))


def test_every_published_reservoir_has_a_county():
    """The roster and the assignment have to agree, or the filter lies.

    Read from the committed roster rather than reservoirs.json, per the rule
    in CLAUDE.md: a quiet feed withdraws a record (ADR-056), and a test that
    reads the payload would let a withdrawal silently retire the assertion.
    """
    roster = set(json.loads(
        (ROOT / "connected_reservoirs.json").read_text(encoding="utf-8"))["reservoirs"])
    roster |= set(refresh_reservoirs.RESERVOIRS)
    missing = sorted(roster - set(COUNTIES["counties"]))
    assert not missing, f"no county assignment for: {', '.join(missing)}"


def test_the_codes_are_five_digit_strings():
    """Fixed-width and zero-padded, so the digit count is the validation.

    A string, never a number: Arizona is 04, and parsing loses the state.
    """
    for name, entry in COUNTIES["counties"].items():
        code = entry["county_fips"]
        assert isinstance(code, str), f"{name}: {code!r} is not a string"
        assert len(code) == 5 and code.isdigit(), f"{name}: {code!r} is not five digits"


def test_the_name_is_not_the_key():
    """Two Summit Counties, in different states, must stay two counties."""
    by_name: dict[str, set[str]] = {}
    for entry in COUNTIES["counties"].values():
        by_name.setdefault(entry["county_name"], set()).add(entry["county_fips"])
    shared = {name: codes for name, codes in by_name.items() if len(codes) > 1}
    # Not an assertion that a collision exists -- it is that a collision is
    # survivable. If the roster ever holds one, the codes still differ.
    for name, codes in shared.items():
        assert len(codes) == len({c[:2] for c in codes}), (
            f"{name} resolves to {codes}, which is not one county per state")


def test_the_assignment_point_is_the_water_not_the_dam():
    """ADR-058's whole decision, asserted where a reader would look for it."""
    assert COUNTIES["assignment_point"] == "published_point"
    assert "dam" in COUNTIES["note"]


def test_lake_powell_is_in_utah_not_at_its_dam():
    """The case that decided the rule.

    Glen Canyon Dam is in Coconino County, Arizona. The lake a reader asks
    about is in San Juan County, Utah.
    """
    powell = COUNTIES["counties"]["Lake Powell"]
    assert powell["state"] == "UT"
    assert powell["county_name"] == "San Juan County"


def test_the_source_is_the_detailed_layer():
    """The generalized boundaries put Lost Lake outside Wasatch County."""
    assert "USA_Census_Counties" in COUNTIES["source_layer"]
    assert "Generalized" not in COUNTIES["source_layer"]
    assert COUNTIES["counties"]["Lost Lake"]["county_name"] == "Wasatch County"


class TestAttachCounties:
    def records(self):
        return [{"name": "Lake Powell"}, {"name": "Not on the roster"}]

    def test_it_attaches_the_committed_assignment(self):
        records = self.records()
        summary = refresh_reservoirs.attach_counties(records)
        assert records[0]["county_fips"] == COUNTIES["counties"]["Lake Powell"]["county_fips"]
        assert summary["assigned"] == 1
        assert summary["unassigned"] == 1

    def test_an_unassigned_reservoir_gets_no_county_rather_than_a_guess(self):
        records = self.records()
        refresh_reservoirs.attach_counties(records)
        assert "county_fips" not in records[1]

    def test_a_missing_file_is_not_fatal(self, monkeypatch, tmp_path):
        """Losing the daily refresh over a county lookup is the worse failure."""
        monkeypatch.setattr(refresh_reservoirs, "COUNTIES_PATH", tmp_path / "absent.json")
        records = self.records()
        summary = refresh_reservoirs.attach_counties(records)
        assert summary == {"assigned": 0, "unassigned": 2, "county_count": 0}
        assert "county_fips" not in records[0]
