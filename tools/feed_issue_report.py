"""Build the title and body of a self-healing refresh issue.

Three conditions open a GitHub issue, keep it updated while they last, and
close themselves when they stop being true: reservoir feeds that have gone
quiet, reservoirs withdrawn for out-of-season data, and a Drought Monitor
release that has not arrived.

The wording used to live in `refresh-data.yml` as three `printf` blocks. That
made a reader-facing explanation of ADR-056 unreviewable except by merging it,
untestable except by waiting for a feed to go quiet, and one indentation slip
away from being rendered as a Markdown code block -- which is why those blocks
were written with `printf` into a file rather than as a heredoc in the first
place. It is ordinary text with ordinary rules, so it belongs in Python with a
test beside it.

    python tools/feed_issue_report.py stale --count 3 --names "A, B" --table "|...|"
    python tools/feed_issue_report.py withdrawn --count 1 --names "C" --table "|...|"
    python tools/feed_issue_report.py drought --days 11 --release 2026-08-14 \
        --map-week 2026-08-11

Writes the title to stdout's first line and the body to `--body-file`, because
`gh issue create` takes them that way.
"""

import argparse
import datetime as dt
import os
import sys
from pathlib import Path

#: Where a reader is sent when the producer, not this pipeline, is the cause.
DROUGHT_MONITOR_URL = "https://droughtmonitor.unl.edu/"

#: The labels each condition maintains, with the colours the workflow creates
#: them under. Kept here so the label and the body that explains it are one
#: change rather than two.
LABELS = {
    "stale": ("stale-feed", "b45309",
              "A reservoir source stopped reporting on its expected cadence"),
    "withdrawn": ("withdrawn-feed", "b91c1c",
                  "A reservoir is too far out of date to publish beside the others"),
    "drought": ("late-drought", "730000",
                "The U.S. Drought Monitor has missed its weekly release"),
}


def _footer(checked: str) -> str:
    """The line every one of these issues ends with.

    A run link, because the next question after "is this still true?" is
    always "which run said so?", and an issue that updates itself otherwise
    gives no way to tell a fresh statement from a stale one.
    """
    server = os.environ.get("GITHUB_SERVER_URL")
    repository = os.environ.get("GITHUB_REPOSITORY")
    run_id = os.environ.get("GITHUB_RUN_ID")
    if server and repository and run_id:
        return (f"Last checked {checked} · "
                f"[refresh run]({server}/{repository}/actions/runs/{run_id})")
    return f"Last checked {checked}"


def stale_report(count: str, names: str, table: str, checked: str) -> tuple[str, str]:
    title = f"Reservoir feeds have gone quiet ({names})"
    body = "\n\n".join([
        f"The refresh found **{count}** reservoir(s) later than their expected "
        "source cadence.",
        table,
        "A reservoir lands here when its newest reading exceeds its cadence "
        "threshold (2 days for daily data; 45 days for month-end data), or when "
        "the refresh cannot reach its source. Its last known value is still "
        "published and drawn on the map, marked late — it is not presented as "
        "current. Past 60 days it stops being published at all and moves to the "
        "withdrawn-feed issue (ADR-056).",
        "This issue is maintained automatically: it updates on every refresh "
        "and closes itself once every feed is reporting again.",
        _footer(checked),
    ])
    return title, body + "\n"


def withdrawn_report(count: str, names: str, table: str, checked: str) -> tuple[str, str]:
    title = f"Reservoirs withdrawn for out-of-season data ({names})"
    body = "\n\n".join([
        f"The refresh withdrew **{count}** reservoir(s) from the published "
        "payload. They are **not on the map, not in the list, and not in any "
        "total.**",
        table,
        "A reservoir lands here when its newest reading is more than 60 days "
        "old. Being late and being from another season are different faults, "
        "and the second one is not fixed by a label: a spring reading standing "
        "in an August column is an accurate measurement of spring, and the "
        "regional storage total sums current storage with no freshness filter, "
        "so a carried-forward figure would be added into a total presented as "
        "now. See ADR-056.",
        "**What to decide:** whether the source is coming back, or whether the "
        "reservoir needs re-sourcing or retiring from the roster. Nothing is "
        "deleted — a withdrawn reservoir returns on its own the morning its "
        "source resumes, because the roster it is read from is committed and "
        "this judgement is made fresh on every run.",
        "This issue is maintained automatically: it updates on every refresh "
        "and closes itself once every reservoir is inside the publication "
        "window again.",
        _footer(checked),
    ])
    return title, body + "\n"


def drought_report(days: str, release: str, map_week: str,
                   checked: str) -> tuple[str, str]:
    title = f"The Drought Monitor has not published for {days} days"
    body = "\n\n".join([
        f"The newest drought map this project holds describes the week of "
        f"**{map_week}** and was released on **{release}**, which is **{days}** "
        "days ago.",
        "A new map is normally published every Thursday. The drought page keeps "
        "showing this one and states its age, so nothing is presented as more "
        "current than it is — but the figures stop tracking conditions on the "
        "ground while this is open.",
        f"Check the producer at {DROUGHT_MONITOR_URL} before assuming this is a "
        "fault in this pipeline.",
        _footer(checked),
    ])
    return title, body + "\n"


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=sorted(LABELS))
    parser.add_argument("--count", default="0")
    parser.add_argument("--names", default="")
    parser.add_argument("--table", default="")
    parser.add_argument("--days", default="0")
    parser.add_argument("--release", default="")
    parser.add_argument("--map-week", dest="map_week", default="")
    parser.add_argument("--checked", default=None,
                        help="override the timestamp, for tests")
    parser.add_argument("--body-file", default=None,
                        help="where to write the body (default: stderr-free stdout "
                             "after the title line)")
    parser.add_argument("--print-label", action="store_true",
                        help="print 'name colour description' for the label this "
                             "condition maintains, and exit")
    args = parser.parse_args(argv)

    if args.print_label:
        name, colour, description = LABELS[args.kind]
        print(f"{name}\t{colour}\t{description}")
        return 0

    checked = args.checked or _now()
    if args.kind == "stale":
        title, body = stale_report(args.count, args.names, args.table, checked)
    elif args.kind == "withdrawn":
        title, body = withdrawn_report(args.count, args.names, args.table, checked)
    else:
        title, body = drought_report(args.days, args.release, args.map_week, checked)

    print(title)
    if args.body_file:
        Path(args.body_file).write_text(body, encoding="utf-8")
    else:
        print()
        print(body, end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
