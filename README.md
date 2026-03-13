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

Secret loading behavior:

- Runtime credentials are loaded from environment variables first (see `.env.example`).
- `config.json` is ignored by git and should not contain production secrets.
- If `config.json` is missing, runtime falls back to `config.example.json` for non-secret defaults.
- CORS is allowlisted by origin (`TRUSTED_CORS_ORIGINS` / `CORS_ALLOWED_ORIGINS`) instead of wildcard defaults.

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

- [Planning Hub](./docs/planning/README.md)
- [6-Week Execution Plan](./docs/planning/6-week-execution-plan-2026-03-16.md)
- [Production Cutover Runbook](./docs/planning/production-cutover-ubuntu.md)
- [Reliability Floor Runbook](./docs/planning/reliability-floor-runbook.md)
- [Release Policy](./docs/planning/release-policy.md)

Strategy and marketing:

- [Marketing Strategy](./docs/strategy/marketing-strategy.md)
- [Marketing Execution Playbook](./docs/strategy/marketing-execution-playbook.md)

Historical material:

- [Archive Policy](./docs/archive/README.md)

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
npm run ops:release:window-check
npm run ops:rollback:sha -- --rollback-sha <sha>
npm run ops:store:full-enable-validate -- --data-dir /opt/signalbrief/app/data --sqlite-path /opt/signalbrief/app/data/signalbrief.sqlite
```

## Production Notes

Production is cloud-first and VM-hosted. Detailed deploy, backup, rollback, and migration procedures intentionally live outside this README:

- [Production Cutover Runbook](./docs/planning/production-cutover-ubuntu.md)
- [Reliability Floor Runbook](./docs/planning/reliability-floor-runbook.md)
- [Release Policy](./docs/planning/release-policy.md)

The active execution plan remains in place at [`docs/planning/6-week-execution-plan-2026-03-16.md`](./docs/planning/6-week-execution-plan-2026-03-16.md) and is intentionally not summarized here.

Store-migration and canary rollout procedures remain under `docs/planning/` while the current execution plan is active.

Production deploys now enforce release windows by default (Mon-Fri 11:00 ET and 16:00 ET, +/- 45 min). Use `--hotfix` only for active incidents.

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
