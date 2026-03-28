## 2026-03-27 Update — QA Audit Against Current Codebase

Audit basis: `reduced scope mvp.md` against the merged/deployed code at commit `c2492f70d63edeef8d2e96b3964f619654ba4125`.

Verdict: the scheduled email path is much closer to the reduced-scope MVP, but the codebase does not fully match the spec yet. The main runtime behavior is mostly pointed in the right direction; the biggest failures are incomplete architectural cleanup, incomplete source/control cleanup, and legacy scope still leaking into active modules.

### A. Fully implemented and aligned

- The hard `5 items per topic` shipping contract is enforced in the scheduled path; underfilled topic buckets are withheld rather than sent. Files: `src/entrypoints/digest-orchestrator-selection-runtime.js`, `src/entrypoints/digest-orchestrator-delivery-runtime.js`, `src/runtime/config-provider.js`.
- The `48h` freshness ceiling is enforced in fetch, scoring, selection, and tuning validation. Files: `src/entrypoints/digest-orchestrator-fetch-runtime.js`, `src/domains/scoring/score-candidate.js`, `src/runtime/digest-tuning-runtime.js`.
- The live delivery path is email-only; Telegram is rejected in signup/settings and not used in delivery. Files: `web/services/web-user-signup-actions-runtime.js`, `web/services/web-user-settings-runtime.js`, `src/entrypoints/digest-orchestrator-delivery-runtime.js`.
- Founder/operator auditability is strong: topic/day audit, lane mix, candidate diagnostics, source health, and rerun diagnostics are all present. Files: `src/entrypoints/digest-orchestrator-core-runtime.js`, `web/routes/admin-api-digest-audit-runtime.js`, `web/admin.html`.

### B. Partially implemented

- The active broker path is reduced to the 7 MVP topics, but old topic taxonomy still exists in shared active modules. Files: `src/runtime/standard-topic-broker-runtime.js`, `src/digest/domain/storyline-domain-runtime.js`, `src/runtime/topic-normalization-runtime.js`.
- `One story to one best-fit topic` is implemented through storyline clustering plus canonical topic reassignment, but it is still heuristic, not a hard event-identity guarantee. Files: `src/entrypoints/digest-orchestrator-selection-runtime.js`, `src/digest/domain/storyline-domain-runtime.js`, `src/runtime/standard-topic-broker-runtime.js`.
- Repetition handling exists via repeat history, cross-day dedupe, follow-up classification, and history suppression, but `distinct new angle` is still inferred rather than explicitly enforced. Files: `src/entrypoints/digest-orchestrator-selection-runtime.js`, `src/entrypoints/digest-orchestrator-core-runtime.js`.
- RSS/direct-first with discovery capped is implemented, but there is no separate 4-hour ingest/cache backbone; feed retrieval still appears tied to digest runtime. Files: `src/entrypoints/digest-orchestrator-fetch-runtime.js`, `src/runtime/standard-topic-broker-runtime.js`, `src/entrypoints/scheduler-worker.js`.
- Depth modes reuse the same selected items, but scan still runs enrichment and final bucketing can still use `relevanceScore`. Files: `src/runtime/digest-depth-runtime.js`, `src/digest/runtime/digest-data-enrich-runtime.js`, `src/runtime/digest-delivery-policy-runtime.js`.
- Source/admin controls are useful, but not complete: source enable/tier, topic feed/official toggles, tuning, reruns, regeneration, and editorial override APIs exist, but there is no per-topic discovery toggle and no obvious first-class `add broker source` flow. Files: `web/routes/admin-api-source-registry-runtime.js`, `web/admin-source-registry.html`, `web/routes/admin-api-digest-tuning-runtime.js`, `web/routes/admin-api-editorial-overrides-runtime.js`.

### C. Still missing

- A distinct `every 4 hours` feed-ingestion backbone/cache, separate from the daily send path. Files: `src/entrypoints/digest-orchestrator-fetch-runtime.js`, `src/entrypoints/scheduler-worker.js`.
- Per-topic discovery-lane on/off control. Files: `web/routes/admin-api-source-registry-runtime.js`, `web/admin-source-registry.html`.
- A clean archive/deprecated boundary for removed runtime/config code. Most old code is still co-located with active code rather than moved under archive/deprecated.

### D. Still conflicts with the spec

- Old topic families like `policy regulatory`, `public sector`, `digital`, `sustainability`, `pe m a`, and `talent` still live in active shared modules. Files: `src/digest/domain/storyline-domain-runtime.js`, `src/runtime/topic-normalization-runtime.js`, `src/runtime/preferred-source-registry-runtime.js`.
- The public `/digest/:date?` route still exists in the active router, even though it only redirects/fails rather than serving a public digest. Files: `web/routes/public-static.js`.
- `consultant_lens_mode` still leaks through the public user record/preferences surface, which is out of scope for this MVP. Files: `web/routes/core-api.js`.
- The old preferred-sources registry still coexists with the broker registry, so the source registry is not truly singular. Files: `src/runtime/preferred-source-registry-runtime.js`, `config/preferred-sources.json`, `config/standard-topic-broker-sources.json`.

### E. Old/out-of-scope features still active in the main codepath

- Legacy topic aliasing and related-topic logic still influence active topic-fit/scoring behavior. Files: `src/digest/domain/storyline-domain-runtime.js`, `src/runtime/topic-normalization-runtime.js`.
- `/digest` remains an active public route, even if neutered. Files: `web/routes/public-static.js`.
- `consultant_lens_mode` is still part of the active public API contract. Files: `web/routes/core-api.js`.

### F. Archived/deprecated successfully

- Deprecated user-facing fields are mostly removed from active signup/settings/admin payloads and rejected on write: `telegram`, `items_per_digest`, `topic_weights`, `custom_keywords`, `watchlist`, `source_preferences`, `bookmarks`. Files: `web/services/web-user-signup-actions-runtime.js`, `web/services/web-user-settings-runtime.js`, `web/routes/core-api.js`.
- Public on-demand digest serving is behaviorally retired; archive browsing remains. Files: `web/routes/public-static.js`, `web/routes/core-api-archive-runtime.js`.
- Caveat: this is behavioral deprecation, not structural archival. Very little is actually moved under archive/deprecated beyond docs/tests.

### G. Technically works but violates the spirit of the spec

- Selection can underfill internally and only fail closed at delivery time; that meets the send contract but not the cleanest `always assemble 5 strong signals or stop earlier` intent. Files: `src/entrypoints/digest-orchestrator-selection-runtime.js`, `src/entrypoints/digest-orchestrator-delivery-runtime.js`.
- `scan` depth still triggers enrichment work; the spec explicitly wanted depth to affect writeup length, not selection, and did not want scan to require Claude. Files: `src/runtime/digest-depth-runtime.js`, `src/digest/runtime/digest-data-enrich-runtime.js`.
- Final per-topic bucket order can depend on `relevanceScore`, which is too close to old relevance/personalization logic for a strict MVP reading. Files: `src/runtime/digest-delivery-policy-runtime.js`.
- The product behavior is reduced-scope; the codebase itself is not yet reduced-scope.

### Feature-by-feature status table

| Spec area | Expected behavior | Current implementation | Status | Files involved | Recommended next action |
|---|---|---|---|---|---|
| Topic scope | Only 7 MVP topics active | Broker runtime uses 7 topics, but old topic taxonomy remains in shared active modules | Partial | `src/runtime/standard-topic-broker-runtime.js`, `src/digest/domain/storyline-domain-runtime.js`, `src/runtime/topic-normalization-runtime.js` | Remove non-MVP topics/aliases from active shared code and archive them |
| Exactly 5 items/topic | Every delivered topic digest has exactly 5 items | Delivery withholds underfilled topics; config is fixed at 5 | Aligned | `src/entrypoints/digest-orchestrator-selection-runtime.js`, `src/entrypoints/digest-orchestrator-delivery-runtime.js`, `src/runtime/config-provider.js` | Keep; optionally fail earlier in selection for cleaner semantics |
| Freshness max 48h | Never exceed 48h | Hard-clamped in fetch/scoring/selection/tuning | Aligned | `src/entrypoints/digest-orchestrator-fetch-runtime.js`, `src/domains/scoring/score-candidate.js`, `src/runtime/digest-tuning-runtime.js` | Keep |
| One story to one topic | Best-fit topic only | Storylines are clustered then canonically reassigned | Partial | `src/entrypoints/digest-orchestrator-selection-runtime.js`, `src/digest/domain/storyline-domain-runtime.js` | Add a harder cross-topic uniqueness rule keyed by storyline/event |
| Repetition across days | Avoid repeats unless clearly new angle | Repeat index, history suppression, follow-up logic exist | Partial | `src/entrypoints/digest-orchestrator-selection-runtime.js`, `src/entrypoints/digest-orchestrator-core-runtime.js` | Make `new angle` auditable and explicit in rejection/keep reasons |
| RSS/direct backbone | Feed/direct sources drive retrieval; discovery only supplements | Broker-first, discovery capped, but no separate ingest backbone found | Partial | `src/entrypoints/digest-orchestrator-fetch-runtime.js`, `src/runtime/standard-topic-broker-runtime.js`, `src/entrypoints/scheduler-worker.js` | Build a 4-hour ingest/cache job and score from stored candidates |
| Discovery as supplement only | AI search not backbone | Discovery share is capped and visible, but control surface is incomplete | Partial | `src/entrypoints/digest-orchestrator-fetch-runtime.js`, `web/admin.html`, `web/admin-source-registry.html` | Add per-topic discovery toggles and clearer operator controls |
| Email-only MVP | No Telegram/user-channel branching | Signup/settings reject Telegram; delivery sends email only | Aligned | `web/services/web-user-signup-actions-runtime.js`, `web/services/web-user-settings-runtime.js`, `src/entrypoints/digest-orchestrator-delivery-runtime.js` | Keep |
| Depth modes | Change writeup length only, not selection | Same selected items reused, but scan still enriches and bucket order can use relevanceScore | Partial | `src/runtime/digest-depth-runtime.js`, `src/digest/runtime/digest-data-enrich-runtime.js`, `src/runtime/digest-delivery-policy-runtime.js` | Skip enrichment for scan; order by `_score` only |
| Auditability | Founder can inspect what went in and why | Audit docs, lane mix, source health, topic rerun diagnostics exist | Aligned | `src/entrypoints/digest-orchestrator-core-runtime.js`, `web/routes/admin-api-digest-audit-runtime.js`, `web/admin.html` | Keep |
| Source registry and controls | Single source of truth with operator controls | Strong controls exist, but legacy preferred-source config remains and discovery toggle is missing | Partial | `web/routes/admin-api-source-registry-runtime.js`, `config/preferred-sources.json`, `config/standard-topic-broker-sources.json` | Make broker registry sole source of truth; remove legacy registry |
| Deprecated/out-of-scope cleanup | Old features removed from active path and archived cleanly | Public/admin payloads are mostly clean, but old code/config/routes still remain nearby or active | Conflicting | `web/routes/core-api.js`, `web/routes/public-static.js`, `src/runtime/user-contract-runtime.js` | Delete/archive legacy code instead of only stripping it at the edges |

### Dead code, stale config, unused routes, or hidden coupling still left behind

- `config/preferred-sources.json`: legacy registry with many non-MVP topics.
- `src/runtime/preferred-source-registry-runtime.js`: legacy fallback logic and aliases still present.
- `src/runtime/topic-normalization-runtime.js`: related-topic groups still include removed topic families.
- `src/digest/domain/storyline-domain-runtime.js`: active shared domain file still carries a large pre-MVP topic universe.
- `src/runtime/digest-delivery-policy-runtime.js`: legacy custom-keyword/confidence machinery remains in an active module.
- `web/routes/public-static.js`: `/digest` compatibility route still shipped.
- `src/runtime/user-contract-runtime.js`: model-cleanup is incomplete; removed fields are still stripped rather than absent by construction.
- `config/standard-topic-broker-sources.json`: still includes disabled `POLICY×REGULATORY`.

### Risky assumptions made during implementation

- This audit checks code paths, not live content quality across recent real digest days.
- It does not inspect a full run-history sample to prove operational metrics like `>=15 candidates/topic/day` or `0 duplicate URLs across consecutive days`.
- It treats this markdown file as the sole source of truth because that was the instruction.
- It assumes commit `c2492f70d63edeef8d2e96b3964f619654ba4125` is the right audit target because it matches the merged/deployed worktree inspected.

### The 5 biggest gaps or concerns remaining

1. No clear separate 4-hour feed-ingestion backbone/cache.
2. Legacy topic/config/runtime surface is still too large for a true reduced-scope MVP.
3. Source registry is not truly singular, and discovery-lane controls are incomplete.
4. Story/topic uniqueness and repeat handling are still heuristic, not hard guarantees.
5. Depth-mode implementation still leaks old behavior through enrichment work and `relevanceScore` ordering.

### Top 3 highest-leverage next fixes

1. Build a real broker/feed ingest layer on a 4-hour cadence and rank from stored candidates, not just digest-time fetches.
2. Delete/archive non-MVP topic machinery and make `config/standard-topic-broker-sources.json` the sole source registry; remove `config/preferred-sources.json`, `/digest`, and `consultant_lens_mode`.
3. Lock selection semantics: hard one-story/one-topic enforcement, `_score`-only ordering after selection, and no enrichment for scan mode.

Bottom line: the main scheduled product flow is mostly pointed at the reduced-scope MVP, but the codebase is not yet cleanly reduced to it. The runtime is closer than the repository structure.

SignalBrief MVP — Architecture Reset & Build Plan (v2)

1. MVP Product Definition
What it is
A daily newsletter that delivers exactly 5 high-quality, fresh, credible signals per topic area, sourced primarily from a curated registry of trusted publications and official sources. One email per subscriber per day. The founder can see exactly what went in, what was considered, and why. Subscribers choose their read depth — scan, brief, or deep — and can browse an archive of past digests.
The product should feel crisp, relevant, non-duplicative, and worth opening. The goal is not maximum breadth. The goal is a product that a strategy-oriented professional opens every morning because it is consistently useful.
What it is not
Not a personalization engine
Not a broad discovery tool
Not a real-time intelligence product
Not a multi-channel platform (Telegram, Slack, etc. — email only for MVP)
Not powered by AI search as the backbone
User promise
"Every morning, you get 5 signals that matter in your sector. Every link is from a source you'd trust. Every item is fresh. Read at whatever depth fits your morning."
Two clarifications to the original promise:
The 5-item promise sticks
Freshness should be understood as within 48 hours max, with a preference for the last 24 hours
Topic set: 7 topics
Healthcare
Life Sciences
Technology
Energy
Financial Services
Consumer & Retail
Industrials
Policy & Regulatory is dropped entirely for MVP. Regulatory items that are sector-specific (FDA approvals, FERC orders, etc.) should surface through the relevant sector's official sources — they do not need their own topic lane.
Each topic operates as its own independent lane. A subscriber picks 1–3 topics. They get 5 items per topic per day.
Topic boundary defaults:
Healthcare = payers, providers, health systems, reimbursement, care delivery, healthcare operations
Life Sciences = pharma, biotech, therapeutics, drug development, commercialization, and adjacent company/regulatory dynamics
If a story could fit multiple lanes, it should appear in one best-fit digest only, not multiple.
Depth modes (always 5 items)
Mode
What you get
Read time
Scan
Headline + source link
~60 seconds
Brief
Headline + one-line takeaway
~2 minutes
Deep
Headline + strategic "why it matters" analysis
~4 minutes

Depth is a per-subscriber setting that controls enrichment output length. It does not change the number of items, the scoring, or the selection logic. The same 5 items are selected regardless of depth — only the writeup changes.
The writing should feel like a smart mix of journalism and operator/strategy thinking: specific, useful, and grounded, with some interpretation but without making things up.

2. Recommended Architecture
Overview
[Source Registry] → [Ingestion Lanes] → [Candidate Pool] → [Normalize] → [Score & Rank] → [Select 5] → [Enrich by Depth] → [Deliver + Archive]
Every step should be inspectable. Every step should log. The founder should be able to see every candidate, every score, and every selection decision.
The key architectural principle is: source-first, AI-assisted, fully auditable.
2.1 — Source Registry (already partially built)
The admin dashboard already shows a per-topic source registry with reporter and official/primary columns. This is the right structure. The registry should be the single source of truth for what feeds the system.
Each source entry:
{
 "source_id": "stat-news",
 "name": "STAT News",
 "domain": "statnews.com",
 "topics": ["healthcare", "life_sciences"],
 "type": "reporter",
 "feed_url": "https://www.statnews.com/feed/",
 "tier": 1,
 "enabled": true,
 "notes": "Gold standard for pharma/biotech/health policy"
}
Fields that matter:
topics: which lanes this source feeds
type: reporter or official (matching the existing admin columns)
tier: 1 (gold — always trusted), 2 (good — generally reliable), 3 (supplemental)
enabled: founder toggle, on/off per source
Target: 8–15 sources per topic, ~70–100 total across 7 topics.
The source registry already covers most of this. The work is:
ensure every source has a working RSS/Atom feed URL where possible
assign tiers
verify topic mappings
make tiering reflect credibility, editorial clarity, sector relevance, and consistency of useful output, not prestige alone
Default source philosophy:
mostly trusted trade press
meaningful official / primary sources
limited discovery supplementation
2.2 — Ingestion Lanes
Three lanes, in priority order:
Lane 1: RSS/Direct Feed (primary — target: 70%+ of candidates)
This is the lane that needs to be built or completed. It is the backbone of the MVP.
Standard RSS/Atom parsing for each source in the registry
Run every 4 hours (or on cron: 6am, 10am, 2pm, 10pm ET)
Deduplicate by URL
Store raw items with: title, URL, source_id, published_date, raw_description, topic(s)
This is boring and reliable. That's the point.
Current state: RSS ingestion is just starting to be built. This is the #1 build priority. Until RSS is reliably producing 15+ candidates per topic per day, the system cannot be trusted.
Lane 2: Official/Regulatory Sources
Direct API or page scrape for government/official sources already in the registry (FDA.gov, SEC.gov, CMS.gov, etc.)
These sources often don't have great RSS. Build simple scrapers per source.
Tag as official type so they get a slight scoring boost
Can be built in Phase 2 if RSS alone provides sufficient candidates
Lane 3: Discovery / AI Search (supplement — ≤ 20% of candidates)
This is where Perplexity Sonar currently lives. Today, Perplexity is likely doing most of the heavy lifting. The MVP transition plan:
Week 1–2: Build RSS ingestion alongside Perplexity. Run both. Log which candidates come from which lane.
Week 3–4: Measure RSS candidate volume. If RSS produces 15+ per topic, begin reducing Perplexity's role to gap-filling only.
Week 5+: Perplexity runs once daily per topic as a discovery supplement. Any item that duplicates an RSS item gets dropped. Discovery items are tagged so the founder can see exactly how many made it through.
The transition is gradual, not a hard cutover. You do not rip out Perplexity on day one. You build RSS alongside it, prove RSS works, and then shift the balance. The admin dashboard should show lane contribution percentages so you can track this shift.
2.3 — Candidate Normalization
Every item from every lane gets normalized into a standard candidate object:
{
 "candidate_id": "sha256-of-url",
 "title": "FDA Approves First Gene Therapy for Sickle Cell Disease",
 "url": "https://www.statnews.com/2025/...",
 "source_id": "stat-news",
 "source_name": "STAT News",
 "source_tier": 1,
 "source_type": "reporter",
 "topic": "life_sciences",
 "lane": "rss",
 "published_at": "2025-03-22T14:30:00Z",
 "ingested_at": "2025-03-22T18:00:00Z",
 "freshness_hours": 3.5,
 "raw_description": "..."
}
Deduplication should start with URL dedup first. Then fuzzy title matching. The original suggested Jaccard similarity > 0.7 on title tokens and keeping the higher-tier source. That is a good MVP baseline.
But this needs to go one step further than simple dedup. The system should distinguish between:
exact duplicate
near-duplicate write-up of same story
same event, no meaningful update
same event, distinct follow-up angle
same broad theme, different actual signal
This matters because repetition across days is one of the biggest product risks.
2.4 — Scoring (MVP-simple)
No ML model. No complex ranking. A transparent, weighted formula remains the right default:
score = (freshness × 0.35) + (source_tier × 0.35) + (lane_bonus × 0.15) + (novelty × 0.15)
Where:
freshness (0–1): should now reflect a 48-hour max. Preference remains strong within 24 hours, but the system may score 24–48 hour items lower rather than excluding them entirely.
source_tier (0–1): Tier 1 = 1.0. Tier 2 = 0.7. Tier 3 = 0.4. Discovery/unknown = 0.2.
lane_bonus (0–1): RSS/direct = 0.8. Official/regulatory = 1.0. Discovery = 0.3.
novelty (0–1): should not just be “appeared in last 3 days = 0.” It should account for whether the item is a duplicate, a stale continuation, or a distinct new angle.
Every score should be explainable. Every score should be inspectable. The founder should be able to look at any candidate and understand why it scored what it scored.
One important addition: importance should be approximated more explicitly. For MVP, this can be done through a combination of:
breadth of coverage across credible sources
presence of official or primary announcement
relevance to major companies, regulators, or markets
likely strategic significance to a sector professional
This can be folded into scoring directly or used as a post-score ranking modifier, as long as it remains transparent and configurable.
2.5 — Selection of 5 Items
Score all candidates for a topic
Sort descending by score
Apply diversity constraint: no more than 2 items from the same source by default
Prefer spread across subthemes where possible
Take top 5
Order the final 5 with the most important item first
This section is where the biggest product update should be made.
The original doc said that if fewer than 5 candidates scored above threshold, the system should send fewer items with a “light news day” note. That is no longer the desired behavior.
Instead, the product should preserve the 5-item promise using a controlled fallback hierarchy:
strong event-driven items from the last 24 hours
strong event-driven items from 24–48 hours
one strong analysis/commentary item if still needed
never exceed the 48-hour freshness cap
No junk-padding. No low-value filler. But also no default behavior of sending 3 items and calling it a day.
Additional selection rules:
A story should appear in one best-fit digest only
The system should try hard not to repeat the same storyline on consecutive days
One follow-up is allowed if it adds a distinct new angle
Source cap is 2 by default, with 3 only as an exception on a low-volume day or via override
If multiple sources cover the same story, prefer the highest-tier, clearest source
Default tie-break between official and trade source: prefer the trade publication when it is clearer and more useful to the reader; prefer the official source when it is materially more primary or uniquely important
2.6 — Enrichment (depth-aware)
After selection, enrich each item according to the subscriber's depth setting. This is where Claude lives.
Depth
Claude's job
Prompt guidance
Estimated cost
Scan
No Claude call needed. Title + source link only.
—
$0.00
Brief
One-line takeaway per item
"Write a single sentence summarizing why this matters. Be specific, not generic."
~$0.005/topic
Deep
Strategic "why it matters" per item
"Write 2–3 sentences explaining the strategic significance for a senior professional. Reference specific implications."
~$0.01/topic

For efficiency: generate the deep enrichment for all selected items, then truncate for brief subscribers and omit for scan subscribers. This means one Claude call per topic regardless of subscriber mix.
Daily cost estimate from the original plan still seems directionally reasonable: 7 topics × ~$0.01 = ~$0.07 for enrichment, plus discovery supplement costs. Total daily run target remains low.
The key requirement is not just low cost, but output quality:
specific
crisp
strategically useful
non-generic
non-hallucinatory
The system can include both hard news and analysis/commentary as long as the output is worth opening and grounded in the source material.
2.7 — Admin / Operator View (builds on existing dashboard)
The admin dashboard already covers cost tracking, delivery calendar, subscriber management, source registry, and system health. Those should be extended rather than replaced.
The MVP additions:
Per topic, per day (new panel or page):
Total candidates ingested, broken down by lane (RSS vs. official vs. discovery)
Candidates after dedup
Score distribution: min, max, median of scored candidates
The 5 selected items with their individual scores and source attribution
Any warnings: source ingestion failures, weak candidate depth, unusual lane imbalance
Lane contribution percentage: "Today's Healthcare brief: 4 from RSS, 1 from discovery"
Potential missed-story warning: "This story appeared across multiple high-tier sources but was not selected"
Source health (extend existing source registry page):
Last successful ingestion timestamp per source
Items produced per day (rolling 7-day)
% of items that made it to final selection
Error log: feed parse failures, timeouts, 404s
Digest audit log (new, most important addition):
For any topic on any day: show all candidates considered, their scores, which were selected and which were rejected, and why
Show duplicate / repetition classification where relevant
Show whether an item was suppressed as a same-story repeat
This is the “why did my subscriber get this?” answering tool
Can be a simple expandable section on the existing admin page
Founder controls that should not require code changes:
enable/disable topic
enable/disable source
change source tier
pin item into final 5
exclude item from consideration
suppress source for today only
rerun one topic for one day
regenerate summaries only
adjust freshness windows
adjust source caps
adjust lane boosts / scoring weights
adjust repetition thresholds
The founder does not want to manually rewrite each digest, but does want strong control and fast iteration.
2.8 — Archive Browsing
Subscribers should be able to browse their past digests. This remains in Phase 1 because:
The data is already being generated daily — it just needs a read path
It builds subscriber stickiness and referenceability
It's a simple build: store each sent digest as JSON, render on a web page per subscriber
Implementation: after each digest is sent, save the rendered output (title, URL, enrichment text, topic, date) to a per-subscriber archive. Expose via a simple authenticated web page.

3. What to Cut from the Current Product
Remove entirely for MVP
Feature
Why cut it
Custom keywords
Adds complexity to scoring, retrieval, and testing. Not needed when topics are well-curated. Add back in Phase 2 only if subscribers ask for it.
Topics beyond the 7
Shrink from current set to 7 verticals. Each topic is a maintenance burden.
Policy & Regulatory as a standalone topic
Regulatory items surface through relevant sector official sources.
Per-user relevance scoring (60/40 formula)
Replace with transparent topic-level scoring and selection logic.
Telegram as delivery channel
Email only for MVP.
On-demand /digest command
Cut. The product is a daily push.
Bookmark system
Cut. Not core to the daily delivery promise.
Claude-powered Q&A on replies
Cut. This is a newsletter product, not an assistant product.
Items-per-digest toggle
Cut. It is always 5.

Simplify
Feature
Simplification
User preferences
Topic selection (1–3 of 7) + depth mode (scan/brief/deep). That's it.
Scoring
Keep the simple weighted model, but allow transparent tuning and add better repetition/importance handling.
Delivery
Email only. Single send time per user (or global default).
Store
Per-user schema shrinks: user_id, email, selected_topics, depth_mode, delivery_time.

Keep (already built, adds value)
Feature
Why keep it
Admin dashboard
Already solid. Extend with audit, controls, and missed-story visibility.
Source registry
Already built with reporter/official columns. Core to the MVP.
Cost tracking
Already working. Essential for operator control.
Delivery calendar
Already working. Useful for debugging.
Archive browsing
Low build cost, adds subscriber stickiness.
CRS / system health monitoring
Already built. Keep it, but do not add unnecessary complexity.

Defer to Phase 2
Feature
When to add
Custom keywords
After MVP works for 30 days and subscribers request it
Additional topics beyond the 7
After 7 topics are reliable for 30+ days
Telegram delivery
After email is stable
On-demand generation
After daily delivery is bulletproof
Bookmark system
After archive proves subscribers reference past digests
Advanced personalization
After basic topic + depth model is validated


4. Build Plan
Phase 1: Smallest version worth building (Weeks 1–4)
Week 1: RSS ingestion — prove the candidate pool
Verify or add RSS/Atom feed URLs for every source in the registry across all 7 topics
Build the RSS ingestion worker: fetch, parse, normalize, deduplicate, store
Run alongside existing Perplexity retrieval
Log everything: candidates per source, per topic, per lane
Success gate: ≥ 15 candidates per topic per day from RSS alone for at least 5 of 7 topics
Week 2: Scoring + selection
Implement the transparent scoring formula
Implement duplicate / repetition classification beyond URL dedup
Implement select top 5 with max-2-per-source default diversity
Implement fallback hierarchy to preserve the 5-item promise
Build the digest audit log
Run scoring on both RSS and Perplexity candidates side by side
Review output by hand for several days. Adjust tiers, weights, and thresholds based on what you see.
Week 3: Depth-aware enrichment + delivery
Implement Claude enrichment with 3 depth modes
Build the digest formatter for email
Email delivery via Resend/Postmark/SES
Archive storage: save each sent digest for browse-back
Wire up subscriber preferences: topic selection + depth mode
Week 4: Stabilization + RSS/Perplexity rebalancing
Run the full pipeline daily for 7 consecutive days
Review every digest across all 7 topics
Add the per-topic admin panel
Add potential missed-story flagging
Measure RSS vs. Perplexity contribution per topic
Begin reducing Perplexity weight where RSS is sufficient
Fix issues, adjust source tiers, tune scoring and repetition logic
Phase 1 exit criteria: 7 consecutive days where all 7 topics produce 5 credible items, ≥ 80% from Tier 1/2 sources, founder can audit any topic/day in under 60 seconds.
Phase 2: Layered improvements (Weeks 5–10)
Only after Phase 1 passes the exit criteria:
Official source scrapers: Add targeted scrapers for government sources (FDA, SEC, FERC, etc.) that lack good RSS
Discovery rebalancing: Finalize Perplexity's role as gap-filler. Set hard cap: ≤ 1 discovery item per topic per day unless RSS pool is thin.
Source expansion: Add 5–10 more sources per topic based on Phase 1 gap analysis
Custom keywords: If subscribers ask for it, add as a filter/boost on top of topic-level candidates
Telegram delivery: Re-add as a secondary channel
Analytics: Open rates, click-through on links, depth mode distribution

5. Success Criteria
Must-pass for MVP launch
Metric
Target
How to measure
Daily brief produced
100% of days, all 7 topics
Automated check: did the digest run complete?
Items per brief
5 of 5
Count selected items per topic per day
Freshness
5 of 5 items within 48 hours, with most ideally within 24 hours
Check published_at vs digest time
Trusted source share
≥ 80% of items from Tier 1 or Tier 2 sources
Log source_tier of selected items
No duplicate stories
0 duplicate URLs across 2 consecutive days in same topic
Dedup check in selection logic
Repetition control
Same storyline only repeated when there is a distinct new angle
Audit log / manual review
Source diversity
No more than 2 items from same source in a brief by default
Enforced in selection logic
Candidate pool depth
≥ 15 candidates per topic per day
Log candidate count after ingestion
Ingestion reliability
≥ 90% of enabled sources return items in a 24-hour window
Source health check
Admin visibility
Founder can see candidates, scores, misses, and selections for any topic/day within 60 seconds
Admin audit page exists and loads
Cost per daily run
≤ $0.15 total, directionally
Cost logger
Depth modes work
Scan, brief, and deep produce visibly different output for same 5 items
Manual review

Tracked but not blocking
Metric
What it tells you
Lane contribution % (RSS vs. discovery)
Whether the RSS-first transition is working
Source failure rate
Which sources are flaky and need replacement
Candidate score distribution
Whether scoring formula is well-calibrated
Potential missed-story flags
Whether the system is failing obvious editorial checks
Archive page visits
Whether subscribers actually reference past digests


6. Founder Control
Topic-level toggles
Enable/disable any of the 7 topics entirely
View topic health: candidate count, fill rate, source breakdown, lane contribution
Override: manually pin or exclude an item for today’s digest
Source-level controls (extend existing registry)
Enable/disable any source with a toggle
Change tier (promote/demote)
Per-source stats: items produced, items selected, failure rate, last active timestamp
Add a new source with one registry entry
Remove a source with one toggle
Lane-level toggles
Enable/disable RSS lane per topic
Enable/disable official/regulatory lane per topic
Enable/disable discovery lane (Perplexity) per topic
See per-lane contribution: what % of today’s digest came from each lane
Diagnostics
Digest audit log: every candidate considered, every score, every selection decision, every rejection with reason
Source ingestion log: timestamp of last successful pull, error count, items returned
Cost log: per-API-call cost breakdown
Delivery log: email sent/failed/bounced per subscriber
Lane health: per-topic breakdown of RSS vs. official vs. discovery candidates
Potential missed-story flags: stories that had strong signals of importance but were not selected
The 60-second test
The founder should be able to answer these questions in under 60 seconds each:
What did my Healthcare subscribers get this morning?
Why was this item selected over that one?
Is STAT News still producing content? When did we last get items from them?
How much did today’s run cost?
Are all 7 topics healthy or is one struggling for candidates?
Did every subscriber get their email?
What percentage of today’s items came from RSS vs. Perplexity?
Was there a major story we may have missed?
If any of these takes more than 60 seconds, the admin view is insufficient.

7. If Starting from Zero
Build first (Week 1)
RSS ingestion. This is the foundation and the biggest gap in the current system. If you cannot reliably get 15+ quality candidates per topic per day from curated RSS feeds, nothing else matters. Do not remove Perplexity — build RSS alongside it and measure. The source registry already exists; the work is wiring up actual feed parsing.
Build second (Week 2)
Scoring and selection. The transparent formula, applied to candidates from all lanes, plus better repetition logic, fallback rules, and source diversity. Review by hand. Tune weights. The goal is: you look at each day’s 5 selected items per topic and think, “yes, those are the right 5.”
Build third (Week 3)
Depth-aware enrichment and email delivery. Three prompt variants for Claude. Archive storage so digests are browsable after delivery.
Build fourth (Week 4)
Stabilize and rebalance. Run daily for a week. Fix edge cases. Add the admin audit panel. Add missed-story visibility. Start shifting weight from Perplexity to RSS where RSS coverage is sufficient.
Build later (Phase 2)
Official source scrapers (Lane 2)
Custom keywords
Telegram delivery
Advanced analytics
Topic expansion
Avoid entirely until MVP works
ML-based scoring or ranking models
Advanced personalization beyond topic + depth
On-demand generation
Any “smart” fallback or rescue logic that hides weak candidate pools instead of exposing them
Any feature whose primary benefit is being impressive rather than reliable

Reduced-Scope Product Spec (One-Pager)
Product: SignalBrief MVP
Promise: 5 fresh, credible signals in your sector, every morning, at the depth you choose.
Supported topics (7): Healthcare · Life Sciences · Technology · Energy · Financial Services · Consumer & Retail · Industrials
Depth modes: Scan (60s read) · Brief (2 min read) · Deep (4 min read). Always 5 items.
Daily flow:
RSS feeds from 70–100 curated sources are pulled every 4 hours
Supplemental discovery via Perplexity fills gaps and is capped, tagged, and visible
Items are normalized, deduplicated, and scored
Top 5 per topic selected with source diversity, repetition control, and fallback hierarchy
Items enriched per subscriber’s depth setting via Claude
Email sent at subscriber’s delivery time
Digest archived for browse-back
Subscriber options: Pick 1–3 topics. Pick a depth mode. Pick a delivery time. That’s it.
Key constraints:
Email only
5 items per topic
No custom keywords
No on-demand generation
7 topics only for MVP
No AI-search-powered sourcing as the backbone
Non-goals:
Personalization beyond topic + depth
Real-time intelligence
Multi-channel delivery
Maximum topic breadth
Features that are impressive but fragile 
