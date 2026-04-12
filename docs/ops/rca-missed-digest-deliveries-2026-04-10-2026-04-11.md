# RCA: Missed Digest Deliveries on 2026-04-10 and 2026-04-11

*Last updated: April 11, 2026*

## Executive Summary

Two consecutive scheduled digest windows failed for all 10 active canary recipients.

- **April 10, 2026:** the scheduler ran and generation spent budget, but delivery failed for every due recipient at the send stage. The system recorded `users_due=10`, `users_served=0`, and `error="no channels succeeded"` on both the initial run at **07:02 ET** and the retry at **07:17 ET**.
- **April 10, 2026 at 07:20 ET:** the digest orchestrator opened the circuit breaker after two consecutive zero-serve scheduled runs inside 60 minutes.
- **April 11, 2026:** the circuit breaker remained open across the ET date boundary. Starting at **07:04 ET**, every scheduled run was rejected at the admission gate with `blocked_reason="circuit_breaker_open"`, so no archive or audit file was generated for that date.

Primary root cause: **the first failure happened in the delivery stage on April 10, and the platform then amplified it into a second-day outage because the circuit breaker persisted overnight without an automatic reset or expiry.**

## Systems and Evidence Reviewed

- Production state on `ubuntu@129.213.92.102:/opt/signalbrief/app`
- `data/cost-log.json`
- `data/spend-guard-state.json`
- `data/digest-incident-log.jsonl`
- `data/incident-store.json`
- `data/circuit-breaker.json`
- `data/archive/2026-04-10.json`
- `data/digest-audit/2026-04-10.json`
- Docker worker logs from the current production container on April 11
- `data/digest-records/**/2026-04-10--scheduled.json`
- `data/engagement-events.jsonl`
- Local git history for production fixes landed after the incident, especially commit `13c02f7` (`Retry transient Resend mailer failures`)

## Affected Digests and Blast Radius

Affected recipients: **10 of 10 active canary recipients**

Affected digests:
- `T1` Healthcare
- `T2` Life Sciences
- `T3` Technology
- `T4` Energy
- `T5` Financial Services
- `T6` Consumer
- `T7` Industrials
- `M1` Scan
- `M2` Brief
- `M3` Deep

Impact summary:
- **April 10:** all 10 scheduled digests missed their scheduled send; they were later manually resent overnight and show delivered/opened evidence.
- **April 11:** all 10 scheduled digests were blocked before generation and were never created or sent.
- Partial send observed: **no** during the scheduled windows. The scheduled runs recorded `users_served=0`.

## Timeline

All times below are **America/New_York**.

### April 10, 2026

- **07:00 ET**: expected digest trigger window for all active canary users.
- **07:02:13 ET**: scheduled run `scheduled:2026-04-10T11-02-13-141Z` starts.
  - Evidence: `data/cost-log.json`
  - Observed result: `users_due=10`, `users_served=0`, `run_value_state="zero_value"`, `spend_cents=38.99`
  - Per-user failures: 10 entries with `error="no channels succeeded"` and `delivery_outcome="delivery_failed_retry_pending"`
- **07:17:13 ET**: scheduled retry run `scheduled:2026-04-10T11-17-13-143Z` starts.
  - Evidence: `data/cost-log.json`
  - Observed result: `users_due=10`, `users_served=0`, `run_value_state="zero_value"`
  - Per-user failures: 10 entries with `error="no channels succeeded"` and `delivery_outcome="delivery_failed_after_retry"`
- **07:20:16 ET**: circuit breaker opens.
  - Evidence: `data/digest-incident-log.jsonl`, `data/incident-store.json`
  - Incident payload: `reason="two_consecutive_zero_serve_within_60min"`
- **20:49:28 ET**: manual resend delivery succeeds for April 10 scheduled digests.
  - Evidence: `data/digest-records/**/2026-04-10--scheduled.json`
  - Example state: `current.status="sent"`, `delivery_outcome="delivered_manual_resend"`, `sent_at="2026-04-11T00:49:28.893Z"`
- **Later after resend**: end-user engagement confirms recovered delivery.
  - Evidence: `data/engagement-events.jsonl` shows `email_open` events tied to April 10 digests.

### April 11, 2026

- **07:00 ET**: expected digest trigger window.
- **07:04:56 ET**: scheduler marks all 10 users due.
  - Evidence: worker logs from current production container
  - Log sequence: due-user detection followed immediately by admission-gate block
- **07:04:56 ET through at least 07:59:56 ET**: every scheduled run is blocked before generation.
  - Evidence: worker logs and `data/cost-log.json`
  - Observed result on each run: `users_due=10`, `users_served=0`, `run_value_state="aborted_non_deliverable_pre_spend"`, `blocked_reason="circuit_breaker_open"`
- **During the entire April 11 window**: no archive or audit artifact is created.
  - Evidence: `data/archive/2026-04-11.json` missing, `data/digest-audit/2026-04-11.json` missing

## Pipeline Stage Status

### Affected Digest Date: 2026-04-10

| Stage | Status | Evidence |
| --- | --- | --- |
| Scheduler triggered job | PASS | `data/cost-log.json` scheduled run at `2026-04-10T11:02:13.141Z` |
| Job started | PASS | Scheduled run record exists with spend and per-user accounting |
| Content fetched | PASS | Non-zero spend (`38.99` cents) and completed run record indicate generation work executed |
| Digest generated | PASS | `data/archive/2026-04-10.json` exists; April 10 manual resend records reference generated payload |
| Digest persisted (archive) | PASS | `data/archive/2026-04-10.json` exists |
| Send job invoked | PASS | Per-user delivery failures recorded inside scheduled run (`delivery_failed_*`) |
| Email API called | FAIL | Direct provider request log is no longer recoverable from production containers; strongest available evidence is per-user terminal send failures with `error="no channels succeeded"` on both scheduled attempts |
| Email accepted by provider | FAIL | Scheduled runs served zero users; later manual resend was required |
| Delivery confirmed | FAIL | No scheduled sends confirmed; only later manual resend produced opens |

### Affected Digest Date: 2026-04-11

| Stage | Status | Evidence |
| --- | --- | --- |
| Scheduler triggered job | PASS | Worker logs and `data/cost-log.json` show scheduled runs starting at `2026-04-11T11:04:56.511Z` |
| Job started | PASS | Scheduled runs recorded in `data/cost-log.json` |
| Content fetched | FAIL | Runs aborted pre-spend with `run_value_state="aborted_non_deliverable_pre_spend"` |
| Digest generated | FAIL | No archive file; worker logs show admission gate block before generation |
| Digest persisted (archive) | FAIL | `data/archive/2026-04-11.json` missing |
| Send job invoked | FAIL | Admission gate stopped the run before send |
| Email API called | FAIL | No send stage reached |
| Email accepted by provider | FAIL | No send stage reached |
| Delivery confirmed | FAIL | No send stage reached |

## Root Cause

### Single source of truth

The incident has one primary causal chain:

1. **April 10 failed in the send stage for all 10 scheduled recipients.**
   - Evidence: both scheduled runs recorded `error="no channels succeeded"` for every due user and `users_served=0`.
   - Evidence: generation still ran, because the run spent budget and persisted the day archive.
2. **After two consecutive zero-serve runs, the circuit breaker opened at 07:20 ET on April 10.**
   - Evidence: `reason="two_consecutive_zero_serve_within_60min"` in incident logs.
3. **The open breaker state persisted into April 11 with no automatic reset at the next ET day boundary.**
   - Evidence: April 11 scheduled runs were blocked immediately with `blocked_reason="circuit_breaker_open"` and pre-spend aborts.
4. **Because the admission gate blocked the run before generation, April 11 never produced an archive or audit file.**

### Exact failure point

The exact first failure point was **delivery/send on April 10**, not scheduling and not generation.

The exact second-day failure point was **admission gating on April 11**, caused by stale breaker state left open from the prior day.

### Why the system did not recover automatically

- The April 10 send failure path could end in zero served users even after retry.
- The circuit breaker had **no overnight expiry and no automatic next-day reset**, so it continued blocking fresh daily runs.
- The platform had no guaranteed fallback send path when delivery failed for all recipients.

### Why the system was not detected before the UI showed `MISSED`

- The admin UI reduced different failure modes into a generic `MISSED` state without stage-level attribution.
- There was no real-time alert on:
  - two consecutive zero-serve scheduled runs
  - circuit breaker staying open into the next day
  - scheduled run blocked before generation
- April 11 blocked runs did not generate the usual archive/audit artifacts, but there was no alert keyed to missing daily outputs by topic.

## What We Can Prove vs. What Is Inferred

Proven from retained production artifacts:
- April 10 scheduler and generation ran.
- April 10 scheduled sends failed for all 10 recipients twice.
- April 10 opened the circuit breaker.
- April 11 runs were blocked by the open breaker before generation.
- April 11 therefore produced no archive and no audit file.

Inference, explicitly labeled:
- The deepest provider-specific sub-cause on April 10 was likely a transient Resend/mailer failure path. This is a strong inference, not a directly retained log fact, because the April 10 worker container logs with provider responses were no longer present by the time of investigation. The strongest supporting evidence is:
  - `error="no channels succeeded"` on both scheduled runs
  - later code fix `13c02f7` adding Resend retry handling
  - successful manual resend later that same night

## Detection Gap

Real-time gaps:
- No alert when scheduled run started but served zero users.
- No alert when the circuit breaker opened.
- No alert when the next day’s first scheduled run was blocked at the admission gate.
- No daily reconciliation alert for missing `archive/YYYY-MM-DD.json` or `digest-audit/YYYY-MM-DD.json`.

Admin visibility gap:
- UI showed `MISSED` without naming the failed stage.
- Operators had to inspect raw runtime state to distinguish:
  - send failure
  - admission-gate block
  - generation failure

## Durable Fixes Implemented

### 1. Auto-close stale circuit breaker state

Runtime change:
- `src/entrypoints/digest-orchestrator-circuit-breaker-runtime.js`

Behavior:
- Automatically closes breaker state when it is stale across the ET date boundary or open for too long.
- Prevents a prior-day incident from silently blocking a fresh day’s scheduled digest window.

### 2. Show stage-level failure reason in admin

Runtime/UI changes:
- `web/services/admin-stats-delivery.js`
- `web/routes/admin/admin-api-stats-payload-runtime.js`
- `web/admin.html`

Behavior:
- Failed delivery rows now distinguish stage labels such as:
  - `MISSED: SEND`
  - `MISSED: ADMISSION`
- Admin payload now includes latest scheduled run failure label and machine-readable reason such as `circuit_breaker_open`.
- Blocked scheduled runs now appear in the failed-delivery view even when no per-user send attempts exist.

### 3. Regression coverage

Tests added/updated:
- `tests/contracts/entrypoints/digest-orchestrator-circuit-breaker-runtime.test.js`
- `tests/contracts/web-api/admin-api-stats-payload-runtime.test.js`

Covered cases:
- stale breaker closes on the next ET day
- admin API exposes admission-gate failure reason in executive health output

## Recommended Fix Order Still Outstanding

1. **Guaranteed delivery retry at the provider boundary**
   - Keep retry logic for transient mailer/provider failures and confirm it covers all scheduled paths.
2. **Fallback send behavior**
   - If full digest delivery fails, send a degraded but explicit user-facing fallback instead of silent non-delivery.
3. **Stage-based alerting**
   - Alert on zero-serve scheduled runs, open breaker, missing archive/audit, and provider failures.
4. **End-to-end daily reconciliation**
   - Verify one successful digest per active topic and date.
5. **UI/operator diagnostics**
   - Add first-class stage codes for scheduler, generation, persistence, send, and provider acceptance.
6. **Idempotent replay tooling**
   - Safe reruns for a date/topic/user set without duplicate send risk.

## Final Assessment

- **Primary root cause:** send-stage failure on April 10 for all 10 scheduled digests, followed by stale circuit-breaker state blocking April 11 before generation.
- **Blast radius:** 10 active canary recipients across `T1` through `T7` and `M1` through `M3`.
- **Why at least one audit file is missing:** April 11 never passed admission, so generation and persistence never ran.
- **Most important prevention change already implemented in code:** stale breaker auto-reset plus stage-specific admin visibility.
