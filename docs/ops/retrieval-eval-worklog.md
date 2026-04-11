# Retrieval Eval Worklog

*Last reviewed: April 11, 2026*

This is the live operator summary for retrieval-evaluation work. The full March 2026 historical log is archived under [`../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md`](../archive/planning/2026-03/retrieval-eval-worklog-2026-03.md).

## Purpose

Track the current retrieval-quality loop without mixing a large historical execution log into the live docs surface.

## Current Live Inputs

- admin surface: `/admin/retrieval-eval`
- runtime artifact mirror: [`../../data/retrieval-evals/worklog.md`](../../data/retrieval-evals/worklog.md)
- active validation bundle: [`../planning/reduced-scope-mvp-validation/README.md`](../planning/reduced-scope-mvp-validation/README.md)

## Current Working Conclusion

As of April 11, 2026 (Day 15), category expansion is still blocked. The day had two separate stories:

- **runtime/delivery:** the morning scheduled run was blocked by stale circuit-breaker state carried over from April 10, but the deployed breaker-reset fix allowed the team to replay the run later the same day and deliver all 10 canary digests successfully.
- **content quality:** the audit stayed red even after the recovery send. Day 15 delivered 35/35, kept all 7 topics at 5/5 and above depth-15, produced 365 retained candidates after filtering, and stayed almost entirely broker-backed. Trusted share landed at **26/35 (74.3%)**, down from Day 14's **28/35 (80.0%)**. The detailed audit is archived at [`../archive/planning/2026-03/mvp-day-15-2026-04-11.md`](../archive/planning/2026-03/mvp-day-15-2026-04-11.md).

**Active issue - structured-output parsing and validator over-reject are still the main blockers.**
Day 15 attempted 48 writeups, passed only 8 on the first try (16.7%), recovered 27/27 repair attempts, and still dropped 13 writeups (27.1%). Strong-tier writeups worsened relative to Day 14: 13 of 39 strong attempts dropped (33.3%). The run diagnosis labeled the day `parse_or_structured_output_failure`, with `validator_over_reject` and `selection_ranking_failure` as the next two causes.

**Active issue - Industrials and Consumer & Retail still fail the trust bar.**
Both lanes finished only **2/5 trusted** on a day where every topic cleared depth-15. This is no longer a retrieval-volume problem; it is still a same-topic trusted recovery and backfill-quality problem after writeup loss.

**Active issue - the audit summary counters are still not trustworthy.**
The top-level `summary.writeup` block still reports `soft_fail_count: 0` and `minimum_viable_accept_count: 0`, but the Day 15 per-topic writeup blocks sum to **31 soft-fail recoveries** and **9 minimum-viable accepts**. Operator docs should continue to trust the topic-level counters until the summary aggregate is fixed.

The rolling admin readiness view is still below launch quality even with healthy broker retrieval: **63.1% trusted Tier 1/2 share**, **90.4% full-rate**, and **247 missed-story flags** across the 15-day window. Retrieval backbone reliability is no longer the limiting factor; writeup survivability and trusted-lane recovery are.

## Update Rules

- Update this file with the current live retrieval focus and routing only.
- Keep long pass-by-pass implementation history in the archive copy.
- Keep runtime/admin-readable mirrors in `data/retrieval-evals/` when the admin surface depends on them.
