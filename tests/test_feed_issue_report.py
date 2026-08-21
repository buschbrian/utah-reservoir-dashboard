"""The self-healing issue bodies, checked without waiting for a feed to fail.

These were three `printf` blocks in refresh-data.yml. The bug they were written
around is still the bug: four leading spaces is a Markdown code block, so any
indentation that follows the YAML rather than the Markdown silently turns a
reader-facing explanation into a monospaced wall.
"""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import feed_issue_report as R  # noqa: E402

CHECKED = "2026-08-21 12:00 UTC"


def render(kind: str, **kwargs) -> tuple[str, str]:
    if kind == "stale":
        return R.stale_report(checked=CHECKED, **kwargs)
    if kind == "withdrawn":
        return R.withdrawn_report(checked=CHECKED, **kwargs)
    return R.drought_report(checked=CHECKED, **kwargs)


STALE = dict(count="3", names="Bear Lake, Hyrum", table="| Name | Days |\n|---|---|")
WITHDRAWN = dict(count="1", names="Yuba", table="| Name | Days |\n|---|---|")
DROUGHT = dict(days="11", release="2026-08-14", map_week="2026-08-11")


class TestShape:
    @pytest.mark.parametrize("kind,kwargs", [
        ("stale", STALE), ("withdrawn", WITHDRAWN), ("drought", DROUGHT)])
    def test_no_line_is_accidentally_a_code_block(self, kind, kwargs):
        _, body = render(kind, **kwargs)
        for line in body.split("\n"):
            if line.startswith("|"):
                continue  # a table row, which is what it looks like
            assert not line.startswith("    "), repr(line)

    @pytest.mark.parametrize("kind,kwargs", [
        ("stale", STALE), ("withdrawn", WITHDRAWN), ("drought", DROUGHT)])
    def test_every_body_says_when_it_was_checked(self, kind, kwargs):
        _, body = render(kind, **kwargs)
        assert CHECKED in body
        assert body.endswith("\n")

    @pytest.mark.parametrize("kind,kwargs", [
        ("stale", STALE), ("withdrawn", WITHDRAWN), ("drought", DROUGHT)])
    def test_the_title_is_one_line(self, kind, kwargs):
        title, _ = render(kind, **kwargs)
        assert "\n" not in title and title.strip() == title


class TestContent:
    def test_the_counts_and_names_reach_the_reader(self):
        title, body = render("stale", **STALE)
        assert "Bear Lake, Hyrum" in title
        assert "**3**" in body
        assert "| Name | Days |" in body

    def test_late_and_withdrawn_are_told_apart(self):
        """The two issues exist because the remedies differ. Neither body may
        read as the other one."""
        _, late = render("stale", **STALE)
        _, gone = render("withdrawn", **WITHDRAWN)
        assert "not presented as current" in late
        assert "not in any total" in gone
        assert "What to decide" in gone
        assert "What to decide" not in late

    def test_the_withdrawal_body_explains_the_total_it_protects(self):
        _, body = render("withdrawn", **WITHDRAWN)
        assert "ADR-056" in body
        assert "no freshness filter" in body

    def test_the_drought_body_points_at_the_producer_first(self):
        _, body = render("drought", **DROUGHT)
        assert R.DROUGHT_MONITOR_URL in body
        assert "2026-08-11" in body and "2026-08-14" in body

    def test_no_body_uses_retired_vocabulary(self):
        """ADR-006 is about visible product text, and an issue is not that --
        but 'stale' has a replacement everywhere else in this project and two
        vocabularies for one condition is how a reader learns the wrong one."""
        for kind, kwargs in [("stale", STALE), ("withdrawn", WITHDRAWN)]:
            _, body = render(kind, **kwargs)
            assert "marked stale" not in body


class TestCommandLine:
    def test_it_writes_a_body_file_and_prints_the_title(self, tmp_path, capsys):
        target = tmp_path / "body.md"
        code = R.main(["stale", "--count", "2", "--names", "A, B",
                       "--table", "|x|", "--checked", CHECKED,
                       "--body-file", str(target)])
        assert code == 0
        assert capsys.readouterr().out.strip() == "Reservoir feeds have gone quiet (A, B)"
        assert "**2**" in target.read_text(encoding="utf-8")

    def test_it_can_print_the_label_the_condition_maintains(self, capsys):
        assert R.main(["withdrawn", "--print-label"]) == 0
        name, colour, description = capsys.readouterr().out.strip().split("\t")
        assert name == "withdrawn-feed" and len(colour) == 6 and description

    def test_the_run_link_appears_only_when_there_is_a_run(self, monkeypatch):
        monkeypatch.delenv("GITHUB_RUN_ID", raising=False)
        _, body = render("stale", **STALE)
        assert "actions/runs" not in body
        monkeypatch.setenv("GITHUB_SERVER_URL", "https://github.com")
        monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")
        monkeypatch.setenv("GITHUB_RUN_ID", "42")
        _, body = render("stale", **STALE)
        assert "https://github.com/o/r/actions/runs/42" in body
