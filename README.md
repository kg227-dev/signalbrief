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
- `.env` with required `SIGNALBRIEF_*` secrets
- `config.json` optional for non-secret local overrides

Local boot:

```bash
cp config.example.json config.json
cp .env.example .env
npm install
./start.sh
```

Operational config, secrets, release windows, rollback, and recovery procedures live in [Ops Hub](./docs/ops/README.md).

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

Ops:

- [Ops Hub](./docs/ops/README.md)
- [Production Cutover Runbook](./docs/ops/production-cutover-ubuntu.md)
- [Reliability Floor Runbook](./docs/ops/reliability-floor-runbook.md)
- [Release Policy](./docs/ops/release-policy.md)

Strategy and marketing:

- [Marketing Strategy](./docs/strategy/marketing-strategy.md)
- [Marketing Execution Playbook](./docs/strategy/marketing-execution-playbook.md)
- [Marketing Metrics](./docs/strategy/marketing-metrics.md)

Active planning:

- [Planning Hub](./docs/planning/README.md)

Historical material:

- [Archive Policy](./docs/archive/README.md)
- [March 2026 Planning Archive](./docs/archive/planning/2026-03/README.md)
- [March 2026 Marketing Archive](./docs/archive/marketing/2026-03/README.md)

## Common Commands

```bash
npm run web
npm run bot
npm run worker
npm test
npm run qa:harness
npm run qa:matrix
npm run ops:deploy:staging
npm run ops:deploy:prod
```

## Production Notes

Production is cloud-first and VM-hosted.

- Secrets and runtime config policy: [Ops Hub](./docs/ops/README.md)
- Deployment, release windows, and rollback: [Release Policy](./docs/ops/release-policy.md)
- State protection and restore drills: [Reliability Floor Runbook](./docs/ops/reliability-floor-runbook.md)
- Host bootstrap and cutover: [Production Cutover Runbook](./docs/ops/production-cutover-ubuntu.md)

The closed March 2026 execution bundle now lives under [docs/archive/planning/2026-03](./docs/archive/planning/2026-03/README.md). `docs/planning/` is reserved for future in-flight execution bundles.

## Stack

- Node.js 22+
- Perplexity Sonar
- Anthropic Claude Haiku
- Telegram Bot API via long polling
- Resend with Gmail fallback
- SQLite store (production default) with explicit file-store rollback override
- Cloudflare Tunnel + Docker Compose runtime

## Contributing

1. Work from the canonical module surfaces when available.
2. Use [Change-to-Test Map](./docs/change-to-test-map.md) to choose the right checks.
3. Keep [README.md](./README.md), [SPEC.md](./SPEC.md), and [docs/features.md](./docs/features.md) aligned with behavior changes.

## License

No license file is currently present in this repository.
