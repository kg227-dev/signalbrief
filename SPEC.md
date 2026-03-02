# SignalBrief — Product Specification

*Last updated: March 2026 — reflects current live codebase*

---

## What It Is

SignalBrief is a daily AI-curated news digest for strategy consultants and business professionals. It surfaces the signals that matter across 17 topics — delivered at your chosen time, before the first client meeting.

**Not a news aggregator.** Every item has a "why it matters" layer written at the level of a senior strategy consultant: what moves, who feels it, what to watch next.

---

## Core Thesis

Strategy consultants work across industries. On Monday you're in healthcare, Wednesday you're in financial services, Friday you're in a private equity portfolio review. You need enough context across verticals to sound informed — not a PhD-level deep dive, but a credible 30-second take.

SignalBrief provides that cross-vertical situational awareness in under 5 minutes per morning.

---

## Target User

- Strategy consultants at MBB, Big 4, boutiques
- Corporate strategy / BD roles at large enterprises
- Investors (PE, growth, VC) who need sector breadth
- Senior operators who need to track adjacent markets

---

## Topics (17 total)

Users pick 2+ topics on signup. Custom topics supported (e.g. "GLP-1", "DOGE", "data centers") — stored and keyword-matched, dedicated fetch not yet wired.

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
| `M&A ADVISORY` | Deal advisory, integration, synergy capture, valuation |
| `TALENT` | Workforce trends, hiring, org restructuring |

---

## Format

### Telegram
- 5 items default (configurable 5/10 per user)
- Numbered with keycap emoji (1⃣)
- `*[VERTICAL×SUBTAG]*` bold cross-category labels
- Headline + italic "why it matters" first sentence (250-char cap, HTML stripped)
- `→ direct article link`
- Command footer (full first 5 digests, compressed after)

### Email
- Quick-scan summary bar at top (numbered headlines with tags)
- ★ LEAD item with left blue border accent
- Bold first clause on every "Why it matters"
- Relevance score badge (color-coded: green >8.5, yellow >5.0, orange >3.5, red <3.5)
- `Read more →` with direct article link
- "Forward to a colleague" button in footer
- `Update preferences` link → `/settings?token=...`

See `FORMAT-RULES.md` for locked editorial rules.

---

## Architecture

```
Perplexity Sonar (17 topics in parallel)
        ↓
   selectItems() — dedup + interleave + tag cap (max 2 per tag)
        ↓
   Claude Haiku — "why it matters" enrichment + baseScore (0–10)
        ↓
  ┌──────────────────────────────────────────┐
  │  Per-user delivery fan-out               │
  │  - relevance sort (baseScore 60% + topicMatch 40%) │
  │  - topic filter                          │
  │  - items_per_digest (5 or 10)            │
  │  - depth preference                      │
  │  → Telegram bot (@signalbrief29bot)      │
  │  → Resend API → HTML email               │
  │     (Gmail OAuth fallback)               │
  └──────────────────────────────────────────┘
        ↓
   saveToArchive() — archive/YYYY-MM-DD.json
   logCosts() — data/cost-log.json
```

---

## Personalization

| Setting | Options | Default |
|---------|---------|---------|
| **Topics** | Any of 17 standard + custom freeform | First 5 standard |
| **Depth** | Scan / Brief / Deep (see below) | Deep |
| **Delivery time** | Any 30-min slot, 5 AM – 9:30 PM ET | 7:00 AM ET |
| **Days of week** | Any combination | Weekdays (M–F) |
| **Items per digest** | 5 or 10 | 5 |

### Depth modes
| Label | Value | Delivery |
|-------|-------|----------|
| **Scan** | `headline_only` | Headline + source link only |
| **Brief** | `headline_plus_oneliner` | Headline + one-line strategic takeaway |
| **Deep** | `headline_plus_why` | Headline + full "why it matters" paragraph |

**Relevance scoring:** items sorted by `baseScore` (0–10, from Claude enrichment) × 60% + `topicMatch` (0–1, fraction of user's topics present in item tags) × 40%.

**Bookmarks:** `save 3` → persisted to user profile with headline + URL. Viewable via `/bookmarks` in Telegram.

**Topic weights:** `more AI` / `less pharma` adjusts per-user multiplier on tag-matched items. `add DOGE` stores a custom topic (keyword-matched against all fetched items; dedicated Perplexity fetch for custom topics not yet built — see features.md P2-1).

---

## Interaction (Telegram)

All replies parsed by Claude for fuzzy intent:

| Input | Action |
|-------|--------|
| `save 3` / `save 1,4,6` | Bookmark item(s) |
| `more AI` / `less pharma` | Adjust topic weight |
| `add DOGE` | Store custom topic |
| `/start email@example.com` | Link Telegram to existing web signup |
| `/digest` | Pull a fresh digest immediately (15-min cooldown) |
| `/settings` | Show preferences summary + link |
| `/bookmarks` | List saved items |
| `/help` | Command guide |
| Any question | Answered by Claude in strategy/consulting context |

### Telegram-first Onboarding
1. `/start` (unknown user) → bot asks for email
2. Email provided → account created with default topics, or linked to existing web signup
3. Settings link and welcome email sent
4. `/start email@example.com` → skips the prompt, links directly

---

## Web Layer

### User pages
| URL | Purpose |
|-----|---------|
| `/` | 4-step onboarding: name/email, topics, depth, schedule |
| `/settings?token=...` | Self-serve preferences editor |
| `/archive` | Browse and read past digests (prompts for magic link if no token) |

### Admin pages (localhost only)
| URL | Purpose |
|-----|---------|
| `/admin` | Cost dashboard, upcoming delivery schedule, run log, per-user costs, user roster |
| `/admin/user?email=...` | Per-user admin editor — edit all fields, pause/resume/unsubscribe |

---

## Data Model (per user)

```json
{
  "chatId": "6297966907",
  "name": "Alex Chen",
  "email": "alex@firm.com",
  "token": "64-char hex — used for settings/archive/unsubscribe links",
  "status": "active",
  "joined_at": "2026-03-01T00:00:00.000Z",
  "last_digest_at": "2026-03-01T11:45:00.000Z",
  "digests_received": 12,
  "preferences": {
    "depth": "headline_plus_why",
    "delivery_time": "07:00",
    "frequency": "daily_weekday",
    "days_of_week": [1, 2, 3, 4, 5],
    "items_per_digest": 5,
    "email_enabled": true,
    "telegram_enabled": true
  },
  "topics": ["AI×TECH", "PE×M&A", "STRATEGY"],
  "topic_weights": { "AI×TECH": 1.3, "ENERGY": 0.7 },
  "bookmarks": [
    { "headline": "...", "url": "...", "saved_at": "..." }
  ]
}
```

File stored at `data/user-{chatId}.json`. Defaults merged at read time via `store.js`.

---

## Infrastructure

| Component | Detail |
|-----------|--------|
| **Runtime** | Node.js — stdlib only, zero npm dependencies |
| **News source** | Perplexity Sonar (not Sonar Pro) — 17 parallel queries per run |
| **AI** | Claude Haiku (`claude-haiku-4-5`) — enrichment + intent parsing |
| **Email** | Resend API (branded `digest@getsignalbrief.com`), Gmail OAuth fallback |
| **Bot** | Telegram long-polling (port 3002) — not webhooks |
| **Web** | Raw `http.createServer`, port 3003, no framework |
| **Auth** | 64-char hex token per user (`crypto.randomBytes(32)`) |
| **Storage** | Per-user JSON files in `data/` — SQLite upgrade path at ~20 users |
| **Rate limiting** | In-memory: 5 signups/IP/15 min, 10-min email cooldown, 15-min `/digest` cooldown |
| **Public HTTPS** | Cloudflare Tunnel (`signalbrief`, ID `308a0e0b`) → `getsignalbrief.com` |
| **Cron** | LaunchAgent `com.jarvis.signalbrief-digest` — 6:45 AM ET, Mon–Sat |
| **Cost tracking** | `data/cost-log.json` (JSONL) — per-run Perplexity + Claude token spend |

---

## Product Principles

### Content must be
- **Recency-aware** — last 24–72 hours only
- **Source-quality weighted** — business press + trade press, not blogs
- **Cluster-balanced** — no over-indexing on one topic or source domain
- **Action-oriented** — at least one item per digest that affects decisions

### Digest must be
- **Short enough to read in 2–4 min** in Telegram
- **Deep enough to be useful** in email
- **Non-annoying** — one push per day, no breaking news spam (see features.md P1-7 for planned alerts)

### Personalization must be
- **Preference-based** — topics, depth, schedule
- **Behavior-based** — what you save, what you request more/less of
- **Never creepy** — no tracking beyond explicit saves and explicit tuning commands

### Two value streams
| Stream | Cadence | Examples |
|--------|---------|---------|
| **Run Stream** (daily utility) | Every day | Digest delivery, Telegram replies |
| **Build Stream** (compounding asset) | Deliberate | New features, infrastructure, growth |

Rule: Build Stream never cannibalizes Run Stream. Ship only when it doesn't degrade the daily experience.

---

## Build History

| Batch | What shipped |
|-------|-------------|
| **0** ✅ | Scope locked, target user defined |
| **1** ✅ | Format locked — 5 manual prototype runs |
| **2** ✅ | `digest.js` pipeline, LaunchAgents, 6:45 AM cron |
| **3** ✅ | `reply-handler.js` — `save`, `more/less`, Claude intent parsing, per-user JSON store |
| **4** ✅ | Multi-user — web onboarding (`index.html`), settings page, welcome email |
| **5** ✅ | Custom domain — `mailer.js`, Resend primary + Gmail fallback |
| **6** ✅ | Digest archive — `archive.html`, `/api/archive`, `saveToArchive()` |
| **7** ✅ | Beta hardening — relevance scoring, admin dashboard, rate limiting, RFC 8058 unsubscribe, Cloudflare Tunnel, Telegram-first onboarding |
| **Post-7** ✅ | Bug pass — 6 P0 fixes, 12 P1 features, 15 P2 fixes, `admin-user.html`, schedule view |

For the forward-looking roadmap (known bugs + P1–P4 features), see `features.md`.
