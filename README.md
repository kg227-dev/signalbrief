# SignalBrief

> AI-curated daily news digest for strategy professionals — across AI, healthcare, finance, PE, policy, and more.

Each user gets a personalized briefing: choose your topics, delivery time, how deep you want the analysis, and how many items. Sharp consultant-grade "why it matters" on every story. Built to be forwarded.

---

## What It Does

- Pulls top news across 17 topics (10 industries + 7 capabilities) from the last 48 hours via Perplexity Sonar
- Scores and ranks items per user with a relevance algorithm (Claude base score + per-user topic match)
- Selects 5 or 10 items with interleaved sector coverage — no two adjacent items from the same tag
- Enriches each item with a "why it matters" analysis at senior consultant level (Claude Haiku)
- Delivers a tight Telegram message and a full HTML email simultaneously
- Tracks bookmarks and topic preferences per user
- On-demand digest via `/digest` Telegram command
- Telegram-first onboarding — sign up directly in the bot with `/start your@email.com`
- Past digests browsable at `/archive`
- Admin cost dashboard at `/admin` — per-run API spend tracking

---

## Architecture

```
Perplexity Sonar (17 topics in parallel)
        ↓
   selectItems() — dedup + interleave + tag cap
        ↓
   Claude Haiku — "why it matters" enrichment + base relevance score
        ↓
  ┌──────────────────────────────────────┐
  │  Per-user delivery fan-out           │
  │  - relevance sort (baseScore + topicMatch) │
  │  - topic filter                      │
  │  - items_per_digest (5 or 10)        │
  │  - depth preference                  │
  │  → Telegram bot (@signalbrief29bot)  │
  │  → Resend API → HTML email           │
  │     (Gmail OAuth fallback)           │
  └──────────────────────────────────────┘
        ↓
   saveToArchive() — archive/YYYY-MM-DD.json
   logCosts() — data/cost-log.json
```

---

## Files

| File | Purpose |
|------|---------|
| `digest.js` | Main pipeline — fetch, score, select, enrich, deliver, archive, log costs |
| `mailer.js` | Email delivery — Resend (branded domain) with Gmail OAuth fallback + RFC 8058 unsubscribe headers |
| `reply-handler.js` | Fuzzy intent parser for Telegram replies, `/digest` on-demand, Telegram-first onboarding |
| `bot-server.js` | Long-poll Telegram bot server |
| `store.js` | Per-user JSON store (`data/user-{chatId}.json`) |
| `templates/email.html` | HTML digest email template (responsive, 600px) |
| `templates/welcome.html` | Welcome email sent on signup (email + Telegram-first flows) |
| `config.json` | API keys + config (gitignored — copy from config.example.json) |
| `config.example.json` | Template — copy to config.json and fill in keys |
| `web/server.js` | Onboarding + settings + archive + admin API server (port 3003) |
| `web/index.html` | New user onboarding (4-step form) |
| `web/settings.html` | Self-serve preferences page |
| `web/archive.html` | Digest archive — list + detail reader |
| `web/admin.html` | Admin dashboard — API cost tracking + user roster |
| `CLAUDE.md` | Codebase context for Claude Code |
| `FORMAT-RULES.md` | Editorial format rules |
| `SPEC.md` | Full product specification |
| `ROADMAP.md` | Batch-based build roadmap |

---

## Setup

```bash
# 1. Clone and enter the directory
cd signalbrief

# 2. Copy config template and fill in your keys
cp config.example.json config.json
nano config.json

# 3. Start all services (bot + web)
./start.sh

# Or run individually:
node bot-server.js          # Telegram reply handler (long-poll)
node web/server.js          # Onboarding + settings + archive UI (port 3003)
node digest.js              # Manual digest run (all active users)
node digest.js --chatId 123 # On-demand digest for one user
```

### macOS LaunchAgents (auto-start on boot)

Four plist files are installed at `~/Library/LaunchAgents/`:

| Service | LaunchAgent label |
|---------|------------------|
| Web server (port 3003) | `com.jarvis.signalbrief-web` |
| Telegram bot | `com.jarvis.signalbrief-bot` |
| Daily digest (6:45 AM ET, Mon–Sat) | `com.jarvis.signalbrief-digest` |
| Cloudflare Tunnel (public HTTPS) | `com.jarvis.signalbrief-tunnel` |

Load them after filling in `config.json`:
```bash
launchctl load ~/Library/LaunchAgents/com.jarvis.signalbrief-web.plist
launchctl load ~/Library/LaunchAgents/com.jarvis.signalbrief-bot.plist
launchctl load ~/Library/LaunchAgents/com.jarvis.signalbrief-digest.plist
launchctl load ~/Library/LaunchAgents/com.jarvis.signalbrief-tunnel.plist
```

`BASE_URL=https://getsignalbrief.com` is set in the web LaunchAgent — no extra config needed for production URLs.

---

## Web Layer

| URL | Purpose |
|-----|---------|
| `/` | New user onboarding |
| `/settings?email=you@co.com` | Self-serve preferences |
| `/archive` | Browse past digests |
| `/admin` | API cost dashboard + user roster (local only) |
| `GET /api/user?email=...` | Load user profile |
| `POST /api/signup` | Create/update user from onboarding form |
| `POST /api/settings` | Update preferences from settings page |
| `GET /api/topics` | All 17 topics (flat + grouped by industry/capability) |
| `GET /api/archive` | List all archived digest dates |
| `GET /api/archive/:date` | Full digest for a specific date (YYYY-MM-DD) |
| `GET /api/admin/stats` | Cost summary, run log, per-user costs, user roster |
| `GET\|POST /api/unsubscribe?email=...` | One-click unsubscribe (RFC 8058 compliant) |

---

## Email — Resend + Custom Domain

SignalBrief sends from **`digest@getsignalbrief.com`** via [Resend](https://resend.com).

`mailer.js` handles delivery:
- **Primary:** Resend API (when `resendApiKey` is set in config.json)
- **Fallback:** Gmail OAuth
- **Headers:** `List-Unsubscribe` + `List-Unsubscribe-Post` on all outbound mail (Gmail/Yahoo bulk sender compliance)

### Resend Setup

1. Create account at [resend.com](https://resend.com) (free: 3,000 emails/month)
2. Add your domain → get DNS records → add to registrar
3. Get API key from resend.com/api-keys
4. Add to `config.json`:

```json
{
  "keys": {
    "resendApiKey": "re_...",
    "fromEmail": "digest@yourdomain.com",
    "fromName": "SignalBrief"
  }
}
```

If `resendApiKey` is absent or blank, falls back to Gmail automatically.

---

## Keys Required

| Key | Where to Get |
|-----|-------------|
| `perplexity` | [perplexity.ai/settings/api](https://perplexity.ai/settings/api) |
| `anthropic` | [console.anthropic.com](https://console.anthropic.com) |
| `signalBriefBotToken` | [@BotFather](https://t.me/BotFather) on Telegram |
| `resendApiKey` *(optional)* | [resend.com/api-keys](https://resend.com/api-keys) — enables branded email |
| `googleClientId` / `googleClientSecret` / `googleRefreshToken` | Gmail OAuth2 — only needed if not using Resend |

---

## Telegram Bot Commands

| Command | What it does |
|---------|-------------|
| `/start` | Welcome message + link to onboarding |
| `/start your@email.com` | Link Telegram account to an existing email signup |
| `/digest` | Pull a fresh digest on demand right now |
| `/settings` | View your current preferences |
| `/bookmarks` | See your saved items |
| `/topics` | View your tracked topic weights |
| `/help` | Command reference |

Users can also reply in natural language — intent is parsed by Claude:

| What you type | What happens |
|--------------|-------------|
| `save 3` | Bookmarks item 3 |
| `save 1, 4, 6` | Bookmarks multiple items |
| `more AI` | Increases AI story weight |
| `less pharma` | Decreases pharma story weight |
| `add DOGE` | Adds DOGE as a custom topic |
| Any question | Answered by Claude in a strategy/consulting context |

### Telegram-first Onboarding

New users can sign up without the web form:
1. Send `/start` to [@signalbrief29bot](https://t.me/signalbrief29bot)
2. Bot asks for your email
3. Account created with default topics — preferences editable at `getsignalbrief.com/settings`
4. Welcome email sent with setup summary

Existing web signups link their Telegram account by sending `/start their@email.com`.

---

## Topics Covered (17)

### Industries (10)
| Tag | Coverage |
|-----|----------|
| `HEALTHCARE` | Payers, providers, clinical AI, pharma, FDA |
| `FINANCIAL SERVICES` | Banking, fintech, insurance, capital markets |
| `PE×M&A` | Private equity, deal flow, buyouts, sponsor activity |
| `ENERGY` | Transition, grid, commodities, clean energy policy |
| `CONSUMER` | Retail, CPG, brand strategy, spending trends |
| `LIFE SCIENCES` | Biotech, medical devices, genomics, drug pipelines |
| `TECHNOLOGY` | Enterprise tech, SaaS, infrastructure, cloud |
| `INDUSTRIALS` | Manufacturing, logistics, supply chain, automation |
| `REAL ESTATE` | CRE, housing, REITs, data centers |
| `PUBLIC SECTOR` | Government, defense, federal procurement |

### Capabilities (7)
| Tag | Coverage |
|-----|----------|
| `AI×TECH` | Foundation models, enterprise AI, LLM deployments |
| `STRATEGY` | Corporate strategy, operating models, org design |
| `POLICY×REGULATORY` | Federal/state policy, antitrust, trade, DOGE |
| `SUSTAINABILITY` | ESG, climate risk, supply chain, carbon markets |
| `DIGITAL` | Digital transformation, platforms, product strategy |
| `M&A ADVISORY` | Deal advisory, integration, valuation trends |
| `TALENT` | Workforce, hiring, org restructuring, compensation |

Custom topics also supported (e.g. "GLP-1", "quantum computing", "DOGE").

---

## Archive

Every digest run saves to `archive/YYYY-MM-DD.json`. The `/archive` web page lets you browse and read past issues. Archive files are gitignored.

---

## Stack

- **Node.js** — stdlib only, zero npm dependencies, no build step
- **Perplexity Sonar** — real-time news with citations
- **Claude Haiku** — editorial enrichment, relevance scoring + intent parsing
- **Resend** — branded transactional email
- **Gmail OAuth** — email fallback
- **Telegram Bot API** — daily digest + reply handling
- **Cloudflare Tunnel** — public HTTPS with custom domain, no port forwarding

---

*SignalBrief — Daily intelligence for strategy professionals.*
