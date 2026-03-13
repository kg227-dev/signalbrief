# SignalBrief Features And Backlog

*Last reviewed: March 13, 2026*

This file is the living backlog for product, reliability, and infrastructure work. Historical completion detail now lives in the planning docs and git history.

## Current Priorities

### P1 — Reliability And Product Trust

- [ ] Harden mail-provider response parsing and timeout behavior across all send paths.
- [ ] Fail closed on corrupt user records instead of silently rebuilding defaults.
- [ ] Finish full-text search across archive surfaces rather than partial search-only coverage.
- [ ] Complete the health and alerting story beyond scheduler heartbeat visibility.
- [ ] Document and enforce the intended admin exposure model at the edge and in ops.

### P2 — Differentiation

- [ ] Add company and entity watchlists.
- [ ] Add a dedicated "ask about this" deep-dive flow for digest items.
- [ ] Add structured consultant-lens implications instead of a single free-form analysis block.
- [ ] Add multi-source corroboration indicators.

### P3 — Growth

- [ ] Complete the referral UX beyond token capture and attribution.
- [ ] Add a public `/signals` or equivalent SEO surface for evergreen discovery.
- [ ] Add role-based onboarding that changes defaults and messaging by user type.
- [ ] Add team and shared-account flows only after the single-user loop is stronger.

### P4 — Infrastructure

- [ ] Complete the file-store to SQLite cutover path and rollout criteria.
- [ ] Add token rotation and expiry policy for user-facing auth tokens.
- [ ] Add structured logging instead of relying primarily on text `console.*` output.
- [ ] Add per-user or per-cohort feature flags for controlled rollouts.

## Roadmap Snapshot

### Retention

- Implemented: implicit topic-weight learning, digest feedback loop, duplicate detection across days, per-user timezone support, and "why you're seeing this" rendering.
- Partial: archive search is present on the web surface but not as a full product-wide search capability.
- Open: weekly synthesis digest, client briefing export, signal threading across days, breaking-news alerts.

### Differentiation

- Implemented: custom-topic fetches, source diversity caps, Telegram save/more/less buttons, email click tracking.
- Partial: shareable public digest pages exist, but end-user sharing UX is still limited.
- Open: watchlists, calendar integrations, dedicated deep-dive follow-ups, corroboration indicators.

### Growth

- Implemented: engagement winback and reengagement lifecycle flows.
- Partial: referral attribution and thank-you plumbing exist, but the end-user growth loop is not complete.
- Open: team accounts, richer public SEO pages, Slack integration, external API, role-aware onboarding.

### Infrastructure And Operations

- Partial: SQLite backend and migration tooling exist, but file-store remains the default live path.
- Partial: worker health visibility exists, but general monitoring and alerting are incomplete.
- Open: token lifecycle management, graceful shutdown completion, structured logging, fine-grained rollout controls.

## Active Risks

- Mailer pathways still need stronger timeout and parse-hardening parity.
- File-backed state remains vulnerable to silent corruption handling in some paths.
- Admin sessions remain in-memory and are invalidated on restart.
- Multi-process consistency is still constrained by shared-file assumptions until store migration is complete.

## Evidence And References

- [6-Week Execution Plan](./planning/6-week-execution-plan-2026-03-16.md)
- [Reliability Floor Runbook](./planning/reliability-floor-runbook.md)
- [Release Policy](./planning/release-policy.md)
- [Week 1 Freeze Report](./planning/week1-freeze-2026-03-11.md)
- [Week 2 Security Hardening Review](./planning/week2-security-hardening-review-2026-03-12.md)
