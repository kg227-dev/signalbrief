# SignalBrief

SignalBrief is a reduced-scope, email-only digest product.

Current product shape:
- 7 standard topics only: `HEALTHCARE`, `LIFE SCIENCES`, `TECHNOLOGY`, `ENERGY`, `FINANCIAL SERVICES`, `CONSUMER & RETAIL`, `INDUSTRIALS`
- users choose 1-3 topics
- each subscribed topic gets up to 5 selected items per day
- freshness is hard-capped at 48 hours
- each story is assigned to one best-fit topic only
- RSS/direct feeds are the backbone; discovery/search is supplemental
- delivery is scheduled email only

## Quick Start

Requirements:
- Node.js 22+
- `.env` with required `SIGNALBRIEF_*` secrets
- `config.json` optional for local non-secret overrides

```bash
cp config.example.json config.json
cp .env.example .env
npm install
./start.sh
```

Local processes:

```bash
npm run web
npm run worker
```

Checks:

```bash
npm test
npm run smoke:worker
npm run smoke:admin-scheduler
```

## Runtime At A Glance

```text
scheduler-worker -> digest orchestrator -> topic selection -> email delivery
       |                    |                    |
       |                    |                    +-> delivery records + engagement events
       |                    +-> archive + audit + cost log
       +-> scheduler heartbeat + health surface
```

Primary processes:
- `src/entrypoints/scheduler-worker.js`
- `src/entrypoints/digest.js`
- `web/server.js`

## Documentation

Start here:
- [Documentation Index](./docs/INDEX.md)
- [Reduced-Scope MVP Spec](./docs/reduced-scope-mvp.md)
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
- [Source Quality Registry](./docs/ops/source-quality-registry.md)
- [Retrieval Eval Worklog](./docs/ops/retrieval-eval-worklog.md)

Historical material:
- [Archive Policy](./docs/archive/README.md)
- [March 2026 Planning Archive](./docs/archive/planning/2026-03/README.md)
- [March 2026 Marketing Archive](./docs/archive/marketing/2026-03/README.md)
- [March 2026 Strategy Archive](./docs/archive/strategy/2026-03/README.md)
