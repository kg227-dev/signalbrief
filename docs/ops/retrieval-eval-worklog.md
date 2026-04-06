# Retrieval Eval Worklog

*Last reviewed: April 6, 2026*

This is the live operator summary for retrieval-evaluation work. The full March 2026 historical log is archived under [`../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md`](../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md).

## Purpose

Track the current retrieval-quality loop without mixing a large historical execution log into the live docs surface.

## Current Live Inputs

- admin surface: `/admin/retrieval-eval`
- runtime artifact mirror: [`../../data/retrieval-evals/worklog.md`](../../data/retrieval-evals/worklog.md)
- active validation bundle: [`../planning/reduced-scope-mvp-validation/README.md`](../planning/reduced-scope-mvp-validation/README.md)

## Current Working Conclusion

As of April 6, 2026 (Day 10), the run delivered 24/35 items — the worst count in the validation run. Two distinct failure modes are now active simultaneously and must be addressed separately.

**Blocker 1 — Fetch-level pool collapse in five of seven topics.**
Total candidates fell to 100 (vs 228 on Day 9). Consumer & Retail had 3 candidates, Life Sciences had 2. No writeup or selection fix resolves a topic with 2 candidates for a 5-item fill. The collapse likely reflects reduced Sunday publisher volume combined with a broker feed or discovery scheduling gap — but this needs verification against scheduler and fetch logs before attributing it to editorial config. Life Sciences and Consumer & Retail need fetch-level coverage fixes independent of everything else.

**Blocker 2 — `provider_parse_failure` still dominating writeup drops.**
14 of 17 Day 10 drops cite this reason. modernhealthcare.com and statnews.com are both affected; Healthcare delivered 1/5 as a direct result. The repair pass finally showed recovery (6/9 = 66.7%), the first non-zero repair rate after 0/29 on Day 9 and 0/26 on Day 8 — fix the root cause before assuming repair is enough.

**New failure — selection bypassing top-scored candidate.**
The highest-scoring Financial Services candidate (americanbanker.com, score=1.0) was marked `selection_not_selected` while 8 lower-quality items were routed to writeup. This is a selection-ordering or pool-routing bug separate from the writeup gate.

**Trusted share:** 2/24 (8.3%) on Day 10, down from 35% on Day 9. The collapse reflects both pool thinness and the parse-failure cascade across premium trade sources.

Prior working conclusions (operational uptime, broker backbone, freshness) are resolved and no longer the focus.

## Update Rules

- Update this file with the current live retrieval focus and routing only.
- Keep long pass-by-pass implementation history in the archive copy.
- Keep runtime/admin-readable mirrors in `data/retrieval-evals/` when the admin surface depends on them.
