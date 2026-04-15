# Retrieval Eval Worklog

*Last reviewed: April 15, 2026*

This is the live operator summary for retrieval-evaluation work. The full March 2026 historical log is archived under [`../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md`](../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md).

## Purpose

Track the current retrieval-quality loop without mixing a large historical execution log into the live docs surface.

## Current Live Inputs

- admin surface: `/admin/retrieval-eval`
- runtime artifact mirror: [`../../data/retrieval-evals/worklog.md`](../../data/retrieval-evals/worklog.md)
- active validation bundle: [`../planning/reduced-scope-mvp-validation/README.md`](../planning/reduced-scope-mvp-validation/README.md)

## Current Working Conclusion

As of April 15, 2026 (Day 19), the system is in the **second of three live calibration runs** after validator commit `f95130c83e7733a43a4c7dc011021d46f1cc02d2`. The latest audit is archived at [`../archive/planning/2026-03/mvp-day-19-2026-04-15.md`](../archive/planning/2026-03/mvp-day-19-2026-04-15.md).

**Current status - on track for expansion, but still blocked pending the third calibration run.**
Day 19 delivered **35/35**, kept **7/7 topics** at **5/5**, held **7/7 topics** at **depth >=15**, and landed **29/35 trusted Tier 1/2 selections (82.9%)**. Together with Day 18's **30/35 (85.7%)**, the rolling Day 18-19 calibration view is **59/70 (84.3%)**, which is above both the **75% floor** and the ideal **80%** target.

**Current status - writeup is healthy enough for launch.**
Day 19 attempted **35** writeups, passed **14/35 (40.0%)** on the first try, recovered **21/21** repairs, dropped **0/35**, preserved **31/31** strong-tier attempts, posted a **0.0%** strong-tier drop rate, and recorded **no parse failures**. The remaining blocker is not validator fragility.

**Current blocker - ranking is still choosing weaker shapes despite healthy supply.**
The run-level diagnosis is **`selection_ranking_failure`**. All **7 topics** were flagged with **`trusted_pool_available_but_not_selected`**, there were **21 missed-story flags**, and the weakest lane, **Industrials**, still finished only **3/5 trusted** while admitting a low-score Federal Register item.

**Current caution - minimum-viable accepts remain elevated.**
Day 19 still shipped **26 minimum-viable accepts**, **23 soft fails**, and **0 hard fails**. That is acceptable during calibration, but it means the last-mile ranking and story-shape choices still need work before expansion is unlocked.

The current readiness picture is materially better than the Day 17 regression. The validator path is now stable, fulfillment is stable, and trust is above target across the first two calibration runs. Category expansion should remain blocked until Day 20 confirms the same pattern and Industrials stops being the weakest quality lane.

## Update Rules

- Update this file with the current live retrieval focus and routing only.
- Keep long pass-by-pass implementation history in the archive copy.
- Keep runtime/admin-readable mirrors in `data/retrieval-evals/` when the admin surface depends on them.
