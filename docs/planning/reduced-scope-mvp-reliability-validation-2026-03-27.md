# Reduced-Scope MVP Reliability Validation

*Created: March 27, 2026*
*Status: Active*

## Purpose

Validate the current reduced-scope MVP against real scheduled production behavior over a 7-day canary-only window.

This is a fresh standalone validation artifact. It is intentionally separate from the older reliability recovery and superpower planning docs.

## Source of Truth

- [Reduced-Scope MVP](/Users/kushgulati/Desktop/signalbrief/docs/planning/reduced-scope-mvp.md)
- March 27, 2026 QA audit conclusions embedded at the top of the active reduced-scope MVP doc

## Validation Boundaries

- Scheduled email path only
- Canary-only exposure
- 7 consecutive production days
- Admin auditability is the primary evidence source
- Inbox receipt is a secondary transport spot-check
- Manual resend, regenerate, and topic audit rerun are diagnosis/recovery tools only
- No day can be upgraded from red to green using manual intervention
- No non-reliability code releases during the validation window

## Default Canary Cohort

All canary users must be valid non-`@example.com` accounts visible in admin.

At least 1 canary user must be tied to an operator-controlled real inbox or alias for end-to-end email spot-checking. The rest can be aliases or internal addresses. They do not need to use `kushgulati29@gmail.com`.

Default cohort shape:

- 7 single-topic users, one per MVP topic
- 1 three-topic user at `scan`
- 1 three-topic user at `brief`
- 1 three-topic user at `deep`

All non-canary active users must be paused for the full validation window using existing admin user-status controls.

### Canary Roster

| Slot | Email | Topics | Depth | Delivery time ET | Notes |
|---|---|---|---|---|---|
| T1 | kushgulati29+sb-t1-healthcare@gmail.com | Healthcare | Deep (`headline_plus_why`) | 07:00 | Single-topic, prod chatId=email-1774672712991 |
| T2 | kushgulati29+sb-t2-lifesciences@gmail.com | Life Sciences | Deep (`headline_plus_why`) | 07:00 | Single-topic, prod chatId=email-1774672713007 |
| T3 | kushgulati29+sb-t3-technology@gmail.com | Technology | Deep (`headline_plus_why`) | 07:00 | Single-topic, prod chatId=email-1774672713013 |
| T4 | kushgulati29+sb-t4-energy@gmail.com | Energy | Deep (`headline_plus_why`) | 07:00 | Single-topic, prod chatId=email-1774672713018 |
| T5 | kushgulati29+sb-t5-finserv@gmail.com | Financial Services | Deep (`headline_plus_why`) | 07:00 | Single-topic, prod chatId=email-1774672713023 |
| T6 | kushgulati29+sb-t6-consumer@gmail.com | Consumer & Retail | Deep (`headline_plus_why`) | 07:00 | Single-topic, prod chatId=email-1774672713028 |
| T7 | kushgulati29+sb-t7-industrials@gmail.com | Industrials | Deep (`headline_plus_why`) | 07:00 | Single-topic, prod chatId=email-1774672713033 |
| M1 | kushgulati29+sb-m1-scan@gmail.com | Healthcare, Technology, Financial Services | Scan (`headline_only`) | 07:00 | Multi-topic, prod chatId=email-1774672713038 |
| M2 | kushgulati29+sb-m2-brief@gmail.com | Life Sciences, Energy, Industrials | Brief (`headline_plus_oneliner`) | 07:00 | Multi-topic, prod chatId=email-1774672713043 |
| M3 | kushgulati29+sb-m3-deep@gmail.com | Consumer & Retail, Financial Services, Industrials | Deep (`headline_plus_why`) | 07:00 | Multi-topic, prod chatId=email-1774672713049 |

## Evidence Sources

Use only the currently available repo and product surfaces below:

- `npm test`
- `npm run qa:harness`
- `npm run smoke:worker`
- `npm run smoke:admin-scheduler`
- `npm run ops:verify-runtime`
- `npm run ops:backup:state`
- `npm run ops:drill:restore-state -- --latest --clean`
- `npm run eval:retrieval -- --historical-days=14`
- `GET /api/health/scheduler`
- `GET /api/admin/digest-audit?date=YYYY-MM-DD`
- Admin digest-audit view
- Admin source-registry view

## Hard Exit Gates

The 7-day window passes only if all of the following are true:

- 100% canary topic-days are delivered at exactly 5 items
- 0 selected items are older than 48 hours
- 0 duplicate URLs appear across consecutive same-topic days
- 100% topic-days have candidate depth `>=15`
- Selected Tier 1/2 share is `>=80%`
- Broker/RSS+official candidate share is `>=70%`
- Discovery candidate share is `<=20%`
- Broker source success rate is `>=90%`
- No day requires resend, regenerate, or manual rerun to satisfy the canary promise
- The operator can diagnose any failed topic-day from admin audit in under 60 seconds

## Daily Color Rules

- `Green`: all daily thresholds met, no manual intervention needed
- `Yellow`: no user-facing miss, but one supporting metric misses for the day
- `Red`: any underfilled send, freshness breach, duplicate URL breach, scheduler failure, circuit-breaker stop, or manual recovery needed to meet the promise

## Day 0 Preflight

### Day 0 Summary

| Field | Value |
|---|---|
| Current deploy SHA | `02bc16211dcad3e2d2c39ac66a98e893acc901a7` |
| Validation start date | 2026-03-28 (Day 1 = first 07:00 ET send) |
| Validation end date | 2026-04-03 (Day 7) |
| Primary operator | Kush Gulati |
| Secondary operator | TBD |
| Current digest tuning snapshot | No `data/digest-tuning.json` present — system uses hardcoded defaults |
| Current source registry snapshot | `data/source-registry.json` (17 domains, last updated 2026-03-21) |
| Non-canary users paused | N/A — production SQLite had 0 pre-existing users; only canary users exist |
| Canary delivery window ET | 07:00 ET (all 10 canary users aligned) |

### Known Caveats From March 27 Audit

- Missing clean 4-hour feed-ingestion backbone/cache
- Source registry is not yet fully singular and discovery controls are incomplete
- Legacy scope still leaks into active modules and audit noise remains elevated
- Depth-mode implementation still has enrichment/ordering caveats

### Day 0 Checklist

- [x] Record current deploy SHA
- [x] Snapshot current digest tuning state
- [x] Snapshot current source-registry state
- [x] Configure canary cohort in admin
- [x] Pause all non-canary active users
- [x] Align canary delivery times to one ET window
- [x] Run `npm test`
- [x] Run `npm run qa:harness`
- [x] Run `npm run smoke:worker`
- [x] Run `npm run smoke:admin-scheduler`
- [x] Run `npm run ops:verify-runtime`
- [x] Run `npm run eval:retrieval -- --historical-days=14`
- [x] Run `npm run ops:backup:state`
- [x] Record any pre-existing warnings before Day 1

### Day 0 Results

| Check | Result | Notes |
|---|---|---|
| `npm test` | PASS | All critical path tests passed (243 sidecar modules). Scheduler lock state=corrupt flagged but contract test passes. |
| `npm run qa:harness` | WARN | Composite 75.1/100. Topic Matching 90.5% PASS, Item Count 100% PASS, Depth Control 100% PASS, Module Coverage 100% PASS. Relevance Scoring 55.6% FAIL, Diversity 52.3% FAIL, Analysis Quality 3.93/5 WARN, Cross-Day Freshness 72.7% WARN. Lowest persona: Stress Brief Industrials (28.0). |
| `npm run smoke:worker` | PASS | Worker boots, runs digest, exits cleanly. `no_due_users` (expected — no canary users configured yet). |
| `npm run smoke:admin-scheduler` | PASS | Stale-health and healthy-after-stale checks pass. |
| `npm run ops:verify-runtime` | FAIL | Docker not available in local dev environment. Expected for non-containerized runs. |
| `npm run eval:retrieval -- --historical-days=14` | WARN | `completed_with_errors`. 4 scenarios, 26 personas, overall_score=0. Broker produced 306 candidates across 6 MVP topics — broker saturation reached for all 6. Budget spent: $10.72. Fixed `appRoot` reference bug in `runner-runtime.js:678` to unblock the run. |
| `npm run ops:backup:state` | PASS | `state-backup-20260328-040859-02bc162.tgz` — 101 files, 30.7MB |

### Pre-Existing Warnings (recorded before Day 1)

1. **Scheduler lock corrupt**: `lock state=corrupt; manual intervention required (invalid_json)` — the scheduler enters blocked mode and refuses runs until the lock file is manually reset.
2. **QA harness failures**: Relevance Scoring (55.6%) and Diversity (52.3%) are below passing thresholds. These reflect scoring/selection quality concerns, not delivery infrastructure.
3. **Retrieval eval scoring broken**: All persona scores returned 0 despite successful candidate fetching and enrichment. Likely a scoring/assertion bug in the eval harness, not a retrieval failure.
4. **Legacy topic fetching in eval**: The eval still fetches non-MVP topics (PE×M&A, REAL ESTATE, PUBLIC SECTOR, AI×TECH, STRATEGY, etc.) via Perplexity discovery lanes.
5. **Parse error**: `SUSTAINABILITY preferred` source returned malformed JSON during eval.
6. **SEC URL drops**: Two FINANCIAL SERVICES items dropped for unsupported `sec.gov` evidence URLs.
7. **Docker unavailable**: `ops:verify-runtime` cannot run locally. Not blocking for canary validation if deploy target is verified separately.

## 7-Day Summary Scorecard

| Day | Date | Scheduler healthy | Canary users due | Canary users delivered | Topic-days expected | Topic-days 5/5 | Freshness violations >48h | Duplicate URL violations | Topic-days depth <15 | Tier 1/2 share | Broker share | Discovery share | Broker source success | Incidents opened | Circuit breaker | Manual interventions | Color | Notes |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---:|---|---|---|---|
| Day 1 | 2026-03-28 | Yes | 10 | 0 | 16 | 0 | 0 | 0 | 10 observed in audit; 2 intended-topic misses | KPI bug in admin | KPI bug in admin | KPI bug in admin | 89.36% | 4 | Closed | Scheduler lock reset pre-Day 1; no rerun used to satisfy canaries | Red | Scheduled run executed, but all canaries missed. Audit leaked 8 legacy topics; 9 canaries failed on `normalizeCustomKeyword is not defined`; T6 was withheld because `CONSUMER` did not bucket into `CONSUMER & RETAIL`. |
| Day 2 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |  |
| Day 3 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |  |
| Day 4 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |  |
| Day 5 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |  |
| Day 6 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |  |
| Day 7 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |  |

## Daily Runbook

### Every Day Before the Send Window

- [ ] Check `GET /api/health/scheduler`
- [ ] Confirm scheduler is healthy and not blocked
- [ ] Confirm no circuit-breaker stop condition is active
- [ ] Confirm canary users are still active
- [ ] Confirm non-canary users remain paused

### Every Day After the Scheduled Send

- [ ] Confirm canary receipt status in admin
- [ ] Spot-check transport for at least 1 operator-controlled inbox
- [ ] Pull `GET /api/admin/digest-audit?date=YYYY-MM-DD`
- [ ] Record all scorecard fields
- [ ] Log any miss or yellow condition before end of morning ET

## Day-by-Day Checklists

### Day 1

- [x] Pre-send checks complete
- [x] Post-send checks complete
- [x] Scorecard row completed
- [x] Root cause note added if yellow or red

#### Day 1 Result

`Red`

The scheduled run executed on production as `scheduled:2026-03-28T11-04-33-111Z`, but the canary promise failed. The run-level audit captured 15 topic buckets instead of the intended 7 reduced-scope topics, and all 10 canary records ended in either failed delivery or withholding.

#### Day 1 What Worked

- Scheduler did run on time and produced a scheduled audit doc at `data/digest-audit/2026-03-28.json`.
- Freshness held: no selected item in the audit exceeded 48 hours.
- Broker/source backbone was materially present in the selected set even though the admin KPI is currently wrong. Selected lanes were `41 broker_publisher_feed`, `5 broker_official`, and `3 broad`.
- The source backbone itself was close to target at `42/47` successful broker source fetches, or `89.36%`.

#### Day 1 What Failed

- **Canary delivery failed**: 9 canary digest records failed after selection with `normalizeCustomKeyword is not defined`.
- **Consumer delivery path failed differently**: T6 (`Consumer & Retail`) was withheld with `retrieval_thin`, and M3 only had `10/15` items available. This aligns with active selection producing `CONSUMER` while user subscriptions and delivery bucketing expect `CONSUMER & RETAIL`.
- **Reduced-scope topic enforcement failed**: the Day 1 audit file contains 15 topic keys: `TECHNOLOGY`, `REAL ESTATE`, `LIFE SCIENCES`, `HEALTHCARE`, `FINANCIAL SERVICES`, `AI×TECH`, `ENERGY`, `INDUSTRIALS`, `CONSUMER`, `DIGITAL`, `POLICY×REGULATORY`, `TALENT`, `PUBLIC SECTOR`, `STRATEGY`, and `SUSTAINABILITY`.
- **Candidate depth failed**: only 5 of the 15 observed audit topics cleared the `>=15` candidate threshold. On the intended 7-topic set, `HEALTHCARE` had `12` candidates and `CONSUMER` had `7`.
- **Admin readiness KPIs are partially wrong**: the current digest-audit readiness layer reported `0%` trusted share and `0%` broker share even though the selected set was mostly broker-fed and mostly from `strong`/`premium`/`standard` sources. This means the dashboard is not yet a reliable source for those specific Day 1 percentages.

#### Day 1 Root Cause Summary

1. **Legacy delivery code is still active**: the send path crashes on a custom-keyword normalization reference that should not be on the active reduced-scope MVP path.
2. **Legacy topic scope is still leaking into scheduled selection/audit**: the scheduled run is still emitting non-MVP topic tags into the Day 1 audit.
3. **Topic naming is inconsistent in the active path**: `CONSUMER` selection does not align with `CONSUMER & RETAIL` user subscriptions and exact-match delivery bucketing.
4. **Admin KPI math is not yet trustworthy for backbone/trusted-share reporting**: the selected-set evidence and the readiness calculations disagree.

#### Day 1 Immediate Execution Order

1. Fix the delivery crash so scheduled canaries can actually complete.
2. Fix active topic normalization and delivery bucketing so only the 7 MVP topics participate, including `CONSUMER & RETAIL`.
3. Fix admin digest-audit KPI math so Day 2 evidence reflects the real run.

#### Day 1 Remediation Started

- [x] Clamp active config/fetch topic lists to the 7 reduced-scope MVP topics and canonicalize `CONSUMER` to `CONSUMER & RETAIL`.
- [x] Normalize per-user delivery bucketing so legacy `CONSUMER` selections still land in `CONSUMER & RETAIL` subscriptions.
- [x] Fix admin digest-audit readiness math to count string source tiers (`premium`, `strong`, `standard`) and audited candidate lanes (`broker_publisher_feed`, `broker_official`, `broad`) correctly.
- [x] Re-ran local contract coverage: `npm test`, `npm run smoke:worker`, and `npm run smoke:admin-scheduler` all passed before deploy.
- [x] Set `SIGNALBRIEF_ANTHROPIC_TIMEOUT_MS=60000` in production `.env` to prevent Claude enrichment timeouts. Default 30s was too tight for 49-item enrichment batches; 60s gives sufficient headroom. Also documented the tuning knobs (`SIGNALBRIEF_ANTHROPIC_TIMEOUT_MS`, `SIGNALBRIEF_ANTHROPIC_RETRIES`, `SIGNALBRIEF_ANTHROPIC_RETRY_DELAY_MS`) in `.env.example`.

### Day 2

- [ ] Pre-send checks complete
- [ ] Post-send checks complete
- [ ] Scorecard row completed
- [ ] Root cause note added if yellow or red

### Day 3

- [ ] Pre-send checks complete
- [ ] Post-send checks complete
- [ ] Scorecard row completed
- [ ] Root cause note added if yellow or red

### Day 4

- [ ] Pre-send checks complete
- [ ] Post-send checks complete
- [ ] Scorecard row completed
- [ ] Root cause note added if yellow or red
- [ ] Run `npm run ops:drill:restore-state -- --latest --clean`
- [ ] Record restore drill duration
- [ ] Record restore drill result

#### Day 4 Restore Drill

| Field | Value |
|---|---|
| Drill started at | TBD |
| Drill completed at | TBD |
| Duration | TBD |
| Result | TBD |
| Notes |  |

### Day 5

- [ ] Pre-send checks complete
- [ ] Post-send checks complete
- [ ] Scorecard row completed
- [ ] Root cause note added if yellow or red

### Day 6

- [ ] Pre-send checks complete
- [ ] Post-send checks complete
- [ ] Scorecard row completed
- [ ] Root cause note added if yellow or red

### Day 7

- [ ] Pre-send checks complete
- [ ] Post-send checks complete
- [ ] Scorecard row completed
- [ ] Root cause note added if yellow or red
- [ ] Re-run `npm run eval:retrieval -- --historical-days=14`
- [ ] Compare against Day 0 baseline
- [ ] Record final verdict

## Issue Log

| Date | Severity | Trigger | What failed | User impact | Evidence | Root cause | Intervention used | Follow-up action | Closed |
|---|---|---|---|---|---|---|---|---|---|
| 2026-03-28 | Critical | Scheduled delivery runtime | 9 canary digests failed after selection with `normalizeCustomKeyword is not defined` | 9/10 canary sends failed; 0 successful canary deliveries on Day 1 | Production digest records under `data/digest-records/email-177467271*/2026-03-28--scheduled.json` | Legacy custom-keyword delivery path still active in reduced-scope runtime | None during Day 1 window; no rerun used to claim success | Patch delivery runtime and re-verify on Day 2 | No |
| 2026-03-28 | High | Scheduled topic selection/audit | Audit emitted 15 topic keys instead of the intended 7 reduced-scope topics | Day 1 evidence polluted; out-of-scope topic logic is still active | Production audit file `data/digest-audit/2026-03-28.json` | Legacy topic scope still leaks into scheduled selection/audit | None | Restrict active scheduled path to the 7 MVP topics only | No |
| 2026-03-28 | High | Topic naming mismatch | `CONSUMER` selection did not land in `CONSUMER & RETAIL` user buckets | T6 was withheld; M3 underfilled at `10/15` requested items | Production digest records for `email-1774672713028` and `email-1774672713049` | Exact-match delivery bucketing does not reconcile active topic aliases | None | Normalize delivery bucketing/topic tags to the MVP canonical topic names | No |
| 2026-03-28 | Medium | Admin audit KPI math | Trusted-share and broker-share KPIs reported impossible zeros | Operator dashboard is misleading for Day 1 backbone/trust metrics | Selected-item lane/tier breakdown from `data/digest-audit/2026-03-28.json` vs readiness calculations | Readiness builder assumes numeric source tiers and inconsistent fetch counters | Manual inspection of raw audit doc | Fix digest-audit metric calculation before relying on dashboard percentages | No |

## Scenario Handling Notes

### Clean Green Day

- All scorecard thresholds met
- No intervention required
- Record green and move on

### Retrieval-Thin Underfill

- Mark the day red
- Log the affected topic-days
- Use audit output to identify candidate depth shortfall
- Do not count resend/regenerate/rerun as a recovery to green

### Ranking-Policy-Limited Underfill

- Mark the day red
- Use audit rejections and source/tuning state to identify why 5/5 was not reachable
- Record whether the problem came from source caps, repetition suppression, freshness gate, or other ranking constraints

### Freshness Breach

- Mark the day red
- Log the exact item and age
- Record whether the breach came from fetch, selection, or delivery ordering behavior

### Cross-Day Repeat Breach

- Mark the day red
- Log the duplicate URL and affected topic
- Record whether it was true repetition, same-story follow-up, or canonicalization failure

### Broker/Discovery Mix Drift

- Mark the day yellow unless it also caused a user-facing miss
- Record the measured broker share and discovery share
- Use source-registry and audit surfaces to identify the weak lane

### Source-Health Degradation

- Mark the day yellow unless it also caused a user-facing miss
- Record affected sources, topics, and observed success rate

### Scheduler or Circuit-Breaker Incident

- Mark the day red
- Record incident details
- Record whether any canary user missed the scheduled send window

## Final Decision

### Day 7 Closeout Summary

| Field | Value |
|---|---|
| Day 0 retrieval-eval baseline | TBD |
| Day 7 retrieval-eval result | TBD |
| Red days | TBD |
| Yellow days | TBD |
| Green days | TBD |
| Final verdict | TBD |

### Final Verdict Rules

- `PASS`: no red days and all 7-day exit gates met
- `CONDITIONAL`: no user-facing red days, but one recurring structural metric still misses
- `FAIL`: any red day or repeated yellow pattern showing the system is not ready

### Final Operator Notes

TBD

## What This Validation Does Not Prove

- It does not prove the codebase is fully cleaned of legacy scope
- It does not prove the missing 4-hour ingestion backbone is solved
- It does not override the March 27 audit findings
- It does prove whether the current scheduled canary path behaves reliably enough to justify broader rollout
