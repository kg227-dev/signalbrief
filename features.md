# SignalBrief — Feature Roadmap

Last updated: 2026-03-03 (rev 6)

---

## Status of Previous Audit

All P0 ship-blocking workflow bugs from the launch audit are fixed.
All B-1 through B-8 bugs are fixed.

Shipped in the current cycle (2026-03-02):
- Signup/settings/unsubscribe/archiving flows repaired end-to-end (including magic-link and redirect issues).
- Admin schedule dashboard shipped (active users, next delivery ET, CSV export).
- Archive page now renders full digest detail view from archive JSON (with compatibility normalization for older files).
- Admin "Send digest now" now always sends regular digest framing (no first-briefing copy).
- Manual digest targeting verified for both Telegram-linked and email-only users (via `email-*` chat IDs).
- Admin user page now includes direct "Open user archive" quick link.
- Recent runs now show recipient(s) in a dedicated "Sent to" column.
- Roster actions now include custom outbound messaging (email, Telegram, or both).
- Admin summary cards now align with roster semantics (unique users vs deliveries) and include a "Digests sent" stat.
- Test digest UX revamped to select a Telegram-linked target and trigger via stable `/api/admin/run-digest`.

Shipped in the current cycle (2026-03-03):
- Delivery accounting now tracks actual successful sends only (not attempted targets), including failed-recipient logging.
- `/start` now reliably re-activates paused/unsubscribed Telegram-linked users.
- Admin auth now requires session by default; localhost bypass is opt-in via `ADMIN_LOCAL_BYPASS=1`.
- Admin targeted "send digest now" now validates target status/channels and returns failure if digest delivery does not complete.
- Archive backfill now repairs partially-migrated `digest_dates` (not only fully-empty histories).
- Telegram digest numbering now supports 10 items (`1`–`10`) correctly.
- Settings saves no longer accidentally disable Telegram delivery for linked users.
- Signup/request-link/admin user lookup email matching is now null-safe + case-normalized.
- Telegram bookmark dates now use ET day keys (not UTC day rollover).
- Perplexity run logging now uses actual fetch-call counts (standard + custom) instead of a fixed topic count.

The remaining items below are **new features and improvements** organized by priority.

---

## Known Remaining Issues

B-1 through B-15 are resolved except B-10 and B-12. Current follow-up audit found these remaining gaps.

### ⚠️ B-10: Legacy `/api/admin/run-test-digest` path still exists but is no longer primary flow — **Open**
The UI now uses roster target + `/api/admin/run-digest`, but old test-digest endpoints remain in `web/server.js:793-804` and can create confusion during debugging.
- Suggested fix: deprecate/remove `GET/POST /api/admin/run-test-digest` and `/api/admin/test-digest-status`, or internally route both to one canonical implementation.

### ⚠️ B-12: Admin outbound custom messages are not auditable — **Open**
`/api/admin/message-user` sends messages but does not persist who sent what, when, and via which channel(s).
- Suggested fix: append JSONL audit records to `data/admin-message-log.json` and add an "Admin comms log" section in dashboard.

### ✅ B-9: Monthly users-reached stat drift vs roster — **Fixed**
Admin summary now keys monthly unique users to current roster delivery state and also exposes a log-based comparator (`month_unique_users_log`) for diagnostics.

### ✅ B-1: Settings page shows "request a link" if /api/user fetch fails — **Fixed**
Catch block now distinguishes network errors (shows retry button) from 404 (shows magic link form).

### ✅ B-2: `findUserByToken()` does O(n) full disk scan on every request — **Fixed**
`store.js` now builds an in-memory `tokenIndex` Map on startup, updated on every write. O(1) lookup.

### ✅ B-3: Unauthenticated email-based POST unsubscribe (RFC 8058) — **Fixed**
HMAC signature (`?sig=...`) now required on email-based unsubscribe URLs. Generated in `mailer.js`, verified in `server.js`.

### ✅ B-4: Custom topic normalization inconsistency between web and Telegram — **Fixed**
`reply-handler.js` now normalizes `add [topic]` to `custom_<slug>` matching web storage format.

### ✅ B-5: Archive doesn't store per-item relevance scores or baseScore — **Fixed**
`saveToArchive()` now includes `baseScore` in each archived item.

### ✅ B-6: On-demand digest fetches all 17 topics even for single user — **Fixed**
`digest.js` now filters `topicsToFetch` to the target user's tracked topics for `--chatId` runs.

### ✅ B-7: Concurrent writes can clobber user data — **Fixed**
`store.js` `writeUser()` now uses atomic write: write to `.tmp` then `fs.renameSync()` (POSIX-atomic).

### ✅ B-8: Topic weights have limited impact on ranking — **Fixed**
`applyRelevanceScores()` now accepts `topic_weights` and applies ±0.5 pts per weight unit via `matchWeightToTag()` (fuzzy key→tag matching). Digest logs before/after item order whenever a user has non-zero weights.

### ✅ B-11: Manual digest trigger for email-only users — **Fixed**
Current behavior already supports email-only users because they still have `chatId` placeholders (`email-*`) and `/api/admin/run-digest` accepts those targets.

### ✅ B-13: Admin auth localhost bypass by default — **Fixed**
Session auth is now required by default; localhost bypass only applies when `ADMIN_LOCAL_BYPASS=1`.

### ✅ B-14: Run logs counted attempted recipients, not successful deliveries — **Fixed**
`digest.js` now tracks `users_targeted`, `users_served`, `per_user` (success), and `per_user_failed` (failures), and targeted runs return non-zero when no delivery succeeds.

### ✅ B-15: Perplexity cost/call logging inaccurate for filtered runs — **Fixed**
`digest.js` now records actual call volume from the current run (`perplexity_calls_standard`, `perplexity_calls_custom`, and total `perplexity_calls`) and derives cost from that real count.

---

## P1: Retention — Make Beta Users Come Back Every Day

These features directly improve the daily experience for the first 10 beta users. They make the digest more useful, more personalized, and harder to stop reading.

### P1-1: Implicit relevance learning from saves and clicks
**Problem:** Users tune topics via explicit "more/less" commands, but most won't bother. Their actual engagement (which items they save, which links they click) is a much stronger signal.
**Feature:** Track saves per topic tag. After 5+ interactions, auto-adjust `topic_weights` — e.g., if a user saves 4 AI items and 0 Energy items, nudge AI up and Energy down. Show "we noticed you save a lot of AI stories — boosting it" in Telegram. Depends on B-8 being fixed first so weight changes actually affect ranking visibly.
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

### P1-10: "Why you're seeing this" transparency note
**Problem:** Users may not understand why certain stories appear repeatedly or why specific items rank highly. Opaque personalization erodes trust.
**Feature:** Add a subtle, single-line footer note in email and Telegram for top-ranked items: "Shown because you track: AI, Private Equity" or "Boosted due to your watchlist: Nvidia." Pulls from the item's matched topics and any watchlist hits. Increases trust and makes personalization feel real rather than random.
- Files: `digest.js` (formatTelegram, buildEmail)
- Complexity: **Small**
- Depends on: P1-1 (weights working meaningfully), B-8

### P1-11: Delivery confidence view + one-click resend for failures
**Problem:** Admin-triggered sends currently return "queued" feedback but don't show a clear per-user success/failure outcome.
**Feature:** Add run outcome status per recipient in admin (delivered/failed + reason) and a one-click "resend failed users" action.
- Files: `digest.js`, `web/server.js`, `web/admin.html`
- Complexity: **Medium**
- Depends on: B-14

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

### P2-9: Structured implication scoring (Consultant Lens Mode)
**Problem:** All WIMs are freeform paragraphs. Consultants often think in structured buckets — Strategy, Financial Impact, Regulatory Risk, Competitive Dynamics — and a wall of prose requires extra mental work to slot into those frameworks.
**Feature:** Ask Claude to output a structured implication block internally, then render either the default short paragraph (current behavior) or an optional "Consultant Lens" expanded view showing bullet implications under labeled categories. Controlled via `preferences.depth = "deep"` or a new explicit setting.
- Files: `digest.js` (enrichment prompt + formatting)
- Complexity: **Medium**

### P2-10: Multi-source corroboration indicator
**Problem:** Users can't tell if a signal is based on one outlet or broadly reported. A story covered by a single source deserves less confidence than one corroborated across five.
**Feature:** If multiple reputable domains report the same story (detected during the Perplexity fetch step), show a small "3 sources" badge next to the item. Boost the item's baseScore weighting slightly to reflect broader consensus.
- Files: `digest.js` (selection logic, scoring)
- Complexity: **Medium**

### P2-11: Admin outbound message templates + snippets
**Problem:** Custom messaging is now possible, but every message is authored from scratch, which is slow and inconsistent.
**Feature:** Add saved templates/snippets in admin composer (e.g., outage notice, schedule update, onboarding nudge), with variable placeholders (`{{name}}`, `{{delivery_time}}`).
- Files: `web/admin.html`, `web/server.js` (template config endpoint), optional `config.json` templates block
- Complexity: **Small–Medium**
- Depends on: current `/api/admin/message-user` implementation

### P2-12: Admin roster search + segment filters
**Problem:** The roster is becoming harder to scan quickly as users increase.
**Feature:** Add search and quick filters (status, channel, delivery time window, topic contains) with shareable URL state for support/debug handoffs.
- Files: `web/admin.html`
- Complexity: **Small**

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

### P3-6: Smart onboarding based on role
**Problem:** All users get the same onboarding topic picker. Consultants, investors, and operators have different mental models and very different default information needs.
**Feature:** Add a first-step role selector to onboarding: "I'm a: Consultant / Investor / Operator / Corporate Strategy." Pre-select recommended topic bundles based on role (e.g., Investor → PE×M&A, Financial Services, AI×TECH pre-checked) and adjust default scoring weights accordingly. Reduces time-to-first-value.
- Files: `web/index.html`, `store.js`
- Complexity: **Medium**

### P3-7: Engagement-based winback emails
**Problem:** Users may silently churn — stop opening the digest without explicitly unsubscribing. No mechanism currently detects or acts on silent disengagement.
**Feature:** If a user hasn't opened/clicked in 10 days (proxy: no Telegram activity + email click tracking shows no activity), send a short re-engagement email: "Still finding this useful? Adjust your topics here →". Include a one-click topic settings link and a gentle unsubscribe escape hatch. Cap at one winback email per 30-day window.
- Files: `digest.js`, `mailer.js`
- Complexity: **Small–Medium**
- Depends on: P2-7 (click tracking for email engagement signal)

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

### P4-8: Per-topic cost attribution
**Problem:** Hard to know which topics are driving API cost. All Perplexity calls look the same in the cost log. Can't identify whether a custom topic or a rarely-read standard topic is disproportionately expensive.
**Feature:** Log Perplexity call cost by topic per run (already have the per-call timing, just need to annotate by topic). Show in the admin dashboard which topics are the most expensive vs. most engaged (save rate per topic). Enables informed decisions about pruning low-value queries.
- Files: `digest.js`, `web/server.js` (admin stats endpoint), `web/admin.html`
- Complexity: **Small**

### P4-9: Feature flag framework
**Problem:** New features must be deployed globally or not at all. During beta with 10 users, it's risky to roll out changes without a way to test with a subset first.
**Feature:** Add simple per-user feature flags support: `flags: { weeklyDigest: true, consultantLens: false }` stored in user JSON. Digest and bot logic checks flags before enabling experimental paths. Admin dashboard shows flag state per user with toggle controls. Enables gradual rollout without separate deployment.
- Files: `store.js` (flags field in defaultUser), `digest.js`, `web/server.js`, `web/admin-user.html`
- Complexity: **Small–Medium**

### P4-10: Admin communication audit log
**Problem:** No system-of-record for manual admin messages (custom sends) or ad hoc trigger actions.
**Feature:** Log every admin outbound action (digest trigger, custom message) with actor/session, target user, channels, payload hash, and result status. Expose searchable UI.
- Files: `web/server.js`, `data/admin-message-log.json`, `web/admin.html`
- Complexity: **Small–Medium**
- Depends on: B-12

### P4-11: Consolidate and retire legacy test-digest endpoint
**Problem:** Two parallel test-send paths increase maintenance burden and incident confusion.
**Feature:** Keep a single canonical admin send path and remove stale APIs/UI hooks.
- Files: `web/server.js`, `web/admin.html`
- Complexity: **Small**
- Depends on: B-10

### P4-12: Delivery reconciliation checks
**Problem:** Cost-log run metrics and user-level counters can drift silently over time.
**Feature:** Add a daily reconciliation job that compares `cost-log` delivered counts vs `digests_received` increments, and flags mismatches in admin health.
- Files: new `reconcile.js`, `web/server.js` health summary, `web/admin.html`
- Complexity: **Medium**

### P4-13: Environment-safe admin auth mode
**Problem:** Localhost auth bypass is useful in dev but risky in production topologies that proxy traffic to localhost.
**Feature:** Make auth mode explicit by environment; default to strict session auth, with an opt-in local bypass only in development.
- Files: `web/server.js`, deployment env config
- Complexity: **Small**
- Depends on: B-13

---

## Prioritization Matrix

| Feature | Impact | Effort | Priority | Depends On |
|---------|--------|--------|----------|------------|
| **B-13 Admin auth localhost bypass** | Very High | Small | **Done** | — |
| **B-14 Delivery stats overcount attempted sends** | High | Small-Med | **Done** | — |
| **B-15 Perplexity cost/call mis-logging** | High | Small | **Done** | — |
| **B-12 Admin message auditability** | High | Small-Med | **Now** | — |
| **B-10 Legacy test endpoint cleanup** | Medium | Small | **Now** | — |
| **B-9 Legacy unique-user fallback** | Medium | Small | **Done** | — |
| P1-10 Why you're seeing this | Medium | Small | **Next** | B-8 |
| P1-1 Implicit learning | High | Medium | **Next** | B-8 |
| P1-11 Delivery confidence + resend failures | High | Medium | **Next** | B-14 |
| P1-2 Weekly synthesis | High | Large | **Next** | — |
| P1-5 Digest reactions | High | Medium | **Next** | — |
| P1-8 Cross-day dedup | Medium | Small | **Next** | — |
| P4-9 Feature flags | High | Small-Med | **Next** | — |
| P2-11 Admin message templates | Medium | Small-Med | **Next** | — |
| P2-12 Roster search + filters | Medium | Small | **Next** | — |
| P4-10 Admin comms audit log | High | Small-Med | **Next** | B-12 |
| P4-11 Retire legacy test endpoint | Medium | Small | **Next** | B-10 |
| P4-13 Environment-safe admin auth mode | Very High | Small | **Done** | B-13 |
| P2-1 Custom topic queries | High | Large | **Soon** | — |
| P2-2 Company watchlist | High | Medium | **Soon** | — |
| P2-5 Source diversity | Medium | Small | **Soon** | — |
| P2-6 Inline keyboards | High | Medium | **Soon** | — |
| P2-9 Consultant Lens Mode | Medium | Medium | **Soon** | — |
| P2-10 Source corroboration | Medium | Medium | **Soon** | — |
| P1-6 Archive search | Medium | Medium | **Soon** | — |
| P1-9 Timezone support | Medium | Medium | **Soon** | — |
| P3-6 Smart onboarding | High | Medium | **Soon** | — |
| P4-8 Cost attribution | Medium | Small | **Soon** | — |
| P2-7 Click tracking | Medium | Medium | **Later** | — |
| P2-8 Share a signal | Medium | Medium | **Later** | — |
| P3-2 Referral system | High | Medium | **Later** | — |
| P3-3 Public archive | Medium | Medium | **Later** | — |
| P3-7 Winback emails | Medium | Small-Med | **Later** | P2-7 |
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

## Recommended Build Order

**Immediate (now):** B-12 admin comms auditability, B-10 legacy test endpoint cleanup
**Sprint 1 (stability + trust):** P4-11 retire legacy test endpoint, P4-10 admin comms audit log, P1-11 delivery confidence + resend, P2-11 message templates
**Sprint 2 (personalization):** P1-1 implicit learning, P2-6 inline keyboards, P2-2 company watchlist
**Sprint 3 (differentiation):** P2-9 Consultant Lens, P2-10 source corroboration, P2-1 custom topic queries
**Sprint 4 (depth + growth):** P1-2 weekly synthesis, P1-6 archive search, P3-6 smart onboarding, P4-8 cost attribution, P2-12 roster filters
**Sprint 5 (infrastructure):** P4-1 SQLite, P4-3 health monitoring, P4-2 token rotation, P4-12 reconciliation checks
**Sprint 6 (scale):** P3-2 referrals, P3-3 public archive, P2-7 click tracking, P3-7 winback emails
