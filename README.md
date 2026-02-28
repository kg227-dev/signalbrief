# SignalBrief

> AI-curated daily news digest for strategy professionals in healthcare and life sciences.

Delivered every morning at 7 AM ET via Telegram and email. 7 items. Sharp consultant-grade analysis. Built to be forwarded.

---

## What It Does

- Pulls the top healthcare, AI, pharma, and strategy news from the last 24 hours (Perplexity Sonar)
- Selects 7 items with interleaved sector coverage — no two adjacent items from the same vertical
- Enriches each item with a "why it matters" analysis written at a senior consultant level (Claude Sonnet)
- Delivers a tight Telegram message and a full HTML email simultaneously
- Tracks bookmarks and topic preferences per user

---

## Architecture

```
Perplexity Sonar (news fetch, 7 topics in parallel)
        ↓
   selectItems() — dedup + interleave + tag cap
        ↓
   Claude Sonnet — "why it matters" enrichment
        ↓
  ┌─────────────────┐
  │  Telegram Bot   │  → SignalBrief bot → user chat
  │  Gmail API      │  → HTML email → inbox
  └─────────────────┘
```

---

## Files

| File | Purpose |
|------|---------|
| `digest.js` | Main pipeline — fetch, select, enrich, deliver |
| `reply-handler.js` | Fuzzy intent parser for user replies (save/tune/settings) |
| `templates/email.html` | HTML email template (responsive, 600px) |
| `config.json` | User config + API keys (gitignored) |
| `config.example.json` | Template — copy to config.json and fill in keys |
| `user-state.json` | Per-user state: digests_received, bookmarks, topic weights (gitignored) |
| `FORMAT-RULES.md` | Editorial format rules locked after 5 prototype runs |
| `SPEC.md` | Full product specification |
| `ROADMAP.md` | Batch-based build roadmap |

---

## Setup

```bash
# 1. Clone and enter the directory
cd signalbrief

# 2. Copy config template
cp config.example.json config.json

# 3. Fill in your keys (Perplexity, Anthropic, Google OAuth, Telegram bot tokens)
nano config.json

# 4. Start all services (bot + web)
./start.sh

# Or run individually:
node bot-server.js          # Telegram reply handler (port-less, long-poll)
node web/server.js          # Onboarding + settings UI  (localhost:3003)
node digest.js              # Manual digest run

# 5. Schedule digest via cron (7 AM ET, Mon-Sat)
# 0 12 * * 1-6 cd /path/to/signalbrief && node digest.js
# Or use OpenClaw cron: openclaw cron add --name signalbrief-daily ...
```

## Web Layer

The onboarding and settings pages run on **port 3003** via `web/server.js`.

| URL | Purpose |
|-----|---------|
| `http://localhost:3003` | New user onboarding (4-step form) |
| `http://localhost:3003/settings?email=you@co.com` | Self-serve preferences |

**The API server must be running for the onboarding form to submit.**
The `/api/signup` endpoint writes to `data/user-{chatId}.json` via `store.js`.

On macOS, both services run as LaunchAgents (auto-start on boot):
- `com.jarvis.signalbrief-web` — web server
- `com.jarvis.signalbrief-bot` — Telegram bot

---

## Keys Required

| Key | Where to Get |
|-----|-------------|
| `perplexity` | [perplexity.ai/settings/api](https://perplexity.ai/settings/api) |
| `anthropic` | [console.anthropic.com](https://console.anthropic.com) |
| `googleRefreshToken` | OAuth2 flow with Gmail send scope |
| `signalBriefBotToken` | Create via [@BotFather](https://t.me/BotFather) on Telegram |

---

## Reply Commands

Users can reply to the digest with natural language — intent is parsed by Claude:

| What you type | What happens |
|--------------|-------------|
| `save 3` | Bookmarks item 3 |
| `save 1, 4, 6` | Bookmarks multiple items |
| `more AI` | Increases AI story weight |
| `less pharma` | Decreases pharma story weight |
| `add GLP-1` | Adds GLP-1 as a tracked topic |
| `settings` | Shows current preferences |

---

## Format Rules

See `FORMAT-RULES.md` for the locked editorial spec.

**Telegram format:** Numbered (1⃣), `[TAG×TAG]` cross-category labels, sharp headline + factual lede, `→ direct article link`

**Email format:** Quick-scan header, ★ LEAD item with left blue border, bold first clause on every "Why it matters", `Read more →` with direct article link, forward CTA button in footer

---

## Roadmap

- **Batch 0** ✅ — Scope locked
- **Batch 1** ✅ — Format locked (5 prototype runs, WhatsApp + email)
- **Batch 2** ✅ — Automation built (digest.js, cron, reply handler)
- **Batch 3** — Bookmarking + topic tuning UX
- **Batch 4** — Multi-user onboarding via /start

---

## Stack

- **Node.js** — no dependencies, stdlib only
- **Perplexity Sonar** — real-time news with citations
- **Claude Sonnet** — editorial enrichment + intent parsing
- **Gmail API** — HTML email delivery
- **Telegram Bot API** — daily digest + reply handling

---

*Built by Jarvis. Delivered daily.*
