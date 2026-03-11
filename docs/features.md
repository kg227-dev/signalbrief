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

- ✅ Startup `config.json` schema validation now fails fast on invalid shape/values (`src/runtime/config-provider.js`, `src/runtime/config-schema-runtime.js`)
- ✅ Reliability floor Week 1 freeze completed with 7-day deploy + health checklist (`docs/planning/week1-freeze-2026-03-11.md`)
- ✅ Scheduler watchdog now emits run-reason diagnostics and deterministic stale-heartbeat smoke checks (`scripts/watchdog-scheduler.js`, `scripts/smoke-admin-scheduler.js`) — from commit `c5f20b2`
- ✅ Reliability floor runbook added with backup cadence, retention policy, and restore drill procedure (`docs/planning/reliability-floor-runbook.md`) — from commit `9f15641`
- ✅ Backup + restore drill tooling and contract tests shipped (`scripts/backup-state.js`, `scripts/restore-state-drill.js`) — from commit `230c866`
- ✅ Always-on scheduler worker and cloud deploy stack shipped (`scheduler-worker.js`, `docker-compose.yml`) — from commit `8d3ceb1`
- ✅ Scheduler health and cloud cutover runbook shipped (`planning/production-cutover-ubuntu.md`) — from commit `33b328f`
- ✅ Custom-topic recall and depth prompt rigor improved (`digest.js`) — from commit `3b44d02`
- ✅ Admin overdue-delivery visibility added (`web/admin.html`, `/api/admin/stats`) — from commit `1d2f7bd`
- ✅ Failed-delivery resend panel added to admin workflows (`web/admin.html`, `web/server.js`) — from commit `8f7f2eb`
- ✅ Public shareable digest pages are implemented (`GET /digest`, `GET /digest/:date`) — source: `web/routes/public-static.js`, `web/server-render-public-pages-runtime.js`
- ✅ Auto topic-weight learning is implemented and persisted — source: `src/runtime/personalization/personalization-runtime.js`, `src/runtime/user-contract-runtime.js`
- ✅ Digest feedback capture (`Great/Fine/Meh`) is implemented — source: `src/digest/runtime/digest-formatting-telegram-keyboard-runtime.js`, `src/runtime/reply/reply-command-engagement-runtime.js`

---

## Restored Feature Roadmap (Validated Against Current Code)

Roadmap source restored from your March 2 snapshot, then re-checked against this codebase on **March 11, 2026**.

Important correction:
- The old line "all P1 MVP and all P2 post-launch fixes are implemented" is stale for the current codebase.
- Status is mixed: some items are implemented, some partial, many still not implemented.

### Status of Previous B-Series Audit Fixes (B-1 to B-8)

- ✅ **B-1 fixed**: settings load failure distinguishes invalid token vs generic/network error and shows retry/request-link flows (`web/settings-runtime.js`, `web/settings.html`).
- ✅ **B-2 fixed**: token lookup uses in-memory `tokenIndex` map (`src/runtime/store-record-runtime.js`).
- ✅ **B-3 fixed**: signed legacy unsubscribe (`sig`) is validated server-side (`web/routes/core-api-unsubscribe-actions-runtime.js`, `src/runtime/mailer/mailer-runtime.js`).
- ✅ **B-4 fixed**: custom topic add normalizes to `custom_<slug>` (`src/runtime/reply/reply-command-engagement-runtime.js`).
- ✅ **B-5 fixed**: archive persistence stores `baseScore` (`src/digest/runtime/archive-persistence-runtime.js`).
- ✅ **B-6 fixed**: on-demand single-user runs fetch only tracked standard topics (`src/entrypoints/digest-orchestrator-core-runtime.js`).
- ✅ **B-7 fixed**: user writes are atomic (`.tmp` write + `renameSync`) (`src/runtime/store-record-runtime.js`).
- ✅ **B-8 fixed**: topic weights now influence relevance score via `weightBonus` (`src/digest/domain/topic-domain-runtime.js`).

### Roadmap P1 — Retention

- `[x]` **P1-1 Implicit relevance learning from saves/clicks** — implemented (`src/runtime/personalization/personalization-runtime.js`, `web/routes/core-api-engagement-actions-runtime.js`).
- `[ ]` **P1-2 Weekly synthesis digest** — not implemented (no `weekly-digest` runtime/template path in current tree).
- `[ ]` **P1-3 Client briefing export** — not implemented (no `/briefing` command/page route).
- `[ ]` **P1-4 Signal threading across days** — not implemented (`thread_id` flow absent).
- `[x]` **P1-5 Digest feedback loop** — implemented (`src/digest/runtime/digest-formatting-telegram-keyboard-runtime.js`, `src/runtime/reply/reply-command-engagement-runtime.js`).
- `[~]` **P1-6 Full-text search across past digests** — partial (web archive search exists; `/api/search` and Telegram `/search` are absent).
- `[ ]` **P1-7 Breaking-news alerts** — not implemented (no alert-mode scheduler/trigger path).
- `[x]` **P1-8 Duplicate detection across days** — implemented (`src/digest/runtime/archive-history-runtime.js`, `src/entrypoints/digest-orchestrator-core-runtime.js`).
- `[x]` **P1-9 Per-user timezone support** — implemented in user model + settings handling + digest formatting (`src/runtime/user-contract-runtime.js`, `web/services/web-user-settings-runtime.js`, `src/entrypoints/digest-orchestrator-core-runtime.js`).
- `[x]` **P1-10 "Why you're seeing this" note** — implemented via `why_shown` in email/Telegram rendering (`src/digest/runtime/digest-formatting-email-items-runtime.js`, `src/digest/runtime/digest-formatting-telegram-content-runtime.js`).

### Roadmap P2 — Differentiation

- `[x]` **P2-1 Custom topic Perplexity queries** — implemented (`src/entrypoints/digest-orchestrator-core-runtime.js` custom topic fetch path).
- `[ ]` **P2-2 Company/entity watchlist** — not implemented (no persisted per-user watchlist model/controls).
- `[ ]` **P2-3 Earnings/regulatory calendar integration** — not implemented.
- `[ ]` **P2-4 "Ask about this" deep-dive reply** — not implemented as dedicated intent.
- `[x]` **P2-5 Source diversity scoring/caps** — implemented via per-source cap in selection policy (`src/digest/domain/selection-domain-runtime.js`).
- `[x]` **P2-6 Telegram inline buttons (save/more/less)** — implemented (`src/digest/runtime/digest-formatting-telegram-keyboard-runtime.js`, `src/entrypoints/bot-server.js`).
- `[x]` **P2-7 Email click tracking** — implemented (`/api/click` route + tracked links in email renderer).
- `[~]` **P2-8 Share a signal with colleague** — partial (public shareable digest page exists; `/share [#] [email]` command flow is absent).
- `[~]` **P2-9 Structured consultant-lens implications** — partial (deep mode exists, but no labeled Strategy/Financial/Regulatory buckets).
- `[ ]` **P2-10 Multi-source corroboration indicator** — not implemented.

### Roadmap P3 — Growth

- `[ ]` **P3-1 Team accounts** — not implemented.
- `[~]` **P3-2 Referral system** — partial (referral token capture + attribution + thank-you email + admin stats exist; full end-user referral UX remains limited).
- `[ ]` **P3-3 Public `/signals` SEO page** — not implemented.
- `[ ]` **P3-4 Slack integration** — not implemented.
- `[ ]` **P3-5 External API (`/api/v1/*`)** — not implemented.
- `[ ]` **P3-6 Role-based smart onboarding** — not implemented.
- `[x]` **P3-7 Engagement winback emails** — implemented (`src/jobs/reengagement-runtime.js`, mailer lifecycle senders).

### Roadmap P4 — Infrastructure & Operations

- `[ ]` **P4-1 SQLite migration** — not implemented (file-store remains active runtime path).
- `[ ]` **P4-2 Token rotation/expiry** — not implemented for settings/auth tokens.
- `[~]` **P4-3 Health monitoring/alerting** — partial (`/api/health/scheduler` and watchdog tooling exist; no generic `/api/health` + external monitor config committed here).
- `[ ]` **P4-4 Telegram webhook mode** — not implemented (`bot-server` remains long-polling).
- `[ ]` **P4-5 Perplexity cross-run cache for on-demand** — not implemented.
- `[~]` **P4-6 Graceful shutdown handlers** — partial (`scheduler-worker` and digest runtime handle SIGINT/SIGTERM; web/bot runtime shutdown is incomplete).
- `[ ]` **P4-7 Structured logging** — not implemented (still primarily `console.*` text logs).
- `[~]` **P4-8 Per-topic cost attribution** — partial (run-level cost is logged; per-topic cost attribution and admin surfacing are not complete).
- `[ ]` **P4-9 Per-user feature flag framework** — not implemented in user model/runtime path.

### Recommended Build Order (Roadmap-Carryover)

- Immediate (stability + trust): P1-6 complete, P2-8 complete, P4-3 complete.
- Sprint 1 (retention): P1-10 polish, P1-8 tune, P1-5 analytics wiring, P1-7.
- Sprint 2 (personalization): P2-2, P1-1 refinements, P2-9.
- Sprint 3 (differentiation): P2-10, P2-3, P2-4.
- Sprint 4 (growth): P3-2 complete UX, P3-3, P3-6.
- Sprint 5 (infra): P4-1, P4-2, P4-7, P4-9.

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

- [~] **Config duplication and drift risk** `[discovered by audit]`
  Startup schema validator is now in place (`src/runtime/config-schema-runtime.js`), but defaults still span code + config and should be unified behind one authoritative contract.

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
