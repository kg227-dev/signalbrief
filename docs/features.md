# SignalBrief Features And Backlog

*Last reviewed: March 24, 2026*

This file is the living backlog for product, reliability, and infrastructure work. Closed execution details live in the planning archive and git history.

## MVP Scope (Current)

SignalBrief is an email-only daily digest across **7 fixed sectors**: Healthcare, Life Sciences, Technology, Energy, Financial Services, Consumer & Retail, and Industrials. Users pick 1–3 sectors and receive 5 curated signals per sector each morning. No custom keywords, no Telegram, no bookmarks.

## Current Priorities

### P1 — Reliability And Product Trust

- [ ] Harden mail-provider response parsing and timeout behavior across all send paths.
- [ ] Fail closed on corrupt user records instead of silently rebuilding defaults.
- [ ] Persist durable per-user delivery records keyed by user, date, and run mode.
- [ ] Make archive APIs prefer delivered snapshots over shared run archives.
- [ ] Fix pre-existing harness test failure in standard-topic search evidence rescue path (`testStandardTopicsRescueTrustedSearchEvidenceWhenProviderReturnsNothing`).
- [ ] Complete the health and alerting story beyond scheduler heartbeat visibility.
- [ ] Verify and enforce branch protection plus required CI checks on `main`.

### P2 — Quality And Differentiation

- [ ] Replace `Match %` score label with `Signal score` or `Digest quality` — current copy is misleading.
- [ ] Add storyline collapse: suppress near-duplicate signals on the same story within a single day's digest.
- [ ] Replace item scoring with a componentized signal model: novelty, source authority, confirmation count, and saturation penalty.
- [ ] Add structured "consultant-lens" implications block instead of a single free-form why-it-matters note.
- [ ] Add company and entity watchlists (post-MVP, after the single-user loop is solid).

### P3 — Growth

- [ ] Complete the referral UX: referral link, attribution display, and referrer notification are plumbed but the user-facing loop is incomplete.
- [ ] Add a public `/signals` SEO surface for evergreen topic discovery.
- [ ] Add role-aware onboarding (defaults and messaging vary by user type: operator, investor, consultant).

### P4 — Infrastructure

- [ ] Complete file-store → SQLite cutover path and define rollout criteria.
- [ ] Add token rotation and expiry policy for user-facing auth tokens.
- [ ] Add structured logging to replace primary reliance on `console.*`.
- [ ] Add per-user or per-cohort feature flags for controlled rollouts.

## Active Risks

- Mailer pathways need stronger timeout and parse-hardening parity across all send paths.
- File-backed state is vulnerable to silent corruption in some error paths.
- Admin sessions are in-memory and invalidated on restart.
- `qa:harness` remains below quality target — direct risk to digest relevance and user retention.

## Roadmap Snapshot

### Retention
- Implemented: per-topic RSS-first pipeline, source diversity caps, duplicate detection across days, per-user timezone delivery, topic weight learning, digest feedback loop, "why it matters" rendering.
- Partial: archive search exists on the web surface; durable per-user delivery snapshots are still missing.
- Open: weekly synthesis digest, signal threading across days, breaking-news alerts.

### Quality
- Implemented: broker saturation threshold (skips Perplexity when ≥10 broker items exist per topic), per-topic source registry with tier/lane classification, retrieval scoring and selection.
- Partial: search evidence rescue path has a known bug under certain provider-returns-nothing conditions.
- Open: storyline collapse, richer score composition, structured implications block.

### Growth
- Implemented: referral token capture and attribution, engagement winback and reengagement lifecycle flows, welcome digest on signup.
- Partial: referral end-user loop is not complete; public sharing UX is limited.
- Open: role-aware onboarding, SEO discovery surface, team accounts.

### Infrastructure
- Partial: SQLite backend and migration tooling exist; file-store is the explicit rollback path.
- Partial: worker health visibility exists; general monitoring and alerting are incomplete.
- Open: token lifecycle management, structured logging, fine-grained rollout controls, branch-protection enforcement.

## Evidence And References

- [Ops Hub](./ops/README.md)
- [Reliability Floor Runbook](./ops/reliability-floor-runbook.md)
- [Release Policy](./ops/release-policy.md)
- [March 2026 Planning Archive](./archive/planning/2026-03/README.md)
