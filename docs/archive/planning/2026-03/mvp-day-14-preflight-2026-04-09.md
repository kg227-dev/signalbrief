# Day 14 Preflight (2026-04-09)

This is the operator checklist to run immediately after the Day 14 production audit lands. The validator calibration fix is live in commit `f95130c83e7733a43a4c7dc011021d46f1cc02d2`, so Day 14 is the first day that can confirm whether the new generation-validator contract is working.

## 1. Check the new validator metrics first

Source of truth:

- `/admin/retrieval-eval`
- the Day 14 audit JSON

Primary metrics to read before anything else:

- `hard_fail_count`
- `soft_fail_count`
- `soft_fail_recovery_rate_pct`
- `minimum_viable_accept_count`
- `strong_tier_hard_fail_rate_pct`
- legacy comparators: `drop_count`, `dropped_share_pct`, `strong_tier_drop_rate_pct`, `first_pass_success_rate_pct`

Expected Day 14 direction:

- `drop_count` materially down from Day 13's `143`
- `soft_fail_recovery_rate_pct` clearly above Day 13's repair behavior
- `strong_tier_hard_fail_rate_pct` low enough that strong-tier losses stop dominating weak-topic outcomes
- `minimum_viable_accept_count` non-zero but not so large that the validator is effectively bypassed

Interpretation:

- If `hard_fail_count` is low and `soft_fail_recovery_rate_pct` is high, the validator calibration worked.
- If `soft_fail_count` is high but recovery is weak, the next change is repair quality, not more validator relaxation.
- If `hard_fail_count` stays high, the shipping bar is still too strict.

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

## Day 14 Decision Rule

Use this order:

1. validator metrics
2. writeup sample quality
3. topic trusted-share outcomes

If Day 14 still misses the trusted-share target but the writeup layer is clearly healthier, stop changing validator rules and move the next fix to selector-side trusted backfill.
