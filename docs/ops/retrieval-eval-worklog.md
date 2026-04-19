# Retrieval Eval Worklog

*Last reviewed: April 19, 2026*

This is the live operator summary for retrieval-evaluation work. The full March 2026 historical log is archived under [`../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md`](../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md).

## Purpose

Track the current retrieval-quality loop without mixing a large historical execution log into the live docs surface.

## Current Live Inputs

- admin surface: `/admin/retrieval-eval`
- runtime artifact mirror: [`../../data/retrieval-evals/worklog.md`](../../data/retrieval-evals/worklog.md)
- active validation bundle: [`../planning/reduced-scope-mvp-validation/README.md`](../planning/reduced-scope-mvp-validation/README.md)

## Current Working Conclusion

As of April 19, 2026 (Day 20), the post-`f95130c83e7733a43a4c7dc011021d46f1cc02d2` calibration window is **complete**, and the latest audit is archived at [`../archive/planning/2026-03/mvp-day-20-2026-04-19.md`](../archive/planning/2026-03/mvp-day-20-2026-04-19.md).

**Current status - not on track for expansion, and category expansion remains blocked.**
Day 20 still delivered **35/35**, kept **7/7 topics** at **5/5**, and held **7/7 topics** at **depth >=15**, but trust fell to **21/35 trusted Tier 1/2 selections (60.0%)**. The rolling Day 18-20 calibration view finished at **80/105 (76.2%)**, which only clears the floor because Day 18 and Day 19 were strong; the final live run itself missed the **75%** consistency gate badly.

**Current status - writeup remains healthy enough for launch.**
Day 20 attempted **36** writeups, passed **17/36 (47.2%)** on the first try, recovered **19/19** repairs, dropped **0/36**, preserved **21/21** strong-tier attempts, posted a **0.0%** strong-tier drop rate, and recorded **no parse failures**. The blocker is not validator fragility.

**Current blocker - ranking and source mix regressed in weak lanes.**
The run-level diagnosis stayed **`selection_ranking_failure`** with secondary **`low_trust_selection_mix`**. Industrials collapsed to **0/5 trusted** and Consumer & Retail slipped to **1/5 trusted**, while both lanes still had healthy candidate depth and zero writeup loss. The clearest failure mode is topic-fit and source-mix selection, not retrieval or writeup.

**Current caution - minimum-viable accepts remain too high for a low-trust basket.**
Day 20 still shipped **31 minimum-viable accepts**, **28 soft fails**, and **0 hard fails**. That is manageable when trust is healthy, but not when the final basket already missed the trust floor and introduced structurally weak topics.

The current readiness picture is mixed: fulfillment and writeup are stable, but the three-run calibration window did not finish with consistent trust. Expansion should stay blocked until Industrials and Consumer & Retail stop shipping low-trust baskets and the next live runs hold **>=75%** trusted share without structurally weak lanes.

## Update Rules

- Update this file with the current live retrieval focus and routing only.
- Keep long pass-by-pass implementation history in the archive copy.
- Keep runtime/admin-readable mirrors in `data/retrieval-evals/` when the admin surface depends on them.
