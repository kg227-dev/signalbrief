# Day 14-16 Calibration Window (2026-04-09)

This is the operator checklist for the next 3 live runs after the validator calibration fix in commit `f95130c83e7733a43a4c7dc011021d46f1cc02d2`. Day 14 is the first confirmation point, but the decision to expand surface area should be based on a short steady-state window, not a single run.

## 1. Check the new validator metrics first

Source of truth for each run:

- `/admin/retrieval-eval`
- the Day 14 audit JSON

Primary metrics to read before anything else:

- `first_pass_success_rate_pct`
- `repair_pass_success_rate_pct`
- `drop_count`
- `dropped_share_pct`
- `strong_tier_attempted_count`
- `strong_tier_final_selected_count`
- `strong_tier_drop_count`
- `strong_tier_drop_rate_pct`
- trusted Tier 1/2 share for the run
- trusted Tier 1/2 share versus prior calibration runs
- 5-item fulfillment rate / full-topic rate
- `hard_fail_count`
- `soft_fail_count`
- `soft_fail_recovery_rate_pct`
- `minimum_viable_accept_count`
- `strong_tier_hard_fail_rate_pct`
- `parse_failure_counts`

Also report topic-level breakdown for every run, with explicit focus on:

- Industrials
- Consumer & Retail
- Life Sciences
- Technology

Expected direction versus Day 13:

- `drop_count` materially down from Day 13's `143`
- `dropped_share_pct` moving toward `<= 30%`
- `strong_tier_drop_rate_pct` moving toward `<= 15%`
- trusted share moving toward `>= 75%`
- `soft_fail_recovery_rate_pct` clearly above Day 13's repair behavior
- `strong_tier_hard_fail_rate_pct` low enough that strong-tier losses stop dominating weak-topic outcomes
- `minimum_viable_accept_count` non-zero but not so large that the validator is effectively bypassed

Interpretation:

- If `hard_fail_count` is low and `soft_fail_recovery_rate_pct` is high, the validator calibration worked.
- If `soft_fail_count` is high but recovery is weak, the next change is repair quality, not more validator relaxation.
- If `hard_fail_count` stays high, the shipping bar is still too strict.
- If trusted share rises but weak-topic backfill remains structurally weak, the next issue is selector-side reserve ordering.

## 2. Spot-check minimum-viable accepts and strong-tier survivors

Review two small sets from the audit candidates:

1. `minimum_viable_accept=true`
2. strong-tier items with `validation_tier=soft_fail` that still shipped

Sample at least:

- 3 accepted minimum-viable items
- 3 strong-tier soft-fail survivors

What to verify:

- the writeup is still readable
- implication is explicit enough for an operator audience
- actor or system anchor is concrete
- the writeup does not feel generic or templated
- strong-tier repairs did not lose the original mechanism or implication

Interpretation:

- If the accepted items read cleanly, the new tolerance floor is working as intended.
- If these samples feel vague or generic, the validator is now too permissive and the next change should tighten minimum-viable acceptance, not reintroduce broad hard-fails.

## 3. Decide whether the next change is still validator work or selector work

After reading the validator metrics and spot-checking the shipped copy, inspect topic outcomes for:

- trusted-share movement
- strong-tier preservation in Industrials
- strong-tier preservation in Consumer & Retail
- whether weak-tier backfill still replaces available trusted candidates

Interpretation:

- If validator drops fall and weak-topic trusted share improves, keep the validator contract and monitor one more day.
- If validator drops fall but weak-tier replacements still dominate Industrials or Consumer & Retail, the next fix should be trusted-first same-topic backfill or reserve ordering.
- If validator drops do not fall enough, continue on repair behavior before touching selection.

## Calibration Window Success Criteria

Only consider category expansion after the calibration window shows:

- trusted share consistently `>= 75%`, ideally trending toward `80%`
- writeup drop share `<= 30%`
- strong-tier drop rate `<= 15%`
- stable `5/5` fulfillment across topics
- no structurally weak topics such as `0/5` trusted

If any of those fail, category expansion remains blocked.

## Run-by-Run Decision Rule

Use this order:

1. validator metrics
2. writeup sample quality
3. topic trusted-share outcomes

If a run still misses the trusted-share target but the writeup layer is clearly healthier, stop changing validator rules and move the next fix to selector-side trusted backfill.
