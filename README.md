# SignalBrief

> AI-curated daily news digest for strategy professionals — across AI, healthcare, finance, PE, policy, and more.

Delivered every morning at 7 AM ET via Telegram and email. 7 items. Sharp consultant-grade analysis. Built to be forwarded.

---

## What It Does

- Pulls the top news across 10 strategy verticals from the last 24 hours (Perplexity Sonar)
- Selects 7 items with interleaved sector coverage — no two adjacent items from the same vertical
- Enriches each item with a "why it matters" analysis written at senior consultant level (Claude Sonnet)
- Delivers a tight Telegram message and a full HTML email simultaneously
- Tracks bookmarks and topic preferences per user
- On-demand digest via `/digest` Telegram command
- Past digests browsable at `/archive`

---

## Architecture

```
Perplexity Sonar (news fetch, 10 verticals in parallel)
        ↓
   selectItems() — dedup + interleave + tag cap
        ↓
   Claude Sonnet — "why it matters" enrichment
        ↓
  ┌──────────────────┐
  │  Telegram Bot    │  → @signalbrief29bot → user chat
  │  Resend API      │  → HTML email from digest@getsignalbrief.com
  │  (Gmail fallback)│
  └──────────────────┘
        ↓
   saveToArchive() — archive/YYYY-MM-DD.json
```

---

## Files

| File | Purpose |
|------|---------|
| `digest.js` | Main pipeline — fetch, select, enrich, deliver, archive |
| `mailer.js` | Email delivery — Resend (branded domain) with Gmail OAuth fallback |
| `reply-handler.js` | Fuzzy intent parser for user replies + `/digest` on-demand command |
| `bot-server.js` | Long-poll Telegram bot server |
| `store.js` | Per-user JSON store (data/user-{chatId}.json) |
| `templates/email.html` | HTML email template (responsive, 600px) |
| `config.json` | API keys + user config (gitignored) |
| `config.example.json` | Template — copy to config.json and fill in keys |
| `web/server.js` | Onboarding + settings + archive API server (port 3003) |
| `web/index.html` | New user onboarding (4-step form) |
| `web/settings.html` | Self-serve preferences page |
| `web/archive.html` | Digest archive — list + detail reader |
| `FORMAT-RULES.md` | Editorial format rules |
| `SPEC.md` | Full product specification |
| `ROADMAP.md` | Batch-based build roadmap |

---

## Setup

```bash
# 1. Clone and enter the directory
cd signalbrief

# 2. Copy config template
cp config.example.json config.json

# 3. Fill in your keys (see Keys Required below)
nano config.json

# 4. Start all services (bot + web)
./start.sh

# Or run individually:
node bot-server.js          # Telegram reply handler (long-poll)
node web/server.js          # Onboarding + settings + archive UI (port 3003)
node digest.js              # Manual digest run (all users)
node digest.js --chatId 123 # On-demand digest for one user

# 5. Schedule digest (7 AM ET, Mon-Sat)
# Via OpenClaw cron: openclaw cron add --name signalbrief-daily ...
# Via system cron:   0 12 * * 1-6 cd /path/to/signalbrief && node digest.js
```

### macOS LaunchAgents (auto-start on boot)

| Service | LaunchAgent |
|---------|------------|
| Web server (port 3003) | `com.jarvis.signalbrief-web` |
| Telegram bot | `com.jarvis.signalbrief-bot` |

---

## Web Layer

| URL | Purpose |
|-----|---------|
| `http://localhost:3003` | New user onboarding |
| `http://localhost:3003/settings?email=you@co.com` | Self-serve preferences |
| `http://localhost:3003/archive` | Browse past digests |
| `GET /api/archive` | List all archived digest dates |
| `GET /api/archive/:date` | Full digest for a specific date (YYYY-MM-DD) |

---

## Email — Resend + Custom Domain

SignalBrief sends from **`digest@getsignalbrief.com`** via [Resend](https://resend.com).

`mailer.js` handles delivery:
- **Primary:** Resend API (when `resendApiKey` is set in config.json)
- **Fallback:** Gmail OAuth (jarvisjones2922@gmail.com)

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
| `googleClientId` / `googleClientSecret` / `googleRefreshToken` | Gmail OAuth2 (send scope) — used as email fallback |
| `signalBriefBotToken` | [@BotFather](https://t.me/BotFather) on Telegram |
| `resendApiKey` *(optional)* | [resend.com/api-keys](https://resend.com/api-keys) — enables branded email |

---

## Telegram Bot Commands

| Command | What it does |
|---------|-------------|
| `/start` | Onboarding flow — set topics, depth, schedule |
| `/digest` | Pull a fresh digest on demand right now |
| `/settings` | View/update your preferences |
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
| `settings` | Shows current preferences |

---

## Verticals Covered

| Tag | Coverage |
|-----|----------|
| `AI×TECH` | Foundation models, AI infrastructure, enterprise deployments |
| `HEALTHCARE` | Clinical AI, pharma, biotech, FDA, payer-provider dynamics |
| `FINANCIAL SERVICES` | Banking, fintech, credit markets, regulatory shifts |
| `PE×M&A` | Buyouts, deal flow, sponsor activity, restructurings |
| `ENERGY` | Transition, grid, commodities, clean energy policy |
| `CONSUMER` | Retail, CPG, brand strategy, spending trends |
| `POLICY×REGULATORY` | Federal/state policy, antitrust, international trade |
| `STRATEGY` | Corporate strategy, operating models, org design |
| `SUSTAINABILITY` | ESG, climate risk, supply chain, carbon markets |
| `REAL ESTATE` | CRE, housing, REITs, rates impact |

---

## Archive

Every digest run saves to `archive/YYYY-MM-DD.json`. The `/archive` web page lets you browse and read past issues. Archive files are gitignored (user-specific data).

---

## Stack

- **Node.js** — stdlib only, no build step
- **Perplexity Sonar** — real-time news with citations
- **Claude Sonnet** — editorial enrichment + intent parsing
- **Resend** — branded transactional email (digest@getsignalbrief.com)
- **Gmail API** — email fallback
- **Telegram Bot API** — daily digest + reply handling

---

*Built by Jarvis. Delivered daily.*
