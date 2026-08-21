# Workflow rules (`.github/workflows/`)

**A workflow orchestrates tools; it does not contain pipeline logic.** Anything
with a decision in it belongs in a tested script:

| Concern | Owner |
|---|---|
| The daily refresh sequence, retries, reverts, staged file list | `scripts/refresh-daily.sh` |
| Which files the refresh publishes | `data/generated-files.json` |
| Issue titles and bodies for late/withdrawn feeds and late drought | `tools/feed_issue_report.py` |
| Local and CI verification | the `npm run verify:*` targets |

- **Local and CI must run the same commands.** If a job needs a step no
  contributor can run, extract it first.
- `gh` calls, permissions, concurrency and triggers are legitimately
  GitHub-specific and stay here.
- The deploy chains off a **successful** refresh, so a check that belongs
  before publication belongs in `refresh-daily.sh`, not after the push.
- Never widen `permissions` beyond what the job uses.

Verify: `npm run verify:pipeline` covers the extracted scripts;
`bash -n scripts/refresh-daily.sh` and `scripts/refresh-daily.sh --dry-run`
check the orchestration without writing anything.
