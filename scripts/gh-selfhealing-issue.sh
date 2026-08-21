#!/usr/bin/env bash
# Open, update or close one of the refresh's self-healing issues.
#
# The same six `gh` lines appeared three times in refresh-data.yml, once per
# condition, differing only in a label. The label, its colour and its
# description come from tools/feed_issue_report.py, so the words a reader sees
# and the label they are filed under change together.
#
#   scripts/gh-selfhealing-issue.sh open  stale "<title>" body.md
#   scripts/gh-selfhealing-issue.sh close stale "<comment>"
set -euo pipefail

action="$1"
kind="$2"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python_bin="$("$repo_root/scripts/python.sh")"

IFS=$'\t' read -r label colour description < <(
  "$python_bin" "$repo_root/tools/feed_issue_report.py" "$kind" --print-label)

existing() {
  gh issue list --state open --label "$label" --limit 1 \
    --json number --jq '.[0].number // empty'
}

case "$action" in
  open)
    title="$3"
    body_file="$4"
    # `|| true`: the label already exists on every run after the first, and a
    # condition recurring is not a failure.
    gh label create "$label" --color "$colour" --description "$description" 2>/dev/null || true
    number="$(existing)"
    if [ -n "$number" ]; then
      gh issue edit "$number" --title "$title" --body-file "$body_file"
      echo "Updated issue #$number"
    else
      gh issue create --title "$title" --body-file "$body_file" --label "$label"
    fi
    ;;
  close)
    comment="$3"
    number="$(existing)"
    if [ -n "$number" ]; then
      gh issue close "$number" --comment "$comment"
      echo "Closed issue #$number"
    else
      echo "Nothing open under $label."
    fi
    ;;
  *)
    echo "usage: $0 open|close <kind> ..." >&2
    exit 2
    ;;
esac
