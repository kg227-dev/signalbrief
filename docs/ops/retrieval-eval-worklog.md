# Retrieval Eval Worklog

*Last reviewed: April 5, 2026*

This is the live operator summary for retrieval-evaluation work. The full March 2026 historical log is archived under [`../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md`](../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md).

## Purpose

Track the current retrieval-quality loop without mixing a large historical execution log into the live docs surface.

## Current Live Inputs

- admin surface: `/admin/retrieval-eval`
- runtime artifact mirror: [`../../data/retrieval-evals/worklog.md`](../../data/retrieval-evals/worklog.md)
- active validation bundle: [`../planning/reduced-scope-mvp-validation/README.md`](../planning/reduced-scope-mvp-validation/README.md)

## Current Working Conclusion

As of April 5, 2026 (Day 9), delivery is mechanically stable (7/7 topics passing, 6/7 at full 5) but the writeup system and source-diversity failures are the two active blockers:

**Blocker 1 — `provider_parse_failure` is dominating writeup drops.**
40 of 69 Day 9 writeup drops cite this reason. The highest-scoring candidate in the entire run (wired.com, 0.984) failed on it. The repair pass has recovered 0 stories across two consecutive days (29 Day 9 attempts, 26 Day 8 attempts). Fix the parse failure root cause before any other writeup work.

**Blocker 2 — Source monopoly in Financial Services and Life Sciences.**
Financial Services: marketwatch.com took all 5 slots at 0.384–0.415 confidence while three strong americanbanker.com stories (FCC enforcement, Coinbase OCC charter, March jobs) were pool-cut. Life Sciences: fda.gov holds all 4 delivered slots for the second consecutive Saturday. Both failures are consequences of Blocker 1 — strong stories fail to write up and the selector fills with whatever survives.

**Persistent true misses (same stories suppressed two consecutive days):**
- "Trump revives pharma tariffs with 100% charges" (biopharmadive.com) — `provider_parse_failure`
- "White House seeks 12% funding cut to HHS" (modernhealthcare.com) — `provider_parse_failure`

**Trusted share:** 12/34 (35%) on Day 9, flat vs Day 8's 31.4%. Not improving without writeup fix.

Prior working conclusions (operational uptime, broker backbone, freshness) are resolved and no longer the focus.

## Update Rules

- Update this file with the current live retrieval focus and routing only.
- Keep long pass-by-pass implementation history in the archive copy.
- Keep runtime/admin-readable mirrors in `data/retrieval-evals/` when the admin surface depends on them.
