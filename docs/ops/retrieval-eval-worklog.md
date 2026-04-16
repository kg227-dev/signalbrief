# Retrieval Eval Worklog

*Last reviewed: April 16, 2026*

This is the live operator summary for retrieval-evaluation work. The full March 2026 historical log is archived under [`../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md`](../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md).

## Purpose

Track the current retrieval-quality loop without mixing a large historical execution log into the live docs surface.

## Current Live Inputs

- admin surface: `/admin/retrieval-eval`
- runtime artifact mirror: [`../../data/retrieval-evals/worklog.md`](../../data/retrieval-evals/worklog.md)
- active validation bundle: [`../planning/reduced-scope-mvp-validation/README.md`](../planning/reduced-scope-mvp-validation/README.md)

## Current Working Conclusion

As of April 16, 2026 (Day 20), the system has completed the **third of three live calibration runs** after validator commit `f95130c83e7733a43a4c7dc011021d46f1cc02d2`. The latest audit is archived at [`../archive/planning/2026-03/mvp-day-20-2026-04-16.md`](../archive/planning/2026-03/mvp-day-20-2026-04-16.md).

**Current status - on track for expansion, and the calibration window is complete.**
Day 20 delivered **35/35**, kept **7/7 topics** at **5/5**, held **7/7 topics** at **depth >=15**, and landed **33/35 trusted Tier 1/2 selections (94.3%)**. The rolling Day 18-20 calibration view is **92/105 (87.6%)**, which is above both the **75% floor** and the ideal **80%** target.

**Current status - writeup is healthy enough for expansion.**
Day 20 attempted **35** writeups, passed **18/35 (51.4%)** on the first try, recovered **17/17** repairs, dropped **0/35**, preserved **33/33** strong-tier attempts, posted a **0.0%** strong-tier drop rate, and recorded **no parse failures**. The writeup layer is no longer the blocker.

**Current blocker - ranking still wastes trusted supply in the marginal slots.**
The run-level diagnosis is still **`selection_ranking_failure`**. All **7 topics** were flagged with **`trusted_pool_available_but_not_selected`**, there were **21 missed-story flags**, and the weakest lane, **Industrials**, still finished only **3/5 trusted** while admitting a standard Manufacturing Dive item and an FDA official page.

**Current caution - minimum-viable accepts remain elevated even though the top-line gates passed.**
Day 20 still shipped **27 minimum-viable accepts**, **28 soft fails**, and **0 hard fails**. That is acceptable for expansion because fulfillment, trust share, and writeup reliability all cleared the gates, but it still means the next fix cycle should focus on ranking quality rather than adding supply.

The current readiness picture is materially better than the Day 17 regression and strong enough to move forward. Calibration no longer blocks category expansion. The immediate post-expansion work should prioritize Industrials ranking first, then source-cap and pool-cut behavior in Technology and Consumer & Retail.

## Update Rules

- Update this file with the current live retrieval focus and routing only.
- Keep long pass-by-pass implementation history in the archive copy.
- Keep runtime/admin-readable mirrors in `data/retrieval-evals/` when the admin surface depends on them.
