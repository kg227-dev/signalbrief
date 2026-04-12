# Retrieval Eval Worklog

*Last reviewed: April 12, 2026*

This is the live operator summary for retrieval-evaluation work. The full March 2026 historical log is archived under [`../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md`](../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md).

## Purpose

Track the current retrieval-quality loop without mixing a large historical execution log into the live docs surface.

## Current Live Inputs

- admin surface: `/admin/retrieval-eval`
- runtime artifact mirror: [`../../data/retrieval-evals/worklog.md`](../../data/retrieval-evals/worklog.md)
- active validation bundle: [`../planning/reduced-scope-mvp-validation/README.md`](../planning/reduced-scope-mvp-validation/README.md)

## Current Working Conclusion

As of April 12, 2026 (Day 16), category expansion is still blocked, but the blocker has shifted. Day 16 delivered **35/35**, kept all **7/7 topics** at **5/5** and at **depth >=15**, and produced **284 retained candidates** after filtering, split across **267 publisher-feed** and **17 official** candidates. The detailed audit is archived at [`../archive/planning/2026-03/mvp-day-16-2026-04-12.md`](../archive/planning/2026-03/mvp-day-16-2026-04-12.md).

**Active issue - validator calibration now looks good; selector ranking is the main blocker.**
Day 16 attempted 35 writeups, passed **19/35 (54.3%)** on the first try, recovered **16/16** repairs, dropped **0/35**, preserved **23/23** strong-tier attempts, and recorded **no parse failures**. The run diagnosis flipped from Day 14 and Day 15's `parse_or_structured_output_failure` to **`selection_ranking_failure`**, with `low_trust_selection_mix` as the only secondary issue.

**Active issue - trusted share regressed below the expansion floor.**
Trusted Tier 1/2 share fell to **23/35 (65.7%)**, down from **28/35 (80.0%)** on Day 14 and **26/35 (74.3%)** on Day 15. That closes the three-run calibration window at **77/105 (73.3%)**, which misses the requirement to stay consistently above 75% and does not trend toward 80%.

**Active issue - Industrials and Consumer & Retail remain the weak-topic blockers.**
Industrials collapsed to **0/5 trusted** on a depth-healthy day, while Consumer & Retail stayed at **2/5 trusted** even with zero writeup drops. This is now clearly a trusted-first same-topic ranking and backfill problem, not a retrieval-depth or writeup-drop problem.

**Active issue - the writeup layer may now be too permissive, but it is not the first fix.**
Day 16 shipped **29 soft-fail recoveries** and **28 minimum-viable accepts** with **0 hard fails**. That is a major improvement over the prior validator wall, but it also means the selector is now operating over a large pool of borderline-but-shippable copy. Tightening that acceptance floor can wait until trusted selection quality is fixed.

The rolling readiness picture is still below launch quality even with healthy broker retrieval. The completed three-run calibration window closed at **77/105 trusted selections (73.3%)** and still includes a structurally weak 0/5-trusted lane, so retrieval backbone reliability is no longer the limiting factor; ranking quality in weak lanes is.

## Update Rules

- Update this file with the current live retrieval focus and routing only.
- Keep long pass-by-pass implementation history in the archive copy.
- Keep runtime/admin-readable mirrors in `data/retrieval-evals/` when the admin surface depends on them.
