#!/usr/bin/env bash
# The two Playwright suites, over a freshly built dist/.
#
# The build is not optional and not a convenience: both suites serve `dist/`,
# so a smoke run after an un-built edit tests the previous build -- reporting
# failures the working tree has already fixed, or passing work that never
# compiled.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [ ! -d node_modules/playwright ]; then
  echo "playwright is not installed. It is deliberately not a package" >&2
  echo "dependency, so an ordinary 'npm install' prunes it. Restore it with:" >&2
  echo "  npm install --no-save --no-package-lock playwright" >&2
  exit 1
fi

npx vite build
mkdir -p screenshots
node tests/smoke.mjs
node tests/smoke-modern.mjs
