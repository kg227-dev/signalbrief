# CLAUDE.md — SignalBrief
## Best practices 
* Always read entire files. Otherwise, you don’t know what you don’t know, and will end up making mistakes, duplicating code that already exists, or misunderstanding the architecture.  
* Commit early and often. When working on large tasks, your task could be broken down into multiple logical milestones. After a certain milestone is completed and confirmed to be ok by the user, you should commit it. If you do not, if something goes wrong in further steps, we would need to end up throwing away all the code, which is expensive and time consuming.  
* Your internal knowledgebase of libraries might not be up to date. When working with any external library, unless you are 100% sure that the library has a super stable interface, you will look up the latest syntax and usage via either Perplexity (first preference) or web search (less preferred, only use if Perplexity is not available)  
* Do not say things like: “x library isn’t working so I will skip it”. Generally, it isn’t working because you are using the incorrect syntax or patterns. This applies doubly when the user has explicitly asked you to use a specific library, if the user wanted to use another library they wouldn’t have asked you to use a specific one in the first place.  
* Always run linting after making major changes. Otherwise, you won’t know if you’ve corrupted a file or made syntax errors, or are using the wrong methods, or using methods in the wrong way.   
* Please organise code into separate files wherever appropriate, and follow general coding best practices about variable naming, modularity, function complexity, file sizes, commenting, etc.  
* Code is read more often than it is written, make sure your code is always optimised for readability  
* Unless explicitly asked otherwise, the user never wants you to do a “dummy” implementation of any given task. Never do an implementation where you tell the user: “This is how it *would* look like”. Just implement the thing.  
* Whenever you are starting a new task, it is of utmost importance that you have clarity about the task. You should ask the user follow up questions if you do not, rather than making incorrect assumptions.  
* Do not carry out large refactors unless explicitly instructed to do so.  
* When starting on a new task, you should first understand the current architecture, identify the files you will need to modify, and come up with a Plan. In the Plan, you will think through architectural aspects related to the changes you will be making, consider edge cases, and identify the best approach for the given task. Get your Plan approved by the user before writing a single line of code.   
* If you are running into repeated issues with a given task, figure out the root cause instead of throwing random things at the wall and seeing what sticks, or throwing in the towel by saying “I’ll just use another library / do a dummy implementation”.   
* You are an incredibly talented and experienced polyglot with decades of experience in diverse areas such as software architecture, system design, development, UI & UX, copywriting, and more.  
* When doing UI & UX work, make sure your designs are both aesthetically pleasing, easy to use, and follow UI / UX best practices. You pay attention to interaction patterns, micro-interactions, and are proactive about creating smooth, engaging user interfaces that delight users.   
* When you receive a task that is very large in scope or too vague, you will first try to break it down into smaller subtasks. If that feels difficult or still leaves you with too many open questions, push back to the user and ask them to consider breaking down the task for you, or guide them through that process. This is important because the larger the task, the more likely it is that things go wrong, wasting time and energy for everyone involved.

## What this is
SignalBrief is an AI-curated daily news digest for strategy consultants. It fetches news via Perplexity Sonar, scores and enriches with "why it matters" analysis via Claude Haiku, and delivers via Telegram + HTML email (Resend with Gmail fallback). Zero dependencies — Node.js stdlib only.


## Key files
- `digest.js` — Main pipeline: fetch news → select 7 items → enrich with Claude Haiku (adds baseScore 0-10) → per-user relevance sort (baseScore 60% + topicMatch 40%) → deliver (Telegram + email) → archive → log costs. BASE_URL const for email links.
- `mailer.js` — Resend API (branded domain) with Gmail OAuth fallback. `List-Unsubscribe` + `List-Unsubscribe-Post` headers on all mail (RFC 8058). Also owns referral thank-you + re-engagement lifecycle emails and the open-tracking pixel URL builder.
- `src/jobs/reengagement-runtime.js` — Daily lifecycle automation: day-4 nudge, day-8 pause warning, day-11 auto-pause (idempotent via `user.reengagement_state`). Logs to `/tmp/signalbrief-reengagement.log`.
- `reply-handler.js` — Telegram reply handler. Claude-powered fuzzy intent parsing (save, more/less, add topic, /digest on-demand, questions). Telegram-first onboarding: `AWAITING_EMAIL` Map tracks chatIds mid-flow; `/start email@example.com` links existing web signups; unknown users prompted for email → account created via `handleEmailCapture()`.
- `bot-server.js` — Telegram long-polling server (port 3002)
- `store.js` — JSON file-based per-user data store (data/user-{chatId}.json). Includes engagement + reengagement fields (`last_email_open_at`, `email_opens_total`, `reengagement_state`, `signup_referral_source`).
- `web/server.js` — HTTP server (port 3003): onboarding/settings/archive/admin pages + API endpoints. In-memory rate limiting (5 signups/IP/15min + per-email cooldown). Includes open pixel endpoint `GET /t/:digestId/:token/o.gif`, pause/reactivate endpoints, referral attribution on signup, and `GET /api/admin/stats` with engagement + referral metrics.
- `web/index.html` — Onboarding form (4-step: details, topics, depth, schedule)
- `web/settings.html` + `web/settings.js` — Self-serve preferences editor. Auto-scrolls to #unsub anchor. Shows confirmation screens/banners on `?unsubscribed=1`, `?paused=1`, and `?reactivated=1`.
- `web/archive.html` — Past digest browser
- `web/admin.html` — Admin dashboard: summary cards + engagement card row (open rate, subscriber mix, re-engagement pipeline, referral signups), recent runs table, per-user cost table, user roster table.
- `templates/email.html` — HTML email template (600px responsive, blue accent #2563EB). Includes `{{EDITORIAL_NOTE}}` placeholder and referral-aware share links.
- `templates/welcome.html` — Welcome email with setup summary, Telegram tip (pre-filled `/start {{USER_EMAIL}}` command), archive link.
- `config.json` — API keys + topics + user config (gitignored, copy from config.example.json)
- `start.sh` — Starts bot-server + web-server in parallel

## Topic architecture (17 total)
**Industries (10):** HEALTHCARE, FINANCIAL SERVICES, PE×M&A, ENERGY, CONSUMER, LIFE SCIENCES, TECHNOLOGY, INDUSTRIALS, REAL ESTATE, PUBLIC SECTOR

**Capabilities (7):** AI×TECH, STRATEGY, POLICY×REGULATORY, SUSTAINABILITY, DIGITAL, M&A ADVISORY, TALENT

Topics appear as grouped chips in onboarding (index.html) and settings (settings.html). server.js exports both flat DEFAULT_TOPICS and structured industries/capabilities arrays from /api/topics. config.example.json has Perplexity search queries for all 17 topics.


## Architecture decisions
- Zero npm dependencies — everything uses Node.js built-in https, http, fs, path
- Per-user JSON files in data/ directory (not a database; SQLite upgrade path at ~20 users)
- Perplexity Sonar for news search (not Sonar Pro), Claude Haiku (`claude-haiku-4-5`) for enrichment + intent parsing
- Email: Resend preferred (branded domain), Gmail OAuth fallback
- Web server on port 3003, no framework — raw http.createServer
- Telegram via long-polling (not webhooks) — runs on local Mac
- Cloudflare Tunnel (named tunnel `signalbrief`, ID `308a0e0b-b520-4ae0-92d3-ca92bf3084f9`) serves web layer publicly at getsignalbrief.com
- LaunchAgent labels: `com.jarvis.signalbrief-bot`, `com.jarvis.signalbrief-web`, `com.jarvis.signalbrief-digest`, `com.jarvis.signalbrief-reengagement`, `com.jarvis.signalbrief-tunnel`
- Digest cron: 6:45 AM ET Mon–Sat via LaunchAgent (com.jarvis.signalbrief-digest.plist). No external cron dependency.
- Re-engagement cron: 8:00 AM ET daily via LaunchAgent (`deploy/launchagents/com.jarvis.signalbrief-reengagement.plist`), after digest delivery window.
- Rate limiting: in-memory Maps `RATE_IP` (5 req/15min) + `RATE_EMAIL` (10min cooldown) in web/server.js. `getClientIp()` respects `cf-connecting-ip` Cloudflare header.
- httpsPost in digest.js and reply-handler.js both resolve `{ status, body }` — always access `.body` for response data
- BASE_URL: `process.env.BASE_URL || "http://localhost:3003"` in server.js; set to `https://getsignalbrief.com` in com.jarvis.signalbrief-web.plist EnvironmentVariables

## User store fields
- `last_email_open_at`: ISO timestamp of the most recent tracking-pixel open (or `null`).
- `email_opens_total`: cumulative open count (integer).
- `reengagement_state`: `{ day4_sent_at, day8_sent_at, auto_paused_at, reactivated_at }` ISO-or-null fields for idempotent lifecycle sends.
- `signup_referral_source`: `{ chatId, email, ts }` of referring user when signup is attributed, else `null`.

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

## Git permissions
Claude is authorized to commit and push to GitHub (including force-push on feature branches) without asking for confirmation. Always commit and push when work is complete unless told otherwise.
