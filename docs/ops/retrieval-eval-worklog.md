# Retrieval Eval Worklog

*Last reviewed: May 5, 2026*

This is the live operator summary for retrieval-evaluation work. The full March 2026 historical log is archived under [`../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md`](../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md).

## Purpose

Track the current retrieval-quality loop without mixing a large historical execution log into the live docs surface.

## Current Live Inputs

- admin surface: `/admin/retrieval-eval`
- runtime artifact mirror: [`../../data/retrieval-evals/worklog.md`](../../data/retrieval-evals/worklog.md)
- active validation bundle: [`../planning/reduced-scope-mvp-validation/README.md`](../planning/reduced-scope-mvp-validation/README.md)

## Current Working Conclusion

As of May 5, 2026 (Day 21), the latest audit is archived at [`../archive/planning/2026-03/mvp-day-21-2026-05-05.md`](../archive/planning/2026-03/mvp-day-21-2026-05-05.md).

**Current status - Healthcare and Life Sciences are on track, but the run is still blocked overall by ranking.**
Day 21 delivered **35/35**, kept **7/7 topics** at **5/5**, held **7/7 topics** at **depth >=15**, and landed **31/35 trusted Tier 1/2 selections (88.6%)**. That is a sharp recovery from Day 20's **21/35 (60.0%)**, but the audit still stayed red because the ranking layer left stronger trusted stories unselected across the broader basket.

**Current status - writeup is healthy enough for launch.**
Day 21 attempted **35** writeups, passed **19/35 (54.3%)** on the first try, recovered **16/16** repairs, dropped **0/35**, preserved **32/32** strong-tier attempts, posted a **0.0%** strong-tier drop rate, and recorded **no parse failures**. The current blocker is not validator fragility.

**Current focus - Healthcare and Life Sciences only.**
Healthcare shipped **5/5 trusted**, **3/5 first-pass**, **2/2 repairs**, **0 drops**, **5 / 5 / 0** strong-tier attempted/selected/dropped, **2** minimum-viable accepts, **0 hard fails / 4 soft fails**, and **no parse failures**. Life Sciences also shipped **5/5 trusted**, **3/5 first-pass**, **2/2 repairs**, **0 drops**, **5 / 5 / 0** strong-tier attempted/selected/dropped, **4** minimum-viable accepts, **0 hard fails / 4 soft fails**, and **no parse failures**.

**Current blocker - selection ranking is still the run-level diagnosis even in the focus topics.**
The audit marked Day 21 as **`selection_ranking_failure`**, and both Healthcare and Life Sciences were still tagged **`trusted_pool_available_but_not_selected`** with **3 missed-story flags each**. Both topics are on track, but ranking and pool-cut behavior still need to be tightened before the run can be treated as fully clean.

## Update Rules

- Update this file with the current live retrieval focus and routing only.
- Keep long pass-by-pass implementation history in the archive copy.
- Keep runtime/admin-readable mirrors in `data/retrieval-evals/` when the admin surface depends on them.
