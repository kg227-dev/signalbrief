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

### Pass 5: One more broad-query step for tracked weak buckets

Completed in this pass:

- added one additional broad-query step for zero-yield tracked standard topics:
  - `HEALTHCARE`
  - `ENERGY`
  - `LIFE SCIENCES`
  - `POLICY×REGULATORY`
  - `SUSTAINABILITY`
- added one additional broad-query step for tracked broad custom keywords:
  - `Nvidia`
  - `GLP-1`
  - `agentic AI`
  - `SEC rulemaking`
  - `CBAM`
  - `rate cuts`
  - `semicap`
- reserved fetch budget explicitly so deep broad retries do not get crowded out by earlier standard/custom retry phases
- kept the current precision-first / fail-closed behavior unchanged
- added contract coverage for the new deep broad retry path in:
  - `tests/contracts/entrypoints/digest-orchestrator-fetch-runtime.test.js`

Key findings:

- the extra broad-query step helps some weak standard categories, but not all of them
- it did not reintroduce noisy fallback, stale leakage, or weak-source exposure
- it was not enough to recover the targeted broad custom keywords, which still exit with unused broad query depth

### Pass 6: Admin progress visibility and production artifact sync

Completed in this pass:

- added progress sections to `/admin/retrieval-eval`:
  - `Progress Log`
  - `Current Focus`
- made the admin progress loader read from:
  - `docs/retrieval-eval-worklog.md`
  - fallback: `data/retrieval-evals/worklog.md`
- synced the completed retrieval-eval artifacts into the production data volume so the admin page can render real runs instead of an empty state
- synced the retrieval eval worklog into the production data volume so the progress panels can render in production even though `docs/` is excluded from the runtime image

Key findings:

- the admin page had looked empty for infrastructure reasons, not because testing had not started
- production runtime data and the repo worklog need to stay aligned if the admin page is expected to reflect the latest local eval progress

### Pass 7: Perplexity source transparency in admin

Completed in this pass:

- added a source inspector to `/admin/retrieval-eval`
- exposed the raw Perplexity-returned article set for the selected scenario
- added direct article links so raw returned sources can be opened from the admin page
- added survival context for each raw item:
  - whether it survived cleanup
  - whether it reached the scenario final pool
  - how many persona finals kept it
- added a side-by-side final-source view so raw retrieval can be compared against kept items without leaving the page

Key findings:

- the eval artifacts already contained the necessary raw source data; the missing piece was making it visible in the admin UI
- transparency into raw Perplexity output is now good enough to inspect source recall and specific misses directly from the admin page

### Pass 8: Admin page simplification and plain-English guide

Completed in this pass:

- simplified `/admin/retrieval-eval` around the core workflow:
  - how it works
  - where it broke
  - what Perplexity returned
  - what SignalBrief kept
- added a plain-English guide at the top that explains:
  - raw retrieval
  - cleanup
  - final selection
  - the main terms on the page
- moved secondary diagnostics into a collapsed supporting-details section so the page is less overwhelming on first load

Key findings:

- the main problem with the page was legibility, not missing data
- the right simplification is to foreground the source flow and hide the secondary rollups until needed

### Pass 9: Meaningful live reruns, rate-limit backoff hardening, and deeper custom recall

Completed in this pass:

- hardened provider retry handling to respect `Retry-After` when Perplexity returns `429`
- made adaptive rate-limit cooldown stateful across fetch batches instead of using one fixed delay
- changed zero-yield `429` results so they do not block later broad retries by default
- expanded the eval-only global selection target for all-custom realistic scenarios so the harness can judge multiple disjoint custom personas fairly
- added more live runs under conservative provider settings:
  - `SIGNALBRIEF_PERPLEXITY_MAX_CONCURRENT_FETCHES=1`
  - `SIGNALBRIEF_PERPLEXITY_RETRIES=5`
  - `SIGNALBRIEF_PERPLEXITY_RETRY_DELAY_MS=3000`
- shifted two scheduled calls from standard anchor topics into deep custom retries for custom-heavy runs
- changed deep custom retry ordering to prioritize stronger search-result evidence instead of pure first-seen order

Key findings:

- rate limiting is no longer the primary blocker in the latest custom reruns; the recent custom runs completed with `0` provider `429`s
- the earlier custom-realistic sample really was too thin to be useful; newer reruns now show materially different keyword outcomes run to run
- the extra deep custom reserve improved realistic custom completion from `3/8` to `4/8` in the follow-up run without reintroducing noisy fallback
- remaining custom gaps now split more cleanly into:
  - `provider_no_recent_coverage`
  - `thin_but_precise`
  - occasional `ranking_or_quality_gate`

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
- `retrieval-eval:2026-03-22T06-06-01-508Z`
  - clean `standard_full` rerun after the extra broad-query step
- `retrieval-eval:2026-03-22T06-10-49-849Z`
  - clean `custom_realistic` rerun after the extra broad-query step
- `retrieval-eval:2026-03-22T15-53-38-565Z`
  - first meaningful custom-realistic rerun after fixing the eval global-selection artifact
- `retrieval-eval:2026-03-22T16-25-18-670Z`
  - clean `standard_full` rerun with conservative provider throttling and zero `429`s
- `retrieval-eval:2026-03-22T16-28-15-570Z`
  - combined `custom_realistic` + `custom_adversarial` live rerun under tight provider throttling
- `retrieval-eval:2026-03-22T16-32-38-797Z`
  - custom-realistic repeat run showing phase-5 custom retries before the custom-budget patch
- `retrieval-eval:2026-03-22T16-39-36-409Z`
  - custom-realistic rerun after reallocating two anchor-topic calls into deep custom retries

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

Before the extra broad step:

- run `retrieval-eval:2026-03-22T05-36-16-565Z`
- raw candidates: `9`
- cleaned candidates: `9`
- 429 rate: `0%`
- stale rejection rate: `0%`
- tracked weak-category completion: `3/5`
- all `5` tracked weak categories were still `query_plan_not_exhausted`

After the extra broad step:

- run `retrieval-eval:2026-03-22T06-06-01-508Z`
- raw candidates: `11`
- cleaned candidates: `11`
- 429 rate: `0%`
- stale rejection rate: `0%`
- tracked weak-category completion: `2/5`
- root-cause transitions:
  - `ENERGY`: `query_plan_not_exhausted -> thin_but_precise`
  - `SUSTAINABILITY`: `query_plan_not_exhausted -> thin_but_precise`
  - `HEALTHCARE`: still `query_plan_not_exhausted`
  - `LIFE SCIENCES`: still `query_plan_not_exhausted`
  - `POLICY×REGULATORY`: still `query_plan_not_exhausted`

Interpretation:

- the deeper query step is working technically:
  - tracked weak categories now show `broad_call_count: 2`
  - remaining broad depth dropped from `2` to `1`
- the extra step recovered better precise coverage in:
  - `ENERGY`
  - `SUSTAINABILITY`
- it did not help enough in:
  - `HEALTHCARE`
  - `LIFE SCIENCES`
  - `POLICY×REGULATORY`
- there was no new stale leakage and no weak-source regression

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

Meaningful custom reruns under tighter provider throttling:

- run `retrieval-eval:2026-03-22T15-53-38-565Z`
  - raw candidates: `4`
  - cleaned candidates: `4`
  - personas completed precisely: `4/8`
  - precise completions:
    - `Nvidia`
    - `GLP-1`
    - `agentic AI`
    - `SEC rulemaking`
- run `retrieval-eval:2026-03-22T16-32-38-797Z`
  - raw candidates: `10`
  - cleaned candidates: `10`
  - personas completed precisely: `3/8`
  - precise completions:
    - `GLP-1`
    - `agentic AI`
    - `grid infrastructure`
- run `retrieval-eval:2026-03-22T16-39-36-409Z`
  - raw candidates: `5`
  - cleaned candidates: `5`
  - personas completed precisely: `4/8`
  - precise completions:
    - `Nvidia`
    - `GLP-1`
    - `agentic AI`
    - `SEC rulemaking`

Interpretation:

- the custom runs now contain enough live data to be meaningful; the earlier “mostly empty” sample is no longer representative
- no noisy fallback returned in any of these reruns
- stale rate stayed `0%`
- provider `429` rate stayed `0%` in the latest custom reruns under the tighter throttle settings
- the custom-budget shift helped real coverage:
  - `Nvidia`: `0 final -> 1 final`
  - `SEC rulemaking`: `0 final -> 1 final`
  - `custom_realistic` completion improved from `3/8 -> 4/8` on the follow-up run
- remaining weak custom terms are now clearer:
  - `CBAM`: still looks like `provider_no_recent_coverage`
  - `rate cuts`: still looks like `provider_no_recent_coverage`
  - `semicap`: improved retry depth, but still inconsistent across runs
  - `grid infrastructure`: improved retrieval, but can still become `ranking_or_quality_gate`

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

- some weak standard categories still stop too early even after the extra broad query:
  - `HEALTHCARE`
  - `LIFE SCIENCES`
  - `POLICY×REGULATORY`
- realistic broad custom coverage is now materially better, but still volatile across reruns
- provider variability is real, but the latest clean custom reruns show it is not the dominant failure mode when provider pressure is reduced
- rate limiting still matters for broader matrix runs, but the latest custom scenario passes show that low-concurrency throttling and `Retry-After` handling are enough to avoid `429`s in smaller targeted runs
- `CBAM` and `rate cuts` are the strongest current candidates for true low recent coverage rather than a simple query-budget issue
- `grid infrastructure` and `semicap` still need more diagnosis because they oscillate between retrieval-limited success and later-stage exclusion

## Overall Plan Status

### Done

- audited the real retrieval, cleanup, selection, personalization, and current DQS codepath
- built the production-faithful no-send eval runner
- added source-focused scoring, scarcity-aware labeling, and raw vs cleaned vs final diagnostics
- added the retrieval eval admin page and progress/worklog visibility
- fixed the main selection-side precision issues:
  - custom-heavy fail-closed behavior
  - stale-item tightening
  - removal of noisy anchor-topic fallback in custom-heavy cases
  - custom leak-path cleanup
- ran multiple budget-capped eval passes and targeted reruns

### Partially Done

- historical comparison exists, but the local historical digest sample is still thin
- manual review exists in targeted form, but not yet as a deeper recurring review loop
- category coverage is good enough for v1, but not yet a stable long-run regression suite under consistent provider conditions

### Not Done Yet

- retrieval recall recovery for the remaining weak categories and broad custom keywords
- automatic publishing of local eval artifacts and worklog updates into production runtime storage after each fresh run
- deeper source-inspector controls if needed later:
  - stage-only filtering
  - keyword/topic filtering inside the source table
  - direct per-item drop-off reason coverage for earlier fetch/cleanup stages
- stronger separation between:
  - fixable query-design failures
  - provider-limited failures
  - true low-coverage / market-scarcity failures

## Next Planned Work

If this thread continues, the next highest-value retrieval-side steps are:

1. Improve retrieval recall for the buckets that still have unused depth after the extra broad step:
   - `HEALTHCARE`
   - `LIFE SCIENCES`
   - `POLICY×REGULATORY`
   - `CBAM`
   - `rate cuts`
   - `semicap`
2. Focus on query shaping before source-registry changes:
   - narrower broad-query variants for:
     - `CBAM`
     - `rate cuts`
     - `semicap`
   - category-specific alternate phrasings for weak standard tags
   - continue separating:
     - query-design failures
     - provider-limited failures
     - true low-coverage / market-scarcity failures
3. Investigate the remaining later-stage custom drops:
   - why `grid infrastructure` can retrieve a precise item and still miss final selection
   - whether `semicap` is a true provider miss or still losing on query phrasing
4. Keep the precision-first rule:
   - no reintroduction of broad anchor-topic fallback for custom-heavy personas
5. Re-run the weak-category matrix after any retrieval-only change and compare against:
   - `retrieval-eval:2026-03-22T06-06-01-508Z`
   - `retrieval-eval:2026-03-22T16-39-36-409Z`
6. Keep the admin progress view current:
   - update this markdown after each pass
   - sync the latest worklog and run artifacts into production data when fresh eval runs are promoted

## Latest Pass Update

### Pass 10: Targeted custom query shaping and weak-matrix rerun

Completed:

- reshaped custom queries for `CBAM`, `rate cuts`, and `semicap`
- expanded alias coverage for those same custom keywords so retrieval and matching reflect more real-world phrasing
- refined eval gap classification so scenario-level exclusions can be labeled more precisely, including `selection_custom_cap`
- reran `custom_realistic`
- reran `standard_full`

New run IDs:

- `retrieval-eval:2026-03-22T16-55-09-561Z`
  - discarded post-query-shaping `custom_realistic` run; provider response quality was not decision-grade
- `retrieval-eval:2026-03-22T16-56-55-227Z`
  - clean post-query-shaping `custom_realistic` rerun
- `retrieval-eval:2026-03-22T16-58-49-554Z`
  - post-query-shaping `standard_full` rerun

Targeted custom results:

- `CBAM`
  - before (`retrieval-eval:2026-03-22T16-39-36-409Z`): `0 raw / 0 cleaned / 0 final`, `provider_no_recent_coverage`
  - after (`retrieval-eval:2026-03-22T16-56-55-227Z`): `0 / 0 / 0`, `provider_no_recent_coverage`
- `rate cuts`
  - before: `0 / 0 / 0`, `provider_no_recent_coverage`
  - after: `0 / 0 / 0`, `provider_no_recent_coverage`
- `semicap`
  - before: `0 / 0 / 0`, `provider_no_recent_coverage`
  - after: `0 / 0 / 0`, but now `query_plan_not_exhausted` with `1` broad query still unused
- `grid infrastructure`
  - traced pre-change run (`retrieval-eval:2026-03-22T16-39-36-409Z`): `1 / 1 / 0`, rejected by `selection_custom_cap`
  - latest clean rerun (`retrieval-eval:2026-03-22T16-56-55-227Z`): `0 / 0 / 0`, `provider_no_recent_coverage`

Interpretation:

- the targeted query-shaping pass did not create a clean recall win for `CBAM`, `rate cuts`, or `semicap`
- `CBAM` and `rate cuts` remain the strongest candidates for true low recent coverage rather than a simple query-budget issue
- `semicap` is still the clearest custom keyword with remaining unused query depth, so it stays in the fixable retrieval-design bucket
- `grid infrastructure` is not one stable failure mode:
  - one traced failure was a scenario-level custom selection cap on a review-tier `powermag.com` item
  - the latest clean rerun found no usable item at all, which points back to unstable retrieval rather than a persistent ranking bug

Weak-category matrix rerun:

- baseline comparison run: `retrieval-eval:2026-03-22T16-25-18-670Z`
- latest rerun: `retrieval-eval:2026-03-22T16-58-49-554Z`
- latest rerun summary:
  - raw candidates: `19`
  - cleaned candidates: `19`
  - average final score: `81.12`
  - average fill: `31.43`
  - `429 rate`: `0%`
  - stale rejection rate: `0%`

Tracked weak-category deltas:

- `ENERGY`
  - before: `0 raw / 3 cleaned / 2 final`, `query_plan_not_exhausted`
  - after: `1 / 3 / 2`, `thin_but_precise`
- `POLICY×REGULATORY`
  - before: `0 / 1 / 1`, `query_plan_not_exhausted`
  - after: `0 / 1 / 1`, `provider_no_recent_coverage`
- `HEALTHCARE`
  - before: `0 / 2 / 1`, `query_plan_not_exhausted`
  - after: `0 / 2 / 2`, `provider_no_recent_coverage`
- `LIFE SCIENCES`
  - before: `0 / 2 / 1`, `query_plan_not_exhausted`
  - after: `1 / 2 / 2`, `thin_but_precise`
- `SUSTAINABILITY`
  - before: `1 / 1 / 1`, `thin_but_precise`
  - after: `1 / 2 / 1`, `thin_but_precise`

Current bottom line:

- selector/fallback behavior remains healthy
- rate limiting is not the dominant blocker on the latest targeted runs
- the remaining custom gaps split into:
  - likely provider/content scarcity: `CBAM`, `rate cuts`
  - still fixable retrieval design: `semicap`
  - unstable retrieval with one traced selection-cap exclusion: `grid infrastructure`
