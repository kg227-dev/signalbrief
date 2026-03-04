# Phase 0 Planning Pack (v1)

Last updated: 2026-03-04
Owner: Kush Gulati
Status: Draft complete (ready for implementation)

---

## Objective

Lock the foundations for Tier 1 -> Tier 2 execution:

- Freeze one quality rubric tied to the existing harness.
- Define one engagement signal schema for personalization loops.
- Define one digest quality score formula shared by harness + production reporting.
- Set explicit ownership and success metrics.

---

## Deliverables (Phase 0)

- [x] Tier 1 quality rubric lock (this doc, Section 1)
- [x] Engagement signal schema v1 ([`planning/engagement-event-schema.v1.json`](./engagement-event-schema.v1.json))
- [x] Digest quality score formula lock (this doc, Section 3)
- [x] Owners + success metrics (this doc, Section 4)

---

## 1. Tier 1 Rubric Lock (Canonical)

This rubric is locked to the current harness implementation and should not be changed without updating both `test-harness` and this document.

### 1.1 Hard Certification Gates

Certification rule: pass all required gates for 3 consecutive runs.

| Dimension | Harness source | Gate |
|---|---|---|
| Topic matching | `01-topic-matching` | leak rate <= 1% across delivered items |
| Relevance behavior | `02-relevance-scoring` | weight tweaker Spearman >= 0.65 and anomaly rate <= 5% |
| Analysis quality | `03-analysis-quality` | mean overall >= 4.0/5 and P25 >= 3.6/5 |
| Diversity | `04-diversity` | no adjacent same-tag items, >= 5 unique tags for 10-item digests, max tag share <= 40% |
| Custom topics | `05-custom-topics` | at least 1 matching item per tracked custom keyword |
| Depth control | `06-depth-control` | deep mode 2x-3x richer, insight >= 3.5/5, likely padding <= 20% |
| Cross-day freshness | `08-cross-day-freshness` | day-to-day overlap < 20%, no item repeated across 3+ days |
| End-to-end composite | `09-end-to-end` | core avg >= 85, floor >= 75, >= 8 core personas at >= 80 |

### 1.2 Composite Weights (Locked)

From `test-harness/config.js`:

- Topic matching: `0.25`
- Relevance scoring: `0.20`
- Analysis quality: `0.30`
- Diversity: `0.15`
- Custom topics: `0.10` (only applied when custom topics exist)

### 1.3 Current Baseline Snapshot

Source:
- Latest run: `test-results/run-2026-03-04T03-45-47-461Z.json`
- Rolling window: `test-results/summary-rolling.json`

Current snapshot:

| Metric | Value |
|---|---|
| Pass streak | `7` runs |
| End-to-end composite | `86.39` (pass) |
| Topic matching | `100.00` |
| Relevance scoring | `76.87` |
| Analysis quality | `4.10/5` (`77.5`) |
| Diversity | `94.67` |
| Custom topics | `90.00` |
| Depth control | `87.34` |
| Cross-day freshness | `100.00` |

Interpretation:
- Tier 1 is currently in a strong state.
- Relevance scoring is still the weakest major component and should remain the first optimization target in Tier 2.

---

## 2. Engagement Signal Schema (v1)

Canonical schema file:
- [`planning/engagement-event-schema.v1.json`](./engagement-event-schema.v1.json)

Storage decision (v1):
- Append-only JSONL file: `data/engagement-events.jsonl`
- One event per line, immutable, UTC timestamps
- Derived aggregates generated separately (daily job / admin stats endpoint)

### 2.1 Event Types (Locked v1)

- `digest_sent`
- `item_saved`
- `item_clicked`
- `item_ignored_computed`
- `topic_weight_adjusted`
- `digest_feedback_submitted`

### 2.2 Idempotency Rules

- `digest_sent`: `digest_sent:<digest_id>:<channel>`
- `item_saved`: `item_saved:<digest_id>:<item.index>`
- `item_clicked`: `item_clicked:<digest_id>:<item.index>:<normalized_url>`
- `topic_weight_adjusted`: `weight:<digest_id>:<topic.key>:<delta>:<source>`
- `digest_feedback_submitted`: `feedback:<digest_id>`
- `item_ignored_computed`: `ignored:<digest_id>:<item.index>:<window_hours>`

### 2.3 Ignored Signal Definition

`item_ignored_computed` is not user-clicked input. It is emitted by a scheduled processor when:

- a digest was delivered,
- the observation window elapsed (`24h` default),
- and the item was neither `item_saved` nor `item_clicked`.

---

## 3. Digest Quality Score Formula (DQS v1)

Scale: `0-100` per user per digest.

Status bands:
- `>= 85`: strong
- `75-84.99`: watch
- `< 75`: poor

### 3.1 Formula

```
DQS = 0.25*T + 0.20*R + 0.30*A + 0.15*F + 0.10*C
```

Where:

- `T` (Topic Fit, 0-100): percent of delivered items that match selected standard/custom topics.
  - Mirrors `01-topic-matching` behavior.
- `R` (Relevance Fit, 0-100): score from existing relevance suite logic.
  - If weight signal exists: use weighted Spearman/anomaly formula from `02-relevance-scoring`.
  - If not: use baseline relevance correlation mode from same suite.
- `A` (Analysis Quality, 0-100): normalized analysis quality score.
  - Primary: sampled judge score mapping (`(overall-1)/4*100`).
  - Production display: use latest calibrated rolling analysis score to avoid per-digest judge cost.
- `F` (Freshness + Diversity, 0-100): blend of same-day diversity and cross-day freshness.
  - `F = 0.60*DiversityScore + 0.40*FreshnessScore`
- `C` (Custom Topic Coverage, 0-100):
  - If user has custom topics: use `05-custom-topics` score logic.
  - If no custom topics: set `C = 100` (neutral).

### 3.2 Trend Metrics

Track and display:

- `dqs_current`: latest digest score
- `dqs_7d_avg`: rolling 7-day mean
- `dqs_14d_delta`: score change from first digest to day-14 average
- `dqs_floor_14d`: minimum over rolling 14 days

Tier 2A success gate:

- `dqs_14d_delta >= +5`
- while `dqs_floor_14d >= 75`

---

## 4. Owners, Milestones, and Success Metrics

Single-thread ownership model for now:

| Workstream | Owner | Output | Success metric |
|---|---|---|---|
| Rubric governance | Kush | Locked gates + no drift between docs and harness | 0 undocumented gate changes |
| Event instrumentation | Kush | `engagement-events.jsonl` populated from core actions | >= 95% of saves/more/less/clicks produce valid events |
| DQS computation | Kush | per-digest DQS + rolling trend materialized | DQS computed for >= 99% delivered digests |
| Admin visibility | Kush | DQS trend + signal counts in admin | dashboard shows per-user 14-day trend without null gaps |

### 4.1 Phase 0 Exit Criteria

Phase 0 is complete when:

1. This planning pack is accepted as canonical.
2. Event schema v1 is accepted as canonical.
3. Backlog tickets are created for:
   - event logging,
   - ignored-signal processor,
   - DQS calculator,
   - admin trend surfacing.

### 4.2 Immediate Next Action (Phase 1 Kickoff)

Run a fresh baseline harness snapshot and freeze it as the Phase 1 reference run:

```bash
npm run qa:harness -- --run-label=phase1-baseline
```

