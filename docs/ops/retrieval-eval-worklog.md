# Retrieval Eval Worklog

*Last reviewed: April 17, 2026*

This is the live operator summary for retrieval-evaluation work. The full March 2026 historical log is archived under [`../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md`](../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md).

## Purpose

Track the current retrieval-quality loop without mixing a large historical execution log into the live docs surface.

## Current Live Inputs

- admin surface: `/admin/retrieval-eval`
- runtime artifact mirror: [`../../data/retrieval-evals/worklog.md`](../../data/retrieval-evals/worklog.md)
- active validation bundle: [`../planning/reduced-scope-mvp-validation/README.md`](../planning/reduced-scope-mvp-validation/README.md)

## Current Working Conclusion

As of April 17, 2026 (Day 20), the system has **completed the three-run live calibration window** after validator commit `f95130c83e7733a43a4c7dc011021d46f1cc02d2`. The latest audit is archived at [`../archive/planning/2026-03/mvp-day-20-2026-04-17.md`](../archive/planning/2026-03/mvp-day-20-2026-04-17.md).

**Current status - calibration passed and the run is on track for expansion.**
Day 20 delivered **35/35**, kept **7/7 topics** at **5/5**, held **7/7 topics** at **depth >=15**, and landed **32/35 trusted Tier 1/2 selections (91.4%)**. The closed Day 18-20 calibration view finished at **91/105 (86.7%)**, which is above both the **75% floor** and the ideal **80%** target, and materially stronger than the prior Day 14-16 window at **77/105 (73.3%)**.

**Current status - writeup remains healthy enough for launch.**
Day 20 attempted **35** writeups, passed **18/35 (51.4%)** on the first try, recovered **17/17** repairs, dropped **0/35**, preserved **32/32** strong-tier attempts, posted a **0.0%** strong-tier drop rate, and recorded **no parse failures**. Across the full Day 18-20 window, writeup drops stayed at **2/107 (1.9%)** and strong-tier drop rate stayed at **1.1%**.

**Current blocker has narrowed from gating to prioritization.**
The run-level diagnosis is still **`selection_ranking_failure`**, with **19 missed-story flags** and **6 topics** still marked **`trusted_pool_available_but_not_selected`**. Consumer & Retail is now the clearest remaining weak lane at **4/5 trusted**, while Industrials improved to **4/5 trusted** and no longer looks structurally broken.

**Current caution - minimum-viable accepts remain elevated even though gating is green.**
Day 20 still shipped **27 minimum-viable accepts**, **26 soft fails**, and **0 hard fails**. That is acceptable for expansion readiness, but it means the next round of work should still focus on selector-side ranking, source-cap fallback, and story-shape choice before widening too aggressively.

The readiness picture is materially better than both the Day 17 regression and the prior Day 14-16 calibration window. Category expansion is no longer blocked by calibration metrics. The next operator posture should be controlled expansion with close monitoring of Consumer & Retail, Energy, Life Sciences, and Technology ranking quality.

## Update Rules

- Update this file with the current live retrieval focus and routing only.
- Keep long pass-by-pass implementation history in the archive copy.
- Keep runtime/admin-readable mirrors in `data/retrieval-evals/` when the admin surface depends on them.
