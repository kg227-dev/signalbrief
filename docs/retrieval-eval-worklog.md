# Retrieval Eval Worklog

## Goal

Track retrieval and source-selection work aimed at improving:

- source credibility
- article relevance
- freshness, especially inside 24-48 hours
- precision for custom-heavy personas
- visibility into where retrieval fails before ranking

This worklog is intentionally source-first. Prose quality is only noted when it affects existing digest scoring or masks retrieval issues.

## Completed Work

### Pass 1: Production-faithful eval layer

Implemented a no-send retrieval evaluation path on the real production fetch and selection flow.

Completed:

- added a reusable retrieval eval runner under `src/eval/retrieval/`
- persisted eval runs under `data/retrieval-evals/`
- added source-focused scoring alongside the current DQS formula
- added a read-only admin page at `/admin/retrieval-eval`
- captured raw candidates, cleaned candidates, final items, and drop-off reasons where available
- documented current DQS math exactly from code

Key findings from the first pass:

- Perplexity often returned stale 48-72 hour items despite the 48-hour prompt
- selection quality sometimes looked better than it was because Claude enrichment happened later
- final selection could dilute custom-heavy digests with reputable but off-topic anchor-topic stories

### Pass 2: Precision-first remediation

Completed:

- tightened freshness validation earlier in the pipeline
- required verified `published_date` on fetched items
- moved toward shorter-but-better output rather than padded/noisy output
- changed ranking so custom-heavy personas prefer custom-matched items and fail closed instead of padding
- added scarcity-aware reporting labels:
  - `short_but_precise`
  - `short_and_thin`
  - `full_and_precise`
  - `full_but_diluted`

Key findings:

- weak categories stopped getting diluted filler
- custom-heavy personas improved on precision, but retrieval coverage collapsed under provider limits

### Pass 3: Retrieval coverage recovery under precision constraints

Completed in this pass:

- tightened weak-category standard queries in:
  - `HEALTHCARE`
  - `ENERGY`
  - `LIFE SCIENCES`
  - `POLICY×REGULATORY`
  - `SUSTAINABILITY`
- added targeted custom query plans for:
  - `Nvidia`
  - `GLP-1`
  - `agentic AI`
  - `SEC rulemaking`
  - `CBAM`
  - `rate cuts`
  - `grid infrastructure`
  - `semicap`
- changed custom-topic ordering to preserve first-seen order on ties instead of alphabetical order
- made custom-heavy runs reserve more custom fetch calls and run custom fetches before later standard retries
- added a second custom retry phase for thin custom topics
- added more conservative batch concurrency for large standard batches and custom batches
- added 429-aware batch cooldowns
- surfaced provider-collapse diagnostics in eval/admin:
  - `provider_429_count`
  - `provider_429_rate`
  - `degraded_topic_rate`
  - `retrieval_limited_topic_count`
  - `thin_topic_count`
  - per-topic coverage diagnostics
- fixed the eval raw-baseline leak for custom-heavy personas so unrelated anchor-topic items are no longer shown as raw custom candidates
- added `fail_closed_no_relevant_candidates` scarcity labeling
- removed the custom-topic fetch cap for genuinely custom-heavy runs so broad custom test sets can cover all keywords
- fixed the remaining custom precision bug in ranking:
  - if a custom-precision persona has zero custom matches, it now fails closed instead of quietly falling back to anchor-topic stories

### Pass 4: Root-cause split between provider scarcity and unused query plans

Completed in this pass:

- moved zero-yield preferred-domain retries to a real broad fallback on the second call
- added custom keyword source hints so broad custom terms no longer inherit obviously wrong preferred shortlists
- expanded custom-heavy retry reserve so realistic custom runs can broad-retry every keyword once
- added per-topic gap-audit fields in eval/admin:
  - raw / cleaned / final counts
  - source score
  - selection lift
  - preferred vs broad call counts
  - remaining broad queries
  - better-source opportunity signal
- split retrieval-limited outcomes into clearer buckets:
  - `preferred_only_query_design`
  - `query_plan_not_exhausted`
  - `provider_429_or_transport`
  - `provider_no_recent_coverage`
  - `keyword_ambiguity_or_off_topic_query`
  - `thin_but_precise`

## Important Run IDs

### Baselines

- `retrieval-eval:2026-03-22T03-14-31-204Z`
  - pre-fix `standard_full`
- `retrieval-eval:2026-03-22T03-19-22-562Z`
  - pre-fix `custom_realistic`
- `retrieval-eval:2026-03-22T03-36-10-352Z`
  - pre-fix `custom_adversarial`

### Post-remediation runs

- `retrieval-eval:2026-03-22T04-38-38-412Z`
  - first coverage-recovery run after early custom fetch, query tuning, 429 diagnostics, and eval-baseline cleanup
- `retrieval-eval:2026-03-22T04-42-40-204Z`
  - rerun after removing the custom-heavy fetch cap
- `retrieval-eval:2026-03-22T04-45-55-682Z`
  - rerun after the strict custom-precision fail-closed fix
- `retrieval-eval:2026-03-22T05-13-22-887Z`
  - first rerun after early broad fallback for zero-yield preferred topics
- `retrieval-eval:2026-03-22T05-36-16-565Z`
  - standard weak-category rerun with explicit `query_plan_not_exhausted` diagnosis
- `retrieval-eval:2026-03-22T05-39-36-205Z`
  - realistic-custom rerun with full custom second-pass retries and keyword-level gap audit

## What Improved

### Coverage / sequencing

- `custom_realistic` stopped clipping to `6/8` keywords in custom-heavy runs and now fetches all `8` custom topics in phase 1.
- the custom phase now happens before later standard retries, which gives broad custom runs a chance to get first-party coverage before the provider budget is exhausted.
- custom retries now happen on thin custom topics instead of spending all retry budget on standard topics first.

### Provider visibility

- eval/admin now distinguishes:
  - retrieval-limited failure
  - ranking-limited failure
  - short but precise
  - fail closed because no relevant items existed
- 429 pressure is now visible at scenario level and topic level instead of being buried inside logs.

### Precision

- the earlier `DIGITAL/cio.com` leak path is no longer treated as a valid custom candidate pool in eval.
- after the strict custom-precision fix, zero-match custom personas fail closed cleanly instead of surfacing anchor-topic filler.

## Current Best Evidence

### Standard weak-category picture

Run: `retrieval-eval:2026-03-22T05-36-16-565Z`

- `standard_full` raw candidates: `9`
- cleaned candidates: `9`
- 429 rate: `0%`
- stale rejection rate: `0%`
- weak categories now split into:
  - short precise recoveries:
    - `HEALTHCARE`
    - `ENERGY`
    - `LIFE SCIENCES`
  - still failed closed:
    - `POLICY×REGULATORY`
    - `SUSTAINABILITY`

Interpretation:

- the main issue is no longer “provider returned nothing” by default
- the tracked weak tags got one preferred call and one broad call, but still had `2` broad queries left unused
- the next high-leverage move is to allow one more broad query before declaring those tags uncovered

### Broad custom picture

Before early broad fallback + source hints:

- run `retrieval-eval:2026-03-22T04-42-40-204Z`
- `custom_realistic` fetched all `8` custom keywords
- raw candidates: `7`
- cleaned candidates: `7`
- personas completed: `2/8`
- successful precise outcomes:
  - `Nvidia`
  - `semicap`

After early broad fallback + source hints + full custom second pass:

- run `retrieval-eval:2026-03-22T05-39-36-205Z`
- raw candidates: `6`
- cleaned candidates: `6`
- personas completed precisely: `1/8`
- successful precise outcome:
  - `grid infrastructure`

Interpretation:

- the system is now preserving precision correctly and broad-retrying every custom keyword once
- the remaining misses are mostly not final-selection pollution and not first-pass preferred-only starvation
- the dominant remaining issue is that each keyword still has `3` broad queries left unused when the run ends

### Adversarial custom picture

Best coverage run after retrieval changes:

- run `retrieval-eval:2026-03-22T04-42-40-204Z`
- `custom_adversarial` raw candidates: `2`
- cleaned candidates: `2`
- 429 rate: `25.81%`
- all `4` personas completed as short digests in that run

Strict fail-closed confirmation run after precision fix:

- run `retrieval-eval:2026-03-22T04-45-55-682Z`
- `custom_adversarial` raw candidates: `3`
- cleaned candidates: `3`
- all `4` personas failed closed with `No deliverable items after emergency fallback`
- no unrelated anchor-topic filler survived

Interpretation:

- the earlier success pattern in the adversarial run was not trustworthy because zero-match custom personas could still inherit anchor-topic items
- after the strict precision fix, those personas now fail closed cleanly
- later reruns also produced one clean positive case (`Starlink`) without reintroducing noisy fallback

## Remaining Problems

- weak standard categories still stop after the first broad query even when alternate broad queries exist
- realistic custom keywords still stop after the first broad query even when `3` more custom queries remain
- provider variability is real, but the latest diagnostics show we still have fixable retrieval-design headroom before blaming provider scarcity
- 429 pressure remains a meaningful constraint on some custom runs, especially around `SEC rulemaking`, `rate cuts`, `grid infrastructure`, and `semicap`

## Next Planned Work

If this thread continues, the next highest-value retrieval-side steps are:

1. Allow one more broad query for zero-yield topics before declaring no coverage:
   - `HEALTHCARE`
   - `ENERGY`
   - `LIFE SCIENCES`
   - `POLICY×REGULATORY`
   - `SUSTAINABILITY`
   - `Nvidia`
   - `GLP-1`
   - `agentic AI`
   - `SEC rulemaking`
   - `CBAM`
   - `rate cuts`
   - `semicap`
2. Keep the precision-first rule:
   - no reintroduction of broad anchor-topic fallback for custom-heavy personas
3. Re-run the weak-category matrix after any retrieval-only change and compare against:
   - `retrieval-eval:2026-03-22T05-36-16-565Z`
   - `retrieval-eval:2026-03-22T05-39-36-205Z`
