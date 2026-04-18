# Retrieval Eval Worklog

*Last reviewed: April 18, 2026*

This is the live operator summary for retrieval-evaluation work. The full March 2026 historical log is archived under [`../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md`](../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md).

## Purpose

Track the current retrieval-quality loop without mixing a large historical execution log into the live docs surface.

## Current Live Inputs

- admin surface: `/admin/retrieval-eval`
- runtime artifact mirror: [`../../data/retrieval-evals/worklog.md`](../../data/retrieval-evals/worklog.md)
- active validation bundle: [`../planning/reduced-scope-mvp-validation/README.md`](../planning/reduced-scope-mvp-validation/README.md)

## Current Working Conclusion

As of April 18, 2026 (Day 22), the three-run post-`f95130c83e7733a43a4c7dc011021d46f1cc02d2` calibration window has already completed, and the latest audit is archived at [`../archive/planning/2026-03/mvp-day-22-2026-04-18.md`](../archive/planning/2026-03/mvp-day-22-2026-04-18.md).

**Current status - still on track by the threshold metrics, but category expansion remains blocked.**
The Day 18-20 calibration window was strong enough to support expansion: **91/105 trusted Tier 1/2 selections (86.7%)**, **2/107 writeup drops (1.9%)**, **1/95 strong-tier drops (1.1%)**, and **105/105 fulfillment**. The latest Day 22 run still cleared the core thresholds at **31/35 trusted (88.6%)**, **2/37 writeup drops (5.4%)**, **2/33 strong-tier drops (6.1%)**, and **35/35 fulfillment**, but it was not clean enough to remove the block.

**Current blocker - parser/validator relapse plus a renewed weak Industrials lane.**
Day 22's primary diagnosis is **`parse_or_structured_output_failure`** with **2 `validator_mismatch` parse failures**, **2 hard fails**, and **2 dropped strong-tier writeups** across Healthcare and Technology. At the same time, **Industrials** regressed to **2/5 trusted**, which is materially worse than Day 20's **3/5** and Day 21's **4/5**.

**Current ranking picture - mostly healthy, but not uniformly clean.**
Technology, Financial Services, Healthcare, Life Sciences, and Energy all stayed at **5/5 trusted**, while **Consumer & Retail** remained acceptable at **4/5**. The remaining non-parser ranking issue is concentrated in **Industrials**, with a secondary cleanup need in **Consumer & Retail** where the audit still flags **`selection_prefers_weaker_story_shapes`**.

**Current caution - minimum-viable recovery remains heavy.**
Day 22 still relied on **30 minimum-viable accepts** and **31 soft fails**. That keeps the system above the operating floor, but it is not the profile to use for opening category expansion.

The correct read is that the calibration window succeeded, but the latest live run regressed. Expansion should stay blocked until the parser mismatch path is repaired and a new clean live run restores **0 parse failures**, **0 strong-tier drops**, and a healthier Industrials mix.

## Update Rules

- Update this file with the current live retrieval focus and routing only.
- Keep long pass-by-pass implementation history in the archive copy.
- Keep runtime/admin-readable mirrors in `data/retrieval-evals/` when the admin surface depends on them.
