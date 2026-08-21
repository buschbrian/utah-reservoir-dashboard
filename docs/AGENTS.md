# Documentation rules (`docs/`)

- **Accepted architecture decision records are immutable.** Do not rewrite an
  ADR body to match later work, and do not repair its links. Add a successor,
  change only the old record's status, and update
  [`decisions/README.md`](decisions/README.md). Procedure:
  [`.claude/skills/adr/SKILL.md`](../.claude/skills/adr/SKILL.md).
- **`architecture/` is the only current description of how things work.** If
  behaviour changes, change it there.
- **`history/` and the banner-marked journals are evidence about a date**, not
  specifications. Never update a journal to describe today; write the change in
  `architecture/` instead.
- **`operations/` holds procedures** — one file per recurring job.
- **One authority per topic.** Before adding a document, find the one that
  already owns the topic and extend it. If agent-facing instructions need the
  same rule, they get one or two sentences and a link, never a copy.
- Visible product text follows Simplified Technical English (ADR-006). These
  documents are developer-facing and are not held to it, but published pages
  and anything quoted into them are.

Verify: documentation-only changes need `npm run verify:fast`;
`src/source-inventory.test.ts` reads `AUTHORITATIVE-SOURCE-INVENTORY.md`, and
`tests/test_docs_authority.py` checks that every link in the agent-facing files
resolves.
