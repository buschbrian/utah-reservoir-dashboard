#!/usr/bin/env bash
# Everything the Python side must pass. Identical to the CI job's command, so a
# green run here is a green job there.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python_bin="$("$repo_root/scripts/python.sh")"

cd "$repo_root"
echo "Python tests: $python_bin -m pytest tests/"
exec "$python_bin" -m pytest tests/ "$@"
