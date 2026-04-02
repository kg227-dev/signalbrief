# SignalBrief — Current Product / System Contract

Last reviewed: April 2, 2026

This file describes the live reduced-scope MVP. Historical pre-MVP behavior is archived under [`docs/archive/`](./docs/archive/README.md). The product source of truth is [`docs/reduced-scope-mvp.md`](./docs/reduced-scope-mvp.md).

## Product Definition

SignalBrief is a scheduled email digest for strategy professionals. It is not a Telegram bot product, not an on-demand chat product, and not a custom-keyword personalization product.

## Built Scope

- 7 standard topics only
- 1-3 subscribed topics per user
- up to 5 items per subscribed topic per day
- hard 48-hour freshness limit
- one story maps to one best-fit topic
- RSS/direct publisher feeds are primary; discovery/search fills gaps
- scheduled email delivery only
- founder/operator audit, source health, editorial overrides, and source controls available in admin

## Runtime Shape

```text
scheduler-worker
  -> digest orchestrator
    -> due-user resolution
    -> broker/direct-feed-first retrieval
    -> live-item selection (48h max)
    -> enrichment
    -> per-topic bucket delivery
    -> archive + audit + cost logging
```

Primary runtime entrypoints:
- `src/entrypoints/scheduler-worker.js`
- `src/entrypoints/digest.js`
- `web/server.js`

## Core Rules

### Scheduling

- Only `scheduled` runs are part of the product path.
- Due-user resolution is email-only.
- Users with no enabled email channel are not schedulable.

### Topic Scope

Allowed topics:
- `HEALTHCARE`
- `LIFE SCIENCES`
- `TECHNOLOGY`
- `ENERGY`
- `FINANCIAL SERVICES`
- `CONSUMER & RETAIL`
- `INDUSTRIALS`

Custom topics, capability topics, topic weights, and per-user item-count overrides are not part of the product.

### Retrieval

- Standard-topic broker config is the main source inventory for standard topics.
- Preferred domains and source policy are applied to standard-topic retrieval.
- Discovery/search exists to supplement thin topics, not define the product.

### Selection

- Only live items within 48 hours are eligible.
- Cross-day dedup and repetition suppression apply before final selection.
- Selection is per topic, not a single flat global 5-item list.

### Delivery

- Delivery is email only.
- Depth mode changes writeup depth, not topic selection.
- Underfilled topics are withheld rather than padded with unrelated items.

### Auditability

- Scheduled runs must write digest audit artifacts.
- Audit includes selection funnel counts, topic-level candidate decisions, rejection reasons, and broker telemetry.
- Source health prefers ingest/broker telemetry over post-hoc inference where available.
