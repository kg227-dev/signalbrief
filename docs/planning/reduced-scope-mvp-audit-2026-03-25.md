**Verdict**

I re-read [the reduced-scope MVP spec](/docs/planning/reduced-scope-mvp.md) and audited the current `objective-wilbur` worktree. Verdict: no, this branch does not yet match the spec.

The biggest blockers are:

- `5 items per topic` is not what ships. Upstream selection does per-topic picking, but delivery still truncates to `5 total` per user via [digest-orchestrator-selection-runtime.js](/src/entrypoints/digest-orchestrator-selection-runtime.js#L252), [digest-delivery-policy-runtime.js](/src/runtime/digest-delivery-policy-runtime.js#L13), and [digest-orchestrator-delivery-runtime.js](/src/entrypoints/digest-orchestrator-delivery-runtime.js#L418).
- `Email-only` is not true in the live runtime. Telegram bot deployment, Telegram delivery, and targeted `/digest` still exist in [docker-compose.yml](/docker-compose.yml#L37), [bot-server.js](/src/entrypoints/bot-server.js), [reply-command-digest-runtime.js](/src/runtime/reply/reply-command-digest-runtime.js#L3), and [digest-orchestrator-delivery-runtime.js](/src/entrypoints/digest-orchestrator-delivery-runtime.js#L702).
- Final delivery is still personalized. `applyTopicRelevanceScores`, `topic_weights`, blocked/trusted sources, recent-entity history, and auto-learning all still shape the delivered set in [digest-orchestrator-delivery-ranking-runtime.js](/src/entrypoints/digest-orchestrator-delivery-ranking-runtime.js#L363), [topic-domain-runtime.js](/src/digest/domain/topic-domain-runtime.js#L402), and [personalization-runtime.js](/src/runtime/personalization/personalization-runtime.js#L213).
- Freshness handling is inconsistent. Scheduled runs filter at 48h, but `splitByFreshnessTiers()` reads the wrong timestamp fields and targeted mode still defaults to 72h in [digest-orchestrator-selection-runtime.js](/src/entrypoints/digest-orchestrator-selection-runtime.js#L5) and [digest-data-fetch-items-runtime.js](/src/digest/runtime/digest-data-fetch-items-runtime.js#L271).
- `One story -> one best-fit topic` is not enforced. Broker normalization fans one article out across every configured `topic_tag` in [standard-topic-broker-runtime.js](/src/runtime/standard-topic-broker-runtime.js#L633).

**A-G**

**A. Fully implemented and aligned**
- The reduced 7-topic surface is in place in the broker config and public product surface; Policy/Regulatory is explicitly dropped in [standard-topic-broker-sources.json](/config/standard-topic-broker-sources.json#L2) and [settings.html](/web/settings.html#L147).
- Transparent candidate scoring exists and matches the spec’s intended shape in [score-candidate.js](/src/domains/scoring/score-candidate.js#L7).
- Per-day audit docs and token-gated archive access are real in [digest-orchestrator-core-runtime.js](/src/entrypoints/digest-orchestrator-core-runtime.js#L562), [archive-persistence-runtime.js](/src/digest/runtime/archive-persistence-runtime.js), and [core-api-archive-runtime.js](/web/routes/core-api-archive-runtime.js#L158).

**B. Partially implemented**
- RSS/direct-feed-first ingestion exists, with `publisher_feed` and `official` lanes, broker-first fetch, `BROKER_SATURATION_THRESHOLD = 10`, and `maxDiscoveryItemsPerTopic = 1`; but the broker inventory is still only 51 enabled sources total, not the spec’s fuller backbone. Files: [digest-orchestrator-fetch-runtime.js](/src/entrypoints/digest-orchestrator-fetch-runtime.js#L11), [standard-topic-broker-runtime.js](/src/runtime/standard-topic-broker-runtime.js), [standard-topic-broker-sources.json](/config/standard-topic-broker-sources.json).
- Freshness/repetition controls exist: 48h age filtering, cross-day dedup, longitudinal history suppression, and continuation/follow-up classification. But the tiering bug, targeted 72h path, user-level suppression, and archive fallback mean this is not spec-clean. Files: [digest-orchestrator-selection-runtime.js](/src/entrypoints/digest-orchestrator-selection-runtime.js), [archive-history-runtime.js](/src/digest/runtime/archive-history-runtime.js#L60), [repeat-history-domain-runtime.js](/src/digest/domain/repeat-history-domain-runtime.js).
- Founder/operator controls exist, but incompletely: digest audit, source health, editorial overrides, and digest tuning are present; I did not find broker-source CRUD, per-topic lane toggles, rerun-one-topic, or regenerate-summary-only routes. That last point is an inference from the admin route inventory and implementations under [web/routes](/web/routes), especially [admin-api-source-registry-runtime.js](/web/routes/admin-api-source-registry-runtime.js), [admin-api-source-health-runtime.js](/web/routes/admin-api-source-health-runtime.js), [admin-api-editorial-overrides-runtime.js](/web/routes/admin-api-editorial-overrides-runtime.js), and [admin-api-digest-tuning-runtime.js](/web/routes/admin-api-digest-tuning-runtime.js).
- Depth mostly changes writeup/rendering, but legacy delivery knobs still leak into outcome selection. Files: [topic-domain-runtime.js](/src/digest/domain/topic-domain-runtime.js#L644), [digest-orchestrator-delivery-ranking-runtime.js](/src/entrypoints/digest-orchestrator-delivery-ranking-runtime.js#L392), [web-user-settings-runtime.js](/web/services/web-user-settings-runtime.js#L79).

**C. Still missing**
- A real `5 delivered items per subscribed topic` main codepath.
- A single source-of-truth registry for topic -> lane -> source inventory.
- A best-fit topic assignment stage before final selection.
- Hard removal of personalization/chat delivery from the delivery pipeline.

**D. Still conflicts with the spec**
- Delivery is still `5 total`, not `5 per topic`: [digest-delivery-policy-runtime.js](/src/runtime/digest-delivery-policy-runtime.js), [digest-orchestrator-delivery-runtime.js](/src/entrypoints/digest-orchestrator-delivery-runtime.js).
- Telegram, `/digest`, and targeted 72h mode are still live: [docker-compose.yml](/docker-compose.yml), [reply-command-digest-runtime.js](/src/runtime/reply/reply-command-digest-runtime.js), [digest-orchestrator-selection-runtime.js](/src/entrypoints/digest-orchestrator-selection-runtime.js#L145).
- Final delivered items are still user-specific because ranking/personalization remains active: [digest-orchestrator-delivery-ranking-runtime.js](/src/entrypoints/digest-orchestrator-delivery-ranking-runtime.js), [personalization-runtime.js](/src/runtime/personalization/personalization-runtime.js).
- One article can still land in multiple topics: [standard-topic-broker-runtime.js](/src/runtime/standard-topic-broker-runtime.js).
- Archive fallback can hide a weak live candidate pool: [digest-orchestrator-selection-runtime.js](/src/entrypoints/digest-orchestrator-selection-runtime.js#L310).
- Bookmarking is still active: [archive.html](/web/archive.html#L571), [core-api-bookmarks-runtime.js](/web/routes/core-api-bookmarks-runtime.js#L20).

**E. Old/out-of-scope features still active in the main codepath**
- Telegram bot service and Telegram delivery: [docker-compose.yml](/docker-compose.yml), [digest-orchestrator-delivery-runtime.js](/src/entrypoints/digest-orchestrator-delivery-runtime.js).
- On-demand targeted digests: [reply-command-digest-runtime.js](/src/runtime/reply/reply-command-digest-runtime.js), [digest-orchestrator-core-runtime.js](/src/entrypoints/digest-orchestrator-core-runtime.js#L733).
- Auto-topic-learning, engagement-driven adjustments, and reengagement state: [personalization-runtime.js](/src/runtime/personalization/personalization-runtime.js), [user-contract-runtime.js](/src/runtime/user-contract-runtime.js#L130).
- Custom topics, `topic_weights`, and `items_per_digest`: [user-contract-runtime.js](/src/runtime/user-contract-runtime.js#L117), [web-user-settings-runtime.js](/web/services/web-user-settings-runtime.js#L173), [core-api.js](/web/routes/core-api.js#L40).
- Bookmarks: [archive.html](/web/archive.html), [core-api-bookmarks-runtime.js](/web/routes/core-api-bookmarks-runtime.js).

**F. Archived/deprecated successfully**
- The old archive API is explicitly retired in favor of `/api/archive/all`: [core-api-archive-runtime.js](/web/routes/core-api-archive-runtime.js#L62).
- Public signup/settings force email-first defaults and hide custom keywords at the surface: [web-user-signup-actions-runtime.js](/web/services/web-user-signup-actions-runtime.js#L137), [preferences-runtime.js](/web/preferences-runtime.js#L22).
- The public topic surface is reduced to the 7 MVP topics: [standard-topic-broker-sources.json](/config/standard-topic-broker-sources.json#L2).

**G. Technically works but violates the spirit**
- Audit logging is best-effort; digest delivery can succeed without an audit trail: [digest-orchestrator-core-runtime.js](/src/entrypoints/digest-orchestrator-core-runtime.js#L562).
- Source health is inferred from audit outputs, not direct ingestion telemetry: [admin-api-source-health-runtime.js](/web/routes/admin-api-source-health-runtime.js#L24).
- The UI looks reduced-scope, but hidden backend personalization still changes outcomes: [digest-orchestrator-delivery-ranking-runtime.js](/src/entrypoints/digest-orchestrator-delivery-ranking-runtime.js), [personalization-runtime.js](/src/runtime/personalization/personalization-runtime.js).
- Signup still queues an immediate welcome digest, which bends the “daily topic digest” model: [web-user-signup-actions-runtime.js](/web/services/web-user-signup-actions-runtime.js#L171).

**Status Table And Risks**

| Spec area | Expected behavior | Current implementation | Status | Files involved | Recommended next action |
|---|---|---|---|---|---|
| Topic scope | 7 standard MVP topics only | Public surface and broker config use 7 topics | aligned | [settings.html](/web/settings.html), [standard-topic-broker-sources.json](/config/standard-topic-broker-sources.json) | Keep |
| Exactly 5 items per topic digest | Each subscribed topic yields 5 delivered items/day | Selection does 5/topic, then delivery collapses to 5 total/user | conflicting | [digest-orchestrator-selection-runtime.js](/src/entrypoints/digest-orchestrator-selection-runtime.js), [digest-delivery-policy-runtime.js](/src/runtime/digest-delivery-policy-runtime.js), [digest-orchestrator-delivery-runtime.js](/src/entrypoints/digest-orchestrator-delivery-runtime.js) | Deliver from per-topic buckets directly; remove downstream 5-total truncation |
| Freshness max 48h | No item older than 48h in MVP digest | Scheduled filter is 48h, but tiering reads wrong fields and targeted mode is 72h | partial | [digest-orchestrator-selection-runtime.js](/src/entrypoints/digest-orchestrator-selection-runtime.js), [digest-data-fetch-items-runtime.js](/src/digest/runtime/digest-data-fetch-items-runtime.js) | Fix `splitByFreshnessTiers()` to use `published_date`; remove targeted 72h path |
| One story to one best-fit topic only | A story appears under one canonical topic | Broker duplicates one item across every `topic_tag`; no best-fit arbiter | conflicting | [standard-topic-broker-runtime.js](/src/runtime/standard-topic-broker-runtime.js), [digest-orchestrator-selection-runtime.js](/src/entrypoints/digest-orchestrator-selection-runtime.js) | Add canonical topic assignment before scoring/selection |
| Repetition across days | Suppress stale continuations, allow only materially new follow-ups | Cross-day dedup, history suppression, and storyline classification exist | partial | [archive-history-runtime.js](/src/digest/runtime/archive-history-runtime.js), [repeat-history-domain-runtime.js](/src/digest/domain/repeat-history-domain-runtime.js), [digest-orchestrator-selection-runtime.js](/src/entrypoints/digest-orchestrator-selection-runtime.js) | Keep the history logic; remove archive fallback and user-specific freshness side paths |
| RSS/direct feeds as backbone | 8-15 direct sources/topic; broker is the primary lane | Broker-first exists, but only 51 enabled sources total and 7-9/topic | partial | [digest-orchestrator-fetch-runtime.js](/src/entrypoints/digest-orchestrator-fetch-runtime.js), [standard-topic-broker-sources.json](/config/standard-topic-broker-sources.json) | Expand broker inventory and make its config the true source of truth |
| Discovery/AI search as supplement only | Discovery fills gaps, never drives the product | Saturation skip and 1-per-topic cap exist, but discovery stack is still central on thin topics | partial | [digest-orchestrator-fetch-runtime.js](/src/entrypoints/digest-orchestrator-fetch-runtime.js), [digest-orchestrator-selection-runtime.js](/src/entrypoints/digest-orchestrator-selection-runtime.js) | Make broker sufficiency the default and discovery opt-in fallback only |
| Email-only MVP | No Telegram delivery or chat-triggered digests | Public UI is email-only, but Telegram bot/delivery and `/digest` remain live | conflicting | [docker-compose.yml](/docker-compose.yml), [reply-command-digest-runtime.js](/src/runtime/reply/reply-command-digest-runtime.js), [digest-orchestrator-delivery-runtime.js](/src/entrypoints/digest-orchestrator-delivery-runtime.js) | Stop deploying bot; remove Telegram and targeted digest paths from runtime |
| Depth modes affect writeup length only | Same story set, different writeup depth | Rendering changes by depth, but legacy per-user item-count/ranking knobs still affect output | partial | [topic-domain-runtime.js](/src/digest/domain/topic-domain-runtime.js), [digest-orchestrator-delivery-ranking-runtime.js](/src/entrypoints/digest-orchestrator-delivery-ranking-runtime.js), [web-user-settings-runtime.js](/web/services/web-user-settings-runtime.js) | Remove `items_per_digest` and per-user relevance ranking from active path |
| Founder/operator auditability | Clear “why selected / why not / lane mix / miss detection” | Good audit docs and source-health summary exist, but health is derived from audit snapshots and audit writes are non-fatal | partial | [digest-orchestrator-core-runtime.js](/src/entrypoints/digest-orchestrator-core-runtime.js), [admin-api-digest-audit-runtime.js](/web/routes/admin-api-digest-audit-runtime.js), [admin-api-source-health-runtime.js](/web/routes/admin-api-source-health-runtime.js) | Make audit mandatory for scheduled runs; add per-source ingest telemetry |
| Source registry and source controls | One editable source registry for topic/lane/source policy | Split across broker source config, policy registry, and preferred-source registry; admin route edits policy, not full inventory | partial | [standard-topic-broker-sources.json](/config/standard-topic-broker-sources.json), [source-policy-registry-runtime.js](/src/runtime/source-policy-registry-runtime.js), [preferred-source-registry-runtime.js](/src/runtime/preferred-source-registry-runtime.js), [admin-api-source-registry-runtime.js](/web/routes/admin-api-source-registry-runtime.js) | Consolidate into one registry and make admin controls operate on it |
| Selection controls and admin controls | Founder can tune, pin/exclude, disable lanes/sources, rerun topics | Tuning and editorial overrides exist; I did not find per-topic lane toggles, broker-source CRUD, or single-topic rerun/regenerate controls | partial | [admin-api-digest-tuning-runtime.js](/web/routes/admin-api-digest-tuning-runtime.js), [admin-api-editorial-overrides-runtime.js](/web/routes/admin-api-editorial-overrides-runtime.js), [admin-api-source-registry-runtime.js](/web/routes/admin-api-source-registry-runtime.js) | Add explicit topic/lane/source CRUD and rerun endpoints |
| Deprecated/out-of-scope features removed | Legacy features should be archived or off the active path | `/api/archive` is retired, but Telegram, bookmarks, custom topics, topic weights, and auto-learning remain active | conflicting | [core-api-archive-runtime.js](/web/routes/core-api-archive-runtime.js), [core-api-bookmarks-runtime.js](/web/routes/core-api-bookmarks-runtime.js), [user-contract-runtime.js](/src/runtime/user-contract-runtime.js), [personalization-runtime.js](/src/runtime/personalization/personalization-runtime.js) | Move legacy code out of runtime paths or delete it |

Likely stale/legacy code, configs, routes, or hidden coupling still left behind:
- `topic_weights`, `custom_topics`, `bookmarks`, `items_per_digest`, and `reengagement_state` are still part of the user contract in [user-contract-runtime.js](/src/runtime/user-contract-runtime.js).
- The public API still serializes `bookmarks`, `topic_weights`, and `items_per_digest` in [core-api.js](/web/routes/core-api.js#L100).
- `MAX_CUSTOM_KEYWORDS = 0` in [preferences-runtime.js](/web/preferences-runtime.js#L22), but the UI helper still forces at least one slot in [settings-ui-topic-actions-runtime.js](/web/settings-ui-topic-actions-runtime.js#L12).
- The “source registry” is hiddenly split across three systems: broker inventory, policy overrides, and preferred-source heuristics.
- Source health depends on audit logs existing; if audit writes fail, health visibility degrades silently.
- Legacy archive endpoints are still shipped, just retired by behavior, in [core-api-archive-runtime.js](/web/routes/core-api-archive-runtime.js).
- Reply-command handlers still expose legacy topic/digest behavior in [src/runtime/reply](/src/runtime/reply).

Risky assumptions in the current implementation:
- Old archived content is an acceptable substitute when live fetch fails.
- A source’s configured `topic_tags` are good enough to duplicate one article across multiple topics.
- Audit-derived output metrics are a valid proxy for ingestion health.
- User-specific engagement/personalization can coexist with a reduced-scope, operator-auditable MVP.
- Surface-level UI removal is sufficient even when backend behavior remains live.

The 5 biggest remaining gaps/concerns:
1. Multi-topic delivery still fundamentally violates the product shape.
2. Telegram/on-demand/personalization legacy code still changes production behavior.
3. Topic assignment is not canonical, so cross-topic duplication remains possible.
4. Source control is not unified; operator truth is split across multiple registries.
5. Freshness/repeat logic is improved but still has edge-case behavior that diverges from the spec.

Top 3 highest-leverage next fixes:
1. Delete the downstream personalized delivery selector and deliver directly from deterministic per-topic selections; remove `items_per_digest`, `topic_weights`, and auto-learning from the active digest path.
2. Remove Telegram, `/digest`, and bookmark/custom-topic legacy code from production runtime and deployment; keep only email MVP paths.
3. Consolidate source control into one registry, add canonical best-fit topic assignment, and make 48h freshness a single hard rule with no archive rescue on scheduled runs.

I also ran targeted local tests for selection/repeat/storyline/tuning/editorial overrides. They passed, but they do not cover the main mismatches above, which are architectural/runtime-path issues rather than unit-level regressions.
