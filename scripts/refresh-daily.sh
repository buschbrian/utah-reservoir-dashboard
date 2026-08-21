#!/usr/bin/env bash
# The daily data refresh, in one runnable, readable place.
#
# This lived in refresh-data.yml, which meant the only way to see what the
# morning does -- and the only way to change it -- was to read YAML, and the
# only way to test a change was to merge it and wait a day. The workflow now
# calls this script and keeps what is genuinely GitHub's: triggers,
# permissions, concurrency, and the `gh` calls that maintain the issues.
#
#   scripts/refresh-daily.sh            # the whole job
#   scripts/refresh-daily.sh --dry-run  # print the plan and the published
#                                       # file list; fetch nothing, write
#                                       # nothing, commit nothing
#
# Every stage is independent on purpose: a provider outage costs that
# provider's file for a day and never the others'. Nothing is deleted on a bad
# morning -- the previous verified file stays, and the page says how old it is.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

python_bin="$("$repo_root/scripts/python.sh")"
manifest="data/generated-files.json"
dry_run=0
[ "${1:-}" = "--dry-run" ] && dry_run=1

# The published set, read from the manifest rather than retyped here. A file
# that is computed every morning and committed on none of them is invisible
# until a reader lands on it: usdm-huc4.json spent its first week that way.
published_files() {
  "$python_bin" - "$manifest" <<'PY'
import json, sys
manifest = json.load(open(sys.argv[1], encoding="utf-8"))
for entry in manifest["files"]:
    if entry["staged_by_refresh"]:
        print(entry["path"])
PY
}

note() { printf '%s\n' "$*"; }
warn() {
  # A GitHub annotation when there is a workflow to annotate, a plain line
  # otherwise, so the same script reads correctly in a terminal.
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    printf '::warning title=%s::%s\n' "$1" "$2"
  else
    printf 'WARNING: %s: %s\n' "$1" "$2"
  fi
}

if [ "$dry_run" = 1 ]; then
  note "Refresh plan, in order:"
  note "  1. reservoirs      $python_bin refresh_reservoirs.py (3 attempts, 1/3/9 min)"
  note "  2. drought polygons $python_bin tools/fetch_drought_monitor.py"
  note "  3. drought coverage $python_bin tools/compute_drought_coverage.py, every offered level"
  note "  4. pair check       $python_bin tools/check_drought_pair.py"
  note "  5. snow             $python_bin refresh_snowpack.py"
  note "  6. commit the published set:"
  published_files | sed 's/^/       /'
  exit 0
fi

# 1. Reservoirs. The script already retries each HTTP request; this is the
# retry for a failure that takes the whole run down (a provider down for a
# minute, more than half the reservoirs unreachable). Three attempts backing
# off 1/3/9 minutes, all well inside a daily schedule.
refresh_reservoirs() {
  local attempt delay
  for attempt in 1 2 3; do
    note "::group::Refresh attempt $attempt"
    if "$python_bin" refresh_reservoirs.py; then
      note "::endgroup::"
      return 0
    fi
    note "::endgroup::"
    if [ "$attempt" -lt 3 ]; then
      delay=$((60 * 3 ** (attempt - 1)))
      warn "Refresh retry" "Attempt $attempt failed; retrying in ${delay}s"
      sleep "$delay"
    fi
  done
  return 1
}

if ! refresh_reservoirs; then
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    printf '::error title=Refresh failed::All 3 attempts failed; reservoirs.json left untouched\n'
  fi
  echo "All 3 attempts failed; reservoirs.json left untouched" >&2
  exit 1
fi

# 2. Drought polygons. The monitor changes weekly, and an interruption here
# must not block current reservoir readings.
if ! "$python_bin" tools/fetch_drought_monitor.py; then
  warn "Drought download failed" "Keeping the last verified GeoJSON"
fi

# 3. Coverage, once per offered level (ADR-064). Both are computed from the one
# download, so either failing means both are suspect and the polygons go back:
# a reader who changes the level must never cross a week boundary doing it. The
# archive is one level, which is what --no-history says here and what
# merge_history refuses to have otherwise.
#
# Recomputed every day rather than only when the download reports a change: it
# is deterministic, carries no timestamps, and takes about a minute, so a
# coverage file that somehow fell behind is repaired by the next run instead of
# waiting for someone to notice.
if ! "$python_bin" tools/compute_drought_coverage.py \
   || ! "$python_bin" tools/compute_drought_coverage.py --scope west-huc4 --no-history \
   || ! "$python_bin" tools/compute_drought_coverage.py --scope west-huc2 --no-history; then
  warn "Coverage failed" "Reverting the polygons so the set stays on one week"
  git checkout -- data/drought/usdm-current.geojson
fi

# 4. Belt and braces, and cheap. If the files disagree for any reason the
# stages above have not thought of, all of them go back to the last commit
# where they agreed. Publishing yesterday's drought week is a small, honest
# loss; publishing two different weeks is a broken page.
if ! "$python_bin" tools/check_drought_pair.py; then
  warn "Drought files mismatched" "Restoring all of them from the last commit"
  git checkout -- data/drought/usdm-current.geojson \
    data/drought/usdm-huc6.json data/drought/usdm-huc4.json \
    data/drought/usdm-huc2.json
fi

# 5. Snow has its own payload and its own failure mode. The reviewed inventory
# is committed; a short provider response is retried one station at a time and
# never replaces the last complete file.
if ! "$python_bin" refresh_snowpack.py; then
  warn "Snow download failed" "Keeping the last complete snow payload"
fi

# 6. Commit. Every published file is staged together, which is what keeps the
# drought files describing one week in the commit as well as in the working
# tree.
if [ "${REFRESH_SKIP_COMMIT:-0}" = "1" ]; then
  note "REFRESH_SKIP_COMMIT=1: leaving the working tree uncommitted."
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"

# shellcheck disable=SC2046  # deliberate word splitting: one path per line
git add $(published_files | tr '\n' ' ')

if git diff --cached --quiet; then
  note "No data changes today."
  exit 0
fi

git commit -m "Daily reservoir data refresh"

# The push can lose a race with another workflow committing to the same
# branch; rebase and retry rather than failing the run and throwing away a
# good pull.
for attempt in 1 2 3; do
  if git push; then exit 0; fi
  note "Push rejected (attempt $attempt); rebasing onto the remote."
  git pull --rebase origin "${GITHUB_REF_NAME:-main}" || true
  sleep $((attempt * 5))
done
exit 1
