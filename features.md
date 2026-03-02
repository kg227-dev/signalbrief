# SignalBrief — Feature Roadmap

Last updated: 2026-03-01

---

## Status of Previous Audit

All P0 ship-blocking bugs (P0-1 through P0-6) have been fixed.
All P1 MVP features (P1-1 through P1-12) have been implemented.
All P2 post-launch fixes (P2-1 through P2-15) have been implemented.
Admin user editor page (admin-user.html) has been built.

The remaining items below are **new features and improvements** organized by priority.

---

## Known Remaining Issues

These are bugs or gaps discovered during the workflow-by-workflow audit. They should be addressed before or alongside new features.

### B-1: Settings page shows "request a link" if /api/user fetch fails
If the token lookup takes too long or the server returns an error, settings.js catches the error and shows the "not found" state with a magic link form. No retry, no error message explaining what happened. Users think their link is broken.
- File: `web/settings.js` init() catch block
- Fix: Show a clear error message with a retry button before falling back to magic link form.

### B-2: `findUserByToken()` does O(n) full disk scan on every request
Every call to `/api/user?token=`, `/api/settings`, and `/api/unsubscribe` triggers `allUsers()` which reads every user JSON file from disk. At 50+ users this becomes noticeably slow.
- Files: `web/server.js:17-20`, `store.js:66-77`
- Fix: Build an in-memory token→chatId index on startup, refresh on writes.

### B-3: Unauthenticated email-based POST unsubscribe (RFC 8058)
POST `/api/unsubscribe?email=victim@example.com` can unsubscribe any user. This is technically RFC 8058 compliant (email clients send this), but it means anyone who knows an email can unsubscribe them via a simple POST.
- File: `web/server.js:275-278`
- Fix: Consider adding a one-time HMAC signature to the unsubscribe URL so only the actual email recipient can trigger it.

### B-4: Custom topic normalization inconsistency between web and Telegram
Web onboarding stores custom topics as `custom_glp_1` (slugified). Telegram `add GLP-1` stores them as raw `GLP-1`. digest.js keyword matching handles both, but the settings page and admin display show inconsistent labels.
- Files: `web/index.html:530`, `reply-handler.js:413-421`, `web/settings.js`
- Fix: Normalize all custom topics to `custom_<slug>` format everywhere, with a display label derived from the slug.

### B-5: Archive doesn't store per-item relevance scores or baseScore
`saveToArchive()` strips `baseScore` and `relevanceScore` from items. The archive page can't show score badges like the email does.
- File: `digest.js:500-514`
- Fix: Include `baseScore` in the archived item data.

### B-6: On-demand digest (`/digest` or welcome digest) skips schedule check but still fetches all 17 topics
Welcome digests and `/digest` on-demand runs call Perplexity for all 17 configured topics even if the user only tracks 3. Wastes ~$0.07 per unnecessary call.
- File: `digest.js:568-570`
- Fix: For single-user on-demand runs, only fetch topics the user actually tracks.

### B-7: Concurrent writes can clobber user data
digest.js and bot-server.js can both write to the same user file simultaneously. If a user sends "save 3" while their digest is being delivered, one write overwrites the other.
- Files: `store.js:62-64`, `digest.js:689`, `reply-handler.js:375`
- Fix: Add file-level locking (or migrate to SQLite).

---

## P1: Retention — Make Beta Users Come Back Every Day

These features directly improve the daily experience for the first 10 beta users. They make the digest more useful, more personalized, and harder to stop reading.

### P1-1: Implicit relevance learning from saves and clicks
**Problem:** Users tune topics via explicit "more/less" commands, but most won't bother. Their actual engagement (which items they save, which links they click) is a much stronger signal.
**Feature:** Track saves per topic tag. After 5+ interactions, auto-adjust `topic_weights` — e.g., if a user saves 4 AI items and 0 Energy items, nudge AI up and Energy down. Show "we noticed you save a lot of AI stories — boosting it" in Telegram.
- Files: `reply-handler.js` (handleSave), `digest.js` (applyRelevanceScores)
- Complexity: **Medium**

### P1-2: Weekly synthesis digest (Friday "Week in Signal")
**Problem:** Individual daily signals are useful but consultants also need to synthesize trends for client conversations. "What were the 3 big themes this week?"
**Feature:** Every Friday, generate a separate "Week in Signal" digest. Use Claude to analyze all archived items from Mon–Fri, identify 3-4 emerging themes, and write a synthesis paragraph per theme with cross-references to daily items. Deliver via email only (longer format).
- Files: New `weekly-digest.js`, `templates/weekly.html`
- Complexity: **Large**

### P1-3: Client briefing export
**Problem:** Consultants often need to brief clients on "what happened this week in your industry." Today they manually curate from their digests.
**Feature:** Add a `/briefing [topic]` Telegram command and a web page (`/briefing?token=...&topic=HEALTHCARE`) that generates a formatted one-page PDF or HTML brief for a single topic. Pulls from the last 5 days of archive, filters to that topic, and adds a synthesis intro.
- Complexity: **Large**

### P1-4: Signal threading — link developing stories across days
**Problem:** A story often develops over multiple days (e.g., "KKR Cotiviti deal" appears Monday, "FTC reviews KKR-Cotiviti" appears Wednesday). Each appears as independent items.
**Feature:** During enrichment, ask Claude to identify if any item is a follow-up to a recent story (check last 3 days of archive). If so, add a `thread_id` and "Previously in SignalBrief: [date]" note in the WIM. In the archive, show threaded stories together.
- Files: `digest.js` (enrichItems prompt), archive display
- Complexity: **Large**

### P1-5: Digest feedback loop — quick reactions
**Problem:** No way to know if today's digest was good. The only signal is saves, which most users don't do.
**Feature:** Add a one-tap reaction row at the bottom of each Telegram digest: "How was today? 🔥 Great / 👍 Fine / 👎 Meh". Track responses in user data. Use aggregate feedback to tune the enrichment prompt quality over time. Show admin a "digest satisfaction" trend chart.
- Files: `digest.js` (formatTelegram), `reply-handler.js` (new reaction handler), `bot-server.js` (callback_query support)
- Complexity: **Medium**

### P1-6: Full-text search across past digests
**Problem:** "I remember seeing something about 340B pricing last week but can't find it." Archive only supports browsing by date.
**Feature:** Add a search box to the archive page and a `/search [query]` Telegram command. Search across all archived items' headlines, summaries, and WIMs. Return matching items with date and relevance highlighting.
- Files: `web/archive.html`, `web/server.js` (new `/api/search` endpoint)
- Complexity: **Medium**

### P1-7: Breaking news alerts for high-score items
**Problem:** Daily digests arrive at scheduled times, but a major M&A announcement at 2 PM gets stale by the next morning.
**Feature:** Run a lightweight "alert check" 2-3 times per day (e.g., 12 PM, 4 PM, 8 PM). Fetch only the top 3 topics. If any item scores baseScore >= 9.0, send an immediate Telegram alert (not a full digest). Cap at 1 alert per day per user to avoid fatigue.
- Files: New LaunchAgent, modification to `digest.js` for alert mode
- Complexity: **Large**

### P1-8: Duplicate detection across days
**Problem:** The same story can appear in multiple consecutive digests if it stays in Perplexity's results for 48 hours. "Didn't I already read about this?"
**Feature:** Before item selection, check each headline against the last 3 days of archive (fuzzy match on first 40 chars, same as current dedup). Skip items that appeared in recent digests.
- Files: `digest.js` (selectItems or post-fetch filter)
- Complexity: **Small**

### P1-9: Per-user timezone support
**Problem:** All delivery times are hardcoded to ET. A user in London selecting "7:00 AM" gets their digest at 7 AM ET (noon their time).
**Feature:** Add a timezone selector to onboarding and settings. Store in `preferences.timezone`. Convert delivery_time to the user's local time when checking schedule in digest.js.
- Files: `web/index.html`, `web/settings.html`, `digest.js:540-550`, `store.js:38`
- Complexity: **Medium**

---

## P2: Differentiation — Features That Make SignalBrief Unique

These features distinguish SignalBrief from generic news aggregators and make it specifically valuable for strategy consultants.

### P2-1: Custom topic Perplexity queries (activated)
**Problem:** Custom topics (e.g., "GLP-1", "DOGE") only match against existing results by keyword. No dedicated news fetch.
**Feature:** Before the main fetch loop, aggregate all custom topics across due users. Generate a Perplexity query for each unique custom topic (batch similar ones). Merge results into the main item pool. Cap at 5 custom queries per run to control cost.
- Files: `digest.js` (main, fetchTopicNews)
- Complexity: **Large**
- Cost impact: +$0.025 per custom query (~$0.05-0.10 per run with active custom topics)

### P2-2: Company/entity tracking
**Problem:** Consultants track specific companies (Nvidia, UnitedHealth, KKR) not just topic categories. "Tell me every time Nvidia appears in any story."
**Feature:** New "Watchlist" section in onboarding/settings. Store as `watchlist: ["Nvidia", "UnitedHealth"]`. During filtering, boost any item mentioning a watchlist entity (headline or summary match) to the top. Add a ⭐ badge in Telegram/email.
- Files: `web/index.html`, `web/settings.html`, `digest.js`, `store.js`
- Complexity: **Medium**

### P2-3: Earnings & regulatory calendar integration
**Problem:** Consultants need to know what's coming, not just what happened. "Earnings next week" and "FDA decision dates" are high-value context.
**Feature:** Maintain a simple JSON calendar of upcoming events (earnings dates for top 50 companies, major regulatory deadlines). In each digest, add a "This Week" sidebar showing 2-3 upcoming events relevant to the user's topics. Initially manual curation, later automated via SEC/FDA feeds.
- Complexity: **Large**

### P2-4: "Ask about this" — reply to a signal for deeper context
**Problem:** A signal catches the user's eye but they want more context. Today they'd have to Google it or read the source article.
**Feature:** When a user replies to a Telegram digest message referencing a specific item (e.g., "tell me more about #3"), use Claude to provide a 3-4 sentence deeper explanation drawing on the item's headline + summary + WIM. Include 1-2 follow-up questions the user might want answered.
- Files: `reply-handler.js` (new "deep dive" intent)
- Complexity: **Medium**

### P2-5: Source diversity scoring
**Problem:** Some digests end up with 4/7 items from the same source (e.g., all from Reuters). Feels like reading one publication, not a curated brief.
**Feature:** During `selectItems()`, penalize items from the same source domain. Ensure no more than 2 items per source in the final selection. Add source diversity as a visible metric in the admin dashboard.
- Files: `digest.js` (selectItems)
- Complexity: **Small**

### P2-6: Telegram inline keyboards for save/more/less
**Problem:** Users have to type "save 3" or "more AI" — friction that reduces engagement. Most Telegram bots use inline buttons.
**Feature:** Add inline keyboard buttons below each digest message: [Save] [More like this] [Less like this]. Handle via `callback_query` in bot-server.js. Dramatically reduces friction for the most common actions.
- Files: `digest.js` (formatTelegram), `bot-server.js` (callback_query handling), `reply-handler.js`
- Complexity: **Medium**

### P2-7: Email click tracking
**Problem:** No way to measure which email links users actually click. Email engagement is invisible.
**Feature:** Wrap article links in a redirect through `/api/click?token=TOKEN&url=ENCODED_URL&item=N`. Log click events to user data. Use click data alongside saves for implicit relevance learning (P1-1). Show click rates in admin dashboard.
- Files: `digest.js` (buildEmail), `web/server.js` (new `/api/click` endpoint)
- Complexity: **Medium**

### P2-8: Share a signal with a colleague
**Problem:** User sees a great signal and wants to forward it. Today they'd screenshot or copy-paste.
**Feature:** Add a `/share [#] [email]` Telegram command. Sends the selected item as a clean, branded one-signal email to the recipient. Include a "Get your own SignalBrief" CTA at the bottom (growth loop). Cap at 3 shares per day.
- Files: `reply-handler.js`, `mailer.js` (new share template)
- Complexity: **Medium**

---

## P3: Growth — Features That Scale the Product

### P3-1: Team accounts
**Problem:** A practice group (e.g., MBB healthcare team) wants a shared digest. Today each person signs up individually.
**Feature:** Add a "Team" concept. Team admin creates team via web, sets shared topics. Team members get the team digest plus their personal overlay. Shared bookmarks visible to all team members. Team admin sees team-level analytics.
- Complexity: **Very Large** — new data model, billing considerations, access control

### P3-2: Referral system
**Problem:** No organic growth mechanism. Users can't easily invite colleagues.
**Feature:** Each user gets a referral link (`/signup?ref=TOKEN`). When someone signs up via the link, both users get a "thank you" notification. Referrer sees their referral count in /settings. Admin sees referral chains in the dashboard. No reward needed initially — consultants share tools with colleagues naturally.
- Files: `web/server.js` (signup), `store.js` (referral tracking)
- Complexity: **Medium**

### P3-3: Public archive for SEO and lead generation
**Problem:** SignalBrief content is locked behind authentication. No public presence for organic discovery.
**Feature:** Create a public `/signals` page that shows headlines + tags from the last 7 days (no WIM, no deep analysis — that's the paid value). Each signal has a "Get the full analysis in your inbox" CTA. Good for SEO ("healthcare M&A news this week") and converts organic traffic to signups.
- Files: New `web/signals.html`, `web/server.js` (public archive endpoint)
- Complexity: **Medium**

### P3-4: Slack integration
**Problem:** Some teams live in Slack, not Telegram. Forcing Telegram adoption is a barrier.
**Feature:** Add Slack as a delivery channel alongside Telegram and email. Slack bot posts digest to a user's DM or a team channel. Support the same commands (save, more/less) via Slack message actions or slash commands.
- Complexity: **Very Large** — new OAuth flow, new message formatting, new bot infrastructure

### P3-5: API for external integrations
**Problem:** Power users may want to integrate SignalBrief data into their own tools (Notion, Airtable, internal dashboards).
**Feature:** Add a simple REST API: `GET /api/v1/digest?token=TOKEN&date=YYYY-MM-DD` returns the user's digest as structured JSON. `GET /api/v1/bookmarks?token=TOKEN` returns saved items. Rate limited to 100 req/day per token.
- Files: `web/server.js` (new `/api/v1/*` endpoints)
- Complexity: **Medium**

---

## P4: Infrastructure & Operations

### P4-1: SQLite migration
Replace per-user JSON files with SQLite. Eliminates concurrent write issues (B-7), makes token lookup O(1) instead of O(n) (B-2), enables proper queries for analytics. Keep the same `readUser`/`writeUser` interface so nothing else changes.
- Files: `store.js` (full rewrite, same exports)
- Complexity: **Medium**

### P4-2: Token rotation and expiry
Tokens currently last forever. Add a 90-day expiry. When a token is within 7 days of expiry, include a "refresh your access link" notice in the digest email. Expired tokens show the magic link request form in settings.
- Files: `store.js`, `web/server.js`, `digest.js`
- Complexity: **Medium**

### P4-3: Proper health monitoring and alerting
Add a `/api/health` public endpoint that returns server status. Set up a simple external ping (e.g., UptimeRobot or a cron curl) that alerts via Telegram DM to admin if the server is down. Log digest failures to a separate error log and alert if 2+ consecutive runs fail.
- Files: `web/server.js`, `digest.js`
- Complexity: **Small**

### P4-4: Telegram webhook mode
Switch from long-polling to webhooks via Cloudflare Tunnel. Eliminates the need for a separate bot-server.js process. More reliable, lower latency, fewer resources.
- Files: `bot-server.js` (rewrite), `web/server.js` (add webhook endpoint)
- Complexity: **Medium**

### P4-5: Cost optimization — cache Perplexity results across users
If multiple users are due at the same time (the normal case for scheduled runs), Perplexity is only called once and results are shared. But on-demand runs (`/digest`) re-fetch everything. Cache recent Perplexity results for 30 minutes so on-demand runs within that window reuse them.
- Files: `digest.js`
- Complexity: **Medium**

### P4-6: Graceful shutdown handlers
bot-server.js and web/server.js have no SIGTERM/SIGINT handlers. On process restart, in-flight requests are dropped and long-poll connections are abandoned.
- Files: `bot-server.js`, `web/server.js`
- Complexity: **Small**

### P4-7: Structured logging
Replace `console.log` and flat file logging with structured JSON logs. Add log levels (info, warn, error). Makes it possible to grep for errors, track request latency, and feed into monitoring.
- Files: All files that call `console.log` or `log()`
- Complexity: **Medium**

---

## Prioritization Matrix

| Feature | Impact | Effort | Priority | Depends On |
|---------|--------|--------|----------|------------|
| B-1 through B-7 | High | Small-Med | **Now** | — |
| P1-1 Implicit learning | High | Medium | **Next** | — |
| P1-2 Weekly synthesis | High | Large | **Next** | — |
| P1-5 Digest reactions | High | Medium | **Next** | — |
| P1-8 Cross-day dedup | Medium | Small | **Next** | — |
| P2-1 Custom topic queries | High | Large | **Soon** | — |
| P2-2 Company watchlist | High | Medium | **Soon** | — |
| P2-5 Source diversity | Medium | Small | **Soon** | — |
| P2-6 Inline keyboards | High | Medium | **Soon** | — |
| P1-6 Archive search | Medium | Medium | **Soon** | — |
| P1-9 Timezone support | Medium | Medium | **Soon** | — |
| P2-7 Click tracking | Medium | Medium | **Later** | — |
| P2-8 Share a signal | Medium | Medium | **Later** | — |
| P3-2 Referral system | High | Medium | **Later** | — |
| P3-3 Public archive | Medium | Medium | **Later** | — |
| P4-1 SQLite migration | High | Medium | **Later** | — |
| P4-2 Token rotation | Medium | Medium | **Later** | P4-1 |
| P1-3 Client briefing | High | Large | **Later** | P1-2 |
| P1-4 Signal threading | Medium | Large | **Later** | — |
| P1-7 Breaking alerts | Medium | Large | **Later** | — |
| P2-3 Calendar integration | Medium | Large | **Later** | — |
| P2-4 Ask about this | Medium | Medium | **Later** | — |
| P3-1 Team accounts | High | Very Large | **Future** | P4-1 |
| P3-4 Slack integration | Medium | Very Large | **Future** | — |
| P3-5 Public API | Low | Medium | **Future** | P4-1 |

---

## Recommended Build Order (Post-Bug-Fixes)

**Sprint 1 (stickiness):** P1-8 cross-day dedup, P2-5 source diversity, P1-5 digest reactions, P1-1 implicit learning
**Sprint 2 (differentiation):** P2-6 inline keyboards, P2-1 custom topic queries, P2-2 company watchlist
**Sprint 3 (depth):** P1-2 weekly synthesis, P1-6 archive search, P1-9 timezone support
**Sprint 4 (infrastructure):** P4-1 SQLite, P4-3 health monitoring, P4-2 token rotation
**Sprint 5 (growth):** P3-2 referrals, P3-3 public archive, P2-7 click tracking, P2-8 share a signal
