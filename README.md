# SignalBrief

> AI-curated daily news digest for strategy professionals across AI, healthcare, finance, PE, policy, and more.

Each user gets a personalized briefing: selected topics, delivery schedule, analysis depth, and item count. SignalBrief delivers to Telegram and email, tracks engagement, and continuously tunes relevance.

---

## Current Focus (March 2026)

- Tier 1 quality: measurable relevance, cross-day freshness, stronger analyst-grade output quality
- Tier 2 personalization: save/click/feedback loops with automatic topic-weight adjustment
- Tier 3 distribution: public digest pages, admin reliability controls, and cloud-first scheduling

Roadmap + audit backlog: [`docs/features.md`](./docs/features.md)

---

## Recent Changes (Last 24 Hours)

- `3b44d02` Improved custom-topic recall and depth prompt rigor
- `33b328f` Added cloud cutover runbook and scheduler health checks
- `8d3ceb1` Added always-on scheduler worker and cloud deploy stack
- `1d2f7bd` Admin now surfaces overdue deliveries in today schedule
- `8f7f2eb` Added failed-delivery resend panel in admin

---

## What It Does

- Fetches business/strategy news via Perplexity Sonar across 17 standard topics
- Fetches additional dedicated custom-topic pulls for active due users in the same run
- Deduplicates against recent archives and enforces source/tag diversity caps
- Enriches selected items with Claude Haiku (`wim_brief`, `wim`, `baseScore`, `implications`, `watch_next`)
- Scores per-user relevance with topic match + topic weights + specialist-mode adjustment
- Delivers scheduled and on-demand digests through Telegram and HTML email
- Tracks engagement events (`sent`, `clicked`, `saved`, `ignored`, `feedback`, `topic_weight_adjusted`)
- Computes and stores Digest Quality Score (DQS) history per user
- Archives full run output by ET date and exposes user-scoped archive APIs
- Provides admin operations for diagnostics, bulk actions, messaging, and run control

---

## Architecture

```text
scheduler-worker.js (optional startup run + 5-min interval loop)
        |
        v
digest.js (run lock + due-user scheduling + catch-up window)
        |
        +--> Perplexity Sonar (standard topics)
        +--> Perplexity Sonar (ranked custom topics, capped per run)
        |
        v
cross-day dedup (archive-aware) + selectItems() caps
        |
        v
Claude Haiku enrichment (wim + baseScore + implications + watch_next)
        |
        v
Per-user fan-out:
  - topic filter (standard + custom keyword matching)
  - relevanceScore = base*0.6 + topicMatch*0.4 + weightBonus + specialistBonus
  - depth transform (scan/brief/deep)
  - DQS compute + engagement logging
  - Telegram + email delivery
        |
        v
archive/YYYY-MM-DD.json + data/cost-log.json + user JSON state updates
```

---

## Repository Map

| Path | Purpose |
|------|---------|
| `src/entrypoints/` | Process entrypoints (`digest`, `bot`, `worker`) |
| `src/domains/` | Canonical domain imports (`digest`, `reply`, `personalization`, `engagement`) |
| `src/platform/` | Canonical platform imports (`config`, `store`, `mailer`, `scheduler`, `types`) |
| `src/digest/`, `src/runtime/` | Current implementation modules behind canonical facades |
| `src/jobs/` | Background jobs (`digest-runner`, reengagement) |
| `web/server/` | Canonical web server runtime imports |
| `web/api/` | Canonical API grouping (`admin`, `core`, `public`) |
| `web/services/` | Service grouping indexes and implementations |
| `web/client/` | Canonical target for page/state/action client modules |
| `web/*.html`, `web/*.js`, `web/style.css` | Static assets served in production |
| `tests/contracts/` | Contract/integration tests |
| `test-harness/` | Deterministic QA harness and matrix runner |
| `scripts/` | Smoke checks and verification scripts |
| `deploy/launchagents/` | LaunchAgent template files for local Mac fallback ops |
| `docs/` | Backlog, planning, marketing, onboarding, and contribution docs |
| `artifacts/` | Ignored generated local outputs |

Quick navigation for new engineers:
- [Docs Index](./docs/INDEX.md)
- [First 30 Minutes](./docs/onboarding-first-30-minutes.md)
- [Change-to-Test Map](./docs/change-to-test-map.md)
- [Path and Import Rules](./docs/contributing-path-rules.md)

---

## Setup

```bash
# 1. Configure
cp config.example.json config.json

# 2. Start all local services
./start.sh

# Optional individual processes
node web/server.js
node src/entrypoints/bot-server.js
node src/entrypoints/scheduler-worker.js

# Manual digest runs
node src/entrypoints/digest.js
node src/entrypoints/digest.js --chatId 123456789
```

### Useful scripts

```bash
npm run smoke:worker
npm run smoke:admin-scheduler
npm run ops:deploy:prod
npm run ops:deploy:web
npm run ops:verify-runtime:quick
npm run ops:verify-runtime
npm run ops:watchdog-scheduler
npm run qa:harness
npm run qa:matrix
```

### Production deployment (recommended — no laptop dependency)

Run SignalBrief on an always-on Linux VM/container host. This removes dependency on a Mac being awake.

Current production status (2026-03-06): live on always-on Ubuntu VM (`web` + `bot` + `worker`) with Cloudflare tunnel connector running on VM.

1. Provision a small always-on host (2 vCPU / 2 GB RAM is enough for current scale).
2. Copy repo + `config.json` to that host.
3. Create `.env`:
```bash
cp .env.example .env
```
4. Start all services:
```bash
docker compose up -d --build
```
5. Verify runtime health before accepting traffic:
```bash
npm run ops:verify-runtime
```

### Fast production deploy (one command)

From your local repo:
```bash
npm run ops:deploy:prod
```

For web-only/admin/UI hotfixes (no bot/worker restart):
```bash
npm run ops:deploy:web
```

This performs:
1. Package current workspace to `/tmp/signalbrief-deploy-<sha>.tgz`
2. Upload to VM over SSH
3. Extract in `/opt/signalbrief/app`
4. Restart `web bot worker` with `docker compose up -d --build`
5. Run remote runtime checks (`ops:verify-runtime:quick`)
6. Run public checks (`/`, cache-busted `index.js`, `/api/health/scheduler`)

Landing-page assets are automatically cache-busted at runtime (`?v=<asset_version>`) using server-side token replacement in `index.html`.

Optional env overrides:
- `DEPLOY_SSH_HOST` (default `129.213.92.102`)
- `DEPLOY_SSH_USER` (default `ubuntu`)
- `DEPLOY_SSH_KEY` (default `~/.ssh/signalbrief_vm`)
- `DEPLOY_REMOTE_DIR` (default `/opt/signalbrief/app`)
- `DEPLOY_PUBLIC_URL` (default `https://getsignalbrief.com`)
- `DEPLOY_SERVICES` (default `web bot worker`)
- `ALLOW_EXAMPLE_SIGNUPS` (`0` by default in `NODE_ENV=production`; set to `1` only for controlled testing)

Optional flags:
- `--skip-build`
- `--skip-remote-verify`
- `--skip-public-verify`

Smoke scripts now force an isolated temp data directory (`SIGNALBRIEF_DATA_DIR=/tmp/...`) to avoid polluting production-like user data during local/runtime checks.

Optional watchdog (for cron/systemd timer): auto-restart worker if scheduler heartbeat goes stale.
```bash
SCHEDULER_WATCHDOG_AUTO_RESTART=1 npm run ops:watchdog-scheduler
```

Services in `docker-compose.yml`:
- `web` — onboarding/settings/archive/admin HTTP layer
- `bot` — Telegram command + callback handler via long polling (`getUpdates`)
- `worker` — 24/7 scheduler loop that runs `digest.js` every 5 minutes

Telegram ingress defaults to polling-first runtime mode. Webhook mode is legacy/optional and not active in normal production operation.

Persistent state is mounted on disk (`./data`, `./archive`), so user state and digests survive restarts.

Full VM cutover commands: [`docs/planning/production-cutover-ubuntu.md`](./docs/planning/production-cutover-ubuntu.md)

### macOS LaunchAgents (local fallback only)

Four plist files are installed at `~/Library/LaunchAgents/`:

| Service | LaunchAgent label |
|---------|------------------|
| Web server (port 3003) | `com.jarvis.signalbrief-web` |
| Telegram bot | `com.jarvis.signalbrief-bot` |
| Daily digest via LaunchAgent interval (legacy) | `com.jarvis.signalbrief-digest` |
| Cloudflare Tunnel (public HTTPS) | `com.jarvis.signalbrief-tunnel` |

Load them after filling in `config.json`:
```bash
launchctl load ~/Library/LaunchAgents/com.jarvis.signalbrief-web.plist
launchctl load ~/Library/LaunchAgents/com.jarvis.signalbrief-bot.plist
launchctl load ~/Library/LaunchAgents/com.jarvis.signalbrief-digest.plist
launchctl load ~/Library/LaunchAgents/com.jarvis.signalbrief-tunnel.plist
```

`BASE_URL=https://getsignalbrief.com` is set in the web LaunchAgent — no extra config needed for production URLs.

Note: these LaunchAgents are now fallback/rollback only and are intentionally unloaded in normal production operation.
Template for re-engagement fallback job: `deploy/launchagents/com.jarvis.signalbrief-reengagement.plist`.
---

## Configuration Keys (`config.json`)

### `keys`

| Key | Required | Notes |
|-----|----------|-------|
| `perplexity` | Yes | Perplexity Sonar API key |
| `anthropic` | Yes | Claude API key |
| `signalBriefBotToken` | Yes | Primary Telegram bot token |
| `telegramBotToken` | Optional | Legacy fallback bot token |
| `resendApiKey` | Optional | If missing, mail falls back to Gmail OAuth |
| `fromEmail` | Recommended | Sender email when using Resend |
| `fromName` | Recommended | Sender display name |
| `googleClientId` | Required for Gmail fallback | OAuth client ID |
| `googleClientSecret` | Required for Gmail fallback | OAuth client secret |
| `googleRefreshToken` | Required for Gmail fallback | OAuth refresh token |

### `digest`

| Key | Default | Purpose |
|-----|---------|---------|
| `itemCount` | `7` | Base global selection target |
| `maxItemsPerTag` | `2` | Diversity cap per tag |
| `maxItemsPerSourceDomain` | `2` | Diversity cap per source domain |
| `catchupWindowMinutes` | `720` | Scheduled catch-up window |
| `crossDayDedupDays` | `3` | Archive lookback for duplicate suppression |
| `maxCustomItemsPerRun` | `3` | Cap custom-topic items in selected pool |
| `minBaseScoreForFinal` | `6.5` | Strong-item filtering threshold |
| `lookbackHours` | `48` | News freshness target |

---

## Telegram Commands

| Command | Behavior |
|---------|----------|
| `/start` | Welcome + onboarding/link flow |
| `/start your@email.com` | Link Telegram chat to existing account |
| `/verify 123456` | Complete email verification for account linking |
| `/digest` | Trigger on-demand digest (15-minute cooldown) |
| `/settings` | Show preferences summary |
| `/bookmarks` | Show saved items |
| `/topics` | Show tracked topics and adjustments |
| `/help` | Show command help |

### Natural-language intents (Claude parsed)

| Input Pattern | Parsed Action |
|---------------|---------------|
| `save 3`, `save 1,4,6` | Save digest items |
| `more AI` | Increase topic weight |
| `less pharma` | Decrease topic weight |
| `add GLP-1` | Add custom topic |
| `bookmarks` / `saved items` | Show bookmarks |
| `settings` / `preferences` | Show settings summary |
| `topics` | Show topics list |
| Other question | Claude short-form answer |

Inline callback buttons per digest item: `Save`, `More like this`, `Less like this`, plus digest-level feedback (`Great`, `Fine`, `Meh`).

---

## Web Routes

### User pages

| URL | Purpose |
|-----|---------|
| `/` | Onboarding |
| `/settings?token=...` | Settings editor |
| `/archive` | Archive browser/search |
| `/digest` or `/digest/YYYY-MM-DD` | Public share page |

### Public APIs

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/topics` | Return standard topic lists |
| `GET` | `/api/user?token=...` | Return user profile by token |
| `GET` | `/api/health/scheduler` | Scheduler heartbeat + digest lock health (200 healthy, 503 unhealthy) |
| `POST` | `/api/signup` | Create user + trigger welcome digest |
| `POST` | `/api/settings` | Update token-authenticated user settings |
| `GET` | `/api/archive?token=...` | User-scoped archive list |
| `GET` | `/api/archive/all?token=...` | User-scoped flattened archive feed |
| `GET` | `/api/archive/:date?token=...` | User-scoped full digest for date |
| `GET` | `/api/click?token=...&did=...&item=...&url=...` | Tracked outbound redirect |
| `POST` | `/api/bookmarks` | Add/remove bookmark by URL |
| `POST` | `/api/request-link` | Send magic link email |
| `GET` | `/api/unsubscribe/confirm?token=...` | Browser unsubscribe confirmation redirect |
| `POST` | `/api/unsubscribe/one-click?token=...` | RFC8058 one-click unsubscribe |
| `GET`/`POST` | `/api/unsubscribe/legacy?email=...&sig=...` | Legacy signed-email bridge |
| `GET`/`POST` | `/api/unsubscribe` | Deprecated compatibility shim to new unsubscribe endpoints |

### Admin pages + APIs (session-authenticated)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/admin/login` | Admin login page |
| `GET` | `/admin` | Admin dashboard |
| `GET` | `/admin/user?email=...` | Per-user editor |
| `POST` | `/api/admin/login` | Admin login, set cookie |
| `POST` | `/api/admin/logout` | Clear admin cookie |
| `GET` | `/api/admin/check` | Session health check |
| `GET` | `/api/admin/stats` | Summary/health/runs/roster payload |
| `GET` | `/api/admin/user-by-email?email=...` | User details + auto-adjustment history |
| `GET` | `/api/admin/audit?email=...` | User action/message audit timeline |
| `POST` | `/api/admin/bulk-action` | Dry-run or apply bulk user operations |
| `POST` | `/api/admin/launch-agent-action` | Restart LaunchAgent service |
| `POST` | `/api/admin/update-delivery-time` | Set one user’s delivery time |
| `POST` | `/api/admin/run-digest` | Trigger targeted or full digest run |
| `POST` | `/api/admin/message-user` | Send operator message via email/Telegram |

---

## Topics (17)

| Group | Tag |
|-------|-----|
| Industry | `HEALTHCARE` |
| Industry | `FINANCIAL SERVICES` |
| Industry | `PE×M&A` |
| Industry | `ENERGY` |
| Industry | `CONSUMER` |
| Industry | `LIFE SCIENCES` |
| Industry | `TECHNOLOGY` |
| Industry | `INDUSTRIALS` |
| Industry | `REAL ESTATE` |
| Industry | `PUBLIC SECTOR` |
| Capability | `AI×TECH` |
| Capability | `STRATEGY` |
| Capability | `POLICY×REGULATORY` |
| Capability | `SUSTAINABILITY` |
| Capability | `DIGITAL` |
| Capability | `M&A ADVISORY` |
| Capability | `TALENT` |

Custom topics are stored as `custom_<slug>` and fetched as dedicated Perplexity queries for due users.

---

## Stack

- Node.js 22+ (stdlib-only)
- Perplexity Sonar
- Anthropic Claude Haiku (`claude-haiku-4-5`)
- Telegram Bot API (long polling)
- Resend (primary email)
- Gmail OAuth2 (fallback email)
- Cloudflare Tunnel + custom domain
- JSON file storage (`data/`, `archive/`)

---

## LaunchAgents (Legacy Mac Ops)

| Service | LaunchAgent Label | Current Role |
|---------|-------------------|--------------|
| Web | `com.jarvis.signalbrief-web` | Active for local Mac runtime |
| Bot | `com.jarvis.signalbrief-bot` | Active for local Mac runtime |
| Digest Cron | `com.jarvis.signalbrief-digest` | Legacy/optional; expected stopped in cloud-first mode |
| Tunnel | `com.jarvis.signalbrief-tunnel` | Active when exposing local runtime |

---

## Known Limitations

- User and admin session state is in-process memory/JSON files (no shared DB/session store).
- Admin APIs are not localhost-only by default; protection is session auth, with optional local bypass flag.
- If a user JSON file is corrupt, `readUser()` falls back to defaults for that chatId.
- Custom keyword tracking is capped at 3 per user (enforced by UI, API, and Telegram command path).

---

## Contributing

1. Create a branch for focused changes.
2. Run relevant smoke checks (`npm run smoke:worker`, `npm run smoke:admin-scheduler`).
3. For ranking/quality changes, run harness suites (`npm run qa:harness`).
4. Keep docs (`README.md`, `SPEC.md`, `docs/features.md`) in sync with behavior changes.

---

## License

No license file is currently present in this repository. Add a `LICENSE` file before open-source redistribution.
