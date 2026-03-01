# CLAUDE.md — SignalBrief

## What this is
SignalBrief is an AI-curated daily news digest for strategy consultants. It fetches news via Perplexity Sonar, enriches with "why it matters" analysis via Claude Sonnet, and delivers via Telegram + HTML email (Resend with Gmail fallback). Zero dependencies — Node.js stdlib only.

## Current status
Batches 0-5 complete. Core pipeline works: digest.js fetches/enriches/delivers, reply-handler.js parses user commands via Claude, bot-server.js long-polls Telegram, web layer has onboarding + settings + archive pages. The product covers 17 topics across 10 Industries and 7 Capabilities (spec v2).

## Key files
- `digest.js` — Main pipeline: fetch news → select 7 items → enrich with Claude → deliver per-user (Telegram + email) → archive
- `mailer.js` — Resend API (branded domain) with Gmail OAuth fallback. Injects {{USER_EMAIL}} into settings links.
- `reply-handler.js` — Telegram reply handler. Claude-powered fuzzy intent parsing (save, more/less, add topic, /digest on-demand, questions).
- `bot-server.js` — Telegram long-polling server
- `store.js` — JSON file-based per-user data store (data/user-{chatId}.json)
- `web/server.js` — HTTP server: serves onboarding/settings/archive pages + API endpoints (/api/signup, /api/settings, /api/user, /api/archive, /api/topics)
- `web/index.html` — Onboarding form (4-step: details, topics, depth, schedule)
- `web/settings.html` + `web/settings.js` — Self-serve preferences editor
- `web/archive.html` — Past digest browser
- `templates/email.html` — HTML email template (600px responsive, blue accent #2563EB). Uses {{DATE}} and {{QUICK_SCAN}} placeholders.
- `config.json` — API keys + topics + user config (gitignored, copy from config.example.json)
- `start.sh` — Starts bot-server + web-server in parallel

## Topic architecture (17 total)
**Industries (10):** HEALTHCARE, FINANCIAL SERVICES, PE×M&A, ENERGY, CONSUMER, LIFE SCIENCES, TECHNOLOGY, INDUSTRIALS, REAL ESTATE, PUBLIC SECTOR

**Capabilities (7):** AI×TECH, STRATEGY, POLICY×REGULATORY, SUSTAINABILITY, DIGITAL, M&A ADVISORY, TALENT

Topics appear as grouped chips in onboarding (index.html) and settings (settings.html). server.js exports both flat DEFAULT_TOPICS and structured industries/capabilities arrays from /api/topics. config.example.json has Perplexity search queries for all 17 topics.

## Known issues (as of Feb 28, 2026)
1. **Settings links in email footer point to localhost:3003** — fine for local dev, but production deploy will need these updated to the real domain.
2. **Archive not linked from onboarding success card or Telegram /start** — email footer links to /archive but the post-signup success screen and bot welcome message don't mention it.
3. **config.json missing** — must be created from config.example.json before first run. digest.js, bot-server.js, web/server.js all crash without it.
4. **LaunchAgents not loaded** — created at ~/Library/LaunchAgents/ but not yet loaded. Load after config.json exists:
   ```
   launchctl load ~/Library/LaunchAgents/com.jarvis.signalbrief-bot.plist
   launchctl load ~/Library/LaunchAgents/com.jarvis.signalbrief-web.plist
   launchctl load ~/Library/LaunchAgents/com.jarvis.signalbrief-digest.plist
   ```

## Architecture decisions
- Zero npm dependencies — everything uses Node.js built-in https, http, fs, path
- Per-user JSON files in data/ directory (not a database)
- Perplexity Sonar for news search (not Sonar Pro), Claude Sonnet (`claude-sonnet-4-6`) for enrichment
- Email: Resend preferred (branded domain), Gmail OAuth fallback
- Web server on port 3003, no framework — raw http.createServer
- Telegram via long-polling (not webhooks) — runs on local Mac
- LaunchAgent labels: `com.jarvis.signalbrief-bot`, `com.jarvis.signalbrief-web`, `com.jarvis.signalbrief-digest`
- Digest cron: 6:45 AM ET Mon–Sat via LaunchAgent (com.jarvis.signalbrief-digest.plist). No OpenClaw dependency.
- httpsPost in digest.js and reply-handler.js both resolve `{ status, body }` — always access `.body` for response data

## Style notes
- Editorial voice: senior strategy consultant. Sharp, specific, implication-forward "why it matters."
- Never generic ("this could have significant implications") — always name who feels it and what moves.
- Design: off-white #FAFAFA, white cards, blue accent #2563EB, Instrument Serif + DM Sans fonts
- Telegram format: numbered keycap emojis, [TAG×TAG] labels, → article links
- Email format: quick-scan header, ★ LEAD with blue left border, WHY IT MATTERS labels
