# SignalBrief

AI-curated daily briefings for strategy professionals across AI, healthcare, finance, policy, private equity, and other cross-sector topics.

Each user gets a personalized morning digest with topic filtering, relevance ranking, depth controls, and delivery through Telegram and HTML email.

## What It Does

- Fetches and deduplicates daily business and strategy news across 17 standard topics plus ranked custom topics.
- Enriches items with consultant-grade "why it matters" analysis.
- Personalizes delivery per user with topic weights, specialist-mode boosts, and engagement feedback.
- Delivers scheduled and on-demand digests through Telegram and email.
- Exposes onboarding, settings, archive, public digest, and admin workflows through the web runtime.

## Quick Start

Requirements:

- Node.js 22+
- `config.json` copied from `config.example.json`

Local boot:

```bash
cp config.example.json config.json
npm install
./start.sh
```

Individual processes:

```bash
npm run web
npm run bot
npm run worker
```

Core checks:

```bash
npm test
npm run smoke:worker
npm run smoke:admin-scheduler
```

## Runtime At A Glance

```text
scheduler-worker -> digest pipeline -> per-user ranking -> Telegram/email delivery
       |                    |                          |
       |                    |                          +-> engagement events + user state
       |                    +-> archive + cost log
       +-> scheduler heartbeat + health surface
```

Primary processes:

- `src/entrypoints/scheduler-worker.js`
- `src/entrypoints/digest.js`
- `src/entrypoints/bot-server.js`
- `web/server.js`

Canonical code surfaces:

- `src/domains/*` for domain logic
- `src/platform/*` for infrastructure adapters
- `web/api/*` for route registration
- `web/services/*` for web business logic
- `web/client/*` for browser-facing modules

## Documentation

Start here:

- [Documentation Index](./docs/INDEX.md)
- [Product and System Contract](./SPEC.md)
- [Format Rules](./FORMAT-RULES.md)
- [Features and Backlog](./docs/features.md)

Engineering reference:

- [Repository Map](./docs/repository-map.md)
- [First 30 Minutes](./docs/onboarding-first-30-minutes.md)
- [Change-to-Test Map](./docs/change-to-test-map.md)
- [Path and Import Rules](./docs/contributing-path-rules.md)

Active planning:

- [6-Week Execution Plan](./docs/planning/6-week-execution-plan-2026-03-16.md)
- [Production Cutover Runbook](./docs/planning/production-cutover-ubuntu.md)
- [Reliability Floor Runbook](./docs/planning/reliability-floor-runbook.md)
- [Release Policy](./docs/planning/release-policy.md)

Strategy and marketing:

- [Marketing Strategy](./docs/strategy/marketing-strategy.md)
- [Marketing Execution Playbook](./docs/strategy/marketing-execution-playbook.md)

## Common Commands

```bash
npm run web
npm run bot
npm run worker
npm test
npm run qa:harness
npm run qa:matrix
npm run ops:deploy:prod
npm run ops:deploy:staging
```

## Production Notes

Production is cloud-first and VM-hosted. Detailed deploy, backup, rollback, and migration procedures intentionally live outside this README:

- [Production Cutover Runbook](./docs/planning/production-cutover-ubuntu.md)
- [Reliability Floor Runbook](./docs/planning/reliability-floor-runbook.md)
- [Release Policy](./docs/planning/release-policy.md)

The active execution plan remains in place at [`docs/planning/6-week-execution-plan-2026-03-16.md`](./docs/planning/6-week-execution-plan-2026-03-16.md) and is intentionally not summarized here.

Store-migration and canary rollout procedures remain under `docs/planning/` while the current execution plan is active.

## Stack

- Node.js 22+
- Perplexity Sonar
- Anthropic Claude Haiku
- Telegram Bot API via long polling
- Resend with Gmail fallback
- JSON file store with optional SQLite migration path
- Cloudflare Tunnel + Docker Compose runtime

## Contributing

1. Work from the canonical module surfaces when available.
2. Use [Change-to-Test Map](./docs/change-to-test-map.md) to choose the right checks.
3. Keep [README.md](./README.md), [SPEC.md](./SPEC.md), and [docs/features.md](./docs/features.md) aligned with behavior changes.

## License

No license file is currently present in this repository.
