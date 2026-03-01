# CLAUDE.md — SignalBrief

## What this is
SignalBrief is an AI-curated daily news digest for strategy consultants. It fetches news via Perplexity Sonar, scores and enriches with "why it matters" analysis via Claude Haiku, and delivers via Telegram + HTML email (Resend with Gmail fallback). Zero dependencies — Node.js stdlib only.

## Current status
Batches 0-7 complete. Beta-ready. Core pipeline works end-to-end: digest.js fetches/scores/enriches/delivers, reply-handler.js parses user commands via Claude + handles Telegram-first onboarding, bot-server.js long-polls Telegram, web layer has onboarding + settings + archive + admin pages. Cloudflare Tunnel serves the web layer publicly at getsignalbrief.com. All four LaunchAgents loaded and running.

## Key files
- `digest.js` — Main pipeline: fetch news → select 7 items → enrich with Claude Haiku (adds baseScore 0-10) → per-user relevance sort (baseScore 60% + topicMatch 40%) → deliver (Telegram + email) → archive → log costs. BASE_URL const for email links.
- `mailer.js` — Resend API (branded domain) with Gmail OAuth fallback. `List-Unsubscribe` + `List-Unsubscribe-Post` headers on all mail (RFC 8058). BASE_URL for unsubscribe links.
- `reply-handler.js` — Telegram reply handler. Claude-powered fuzzy intent parsing (save, more/less, add topic, /digest on-demand, questions). Telegram-first onboarding: `AWAITING_EMAIL` Map tracks chatIds mid-flow; `/start email@example.com` links existing web signups; unknown users prompted for email → account created via `handleEmailCapture()`.
- `bot-server.js` — Telegram long-polling server (port 3002)
- `store.js` — JSON file-based per-user data store (data/user-{chatId}.json)
- `web/server.js` — HTTP server (port 3003): onboarding/settings/archive/admin pages + API endpoints. In-memory rate limiting (5 signups/IP/15min + per-email cooldown). `GET|POST /api/unsubscribe`. `GET /api/admin/stats` returns summary, runs log, per-user costs, user roster. BASE_URL from env (set to https://getsignalbrief.com in LaunchAgent).
- `web/index.html` — Onboarding form (4-step: details, topics, depth, schedule)
- `web/settings.html` + `web/settings.js` — Self-serve preferences editor. Auto-scrolls to #unsub anchor. Shows confirmation screen on `?unsubscribed=1`.
- `web/archive.html` — Past digest browser
- `web/admin.html` — Admin dashboard: 4 summary cards (month cost, all-time, users served, active subscribers), recent runs table, per-user cost table, user roster table
- `templates/email.html` — HTML email template (600px responsive, blue accent #2563EB). Placeholders: `{{DATE}}`, `{{QUICK_SCAN}}`, `{{BASE_URL}}`, `{{USER_EMAIL}}`.
- `templates/welcome.html` — Welcome email with setup summary, Telegram tip (pre-filled `/start {{USER_EMAIL}}` command), archive link.
- `config.json` — API keys + topics + user config (gitignored, copy from config.example.json)
- `start.sh` — Starts bot-server + web-server in parallel

## Topic architecture (17 total)
**Industries (10):** HEALTHCARE, FINANCIAL SERVICES, PE×M&A, ENERGY, CONSUMER, LIFE SCIENCES, TECHNOLOGY, INDUSTRIALS, REAL ESTATE, PUBLIC SECTOR

**Capabilities (7):** AI×TECH, STRATEGY, POLICY×REGULATORY, SUSTAINABILITY, DIGITAL, M&A ADVISORY, TALENT

Topics appear as grouped chips in onboarding (index.html) and settings (settings.html). server.js exports both flat DEFAULT_TOPICS and structured industries/capabilities arrays from /api/topics. config.example.json has Perplexity search queries for all 17 topics.

## Known issues (as of Feb 28, 2026)
1. **Archive not linked from onboarding success card or Telegram /start** — email footer links to /archive and welcome.html links to it, but the post-signup web success screen and bot welcome message don't mention it.
2. **config.json missing on fresh clone** — must be created from config.example.json before first run. digest.js, bot-server.js, web/server.js all crash without it.
3. **Custom topics not fetched** — `custom_topics` field is stored and the `add [topic]` Telegram command works, but digest.js doesn't generate Perplexity queries for custom topics. They're saved but never appear in the digest.
4. **Depth modes partially implemented** — `scan` and `headline_plus_why` are applied during delivery. `deep` mode (extended WIM + implications + watch-next bullet) is stored but not yet built.

## Architecture decisions
- Zero npm dependencies — everything uses Node.js built-in https, http, fs, path
- Per-user JSON files in data/ directory (not a database; SQLite upgrade path at ~20 users)
- Perplexity Sonar for news search (not Sonar Pro), Claude Haiku (`claude-haiku-4-5`) for enrichment + intent parsing
- Email: Resend preferred (branded domain), Gmail OAuth fallback
- Web server on port 3003, no framework — raw http.createServer
- Telegram via long-polling (not webhooks) — runs on local Mac
- Cloudflare Tunnel (named tunnel `signalbrief`, ID `308a0e0b-b520-4ae0-92d3-ca92bf3084f9`) serves web layer publicly at getsignalbrief.com
- LaunchAgent labels: `com.jarvis.signalbrief-bot`, `com.jarvis.signalbrief-web`, `com.jarvis.signalbrief-digest`, `com.jarvis.signalbrief-tunnel`
- Digest cron: 6:45 AM ET Mon–Sat via LaunchAgent (com.jarvis.signalbrief-digest.plist). No external cron dependency.
- Rate limiting: in-memory Maps `RATE_IP` (5 req/15min) + `RATE_EMAIL` (10min cooldown) in web/server.js. `getClientIp()` respects `cf-connecting-ip` Cloudflare header.
- httpsPost in digest.js and reply-handler.js both resolve `{ status, body }` — always access `.body` for response data
- BASE_URL: `process.env.BASE_URL || "http://localhost:3003"` in server.js; set to `https://getsignalbrief.com` in com.jarvis.signalbrief-web.plist EnvironmentVariables

## Telegram-first onboarding flow
1. User sends `/start` (no email) to bot → `AWAITING_EMAIL.set(chatId, true)`, bot asks for email
2. Next non-command message intercepted in `handle()` → dispatched to `handleEmailCapture(chatId, text)`
3. If email matches existing web signup: links chatId, confirms with name
4. If email unknown: creates account with defaults (first 5 topics), sends settings URL, fires welcome email
5. `/start email@example.com` (with email): same lookup + link, skips AWAITING_EMAIL flow

## Style notes
- Editorial voice: senior strategy consultant. Sharp, specific, implication-forward "why it matters."
- Never generic ("this could have significant implications") — always name who feels it and what moves.
- Design: off-white #FAFAFA, white cards, blue accent #2563EB, Instrument Serif + DM Sans fonts
- Telegram format: numbered keycap emojis, `*[TAG×TAG]*` bold labels, headline, italic WIM first sentence (250-char cap, HTML stripped before split), `→` article link
- Email format: quick-scan header, ★ LEAD with blue left border, WHY IT MATTERS labels, relevance score badges
