# Retrieval Eval Worklog

*Last reviewed: April 10, 2026*

This is the live operator summary for retrieval-evaluation work. The full March 2026 historical log is archived under [`../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md`](../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md).

## Purpose

Track the current retrieval-quality loop without mixing a large historical execution log into the live docs surface.

## Current Live Inputs

- admin surface: `/admin/retrieval-eval`
- runtime artifact mirror: [`../../data/retrieval-evals/worklog.md`](../../data/retrieval-evals/worklog.md)
- active validation bundle: [`../planning/reduced-scope-mvp-validation/README.md`](../planning/reduced-scope-mvp-validation/README.md)

## Current Working Conclusion

As of April 10, 2026 (Day 14), the run is healthier than Day 13 but category expansion is still blocked. Day 14 delivered 35/35, kept all 7 topics at 5/5 and above depth-15, produced 601 total candidates after story-relationship filtering, and passed 727/727 broker fetch items across 45 domains. Trusted share reached 28/35 (80.0%) for the day, up from 25/35 (71.4%) on Day 13 and 22/35 (62.9%) on Day 12, but the three-day calibration window is still only 75/105 trusted (71.4%). The detailed audit is archived at [`../archive/planning/2026-03/mvp-day-14-2026-04-10.md`](../archive/planning/2026-03/mvp-day-14-2026-04-10.md).

**Active issue - writeup first-pass quality is still weak even though repairs recovered the run.**
Day 14 attempted 50 writeups, passed only 5 on the first try (10.0%), recovered 30/30 repair attempts, and still dropped 15 writeups (30.0%). Strong-tier writeups improved sharply from Day 13, but 9 of 37 strong attempts still dropped (24.3%), which remains above the <=15% expansion bar.

**Active issue - Consumer & Retail is still the clearest weak topic, with Industrials only partially recovered.**
Consumer & Retail improved from 1/5 trusted to 3/5 trusted, but it still dropped 6 of 11 writeup attempts and finished with the worst topic-level drop share in the run. Industrials recovered from 0/5 trusted to 3/5 trusted, but that is still below expansion quality.

**Active issue - the audit summary counters need parity fixes.**
The top-level `summary.writeup` block reports `soft_fail_count: 0` and `minimum_viable_accept_count: 0`, while the per-topic writeup blocks sum to 28 soft-fail recoveries and 7 minimum-viable accepts. The docs should continue to trust per-topic counters until the aggregate is corrected.

Technology and Life Sciences both look directionally healthy enough to preserve during calibration. The remaining blockers are concise writeup survivability, trusted-first same-topic backfill in weaker lanes, and the summary-counter mismatch in the audit itself.

## Update Rules

- Update this file with the current live retrieval focus and routing only.
- Keep long pass-by-pass implementation history in the archive copy.
- Keep runtime/admin-readable mirrors in `data/retrieval-evals/` when the admin surface depends on them.
