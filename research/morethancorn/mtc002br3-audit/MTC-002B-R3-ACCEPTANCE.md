# MTC-002B-R3 independent acceptance

**Verdict: NOT ACCEPTED — do not start MTC-003 yet.**

Commit inspected: `10bb9fa`.

## What independently passes

1. **Triggered schedule-card semantics — pass.**
   Current UI evidence `01-live-workitem-card-semantics.png` shows schedule occurrences with a real `taskRunId` in `执行中`, `已完成`, and `需要操作` lanes. They display execution facts (`启动`, progress, duration) and `原计划`; they do not display `等待调度`. Source uses `hasExecution = w.taskRunId !== null` and reserves `等待调度` for an untriggered occurrence.
2. **Seed write boundary — pass.**
   `scripts/seed_workitems_demo.py` has a static allowlist of `wf_dev` and `wf_fixture`; the gate does not read `MTC_SEED_EXPECT_DB`. An independent run with `WF_DATABASE_URL=.../not_whitelisted` plus `MTC_SEED_EXPECT_DB=not_whitelisted` returned `REFUSE` before any possible seed transaction. `--list-legacy-only` is read-only and listed the preserved legacy fixture.
3. **Date contract — pass.**
   Both live `GET /api/work-items` and `GET /api/work-items/stream` return 422 for `dateFrom=2026-09-10&dateTo=2026-09-06`, with the same validation message. Both endpoints call the shared `parse_work_item_date_range` implementation.
4. **Targeted checks — pass.**
   R3 + seed-focused backend checks: 9 passed. Type check: passed. Frontend tests: 34 passed.

## Release blocker

The claimed full backend regression is not reproducible in the supplied worktree. Running the documented 11-file command produced **93 passed, 1 failed** after about five minutes:

```text
FAILED server/tests/test_mtc002b_r2.py::test_digest_date_switch
AssertionError: 锚定日变化不得影响其他日期 digest
```

The same test passes alone, so this is an order-/state-dependent regression test rather than proof that the R3 product behavior is wrong. It is still a release blocker: the work-item SSE digest must have a deterministic suite that demonstrates a change outside the selected business-day window cannot refresh that day's board.

## Required correction for the next rework

- Make the digest date-isolation test independently repeatable in the full 94-test command (reset the fixture state or isolate all facts visible to the digest); do not weaken/remove the assertion.
- Supply a fresh full-run result with 94 collected / 94 passed from the exact documented command.
- Re-run the existing R3 evidence gates without changing the scope: fired occurrence UI semantics, fixed seed allowlist, and list/stream date parity.

## Evidence limits

The screenshot confirms visible card language and lane placement; it cannot prove all execution paths or accessibility compliance. The seed refusal check was intentionally directed at a non-whitelisted database name and made no writes. No existing development fixture or legacy data was deleted during this audit.
