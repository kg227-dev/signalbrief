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

Run: `retrieval-eval:2026-03-22T04-38-38-412Z`

- `standard_full` raw candidates: `10`
- cleaned candidates: `10`
- 429 rate: `0%`
- stale rejection rate: `0%`
- weak categories still failed closed:
  - `HEALTHCARE`
  - `ENERGY`
  - `LIFE SCIENCES`
  - `POLICY×REGULATORY`
  - `SUSTAINABILITY`

Interpretation:

- the current limiting factor for those tags is now retrieval coverage, not selector dilution
- query tuning improved overall standard raw yield, but not enough to recover those specific weak tags

### Broad custom picture

Before cap removal:

- run `retrieval-eval:2026-03-22T04-38-38-412Z`
- `custom_realistic` fetched `6/8` custom keywords
- raw candidates: `5`
- 429 rate: `25%`
- personas completed: `2/8`

After cap removal:

- run `retrieval-eval:2026-03-22T04-42-40-204Z`
- `custom_realistic` fetched all `8` custom keywords
- raw candidates: `7`
- cleaned candidates: `7`
- 429 rate: `0%` on that run
- personas completed: `2/8`
- successful precise outcomes:
  - `Nvidia`
  - `semicap`

Interpretation:

- the cap removal improved raw custom coverage without reintroducing noisy fallback
- remaining misses are still primarily retrieval-limited, not ranking-limited

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

## Remaining Problems

- weak standard categories remain retrieval-limited even after query tuning
- provider variability is still large enough that two runs close together can produce materially different outcomes
- broad custom coverage improved, but only a subset of realistic custom keywords are consistently returning relevant deliverable items
- 429 pressure remains a meaningful constraint, especially once multiple custom topics are active in the same run

## Next Planned Work

If this thread continues, the next highest-value retrieval-side steps are:

1. Add one more targeted query pass for the still-weak standard tags rather than broadening fallback:
   - `HEALTHCARE`
   - `ENERGY`
   - `LIFE SCIENCES`
   - `POLICY×REGULATORY`
   - `SUSTAINABILITY`
2. Add tag-aware retry prioritization so zero-yield weak categories get another query before healthier categories do.
3. Add a small preferred-domain / trusted-domain recall report by topic so weak-category misses can be split into:
   - provider returned nothing useful
   - preferred sources were found but not converted into usable items
4. Keep the precision-first rule:
   - no reintroduction of broad anchor-topic fallback for custom-heavy personas
5. Re-run the weak-category matrix after any retrieval-only change and compare against:
   - `retrieval-eval:2026-03-22T04-38-38-412Z`
   - `retrieval-eval:2026-03-22T04-42-40-204Z`
   - `retrieval-eval:2026-03-22T04-45-55-682Z`
