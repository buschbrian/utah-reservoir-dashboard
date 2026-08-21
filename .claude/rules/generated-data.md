---
description: Which data files are generated, which are reviewed by hand, and what may be edited
globs: ["data/**", "*.json"]
---

Read [`data/AGENTS.md`](../../data/AGENTS.md). The machine-readable owner table
is [`data/generated-files.json`](../../data/generated-files.json), enforced by
`tests/test_generated_files.py`.

**Never hand-edit a generated file** — change its writer and run it. The
`admitted_*.json` rosters are the exception: they are reviewed evidence, edited
by a person, and every waiver needs a stated reason or the loader refuses the
file.

Payload cost is measured gzipped, never raw (ADR-051).
