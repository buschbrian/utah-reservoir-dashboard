"""The agent harness, checked like anything else.

Routing only works if it arrives somewhere. These tests hold the parts of the
documentation system that a rename silently breaks: every link an agent is told
to follow resolves, the root instruction file stays a routing document rather
than growing back into an encyclopedia, and every decision record is reachable
from the index that claims to route to all of them.

Deliberately *not* checked here: whether any of it is true. That is what the
rest of the suite is for.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

#: The files an agent is expected to read, and therefore the links that have to
#: work. Everything else in docs/ is prose for people, checked by reading it.
AGENT_FACING = [
    ROOT / "AGENTS.md",
    ROOT / "CLAUDE.md",
    *sorted(ROOT.glob("*/AGENTS.md")),
    *sorted(ROOT.glob(".github/workflows/AGENTS.md")),
    *sorted((ROOT / ".claude" / "rules").glob("*.md")),
    *sorted((ROOT / ".claude" / "skills").glob("*/SKILL.md")),
    ROOT / "docs" / "README.md",
    ROOT / "docs" / "decisions" / "README.md",
    ROOT / "docs" / "history" / "README.md",
    *sorted((ROOT / "docs" / "architecture").glob("*.md")),
    *sorted((ROOT / "docs" / "operations").glob("*.md")),
]

LINK = re.compile(r"\[[^\]]*\]\(([^)]+)\)")


def links_in(path: Path) -> list[str]:
    return [target for target in LINK.findall(path.read_text(encoding="utf-8"))
            if not target.startswith(("http://", "https://", "#", "mailto:"))]


@pytest.mark.parametrize("path", AGENT_FACING, ids=lambda p: str(p.relative_to(ROOT)))
class TestTheRouting:
    def test_the_file_exists(self, path):
        assert path.exists(), f"{path} is routed to but absent"

    def test_every_link_resolves(self, path):
        broken = []
        for target in links_in(path):
            resolved = (path.parent / target.split("#")[0]).resolve()
            if not resolved.exists():
                broken.append(target)
        assert broken == [], f"{path.relative_to(ROOT)} points at nothing: {broken}"


class TestTheRootContract:
    """AGENTS.md is loaded for every task, so its size is a running cost."""

    def test_it_stays_a_routing_document(self):
        lines = (ROOT / "AGENTS.md").read_text(encoding="utf-8").splitlines()
        assert len(lines) <= 160, (
            f"AGENTS.md is {len(lines)} lines. It is read on every task; put "
            "the detail in docs/architecture/ and a scoped rule file, and "
            "leave a pointer here.")

    def test_claude_defers_to_it_rather_than_copying_it(self):
        claude = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
        assert claude.lstrip().startswith("@AGENTS.md"), (
            "CLAUDE.md must import AGENTS.md rather than restating it")
        assert len(claude.splitlines()) <= 60

    def test_every_subsystem_an_agent_can_edit_has_a_scoped_file(self):
        for directory in ["src", "tools", "tests", "data", "docs", "pipeline",
                          ".github/workflows"]:
            assert (ROOT / directory / "AGENTS.md").exists(), (
                f"{directory}/ has no scoped agent file")

    def test_the_root_file_routes_to_each_of_them(self):
        text = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
        for directory in ["src", "tools", "tests", "data", "docs", "pipeline",
                          ".github/workflows"]:
            assert f"{directory}/AGENTS.md" in text, f"{directory} is unreachable"


class TestTheSkills:
    SKILLS = sorted((ROOT / ".claude" / "skills").glob("*/SKILL.md"))

    def test_there_are_some(self):
        assert len(self.SKILLS) >= 5

    @pytest.mark.parametrize("skill", SKILLS, ids=lambda p: p.parent.name)
    def test_each_declares_a_name_that_matches_its_directory(self, skill):
        text = skill.read_text(encoding="utf-8")
        assert text.startswith("---\n"), f"{skill} has no frontmatter"
        front = text.split("---", 2)[1]
        assert f"name: {skill.parent.name}\n" in front
        assert "description:" in front

    @pytest.mark.parametrize("skill", SKILLS, ids=lambda p: p.parent.name)
    def test_each_stays_a_procedure_rather_than_a_manual(self, skill):
        """A skill that has to be read in full every time it triggers is a
        second encyclopedia with a smaller audience."""
        lines = skill.read_text(encoding="utf-8").splitlines()
        assert len(lines) <= 110, f"{skill.parent.name} is {len(lines)} lines"


class TestTheDecisionIndex:
    INDEX = (ROOT / "docs" / "decisions" / "README.md").read_text(encoding="utf-8")
    RECORDS = sorted((ROOT / "docs" / "decisions").glob("ADR-*.md"))

    def test_every_record_is_in_the_numeric_table(self):
        missing = [p.name for p in self.RECORDS if p.name not in self.INDEX]
        assert missing == [], f"not indexed: {missing}"

    def test_every_record_is_routed_by_domain_or_named_superseded(self):
        """The routing half is what an agent reads first, so a record that is
        in neither list is a record nobody will find."""
        routing = self.INDEX[:self.INDEX.index("## Every record, in order")]
        unreachable = []
        for record in self.RECORDS:
            number = record.name.split("-")[1]
            if record.name in routing or f"ADR-{number}" in routing:
                continue
            unreachable.append(record.name)
        assert unreachable == [], f"reachable only by reading all 70: {unreachable}"

    def test_the_index_names_a_starting_record_for_each_domain(self):
        routing = self.INDEX[:self.INDEX.index("## Every record, in order")]
        domains = routing.count("\n### ")
        starts = routing.count("**Start with")
        assert domains >= 6
        assert starts == domains, "every domain heading needs a starting record"
