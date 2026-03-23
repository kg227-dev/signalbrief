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

## Latest Pass Update

### Pass 11: Semicap retry and source-specific decision pass

Completed:

- tightened the `semicap` custom query pack again to bias toward real semicap terms:
  - `ASML`
  - `Applied Materials`
  - `Lam Research`
  - `wafer fab equipment`
  - `lithography`
  - `etch deposition`
- reran `custom_realistic`
- ran a strict preferred-domain probe for:
  - `SEMICAP`
  - `CBAM`
  - `RATE CUTS`
  - `GRID INFRASTRUCTURE`

New run ID:

- `retrieval-eval:2026-03-22T17-35-50-430Z`
  - post-semicap-query-shaping `custom_realistic` rerun

Semicap rerun result:

- `semicap`
  - latest rerun: `1 raw / 1 cleaned / 0 final`
  - final outcome: `ranking_limited`
  - source score: `0` final, raw-baseline loss `-72.78`
  - surviving candidate was a review-tier `nemo.money` article about `ASML`
  - this is better than pure zero-yield, but it is not a trustworthy recovery win

Source-specific preferred-domain probe results:

- `SEMICAP`
  - preferred domains: `semianalysis.com`, `reuters.com`, `ft.com`, `wsj.com`
  - result: `0` items
  - interpretation: no good recent trusted-source coverage was surfaced, even with a narrow probe
- `CBAM`
  - preferred domains: `ec.europa.eu`, `eur-lex.europa.eu`, `reuters.com`, `ft.com`, `trellis.net`
  - result: `0` items
  - preferred search hits existed on `ec.europa.eu` and `trellis.net`, but no deliverable article came back
- `RATE CUTS`
  - preferred domains: `federalreserve.gov`, `reuters.com`, `ft.com`, `wsj.com`, `americanbanker.com`
  - result: `0` items
  - the probe only surfaced `federalreserve.gov` search hits, with no deliverable item
- `GRID INFRASTRUCTURE`
  - preferred domains: `ferc.gov`, `energy.gov`, `utilitydive.com`, `reuters.com`, `powermag.com`
  - result: `1` item
  - returned article:
    - `Republican, Democratic senators call for project certainty at permitting talks`
    - source: `utilitydive.com`
    - published: `2026-03-21`

Decision-oriented interpretation:

- `CBAM`
  - now looks like a true low recent coverage window under current quality standards
- `rate cuts`
  - now looks like a low recent coverage / low-quality window:
    - the regular run found one `foxbusiness.com` item
    - the trusted-source probe found nothing deliverable
- `semicap`
  - no longer looks like the clearest easy win
  - the tighter query pack surfaced only a review-tier finance-site item
  - the trusted-source probe returned nothing
  - this is now closer to a low trusted-coverage window than a high-confidence retrieval miss
- `grid infrastructure`
  - remains worth one more targeted retrieval pass
  - the trusted-source probe found a real `utilitydive.com` article that the main pipeline missed
  - this is the strongest remaining evidence that better coverage exists and current retrieval is still missing it

Current recommendation:

- still worth pursuing with more retrieval/query tuning:
  - `grid infrastructure`
- likely low recent coverage / not worth more narrow tuning right now:
  - `CBAM`
  - `rate cuts`
  - `semicap`
- thin but acceptable:
  - `ENERGY`
  - `LIFE SCIENCES`
  - `SUSTAINABILITY`

## Latest Pass Update

### Pass 12: 5-item delivery contract, retry policy, and product KPI instrumentation

Completed:

- implemented an explicit shipped-digest contract:
  - every shipped digest must contain `5` items
  - first pass may ship with `4 high-confidence + 1 lower-confidence`
  - retry may ship with `3 high-confidence + 2 lower-confidence`
- added persisted retry state keyed by `user_id + date_et`
- added adaptive retry timing based on failure class:
  - transient
  - retrieval-thin
  - ranking/policy-limited
- added explicit confidence classification gates in runtime code:
  - freshness
  - topic match
  - relevance
  - strategic value
  - routine suppression
  - source policy
  - source authority
  - source-type exclusions
- added a rolling `7`-day cap on lower-confidence-assisted deliveries
- added a topic-class policy layer instead of ad hoc per-topic exceptions
- defined `macro_policy_noise_sensitive` and attached:
  - `rate cuts`
  - `CBAM`
- disallowed lower-confidence backfill for trusted-only topic classes
- updated delivery records to persist:
  - `delivery_outcome`
  - `attempt_count`
  - `retry_scheduled_for`
  - `high_confidence_count`
  - `lower_confidence_count`
  - `lower_confidence_assist_7d_count`
  - `internal_thinness_label`
- updated eval/admin to expose product-facing KPI surfaces:
  - `5_item_fulfillment_rate`
  - `withheld_after_retry_rate`
  - `lower_confidence_usage_rate`
  - `repeated_lower_confidence_exposure_rate`
- added `grid infrastructure` comparison output and structured `source_family_audit` artifacts to retrieval eval
- expanded `grid infrastructure` preferred family hints to include:
  - `POLICY×REGULATORY`
  - `PUBLIC SECTOR`
- split `grid infrastructure` query plans into:
  - permitting / interconnection / regulatory
  - transformer / equipment / utility capex / data-center load

Validation completed:

- contract tests passed for:
  - delivery policy classification
  - retry state persistence
  - scheduler retry-aware due logic
  - delivery runtime shipping behavior
  - delivery record persistence
  - retrieval eval serialization
  - admin retrieval eval UI
- `scripts/test-critical-paths.js` passed after the policy/runtime changes

Current focus after this implementation:

- run fresh retrieval evals so the new product KPIs and grid/source-family artifacts are populated with live data
- inspect real-world `5_item_fulfillment_rate` and `withheld_after_retry_rate` under the new shipping contract
- verify whether `grid infrastructure` remains a normal-path vs strict-probe mismatch after the new mapping/query split
- confirm whether `rate cuts` and `CBAM` now fail closed under trusted-only policy as intended

Open next steps for this pass:

1. run a fresh retrieval-eval batch with the new delivery policy enabled
2. sync the new run artifacts and this worklog into production runtime data
3. review:
   - standard vs custom `5_item_fulfillment_rate`
   - lower-confidence usage rate
   - repeated lower-confidence exposure rate
   - `grid infrastructure` comparison output
4. decide whether remaining misses are:
   - acceptable underdelivery
   - query-design limited
   - provider/content scarcity

Live run completed:

- `retrieval-eval:2026-03-22T22-07-52-280Z`
  - scenarios:
    - `standard_full`
    - `custom_realistic`
    - `custom_adversarial`
  - status: `completed_with_errors`
  - provider pressure:
    - `0%` provider `429` rate in the scenario summaries
    - stale rejection remained `0%`

What this run changed:

- the retrieval/selection stack is now precise enough that the new `5`-item contract is the dominant product constraint
- overall KPI result under the new shipping policy:
  - `5_item_fulfillment_rate: 0%`
  - `withheld_after_retry_rate: 100%`
  - `lower_confidence_usage_rate: 0%`
  - `repeated_lower_confidence_exposure_rate: 0%`
- every evaluated persona simulated `withheld_after_retry`

Interpretation:

- this does **not** point to noisy fallback returning; that stayed off
- this does **not** point to stale leakage; that stayed at `0%`
- it means the current candidate yield is not sufficient to meet a strict `5`-item product promise with the current quality bar
- the strategic bottleneck has now moved decisively to candidate generation / retrieval recall

Important topic-level findings from this run:

- `grid infrastructure`
  - normal pipeline: `0 raw / 0 cleaned / 0 final`
  - strict probe: also `0 returned items`
  - root cause: `strict_probe_also_thin`
  - implication: the earlier `Utility Dive` recovery did not recur in this run; this is now an unstable recall issue rather than a stable selector bug
- `rate cuts`
  - trusted-only topic-class policy is now behaving as intended
  - earlier low-trust edge cases no longer count as successful coverage
- `CBAM`
  - still looks like a true low-recent-coverage window under the current source bar
- `standard_full`
  - many standard topics are still either:
    - `ranking_or_quality_gate`
    - `preferred_only_query_design`
    - `provider_no_recent_coverage`
  - the product issue is now bigger than the old narrow custom-only misses

Current recommendation after the first live `5`-item-policy run:

- treat the new delivery KPIs as real product signals, not just eval artifacts
- do **not** loosen the current precision / freshness / weak-source bar just to force fulfillment
- next work should focus on one question:
  - how to improve trusted candidate yield enough to hit the `5`-item promise
- if that cannot be done reliably with more Perplexity-only tuning, the next step should be a larger retrieval architecture change rather than more ranking changes

## 2026-03-22 23:20 ET - core-category gating split under the 5-item contract

What I changed in this pass:

- refined retrieval-eval gate attribution so `delivery_policy_gate` is no longer drowned out by generic `other_final_selection_rule`
- stopped counting topic-filter transitions as final-gate failures in eval summaries
- updated topic/persona gate rollups to prefer concrete delivery-policy blockers when shipping is the thing that actually failed
- kept the new delivery policy unchanged; this pass was diagnostic, not a standards-loosening change

Validation completed:

- `tests/contracts/harness/eval/retrieval/runner-runtime.test.js`
- `tests/contracts/web-api/admin-retrieval-eval-ui.test.js`
- `tests/contracts/entrypoints/digest-orchestrator-delivery-runtime.test.js`
- `scripts/test-critical-paths.js`

Focused live runs completed:

- `retrieval-eval:2026-03-22T23-06-30-307Z`
- `retrieval-eval:2026-03-22T23-14-46-928Z`

Headline result:

- the system is still at:
  - `5_item_fulfillment_rate: 0%`
  - `withheld_after_retry_rate: 100%`
- but the failure picture is now cleaner:
  - overall final-gate breakdown in the latest run:
    - `delivery_policy_score_threshold: 12`
    - `delivery_policy_total_item_shortfall: 11`
    - `delivery_policy_source_quality_threshold: 2`

Core standard-category diagnosis from `retrieval-eval:2026-03-22T23-14-46-928Z`:

- `HEALTHCARE`
  - `raw 0 / cleaned 3 / internal 1 / final 0`
  - root cause: `query_plan_not_exhausted`
  - shipping blocker on the matched persona: `delivery_policy_score_threshold`
  - interpretation:
    - retrieval still stopped early
    - the one retained internal item was review-tier and below the delivery relevance/source floor
- `TECHNOLOGY`
  - `raw 3 / cleaned 7 / internal 3 / final 0`
  - root cause: `delivery_policy_gate`
  - shipping blocker: `delivery_policy_score_threshold`
  - interpretation:
    - this is not a pure no-recall miss
    - items are being found, but too many are review-tier and below the delivery confidence floor
- `ENERGY`
  - `raw 1 / cleaned 4 / internal 2 / final 0`
  - root cause: `delivery_policy_gate`
  - shipping blocker: `delivery_policy_total_item_shortfall`
  - interpretation:
    - at least one strong item exists (`utilitydive.com`)
    - the main miss is not “junk got through”; it is not enough trusted volume to make 5 items
- `POLICY×REGULATORY`
  - `raw 0 / cleaned 1 / internal 1 / final 0`
  - root cause: `provider_no_recent_coverage`
  - shipping blocker on the matched persona: effectively still a shortfall
  - interpretation:
    - broad queries were exhausted
    - preferred/trusted domains appeared in search evidence, but did not convert into enough retained items
- `LIFE SCIENCES`
  - `raw 0 / cleaned 3 / internal 1 / final 0`
  - root cause: `query_plan_not_exhausted`
  - shipping blocker on the matched persona: `delivery_policy_score_threshold`
  - interpretation:
    - retrieval still has unused broad depth
    - the current retained item is review-tier and below the delivery floor
- `STRATEGY`
  - `raw 3 / cleaned 5 / internal 2 / final 0`
  - root cause: `delivery_policy_gate`
  - shipping blocker: `delivery_policy_total_item_shortfall`
  - interpretation:
    - this bucket can produce one strong Reuters-grade item
    - it still does not produce enough additional trusted items to satisfy a 5-item digest

What this means:

- the remaining product failure is **not** just “Perplexity found nothing”
- on normal categories, three different failure modes now show up clearly:
  - `query depth still left unused`
    - `HEALTHCARE`
    - `LIFE SCIENCES`
  - `some good items exist, but not enough trusted quantity for 5`
    - `ENERGY`
    - `STRATEGY`
  - `items exist, but they are too weak on source/relevance to count`
    - `TECHNOLOGY`
    - portions of `HEALTHCARE`
    - portions of `LIFE SCIENCES`

Preferred/trusted-first pressure test:

- on `standard_full`, preferred-first is **not** the main blocker by itself
- the clearer issue is:
  - too many standard buckets still leave `1-2` broad queries unused
  - once the system broadens, it often retrieves review-tier items that still do not meet the delivery floor
- on `custom_realistic`, preferred-only design still shows up on anchor topics like `STRATEGY` / `HEALTHCARE`, but that is secondary to the bigger standard-bucket yield problem

Minimum realistic path off `0%` fulfillment without reintroducing junk:

1. exhaust one more broad query for standard weak buckets that still show unused depth
   - start with `HEALTHCARE` and `LIFE SCIENCES`
2. tighten topic-specific query shaping for `TECHNOLOGY`
   - bias away from review-tier/cloud-report noise and toward stronger enterprise/official/trusted sources
3. revisit only the delivery confidence floor that is currently filtering review-tier `4.0-4.1` relevance items
   - do **not** loosen freshness
   - do **not** allow weak sources
   - do **not** reintroduce noisy fallback
   - any relaxation should be narrow and measured against lower-confidence usage rate

Current candid feasibility judgment:

- a daily `5`-item promise looks **only feasible with substantial additional retrieval architecture work** if we keep the current trust bar
- moderate tuning can likely move fulfillment above `0%`
- moderate tuning alone does **not** yet look sufficient to make `5` reliable across standard categories every day

Current focus after this pass:

- decide whether to do one last narrow retrieval/gate adjustment for:
  - `HEALTHCARE`
  - `LIFE SCIENCES`
  - `TECHNOLOGY`
- or stop and treat the current result as the decision point that the 5-item promise is too ambitious for the present Perplexity-first architecture

## 2026-03-22 23:55 ET — isolated core-standard pass

What changed in this pass:

- added a `standard_core` eval mode that fetches only the five focus categories instead of competing against the full standard-topic universe
- kept the stronger query shaping for:
  - `HEALTHCARE`
  - `LIFE SCIENCES`
  - `TECHNOLOGY`
  - `STRATEGY`
  - `POLICY×REGULATORY`
- added source-family rollups to the focused persona outputs so each category now reports whether the surviving pool is:
  - `premium`
  - `strong`
  - `standard`
  - `review_tier`
  - `corporate`
  - `other_unknown`

Validation completed:

- `tests/contracts/entrypoints/digest-orchestrator-fetch-runtime.test.js`
- `tests/contracts/harness/eval/retrieval/personas-runtime.test.js`
- `tests/contracts/harness/eval/retrieval/runner-runtime.test.js`

Focused live run completed:

- `retrieval-eval:2026-03-22T23-51-37-693Z`

Headline result:

- even with the run isolated to the five core standard categories:
  - `5_item_fulfillment_rate: 0%`
  - `withheld_after_retry_rate: 100%`
  - `lower_confidence_usage_rate: 0%`
- stale stayed `0%`
- provider `429` pressure stayed `0%`
- weak-source and noisy-fallback regressions did not return

What the isolated run proves:

- the earlier ambiguity was real:
  - previous `standard_core` evals were still sharing budget with the full standard-topic universe
- after fixing that, the conclusion is cleaner:
  - the main blocker is no longer “we might have stopped too early because other standard topics consumed the run”
  - the main blocker is that the surviving candidate pools for these categories are overwhelmingly review-tier and too weak to satisfy the shipping confidence bar

Category-by-category result from `retrieval-eval:2026-03-22T23-51-37-693Z`:

- `HEALTHCARE`
  - `raw 0 / cleaned 2 / internal 2 / final 0`
  - preferred calls `1`, broad calls `3`, remaining broad queries `0`
  - final blocker: `delivery_policy_score_threshold`
  - source-family mix in the internal final pool:
    - `review_tier: 2`
  - interpretation:
    - this bucket now fully exhausted broad depth in the isolated run
    - it still only produced review-tier candidates
- `LIFE SCIENCES`
  - `raw 1 / cleaned 1 / internal 1 / final 0`
  - preferred calls `1`, broad calls `3`, remaining broad queries `0`
  - final blocker: `delivery_policy_score_threshold`
  - source-family mix:
    - `review_tier: 1`
  - interpretation:
    - full broad exhaustion now happened here too
    - the surviving item is still below the shipping bar
- `TECHNOLOGY`
  - `raw 4 / cleaned 4 / internal 2 / final 0`
  - preferred calls `1`, broad calls `4`, remaining broad queries `0`
  - final blocker: `delivery_policy_score_threshold`
  - source-family mix:
    - candidate pool: `review_tier: 4`
    - internal final pool: `review_tier: 2`
  - interpretation:
    - query shaping increased yield, but not quality tier
    - this is still dominated by review-tier enterprise-tech/report-summary style material
- `STRATEGY`
  - `raw 1 / cleaned 1 / internal 1 / final 0`
  - preferred calls `1`, broad calls `4`, remaining broad queries `0`
  - final blocker: `delivery_policy_score_threshold`
  - source-family mix:
    - `review_tier: 1`
  - interpretation:
    - this bucket now fully exhausts its query pack in the isolated run
    - the surviving item quality is still not good enough to count toward the shipping promise
- `POLICY×REGULATORY`
  - `raw 0 / cleaned 0 / internal 0 / final 0`
  - preferred calls `1`, broad calls `3`, remaining broad queries `0`
  - final blocker: `delivery_policy_total_item_shortfall`
  - source-family mix:
    - none
  - interpretation:
    - this is now a cleaner zero-yield / no-conversion case, not a leftover-budget artifact

Category-by-category source-family breakdown:

- `HEALTHCARE`
  - candidate pool: `review_tier 2`
  - internal final: `review_tier 2`
  - final shipped: none
- `LIFE SCIENCES`
  - candidate pool: `review_tier 1`
  - internal final: `review_tier 1`
  - final shipped: none
- `TECHNOLOGY`
  - candidate pool: `review_tier 4`
  - internal final: `review_tier 2`
  - final shipped: none
- `STRATEGY`
  - candidate pool: `review_tier 1`
  - internal final: `review_tier 1`
  - final shipped: none
- `POLICY×REGULATORY`
  - candidate pool: none
  - internal final: none
  - final shipped: none

What this means:

- the standard-category problem is now clearer:
  - the system is not mainly blocked by stale items
  - it is not mainly blocked by `429`s
  - it is not mainly blocked by source blacklist/governance
- it is blocked because:
  - broad exhaustion on the five core categories still yields mostly review-tier material
  - the items that survive are too weak to clear the delivery confidence bar
  - `POLICY×REGULATORY` still has true low-yield behavior even after full exhaustion

Smallest realistic next changes if we keep tuning:

1. `TECHNOLOGY`
   - bias even harder toward Reuters/Bloomberg/FT/WSJ/official/regulatory enterprise-tech coverage
   - cut report-summary and CIO/IT-trade-review style retrieval paths further
2. `HEALTHCARE` and `LIFE SCIENCES`
   - bias toward official + top-tier specialist coverage and away from review-tier trade commentary
3. `POLICY×REGULATORY`
   - treat as a low-yield bucket unless a broader retrieval architecture change is made

Current candid recommendation after the isolated pass:

- for the five core standard categories, the daily `5`-item promise does **not** look realistically supportable under the current Perplexity-first retrieval architecture and current trust bar
- moderate additional tuning may improve some single-category yield
- it does **not** look likely to make daily five-item fulfillment reliable without a more meaningful retrieval redesign

## 2026-03-23 00:05 ET — final architecture recommendation

This closes the current retrieval-eval pass. The remaining question is no longer “which query should we tweak next?” It is “what retrieval architecture can actually support the product promise?”

### Internal plain-English summary

What we tested:

- the real production retrieval and selection pipeline
- no-send eval runs across standard categories and custom-heavy cases
- retrieval-side fixes for freshness, weak-source leakage, custom fallback, broad-query depth, rate-limit handling, and focused standard-category isolation

What we learned:

- the system is much cleaner than where it started:
  - stale leakage is `0%`
  - weak/noisy fallback is staying out
  - `429`s are no longer the dominant issue in focused runs
- but under a real 5-item contract, core standard categories still cannot ship:
  - isolated `standard_core` stayed at `0%` fulfillment
  - the remaining candidate pools are mostly review-tier or empty
  - the problem is now candidate quality and yield, not selection pollution

What decision this points to:

- if the product promise is truly “5 credible items every day,” the next step should be a retrieval redesign, not more local tuning

### What can still be done inside the current Perplexity-first architecture

These are the remaining practical moves that do **not** change the architecture:

1. stronger topic-family query packs
   - especially for `TECHNOLOGY`, `HEALTHCARE`, and `LIFE SCIENCES`
   - bias harder toward Reuters/Bloomberg/FT/WSJ/official/specialist journalism
   - suppress review-tier trade and summary-heavy domains earlier
2. better topic-to-source-family mapping
   - especially for low-yield policy/infrastructure topics
   - use source-family hints more deliberately before broad fallback
3. more selective preferred-first behavior
   - avoid spending too much time on preferred-domain passes when search-result evidence already shows low conversion
4. better candidate conversion diagnostics
   - keep distinguishing:
     - no retrieval
     - review-tier retrieval
     - good candidate found but failed policy gate

Expected impact:

- this path can probably move the system from `0%` fulfillment to “occasionally acceptable on good-news days”
- it does **not** look like the path to a reliable daily 5-item standard-category product

### What requires a more meaningful retrieval redesign

If we want the 5-item promise to be real, these are the changes that matter:

1. add a second retrieval source
   - not as a replacement, but as recall backfill when Perplexity returns thin or review-tier pools
   - use Perplexity for broad discovery, then another source for higher-trust/top-tier recall
2. split retrieval into two stages
   - stage 1: broad candidate discovery
   - stage 2: targeted source-specific retrieval against trusted/premium/specialist families for the weak topics that underperformed in stage 1
3. promote source-family retrieval to a first-class system behavior
   - instead of only query text + domain hints
   - example:
     - healthcare = official + top-tier specialist + top-tier business
     - policy = official/regulatory first, trusted legal/trade second, general media last
4. keep the trust bar where it is
   - the redesign should improve yield without reopening weak-source or filler behavior

Expected impact:

- this is the first path that looks plausibly capable of turning the current system into something operationally viable under a 5-item promise

### Directional viability estimate

My directional judgment:

- `current Perplexity-first architecture + more tuning`
  - likely improves diagnostics and some bucket-level results
  - unlikely to make daily 5-item fulfillment reliable
- `Perplexity-first + second retrieval source + targeted trusted-source retrieval layer`
  - most likely path to operational viability while preserving the current trust gains

If the goal is to move from `0%` to something actually usable, this second path is the one I would choose.

### Product-policy recommendation

I would frame the product decision as three options:

1. keep the 5-item promise and redesign retrieval
   - best choice if the promise is strategically important
   - requires meaningful retrieval work
2. keep the current architecture and relax the promise
   - simplest operational path
   - example:
     - “up to 5 items”
     - or a smaller daily minimum for narrower categories
3. move to a hybrid policy
   - standard categories: target 5
   - narrower/custom categories: precision-first with explicit lower guaranteed count

My recommendation:

- if the promise must stay “5 items daily,” redesign retrieval
- if retrieval redesign is not in scope soon, relax the promise rather than quietly underdelivering
- the hybrid policy is the most practical short-term product compromise, but it is still a product change, not a retrieval fix

### Final candid recommendation

- the system is now clean enough to trust the diagnosis
- the diagnosis says the present architecture is **not** enough for a daily 5-item promise at the current quality bar
- the next meaningful step is retrieval architecture work, not more narrow tuning

## 2026-03-23 00:15 ET — concrete retrieval redesign memo

This is the decision memo version of the recommendation.

### What the second retrieval layer should actually be

The second layer should **not** just be “another general AI search.” It should be a **targeted trusted-source retrieval layer** made of source types that Perplexity is currently weak at converting into deliverable candidates.

Recommended source/retrieval types:

1. official and regulatory feeds
   - structured or semi-structured sources such as:
     - agency newsrooms
     - filings
     - rulemaking feeds
     - trial/result registries
     - public consultation / enforcement pages
   - purpose:
     - improve recall on policy, healthcare, life sciences, and regulatory-heavy tech stories
2. curated publisher/source-family feed ingestion
   - direct RSS/feed or crawl ingestion for trusted source families already represented in the registry
   - purpose:
     - improve recall from Reuters / FT / WSJ / specialist trade press without relying on Perplexity to surface them
3. source-family retrieval by topic
   - not broad web search
   - explicitly query the source families that match the topic
   - purpose:
     - when Perplexity returns thin or review-tier results, the system immediately asks the right trusted family for that topic
4. optional SERP-style news retrieval
   - useful as a discovery/backfill layer, not as the main trusted layer
   - purpose:
     - catch fresh article URLs Perplexity missed
   - this should stay behind trusted-source filters and not become another noisy fallback

My practical recommendation:

- keep `Perplexity` as stage-1 discovery
- add:
  - `official/regulatory retrieval`
  - `curated publisher/source-family feed retrieval`
- use generic SERP/news retrieval only as a narrow backup, not as the core second layer

### Best retrieval approach by category

The right second-layer retrieval should follow the category family, not use one generic fallback everywhere.

#### Industries

##### Healthcare

Best second-layer mix:

- official healthcare / reimbursement / approval / rulemaking feeds
- top-tier specialist healthcare journalism feeds
- top-tier business press as supporting layer

Why:

- this category currently broadens into review-tier healthcare commentary
- the gap is better conversion of official and specialist coverage, not more generic discovery

##### Financial Services

Best second-layer mix:

- central bank / treasury / regulator / enforcement feeds
- top-tier financial journalism feeds
- specialist banking / payments / insurance trade sources with strong governance

Why:

- many real signals start in regulators, filings, or top-tier finance press
- this category benefits from strong primary-source recall before broader market commentary

##### Private Equity & M&A

Best second-layer mix:

- deal / filing / antitrust / bankruptcy / restructuring primary sources
- top-tier business journalism feeds
- trusted deal/trade publications as secondary support

Why:

- the key problem here is event detection and trusted conversion, not generic volume
- good PE/M&A coverage often ties directly to filings, announcements, and high-trust deal reporting

##### Energy

Best second-layer mix:

- utility / FERC / DOE / grid / permitting / power-market official sources
- trusted energy journalism and strong specialist trade feeds
- top-tier business press for market-moving stories

Why:

- energy often sits between infrastructure, policy, and commodity coverage
- official and specialist sources matter more than broad discovery alone

##### Consumer & Retail

Best second-layer mix:

- top-tier business journalism feeds
- trusted retail / consumer trade coverage
- filings / earnings / consumer-regulator sources as event support

Why:

- this category often has enough broad coverage, but quality improves when retail-specific trusted trade sources are directly ingested

##### Life Sciences

Best second-layer mix:

- official approval / trial / label / regulator sources
- specialist biotech/pharma journalism feeds
- company IR only as corroboration, not as a primary final source by itself

Why:

- this category is thin and weak at the same time
- high-signal items often originate in official or specialist sources before they appear broadly

##### Technology

Best second-layer mix:

- top-tier business/technology publisher feeds
- official/regulatory tech-policy sources
- company disclosures only when tied to filings or broadly covered events

Why:

- technology has volume already, but mostly review-tier volume
- the second layer should improve **source family quality**, not just count

##### Industrials

Best second-layer mix:

- top-tier business press
- trusted manufacturing / supply-chain / logistics trade sources
- filings / procurement / trade-policy sources for event confirmation

Why:

- industrial signals often come from capital spending, supply chain, reshoring, labor, and regulatory moves
- a mix of trusted business press and strong specialist trade is the right shape

##### Real Estate

Best second-layer mix:

- top-tier business / markets journalism
- trusted commercial real estate trade feeds
- rate / mortgage / zoning / permitting / REIT filing sources

Why:

- this category depends on a combination of market coverage, financing signals, and local/regulatory triggers
- official/filing coverage matters more than generic property news

##### Public Sector

Best second-layer mix:

- official government / procurement / rulemaking / budget sources
- trusted public-sector policy/trade publications
- top-tier press as supporting coverage

Why:

- this category is often closest to primary-source retrieval
- government, procurement, and rulemaking feeds should be first-class here

#### Capabilities

##### AI & Technology

Best second-layer mix:

- top-tier business/tech publisher feeds
- official AI policy / export control / standards / regulator sources
- trusted infrastructure / semiconductor / enterprise-tech specialist feeds

Why:

- this category currently broadens into noisy enterprise-tech summaries
- it needs stronger recall from trusted AI, semiconductor, and policy source families

##### Strategy

Best second-layer mix:

- top-tier business journalism feeds
- SEC / 8-K / investor-relations / deal / activist / bankruptcy / restructuring source retrieval
- selective legal/regulatory source retrieval for strategy events

Why:

- this category fails less on zero coverage and more on weak review-tier summaries
- it needs better recall from trusted business reporting and primary corporate-event sources

##### Policy & Regulatory

Best second-layer mix:

- official/regulatory sources first
- trusted legal / compliance / policy-trade publications second
- top-tier press third

Why:

- this bucket is often zero-yield in the current system even when official sources clearly exist
- this is the strongest case for first-class official-source retrieval

##### Sustainability & ESG

Best second-layer mix:

- official climate / disclosure / environmental / trade-policy sources
- trusted sustainability and energy-transition journalism
- top-tier business press for corporate/market impact

Why:

- ESG signals often come from policy, disclosure, and infrastructure developments before they become broad business stories

##### Digital Transformation

Best second-layer mix:

- top-tier enterprise-tech and business press
- trusted CIO / enterprise software / cloud / consulting-adjacent specialist sources
- official policy and procurement sources where public-sector digital is relevant

Why:

- this category overlaps technology and operations
- it needs stronger enterprise execution sources, not generic trend commentary

##### M&A Advisory

Best second-layer mix:

- top-tier business / deal journalism
- antitrust / competition / filing sources
- trusted restructuring / financing / transaction-specialist trade coverage

Why:

- this capability depends on transaction timing, regulation, financing, and sponsor behavior
- high-trust deal/event sources are more important than generic commentary

##### Talent & Workforce

Best second-layer mix:

- official labor / immigration / workplace-rule sources
- trusted workforce / HR / labor-market specialist publications
- top-tier business press for large employer and labor strategy moves

Why:

- this category mixes policy, labor markets, employer actions, and operating-model change
- it needs official and trusted specialist coverage more than generic management content

#### Custom topics

Best second-layer mix:

- entity-type classification first:
  - company
  - product / technology
  - regulator / policy
  - therapy / drug class
  - macro theme
  - infrastructure theme
- then route to the matching source families

Why:

- custom topics are not one retrieval problem
- the right follow-up source family depends on what the keyword actually is

### Phased implementation path

#### Phase 1: minimal engineering on top of current stack

Scope:

- keep current Perplexity-first flow
- after a thin or review-tier result, trigger one follow-up retrieval pass against:
  - official/regulatory sources for policy, healthcare, life sciences
  - curated publisher feeds for technology and strategy
- merge and dedupe those candidates into the existing cleanup/ranking flow

What this requires:

- source-family metadata by topic
- feed fetch/parsing for a limited trusted-source set
- follow-up retrieval orchestration when stage 1 underperforms

Why it is attractive:

- smallest engineering step with real upside
- preserves current ranking/selection architecture

#### Phase 2: moderate changes

Scope:

- add a persistent ingestion layer for trusted feeds and official sources
- store normalized candidate records before scoring
- make topic-to-source-family routing explicit and configurable
- improve custom-topic routing by keyword/entity class

What this requires:

- background ingestion jobs
- article normalization + dedupe across retrieval sources
- candidate broker logic before ranking

Why it matters:

- this is the level where retrieval starts becoming reliable instead of ad hoc

#### Phase 3: true retrieval redesign

Scope:

- build a multi-source candidate generation layer:
  - Perplexity or SERP-style discovery
  - official/regulatory retrieval
  - trusted publisher/source-family retrieval
- use stage-specific orchestration:
  - discovery
  - trusted-source recall
  - merge / dedupe / cluster
  - final ranking

What this requires:

- a real retrieval broker
- persistent candidate store
- source-family-aware routing as a first-class subsystem

Why it counts as the real redesign:

- this is no longer “query tuning”
- it changes candidate generation from one-provider search into a deliberate multi-source retrieval system

### Honest interim product policy

If retrieval is **not** redesigned immediately, my recommendation is:

- change the promise to:
  - `3-5 high-quality items daily`
  - or `up to 5 high-quality items daily`

I would **not** keep advertising a guaranteed 5-item daily promise under the current architecture.

If you want the blunt recommendation:

- short term:
  - relax the promise
- medium term:
  - redesign retrieval if five-item reliability is strategically important

### Simple decision table

| Model | Expected quality | Expected fulfillment | Engineering complexity | Recommendation |
| --- | --- | --- | --- | --- |
| Current architecture + current 5-item promise | High when it delivers, but too brittle | Poor / not operationally viable | Low | Do not recommend |
| Current architecture + relaxed promise | High | Moderate and honest | Low | Best short-term choice if redesign is not immediate |
| Redesigned retrieval + current 5-item promise | High | Good if executed well | High | Best choice if the 5-item promise matters strategically |
| Hybrid model | High | Moderate-to-good | Medium | Best transition path |

What I mean by `hybrid model`:

- retrieval:
  - Perplexity-first discovery
  - plus targeted trusted-source retrieval for weak families
- product policy:
  - broad standard categories aim for 5
  - narrower/custom categories are explicitly precision-first and may deliver fewer

### Directional recommendation on viability

My directional judgment:

- `current architecture + more tuning`
  - not enough
- `current architecture + relaxed promise`
  - workable as an interim product
- `Perplexity-first + targeted trusted-source second layer`
  - the most practical next engineering move
- `full multi-source retrieval redesign`
  - the path most likely to make the current 5-item promise genuinely real

## 2026-03-23 00:30 ET — Phase 1 plan for the 17 standard categories

This is the practical execution recommendation if the goal over the next few weeks is:

- keep the `5`-item expectation for standard digests
- stop spending energy on custom for now
- make the standard industries/capabilities obviously credible and materially more reliable

### My actual recommendation

If this were my product, I would do **one focused build first**:

- keep `Perplexity` as the broad discovery layer
- add a **trusted-source second pass for the 17 standard categories only**
- make that second pass source-family-driven, not prompt-driven
- ingest trusted publisher feeds + official/regulatory feeds into a small normalized candidate store
- merge those candidates into the current cleanup/ranking flow

I would **not** broaden fallback.
I would **not** keep tuning custom right now.
I would **not** relax the trust bar.

I would keep the standard product aimed at `5`, but I would treat the next few weeks as a standard-category hardening sprint rather than a general retrieval project.

### Phase 1 build: the smallest high-leverage thing

Build this:

1. a `standard trusted-source retrieval layer`
   - only for the 17 standard onboarding categories
   - runs after Perplexity if the category pool is:
     - too small
     - too review-tier heavy
     - too weak to satisfy the shipping bar
2. a small `source-family map`
   - each standard category points to trusted source families
3. a `feed/official-source ingestor`
   - poll curated trusted feeds and official sources on a short interval
   - normalize title/url/domain/date/topic-family into one candidate store
4. a `candidate merge step`
   - Perplexity candidates + trusted-source candidates
   - then dedupe, freshness, clustering, selection as today

Why this is the right first build:

- it is much smaller than a full retrieval rewrite
- it directly attacks the current bottleneck: trusted candidate supply
- it preserves the cleanliness gains already achieved

### Which standard categories are likely fine vs weak vs specialized

This is partly based on direct eval evidence and partly on inference from category shape. I am marking that explicitly.

#### Likely okay under current Perplexity-first approach, with light trusted-source support

Direct evidence is weaker here; this is mostly inference from category shape and how these topics usually behave:

- `Consumer & Retail`
- `Industrials`
- `Private Equity & M&A`
- `M&A Advisory`

What they likely need:

- Perplexity discovery
- plus light trusted publisher/trade feed support

These categories usually have enough mainstream and trade coverage that the main issue is quality shaping, not total absence.

#### Weak and likely need a trusted-source second layer quickly

Direct eval evidence or strong inference says these are the near-term problem set:

- `Healthcare`
- `Life Sciences`
- `Technology`
- `Strategy`
- `Energy`
- `Sustainability & ESG`
- `Digital Transformation`

What they need:

- Perplexity discovery
- plus direct trusted-source retrieval to improve quality tier and volume

These are the categories where the current system either:

- returns too few items
- returns mostly review-tier items
- or finds 1-2 good items but not enough trusted depth to get to 5

#### Need specialized routing, not just a generic trusted-source layer

These categories depend heavily on primary or domain-specific sources:

- `Policy & Regulatory`
- `Public Sector`
- `Financial Services`
- `Real Estate`
- `AI & Technology`
- `Talent & Workforce`

What they need:

- category-specific source routing
- usually including official / regulatory / filings / specialist trade sources

These categories are less about “more articles” and more about “the right source family first.”

### Source strategy by category

Below is the recommended trusted source base for each onboarding category.

#### Industries

- `Healthcare`
  - official healthcare regulators / reimbursement / rulemaking
  - top specialist healthcare journalism
  - high-trust business press
  - recommendation:
    - second-layer retrieval required

- `Financial Services`
  - central bank / treasury / banking / market regulators
  - top-tier financial journalism
  - trusted banking/payments/insurance trade sources
  - recommendation:
    - specialized routing required

- `Private Equity & M&A`
  - deal / antitrust / bankruptcy / filing sources
  - top-tier business journalism
  - trusted deal and restructuring trade coverage
  - recommendation:
    - likely okay with light trusted-source support

- `Energy`
  - utility / grid / power-market / permitting / energy-regulator sources
  - strong energy journalism
  - strong energy trade publications
  - recommendation:
    - second-layer retrieval required

- `Consumer & Retail`
  - top-tier business journalism
  - trusted retail / consumer trade sources
  - filings / earnings / consumer-regulator sources
  - recommendation:
    - likely okay with light trusted-source support

- `Life Sciences`
  - FDA / EMA / trial / approval / label / registry sources
  - specialist biotech/pharma journalism
  - selective company IR as corroboration only
  - recommendation:
    - second-layer retrieval required

- `Technology`
  - top-tier business/technology journalism
  - official tech-policy / export-control / regulator sources
  - strong enterprise-tech / semiconductor / infrastructure specialists
  - recommendation:
    - second-layer retrieval required

- `Industrials`
  - top-tier business journalism
  - manufacturing / logistics / supply-chain trade sources
  - trade-policy / procurement / filings where relevant
  - recommendation:
    - likely okay with light trusted-source support

- `Real Estate`
  - top-tier business / markets journalism
  - trusted CRE / housing / mortgage trade sources
  - zoning / permitting / REIT / finance sources
  - recommendation:
    - specialized routing required

- `Public Sector`
  - government / budget / procurement / rulemaking sources
  - trusted public-sector trade publications
  - high-trust press as support
  - recommendation:
    - specialized routing required

#### Capabilities

- `AI & Technology`
  - top-tier AI/tech business coverage
  - standards / export-control / regulator / official policy sources
  - semiconductor / model / infrastructure specialists
  - recommendation:
    - specialized routing required

- `Strategy`
  - top-tier business press
  - filings / IR / activist / restructuring / transaction sources
  - selective legal/regulatory support
  - recommendation:
    - second-layer retrieval required

- `Policy & Regulatory`
  - official/regulatory sources first
  - trusted legal / compliance / policy-trade sources second
  - top-tier press third
  - recommendation:
    - specialized routing required

- `Sustainability & ESG`
  - climate / disclosure / environmental / trade-policy official sources
  - trusted energy-transition and sustainability journalism
  - strong business press support
  - recommendation:
    - second-layer retrieval required

- `Digital Transformation`
  - enterprise-tech / cloud / software / CIO trusted sources
  - top-tier business/technology press
  - official procurement/policy sources where relevant
  - recommendation:
    - second-layer retrieval required

- `M&A Advisory`
  - deal journalism
  - antitrust / competition / financing / filing sources
  - restructuring and transaction trade coverage
  - recommendation:
    - likely okay with light trusted-source support

- `Talent & Workforce`
  - labor / immigration / workplace-rule official sources
  - trusted HR / labor-market / workforce strategy publications
  - top-tier business press
  - recommendation:
    - specialized routing required

### The product stance I recommend right now

My honest recommendation:

- keep the `5`-item expectation for the **standard** digests
- do **not** spend the next few weeks trying to make custom equally reliable
- build the standard trusted-source second layer first
- measure fulfillment only on the 17 standard categories during this hardening phase

Why:

- the standard categories are the core product
- getting them excellent is more important than making every custom case work
- the current diagnosis says the bottleneck is trusted supply, which this Phase 1 build directly addresses

I would only change the standard product promise if this focused standard-source build still fails materially.

### If I were building this over the next few weeks

This is the exact order I would do:

1. define a trusted source-family map for all 17 categories
2. implement a small ingestion layer for:
   - official/regulatory feeds
   - trusted publisher/trade feeds
3. add a standard-category-only second retrieval pass that fires when:
   - Perplexity pool is too small
   - or source-family mix is too review-tier heavy
4. merge those candidates into the existing pipeline
5. rerun the eval on the 17 standard categories only
6. judge success on:
   - 5-item fulfillment rate
   - source-family mix
   - stale rate
   - weak-source exposure

That is the smallest build I think has a real chance of making the standard digests feel strong enough that “getting to 5” stops feeling like a struggle.

## 2026-03-22 / 2026-03-23 - Phase 1 standard trusted-source second pass

### What changed

- Added `buildPreferredSourceFamilyShortlists(...)` in [src/runtime/preferred-source-registry-runtime.js](/Users/kushgulati/Desktop/signalbrief/src/runtime/preferred-source-registry-runtime.js) so the fetch layer can split a topic's preferred domains into:
  - `official_domains`
  - `reported_domains`
  - combined topic-aware trusted families
- Wired the fetch orchestrator to run a **standard-only trusted-source second pass** after the normal preferred + broad phases when a standard topic still looks thin or review-tier-heavy.
- Injected the new family-shortlist builder plus editorial annotations into:
  - [src/entrypoints/digest-orchestrator-core-runtime.js](/Users/kushgulati/Desktop/signalbrief/src/entrypoints/digest-orchestrator-core-runtime.js)
  - [src/eval/retrieval/runner-runtime.js](/Users/kushgulati/Desktop/signalbrief/src/eval/retrieval/runner-runtime.js)
- Added contract coverage for:
  - preferred-source family shortlists
  - trusted-source second-pass fetch behavior
  - freshness-safe custom fallback fixtures

### Why this was the right Phase 1 build

This was the smallest meaningful build for the standard products:

1. keep `Perplexity` as discovery
2. when a standard topic still looks weak, run one extra trusted-source pass
3. bias that pass toward official and reported source families already present in the registry
4. merge back into the existing dedupe / ranking / delivery path

This does **not** redesign retrieval yet. It answers whether the current architecture can be materially improved by adding a narrower trusted-source stage before doing a larger rebuild.

### Validation

- [tests/contracts/runtime/preferred-source-registry-runtime.test.js](/Users/kushgulati/Desktop/signalbrief/tests/contracts/runtime/preferred-source-registry-runtime.test.js)
- [tests/contracts/entrypoints/digest-orchestrator-fetch-runtime.test.js](/Users/kushgulati/Desktop/signalbrief/tests/contracts/entrypoints/digest-orchestrator-fetch-runtime.test.js)
- [tests/contracts/harness/eval/retrieval/runner-runtime.test.js](/Users/kushgulati/Desktop/signalbrief/tests/contracts/harness/eval/retrieval/runner-runtime.test.js)
- [tests/contracts/harness/digest/runtime/digest-data-fetch-runtime.test.js](/Users/kushgulati/Desktop/signalbrief/tests/contracts/harness/digest/runtime/digest-data-fetch-runtime.test.js)
- `scripts/test-critical-paths.js`

### Live eval result

Run:

- `retrieval-eval:2026-03-23T01-03-50-192Z`

Scenario:

- `standard_core`
  - `HEALTHCARE`
  - `STRATEGY`
  - `LIFE SCIENCES`
  - `TECHNOLOGY`
  - `POLICY×REGULATORY`

Key retrieval facts:

- trusted-source second pass used on all `5/5` topics
- trusted-source calls: `10`
  - official: `5`
  - reported: `5`
- fetch calls:
  - standard: `32`
- stale rate: `0%`
- provider `429` rate: `0%`

Product result:

- `5_item_fulfillment_rate = 0%`
- `withheld_after_retry_rate = 100%`
- lower-confidence usage stayed `0%`

Category outcome:

- `HEALTHCARE`
  - `1 raw / 5 cleaned / 5 internal / 0 final`
  - source-family mix: `review_tier 4`, `corporate 1`
  - final failure: `delivery_policy_score_threshold`
- `STRATEGY`
  - `2 / 2 / 2 / 0`
  - source-family mix: `review_tier 2`
  - final failure: `delivery_policy_score_threshold`
- `LIFE SCIENCES`
  - `2 / 3 / 3 / 0`
  - source-family mix: `review_tier 2`, `corporate 1`
  - final failure: `delivery_policy_total_item_shortfall`
- `TECHNOLOGY`
  - `0 / 0 / 0 / 0`
  - final failure: `zero_yield_broad`
- `POLICY×REGULATORY`
  - `2 / 2 / 2 / 0`
  - source-family mix: `review_tier 2`
  - final failure: `delivery_policy_total_item_shortfall`

### What this means

The trusted-source second pass is working mechanically:

- it fired where expected
- it did not reintroduce stale items
- it did not reintroduce noisy fallback
- it did not get blocked by rate limits in this run

But it did **not** materially improve the standard-category shipping outcome.

The main remaining problem is still trusted candidate supply:

- the search layer is seeing trusted domains in evidence
- but that evidence is not converting into enough promotable items
- once the system broadens, the retained pool still skews heavily `review_tier` or `corporate`

### Decision after Phase 1

This Phase 1 build was worth doing because it answers the next product question cleanly:

- adding one narrow trusted-source pass on top of the current Perplexity-first architecture is **not enough** to make the standard categories operationally viable under the current `5-item` trust bar

That points to a larger retrieval step next:

- feed / source-family ingestion
- official-source retrieval by category family
- or a broader multi-source retrieval broker
