# SignalBrief — Product Specification

## What It Is

SignalBrief is a daily AI-curated news digest for strategy consultants and business professionals. It surfaces the signals that matter across the verticals consultants are most likely to be staffed on — delivered at 7 AM before the first client meeting.

**Not a news aggregator.** Every item has a "why it matters" layer written at the level of a senior strategy consultant: what moves, who feels it, what to watch next.

## Core Thesis

Strategy consultants work across industries. On Monday you're in healthcare, Wednesday you're in financial services, Friday you're in a private equity portfolio review. You need enough context across verticals to sound informed — not a PhD-level deep dive, but a credible 30-second take.

SignalBrief provides that cross-vertical situational awareness in under 5 minutes per morning.

## Target User

- Strategy consultants at MBB, Big 4, boutiques
- Corporate strategy / BD roles at large enterprises
- Investors (PE, growth, VC) who need sector breadth
- Senior operators who need to track adjacent markets

## Coverage Verticals (v1)

| Vertical | What We Track |
|----------|---------------|
| AI & Technology | Enterprise AI deployment, infrastructure, regulation, foundation models |
| Healthcare & Life Sciences | Payers, providers, pharma, FDA, clinical AI |
| Financial Services | Banking, fintech, insurance, capital markets |
| Private Equity & M&A | Deal flow, multiples, sector activity, sponsor moves |
| Energy & Infrastructure | Transition, utilities, grid, industrials |
| Consumer & Retail | Brand moves, DTC, retail media, supply chain |
| Government & Policy | Regulation, antitrust, trade, federal budget |
| Strategy & Consulting | Firm moves, methodology shifts, client industry trends |
| Sustainability & ESG | Corporate commitments, regulation, reporting |
| Real Estate & Built Environment | CRE, construction tech, proptech |

Users pick 2+ verticals on signup. Custom topics supported (e.g. "GLP-1", "DOGE", "data centers").

## Format

### Telegram / WhatsApp
- 7 items (configurable 5/7/10)
- Numbered with keycap emoji (1⃣)
- `[VERTICAL×SUBTAG]` cross-category labels
- Headline + punchy factual lede
- `→ direct article link`
- Command menu (expanded first 5 digests, compressed after)

### Email
- Quick-scan summary bar at top
- ★ LEAD item with left blue border accent
- Bold first clause on every "Why it matters"
- `Read more →` with direct article link
- "Forward to a colleague" button in footer
- `Update preferences` link → `/settings?email=...`

## Format Rules (locked)

See `FORMAT-RULES.md`.

## Architecture

```
Perplexity Sonar (news, all topics in parallel)
        ↓
   selectItems() — dedup + interleave + tag cap
        ↓
   Claude Sonnet — "why it matters" enrichment
        ↓
  ┌──────────────────────────────────┐
  │  Per-user delivery fan-out       │
  │  - topic filter                  │
  │  - items_per_digest              │
  │  - depth preference              │
  │  → Telegram bot (@signalbrief29bot) │
  │  → Gmail API → HTML email        │
  └──────────────────────────────────┘
```

## Personalization

- **Topic selection**: pick verticals on signup, tune with `more/less [topic]`
- **Depth**: headlines only / headlines + one-liner / full "why it matters"
- **Schedule**: delivery time, frequency, items per digest
- **Bookmarks**: `save 3` → persisted to user profile with headline + URL
- **Custom topics**: freeform (e.g. "GLP-1", "quantum computing")

## Interaction (Telegram)

All replies parsed by Claude for fuzzy intent:
- `save 3` / `save 1,4,6` → bookmark
- `more AI` / `less pharma` → topic weight
- `add DOGE` → custom topic
- `/settings` → preferences
- `/bookmarks` → saved items
- `/help` → command guide
- Any question → answered with Claude in healthcare/strategy context

## Roadmap

- **Batch 0** ✅ Scope locked
- **Batch 1** ✅ Format locked (5 prototype runs)
- **Batch 2** ✅ Automation (digest.js, cron, reply handler)
- **Batch 3** ✅ Bookmarking + topic tuning
- **Batch 4** ✅ Multi-user onboarding web app
- **Batch 5** Custom domain + email sending domain
- **Batch 6** Digest archive / web reader
- **Batch 7** Referral / invite flow
