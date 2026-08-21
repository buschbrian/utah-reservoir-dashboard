#!/usr/bin/env bash
# Resolve the interpreter every Python entry point in this repository uses.
#
# One place, because there are three plausible answers on a contributor's
# machine and only one of them is right on any given machine: the checked-out
# virtual environment if it exists (which is what `requirements-test.txt` was
# installed into), then `python3`, then `python`. CI has no `.venv` and lands
# on `python3`, which is the interpreter `actions/setup-python` provides.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -x "$repo_root/.venv/bin/python" ]; then
  echo "$repo_root/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  command -v python3
elif command -v python >/dev/null 2>&1; then
  command -v python
else
  echo "no Python interpreter found" >&2
  exit 1
fi
