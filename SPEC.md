# SignalBrief — Product Specification

*Last reviewed: March 20, 2026*

Scope: current runtime behavior, persisted data shape, and API contracts. Setup, deployment, and operating procedures live in [README.md](./README.md) and [`docs/ops/`](./docs/ops/README.md). Historical execution context lives under [`docs/archive/planning/`](./docs/archive/planning/2026-03/README.md).

---

## Product Definition

SignalBrief is a daily AI-curated strategy-news digest delivered through Telegram and email. It is optimized for consultants/operators who need fast cross-vertical situational awareness with explicit business implications.

---

## Built Scope (Current)

- 17 standard topics (10 industries + 7 capabilities)
- Custom topics (`custom_<slug>`) supported end-to-end: storage, matching, and dedicated fetches during runs
- Scheduled digest delivery via always-on worker (`scheduler-worker.js`) plus on-demand (`/digest`, admin trigger)
- Telegram ingress via polling-first bot worker (`bot-server.js` long-polling `getUpdates`); webhook mode is legacy/optional
- Per-user relevance scoring and depth transformation
- Engagement telemetry and automatic topic-weight learning
- User-scoped archive browsing + public share page
- Admin control plane (stats, audits, run controls, bulk operations, direct user messaging)

---

## System Architecture

```text
scheduler-worker.js
  - startup run + interval loop (default 5m)
  - heartbeat file: data/scheduler-heartbeat.json
        |
        v
digest.js
  - acquires data/digest-run.lock
  - computes due users (ET day/time + catch-up window)
  - fetches standard + custom topics
  - dedupes against recent archive window
  - selects diverse pool
  - enriches items via Claude
  - per-user filter/score/trim/depth transform
  - delivers (Telegram + email)
  - writes archive + cost log + user state + engagement events

web/server.js
  - onboarding/settings/archive/public digest/admin APIs
  - token-based user access + cookie admin sessions

store.js
  - one JSON file per user (`data/user-<chatId>.json`)
  - token index in process memory
```

---

## Digest Pipeline Behavior

## 1) Due-user scheduling

- Run modes:
1. `scheduled` (worker/admin full run)
2. `targeted` (`--chatId` or admin targeted)

- Scheduled eligibility checks:
1. `status === active`
2. Today ET day is in `preferences.days_of_week`
3. Not already delivered today (`last_digest_at` ET date check)
4. Time delta within `[-30, catchupWindowMinutes]`

- Digest lock:
1. File lock at `data/digest-run.lock` (`wx` create)
2. Stale lock detection via `DIGEST_LOCK_STALE_MS` (default 2h, min 5m)
3. Exit code `4` when lock is active

## 2) Fetch strategy

- Standard topics:
1. Scheduled run: all configured standard topics
2. Targeted run: only the user’s selected standard topics when available

- Custom topics:
1. Derived from due users’ `topics` entries with `custom_` prefix
2. Ranked by follower count among due users
3. Run cap: `digest.maxCustomFetchPerRun` or dynamic fallback `min(18, max(6, ceil(dueUsers/4)))`
4. Query generation via `buildCustomTopicQueries()` with alias expansion

- Incidents logged to `data/digest-incident-log.jsonl` and optionally pushed to `OPS_ALERT_CHAT_ID`.

## 3) Selection + dedup

- `dedupAgainstRecentArchives()` removes URL/headline duplicates against recent `archive/*.json` files (`crossDayDedupDays`, default 3)
- `selectItems()` enforces:
1. `maxItemsPerTag`
2. `maxItemsPerSourceDomain`
3. custom item cap (`maxCustomItemsPerRun` or dynamic 40% default)
4. interleaving (avoid adjacent same-tag items when possible)
5. tag priority bias from due-user topic demand

- If no selectable live items:
1. fallback to recent archive pool
2. if still empty, run aborts with incident

## 4) Enrichment

- Claude call returns (per item):
1. `wim_brief`
2. `wim`
3. `baseScore` (`0.0–10.0`)
4. `implications`
5. `watch_next`

- Parse failure fallback: item delivery continues with null analysis fields.

## 5) Per-user personalization and ranking

### Topic signal

`computeTopicSignals()` yields:
- `topicMatch = 10` exact tag/custom keyword hit
- `topicMatch = 7` related-topic match
- `topicMatch = 3` default baseline

### Weight adjustment

- Manual and automatic topic weights are stored in `user.topic_weights`
- `weightBonus = matchedWeight * 0.6`
- Weight keys are fuzzy-matched via normalized related-topic logic

### Specialist mode

For users with 1–2 standard topics:
- `+1.1` exact match
- `+0.45` related match
- `-0.6` weak/no match

### Final relevance score

`relevanceScore = clamp(0,10, round1(baseScore*0.6 + topicMatch*0.4 + weightBonus + specialistBonus))`

Items are sorted descending by `relevanceScore` and trimmed to `items_per_digest`.

### Strong-item filter

If enough high-quality items exist (`baseScore >= minBaseScoreForFinal`, default `6.5`, or custom-keyword matched), weaker items are removed before final trim.

### Emergency fallback

If user list is empty after filtering/ranking, top 1–3 items from global enriched set are used to avoid blank delivery.

## 6) Depth transformation

- `headline_only` / `scan`: remove `wim`
- `headline_plus_oneliner`: prefer `wim_brief`, fallback to first sentence from `wim`
- `headline_plus_why` (or equivalent deep): keep full `wim`

## 7) Delivery + persistence

- Telegram delivery includes inline item action buttons and digest feedback buttons
- Email includes tracked click links (`/api/click`)
- Post-delivery state updates:
1. `digests_received`
2. `last_digest_at`
3. `last_digest_items`
4. `digest_dates`
5. `quality_history` + `last_quality_score`

- Run-level persistence:
1. `archive/YYYY-MM-DD.json`
2. `data/cost-log.json` (JSONL)

---

## Cost Model

Per run estimates in `digest.js`:

- `PERPLEXITY_COST_PER_CALL = $0.005`
- `CLAUDE_HAIKU_IN_PER_MTOK = $0.80`
- `CLAUDE_HAIKU_OUT_PER_MTOK = $4.00`

Total run cost:

`total = (perplexity_calls * 0.005) + (in_tokens/1e6*0.80) + (out_tokens/1e6*4.00)`

Logged fields include per-user served/failed breakdown and standard vs custom Perplexity call counts.

---

## Error Handling and Degradation

- Perplexity fetch failures: retried for retryable network errors; item collection continues best-effort
- Claude enrichment parse failures: digest still sends with null analysis fields
- No selectable items: archive fallback attempt; otherwise run abort with incident
- Channel delivery failures: channel-specific errors logged; user marked failed only if all channels fail
- Admin triggered targeted run returns explicit lock/user-state/channel errors

---

## Rate Limits and Constraints

- Signup API rate limit: 5 requests/IP/15 minutes + 10 minute per-email cooldown
- `/digest` Telegram command cooldown: 15 minutes per chat
- Resend pacing in digest loop: 600ms per email send
- Admin login rate limit: 5 attempts/IP/15 minutes
- Bulk admin action cap: 200 emails/request

---

## Security Model

## User access

- User-scoped endpoints use 64-char token (`crypto.randomBytes(32)` from `store.js`)
- Archive and settings APIs require valid token
- Email-based unsubscribe requires HMAC signature (`signUnsubEmail`) for POST email-path flow

## Admin access

- Session cookie `sb_admin` (`HttpOnly`, `SameSite=Strict`, optional `Secure`)
- Password verified using scrypt hash (`CONFIG.admin.salt` + `passwordHash`)
- Optional local bypass exists (`ADMIN_LOCAL_BYPASS=1`) for localhost requests

## Data protection and integrity

- User writes are atomic (`.tmp` + rename)
- Engagement/admin logs are append-only JSONL style
- Input validation exists for core auth fields, but some preference fields are currently permissive (see `docs/features.md`)

---

## Data Model

## User record (`data/user-<chatId>.json`)

| Field | Type | Default | Notes |
|------|------|---------|-------|
| `chatId` | string | required | User key; email-only users use `email-<timestamp>` |
| `name` | string | optional | Present for onboarded users |
| `email` | string\|null | `null` | Lowercased in APIs |
| `telegram` | string\|null | optional | Username (without `@`) |
| `status` | enum | `active` | `active` \| `paused` \| `unsubscribed` |
| `token` | string\|null | auto-generated | 64-char hex |
| `joined_at` | ISO string | now | |
| `last_updated` | ISO string | optional | |
| `last_digest_at` | ISO string\|null | `null` | |
| `digests_received` | number | `0` | |
| `topics` | string[] | app-set | Standard tags and `custom_` tags |
| `custom_topics` | string[] | `[]` | Convenience list |
| `topic_weights` | object | `{}` | Numeric per-topic adjustments |
| `digest_dates` | string[] | `[]` | ET dates user received |
| `bookmarks` | array | `[]` | Saved digest items |
| `last_digest_items` | array | `[]` | Most recent delivery snapshot |
| `digest_feedback` | array | `[]` | Per-digest feedback rows |
| `quality_history` | array | `[]` | DQS history |
| `last_quality_score` | object\|null | `null` | Last DQS entry |
| `auto_learning` | object | enabled defaults | Auto-adjust state counters/timestamps |
| `preferences.delivery_time` | `HH:MM` | `07:00` | ET schedule target |
| `preferences.timezone` | string | `America/New_York` | |
| `preferences.depth` | string | onboarding default | `headline_only` / `headline_plus_oneliner` / `headline_plus_why` |
| `preferences.frequency` | string | onboarding default | schedule label |
| `preferences.days_of_week` | number[] | `[1,2,3,4,5]` | 0=Sun…6=Sat |
| `preferences.items_per_digest` | number | `5` | UI uses 5/10 |
| `preferences.email_enabled` | boolean | `true` | |
| `preferences.telegram_enabled` | boolean | `true` | |

## Other persisted files

| Path | Format | Purpose |
|------|--------|---------|
| `archive/YYYY-MM-DD.json` | JSON | Daily enriched digest payload |
| `data/cost-log.json` | JSONL | Run-level cost/accounting |
| `data/engagement-events.jsonl` | JSONL | User engagement telemetry |
| `data/admin-action-log.json` | JSONL | Admin action trail |
| `data/admin-message-log.json` | JSONL | Admin outbound message trail |
| `data/admin-service-log.json` | JSONL | LaunchAgent service actions |
| `data/digest-incident-log.jsonl` | JSONL | Incident stream |
| `data/scheduler-heartbeat.json` | JSON | Worker heartbeat |
| `data/digest-run.lock` | JSON | Active run lock payload |

---

## API Contracts

## Public APIs

| Method | Endpoint | Request | Response |
|--------|----------|---------|----------|
| `GET` | `/api/topics` | none | `{ topics, industries, capabilities }` |
| `GET` | `/api/user` | `token` query | Full user JSON or 4xx |
| `POST` | `/api/signup` | `{ name, email, telegram?, topics[], depth?, delivery_time?, frequency?, days_of_week?, items_per_digest? }` | `{ success, chatId, token, archiveUrl }` |
| `POST` | `/api/settings` | `{ token, ...fields }` | `{ success: true }` or error |
| `GET` | `/api/archive` | `token` query | `{ digests[] }` |
| `GET` | `/api/archive/all` | `token` query | `{ items[], digestCount }` |
| `GET` | `/api/archive/:date` | `token` query | Archive payload with user-relative `relevanceScore` |
| `GET` | `/api/click` | `url` + optional `token/did/item` query | 302 redirect |
| `POST` | `/api/bookmarks` | `{ token, action: add|remove, item: { url, ... } }` | bookmark state/count |
| `POST` | `/api/request-link` | `{ email }` | `{ success: true }` (non-enumerating) |
| `GET` | `/api/unsubscribe/confirm` | `token` query | 302 to settings confirmation |
| `POST` | `/api/unsubscribe/one-click` | `token` query | `{ success: true }` |
| `GET`/`POST` | `/api/unsubscribe/legacy` | `email+sig` query | legacy bridge response (JSON/redirect) |
| `GET`/`POST` | `/api/unsubscribe` | compatibility shim | forwards to explicit unsubscribe endpoints |

## Admin APIs

| Method | Endpoint | Request | Response |
|--------|----------|---------|----------|
| `POST` | `/api/admin/login` | `{ email, password }` | `{ success: true }` + cookie |
| `POST` | `/api/admin/logout` | session cookie | `{ success: true }` |
| `GET` | `/api/admin/check` | session cookie | `{ authenticated }` |
| `GET` | `/api/admin/stats` | session cookie | `{ summary, health, runs, per_user, roster, admin_messages }` |
| `GET` | `/api/admin/user-by-email` | `email` query | Full user + `auto_adjustments_recent` |
| `GET` | `/api/admin/audit` | `email` query | `{ entries[] }` action/message timeline |
| `POST` | `/api/admin/bulk-action` | `{ action, emails[], dry_run?, delivery_time? }` | planned/applied/skipped summary |
| `POST` | `/api/admin/launch-agent-action` | `{ key, action:"restart" }` | service restart result + health |
| `POST` | `/api/admin/update-delivery-time` | `{ email, delivery_time }` | normalized time payload |
| `POST` | `/api/admin/run-digest` | optional `{ chatId }` | targeted/full trigger result |
| `POST` | `/api/admin/message-user` | `{ email, subject?, message, channels[] }` | send result + warnings |

---

## Product Constraints

- Storage is file-based (no transactional DB)
- Admin sessions are in-memory (server restart clears sessions)
- Multi-process deployments require shared filesystem for consistent state
- Archive visibility is scoped to `digest_dates` plus one current-date grace path
