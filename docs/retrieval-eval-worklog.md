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

After one additional broad-query step:

- run `retrieval-eval:2026-03-22T06-10-49-849Z`
- raw candidates: `3`
- cleaned candidates: `3`
- personas completed precisely: `0/8`
- all tracked broad custom keywords still failed closed

Interpretation:

- the system is still preserving precision correctly:
  - no noisy fallback returned
  - stale rate stayed `0%`
  - weak-source exposure stayed `0%`
- the extra broad step is not enough for the targeted broad custom keywords:
  - `Nvidia`
  - `GLP-1`
  - `agentic AI`
  - `SEC rulemaking`
  - `CBAM`
  - `rate cuts`
  - `semicap`
- each of those keywords moved from:
  - `broad_call_count: 1` and `remaining_broad_queries: 3`
  - to `broad_call_count: 2` and `remaining_broad_queries: 2`
- every one of those keywords still shows `better_source_opportunity: likely`
- current evidence says the next blocker is still unused query depth / query design, not ranking pollution

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
- realistic broad custom keywords still stop with `2` unused broad queries left after the new pass
- provider variability is real, but the latest clean reruns show we still have fixable retrieval-design headroom before blaming provider scarcity
- 429 pressure remains a meaningful constraint on some custom runs, especially around `SEC rulemaking`, `rate cuts`, `grid infrastructure`, and `semicap`

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
   - `Nvidia`
   - `GLP-1`
   - `agentic AI`
   - `SEC rulemaking`
   - `CBAM`
   - `rate cuts`
   - `semicap`
2. Focus on query shaping before source-registry changes:
   - narrower broad-query variants for ambiguous custom terms
   - category-specific alternate phrasings for weak standard tags
   - continue separating:
     - query-design failures
     - provider-limited failures
     - true low-coverage / market-scarcity failures
3. Keep the precision-first rule:
   - no reintroduction of broad anchor-topic fallback for custom-heavy personas
4. Re-run the weak-category matrix after any retrieval-only change and compare against:
   - `retrieval-eval:2026-03-22T06-06-01-508Z`
   - `retrieval-eval:2026-03-22T06-10-49-849Z`
5. Keep the admin progress view current:
   - update this markdown after each pass
   - sync the latest worklog and run artifacts into production data when fresh eval runs are promoted
