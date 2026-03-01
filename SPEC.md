# SignalBrief — Product Specification

## What It Is

SignalBrief is a daily AI-curated news digest for strategy consultants and business professionals. It surfaces the signals that matter across 17 topics — delivered at your chosen time before the first client meeting.

**Not a news aggregator.** Every item has a "why it matters" layer written at the level of a senior strategy consultant: what moves, who feels it, what to watch next.

## Core Thesis

Strategy consultants work across industries. On Monday you're in healthcare, Wednesday you're in financial services, Friday you're in a private equity portfolio review. You need enough context across verticals to sound informed — not a PhD-level deep dive, but a credible 30-second take.

SignalBrief provides that cross-vertical situational awareness in under 5 minutes per morning.

## Target User

- Strategy consultants at MBB, Big 4, boutiques
- Corporate strategy / BD roles at large enterprises
- Investors (PE, growth, VC) who need sector breadth
- Senior operators who need to track adjacent markets

## Topics (17 total)

Users pick 2+ topics on signup. Custom topics supported (e.g. "GLP-1", "DOGE", "data centers").

### Industries (10)
| Tag | What We Track |
|-----|---------------|
| `HEALTHCARE` | Payers, providers, pharma, FDA, clinical AI |
| `FINANCIAL SERVICES` | Banking, fintech, insurance, capital markets |
| `PE×M&A` | Deal flow, multiples, sector activity, sponsor moves |
| `ENERGY` | Transition, utilities, grid, industrials |
| `CONSUMER` | Brand moves, DTC, retail media, supply chain |
| `LIFE SCIENCES` | Biotech, medical devices, genomics, drug pipelines |
| `TECHNOLOGY` | Enterprise tech, SaaS, cloud infrastructure |
| `INDUSTRIALS` | Manufacturing, logistics, automation, supply chain |
| `REAL ESTATE` | CRE, construction tech, proptech, data centers |
| `PUBLIC SECTOR` | Government, defense, federal procurement |

### Capabilities (7)
| Tag | What We Track |
|-----|---------------|
| `AI×TECH` | Enterprise AI deployment, foundation models, infrastructure |
| `STRATEGY` | Firm moves, methodology shifts, transformation trends |
| `POLICY×REGULATORY` | Regulation, antitrust, trade, DOGE, federal budget |
| `SUSTAINABILITY` | ESG, net zero, carbon, climate policy, reporting |
| `DIGITAL` | Digital transformation, platforms, product strategy |
| `M&A ADVISORY` | Deal advisory, integration, valuation trends |
| `TALENT` | Workforce trends, hiring, org restructuring |

## Format

### Telegram
- 5 items default (configurable 5/10 per user)
- Numbered with keycap emoji (1⃣)
- `*[VERTICAL×SUBTAG]*` bold cross-category labels
- Headline + italic "why it matters" first sentence (250-char cap)
- `→ direct article link`
- Command menu (expanded first 5 digests, compressed after)

### Email
- Quick-scan summary bar at top (numbered headlines with tags)
- ★ LEAD item with left blue border accent
- Bold first clause on every "Why it matters"
- Relevance score badge (color-coded: green >8.5, yellow >5.0, orange >3.5, red <3.5)
- `Read more →` with direct article link
- "Forward to a colleague" button in footer
- `Update preferences` link → `/settings?email=...`

## Format Rules (locked)

See `FORMAT-RULES.md`.

## Architecture

```
Perplexity Sonar (17 topics in parallel)
        ↓
   selectItems() — dedup + interleave + tag cap
        ↓
   Claude Haiku — "why it matters" enrichment + baseScore (0-10)
        ↓
  ┌──────────────────────────────────────┐
  │  Per-user delivery fan-out           │
  │  - relevance sort (baseScore 60% + topicMatch 40%) │
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

## Personalization

- **Topic selection**: pick from 17 topics on signup, tune with `more/less [topic]`
- **Relevance scoring**: items sorted by baseScore (from Claude) + per-user topicMatch
- **Depth**: Scan (headline only) / Brief (headline + WIM) / Deep (extended — not yet built)
- **Schedule**: delivery time (30-min intervals), days of week, items per digest (5 or 10)
- **Bookmarks**: `save 3` → persisted to user profile with headline + URL
- **Custom topics**: freeform (e.g. "GLP-1", "quantum computing") — stored, fetch not yet wired

## Interaction (Telegram)

All replies parsed by Claude for fuzzy intent:
- `save 3` / `save 1,4,6` → bookmark
- `more AI` / `less pharma` → topic weight
- `add DOGE` → custom topic
- `/start email@example.com` → link Telegram to existing web signup
- `/settings` → preferences
- `/bookmarks` → saved items
- `/help` → command guide
- Any question → answered with Claude in strategy/consulting context

### Telegram-first Onboarding
- `/start` (no email, unknown user) → bot asks for email
- Email provided → account created with defaults OR linked to existing web signup
- Preferences editable via web settings page

## Web Layer

| URL | Purpose |
|-----|---------|
| `/` | New user onboarding (4-step: details, topics, depth, schedule) |
| `/settings?email=...` | Self-serve preferences editor |
| `/archive` | Browse and read past digests |
| `/admin` | API cost dashboard + user roster (localhost only) |

## Data Model (per user)

```json
{
  "chatId": "6297966907",
  "name": "Alex Chen",
  "email": "alex@firm.com",
  "status": "active",
  "joined_at": "2026-03-01T00:00:00.000Z",
  "last_digest_at": "2026-03-01T11:45:00.000Z",
  "preferences": {
    "depth": "headline_plus_why",
    "delivery_time": "07:00",
    "frequency": "daily_weekday",
    "days_of_week": [1, 2, 3, 4, 5],
    "items_per_digest": 5,
    "timezone": "America/New_York",
    "email_enabled": true,
    "telegram_enabled": true
  },
  "bookmarks": [],
  "topic_weights": {},
  "custom_topics": [],
  "topics": ["AI×TECH", "PE×M&A", "STRATEGY"],
  "digests_received": 0
}
```

## Roadmap

- **Batch 0** ✅ Scope locked
- **Batch 1** ✅ Format locked (5 prototype runs)
- **Batch 2** ✅ Automation (digest.js, cron, reply handler)
- **Batch 3** ✅ Bookmarking + topic tuning
- **Batch 4** ✅ Multi-user onboarding web app
- **Batch 5** ✅ Custom domain + Resend email sending
- **Batch 6** ✅ Digest archive / web reader
- **Batch 7** ✅ Beta hardening (relevance scoring, admin dashboard, rate limiting, unsubscribe, Cloudflare Tunnel, Telegram-first onboarding)
- **Batch 8** Referral / invite flow
- **Batch 9** Analytics + engagement tracking
