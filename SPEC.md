# SignalBrief — Product Spec
> Originally scoped as "ClawdBot Daily Digest" | Renamed: SignalBrief
> Version: 1.0 | Date: 2026-02-27 | Author: Kush

## What It Is
Automated, AI-curated daily news briefing delivered via WhatsApp or Telegram each morning, with a companion long-form email. Built as an OpenClaw skill on a local Mac. Powered by Claude (summarization) + Perplexity Sonar (news discovery).

Designed for: single user today → up to 10 users with individualized topic preferences.

---

## Tech Stack
| Component | Tool | Cost |
|-----------|------|------|
| Bot Framework | OpenClaw | Free |
| News Discovery | Perplexity Sonar API | ~$1-3/mo |
| Summarization | Claude Sonnet (not Opus) | ~$5-8/mo |
| Email | Resend (free tier) | $0 |
| Email Domain | Cloudflare + Resend | ~$1/mo (domain) |
| User Config / DB | Google Sheets API | Free |
| Bookmarks | Google Sheets (separate tab) | Free |
| Runtime | Node.js ≥22 on Mac | Free |
| **Total** | | **~$7-12/mo** |

---

## Phases
| Phase | Scope | Timeline |
|-------|-------|----------|
| v1 MVP | Single-user digest, WhatsApp + email, save/bookmark, topic config via Google Sheet | Week 1-2 |
| v2 | Multi-user, onboarding flow, feedback loop tuning, Telegram | Week 3-4 |
| v3 | On-demand queries, settings dashboard | Month 2 |
| v4 | Weekly roundup, analytics, branded email template | Month 3 |

---

## Default Topic Clusters
- Pharma / Life Sciences M&A
- Clinical Trial Innovation
- AI in Healthcare
- Management Consulting Industry
- Digital Health & Health-Tech
- General Strategy & Business

Each cluster → 2-4 search queries to Perplexity Sonar.

---

## Digest Format (WhatsApp/Telegram — condensed)
```
☀️ SignalBrief — Fri, Feb 27
[AI] Headline + one-liner 🔗 link
[PBM] Headline + one-liner 🔗 link
[M&A] Headline + one-liner 🔗 link
...
📧 Full digest → check your email
💾 Reply "save 3" to bookmark
🔄 Reply "more AI" or "less M&A" to tune
```
5-8 items. Topic tag + headline + one-liner + link.

---

## Email Format (full digest)
- 2-3 sentence summaries per item
- "Why It Matters" angle per item
- Clean HTML template
- Section headers by topic cluster

---

## Personalization
Stored in Google Sheets per user:
- channel (whatsapp/telegram)
- email
- topics (comma-separated cluster IDs)
- frequency (daily_weekday / daily_all / weekly_sunday)
- delivery_time (default 07:00 ET)
- summary_depth (headline_only / headline_plus_oneliner / headline_plus_why)
- digest_length (default 7)

---

## Save / Bookmark
User replies "save 3" → appended to Google Sheets bookmarks tab with date, headline, URL, summary, topic_tag.

---

## Feedback Loop
User replies "more AI", "less M&A", "add GLP-1 drugs" → Claude parses → updates Google Sheets config.

---

## File Structure (when built)
```
~/.openclaw/workspace/signalbrief/
├── SPEC.md              ← this file
├── SKILL.md             ← OpenClaw skill definition
├── digest.js            ← main execution script
├── templates/
│   └── email.html       ← HTML email template
└── package.json
```

---

## Build Notes
- Use Sonnet, not Opus, for summarization (5-10x cheaper, task doesn't need deep reasoning)
- Use Perplexity Sonar (not Sonar Pro) unless quality is insufficient
- Tavily is free-tier fallback (1K credits/mo)
- Filter news results to last 24 hours
- Deduplicate by URL before summarization
- Add retry logic + exponential backoff for API failures
- Set spend alerts on Anthropic + Perplexity

---

## Status
🟡 On radar — not started. Waiting for Kush to queue batch-by-batch build instructions.
