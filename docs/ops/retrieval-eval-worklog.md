# Retrieval Eval Worklog

*Last reviewed: April 14, 2026*

This is the live operator summary for retrieval-evaluation work. The full March 2026 historical log is archived under [`../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md`](../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md).

## Purpose

Track the current retrieval-quality loop without mixing a large historical execution log into the live docs surface.

## Current Live Inputs

- admin surface: `/admin/retrieval-eval`
- runtime artifact mirror: [`../../data/retrieval-evals/worklog.md`](../../data/retrieval-evals/worklog.md)
- active validation bundle: [`../planning/reduced-scope-mvp-validation/README.md`](../planning/reduced-scope-mvp-validation/README.md)

## Current Working Conclusion

As of April 14, 2026 (Day 18), category expansion is still blocked, but the run rebounded sharply from Day 17. Day 18 delivered **35/35**, restored **7/7 depth-healthy topics**, and produced **350 retained candidates** after filtering, split across **341 publisher-feed** and **9 official** candidates. The detailed audit is archived at [`../archive/planning/2026-03/mvp-day-18-2026-04-14.md`](../archive/planning/2026-03/mvp-day-18-2026-04-14.md).

**Active issue - trusted share recovered, but consistency is not proven yet.**
Trusted Tier 1/2 share rebounded to **30/35 (85.7%)**, which is stronger than each Day 14-16 calibration day individually and well above the **77/105 (73.3%)** prior calibration-window aggregate. That is a strong single-day signal, but it does not erase Day 17's collapse or prove sustained consistency.

**Active issue - validator mismatch is back, though much smaller than before.**
Day 18 attempted **37 writeups**, passed **18/37 (48.6%)** on the first try, repaired **17/19**, dropped **2/37 (5.4%)**, preserved **30/31** strong-tier attempts, and recorded **2 parse failures**, both **`validator_mismatch`**. The writeup layer is no longer the main catastrophe, but it still costs good candidates.

**Active issue - Industrials is still the structural blocker.**
Industrials delivered **5/5** with **22 candidates** but only **2/5 trusted**, even with **0** topic-level writeup drops. That keeps the no-weak-topics gate failed and points to selector-side trusted-first ranking as the main user-visible issue.

**Active issue - ranking still leaves trusted supply unused in otherwise healthy lanes.**
Six of seven topic diagnoses reported **`trusted_pool_available_but_not_selected`**, including Technology and Consumer & Retail. The current blocker is not missing retrieval depth; it is failing to consistently convert trusted supply into the final basket in every lane.

The current readiness picture is better than both Day 17 and the Day 14-16 average, but it is still not expansion-ready. The next proof point is sustained >=75% trusted share without validator drops and without a structurally weak Industrials lane.

## Update Rules

- Update this file with the current live retrieval focus and routing only.
- Keep long pass-by-pass implementation history in the archive copy.
- Keep runtime/admin-readable mirrors in `data/retrieval-evals/` when the admin surface depends on them.
