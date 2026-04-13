# Retrieval Eval Worklog

*Last reviewed: April 13, 2026*

This is the live operator summary for retrieval-evaluation work. The full March 2026 historical log is archived under [`../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md`](../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md).

## Purpose

Track the current retrieval-quality loop without mixing a large historical execution log into the live docs surface.

## Current Live Inputs

- admin surface: `/admin/retrieval-eval`
- runtime artifact mirror: [`../../data/retrieval-evals/worklog.md`](../../data/retrieval-evals/worklog.md)
- active validation bundle: [`../planning/reduced-scope-mvp-validation/README.md`](../planning/reduced-scope-mvp-validation/README.md)

## Current Working Conclusion

As of April 13, 2026 (Day 17), category expansion is still blocked and the run regressed below the already-failed Day 14-16 calibration window. Day 17 delivered only **33/35**, with **Consumer & Retail underfilling to 3/5**, and produced just **128 retained candidates** after filtering, split across **123 publisher-feed** and **5 official** candidates. The detailed audit is archived at [`../archive/planning/2026-03/mvp-day-17-2026-04-13.md`](../archive/planning/2026-03/mvp-day-17-2026-04-13.md).

**Active issue - writeup remains healthy, but supply quality worsened.**
Day 17 attempted 33 writeups, passed **17/33 (51.5%)** on the first try, recovered **16/16** repairs, dropped **0/33**, preserved **14/14** strong-tier attempts, and recorded **no parse failures**. The validator remains good enough; the current failure is upstream of writeup loss.

**Active issue - retrieval thinness is now the primary blocker.**
The run diagnosis moved to **`retrieval_thinness`** with **`selection_ranking_failure`** secondary. Only **3/7 topics** stayed at **depth >=15**, while Healthcare, Life Sciences, Industrials, and Consumer & Retail all ran thin.

**Active issue - trusted share collapsed and weak topics remain structurally bad.**
Trusted Tier 1/2 share fell to **14/33 (42.4%)**, far below both the **Day 14-16 calibration-window aggregate of 77/105 (73.3%)** and the expansion floor of 75%. Industrials stayed at **0/5 trusted**, Consumer & Retail fell to **0/3 trusted** with an underfill, and Financial Services regressed to **1/5 trusted** despite healthy candidate depth.

**Active issue - minimum-viable accepts are masking poor supply.**
Day 17 still shipped **26 soft-fail recoveries** and **26 minimum-viable accepts** with **0 hard fails**. That kept the run from dropping items in writeup, but it did not make the final baskets trustworthy enough for expansion.

The current readiness picture is clearly worse than the calibration window. The validator fix held, but supply and source mix did not: the system is now failing on thin retrieval in four topics, one topic underfilled, and trusted share is nowhere near the required launch bar.

## Update Rules

- Update this file with the current live retrieval focus and routing only.
- Keep long pass-by-pass implementation history in the archive copy.
- Keep runtime/admin-readable mirrors in `data/retrieval-evals/` when the admin surface depends on them.
