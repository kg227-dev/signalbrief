# Metrics Definitions — Canonical Reference

Single source of truth for all admin dashboard metrics. Updated 2026-04-11.

---

## 1. Entity Definitions

**Run** — 1 pipeline execution = 1 entry in `data/cost-log.json`.
- Types: `scheduled`, `targeted`, `admin_topic_audit_rerun`, `inventory_refresh`
- A retry does NOT create a new run; retries are per-user within the same day
- 1 run CAN serve multiple users — fetch is shared, enrichment + delivery are per-user

**Digest** — Content artifact per user per date per mode.
- Stored as `data/digest-records/{user_id}/{dateKey}--{mode}.json`
- A run with 3 users produces 3 digests
- Not all digests become deliveries (can be `withheld`, `failed`, or `selected`)

**Delivery** — A successfully sent digest to a user.
- Tracked as `users_served` in cost log and `digest_sent` engagement events
- 1 delivery = 1 user received their brief

**User** — Email-based identity. Primary key: `chatId`. Secondary: `email`.

### Relationship Model

```
1 Run → 1 shared fetch (Perplexity)
1 Run → N users due
1 Run → N digests generated (1 per user)
1 Run → M deliveries (M ≤ N, only successful sends)
1 Run → (N - M) failures (in per_user_failed)
```

---

## 2. Data Lineage

### Cost Tiles

| UI Label | API Field | Source | Transform | Aggregation |
|----------|-----------|--------|-----------|-------------|
| This Month — Cost | `summary.month_cost` | `cost-log.json` | Filter `date` prefix = `YYYY-MM`, scheduled only | `sum(total_cost_usd)` |
| This Month — Deliveries | `summary.month_deliveries` | `cost-log.json` | Same filter | `sum(users_served)` |
| This Month — Runs | `summary.month_runs` | `cost-log.json` | Same filter | `count(runs)` |
| This Month — Users | `summary.month_unique_users` | `cost-log.json` | Iterate `per_user[]` arrays | `Set(per_user[].id).size` |
| Last 7d — Cost | `summary.trailing_7d_cost` | `cost-log.json` | Date window + `isScheduledRunRecord()` | `sum(total_cost_usd)` |
| Last 7d — Scheduled runs | `summary.trailing_7d_scheduled_runs` | Same | Same | `count(runs)` |
| Last 7d — Deliveries | `summary.trailing_7d_deliveries` | Same | Same | `sum(users_served)` |
| Next 7d — Projected cost | `summary.projected_7d_cost` | User roster + historical runs | Build run slots from schedules × historical avg cost/run | `sum(slot_cost)` |
| All Time — Cost | `summary.all_time_cost` | `cost-log.json` | No filter | `sum(total_cost_usd)` |
| All Time — Deliveries | `summary.all_time_deliveries` | `cost-log.json` | No filter | `sum(users_served)` |

### Engagement Tiles

| UI Label | API Field | Source | Transform |
|----------|-----------|--------|-----------|
| 7d open rate | `engagement.open_rate_7d` | `engagement-events.jsonl` | Unique `email_open` in 7d (bounded to digests sent in same window) / unique `digest_sent` email in 7d |
| 30d open rate | `engagement.open_rate_30d` | Same | Same logic, 30d window |
| Subscribers | `engagement.total_active/paused/unsubscribed` | `user-*.json` | Group by `status` |

### Per-User Cost Table

| Column | API Field | Source | Transform |
|--------|-----------|--------|-----------|
| User | `per_user[].id` | `cost-log.json` → `per_user[].id` | Direct |
| Runs | `per_user[].runs` | `cost-log.json` | Count of runs where user in `per_user` |
| Total cost | `per_user[].total_cost` | `cost-log.json` | `sum(run.total_cost_usd / run.users_served)` |
| Avg cost/run | Computed in browser | `total_cost / runs` | Frontend division |

### Recent Runs Table (last 10)

| Column | API Field | Source |
|--------|-----------|--------|
| Date | `runs[].date` | `cost-log.json` → `date` (ET) |
| Time | `runs[].run_at_et` | `cost-log.json` → `run_at_et` |
| Users | `runs[].users_served` | Direct |
| Tokens | `runs[].claude_tokens_in/out` | Direct |
| Quality | `runs[].digest_quality_score` | From `per_user[0].digest_quality_score` |
| Cost | `runs[].total_cost_usd` | Direct (tooltip shows Perplexity + Claude split) |

---

## 3. Cost Formula

```
perplexity_cost = perplexity_calls × $0.005/call
claude_cost     = (input_tokens / 1M × $0.80) + (output_tokens / 1M × $4.00)
total_cost      = perplexity_cost + claude_cost
per_user_cost   = total_cost / users_served
```

Rates defined in `src/entrypoints/digest-orchestrator-cost-runtime.js:3-5`.

### Cost Scope per Run

| Stage | Included | Provider | Notes |
|-------|----------|----------|-------|
| Fetch/Discovery | Yes | Perplexity Sonar | `standardFetchCalls` counter |
| Classification | N/A | Dormant | Exists but gated off (`CONFIG.digest.classification.enabled`) |
| Dedup/Filtering | N/A | None | Pure local logic, no API calls |
| Enrichment | Yes | Claude Haiku-4-5 | `stageRecord.usage` merge, includes repair retries |
| Subject line | Yes | Claude Haiku-4-5 | Delivery accumulator |
| Editorial note | Yes | Claude Haiku-4-5 | Delivery accumulator |
| WIM Eval | No | Claude Sonnet-4-6 | Offline eval harness, correctly excluded |

### Cost Attribution

Current model: equal split (`total_cost / users_served`). This is correct at N=1-2 users/run. At scale, Perplexity cost is shared but Claude cost varies per user. Future model: `(perplexity_cost / N) + user_specific_claude_cost`.

---

## 4. Failed Run Handling

| Metric | Includes Failed Runs? | Notes |
|--------|-----------------------|-------|
| `all_time_cost` | Yes | Cost was spent even if no delivery |
| `all_time_runs` | Yes | All cost-log entries |
| `all_time_deliveries` | No | `sum(users_served)`, zero for failed runs |
| `month_cost` | Yes (scheduled only) | Includes zero-value scheduled runs |
| `trailing_7d_cost` | Yes (scheduled only) | Same |
| `per_user` table | No | Iterates `per_user` (empty for failed runs) |
| `delivery_reliability` | Implicit | Failed runs reduce `delivered/expected` ratio |

---

## 5. Projection Logic

```
projected_cost = projected_run_count × historical_avg_cost_per_run
```

- `historical_avg_cost_per_run`: mean `total_cost_usd` from last 30d of scheduled runs
- Requires ≥5 data points; falls back to `fallbackEstimateDigestCost` otherwise
- `projection_basis` field indicates which method was used
- Known limitation: doesn't scale per-slot cost with varying user counts

---

## 6. Metrics Trust Levels

### Safe to Rely On
- `all_time_cost`, `all_time_runs`, `all_time_deliveries`
- `trailing_7d_cost`, `trailing_7d_scheduled_runs`, `trailing_7d_deliveries`
- `active_users`, `delivery_reliability.success_rate_7d`
- Quality metrics (DQS), recent runs table

### Conditional
- `month_cost` — scheduled-only as primary, all-types as `month_total_cost`
- `per_user` cost — equal-split approximation, correct at current scale
- `projected_7d_cost` — uses historical avg when available, fallback otherwise

### Previously Broken (now fixed)
- `open_rate_7d` / `open_rate_30d` — was inflated by cross-window opens; now bounded to same-window digests

---

## 7. Key Files

| File | Role |
|------|------|
| `data/cost-log.json` | JSONL, one entry per run (source of truth for cost) |
| `data/engagement-events.jsonl` | JSONL, per-event (opens, sends, clicks) |
| `web/services/admin-stats-costs.js` | Cost aggregation, projections, per-user rollup |
| `web/services/admin-stats-referrals.js` | Open rate and engagement metrics |
| `web/services/admin-ops-io.js` | `isScheduledRunRecord`, schema normalization |
| `web/routes/admin/admin-api-stats-payload-runtime.js` | Payload assembly |
| `src/entrypoints/digest-orchestrator-cost-runtime.js` | Cost calculation and logging |
| `scripts/audit/metrics-audit.js` | Standalone audit script |
