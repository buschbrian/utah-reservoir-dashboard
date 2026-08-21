---
description: Python pipeline rules — module ownership, method versus schema version, freshness, provider boundaries
globs: ["*.py", "pipeline/**/*.py", "tools/**/*.py", "tests/**/*.py"]
---

Read [`pipeline/AGENTS.md`](../../pipeline/AGENTS.md) for the reservoir
pipeline, [`tools/AGENTS.md`](../../tools/AGENTS.md) for probes and builders,
and [`tests/AGENTS.md`](../../tests/AGENTS.md) for tests.

`refresh_reservoirs.py` is an orchestrator; the concerns live in `pipeline/`.
A change to what a number *means* is a method change: `METHOD_VERSION`, a
normals rebuild and an ADR — use the `science-method-change` skill. A change to
a field's shape is a schema version. They are not interchangeable.

Never hand-edit a generated payload. Verify with `npm run verify:pipeline`.
