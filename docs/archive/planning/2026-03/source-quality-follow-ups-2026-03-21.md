# Source Quality Follow-Ups — 2026-03-21

## Why this note exists

This memo captures the next set of source-quality, preferred-source, and admin-tooling follow-ups after the v1 and v2 source-selection work completed on March 21, 2026.

It is meant to preserve the short-term execution queue while the implementation details are still fresh.

## What is already in place

### Source governance foundation

- source governance registry with `source_type`, `policy`, `review_status`, `topic_fit`, and `originality_profile`
- policy-aware ranking consequences
- subdomain inheritance
- governance-oriented admin console
- compatibility with legacy tier and authority fields
- `unknown` shifted toward unreviewed/review semantics instead of weak-by-default

### Preferred-source v1

- config-driven preferred-source registry
- global preferred reported and official sources
- topic-specific preferred sources
- retrieval-time shortlist generation
- Sonar `search_domain_filter` integration
- narrow two-pass retrieval
- preferred-aware reranking
- fallback when preferred retrieval is too thin

### Preferred-source v2

- publisher/platform identity extraction scaffold
- better close-substitute logic
- stronger derivative suppression heuristics
- better coverage-gap handling
- richer preferred-source diagnostics and counters

## Execution status

- [x] Identity-level governance storage and lookup now exist in runtime resolution, with exact identity match winning before domain fallback
- [x] Identity-aware source annotation now carries the winning identity override through editorial signals
- [ ] Admin editing and inspect UX is still mostly domain-first
- [ ] Diagnostics-driven curation queues are still pending
- [ ] Story/event fingerprinting is still heuristic and should be strengthened

## Highest-leverage next steps

### 1. Add identity-level governance overrides

Current state:
- v2 can detect sub-identity on some platforms
- governance is still mostly domain-first

Next change:
- let the registry accept keys like `youtube:@channel`, `substack:publication`, or `medium:author`
- fall back to domain-level policy only when no identity-level rule exists

Why it matters:
- fixes the biggest remaining precision gap
- allows strong publishers on coarse platforms to be reviewed correctly
- prevents blessing an entire platform just to allow one good publisher

Best modules to extend:
- [source-policy-registry-runtime.js](../../../../src/runtime/source-policy-registry-runtime.js)
- [source-domain-runtime.js](../../../../src/digest/domain/source-domain-runtime.js)
- [storyline-domain-runtime.js](../../../../src/digest/domain/storyline-domain-runtime.js)

### 2. Turn diagnostics into a curation loop

Current state:
- the system now records preferred displacements, derivative suppressions, specialist wins, fallback rescues, and coverage-gap signals
- those signals are not yet turned into a consistent operator workflow

Next change:
- build admin-facing review queues from diagnostics such as:
  - specialist domains that repeatedly beat preferred globals
  - high-volume derivative domains that often lose
  - platform identities that remain ambiguous
  - topics where preferred retrieval often falls back

Why it matters:
- makes preferred-source expansion evidence-based instead of list-based
- gives editorial/admin work a measurable feedback loop

Best modules to extend:
- [admin-source-registry-runtime.js](../../../../web/services/admin-source-registry-runtime.js)
- [admin-digest-insights-runtime.js](../../../../web/services/admin-digest-insights-runtime.js)
- [admin-source-registry.html](../../../../web/admin-source-registry.html)

### 3. Improve event/story fingerprinting

Current state:
- v2 substitute logic is better, but story equivalence is still heuristic

Next change:
- strengthen the event fingerprint layer using:
  - normalized entities
  - dates
  - title overlap
  - cited-source overlap
  - preferred-source evidence from search results
  - source-family hints

Why it matters:
- improves "best representation of the same story" decisions
- reduces weak wrappers surviving because they were fetched first
- makes preferred/global vs specialist trade comparisons more accurate

Best module to extend:
- [storyline-domain-runtime.js](../../../../src/digest/domain/storyline-domain-runtime.js)

### 4. Expand the preferred registry selectively from observed wins

Current state:
- the preferred-source registry is seeded and working
- there is still a risk of undercoverage if the list stays static

Next change:
- promote sources only when observed diagnostics justify it
- prioritize domains that:
  - repeatedly win as specialist best-fit in one topic
  - repeatedly rescue fallback coverage in one topic
  - provide earlier or stronger coverage than global preferred sources

Why it matters:
- keeps the registry curated and high-signal
- improves retrieval without turning the system into a giant allowlist

Best file to update:
- [preferred-sources.json](../../../../data/preferred-sources.json)

### 5. Clean up score-band semantics

Current state:
- admin UI now correctly renders `70.3 DECENT` as yellow
- underlying score-band semantics still drift between `strong/watch/poor` and `strong/decent/weak`

Next change:
- normalize the score-band naming and thresholds across:
  - runtime scoring
  - admin rendering
  - persisted quality band values
  - digest formatting/debug copy

Why it matters:
- avoids mixed signals in operations and QA
- keeps admin labels, stored bands, and visible colors aligned

Best module to extend:
- [quality-score.js](../../../../src/runtime/quality-score.js)

## Other top-of-mind features and bug fixes

These are not necessarily larger than the items above, but they are high-signal follow-ups based on the last 10 hours of work.

### Backfill audit history for batch-applied governance edits

We batch-applied a confident set of source-governance changes directly to the registry. The effective notes and updated-by fields are present, but the audit log history was not backfilled entry-by-entry.

Follow-up:
- add an admin/service path to emit historical audit entries for direct registry mutations
- or require future batch updates to go through a batch-aware audited write path

### Surface preferred/derivative diagnostics directly in source governance UI

We already compute useful counters, but the source console still under-surfaces them.

Follow-up:
- show signals like:
  - preferred wins
  - derivative suppressions
  - specialist beats preferred
  - fallback rescues
  - platform ambiguity

This makes the source governance console more actionable.

### Harden preferred-source config visibility and runtime fallback

We fixed the admin panel showing an empty preferred-source config by adding bundled fallback support. That solved the immediate problem, but the system should still make fallback mode more explicit operationally.

Follow-up:
- emit a startup/runtime warning when bundled fallback is active
- add a small admin status pill for `runtime config` vs `bundled fallback`
- consider a sync command that seeds runtime config from bundled config on first boot

### Add identity details to admin inspect views

The system can now detect platform publisher identity more intelligently, but the admin source console is still largely domain-oriented.

Follow-up:
- show the parsed best-available source identity on inspect pages
- indicate whether policy came from:
  - identity-level match
  - domain-level direct override
  - inherited family override
  - baseline

### Add a lightweight "why this source won" readout

The system now makes more nuanced substitute decisions, but operators still need faster explanation.

Follow-up:
- expose winner/suppression reason codes in digest debug panels and admin insights
- examples:
  - `official_primary_won`
  - `preferred_replaced_weak_derivative`
  - `specialist_best_fit_won`
  - `broad_fallback_found_better`

### Add a registry review queue for unresolved platform ambiguity

Platform identity is still imperfect.

Follow-up:
- add a queue for domains/items where:
  - platform identity was ambiguous
  - the source appeared often
  - it materially influenced ranking or replacement decisions

### Review packaging/runtime expectations for checked-in config files

The preferred-source config issue exposed a broader packaging risk: checked-in config and runtime data do not always travel through the same deploy path.

Follow-up:
- explicitly document which config files are:
  - bundled into deploy artifacts
  - expected at runtime under `/app/data`
  - allowed to fall back to checked-in defaults

### Add retrieval budget guardrails to cap search cost

Goal:
- cap Perplexity-heavy fetch expansion without lowering the digest quality floor

Implementation:
- add internal `CONFIG.digest.search_budget` defaults:
  - scheduled: `soft_calls=24`, `hard_calls=36`
  - on-demand: `soft_calls=6`, `hard_calls=9`
  - custom-topic reserve: `3` calls max per run
- move retrieval from per-topic retry loops to a phased run-level allocator:
  - Phase 1: one initial query per standard topic
  - Phase 2: one extra preferred retry only for thin, high-priority topics
  - Phase 3: one broad fallback only for thin, high-priority topics while under the soft cap
  - custom topics spend from a reserved call pool instead of competing with the full standard run
- gate extra retries on marginal yield:
  - only retry when a topic has fewer than `2` usable post-dedup candidates
  - stop spending more on a topic after zero-yield retries indicate `repeat` or `topic_fit`
  - stop additional retries after `2` consecutive zero-yield retry attempts
- preserve quality behavior:
  - do not relax source filters, repeat suppression, or quality thresholds to hit the cap
  - if the budget runs out, prefer a smaller high-quality pool over weak padding
  - keep existing withhold behavior when the final pool is still too weak
- extend internal diagnostics and admin exports with:
  - `search_budget_soft_calls`
  - `search_budget_hard_calls`
  - `search_budget_calls_used`
  - `search_budget_exhausted`
  - `broad_fallback_topics_used`
  - `zero_yield_retry_count`
  - `budget_stop_reason`

Validation:
- scheduled healthy runs should stay under the soft cap without shrinking normal digest depth
- thin-pool runs should never exceed the hard cap and should surface the budget stop diagnostics
- on-demand runs should stay within the smaller on-demand budget
- broad fallback should be skipped for topics that already have enough usable preferred-pass coverage

## Suggested execution order

1. identity-level governance overrides
2. admin curation queues from preferred/derivative diagnostics
3. stronger event/story fingerprinting
4. selective preferred-registry expansion from observed winners
5. score-band terminology cleanup
6. audit-log backfill for direct batch governance writes
7. stronger admin surfacing for preferred-source and derivative diagnostics

## Short version

The biggest remaining gap is no longer "can we prefer better domains?"

It is:
- can we identify the best publisher when a domain is too coarse?
- can we tell which candidate is the best version of the same story?
- can ops/admin clearly see where the system is still making the wrong tradeoff?
