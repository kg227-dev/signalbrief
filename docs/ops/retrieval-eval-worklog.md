# Retrieval Eval Worklog

*Last reviewed: April 9, 2026*

This is the live operator summary for retrieval-evaluation work. The full March 2026 historical log is archived under [`../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md`](../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md).

## Purpose

Track the current retrieval-quality loop without mixing a large historical execution log into the live docs surface.

## Current Live Inputs

- admin surface: `/admin/retrieval-eval`
- runtime artifact mirror: [`../../data/retrieval-evals/worklog.md`](../../data/retrieval-evals/worklog.md)
- active validation bundle: [`../planning/reduced-scope-mvp-validation/README.md`](../planning/reduced-scope-mvp-validation/README.md)

## Current Working Conclusion

As of April 9, 2026 (Day 13), the run is still mechanically healthy but not exit-green: 35/35 delivered, 7/7 topics full and above depth-15, 610 total candidates after story-relationship filtering, 698/698 broker fetch items passed, and 0 writeup-driven underfills. Trusted share improved to 71.4% (25/35) from Day 12's 62.9% (22/35), but it is still below the 80% MVP target. The detailed audit is archived at [`../archive/planning/2026-03/mvp-day-13-2026-04-09.md`](../archive/planning/2026-03/mvp-day-13-2026-04-09.md).

**Active issue - the writeup validator is the main blocker now.**
Day 13 attempted 178 writeups and dropped 143 of them, all under `validator_mismatch`. First-pass success was only 15/178 (8.4%), repair success was 19/112 (17.0%), and strong trade-source items were lost across every topic. Retrieval is healthy; the generation-validator contract is not.

**Active issue - weak-tier backfill is still too permissive after writeup loss.**
Industrials finished 0/5 trusted and Consumer & Retail finished 1/5 trusted even though both topic pools were entirely trusted before writeup filtering. Stronger Supply Chain Dive and Retail Dive items died in writeup, then standard or unknown-tier survivors filled the lane.

**Technology improved; preserve that path.**
Technology recovered to 5/5 trusted with operator-relevant selections around Intel/Terafab, Meta's public model, Artemis III decision timing, UK public-sector tech pay, and the SCOTUS ISP ruling. This looks like a ranking/relevance improvement, not an area to re-open right now.

Prior working conclusions on retrieval uptime, broker depth, and no-underfill delivery remain resolved or on track. The current blockers are validator mismatch at the writeup layer and trusted-first same-topic backfill when good candidates are still available.

## Update Rules

- Update this file with the current live retrieval focus and routing only.
- Keep long pass-by-pass implementation history in the archive copy.
- Keep runtime/admin-readable mirrors in `data/retrieval-evals/` when the admin surface depends on them.
