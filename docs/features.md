# SignalBrief Features, Bugs, and Audit Backlog

*Refreshed: March 11, 2026*

This file tracks:
- shipped work (recently completed)
- open product features
- known bugs and reliability gaps
- technical debt and security observations

Audit-discovered items are tagged `[discovered by audit]` and include source references.

---

## Recently Completed

- ✅ Reliability floor Week 1 freeze completed with 7-day deploy + health checklist (`docs/planning/week1-freeze-2026-03-11.md`)
- ✅ Scheduler watchdog now emits run-reason diagnostics and deterministic stale-heartbeat smoke checks (`scripts/watchdog-scheduler.js`, `scripts/smoke-admin-scheduler.js`) — from commit `c5f20b2`
- ✅ Reliability floor runbook added with backup cadence, retention policy, and restore drill procedure (`docs/planning/reliability-floor-runbook.md`) — from commit `9f15641`
- ✅ Backup + restore drill tooling and contract tests shipped (`scripts/backup-state.js`, `scripts/restore-state-drill.js`) — from commit `230c866`
- ✅ Always-on scheduler worker and cloud deploy stack shipped (`scheduler-worker.js`, `docker-compose.yml`) — from commit `8d3ceb1`
- ✅ Scheduler health and cloud cutover runbook shipped (`planning/production-cutover-ubuntu.md`) — from commit `33b328f`
- ✅ Custom-topic recall and depth prompt rigor improved (`digest.js`) — from commit `3b44d02`
- ✅ Admin overdue-delivery visibility added (`web/admin.html`, `/api/admin/stats`) — from commit `1d2f7bd`
- ✅ Failed-delivery resend panel added to admin workflows (`web/admin.html`, `web/server.js`) — from commit `8f7f2eb`
- ✅ Public shareable digest pages are implemented (`GET /digest`, `GET /digest/:date`) — source: `web/server.js:2668`
- ✅ Auto topic-weight learning is implemented and persisted — source: `digest.js:1562`, `store.js:39`
- ✅ Digest feedback capture (`Great/Fine/Meh`) is implemented — source: `reply-handler.js:646`, `web/server.js:2050`

---

## P1 — High Priority

- [ ] **Harden mail provider response parsing** `[bug][sev-high][discovered by audit]`
  Source: `mailer.js:77`, `mailer.js:110`
  Why: `JSON.parse` is used without guard in both Resend and Google token callbacks; malformed/non-JSON upstream responses can throw and break delivery paths.

- [ ] **Enforce `/api/settings` parity with onboarding constraints** `[bug][sev-high][discovered by audit]`
  Source: `web/server.js:1322`, onboarding check at `web/server.js:1246`
  Why: Signup enforces minimum 2 topics, but settings updates do not validate `topics` at all; API callers can store inconsistent preference state.

- [ ] **Validate and clamp `items_per_digest` in API writes** `[bug][sev-high][discovered by audit]`
  Source: `web/server.js:1322`, trim logic in `digest.js:1646`
  Why: UIs only expose `5/10`, but API can persist arbitrary values, causing inconsistent behavior and oversized expectations.

- [ ] **Corrupt user-file handling should fail closed, not silently reset defaults** `[bug][sev-high][discovered by audit]`
  Source: `store.js:82-83`
  Why: JSON parse failure currently returns a default user object for that chatId, which can mask data corruption and risk silent state loss.

- [ ] **Document and decide admin exposure model explicitly** `[security][sev-high][discovered by audit]`
  Source: `web/server.js:507-510`
  Why: Admin protection is session-based (not localhost-only), with optional `ADMIN_LOCAL_BYPASS`; this should be explicitly operationalized and guarded at the edge.

---

## P2 — Medium Priority

- [ ] **Remove dead code and stale comments in bot server** `[tech-debt][sev-medium][discovered by audit]`
  Source: `bot-server.js:11`, `bot-server.js:19`
  Why: `http` import and `PORT` constant are unused; header comment still says “webhook server” while implementation is long-polling.

- [ ] **Constrain and normalize `days_of_week` in settings API** `[bug][sev-medium][discovered by audit]`
  Source: `web/server.js:1322`
  Why: API accepts arbitrary arrays without sanitization to `0..6`, potentially causing schedule drift and UI/API mismatch.

- [ ] **Add explicit timeout handling for Gmail send path parity** `[reliability][sev-medium][discovered by audit]`
  Source: `mailer.js:143`
  Why: Telegram/Perplexity paths use explicit request timeouts; Gmail send path currently does not set a timeout, increasing hang risk.

- [ ] **Persist admin sessions across restarts or surface restart invalidation in UI** `[product][sev-medium][discovered by audit]`
  Source: `web/server.js:89`, `web/server.js:122`
  Why: Admin sessions are in-memory; server restarts invalidate all sessions unexpectedly.

---

## P3 — Lower Priority / Enhancements

- [ ] Add optional DB-backed store mode for multi-instance consistency (`SQLite` first step)
- [ ] Add retry/backoff telemetry counters to admin health payload for upstream providers
- [ ] Add automated docs consistency check that compares code routes/commands/topics against markdown tables

---

## Technical Debt

- [ ] **Config duplication and drift risk** `[discovered by audit]`
  Current behavior depends on values in both code defaults and `config.json`; add one authoritative schema validator at startup.

- [ ] **Manual string-token matching for topic semantics** `[discovered by audit]`
  Source: `digest.js:690-812`
  Alias/related-topic heuristics are practical but brittle; consider centralized taxonomy + tests for regressions.

- [ ] **Large monolith files** `[discovered by audit]`
  `digest.js` and `web/server.js` contain many responsibilities; incremental modularization would reduce regression risk.

---

## Security Notes (Documented, Not Fixed)

- **Token generation** is cryptographically secure (`crypto.randomBytes(32)`) — source: `store.js:11`.
- **Admin routes** are cookie-session protected; they are not restricted to localhost by default — source: `web/server.js:507`.
- **Unsubscribe via email** is signed with HMAC to avoid unauthenticated POST unsubscribes — source: `mailer.js:31`, `web/server.js:1400`.
- **Input sanitization** is partial: key fields are validated, but some preference payload fields are permissive (`/api/settings`) — source: `web/server.js:1322`.

---

## Notes from This Audit Run

- `features.md` was missing from the repository and has been recreated.
- No `TODO/FIXME/HACK/XXX/TEMP/WORKAROUND` markers were found in `.js`/`.html` source files.
